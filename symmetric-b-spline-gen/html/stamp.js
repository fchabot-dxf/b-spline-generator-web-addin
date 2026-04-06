// 1. HELPER: G1-continuous power curve for adjustable "tightness"
function powerStep(edge0, edge1, x, p = 2.2) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    // Restored your perfectly smooth S-curve!
    return 1.0 - Math.pow(1.0 - Math.pow(t, p), p); 
}

// 2. HELPER: Bilinear sampling to remove the "clunky" pixelated look
function sampleSDF(sdf, w, h, x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
    const fx = x - x0, fy = y - y0;
    return sdf[y0 * w + x0] * (1 - fx) * (1 - fy) +
        sdf[y0 * w + x1] * fx * (1 - fy) +
        sdf[y1 * w + x0] * (1 - fx) * fy +
        sdf[y1 * w + x1] * fx * fy;
}

const stampCanvas = document.createElement('canvas');
const stampCtx = stampCanvas.getContext('2d', { willReadFrequently: true });

// Lazy-load canvg v3 (ESM). Cached after first successful load.
// v3 API: Canvg.fromString(ctx, svgString, options) → instance → .render()
let _CanvgClass = null;
async function _loadCanvg() {
    if (_CanvgClass) return _CanvgClass;
    try {
        const mod = await import('https://esm.sh/canvg@3');
        _CanvgClass = mod.Canvg || mod.default?.Canvg || mod.default;
        if (!_CanvgClass) console.error('[SVG DEBUG] canvg@3 imported but no Canvg export found');
        return _CanvgClass || null;
    } catch (e) {
        console.error('[SVG DEBUG] Failed to dynamically load canvg v3:', e);
        return null;
    }
}

// Ensure computeSDF is fully self-contained
// Ensure computeSDF is fully self-contained (True Euclidean Distance Transform)
function computeSDF(pixels, w, h) {
    const size = w * h;
    const inX = new Float32Array(size).fill(9999);
    const inY = new Float32Array(size).fill(9999);
    const outX = new Float32Array(size).fill(9999);
    const outY = new Float32Array(size).fill(9999);
    
    // 1. Initialize boundaries
    for (let i = 0; i < size; i++) {
        if (pixels[i * 4 + 3] > 127) {
            inX[i] = 0; inY[i] = 0;
        } else {
            outX[i] = 0; outY[i] = 0;
        }
    }
    
    // 2. Danielsson's 8-Point Vector Distance Transform
    function pass(gridX, gridY, startY, endY, stepY, startX, endX, stepX) {
        for (let y = startY; y !== endY; y += stepY) {
            for (let x = startX; x !== endX; x += stepX) {
                const i = y * w + x;
                
                const check = (dx, dy) => {
                    const nx = x + dx, ny = y + dy;
                    if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                        const idx = ny * w + nx;
                        if (gridX[idx] === 9999) return;
                        
                        // Accumulate the vector to the nearest edge
                        const gx = gridX[idx] + Math.abs(dx);
                        const gy = gridY[idx] + Math.abs(dy);
                        const distSq = gx * gx + gy * gy;
                        
                        // Compare squared distances to find the true closest point
                        const curSq = gridX[i] * gridX[i] + gridY[i] * gridY[i];
                        if (distSq < curSq) {
                            gridX[i] = gx;
                            gridY[i] = gy;
                        }
                    }
                };
                
                if (stepY > 0) {
                    // Forward pass: check Top-Left, Top, Top-Right, Left
                    check(-1, 0); check(0, -1); check(-1, -1); check(1, -1);
                } else {
                    // Backward pass: check Right, Bottom, Bottom-Right, Bottom-Left
                    check(1, 0); check(0, 1); check(1, 1); check(-1, 1);
                }
            }
        }
    }
    
    // Run the passes for both inside and outside fields
    pass(inX, inY, 0, h, 1, 0, w, 1);
    pass(inX, inY, h - 1, -1, -1, w - 1, -1, -1);
    
    pass(outX, outY, 0, h, 1, 0, w, 1);
    pass(outX, outY, h - 1, -1, -1, w - 1, -1, -1);
    
    // 3. Resolve final Euclidean distances
    const dist = new Float32Array(size);
    for (let i = 0; i < size; i++) {
        // Pythagorean theorem to get the true circular radius
        const dIn = Math.sqrt(inX[i] * inX[i] + inY[i] * inY[i]);
        const dOut = Math.sqrt(outX[i] * outX[i] + outY[i] * outY[i]);
        
        // Convention: positive = inside shape, negative = outside
        dist[i] = dOut - dIn;
    }
    return dist;
}

export async function rasterizeSvg(svgText, nx, nz, blurIn, widthIn, heightIn, stampProfile, stampDepth, stampVBitAngle, edgeFilletRadius = 0, filletPower = 2.2) {
    console.log(`[STAMP DEBUG] Rasterizing for grid: ${nx}x${nz}. Stock: ${widthIn}x${heightIn}`);
    
    return new Promise(async (resolve) => {
        let processedSvg = svgText.replace(/<style[\s\S]*?<\/style>/gi, '');
        processedSvg = processedSvg.replace(/\s+svgjs:[^=]+="[^"]*"/g, '');
        processedSvg = processedSvg.replace(/(<text[^>]*?)font-family=(["'])([^"']*?)\2/gi, (match, pre, quote, fams) => {
            const genericFamilies = ["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"];
            let found = genericFamilies.find(f => fams.includes(f));
            return pre + 'font-family=' + quote + (found || 'sans-serif') + quote;
        });
        processedSvg = processedSvg.replace(/(<text(?![^>]*font-family)[^>]*?)(>)/gi, '$1 font-family="sans-serif"$3');

        const bufferW = nx, bufferH = nz;
        stampCanvas.width = bufferW; 
        stampCanvas.height = bufferH;

        const safeSvgText = processedSvg
            .replace(/width="[^"]+"/, `width="${bufferW}"`)
            .replace(/height="[^"]+"/, `height="${bufferH}"`)
            .replace(/preserveAspectRatio="[^"]*"/g, '')
            .replace(/<svg/, '<svg preserveAspectRatio="none"');

        // Load canvg v3 (dynamic import — no global dependency)
        const Canvg = await _loadCanvg();
        if (Canvg) {
            stampCtx.clearRect(0, 0, bufferW, bufferH);
            stampCtx.filter = blurIn > 0 ? `blur(${blurIn}px)` : 'none';
            try {
                // v3 API: fromString takes the 2D context (not the canvas element), then .render()
                const instance = await Canvg.fromString(stampCtx, safeSvgText, { ignoreAnimation: true, ignoreMouse: true });
                await instance.render();
                const imageData = stampCtx.getImageData(0, 0, bufferW, bufferH);
                console.log('[STAMP DEBUG] Rasterization complete. Mask generated.');
                finishRaster(imageData);
            } catch (err) {
                console.error('[SVG DEBUG] rasterizeSvg: Error rendering with canvg v3:', err);
                resolve(new Float32Array(nx * nz)); // Resolve safely on fail
            }
        } else {
            console.error('[SVG DEBUG] rasterizeSvg: canvg v3 not available — stamp mask will be empty');
            resolve(new Float32Array(nx * nz)); // Resolve safely on fail
        }

        function finishRaster(imageData) {
            const sdf = computeSDF(imageData.data, bufferW, bufferH);
            const inchPerPx = widthIn / bufferW;
            const alphaMask = new Float32Array(nx * nz);
    
            const maxDepth = Math.abs(stampDepth);
            const angleRad = (stampVBitAngle || 90) * Math.PI / 180;
            const vSlope = 1.0 / Math.tan(angleRad / 2);
            const filletRadiusIn = Math.max(0, edgeFilletRadius || 0);

            for (let j = 0; j < nz; j++) {
                // Flip Y: j=0 is -Y (bottom in 3D) but top in canvas, so invert
                const fy = ((nz - 1 - j) / (nz - 1)) * (bufferH - 1);
                
                for (let i = 0; i < nx; i++) {
                    const fx = (i / (nx - 1)) * (bufferW - 1);
            
                    // Bilinear sample for perfectly smooth vector geometry
                    const distIn = sampleSDF(sdf, bufferW, bufferH, fx, fy) * inchPerPx;

                    // 1. Tool Profile (Starts EXACTLY at the edge: distIn = 0)
                    let Z_p = 0;
                    if (stampProfile === 'flat') {
                        Z_p = distIn > 0 ? maxDepth : 0;
                    } else if (stampProfile === 'vbit') {
                        Z_p = distIn > 0 ? Math.min(distIn * vSlope, maxDepth) : 0;
                    } else if (stampProfile === 'ballnose') {
                        // Dynamically use maxDepth as the radius if not otherwise specified
                        const R = maxDepth; 
                        if (distIn > 0) {
                            Z_p = distIn >= R ? R : Math.sqrt(Math.max(0, R*R - Math.pow(R - distIn, 2)));
                            Z_p = Math.min(Z_p, maxDepth);
                        }
                    } else {
                        // Fallback
                        Z_p = distIn > 0 ? maxDepth : 0;
                    }

                    let Z_base = Z_p;
                    let filletAlpha = 1.0;

                    // 2. Fixed-Proportion Adaptive Fillet Blend
                    if (filletRadiusIn > 0) {
                        let bias = (stampProfile === 'flat' || stampProfile === 'ballnose') 
                            ? 1.0 
                            : Math.cos(angleRad / 2);

                        const outR = filletRadiusIn * (1.0 + bias);
                        const inR  = filletRadiusIn * (1.0 - bias);

                        filletAlpha = powerStep(-outR, inR, distIn, filletPower);
                
                        // FIX: Decouple the fillet height from the plunge depth!
                        // Limit the curve height to match its physical width so it doesn't warp.
                        if (distIn < 0) {
                            const rampPhysicalHeight = Math.min(outR + inR, maxDepth);
                            Z_base = rampPhysicalHeight; 
                        } 
                    }

                    // Calculate final depth natively (No more softAlpha clipping!)
                    let Z_final = Z_base * filletAlpha;
            
                    // Sentinel to trigger surface smoothing under the toolpath
                    const isStamped = (distIn > -0.05) || (filletRadiusIn > 0 && distIn > -filletRadiusIn * 2.0);
                    if (isStamped && Z_final < 1e-7) Z_final = 1e-7;

                    // Ensure the final direction matches the requested depth sign
                    alphaMask[j * nx + i] = stampDepth < 0 ? -Z_final : Z_final;
                }
            }
            
            // Successfully resolve the promise with the computed mask
            resolve(alphaMask);
        }
    });
}
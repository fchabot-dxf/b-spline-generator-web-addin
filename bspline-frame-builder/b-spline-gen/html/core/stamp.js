// 1. HELPER: G1-continuous power curve for adjustable "tightness"
function powerStep(edge0, edge1, x, p = 2.2) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    // Restored your perfectly smooth S-curve!
    return 1.0 - Math.pow(1.0 - Math.pow(t, p), p); 
}

import { COORD_SYSTEM } from './coords.js';

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

// ─── Native SVG renderer (primary) ──────────────────────────────────────────
// Renders the SVG string via a Blob URL → <img> → canvas drawImage.
// This uses the browser's own SVG engine so fonts, styles, and text are
// rendered exactly as they appear in the editor — no canvg font fallback issues.
function _renderSvgNative(ctx, svgString, w, h) {
    return new Promise((resolve, reject) => {
        const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        const img  = new Image();
        img.onload = () => {
            ctx.clearRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            URL.revokeObjectURL(url);
            resolve(true);
        };
        img.onerror = (e) => {
            URL.revokeObjectURL(url);
            reject(e);
        };
        img.src = url;
    });
}

// ─── canvg v3 (fallback for environments that block blob URLs) ───────────────
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
        // Strip <style> blocks but PRESERVE any @font-face rules inside
        // them. The strip is intended to remove svg.js styling that
        // interferes with rasterization; @font-face is required so the
        // detached SVG render context (data: URL → Image → canvas) can
        // resolve Symbol/Wingdings/Webdings/etc. on iOS, where those
        // fonts are not installed at the OS level.
        let processedSvg = svgText.replace(/<style[\s\S]*?<\/style>/gi, (match) => {
            const fontFaceRules = match.match(/@font-face\s*\{[^}]*\}/g);
            if (!fontFaceRules || fontFaceRules.length === 0) return '';
            return `<style type="text/css">${fontFaceRules.join('\n')}</style>`;
        });
        processedSvg = processedSvg.replace(/\s+svgjs:[^=]+="[^"]*"/g, '');
        processedSvg = processedSvg.replace(/(<text[^>]*?)font-family=(["'])([^"']*?)\2/gi, (match, pre, quote, fams) => {
            // Keep any font that the browser recognises — local self-hosted fonts first,
            // then CSS generic families. Unknown/missing fonts fall back to Arial.
            const knownFonts = [
                // Sans-serif
                "Arial", "Tahoma", "Verdana", "Bahnschrift", "Impact",
                // Serif
                "Georgia", "Times New Roman",
                // Monospace
                "Courier New", "Cascadia Code", "Cascadia Mono",
                // Symbol / icon fonts
                "Marlett", "Symbol", "Webdings", "Wingdings",
                "Segoe UI Symbol", "Segoe MDL2 Assets", "Segoe Fluent Icons", "Segoe UI Emoji",
                // CSS generic families (fallback)
                "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"
            ];
            const found = knownFonts.find(f => fams.toLowerCase().includes(f.toLowerCase()));
            return pre + 'font-family=' + quote + (found || 'Arial') + quote;
        });
        processedSvg = processedSvg.replace(/(<text(?![^>]*font-family)[^>]*?)(>)/gi, '$1 font-family="Arial"$3');

        const bufferW = nx, bufferH = nz;
        stampCanvas.width = bufferW; 
        stampCanvas.height = bufferH;

        const safeSvgText = processedSvg
            .replace(/width="[^"]+"/, `width="${bufferW}"`)
            .replace(/height="[^"]+"/, `height="${bufferH}"`)
            .replace(/preserveAspectRatio="[^"]*"/g, '')
            .replace(/<svg/, '<svg preserveAspectRatio="none"');

        if (window && window.console) {
            console.log('[STAMP DEBUG] rasterizeSvg: bufferW=', bufferW, 'bufferH=', bufferH);
            const viewBoxMatch = safeSvgText.match(/viewBox="([^"]+)"/i);
            console.log('[STAMP DEBUG] rasterizeSvg: safeSvgText viewBox=', viewBoxMatch ? viewBoxMatch[1] : 'none');
        }

        // ── Step 1: try native browser SVG rendering (correct fonts, no canvg quirks) ──
        stampCtx.clearRect(0, 0, bufferW, bufferH);
        if (blurIn > 0) stampCtx.filter = `blur(${blurIn}px)`;
        else stampCtx.filter = 'none';

        let nativeOk = false;
        try {
            await _renderSvgNative(stampCtx, safeSvgText, bufferW, bufferH);
            nativeOk = true;
            console.log('[STAMP DEBUG] Native SVG render succeeded.');
        } catch (nativeErr) {
            console.warn('[SVG DEBUG] Native render failed, falling back to canvg:', nativeErr);
        }

        if (nativeOk) {
            const imageData = stampCtx.getImageData(0, 0, bufferW, bufferH);
            console.log('[STAMP DEBUG] Rasterization complete (native). Mask generated.');
            finishRaster(imageData);
            return;
        }

        // ── Step 2: canvg v3 fallback ─────────────────────────────────────────────
        const Canvg = await _loadCanvg();
        if (Canvg) {
            stampCtx.clearRect(0, 0, bufferW, bufferH);
            try {
                const instance = await Canvg.fromString(stampCtx, safeSvgText, { ignoreAnimation: true, ignoreMouse: true });
                await instance.render();
                const imageData = stampCtx.getImageData(0, 0, bufferW, bufferH);
                console.log('[STAMP DEBUG] Rasterization complete (canvg fallback). Mask generated.');
                finishRaster(imageData);
            } catch (err) {
                console.error('[SVG DEBUG] rasterizeSvg: canvg render also failed:', err);
                resolve(new Float32Array(nx * nz));
            }
        } else {
            console.error('[SVG DEBUG] rasterizeSvg: no renderer available — stamp mask will be empty');
            resolve(new Float32Array(nx * nz));
        }

        function finishRaster(imageData) {
            const sdf = computeSDF(imageData.data, bufferW, bufferH);
            const inchPerPx = widthIn / bufferW;
            const alphaMask = new Float32Array(nx * nz);

            const maxDepth = Math.abs(stampDepth);
            const angleRad = (stampVBitAngle || 90) * Math.PI / 180;
            const vSlope = 1.0 / Math.tan(angleRad / 2);

            // Inscribed-circle radius of the stamp footprint, in inches.
            // This is the largest distance from any interior point to the
            // nearest boundary — i.e., the half-thickness of the widest
            // feature. Used by ballnose to draw a true half-sphere across
            // the geometry (instead of plateauing at the tool radius), and
            // by edge fillet to clamp its reach so it can't extend past
            // the feature.
            let maxSdfInsidePx = 0;
            for (let k = 0; k < sdf.length; k++) {
                if (sdf[k] > maxSdfInsidePx) maxSdfInsidePx = sdf[k];
            }
            const maxSdfInsideIn = maxSdfInsidePx * inchPerPx;

            // Cap the requested fillet radius at the inscribed radius. Past
            // that point the fillet ramp would extend beyond the geometry's
            // own thickness, which is what looked like "too much range".
            const requestedFillet = Math.max(0, edgeFilletRadius || 0);
            const filletRadiusIn = (maxSdfInsideIn > 0)
                ? Math.min(requestedFillet, maxSdfInsideIn)
                : requestedFillet;

            // Pre-compute the bias used by the fillet blend; same for every
            // pixel, no point recomputing it 40k times in the inner loop.
            //
            // Bias depends on the profile's actual wall slope so the fillet
            // matches the geometry it's smoothing:
            //   - flat/ballnose: vertical wall (or no wall) → bias = 1
            //     (fillet entirely outside the boundary).
            //   - vbit: wall slope set by stampVBitAngle.
            //   - adaptive: wall slope HARDCODED at 75° (matches adaptSlope
            //     = 1/tan(75°/2)). Previously this used angleRad (the
            //     V-bit slider), which was wrong — the V-bit angle has no
            //     effect on adaptive's actual ramp.
            const ADAPTIVE_ANGLE_RAD = 75 * Math.PI / 180;
            const profileAngleRad = stampProfile === 'adaptive' ? ADAPTIVE_ANGLE_RAD : angleRad;
            const filletBias = (stampProfile === 'flat' || stampProfile === 'ballnose')
                ? 1.0
                : Math.cos(profileAngleRad / 2);
            const filletOutR = filletRadiusIn * (1.0 + filletBias);
            const filletInR  = filletRadiusIn * (1.0 - filletBias);

            for (let j = 0; j < nz; j++) {
                // Flip Y: j=0 is -Y (bottom in 3D) but top in canvas, so invert
                const fy = COORD_SYSTEM.gridRowToRasterY(j, nz, bufferH);
                if (window && window.console && (j === 0 || j === nz - 1)) {
                    console.log(`[STAMP DEBUG] gridRowToRasterY: j=${j}/${nz-1} -> fy=${fy}`);
                }
                
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
                        // True half-sphere across the stamp footprint, peak
                        // capped to match the geometry depth limit of a
                        // 90° vbit so ballnose and vbit reach the same
                        // physical depth on the same stamp. Without the
                        // cap, ballnose was always plunging the full
                        // maxDepth (because it scales the curve to the
                        // inscribed radius), which made it sit ~3× taller
                        // than vbit on narrow features.
                        //
                        // Reachable peak = min(maxDepth, R_eff). The curve
                        // still spans the full inscribed radius — it just
                        // tops out lower so it matches vbit's depth.
                        const R_eff = Math.max(1e-6, maxSdfInsideIn);
                        const reachable = Math.min(maxDepth, R_eff);
                        if (distIn > 0) {
                            const t = Math.min(1, distIn / R_eff);
                            const u = 1 - t;
                            Z_p = reachable * Math.sqrt(Math.max(0, 1 - u * u));
                        }
                    } else if (stampProfile === 'adaptive') {
                        // Adaptive: Flat at full depth inside the boundary,
                        // tight 75° tapered ramp outside the boundary.
                        // Inside (distIn >= 0): full maxDepth, follows terrain.
                        // Outside (distIn < 0): steep ramp to zero.
                        // 75° taper slope ≈ 1.303 → ramp width = maxDepth/1.303
                        const adaptSlope = 1.3032;  // 1/tan(75°/2), fixed 75° taper
                        if (distIn >= 0) {
                            Z_p = maxDepth;
                        } else {
                            Z_p = Math.max(0, maxDepth + distIn * adaptSlope);
                        }
                    } else {
                        // Fallback
                        Z_p = distIn > 0 ? maxDepth : 0;
                    }

                    let Z_base = Z_p;
                    let filletAlpha = 1.0;

                    // 2. Fillet blend — profile-aware tangent transition.
                    //
                    // Each profile starts at a different height at the
                    // boundary (Z_p(0)), so the fillet's outer ramp height
                    // has to match that to avoid a step:
                    //
                    //   - flat:    Z_p(0) = maxDepth → ramp from maxDepth.
                    //              Smooth cliff-to-terrain transition.
                    //   - adaptive: same — already at maxDepth at the
                    //              boundary, fillet replaces the natural
                    //              75° outer ramp with a softer powerStep.
                    //   - vbit / ballnose: Z_p(0) = 0 (profile already
                    //              tangent to terrain). Use the historical
                    //              rampPhysicalHeight cap (≈ 2·filletRadius)
                    //              so the fillet still produces a small
                    //              corner-rounding bump and outR isn't
                    //              wasted — clamped to maxDepth so it
                    //              never exceeds the stamp's own depth.
                    if (filletRadiusIn > 0) {
                        filletAlpha = powerStep(-filletOutR, filletInR, distIn, filletPower);
                        if (distIn < 0) {
                            if (stampProfile === 'flat' || stampProfile === 'adaptive') {
                                Z_base = maxDepth;
                            } else {
                                Z_base = Math.min(filletOutR + filletInR, maxDepth);
                            }
                        }
                    }

                    // Calculate final depth natively (No more softAlpha clipping!)
                    let Z_final = Z_base * filletAlpha;
            
                    // Normalize to 0..1 so the mask is depth-independent.
                    // The actual depth (and its sign) is applied at render time in engine.js
                    // and terrain.js, so changing the depth slider never requires a re-rasterize.
                    const Z_norm = maxDepth > 0 ? Z_final / maxDepth : 0;

                    // Sentinel (small positive value) marks pixels inside the stamp footprint
                    // so terrain suppression can be applied there even when Z_norm rounds to zero.
                    // Adaptive profile extends outside the boundary by maxDepth/1.3032 (75° taper).
                    const adaptiveRamp = (stampProfile === 'adaptive') ? maxDepth / 1.3032 : 0;
                    const isStamped = (distIn > -Math.max(0.05, adaptiveRamp)) || (filletRadiusIn > 0 && distIn > -filletRadiusIn * 2.0);
                    alphaMask[j * nx + i] = (isStamped && Z_norm < 1e-5) ? 1e-5 : Z_norm;
                }
            }
            
            // Successfully resolve the promise with the computed mask
            resolve(alphaMask);
        }
    });
}
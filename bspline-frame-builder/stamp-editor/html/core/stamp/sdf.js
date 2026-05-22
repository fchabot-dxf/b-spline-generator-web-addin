/**
 * Distance-field math primitives for the stamp rasterizer. No SVG, no
 * profile knowledge — just `pixels → SDF`, plus bilinear sampling and
 * the powerStep S-curve used by fillet alpha.
 */

/**
 * G1-continuous power curve for adjustable "tightness". Tangent-flat at
 * both ends so it can connect to flat surfaces without slope mismatch.
 *   t = 0 (x = edge0): returns 0
 *   t = 1 (x = edge1): returns 1
 * Higher p = sharper transition; default 2.2 is a reasonable middle.
 */
export function powerStep(edge0, edge1, x, p = 2.2) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return 1.0 - Math.pow(1.0 - Math.pow(t, p), p);
}

/**
 * Bilinear SDF sample. Anti-pixelates the rasterized boundary so the
 * stamp looks smooth even at modest buffer resolutions.
 */
export function sampleSDF(sdf, w, h, x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
    const fx = x - x0, fy = y - y0;
    return sdf[y0 * w + x0] * (1 - fx) * (1 - fy) +
        sdf[y0 * w + x1] * fx * (1 - fy) +
        sdf[y1 * w + x0] * (1 - fx) * fy +
        sdf[y1 * w + x1] * fx * fy;
}

/**
 * True Euclidean distance transform via Danielsson's 8-point vector
 * sweep. Returns a Float32Array where positive = inside the stamp shape,
 * negative = outside, and 0 = on the boundary. Distances are in pixels.
 *
 * Input `pixels` is RGBA from a canvas getImageData; only alpha is read.
 */
export function computeSDF(pixels, w, h) {
    const size = w * h;
    const inX = new Float32Array(size).fill(9999);
    const inY = new Float32Array(size).fill(9999);
    const outX = new Float32Array(size).fill(9999);
    const outY = new Float32Array(size).fill(9999);

    // 1. Initialize boundaries from alpha.
    for (let i = 0; i < size; i++) {
        if (pixels[i * 4 + 3] > 127) {
            inX[i] = 0; inY[i] = 0;
        } else {
            outX[i] = 0; outY[i] = 0;
        }
    }

    // 2. Two-pass Danielsson sweep over each field (in/out).
    function pass(gridX, gridY, startY, endY, stepY, startX, endX, stepX) {
        for (let y = startY; y !== endY; y += stepY) {
            for (let x = startX; x !== endX; x += stepX) {
                const i = y * w + x;
                const check = (dx, dy) => {
                    const nx = x + dx, ny = y + dy;
                    if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                        const idx = ny * w + nx;
                        if (gridX[idx] === 9999) return;
                        const gx = gridX[idx] + Math.abs(dx);
                        const gy = gridY[idx] + Math.abs(dy);
                        const distSq = gx * gx + gy * gy;
                        const curSq = gridX[i] * gridX[i] + gridY[i] * gridY[i];
                        if (distSq < curSq) {
                            gridX[i] = gx;
                            gridY[i] = gy;
                        }
                    }
                };
                if (stepY > 0) {
                    // Forward: TL, T, TR, L
                    check(-1, 0); check(0, -1); check(-1, -1); check(1, -1);
                } else {
                    // Backward: R, B, BR, BL
                    check(1, 0); check(0, 1); check(1, 1); check(-1, 1);
                }
            }
        }
    }

    pass(inX, inY, 0, h, 1, 0, w, 1);
    pass(inX, inY, h - 1, -1, -1, w - 1, -1, -1);
    pass(outX, outY, 0, h, 1, 0, w, 1);
    pass(outX, outY, h - 1, -1, -1, w - 1, -1, -1);

    // 3. Resolve final Euclidean signed distance.
    const dist = new Float32Array(size);
    for (let i = 0; i < size; i++) {
        const dIn = Math.sqrt(inX[i] * inX[i] + inY[i] * inY[i]);
        const dOut = Math.sqrt(outX[i] * outX[i] + outY[i] * outY[i]);
        dist[i] = dOut - dIn;   // + inside, − outside
    }
    return dist;
}

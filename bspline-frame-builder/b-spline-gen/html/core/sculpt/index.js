/**
 * html/core/sculpt/index.js
 * Optimized mathematical implementations for terrain sculpting tools.
 * Z-delta ONLY symmetric sculpting.
 */

// -- Falloff Functions --

/**
 * Standard cosine-based smooth falloff.
 * 1 at centre, 0 at edge.
 */
export function falloff(dist, radius) {
    const t = Math.max(0, Math.min(1, dist / radius));
    const s = t * t * (3 - 2 * t); // smoothstep
    return 1 - s;
}

/**
 * Helper to iterate points within a brush radius.
 */
export function forEachPoint(nx, nz, ci, cj, widthIn, heightIn, radiusIn, callback) {
    const dx = widthIn / (nx - 1);
    const dy = heightIn / (nz - 1);
    const rc = Math.ceil(radiusIn / Math.min(dx, dy)) + 1;

    for (let dj = -rc; dj <= rc; dj++) {
        const nj = cj + dj;
        if (nj < 0 || nj >= nz) continue;
        for (let di = -rc; di <= rc; di++) {
            const ni = ci + di;
            if (ni < 0 || ni >= nx) continue;
            const distIn = Math.hypot(di * dx, dj * dy);
            if (distIn >= radiusIn) continue;
            callback(ni, nj, nj * nx + ni, distIn);
        }
    }
}

// -- Sculpting Tools --

/**
 * Standard Additive Brush (Draw)
 */
export function sculptDraw(delta, nx, nz, ci, cj, widthIn, heightIn, radiusIn, strength) {
    forEachPoint(nx, nz, ci, cj, widthIn, heightIn, radiusIn, (ni, nj, idx, dist) => {
        delta[idx] += strength * falloff(dist, radiusIn);
    });
}

/**
 * Volumetric Expansion Brush (Inflate)
 * Stronger central push with a more "rounded" falloff curve.
 */
export function sculptInflate(delta, nx, nz, ci, cj, widthIn, heightIn, radiusIn, strength) {
    forEachPoint(nx, nz, ci, cj, widthIn, heightIn, radiusIn, (ni, nj, idx, dist) => {
        const t = dist / radiusIn;
        const w = (1 - t * t) ** 2; // Spherical-adjacent falloff
        delta[idx] += strength * w;
    });
}

/**
 * Noise / Perturb Brush
 * Adds surface variation based on a pseudo-random hash of current coordinates.
 */
export function sculptNoise(delta, nx, nz, ci, cj, widthIn, heightIn, radiusIn, strength, noiseScale) {
    forEachPoint(nx, nz, ci, cj, widthIn, heightIn, radiusIn, (ni, nj, idx, dist) => {
        const w = falloff(dist, radiusIn);
        // Pure math pseudo-random "hash" for deterministic-ish noise grain
        const n = (Math.sin(ni * noiseScale) + Math.cos(nj * noiseScale)) * 0.5;
        delta[idx] += n * strength * w;
    });
}

/**
 * Erase / Restore Brush
 * Pulls existing deltas back toward the original base terrain (zero).
 */
export function sculptErase(delta, nx, nz, ci, cj, widthIn, heightIn, radiusIn, strength) {
    forEachPoint(nx, nz, ci, cj, widthIn, heightIn, radiusIn, (ni, nj, idx, dist) => {
        const w = falloff(dist, radiusIn);
        // strength 0.1 means 10% toward zero per stroke iteration
        delta[idx] *= (1 - Math.min(1, strength * w));
    });
}

/**
 * Smoothing Brush (Averages heights)
 */
export function sculptSmooth(delta, absZ, nx, nz, ci, cj, widthIn, heightIn, radiusIn, strength, layer, topHeights) {
    const dx = widthIn / (nx - 1);
    const dy = heightIn / (nz - 1);
    let sumZ = 0, count = 0;
    const pts = [];

    forEachPoint(nx, nz, ci, cj, widthIn, heightIn, radiusIn, (ni, nj, idx, dist) => {
        const w = falloff(dist, radiusIn);
        sumZ += absZ[idx] * w;
        count += w;
        pts.push({ idx, w });
    });

    if (count > 0) {
        const avgZ = sumZ / count;
        for (const p of pts) {
            let mvmnt = (avgZ - absZ[p.idx]) * strength * p.w;
            
            // Re-apply safety check for bottom smoothing
            if (layer === 'bot' && topHeights) {
                const curBot = absZ[p.idx];
                const topZ = topHeights[p.idx];
                if ((curBot + mvmnt) > topZ - 0.001) {
                    mvmnt = (topZ - 0.001) - curBot;
                }
            }
            delta[p.idx] += mvmnt;
        }
    }
}

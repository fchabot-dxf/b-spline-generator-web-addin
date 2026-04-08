/**
 * terrain.js — Three-pass heightmap generation.
 *
 * ES module — imports PerlinNoise from noise.js
 */

import { PerlinNoise } from './noise.js';
import { NoiseModes, NoiseMetadata } from './noise-modes.js';

/**
 * Generate a flat Float32Array[nz × nx] of heights in inches.
 * Index: heights[j * nx + i]  i=col/U/X  j=row/V/Z
 */
export function generateHeightmap(params, stampParams = null) {
  const {
    widthIn        = 9,
    heightIn       = 7,
    carveZ         = 0.5,
    seed           = 42,
    scale          = 1.2,
    macroScale     = 0.35,
    octaves        = 4,
    roughness      = 0.5,
    edgeMargin     = 0,
    symmetry       = 'none',
    noiseType      = 'simplex',
    smoothIntensity = 0,
    smoothRadius   = 1.2,
    nx             = 20,
    nz             = 16,
    warpIntensity  = 1.0,
  } = params;

  const noiseFine   = new PerlinNoise(seed);
  const noiseWarp   = new PerlinNoise(seed ^ 0x9e3779b9);
  const noiseCoarse = new PerlinNoise(seed ^ 0x5f3759df);

  const heights = new Float32Array(nx * nz);
  const aspect  = widthIn / heightIn;

  // ── Pass 1 + 2: fine detail & coarse redistribution ───────────────────────
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
        const u = i / (nx - 1);
        const v = j / (nz - 1);

        let su = u, sv = v;
        if (symmetry === 'x' || symmetry === 'radial') su = Math.abs(su * 2 - 1);
        if (symmetry === 'y' || symmetry === 'radial') sv = Math.abs(sv * 2 - 1);

        // ── Pass 1: Fine Detail (Strategy Pattern) ──
        const modeFunc = NoiseModes[noiseType] || NoiseModes['simplex'];
        const noiseRefs = { noiseFine, noiseWarp, noiseCoarse, rawU: u, rawV: v };
        let fine = modeFunc(su, sv, aspect, params, noiseRefs);

        // ── Detail Modulation (Spatial Density) ──
        let detailIntensity = 1.0;
        if (params.detailDensity < 0.99) {
            let msu = su, msv = sv;
            if (params.detailDensityRespectSymmetry) {
              // Symmetry is already calculated in su, sv
              msu = su; msv = sv;
            } else {
              // If we DON'T respect symmetry for modulation, use raw u, v
              msu = u; msv = v;
            }
            const modFreq = 2.5; // Frequency high enough to create several patches
            // Boost contrast of modulation noise to fill 0..1 range better
            let mVal = (noiseCoarse.fbm(msu * modFreq, msv * modFreq, 2) * 1.5 + 1) * 0.5;
            mVal = Math.max(0, Math.min(1, mVal));
            
            // Map 0..1 density to a threshold that allows detail to appear even at 0.9+
            const threshold = 1.0 - params.detailDensity;
            detailIntensity = smoothstep(threshold - 0.05, threshold + 0.05, mVal);
        }
        
        // Detail Strength (Smooth Area Detail) — how much detail is left in the "smooth" zones
        const effectiveDetail = detailIntensity + (1.0 - detailIntensity) * (params.detailStrength || 0);
        fine = lerp(0.5, fine, effectiveDetail);

        // ── Pass 2: Coarse Redistribution ──────
        const meta = NoiseMetadata[noiseType] || NoiseMetadata['simplex'];
        const cMultiplier = meta.cMultiplier;
        const cFreq = (macroScale || 0.65) * cMultiplier;
        const cx = su * cFreq * aspect;
        const cz = sv * cFreq;
        const coarse = applyContrast((noiseCoarse.fbm(cx + 4.33, cz + 8.77, 2, 2.0, 0.6) + 1) * 0.5, 2.2);

        const LOW = 0.22, PEAK_BASE = 0.58, PEAK_RNG = 0.42;
        let h = lerp(fine * LOW,  PEAK_BASE + fine * PEAK_RNG,  coarse);
        
        const safeMargin = Math.max(0, Math.min(0.49, edgeMargin || 0));
        if (safeMargin > 0) h *= edgeFade(u, safeMargin) * edgeFade(v, safeMargin);

        const finalH = Math.max(0, h) * (carveZ || 0);
        heights[j * nx + i] = isNaN(finalH) ? 0 : finalH;
    }
  }

  // ── Capture unstamped version for export reference ──────────────
  const unstampedHeights = (stampParams && stampParams.mask) ? new Float32Array(heights) : null;

  // ── Vector Stamping (Phase 3) ──
  if (stampParams && stampParams.mask && Math.abs(stampParams.depth) > 0.001) {
    applyVectorDrape(heights, stampParams.mask, stampParams.depth, params.stampProfile);
  }

  // ── Pass 3 — Smooth ──
  if (smoothIntensity > 0 && smoothRadius > 0) {
    const blurred = boxFilter(heights, nx, nz, smoothRadius, widthIn, heightIn);
    const count   = Math.max(2, Math.round(Math.sqrt(widthIn * heightIn) * 1.2));
    
    let centres = lcgPoints(seed ^ 0xdeadbeef, count);
    
    // Respect Symmetry for smoothing centers
    if (params.smoothRespectSymmetry && symmetry !== 'none') {
        const symCentres = [];
        for (const c of centres) {
            symCentres.push(c);
            const mi = 1.0 - c.u, mj = 1.0 - c.v;
            if (symmetry === 'x' || symmetry === 'radial') symCentres.push({ u: mi, v: c.v });
            if (symmetry === 'y' || symmetry === 'radial') symCentres.push({ u: c.u, v: mj });
            if (symmetry === 'radial') symCentres.push({ u: mi, v: mj });
        }
        centres = symCentres;
    }

    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const u = i / (nx - 1), v = j / (nz - 1);
        let maxW = 0;
        for (const c of centres) {
          const du = (u - c.u) * widthIn, dv = (v - c.v) * heightIn;
          const d  = Math.sqrt(du * du + dv * dv);
          if (d < smoothRadius) {
            const w = smoothstep(smoothRadius, 0, d);
            if (w > maxW) maxW = w;
          }
        }
        if (maxW > 0) {
          const idx = j * nx + i;
          heights[idx] = lerp(heights[idx], blurred[idx], maxW * smoothIntensity);
        }
      }
    }
  }

  return { heights, nx, nz, unstampedHeights };
}

function applyVectorDrape(heights, mask, depth, profile = 'vbit') {
    // Safety guard: if the mask doesn't match the current heightmap resolution,
    // skip stamping to avoid NaN corruption until the mask is refreshed.
    if (!mask || mask.length !== heights.length) return;

    // mask[k] is normalized 0..1; the actual signed depth is applied here
    // at render time, so depth slider changes are instant (no re-rasterize needed).
    for (let i = 0; i < heights.length; i++) {
        const m = mask[i];
        if (m < 1e-6) continue;
        heights[i] += m * depth;
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function lerp(a, b, t) { return a + (b - a) * t; }

function applyContrast(h, strength) {
  const x = h * 2 - 1;
  return (Math.sign(x) * Math.pow(Math.abs(x), 1 / strength) + 1) * 0.5;
}

function edgeFade(t, margin) {
  if (t < margin)      return smoothstep(0, margin, t);
  if (t > 1 - margin)  return smoothstep(0, margin, 1 - t);
  return 1;
}

function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function boxFilter(src, nx, nz, radiusIn, widthIn, depthIn) {
  const ri = Math.max(1, Math.round(radiusIn / widthIn * (nx - 1)));
  const rj = Math.max(1, Math.round(radiusIn / depthIn * (nz - 1)));
  const temp = new Float32Array(src.length);
  const dst  = new Float32Array(src.length);

  // Pass 1: X
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
        let sum = 0, n = 0;
        for (let di = -ri; di <= ri; di++) {
            sum += src[j * nx + Math.max(0, Math.min(nx - 1, i + di))];
            n++;
        }
        temp[j * nx + i] = sum / n;
    }
  }
  // Pass 2: Y
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
        let sum = 0, n = 0;
        for (let dj = -rj; dj <= rj; dj++) {
            sum += temp[Math.max(0, Math.min(nz - 1, j + dj)) * nx + i];
            n++;
        }
        dst[j * nx + i] = sum / n;
    }
  }
  return dst;
}

function lcgPoints(seed, count) {
  const pts = [];
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  for (let k = 0; k < count; k++) pts.push({ u: next(), v: next() });
  return pts;
}

export function resolveGrid(widthIn, heightIn, spacingIn) {
  let iv_x_raw = Math.round(widthIn  / spacingIn);
  let iv_z_raw = Math.round(heightIn / spacingIn);
  let iv_x, iv_z, s;
  if (widthIn >= heightIn) {
    iv_x = (spacingIn <= 0.4) ? Math.max(10, Math.round(iv_x_raw / 10) * 10) : Math.max(3, iv_x_raw);
    s    = widthIn / iv_x;
    iv_z = Math.round(heightIn / s);
    if (spacingIn <= 0.4) iv_z = Math.max(4, Math.round(iv_z / 2) * 2);
    else iv_z = Math.max(3, iv_z); 
  } else {
    iv_z = (spacingIn <= 0.4) ? Math.max(10, Math.round(iv_z_raw / 10) * 10) : Math.max(3, iv_z_raw);
    s    = heightIn / iv_z;
    iv_x = Math.round(widthIn / s);
    if (spacingIn <= 0.4) iv_x = Math.max(4, Math.round(iv_x / 2) * 2);
    else iv_x = Math.max(3, iv_x);
  }
  return { nx: Math.max(4, iv_x + 1), nz: Math.max(4, iv_z + 1) };
}

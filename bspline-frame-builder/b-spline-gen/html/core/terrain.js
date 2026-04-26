/**
 * terrain.js — Three-pass heightmap generation.
 *
 * ES module — imports PerlinNoise from noise.js
 */

import { PerlinNoise } from './noise.js';
import { NoiseModes, NoiseMetadata } from './noise/index.js';
import { SeedTypes } from './seed/index.js';

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
    symOffsetX     = 0,
    symOffsetY     = 0,
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

  // Extract the active filter's UI tweaks once. Each mode fn reads
  // params.tweaks?.<key> ?? <default>, so an empty/missing object
  // means "use schema defaults" — behavior identical to pre-tweaks.
  const tweaks = (params.filterTweaks && params.filterTweaks[noiseType]) || {};
  const modeParams = { ...params, tweaks };

  // ── Pass 1 + 2: fine detail & coarse redistribution ───────────────────────
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
        const u = i / (nx - 1);
        const v = j / (nz - 1);

        // Mirror axis can be shifted by symOffsetX/Y. Default 0 = mirror
        // through center (legacy behavior). The fold output is scaled by 2
        // so the noise frequency stays consistent with the un-offset case.
        let su = u, sv = v;
        const mx = 0.5 + symOffsetX;
        const my = 0.5 + symOffsetY;
        if (symmetry === 'x' || symmetry === 'radial') su = Math.abs(u - mx) * 2;
        if (symmetry === 'y' || symmetry === 'radial') sv = Math.abs(v - my) * 2;

        // ── Pass 1: Fine Detail (Strategy Pattern) ──
        // Skeleton-isolation mode bypasses the filter with a flat 0.5,
        // so downstream macro/gate/fade/smooth produce the pure skeleton
        // shape with no filter character mixed in.
        const modeFunc = params.isolateSkeleton
            ? () => 0.5
            : (NoiseModes[noiseType] || NoiseModes['simplex']);
        const noiseRefs = { noiseFine, noiseWarp, noiseCoarse, rawU: u, rawV: v };
        let fine = modeFunc(su, sv, aspect, modeParams, noiseRefs);

        // ── Detail Modulation (Spatial Density) ──
        //   detailDensity   (0..1) spatial mask: 1 = full detail everywhere,
        //                          lower values carve out "smooth" patches.
        //   detailStrength  (0..1) floor for the smooth (empty) zones — controls
        //                          how much detail residue remains where the
        //                          density mask carves out. 0 = fully smooth
        //                          empty zones, 1 = empty zones get full detail
        //                          (effectively cancels the mask).
        //   detailDensityRespectSymmetry — when ON, the spatial mask uses the
        //                          symmetry-folded coords (mask is mirrored).
        //                          Only visible when detailDensity < 1.
        let detailIntensity = 1.0;
        if (params.detailDensity < 0.99) {
            // Use folded coords (msu=su, msv=sv) when respecting symmetry,
            // otherwise raw u,v so the mask breaks symmetry intentionally.
            const msu = params.detailDensityRespectSymmetry ? su : u;
            const msv = params.detailDensityRespectSymmetry ? sv : v;
            const modFreq = 2.5;
            let mVal = (noiseCoarse.fbm(msu * modFreq, msv * modFreq, 2) * 1.5 + 1) * 0.5;
            mVal = Math.max(0, Math.min(1, mVal));
            const threshold = 1.0 - params.detailDensity;
            detailIntensity = smoothstep(threshold - 0.05, threshold + 0.05, mVal);
        }

        // Empty-zone floor: lift the masked-out areas back up by detailStrength.
        // detailIntensity = 1 inside detailed zones (no change), and where the
        // mask carves out (detailIntensity = 0), the floor is detailStrength.
        const strength = (params.detailStrength != null) ? params.detailStrength : 0.25;
        const effectiveDetail = detailIntensity + (1.0 - detailIntensity) * strength;
        fine = lerp(0.5, fine, effectiveDetail);

        // ── Pass 2: Coarse Redistribution ──────
        // Seed (raw pattern) → Skeleton transforms (peakShape, clustering,
        // density, edge fade, smoothing). The seed type is dispatched
        // through SeedTypes; new seed kinds drop into core/seed/ without
        // touching this file.
        const meta = NoiseMetadata[noiseType] || NoiseMetadata['simplex'];
        const cMultiplier = meta.cMultiplier;
        const cFreq = (macroScale || 0.65) * cMultiplier;
        let cx = su * cFreq * aspect;
        let cz = sv * cFreq;

        // Apply seed-panel rotation about the (su, sv) origin BEFORE offset.
        // Keeps "spin the field" predictable: rotate first, then translate.
        const rot = (params.seedRotation || 0) * Math.PI / 180;
        if (rot !== 0) {
          const cs = Math.cos(rot), sn = Math.sin(rot);
          const rx = cx * cs - cz * sn;
          const rz = cx * sn + cz * cs;
          cx = rx; cz = rz;
        }
        // Offset lets the user pan continuously through the seed field.
        // We scale by cFreq so "1 unit of offset" = "pan by one screen-width"
        // — the visible field only spans ~cFreq noise units, so adding raw
        // offset values would jump past Perlin's correlation length almost
        // immediately and feel like switching to a different seed.
        cx += (params.seedOffsetX || 0) * cFreq * aspect;
        cz += (params.seedOffsetY || 0) * cFreq;

        const seedType = params.seedType || 'perlin';
        const seedFn = SeedTypes[seedType] || SeedTypes['perlin'];
        const seedRefs = { noiseCoarse };
        // Peak Shape replaces the legacy hard-coded `2.2` contrast strength.
        // <1 = round/blobby, 2.2 = legacy look, >2.2 = sharper peaks.
        const peakShape = (params.peakShape != null) ? params.peakShape : 2.2;
        let coarse = applyContrast(seedFn(cx, cz, seedRefs), peakShape);

        // Clustering: multiply the coarse field by a low-freq mask so peaks
        // group into clumps. 0 = even distribution (today's behavior),
        // 1 = strongly clustered. Mask runs at a coarser frequency than the
        // main coarse field so its variation reads as "clumps" not "more peaks".
        const clustering = params.clustering || 0;
        if (clustering > 0.001) {
            const clFreq = cFreq * 0.35;
            const cm = (noiseCoarse.fbm(su * clFreq * aspect + 17.7, sv * clFreq + 23.1, 2, 2.0, 0.55) + 1) * 0.5;
            const mask = lerp(1, cm, clustering);
            coarse *= mask;
        }

        // Density: soft threshold gate. 1 = no gating (today's behavior),
        // 0 = silence the whole coarse field. Smoothstep keeps transitions
        // smooth so we don't introduce sharp contour lines into the heightmap.
        const density = (params.density != null) ? params.density : 1.0;
        if (density < 0.999) {
            // Wider band = no pop-in edges. Band is widest near density=0.5
            // (where the most material is in transition) and tapers near 0/1
            // so the extremes stay decisive.
            const threshold = 1.0 - density;
            const band = 0.10 + 0.20 * (1.0 - Math.abs(density - 0.5) * 2.0);
            const mask = smoothstep(threshold - band, threshold + band, coarse);
            coarse = mask * coarse;
        }

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
    
    // Respect Symmetry for smoothing centers (also honors symOffsetX/Y).
    if (params.smoothRespectSymmetry && symmetry !== 'none') {
        const symCentres = [];
        const mxL = 0.5 + symOffsetX;
        const myL = 0.5 + symOffsetY;
        for (const c of centres) {
            symCentres.push(c);
            const mi = 2 * mxL - c.u;
            const mj = 2 * myL - c.v;
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
  // Smooth S-curve, no cusp at midline. The previous formulation used
  // Math.pow(|x|, 1/strength) which has an infinite slope at x=0 — every
  // time the seed value crossed 0.5 it baked a sharp ledge into the
  // heightfield, showing up as parallel grooves on slopes (worst on
  // Ridged seeds where zero-crossings are dense).
  //
  // This rational sigmoid is C^∞ everywhere, identity at strength=1,
  // and visually matches the old curve's character for strength 1.5..4.
  if (Math.abs(strength - 1.0) < 1e-4) return h;
  const x = h * 2 - 1;            // [-1, 1]
  const k = strength - 1.0;       // 0 = identity, > 0 = S-curve
  const y = x * (1 + k) / (1 + k * x * x);
  return y * 0.5 + 0.5;
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

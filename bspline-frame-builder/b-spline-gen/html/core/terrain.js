/**
 * terrain.js — Three-pass heightmap generation.
 *
 * ES module — imports PerlinNoise from noise.js
 */

import { PerlinNoise } from './noise.js';
import { NoiseModes, NoiseMetadata } from './noise/index.js';
import { SeedTypes } from './seed/index.js';

// 2026-10-10 (seat A + seat D: the on-board photo footprint and the photo preview's "not sampled" overlay): the board
// -> sample mapping generateHeightmap uses (Map Zoom + Map Offset, then the Symmetry fold), exported ONCE so both read
// it instead of a copy. Its constants are cached on the params object (a heightmap passes the same one throughout).
let _fold = null;
function foldSpecOf(params) {
  if (_fold && _fold.params === params) return _fold;
  const { mapZoom = 1, seedOffsetX = 0, seedOffsetY = 0, symmetry = 'none', symOffsetX = 0, symOffsetY = 0 } = params;
  _fold = { params, mapZoom, seedOffsetX, seedOffsetY, mx: 0.5 + symOffsetX, my: 0.5 + symOffsetY,
    fx: symmetry === 'x' || symmetry === 'radial', fy: symmetry === 'y' || symmetry === 'radial' };
  return _fold;
}
/** Board fraction (u, v) -> { zu, zv } (zoomed + panned) and { su, sv } (folded by Symmetry): what the filters sample.
 *  `out` is filled and returned (the heightmap loop reuses one; omitted, a new object). */
export function foldUV(u, v, params, out = {}) {
  const f = foldSpecOf(params);
  // H17 items 1-3: zoom about the board centre, the pan added BEFORE the zoom divide (see generateHeightmap's loop)
  const zu = 0.5 + (u - 0.5 + f.seedOffsetX) / f.mapZoom;
  const zv = 0.5 + (v - 0.5 + f.seedOffsetY) / f.mapZoom;
  out.zu = zu; out.zv = zv;
  // the mirror axis shifted by symOffsetX/Y; the fold scaled by 2 keeps the noise frequency of the un-offset case
  out.su = f.fx ? Math.abs(zu - f.mx) * 2 : zu;
  out.sv = f.fy ? Math.abs(zv - f.my) * 2 : zv;
  // 2026-10-10 (Fred: "the photo shouldn't be squeezed by default"): the TRUE mirror -- no x2, the far side reflected
  // onto the source side (past the axis), like a mirror held to the print. The photo layer samples this in its 'mirror'
  // mode (P.photoMirrorMode); procedural filters keep su / sv.
  out.mu = f.fx ? f.mx + Math.abs(zu - f.mx) : zu;
  out.mv = f.fy ? f.my + Math.abs(zv - f.my) : zv;
  return out;
}
/** The inverse, per mirror copy: a sample point (su, sv) -> the board fraction (u, v) it shows at. `sx` / `sy` (+1 / -1)
 *  pick the copy on a folded axis (+1 = the source side, past the mirror axis); unfolded axes ignore them.
 *  `mirror` true: (su, sv) are the true-mirror coordinates (mu, mv) instead. */
export function unfoldUV(su, sv, params, sx = 1, sy = 1, mirror = false) {
  const f = foldSpecOf(params);
  const zu = f.fx ? f.mx + sx * (mirror ? su - f.mx : su / 2) : su;
  const zv = f.fy ? f.my + sy * (mirror ? sv - f.my : sv / 2) : sv;
  return { u: 0.5 + (zu - 0.5) * f.mapZoom - f.seedOffsetX, v: 0.5 + (zv - 0.5) * f.mapZoom - f.seedOffsetY };
}
/** The photo layer under Symmetry, one row per P.photoMirrorMode (core/state.js):
 *  `coords` -- which fold the photo samples: 'fold' (su / sv, the x2 fold) or 'mirror' (mu / mv, the true mirror);
 *  `halfAspect` -- the photo is cover-fitted to the SOURCE half (its own proportions), not to the whole board.
 *  'squeeze': the whole photo squeezed into each half (every board before 2026-10-10; byte-identical).
 *  'mirror': the photo placed over the whole board, its source half kept and mirrored (boards saved 2026-10-10).
 *  'whole' (Fred, 2026-10-10: "the symmetry should still sample the whole image ... it would simply extend toward the
 *  axis side with the mirror"): the WHOLE photo, unsqueezed, on the source half; the mirror reflects it across the axis.
 *  A params object without the key (or an unknown value) reads as 'squeeze'. */
export const PHOTO_MIRROR_MODES = Object.freeze({
  squeeze: Object.freeze({ coords: 'fold', halfAspect: false }),
  mirror: Object.freeze({ coords: 'mirror', halfAspect: false }),
  whole: Object.freeze({ coords: 'fold', halfAspect: true }),
});
export const photoMirrorModeOf = (params) => PHOTO_MIRROR_MODES[params.photoMirrorMode] || PHOTO_MIRROR_MODES.squeeze;
/** True when the photo samples the true-mirror coordinates (mu / mv). */
export const photoMirrors = (params) => photoMirrorModeOf(params).coords === 'mirror';
/** The aspect the photo's sample space has: the board's, or the source half's ('whole': a fold spans half an axis). */
export function photoSampleAspect(params, aspect) {
  if (!photoMirrorModeOf(params).halfAspect) return aspect;
  const f = foldSpecOf(params);
  return aspect * (f.fx ? 0.5 : 1) / (f.fy ? 0.5 : 1);
}

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
    mapZoom        = 1,
    seedOffsetX    = 0,
    seedOffsetY    = 0,
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
  // Skeleton-isolation mode bypasses the filter with a flat 0.5, so downstream macro/gate/fade/smooth produce the pure
  // skeleton shape with no filter character mixed in. Picked ONCE, and one noiseRefs object (rawU/rawV set per sample)
  // -- seat D 2026-10-08: both were built per sample (~190k per 384-wide editor backdrop, repainted on every Photo-tab
  // drag tick); the output is unchanged (tests/heightmap-golden.test.js).
  const modeFunc = params.isolateSkeleton
      ? () => 0.5
      : (NoiseModes[noiseType] || NoiseModes['simplex']);
  const noiseRefs = { noiseFine, noiseWarp, noiseCoarse, rawU: 0, rawV: 0 };
  // 2026-10-10 (Fred: the photo as its own LAYER on top of the chosen filter, "how much of the filter transpires"): with
  // P.photoLayer on, the fine value is the PHOTO, plus the board's filter normalised by its declared span
  // (NoiseMetadata nominalRange, about 0..1 like the photo) around its middle, times "Filter shows through"
  // (photoFilterAmount, 0..100 %). At 0 % the filter is not sampled at all: the fine value is the photo's own -- exactly
  // what a board on the old Photo filter gave. Everything after (detail, the coarse pass, carve depth) is as before.
  // "Hide filter texture" (isolateSkeleton) hides the FILTER -- with the photo layer, no filter share at all (its flat
  // 0.5 would still add a constant offset once normalised); the photo layer stays.
  const photoLayer = !!params.photoLayer;
  const photoParams = photoLayer ? { ...params, tweaks: (params.filterTweaks && params.filterTweaks.photo) || {} } : null;
  const filterShare = (photoLayer && !params.isolateSkeleton) ? Math.max(0, Math.min(100, Number(params.photoFilterAmount) || 0)) / 100 : 0;
  const [rangeLo, rangeHi] = (NoiseMetadata[noiseType] || NoiseMetadata['simplex']).nominalRange || [0, 1];
  const rangeSpan = (rangeHi - rangeLo) || 1;

  const folded = { zu: 0, zv: 0, su: 0, sv: 0, mu: 0, mv: 0 }; // foldUV's output, one object for the whole heightmap
  const photoMirror = photoLayer && photoMirrors(params); // the photo's true mirror (no squeeze), when declared
  const photoAspect = photoLayer ? photoSampleAspect(params, aspect) : aspect; // 'whole': the source half's own proportions

  // ── Pass 1 + 2: fine detail & coarse redistribution ───────────────────────
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
        const u = i / (nx - 1);
        const v = j / (nz - 1);

        // H17 item 1 -- Map Zoom: a drawing-style zoom of the whole
        // generated terrain, centred on the board. Remapped ONCE here, at
        // the sampler's (u,v) entry, so every downstream layer that reads
        // su/sv (fine noise, detail/cluster masks, coarse redistribution)
        // scales together as one drawing. `u`/`v` themselves are left
        // UNCHANGED below (edgeFade, Pass 3 smoothing, applyVectorDrape all
        // intentionally still read the real board position) -- stamps,
        // sculpt, the frame, edge fade and the board itself must not zoom.
        // H17 item 2 (Fred: "the seed offset isnt what i wanted" -> "pan
        // the whole map"): seedOffsetX/Y moved to this SAME entry point --
        // previously they only shifted the coarse layer (cx/cz below),
        // which panned the coarse SHAPE over a static fine texture instead
        // of sliding the whole drawing. Added here instead, they're baked
        // into su/sv before either the fine noise call or the coarse cx/cz
        // math sees them, so fine texture and coarse shapes pan together.
        // H17 item 3 (spec of item 2, missed): the offset must be added
        // BEFORE dividing by mapZoom, not after -- otherwise it keeps its
        // zoom=1 magnitude while the visible window shrinks around it, so
        // at zoom 2 an offset of 0.5 was already panning a full (zoomed)
        // screen instead of half one. Added inside the division, "1 unit of
        // offset" is always exactly one board-width at the CURRENT zoom.
        // Mirror axis can be shifted by symOffsetX/Y. Default 0 = mirror
        // through center (legacy behavior). The fold output is scaled by 2
        // so the noise frequency stays consistent with the un-offset case.
        // 2026-10-10: both steps are foldUV (above), the ONE copy the photo footprint / overlay read too.
        foldUV(u, v, params, folded);
        const zu = folded.zu, zv = folded.zv, su = folded.su, sv = folded.sv;

        // ── Pass 1: Fine Detail (Strategy Pattern; modeFunc / noiseRefs above the loop) ──
        noiseRefs.rawU = u; noiseRefs.rawV = v;
        let fine;
        if (photoLayer) {
            fine = photoMirror ? NoiseModes.photo(folded.mu, folded.mv, photoAspect, photoParams, noiseRefs) : NoiseModes.photo(su, sv, photoAspect, photoParams, noiseRefs);
            if (filterShare > 0) fine += ((modeFunc(su, sv, aspect, modeParams, noiseRefs) - rangeLo) / rangeSpan - 0.5) * filterShare;
        } else {
            fine = modeFunc(su, sv, aspect, modeParams, noiseRefs);
        }

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
            // otherwise zoomed-but-unfolded zu,zv so the mask breaks symmetry
            // intentionally (still zoomed -- it's part of the drawing).
            const msu = params.detailDensityRespectSymmetry ? su : zu;
            const msv = params.detailDensityRespectSymmetry ? sv : zv;
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

        // Apply seed-panel rotation about the (su, sv) origin. (H17 item 2:
        // seedOffsetX/Y no longer apply here -- they're baked into su/sv
        // upstream, at the zu/zv pan -- so this only ever rotates the
        // already-panned coordinate. seedRotation's own UI stays removed
        // per H16 item 4, so params.seedRotation is always 0 in practice.)
        const rot = (params.seedRotation || 0) * Math.PI / 180;
        if (rot !== 0) {
          const cs = Math.cos(rot), sn = Math.sin(rot);
          const rx = cx * cs - cz * sn;
          const rz = cx * sn + cz * cs;
          cx = rx; cz = rz;
        }
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
  // Every cell is still 0 + its window's values in ascending offset order, then / (2r + 1): the same double additions,
  // the same result to the bit (2026-10-08: the interior skips the edge clamp; pass 2 sums whole rows into a double
  // accumulator, offset by offset, instead of striding down a column per cell -- MEASURED 15 - 40% faster).
  const nI = 2 * ri + 1, nJ = 2 * rj + 1;

  // Pass 1: X
  for (let j = 0; j < nz; j++) {
    const row = j * nx;
    for (let i = 0; i < nx; i++) {
        let sum = 0;
        if (i - ri >= 0 && i + ri <= nx - 1) {
            for (let di = -ri; di <= ri; di++) sum += src[row + i + di];
        } else {
            for (let di = -ri; di <= ri; di++) sum += src[row + Math.max(0, Math.min(nx - 1, i + di))];
        }
        temp[row + i] = sum / nI;
    }
  }
  // Pass 2: Y
  const acc = new Float64Array(nx);
  for (let j = 0; j < nz; j++) {
    acc.fill(0);
    for (let dj = -rj; dj <= rj; dj++) {
        const r = Math.max(0, Math.min(nz - 1, j + dj)) * nx;
        for (let i = 0; i < nx; i++) acc[i] += temp[r + i];
    }
    const row = j * nx;
    for (let i = 0; i < nx; i++) dst[row + i] = acc[i] / nJ;
  }
  return dst;
}

// SE7b: exported so editor-lattice-pattern.js reuses this RNG instead of
// hand-rolling a second one (independent {u,v} draws — the right shape for
// discrete per-column tie decisions, unlike PerlinNoise's spatially-
// correlated continuous field). See SE7B-PATTERN-GENERATOR-DESIGN.md.
export function lcgPoints(seed, count) {
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

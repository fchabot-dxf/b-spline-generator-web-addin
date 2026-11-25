/**
 * terrain.js — Three-pass heightmap generation.
 *
 * ES module — imports PerlinNoise from noise.js
 */

import { PerlinNoise } from './noise.js';
import { NoiseModes, NoiseMetadata } from './noise/index.js';
import { SeedTypes } from './seed/index.js';
import { bandActive, bandWeightGrid, bandLevelIn, BAND_APPLIES_TO, BAND_APPLIES_DEFAULT } from './flatten-band.js';

// The board -> sample mapping generateHeightmap uses (Map Zoom + Map Offset, then the Symmetry fold). Its constants are
// cached on the params object (a heightmap passes the same one throughout).
let _fold = null;
export function foldSpecOf(params) {
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
  return out;
}
/** TERRAIN FIT (Fred 2026-11-23, "Relief fills it"): P.terrainFit 'fill' (a NEW board's default) fits the generated terrain
 *  (shape + texture, before stamps, layers, sculpt and Thicken) so its lowest point is 0 and its highest carveZ. The range is
 *  measured on ONE reference sampling of the terrain -- `intervals` steps across the board on each axis, whatever grid is
 *  being built -- so the preview, the Send grid and the editor backdrop all get the same map (a grid's own min / max would
 *  differ from grid to grid). Any other value / absent ('legacy', every board saved before) = heights max(0, h) * carveZ. */
//  `intervals`: the reference grid ((intervals + 1)^2 points over the board). Then the `candidates` lowest local minima and
//  highest local maxima of that grid are each refined: `steps` x `steps` points across +-1 reference cell around it, then
//  again across +-1/(steps/2) cell around the best -- so the range is the terrain's own (to a few 1e-5 of it), not one grid's.
export const TERRAIN_FIT_REF = Object.freeze({ intervals: 320, candidates: 8, steps: 9 });
export const terrainFills = (params) => params.terrainFit === 'fill' && params.shapeFlat !== true;

/** The generated terrain's [lowest, highest] value per inch of carve depth (max(0, h), Passes 1 + 2), from the reference
 *  sampling (TERRAIN_FIT_REF). Depends on the terrain's own settings only, never on the caller's nx / nz. */
export function terrainFitRange(params) {
  // the last range is reused while every other setting is the same: a carve depth or smoothing change, or another grid, keeps
  // it (the sampler never reads them). A long text value (the drawing's SVG) is left out of the key -- no terrain setting is one.
  let key = null;
  try {
    key = JSON.stringify(params, function (k, v) {
      if (this !== params) return v;
      if (k === 'nx' || k === 'nz' || k === 'carveZ' || k === 'terrainFit' || k === 'terrainFloorIn' || k === 'smoothIntensity' || k === 'smoothRadius' || k === 'smoothRespectSymmetry') return undefined;
      if (k === 'thickness' || k === 'thickenEnabled' || k === 'thickenDir' || k === 'backMode') return undefined; // the back: the floor only
      if (k.startsWith('band')) return undefined; // the FLATTEN BAND (core/flatten-band.js) applies after the fit: never its range
      return typeof v === 'string' && v.length > 512 ? undefined : v;
    });
  } catch (_) { key = null; }
  if (key !== null && _fitMemo && _fitMemo.key === key) return _fitMemo.range.slice();
  const range = _terrainFitRange(params);
  if (key !== null) _fitMemo = { key, range: range.slice() };
  return range;
}
let _fitMemo = null;
function _terrainFitRange(params) {
  const { intervals: R, candidates: K, steps: S } = TERRAIN_FIT_REF;
  const n = R + 1;
  const { sample } = makeTerrainSampler({ ...params, nx: n, nz: n });
  const val = (u, v) => { const h = Math.max(0, sample(u, v)); return isNaN(h) ? 0 : h; }; // generateHeightmap's own value
  const vals = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) vals[j * n + i] = val(i / R, j / R);
  // the K highest local maxima (sign 1) / lowest local minima (sign -1) of the grid
  const extremes = (sign) => {
    const best = []; // [score, i, j], best first
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const s = sign * vals[j * n + i];
      if (best.length === K && s <= best[K - 1][0]) continue;
      let peak = true;
      for (let dj = -1; dj <= 1 && peak; dj++) for (let di = -1; di <= 1; di++) {
        const a = i + di, b = j + dj;
        if ((di || dj) && a >= 0 && a < n && b >= 0 && b < n && sign * vals[b * n + a] > s) { peak = false; break; }
      }
      if (!peak) continue;
      let at = best.length; while (at > 0 && best[at - 1][0] < s) at--;
      best.splice(at, 0, [s, i, j]);
      if (best.length > K) best.pop();
    }
    let top = -Infinity;
    for (const [, i, j] of best) {
      let u0 = i / R, v0 = j / R, s0 = sign * val(u0, v0);
      for (const reach of [1 / R, 2 / (R * (S - 1))]) { // +-1 cell, then +-1/(steps/2) cell round the best so far
        const cu = u0, cv = v0;
        for (let b = 0; b < S; b++) for (let a = 0; a < S; a++) {
          const u = Math.min(1, Math.max(0, cu + reach * (2 * a / (S - 1) - 1))); // inside the board (the sample domain)
          const v = Math.min(1, Math.max(0, cv + reach * (2 * b / (S - 1) - 1)));
          const s = sign * val(u, v);
          if (s > s0) { s0 = s; u0 = u; v0 = v; }
        }
      }
      if (s0 > top) top = s0;
    }
    return sign * top;
  };
  return [extremes(-1), extremes(1)];
}

/** The terrain's Passes 1 + 2 at one board point: `sample(u, v)` (u, v in 0..1) -> the raw value h (hills: before max(0, h)
 *  * carveZ; Flat (no hills): the grain g, before max(0, g) * carveZ + the surface height). generateHeightmap reads it at its
 *  grid points; terrainFitRange at the reference sampling. */
function makeTerrainSampler(params) {
  const {
    widthIn        = 9,
    heightIn       = 7,
    seed           = 42,
    macroScale     = 0.35,
    edgeMargin     = 0,
    noiseType      = 'simplex',
  } = params; // (the sampler never reads carveZ, the smoothing or the grid size: terrainFitRange's memo relies on it)

  const noiseFine   = new PerlinNoise(seed);
  const noiseWarp   = new PerlinNoise(seed ^ 0x9e3779b9);
  const noiseCoarse = new PerlinNoise(seed ^ 0x5f3759df);

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
  // TERRAIN-FLAT (Fred 2026-11-22, TERRAIN-FLAT-DESIGN.md): TERRAIN SHAPE's 'Flat (no hills)' (P.shapeFlat) drops the coarse
  // layer -- the board is a flat base at P.surfaceHeightIn (inches) with the TEXTURE on top, at the amplitude it has in
  // today's valleys: height = surfaceHeightIn + (isolateSkeleton ? 0 : fine * LOW * carveZ). The Flat Border fades only
  // that grain toward the surface height; Pass 3 smoothing smooths the result (an exactly flat board stays exactly flat).
  // Off (absent on every board saved before) = the formula below, untouched (tests/terrain-flat.test.js pins).
  const shapeFlat = params.shapeFlat === true;
  const surfaceZ = shapeFlat ? (Number(params.surfaceHeightIn) || 0) : 0;
  const LOW = 0.22, PEAK_BASE = 0.58, PEAK_RNG = 0.42; // the valley / peak shares of the fine value (Pass 2 below)

  const folded = { zu: 0, zv: 0, su: 0, sv: 0 }; // foldUV's output, one object for the whole heightmap
  // FLATTEN BAND (core/flatten-band.js): `last.flatGrain` = the 'Flat (no hills)' grain g at the last sampled point, written
  // when the caller asks (`wantGrain`) -- the band's flat is that formula at the band's own height
  const last = { flatGrain: 0 };

  // ── Pass 1 + 2: fine detail & coarse redistribution, at one point ─────────
  // `texFlat` (0..1, the FLATTEN BAND's texture weight here; 0 = absent = today's sample to the bit): the fine grain is
  // flattened toward neutral by it -- 1 = Texture Strength 0 at this point.
  const sample = (u, v, texFlat = 0, wantGrain = false) => {

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
        // Both steps are foldUV (above).
        foldUV(u, v, params, folded);
        const zu = folded.zu, zv = folded.zv, su = folded.su, sv = folded.sv;

        // ── Pass 1: Fine Detail (Strategy Pattern; modeFunc / noiseRefs above the loop) ──
        noiseRefs.rawU = u; noiseRefs.rawV = v;
        // Fred 2026-11-23 ("Remove photo"): the photo layer is gone; a saved board's leftover photo keys (photoLayer, ...)
        // are not read -- it builds as it did with its photo off (main/app-init.js MIGRATIONS 'photo-removed')
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
        // Texture Strength (Fred 2026-11-23): 1 / absent = untouched (bit-identical); 0 = the 'Flat (no texture)' value.
        const texS = (params.textureStrength != null) ? params.textureStrength : 1;

        const safeMargin = Math.max(0, Math.min(0.49, edgeMargin || 0));

        // ── Flat (no hills): no coarse pass -- the grain alone, from the surface height ──
        if (shapeFlat || wantGrain) {
            let g = params.isolateSkeleton ? 0 : fine * LOW;
            if (texS !== 1 && !params.isolateSkeleton) g *= texS; // the grain scales by the strength (0 = exactly Flat)
            if (texFlat > 0) g *= 1 - texFlat; // the FLATTEN BAND's texture: toward flat like Texture Strength
            if (safeMargin > 0) g *= edgeFade(u, safeMargin) * edgeFade(v, safeMargin);
            last.flatGrain = g;
            if (shapeFlat) return g; // generateHeightmap: surface height + max(0, g) * carveZ
        }

        if (texS !== 1) fine = lerp(0.5, fine, texS); // hills: the fine value toward the flat 0.5 (isolateSkeleton's value)
        if (texFlat > 0) fine = texFlat >= 1 ? 0.5 : lerp(fine, 0.5, texFlat); // the FLATTEN BAND's texture (1 = Strength 0)

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

        let h = lerp(fine * LOW,  PEAK_BASE + fine * PEAK_RNG,  coarse);

        if (safeMargin > 0) h *= edgeFade(u, safeMargin) * edgeFade(v, safeMargin);
        return h;
  };
  return { sample, shapeFlat, surfaceZ, last };
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
    symmetry       = 'none',
    symOffsetX     = 0,
    symOffsetY     = 0,
    smoothIntensity = 0,
    smoothRadius   = 1.2,
    nx             = 20,
    nz             = 16,
  } = params;

  const heights = new Float32Array(nx * nz);
  const { sample, shapeFlat, surfaceZ, last } = makeTerrainSampler(params);
  // TERRAIN FIT 'fill' (TERRAIN_FIT_REF above): the reference range [lo, hi] maps onto 0..carveZ; a terrain with no range
  // (hi === lo) is left as built. Not on Flat (no hills): that shape is a flat base at its surface height plus grain.
  const fitRange = terrainFills(params) ? terrainFitRange(params) : null;
  const fitLo = fitRange && fitRange[1] > fitRange[0] ? fitRange[0] : null;
  const fitSpan = fitLo === null ? 1 : fitRange[1] - fitRange[0];
  // the FILL FLOOR (Fred 2026-11-23): the height the lowest point maps to -- the body's bottom clearance under the terrain,
  // decided by the caller from the back (core/engine/build-thicken-data.js fillFloorIn); absent = 0. The highest stays carveZ.
  const fitFloor = Number(params.terrainFloorIn) || 0;
  // FLATTEN BAND (core/flatten-band.js): its weight per point (null = off / no point in reach = the loop below as before).
  // Applied here, after the fit and before stamps, layers, smoothing and Thicken -- like the terrain itself.
  const band = bandActive(params) ? bandWeightGrid(params, nx, nz) : null;
  const bandParts = band ? (BAND_APPLIES_TO[params.bandAppliesTo] || BAND_APPLIES_TO[BAND_APPLIES_DEFAULT]) : null;
  const bandLevel = band ? bandLevelIn(params) : 0;

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
        const u = i / (nx - 1);
        const v = j / (nz - 1);
        const w = band ? band[j * nx + i] : 0;
        const wTex = w > 0 && bandParts.texture ? w : 0;
        const wShape = w > 0 && bandParts.shape ? w : 0;
        const h = wTex > 0 || wShape > 0 ? sample(u, v, wTex, wShape > 0) : sample(u, v);
        let H;
        if (shapeFlat) { // Flat (no hills): the grain alone, from the surface height
            const grainH = Math.max(0, h) * (carveZ || 0);
            H = surfaceZ + (isNaN(grainH) ? 0 : grainH);
        } else {
            const finalH = fitLo === null ? Math.max(0, h) * (carveZ || 0) : fitFloor + (Math.max(0, h) - fitLo) / fitSpan * ((carveZ || 0) - fitFloor);
            H = isNaN(finalH) ? 0 : finalH;
        }
        if (wShape > 0) { // the band's flat: 'Flat (no hills)' at the band's height (its grain gone where TEXTURE is flattened)
            const gH = Math.max(0, last.flatGrain) * (carveZ || 0);
            const flat = bandLevel + (isNaN(gH) ? 0 : gH);
            H = wShape >= 1 ? flat : H + (flat - H) * wShape;
        }
        heights[j * nx + i] = H;
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

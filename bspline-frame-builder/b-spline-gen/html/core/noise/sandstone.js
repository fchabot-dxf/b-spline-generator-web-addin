/**
 * Sandstone Waves 🏜️
 * Smooth rolling hills with soft strata ribs that follow the hills' own
 * contours, like wind-cut sandstone layers. Ported from Fred-approved
 * prototype N1_protoStrata.js (C:/Users/danse/.bspline-status/proto-filters/,
 * approved look at seed 42: ids/N1_Sandstone_Waves.png) — kept the exact
 * math at default tweak values, only exposed the 3 knobs the dispatch
 * named and dropped the unused `octaves` destructure (params.octaves is
 * undefined in-app; the prototype never actually read it, hardcoding a
 * fixed octave count in each fbm call instead).
 *
 * Composition:
 *   1. Base hills  — warped FBM, the same "Smooth Hills" character as the
 *                    other rolling-terrain filters.
 *   2. Strata ribs — a cosine band whose phase is base-height × layer
 *                    count, so the ribs bend to follow the hills' own
 *                    contour lines rather than running in flat parallel
 *                    stripes.
 */
export const id = 'sandstone';
export const label = 'Sandstone Waves';
export const cMultiplier = 2.5;

export const tweaks = [
  { key: 'layerCount',   label: 'Layer Count',   default: 11,   min: 4,   max: 24,  step: 1,     desc: 'Number of strata ribs following the hill contours' },
  { key: 'layerDepth',   label: 'Layer Depth',   default: 0.06, min: 0.02, max: 0.15, step: 0.005, desc: 'How strongly the strata ribs carve into the base hill' },
  { key: 'hillSoftness', label: 'Hill Softness', default: 1.0,  min: 0.4, max: 3.0, step: 0.1,   desc: 'Higher = softer, wider strata bands' },
];

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, roughness, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const layerCount   = t.layerCount   ?? 11;
  const layerDepth   = t.layerDepth   ?? 0.06;
  const hillSoftness = t.hillSoftness ?? 1.0;

  const f = scale * 1.6;
  const x = su * f * aspect, z = sv * f;
  const wa = 0.6 * warpIntensity;
  const wx = noiseWarp.noise2(x * 0.4 + 3.1, z * 0.4 + 7.4) * wa;
  const wz = noiseWarp.noise2(x * 0.4 + 8.6, z * 0.4 + 1.3) * wa;
  const base = (noiseFine.fbm(x + wx, z + wz, 3, 2.0, roughness) + 1) * 0.5;

  // Strata: ribs that follow the hills' own contours, spacing breathes a little.
  const layers = layerCount + 3 * noiseWarp.noise2(x * 0.25 + 11, z * 0.25 + 5);
  const ph = base * layers;
  const rib = 0.5 - 0.5 * Math.cos(2 * Math.PI * ph);
  const soft = Math.pow(rib, 1.6 / hillSoftness);
  const fade = 0.55 + 0.45 * noiseWarp.noise2(x * 0.3 + 2, z * 0.3 + 9);
  return base * 0.85 + soft * layerDepth * fade;
};

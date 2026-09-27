/**
 * Eroded Hills 🏞️
 * Smooth rolling hills with soft branching gullies running down the
 * slopes. Ported from Fred-approved prototype N4_protoEroded.js
 * (C:/Users/danse/.bspline-status/proto-filters/, approved look at seed
 * 42: ids/N4_Eroded_Hills.png) — kept the exact math at default tweak
 * values, only exposed the 3 knobs the dispatch named and dropped the
 * unused `octaves` destructure (params.octaves is undefined in-app; the
 * prototype never actually read it).
 *
 * Composition:
 *   1. Base hills — warped FBM, the same "Smooth Hills" character as the
 *                   other rolling-terrain filters.
 *   2. Gullies    — 3 octaves of ridge-noise (`1 - |n| * density`, clamped
 *                   and powered so only near-zero noise crossings carve a
 *                   thin channel), carved into the base and weighted so
 *                   they bite deeper into steeper slopes than flat ground.
 */
export const id = 'eroded';
export const label = 'Eroded Hills';
export const cMultiplier = 2.5;

export const tweaks = [
  { key: 'gullyDepth',   label: 'Gully Depth',   default: 0.07, min: 0.02, max: 0.15, step: 0.005, desc: 'How strongly gullies carve into the base terrain' },
  { key: 'gullyDensity', label: 'Gully Density', default: 5,    min: 2,   max: 10,  step: 0.5,   desc: 'Higher = narrower, more finely-carved gully channels' },
  { key: 'slopeBias',    label: 'Slope Bias',    default: 0.65, min: 0,   max: 1,   step: 0.05,  desc: 'How much gullies favour steep slopes over flat ground' },
];

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, roughness, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const gullyDepth   = t.gullyDepth   ?? 0.07;
  const gullyDensity = t.gullyDensity ?? 5;
  const slopeBias    = t.slopeBias    ?? 0.65;

  const f = scale * 1.5;
  const x = su * f * aspect, z = sv * f;
  const wa = 0.5 * warpIntensity;
  const wx = noiseWarp.noise2(x * 0.45 + 3.1, z * 0.45 + 7.4) * wa;
  const wz = noiseWarp.noise2(x * 0.45 + 8.6, z * 0.45 + 1.3) * wa;
  const base = (noiseFine.fbm(x + wx, z + wz, 3, 2.0, roughness) + 1) * 0.5;

  let g = 0, amp = 1, fr = 1.6;
  for (let o = 0; o < 3; o++) {
    const n = noiseWarp.noise2((x + wx * 2) * fr + o * 17, (z + wz * 2) * fr + o * 31);
    g += Math.pow(Math.max(0, 1 - Math.abs(n) * gullyDensity), 2.2) * amp;
    amp *= 0.5; fr *= 2.1;
  }
  const slope = Math.min(1, Math.max(0, (base - 0.25) * 2));
  return base - g * gullyDepth * ((1 - slopeBias) + slopeBias * slope);
};

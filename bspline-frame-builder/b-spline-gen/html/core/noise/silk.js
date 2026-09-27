/**
 * Draped Silk 🎗️
 * Big soft swells with long flowing cloth folds draped across them.
 * Ported from Fred-approved prototype N2_protoSilk.js
 * (C:/Users/danse/.bspline-status/proto-filters/, approved look at seed
 * 42: ids/N2_Draped_Silk.png) — kept the exact math at default tweak
 * values, only exposed the 3 knobs the dispatch named and dropped the
 * unused `octaves` destructure (params.octaves is undefined in-app; the
 * prototype never actually read it).
 *
 * Composition:
 *   1. Base swells — soft low-octave FBM, the big underlying shape the
 *                    "cloth" is draped over.
 *   2. Fold sweep  — the fold direction drifts slowly across the board
 *                    (per-region angle) and bends (a warped-noise offset
 *                    added to the fold phase), so folds curve rather than
 *                    running dead straight.
 *   3. Fold profile — a cosine band across the (rotated) fold axis, with
 *                    a soft amplitude mask so folds fade in and out.
 */
export const id = 'silk';
export const label = 'Draped Silk';
export const cMultiplier = 2.5;

export const tweaks = [
  { key: 'foldSpacing', label: 'Fold Spacing', default: 1.0,  min: 0.5, max: 2.5, step: 0.05, desc: 'Higher = folds spaced farther apart' },
  { key: 'foldDepth',   label: 'Fold Depth',   default: 0.35, min: 0.15, max: 0.6, step: 0.02, desc: 'How strongly the folds carve relative to the base swells' },
  { key: 'foldSweep',   label: 'Fold Sweep',   default: 1.6,  min: 0.0, max: 3.0, step: 0.1,  desc: 'How much the fold direction bends and curves across the board' },
];

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, roughness, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const foldSpacing = t.foldSpacing ?? 1.0;
  const foldDepth   = t.foldDepth   ?? 0.35;
  const foldSweep   = t.foldSweep   ?? 1.6;

  const f = scale * 1.2;
  const x = su * f * aspect, z = sv * f;
  const base = (noiseFine.fbm(x, z, 2, 2.0, roughness) + 1) * 0.5;

  // Fold direction drifts slowly over the board -> folds sweep and bend.
  const ang = 0.9 + 1.4 * noiseWarp.noise2(x * 0.18 + 4, z * 0.18 + 2);
  const dx = Math.cos(ang), dz = Math.sin(ang);
  const foldFreq = 2.2 / foldSpacing;
  const bend = noiseWarp.fbm(x * 0.5 + 1.7, z * 0.5 + 6.2, 2) * foldSweep * warpIntensity;
  const across = (x * dx + z * dz) * foldFreq + bend;
  const fold = 0.5 - 0.5 * Math.cos(across * Math.PI);
  const amp = 0.25 + 0.75 * Math.max(0, (noiseWarp.noise2(x * 0.35 + 9, z * 0.35 + 3) + 0.6) / 1.6);
  const foldSoft = Math.pow(fold, 1.4) * amp;
  return base * 0.6 + foldSoft * foldDepth + (noiseFine.fbm(x * 4, z * 4, 2) + 1) * 0.01;
};

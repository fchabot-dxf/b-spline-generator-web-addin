/**
 * Damask (Damascus Steel) ⚒️🌊
 * Flowing parallel metallic bands, "watered steel" pattern from
 * pattern-welded blades. Bold directional banding with major swirls.
 *
 * Composition:
 *   1. Shimmer base   — soft FBM wash for the unforged metal sheen.
 *   2. Primary bands  — sin-wave bands warped twice (warp-of-warp) so
 *                       they swirl organically rather than lining up.
 *   3. Fine bands     — second-frequency thin bright lines between
 *                       the primary bands → multi-layer pattern weld.
 */
export const id = 'damask';
export const label = 'Damascus Steel';
export const cMultiplier = 3.0;

export const tweaks = [
  { key: 'bandFreqMul',   label: 'Band Frequency',  default: 9.0, min: 3.0, max: 18.0, step: 0.5, desc: 'Number of pattern-weld bands' },
  { key: 'bandSharpness', label: 'Band Sharpness',  default: 1.6, min: 0.5, max: 4.0,  step: 0.1, desc: 'Lower = wider soft bands, higher = thinner crisp lines' },
  { key: 'swirl',         label: 'Swirl Strength',  default: 0.6, min: 0.0, max: 1.5,  step: 0.05, desc: 'Second-order warp; 0 = straight bands' },
];

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const bandFreqMul   = t.bandFreqMul   ?? 9.0;
  const bandSharpness = t.bandSharpness ?? 1.6;
  const swirl         = t.swirl         ?? 0.6;

  // First-order warp — large swirls
  const w1f = 1.2;
  const wx1 = noiseWarp.fbm(su * w1f, sv * w1f, 4) * (1.4 + warpIntensity * 1.5);
  const wy1 = noiseWarp.fbm(su * w1f + 4.7, sv * w1f + 8.3, 4) * (1.4 + warpIntensity * 1.5);

  // Second-order warp — bends the swirls (the Damascus signature)
  const wx2 = noiseWarp.fbm((su + wx1) * 1.8, (sv + wy1) * 1.8, 3) * swirl;
  const wy2 = noiseWarp.fbm((su + wx1) * 1.8 + 3.1, (sv + wy1) * 1.8 + 6.7, 3) * swirl;

  // ── 1. METALLIC SHIMMER ────────────────────────────────────────────
  const shimmer = (noiseFine.fbm(su * scale * 2.0 * aspect + wx1, sv * scale * 2.0 + wy1, 4) + 1) * 0.5 * 0.18;

  // ── 2. PRIMARY FLOWING BANDS ───────────────────────────────────────
  const bandFreq = scale * bandFreqMul;
  const phase = (sv + wy1 + wy2) * bandFreq + (su + wx1 + wx2) * bandFreq * 0.18;
  const bands = Math.pow(Math.abs(Math.sin(phase)), bandSharpness) * 0.55;

  // ── 3. FINE INTER-BAND LINES ───────────────────────────────────────
  const phase2 = (sv + wy1 * 0.6) * bandFreq * 1.7 + (su + wx1 * 0.4) * bandFreq * 0.10;
  const fine = Math.pow(Math.abs(Math.sin(phase2)), 4.0) * 0.20;

  return shimmer + bands + fine;
};

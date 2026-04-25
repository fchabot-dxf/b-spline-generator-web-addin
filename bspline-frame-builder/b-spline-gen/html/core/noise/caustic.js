/**
 * Caustic (Liquid Light) 💧✨
 * Bright thin curving caustics like the bottom of a swimming pool —
 * focused-light ribbons that cross and pool at intersections.
 *
 * Composition (only thin curves, no bulk fill):
 *   1. Water sway     — soft FBM substrate.
 *   2. Caustic A      — thin band where simplex noise A crosses zero.
 *   3. Caustic B      — second crossing layer at a different freq.
 *   4. Caustic C      — third, finer layer.
 *   5. Burst hotspots — multiplied A·B → bright peaks at crossings.
 *
 * The technique: a thin curve following a noise's zero-crossing is
 *   pow(1 - abs(noise) * k, p)
 * which is bright where noise≈0 and dark elsewhere. Multiple layers
 * cross each other → the characteristic caustic mesh.
 */
export const id = 'caustic';
export const label = 'Liquid Caustics';
export const cMultiplier = 2.5;

export const tweaks = [
  { key: 'lineThinness', label: 'Line Thinness', default: 8.0, min: 3.0, max: 18.0, step: 0.5, desc: 'Higher = thinner caustic ribbons' },
  { key: 'brightness',   label: 'Brightness',    default: 0.45, min: 0.10, max: 1.00, step: 0.05, desc: 'Primary caustic amplitude' },
  { key: 'burst',        label: 'Burst Hotspots', default: 4.0, min: 0.0, max: 12.0, step: 0.5, desc: 'Multiplied crossing peaks' },
];

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const lineThinness = t.lineThinness ?? 8.0;
  const brightness   = t.brightness   ?? 0.45;
  const burstMul     = t.burst        ?? 4.0;

  // Slow water sway warps all three caustic layers together
  const wx = noiseWarp.fbm(su * 0.9, sv * 0.9, 3) * (warpIntensity * 1.4);
  const wy = noiseWarp.fbm(su * 0.9 + 5, sv * 0.9 + 7, 3) * (warpIntensity * 1.4);

  // ── 1. WATER SUBSTRATE ─────────────────────────────────────────────
  const water = (noiseFine.fbm(su * scale * 0.5 + wx, sv * scale * 0.5 + wy, 3, 2.0, 0.6) + 1) * 0.5 * 0.10;

  // ── 2. CAUSTIC A ───────────────────────────────────────────────────
  const f1 = scale * 1.4;
  const n1 = noiseFine.noise2((su + wx) * f1 * aspect, (sv + wy) * f1);
  const caust1 = Math.pow(Math.max(0, 1.0 - Math.abs(n1) * lineThinness), 2.0) * brightness;

  // ── 3. CAUSTIC B ───────────────────────────────────────────────────
  const f2 = scale * 1.7;
  const n2 = noiseFine.noise2((su + wx * 0.7) * f2 * aspect + 3.3, (sv + wy * 0.7) * f2 + 7.7);
  const caust2 = Math.pow(Math.max(0, 1.0 - Math.abs(n2) * 10.0), 2.0) * 0.38;

  // ── 4. CAUSTIC C ───────────────────────────────────────────────────
  const f3 = scale * 2.6;
  const n3 = noiseFine.noise2((su + wx * 0.3) * f3 * aspect + 11.1, (sv + wy * 0.3) * f3 + 13.3);
  const caust3 = Math.pow(Math.max(0, 1.0 - Math.abs(n3) * 14.0), 2.5) * 0.30;

  // ── 5. BURST HOTSPOTS ──────────────────────────────────────────────
  const burst = caust1 * caust2 * burstMul;

  return water + caust1 + caust2 + caust3 + burst;
};

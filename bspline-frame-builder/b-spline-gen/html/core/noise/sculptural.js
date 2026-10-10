/**
 * Sculpted Armor (Ridged)
 * High-contrast ridges and flat plateaus.
 */
export const id = 'sculptural';
export const label = 'Ridged Armor';
export const cMultiplier = 1.5;
// the photo layer's "Filter shows through" normalises this filter's output by its declared span (core/terrain.js):
// MEASURED 2026-10-10 (seat A), default tweaks, 8 seeds x 7x9 / 9x12 / 12x9 boards, the 0.5 / 99.5 percentiles.
export const nominalRange = [0.08, 0.84];

export const tweaks = [
  { key: 'freqMul',   label: 'Ridge Density',   default: 0.55, min: 0.20, max: 1.50, step: 0.05, desc: 'Higher = more, finer ridges' },
  { key: 'sharpness', label: 'Ridge Sharpness', default: 2.20, min: 1.00, max: 4.00, step: 0.10, desc: 'Higher = harder, knife-edged ridges' },
];

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const freqMul   = t.freqMul   ?? 0.55;
  const sharpness = t.sharpness ?? 2.2;

  const eFreq = scale * freqMul;
  const efx = su * eFreq * aspect;
  const efz = sv * eFreq;
  const ewf = 0.4;
  const ewx = noiseWarp.fbm(efx * ewf, efz * ewf, 2) * (warpIntensity * 2.5);
  const ewz = noiseWarp.fbm(efx * ewf + 5.2, efz * ewf + 1.3, 2) * (warpIntensity * 2.5);

  const val = noiseFine.fractalRidge2(efx + ewx, efz + ewz, 6, 0.5, 2.1);
  return Math.pow(Math.max(0, val), sharpness);
};

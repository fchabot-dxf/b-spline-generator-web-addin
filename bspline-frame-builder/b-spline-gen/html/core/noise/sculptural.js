/**
 * Sculpted Armor (Ridged)
 * High-contrast ridges and flat plateaus.
 */
export const id = 'sculptural';
export const label = 'Ridged Armor';
export const cMultiplier = 1.5;

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

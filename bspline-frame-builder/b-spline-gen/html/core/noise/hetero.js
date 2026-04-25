/**
 * Fibrous Grain (Hetero)
 * Recalibrated density-varying eroded patches.
 */
export const id = 'hetero';
export const label = 'Fibrous Grain';
export const cMultiplier = 3.7;

export const tweaks = [
  { key: 'patchThreshold', label: 'Patch Threshold', default: 0.45, min: 0.20, max: 0.70,  step: 0.01, desc: 'Higher = sparser detail patches' },
  { key: 'patchSharpness', label: 'Patch Edge',      default: 6.00, min: 1.00, max: 12.00, step: 0.10, desc: 'Higher = sharper patch boundaries' },
  { key: 'patchInfluence', label: 'Detail Strength', default: 0.80, min: 0.00, max: 1.00,  step: 0.05, desc: 'How strongly the patches gate detail (0 = flat, 1 = fully gated)' },
];

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const patchThreshold = t.patchThreshold ?? 0.45;
  const patchSharpness = t.patchSharpness ?? 6.0;
  const patchInfluence = t.patchInfluence ?? 0.8;

  const hFreq = scale * 4.6;
  const hfx = su * hFreq * aspect;
  const hfz = sv * hFreq;
  const hwf = 0.5;
  const hwx = noiseWarp.fbm(hfx * hwf, hfz * hwf, 2) * (warpIntensity * 2.5);
  const hwz = noiseWarp.fbm(hfx * hwf + 5.2, hfz * hwf + 1.3, 2) * (warpIntensity * 2.5);

  const val = noiseFine.heteroFractal2((hfx + hwx) * 0.8, hfz + hwz, 6, 0.5, 2.0);
  const detail = (val + 1) * 0.5;

  // Patch mask — thresholded coarse noise carves where detail lives.
  const pFreq = 2.4;
  const pVal = (noiseRefs.noiseCoarse.noise2(su * pFreq * aspect, sv * pFreq) + 1.0) * 0.5;
  const patch = Math.max(0, Math.min(1, (pVal - patchThreshold) * patchSharpness));

  // Influence knob: 0 = full detail everywhere (no patches), 1 = detail only inside patches.
  // At default 0.8 this evaluates to the original `0.2 + 0.8 * patch`.
  const intensity = (1 - patchInfluence) + patchInfluence * patch;
  return 0.5 + (detail - 0.5) * intensity;
};

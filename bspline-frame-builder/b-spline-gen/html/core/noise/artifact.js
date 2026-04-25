/**
 * Lunar (Craters) 🌑🌋
 * High-fidelity impact architecture with central peaks, rim ejecta, and maria.
 */
export const id = 'artifact';
export const label = 'Lunar Craters';
export const cMultiplier = 3.0;

export const tweaks = [
  { key: 'plateauPow',  label: 'Plateau Flatness', default: 0.45, min: 0.20, max: 0.90,  step: 0.05, desc: 'Lower = flatter mesa tops' },
  { key: 'canyonDepth', label: 'Canyon Depth',     default: 0.18, min: 0.00, max: 0.40,  step: 0.01, desc: 'Wide structural canyon depth' },
  { key: 'craterDepth', label: 'Crater Depth',     default: 0.05, min: 0.00, max: 0.20,  step: 0.005, desc: 'Sparse shallow crater depth' },
];

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, octaves, roughness } = params;
  const { noiseFine } = noiseRefs;
  const t = params.tweaks ?? {};
  const plateauPow  = t.plateauPow  ?? 0.45;
  const canyonDepth = t.canyonDepth ?? 0.18;
  const craterDepth = t.craterDepth ?? 0.05;

  const f = scale * 2.5;
  const raw = (noiseFine.fbm(su * f * aspect, sv * f, octaves, 2.0, roughness) + 1.0) * 0.5;

  // 1. Plateau Effect (Flat mesas)
  const base = Math.pow(raw, plateauPow);

  // 2. Single Wide Structural Canyon
  const cFreq = scale * 0.08;
  const cWarp = (noiseRefs.noiseWarp.fbm(su * 2.0, sv * 2.0, 2) + 1.0) * 0.05;
  const cVal = Math.abs(noiseFine.noise2(su * cFreq * aspect + cWarp, sv * cFreq * 10.0 + cWarp));
  const canyon = Math.pow(Math.max(0, 1.0 - cVal * 6.5), 2.5) * canyonDepth;

  // Layer 3: Sparse, Shallow Craters (Flat-floor)
  const c1Freq = scale * 0.16;
  const dCrater = noiseFine.worleyNoise2(su * c1Freq * aspect, sv * c1Freq);
  const craters = Math.pow(Math.max(0, 1.0 - dCrater * 1.8), 3.0) * craterDepth;

  return (base - canyon) - craters;
};

/**
 * Cracked (Cellular) 🧩🌋
 * Simulates dried mud or tectonic fissures using warped Voronoi.
 */
export const id = 'cracked';
export const label = 'Cracked Earth';
export const cMultiplier = 2.5;

export const tweaks = [
  { key: 'crackSharpness',  label: 'Crack Sharpness',  default: 0.15, min: 0.05, max: 0.60, step: 0.01, desc: 'Lower = thinner, sharper fissures' },
  { key: 'plateauStrength', label: 'Plateau Texture', default: 0.35, min: 0.00, max: 0.80, step: 0.05, desc: 'Dried-mud plateau noise mixed in' },
];

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const crackSharpness  = t.crackSharpness  ?? 0.15;
  const plateauStrength = t.plateauStrength ?? 0.35;

  const cFreq = scale * 1.8;

  // Warp for "meandering" crack shapes
  const cwx = noiseWarp.fbm(su * 2.5, sv * 2.5, 3) * (warpIntensity * 2.5);
  const cwz = noiseWarp.fbm(su * 2.5 + 4, sv * 2.5 + 1.6, 3) * (warpIntensity * 2.5);

  const d = noiseFine.worleyNoise2(su * cFreq * aspect + cwx, sv * cFreq + cwz);

  // Contrast the distance to get sharp fissures
  const fissures = 1.0 - Math.pow(Math.min(1.0, d * 1.6), crackSharpness);

  // Add internal plateau texture (dried mud texture)
  const plateau = (noiseFine.fbm(su * cFreq * 4, sv * cFreq * 4, 3) + 1.0) * 0.5;

  return Math.max(fissures * 0.95, plateau * plateauStrength);
};

/**
 * Smooth Hills (Simplex)
 * Classic Perlin FBM with warp-displacement.
 */
export const id = 'simplex';
export const label = 'Smooth Hills';
export const cMultiplier = 2.5;

export const tweaks = [
  { key: 'warpFreq',     label: 'Warp Frequency', default: 0.45, min: 0.10, max: 2.00, step: 0.05, desc: 'Higher = tighter warp swirls' },
  { key: 'warpStrength', label: 'Warp Strength',  default: 0.18, min: 0.00, max: 0.50, step: 0.01, desc: 'How much the warp displaces the noise' },
];

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, octaves, roughness, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const warpFreq     = t.warpFreq     ?? 0.45;
  const warpStrength = t.warpStrength ?? 0.18;

  const sFreq = scale * 2.5;
  const sfx = su * sFreq * aspect;
  const sfz = sv * sFreq;
  const swf = warpFreq;
  const swarpAmt = Math.min(2.0, (0.45 + scale * warpStrength) * (warpIntensity * 0.8));
  const swx = noiseWarp.noise2(sfx * swf + 3.17, sfz * swf + 7.43) * swarpAmt;
  const swz = noiseWarp.noise2(sfx * swf + 8.61, sfz * swf + 1.29) * swarpAmt;

  return (noiseFine.fbm(sfx + swx, sfz + swz, octaves, 2.0, roughness) + 1) * 0.5;
};

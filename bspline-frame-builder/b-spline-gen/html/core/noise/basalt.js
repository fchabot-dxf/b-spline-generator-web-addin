/**
 * Basalt (Terraced)
 * Quantized strata with organic warping.
 */
export const id = 'basalt';
export const label = 'Terraced Basalt';
export const cMultiplier = 3.7;
// the photo layer's "Filter shows through" normalises this filter's output by its declared span (core/terrain.js):
// MEASURED 2026-10-10 (seat A), default tweaks, 8 seeds x 7x9 / 9x12 / 12x9 boards, the 0.5 / 99.5 percentiles.
export const nominalRange = [0.29, 0.64];

export const tweaks = [
  { key: 'steps',     label: 'Terrace Count',   default: 14,   min: 3,    max: 30,   step: 1,    desc: 'Number of basalt strata' },
  { key: 'smoothing', label: 'Riser Smoothing', default: 0.88, min: 0.70, max: 0.99, step: 0.01, desc: 'Higher = sharper riser between terraces' },
];

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const steps     = t.steps     ?? 14.0;
  const smoothing = t.smoothing ?? 0.88;

  const bFreq = scale * 2.2;
  const bfx = su * bFreq * aspect;
  const bfz = sv * bFreq;
  const bwf = 0.4;
  const bwx = noiseWarp.fbm(bfx * bwf, bfz * bwf, 2) * (warpIntensity * 3.5);
  const bwz = noiseWarp.fbm(bfx * bwf + 5.2, bfz * bwf + 1.3, 2) * (warpIntensity * 3.5);

  const raw = (noiseFine.fbm(bfx + bwx, bfz + bwz, 6, 2.0, 0.5) + 1) * 0.5;

  const stepped = Math.floor(raw * steps) / steps;
  const delta = (raw * steps) - Math.floor(raw * steps);
  const riserSpan = Math.max(0.001, 1.0 - smoothing);
  const smoothStep = (delta > smoothing) ? stepped + (delta - smoothing) / riserSpan * (1.0 / steps) : stepped;

  return smoothStep;
};

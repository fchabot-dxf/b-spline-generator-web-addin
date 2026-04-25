/**
 * Reef (Coral / Sea-floor) 🪸🐚
 * Soft organic colonies clustered on a sandy substrate.
 *
 * Composition (substrate → colonies):
 *   1. Sandy substrate    — gentle low-freq FBM; the smooth basin
 *                           between colonies. Always present.
 *   2. Colony mask        — large warped FBM thresholded → irregular
 *                           island-shaped patches where coral grows.
 *   3. Brain convolutions — abs(sin(warpedFBM)) → curving parallel
 *                           grooves, the gyrus pattern of brain coral.
 *   4. Tube-worm clusters — high-freq Worley with positive spike
 *                           profile → clumps of upright tube nodules.
 *   5. Pillar spikes      — fractalRidge tips → sparse branching
 *                           coral pillars rising from the colony.
 */
export const id = 'reef';
export const label = 'Coral Reef';
export const cMultiplier = 2.0;

export const tweaks = [
  { key: 'colonyThreshold', label: 'Colony Threshold', default: 0.45, min: 0.20, max: 0.70, step: 0.01, desc: 'Higher = sparser coral colonies' },
  { key: 'brainStrength',   label: 'Brain Coral',      default: 0.18, min: 0.00, max: 0.40, step: 0.02, desc: 'Convolution amplitude' },
  { key: 'tubeStrength',    label: 'Tube Worms',       default: 0.55, min: 0.00, max: 1.20, step: 0.05, desc: 'Tube-worm cluster bump strength' },
];

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const colonyThreshold = t.colonyThreshold ?? 0.45;
  const brainStrength   = t.brainStrength   ?? 0.18;
  const tubeStrength    = t.tubeStrength    ?? 0.55;

  // ── 1. SANDY SUBSTRATE ─────────────────────────────────────────────
  const sf = scale * 0.6;
  const sand = (noiseFine.fbm(su * sf * aspect, sv * sf, 3, 2.0, 0.55) + 1) * 0.5 * 0.18;

  // ── 2. COLONY MASK (where coral grows) ─────────────────────────────
  const colF = scale * 1.1;
  const colWx = noiseWarp.fbm(su * 1.6, sv * 1.6, 3) * (warpIntensity * 2.0);
  const colWy = noiseWarp.fbm(su * 1.6 + 4, sv * 1.6 + 9, 3) * (warpIntensity * 2.0);
  const colVal = (noiseFine.fbm(su * colF * aspect + colWx, sv * colF + colWy, 3) + 1) * 0.5;
  const colonyMask = Math.max(0, colVal - colonyThreshold) * 2.0;
  const colonyCap = Math.min(1, colonyMask);

  // ── 3. BRAIN CORAL CONVOLUTIONS ────────────────────────────────────
  const brainF = scale * 5.5;
  const bwx = noiseWarp.fbm(su * 2.5, sv * 2.5, 3) * 1.4;
  const bwy = noiseWarp.fbm(su * 2.5 + 7, sv * 2.5 + 3, 3) * 1.4;
  const brainPhase = noiseWarp.fbm((su + bwx) * brainF * 0.4, (sv + bwy) * brainF * 0.4, 2) * 8.0;
  const brain = Math.abs(Math.sin(brainPhase)) * brainStrength * colonyCap;

  // ── 4. TUBE-WORM CLUSTERS ──────────────────────────────────────────
  const tubeF = scale * 6.0;
  const tubeD = noiseFine.worleyNoise2(su * tubeF * aspect, sv * tubeF);
  const tubeRaw = Math.pow(Math.max(0, 0.35 - tubeD), 1.4) * 1.2;
  const tubeGate = Math.max(0, (noiseWarp.noise2(su * 4.0, sv * 4.0) + 1) * 0.5 - 0.55) * 2.0;
  const tubes = tubeRaw * tubeGate * colonyCap * tubeStrength;

  // ── 5. PILLAR SPIKES ───────────────────────────────────────────────
  const spikeRaw = noiseFine.fractalRidge2(su * scale * 3.5 * aspect + bwx, sv * scale * 3.5 + bwy, 4);
  const spikes = Math.pow(Math.max(0, spikeRaw), 4.0) * 0.25 * colonyCap;

  // Colony lift = the bulk dome of the colony itself
  const colonyLift = Math.pow(colonyMask, 0.7) * 0.45;

  return sand + colonyLift + brain + tubes + spikes;
};

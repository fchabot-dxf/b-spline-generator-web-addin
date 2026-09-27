/**
 * Reef (Coral / Sea-floor) 🪸🐚
 * Soft organic colonies clustered on a sandy substrate.
 *
 * T78 (Fred: reef showed "large FLAT-TOPPED plateaus (clipped heights)")
 * REWORK: the OLD colony-interior height (`colonyLift`) was
 * `pow(colonyMask, 0.7) * 0.45`, where `colonyMask = max(0, colVal -
 * threshold) * 2` was itself hard-capped (`colonyCap = min(1,
 * colonyMask)`) — but `colonyLift` never even used the capped value, so
 * for any point comfortably past the threshold (colVal not just barely
 * above it — the common case across most of a colony's own interior),
 * `colonyMask` itself saturates near ~1.0-1.1 and `colonyLift` converges
 * to nearly the SAME constant (~0.45) everywhere: a literal flat plateau
 * across the whole colony interior, with only the much-smaller brain/
 * tube/spike terms riding on top. Fixed by splitting the old single
 * `colonyMask`/`colonyLift` pipeline into two SEPARATE roles: `presence`
 * (still a smooth 0/1 threshold gate, for whether coral grows here at
 * all) and a genuinely UNCLIPPED, always-varying "coral head" relief
 * field (its own independent mid-frequency FBM) that keeps producing real
 * local bumps and hollows across the ENTIRE interior — "structure
 * continues on top" — instead of saturating to a near-constant height the
 * moment a point is solidly inside a colony.
 *
 * Composition (substrate → colonies):
 *   1. Sandy substrate    — gentle low-freq FBM; the smooth basin
 *                           between colonies. Always present.
 *   2. Colony presence    — large warped FBM thresholded (smooth 0/1
 *                           gate, not a height itself) → irregular
 *                           island-shaped patches where coral grows.
 *   3. Coral head relief  — an UNCLIPPED mid-freq FBM, gated by presence,
 *                           giving the colony interior continuous bumpy
 *                           structure instead of a flat plateau.
 *   4. Brain convolutions — abs(sin(warpedFBM)) → curving parallel
 *                           grooves, the gyrus pattern of brain coral.
 *   5. Tube-worm clusters — high-freq Worley with positive spike
 *                           profile → clumps of upright tube nodules.
 *   6. Pillar spikes      — fractalRidge tips → sparse branching
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

  // ── 2. COLONY PRESENCE (where coral grows -- a GATE, not a height) ──
  const colF = scale * 1.1;
  const colWx = noiseWarp.fbm(su * 1.6, sv * 1.6, 3) * (warpIntensity * 2.0);
  const colWy = noiseWarp.fbm(su * 1.6 + 4, sv * 1.6 + 9, 3) * (warpIntensity * 2.0);
  const colVal = (noiseFine.fbm(su * colF * aspect + colWx, sv * colF + colWy, 3) + 1) * 0.5;
  const colonyMaskRaw = Math.max(0, colVal - colonyThreshold);
  // Smooth 0/1 gate with a soft edge band -- used ONLY to decide whether
  // coral grows here at all, never as a height itself (that was the
  // clipping bug: see file header).
  const presence = smoothstep01(0, 0.12, colonyMaskRaw);

  // ── 3. CORAL HEAD RELIEF (real structure across the WHOLE interior) ─
  // An independent, UNCLIPPED mid-frequency FBM -- keeps varying
  // continuously everywhere `presence` is high, so the colony interior
  // has genuine bumps/hollows instead of settling to one constant height.
  const headF = scale * 3.0;
  const headRaw = (noiseFine.fbm(su * headF * aspect + colWx * 0.5, sv * headF + colWy * 0.5, 4, 2.0, 0.5) + 1) * 0.5;
  const colonyLift = presence * headRaw * 0.50;

  // ── 4. BRAIN CORAL CONVOLUTIONS ────────────────────────────────────
  const brainF = scale * 5.5;
  const bwx = noiseWarp.fbm(su * 2.5, sv * 2.5, 3) * 1.4;
  const bwy = noiseWarp.fbm(su * 2.5 + 7, sv * 2.5 + 3, 3) * 1.4;
  const brainPhase = noiseWarp.fbm((su + bwx) * brainF * 0.4, (sv + bwy) * brainF * 0.4, 2) * 8.0;
  const brain = Math.abs(Math.sin(brainPhase)) * brainStrength * presence;

  // ── 5. TUBE-WORM CLUSTERS ──────────────────────────────────────────
  const tubeF = scale * 6.0;
  const tubeD = noiseFine.worleyNoise2(su * tubeF * aspect, sv * tubeF);
  const tubeRaw = Math.pow(Math.max(0, 0.35 - tubeD), 1.4) * 1.2;
  const tubeGate = Math.max(0, (noiseWarp.noise2(su * 4.0, sv * 4.0) + 1) * 0.5 - 0.55) * 2.0;
  const tubes = tubeRaw * tubeGate * presence * tubeStrength;

  // ── 6. PILLAR SPIKES ───────────────────────────────────────────────
  const spikeRaw = noiseFine.fractalRidge2(su * scale * 3.5 * aspect + bwx, sv * scale * 3.5 + bwy, 4);
  const spikes = Math.pow(Math.max(0, spikeRaw), 4.0) * 0.25 * presence;

  return sand + colonyLift + brain + tubes + spikes;
};

function smoothstep01(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

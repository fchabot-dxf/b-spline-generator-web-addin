/**
 * Mars (Red Planet) 🔴🛰️
 * Dry-river-network martian terrain — heavy dendritic drainage carving
 * highland massifs, scattered impact craters, and faint rust ridges.
 *
 * Composition (large → small):
 *   1. Continental relief — low-freq FBM pow-curve → highland plateaus
 *                            and basin floors (Tharsis vs Hellas).
 *   2. Drainage — dominant dendritic river network from fractalRidge2,
 *                 carved deep on highlands, fading on basins.
 *   3. Crater layers — three Worley scales for big/medium/small impacts.
 *   4. Crater rims  — pulse on the crater distance field.
 *   5. Rust ridges  — faint mid-freq fractalRidge2 → tectonic banding
 *                     and wind-scoured ridges on the plateaus.
 *   6. Surface dust — fine FBM grain.
 */
export const id = 'mars';
export const label = 'Mars Surface';
export const cMultiplier = 3.0;

export const tweaks = [
  { key: 'reliefHeight', label: 'Relief Height',  default: 0.55, min: 0.10, max: 1.20, step: 0.05, desc: 'Highland massif amplitude' },
  { key: 'riverDepth',   label: 'River Depth',    default: 0.45, min: 0.00, max: 0.90, step: 0.02, desc: 'Dendritic drainage carving' },
  { key: 'craterScale',  label: 'Crater Scale',   default: 0.18, min: 0.00, max: 0.50, step: 0.02, desc: 'Crater pit depth' },
  { key: 'ridgeAmount',  label: 'Rust Ridges',    default: 0.06, min: 0.00, max: 0.20, step: 0.01, desc: 'Faint tectonic banding' },
];

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const reliefHeight = t.reliefHeight ?? 0.55;
  const riverDepth   = t.riverDepth   ?? 0.45;
  const craterScale  = t.craterScale  ?? 0.18;
  const ridgeAmount  = t.ridgeAmount  ?? 0.06;

  // ── 1. CONTINENTAL RELIEF ──────────────────────────────────────────
  const cf = scale * 0.42;
  const wx = noiseWarp.fbm(su * 0.8, sv * 0.8, 2) * (warpIntensity * 1.0);
  const wy = noiseWarp.fbm(su * 0.8 + 5, sv * 0.8 + 9, 2) * (warpIntensity * 1.0);
  const reliefRaw = (noiseFine.fbm(su * cf * aspect + wx, sv * cf + wy, 5, 2.0, 0.5) + 1) * 0.5;
  const relief = Math.pow(reliefRaw, 1.6) * reliefHeight;

  // ── 2. DENDRITIC DRAINAGE (dominant) ───────────────────────────────
  // Two octave-shifted river networks at slightly different scales merge
  // into a multi-tributary system that branches like real fluvial erosion.
  const vf = scale * 2.2;
  const vwx = noiseWarp.fbm(su * 1.6, sv * 1.6, 3) * (warpIntensity * 1.6);
  const vwy = noiseWarp.fbm(su * 1.6 + 3, sv * 1.6 + 7, 3) * (warpIntensity * 1.6);
  const drainA = noiseFine.fractalRidge2((su + vwx) * vf * aspect,        (sv + vwy) * vf,        5);
  const drainB = noiseFine.fractalRidge2((su + vwx) * vf * 1.7 * aspect + 4.4, (sv + vwy) * vf * 1.7 + 6.6, 4);
  const drainage = Math.max(drainA, drainB * 0.7);
  const erosionGate = Math.max(0, (relief - 0.08) / 0.45);
  const valleys = -Math.pow(Math.max(0, drainage), 2.3) * riverDepth * erosionGate;

  // ── 3. CRATER LAYERS ───────────────────────────────────────────────
  const c1 = noiseFine.worleyNoise2(su * scale * 0.7 * aspect + 1.3, sv * scale * 0.7 + 4.7);
  const big = -Math.pow(Math.max(0, 0.18 - c1), 1.3) * 1.2;
  const c2 = noiseFine.worleyNoise2(su * scale * 1.8 * aspect + 7.7, sv * scale * 1.8 + 2.3);
  const med = -Math.pow(Math.max(0, 0.14 - c2), 1.5) * 0.9;
  const c3 = noiseFine.worleyNoise2(su * scale * 4.5 * aspect + 11.1, sv * scale * 4.5 + 13.3);
  const sml = -Math.pow(Math.max(0, 0.08 - c3), 2.0) * 0.7;
  const craters = (big + med + sml) * craterScale;

  // ── 4. CRATER RIMS ─────────────────────────────────────────────────
  const rim1 = Math.pow(Math.max(0, 1.0 - Math.abs(c1 - 0.20) * 12.0), 2.0) * 0.06;
  const rim2 = Math.pow(Math.max(0, 1.0 - Math.abs(c2 - 0.16) * 14.0), 2.0) * 0.04;

  // ── 5. RUST RIDGES (tectonic + wind-scoured) ───────────────────────
  const ridges = noiseFine.fractalRidge2(su * scale * 1.4 * aspect + wx * 0.5, sv * scale * 1.4 + wy * 0.5, 4) * ridgeAmount;

  // ── 6. SURFACE DUST ────────────────────────────────────────────────
  const dustRaw = (noiseFine.fbm(su * scale * 16.0 * aspect, sv * scale * 16.0, 3, 2.0, 0.45) + 1) * 0.5;
  const dust = (dustRaw - 0.5) * 0.04;

  return relief + valleys + craters + rim1 + rim2 + ridges + dust;
};

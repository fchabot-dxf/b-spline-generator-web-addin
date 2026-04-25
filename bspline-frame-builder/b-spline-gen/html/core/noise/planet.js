/**
 * Planet (Surface) 🪐🛰️
 * Mars / aerial-satellite topography — massif/basin separation with
 * dendritic erosion gullies cutting downslope and scattered craters.
 *
 * Composition (large → small):
 *   1. Continental relief — low-freq FBM with pow-curve → big massifs
 *                            and basin floors.
 *   2. Dendritic drainage — fractalRidge as NEGATIVE V-valleys, GATED
 *                            by relief height → erosion only attacks
 *                            elevated terrain, leaving basins smooth.
 *   3. Crater layers       — three Worley scales (big rare / medium /
 *                            small frequent) for natural crater-size
 *                            distribution.
 *   4. Crater rims         — pulse function on the crater distance
 *                            field → raised lip just outside each pit.
 *   5. Surface dust        — high-freq FBM low-amplitude → fine grain.
 */
export const id = 'planet';
export const label = 'Planet Surface';
export const cMultiplier = 3.0;

export const tweaks = [
  { key: 'reliefHeight', label: 'Relief Height', default: 0.55, min: 0.10, max: 1.20, step: 0.05, desc: 'Continental massif amplitude' },
  { key: 'valleyDepth',  label: 'Valley Depth',  default: 0.30, min: 0.00, max: 0.80, step: 0.02, desc: 'Dendritic erosion intensity' },
  { key: 'craterScale',  label: 'Crater Scale',  default: 0.18, min: 0.00, max: 0.50, step: 0.02, desc: 'Overall crater pit depth' },
];

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const reliefHeight = t.reliefHeight ?? 0.55;
  const valleyDepth  = t.valleyDepth  ?? 0.30;
  const craterScale  = t.craterScale  ?? 0.18;

  // ── 1. CONTINENTAL RELIEF ──────────────────────────────────────────
  const cf = scale * 0.45;
  const wx = noiseWarp.fbm(su * 0.8, sv * 0.8, 2) * (warpIntensity * 1.0);
  const wy = noiseWarp.fbm(su * 0.8 + 5, sv * 0.8 + 9, 2) * (warpIntensity * 1.0);
  const reliefRaw = (noiseFine.fbm(su * cf * aspect + wx, sv * cf + wy, 5, 2.0, 0.5) + 1) * 0.5;
  const relief = Math.pow(reliefRaw, 1.6) * reliefHeight;

  // ── 2. DENDRITIC DRAINAGE ──────────────────────────────────────────
  const vf = scale * 2.4;
  const vwx = noiseWarp.fbm(su * 1.6, sv * 1.6, 3) * (warpIntensity * 1.4);
  const vwy = noiseWarp.fbm(su * 1.6 + 3, sv * 1.6 + 7, 3) * (warpIntensity * 1.4);
  const drainage = noiseFine.fractalRidge2(
    (su + vwx) * vf * aspect,
    (sv + vwy) * vf,
    5
  );
  const erosionGate = Math.max(0, (relief - 0.10) / 0.45);
  const valleys = -Math.pow(Math.max(0, drainage), 2.5) * valleyDepth * erosionGate;

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

  // ── 5. SURFACE DUST ────────────────────────────────────────────────
  const dustRaw = (noiseFine.fbm(su * scale * 16.0 * aspect, sv * scale * 16.0, 3, 2.0, 0.45) + 1) * 0.5;
  const dust = (dustRaw - 0.5) * 0.04;

  return relief + valleys + craters + rim1 + rim2 + dust;
};

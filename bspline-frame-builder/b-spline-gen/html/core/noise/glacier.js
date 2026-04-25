/**
 * Glacier (Ice Fracture) ❄️🧊
 * Glass-smooth ice plateaus shattered by long crystalline cracks.
 *
 * Composition (smooth base → sharp features):
 *   1. Glass plateau   — heavily flattened FBM → broad smooth swells.
 *   2. Linear cracks   — heavily anisotropic ridged noise (V-axis
 *                        compressed 5×) → long parallel fractures
 *                        instead of cellular cracks. SUBTRACTIVE.
 *   3. Pressure ridges — narrow positive seams perpendicular to the
 *                        cracks, gated to be rare.
 *   4. Hairline fines  — second smaller ridged layer, also subtractive.
 *   5. Crystal shimmer — high-freq Worley pinpoint highlights.
 */
export const id = 'glacier';
export const label = 'Glacier Ice';
export const cMultiplier = 2.4;

export const tweaks = [
  { key: 'crackDepth',  label: 'Crack Depth',     default: 0.30, min: 0.05, max: 0.80, step: 0.01, desc: 'Subtractive fracture depth' },
  { key: 'glassPow',    label: 'Glass Smoothness', default: 1.20, min: 0.50, max: 3.00, step: 0.05, desc: 'Higher = flatter ice plateaus' },
  { key: 'crackAniso',  label: 'Crack Linearity', default: 0.20, min: 0.05, max: 1.00, step: 0.05, desc: 'Lower = longer, more parallel cracks' },
];

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const crackDepth = t.crackDepth ?? 0.30;
  const glassPow   = t.glassPow   ?? 1.2;
  const crackAniso = t.crackAniso ?? 0.20;

  // Per-region crack-direction so the whole surface isn't all the same angle.
  const angleN = noiseWarp.noise2(su * 0.6, sv * 0.6);
  const ang = angleN * Math.PI * 0.5;
  const ca = Math.cos(ang), sa = Math.sin(ang);

  // ── 1. GLASS PLATEAU ───────────────────────────────────────────────
  const pf = scale * 0.5;
  const plateauRaw = (noiseFine.fbm(su * pf * aspect, sv * pf, 3, 2.0, 0.4) + 1) * 0.5;
  const glass = Math.pow(plateauRaw, glassPow) * 0.20;

  // ── 2. LONG LINEAR CRACKS ──────────────────────────────────────────
  const crackF = scale * 2.0;
  const cu = (su * ca - sv * sa) * crackF * aspect;
  const cv = (su * sa + sv * ca) * crackF * crackAniso;
  const cwx = noiseWarp.fbm(su * 1.0, sv * 1.0, 2) * (warpIntensity * 0.6);
  const cwy = noiseWarp.fbm(su * 1.0 + 5, sv * 1.0 + 9, 2) * (warpIntensity * 0.6);
  const cracksRaw = noiseFine.fractalRidge2(cu + cwx, cv + cwy, 3);
  const cracks = -Math.pow(Math.max(0, cracksRaw), 3.5) * crackDepth;

  // ── 3. PRESSURE RIDGES ─────────────────────────────────────────────
  const prv = (su * sa + sv * ca) * scale * 1.4;
  const prRaw = Math.pow(Math.abs(Math.sin(prv * 4.0 + cwx * 2.0)), 30.0);
  const prGate = Math.max(0, noiseWarp.noise2(su * 1.5, sv * 1.5) - 0.2);
  const pressureRidge = prRaw * prGate * 0.18;

  // ── 4. HAIRLINE FRACTURES ──────────────────────────────────────────
  const hf = scale * 4.5;
  const hairRaw = noiseFine.fractalRidge2(
    su * hf * aspect + cwx * 0.4,
    sv * hf * 0.6 + cwy * 0.4,
    2
  );
  const hairlines = -Math.pow(Math.max(0, hairRaw), 4.5) * 0.10;

  // ── 5. CRYSTAL SHIMMER ─────────────────────────────────────────────
  const shimD = noiseFine.worleyNoise2(su * scale * 26.0 * aspect, sv * scale * 26.0);
  const shimmer = Math.pow(Math.max(0, 0.45 - shimD), 2.5) * 0.05;

  return glass + cracks + pressureRidge + hairlines + shimmer;
};

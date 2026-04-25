/**
 * Moon (Lunar) 🌑🪐
 * Heavily-cratered airless body — dominant impact cratering at FOUR
 * size scales, sharp ejecta rims, smooth dark "maria" basins, and
 * a few sinuous rilles (collapsed lava tubes).
 *
 * Composition (large → small):
 *   1. Maria/Highlands relief — low-freq FBM with sharper threshold.
 *                               High → cratered highlands; low → smooth maria.
 *   2. Crater layers — FOUR Worley scales: giant rare basin / large /
 *                      medium / small. Crater density is the dominant
 *                      visual feature.
 *   3. Sharp rims    — narrow high-amplitude pulse on each crater
 *                      distance field → raised lip with crisp shoulder.
 *   4. Sinuous rilles — sparse fractalRidge2 NEGATIVE channels, GATED
 *                       to maria only (rilles only form on smooth lava).
 *   5. Regolith dust — micro FBM grain.
 *
 * Note: no fluvial drainage — the Moon has no atmosphere or water.
 */
export const id = 'moon';
export const label = 'Moon Surface';
export const cMultiplier = 3.0;

export const tweaks = [
  { key: 'highlandHeight', label: 'Highland Height', default: 0.45, min: 0.10, max: 1.00, step: 0.05, desc: 'Highland vs maria amplitude' },
  { key: 'craterDepth',    label: 'Crater Depth',    default: 0.32, min: 0.00, max: 0.70, step: 0.02, desc: 'Overall crater pit depth' },
  { key: 'rimSharpness',   label: 'Rim Sharpness',   default: 0.12, min: 0.00, max: 0.30, step: 0.01, desc: 'Raised crater rim amplitude' },
  { key: 'rilleAmount',    label: 'Rille Amount',    default: 0.06, min: 0.00, max: 0.20, step: 0.01, desc: 'Sinuous lava-channel rilles' },
];

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const highlandHeight = t.highlandHeight ?? 0.45;
  const craterDepth    = t.craterDepth    ?? 0.32;
  const rimSharpness   = t.rimSharpness   ?? 0.12;
  const rilleAmount    = t.rilleAmount    ?? 0.06;

  // ── 1. MARIA / HIGHLANDS RELIEF ────────────────────────────────────
  const cf = scale * 0.40;
  const wx = noiseWarp.fbm(su * 0.7, sv * 0.7, 2) * (warpIntensity * 0.9);
  const wy = noiseWarp.fbm(su * 0.7 + 5, sv * 0.7 + 9, 2) * (warpIntensity * 0.9);
  const reliefRaw = (noiseFine.fbm(su * cf * aspect + wx, sv * cf + wy, 4, 2.0, 0.55) + 1) * 0.5;
  // Sharper threshold than mars/planet → cleaner maria/highland separation
  const reliefMask = Math.pow(reliefRaw, 2.0);
  const relief = reliefMask * highlandHeight;

  // ── 2. CRATER LAYERS (four scales) ─────────────────────────────────
  const c0 = noiseFine.worleyNoise2(su * scale * 0.35 * aspect + 0.7, sv * scale * 0.35 + 2.1);
  const giant = -Math.pow(Math.max(0, 0.22 - c0), 1.2) * 1.5;
  const c1 = noiseFine.worleyNoise2(su * scale * 0.9 * aspect + 1.3,  sv * scale * 0.9  + 4.7);
  const big = -Math.pow(Math.max(0, 0.18 - c1), 1.3) * 1.2;
  const c2 = noiseFine.worleyNoise2(su * scale * 2.2 * aspect + 7.7,  sv * scale * 2.2  + 2.3);
  const med = -Math.pow(Math.max(0, 0.14 - c2), 1.5) * 0.9;
  const c3 = noiseFine.worleyNoise2(su * scale * 5.5 * aspect + 11.1, sv * scale * 5.5  + 13.3);
  const sml = -Math.pow(Math.max(0, 0.08 - c3), 2.0) * 0.7;
  const craters = (giant + big + med + sml) * craterDepth;

  // ── 3. SHARP RIMS ──────────────────────────────────────────────────
  // Crisper than mars (narrower band, higher amplitude)
  const rim0 = Math.pow(Math.max(0, 1.0 - Math.abs(c0 - 0.24) * 14.0), 2.5) * 0.10;
  const rim1 = Math.pow(Math.max(0, 1.0 - Math.abs(c1 - 0.20) * 16.0), 2.5) * 0.07;
  const rim2 = Math.pow(Math.max(0, 1.0 - Math.abs(c2 - 0.16) * 18.0), 2.5) * 0.05;
  const rims = (rim0 + rim1 + rim2) * (rimSharpness / 0.12);  // scale by tweak

  // ── 4. SINUOUS RILLES (maria only) ─────────────────────────────────
  const rf = scale * 1.8;
  const rwx = noiseWarp.fbm(su * 1.2, sv * 1.2, 3) * (warpIntensity * 1.2);
  const rwy = noiseWarp.fbm(su * 1.2 + 4, sv * 1.2 + 7, 3) * (warpIntensity * 1.2);
  const rilleRaw = noiseFine.fractalRidge2((su + rwx) * rf * aspect, (sv + rwy) * rf, 4);
  // Gate inversely to relief — rilles only on the smooth dark maria
  const mariaGate = Math.max(0, 1.0 - reliefMask * 2.0);
  // Threshold so rilles are sparse, not a network
  const rilleThresh = Math.max(0, rilleRaw - 0.55) * 2.5;
  const rilles = -Math.pow(rilleThresh, 1.6) * rilleAmount * mariaGate;

  // ── 5. REGOLITH DUST ───────────────────────────────────────────────
  const dustRaw = (noiseFine.fbm(su * scale * 18.0 * aspect, sv * scale * 18.0, 3, 2.0, 0.45) + 1) * 0.5;
  const dust = (dustRaw - 0.5) * 0.035;

  return relief + craters + rims + rilles + dust;
};

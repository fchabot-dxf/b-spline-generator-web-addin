/**
 * Venus (Volcanic) 🟠🌋
 * Tectonically resurfaced volcanic plains — dominated by tessera-style
 * crack networks (coronae fractures), winding lava channels (canali),
 * and only sparse impact craters because Venus's surface is geologically
 * young and heavily resurfaced.
 *
 * Composition:
 *   1. Volcanic plains — gentle low-freq FBM (smoother than mars/moon).
 *   2. Coronae rings   — large Worley-distance pulses → raised circular
 *                        ramparts around hot-spot uplifts.
 *   3. Tessera cracks  — multi-octave fractalRidge2 fractures (positive
 *                        ridges) creating tectonic banding.
 *   4. Lava canali     — second fractalRidge2 layer, NEGATIVE → winding
 *                        channels carved into the plains.
 *   5. Sparse craters  — single Worley layer, low density.
 *   6. Surface texture — fine FBM grain.
 *
 * The signature: NO river dendrites (no water), but the cracks +
 * canali combine into a busy tectonic web with circular coronae
 * popping out at multiple scales.
 */
export const id = 'venus';
export const label = 'Venus Surface';
export const cMultiplier = 3.0;

export const tweaks = [
  { key: 'plainsHeight',  label: 'Plains Relief',   default: 0.30, min: 0.05, max: 0.80, step: 0.02, desc: 'Volcanic plains amplitude' },
  { key: 'crackDepth',    label: 'Tessera Cracks',  default: 0.30, min: 0.00, max: 0.80, step: 0.02, desc: 'Tectonic fracture intensity' },
  { key: 'canaliDepth',   label: 'Lava Channels',   default: 0.20, min: 0.00, max: 0.50, step: 0.02, desc: 'Winding canali depth' },
  { key: 'coronaeAmount', label: 'Coronae',         default: 0.15, min: 0.00, max: 0.40, step: 0.01, desc: 'Circular hot-spot ring uplifts' },
];

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const plainsHeight  = t.plainsHeight  ?? 0.30;
  const crackDepth    = t.crackDepth    ?? 0.30;
  const canaliDepth   = t.canaliDepth   ?? 0.20;
  const coronaeAmount = t.coronaeAmount ?? 0.15;

  // ── 1. VOLCANIC PLAINS ─────────────────────────────────────────────
  const pf = scale * 0.50;
  const wx = noiseWarp.fbm(su * 0.9, sv * 0.9, 2) * (warpIntensity * 1.1);
  const wy = noiseWarp.fbm(su * 0.9 + 5, sv * 0.9 + 9, 2) * (warpIntensity * 1.1);
  const plainsRaw = (noiseFine.fbm(su * pf * aspect + wx, sv * pf + wy, 4, 2.0, 0.55) + 1) * 0.5;
  const plains = Math.pow(plainsRaw, 1.3) * plainsHeight;

  // ── 2. CORONAE (circular ring uplifts) ─────────────────────────────
  // Worley distance field at low freq → large circular cells. The pulse
  // creates a raised ring at a fixed distance from each cell center.
  const cF = scale * 0.55;
  const cD = noiseFine.worleyNoise2((su + wx * 0.4) * cF * aspect + 2.2, (sv + wy * 0.4) * cF + 5.5);
  const coronaeRing = Math.pow(Math.max(0, 1.0 - Math.abs(cD - 0.22) * 8.0), 2.0) * coronaeAmount;
  // Soft inner depression inside the corona
  const coronaeBowl = -Math.pow(Math.max(0, 0.10 - cD), 1.4) * coronaeAmount * 0.6;

  // ── 3. TESSERA CRACKS (positive tectonic ridges) ───────────────────
  const tf = scale * 2.0;
  const twx = noiseWarp.fbm(su * 1.5, sv * 1.5, 3) * (warpIntensity * 1.5);
  const twy = noiseWarp.fbm(su * 1.5 + 3, sv * 1.5 + 7, 3) * (warpIntensity * 1.5);
  const crackA = noiseFine.fractalRidge2((su + twx) * tf * aspect,        (sv + twy) * tf,        5);
  const crackB = noiseFine.fractalRidge2((su + twx) * tf * 1.9 * aspect + 4.4, (sv + twy) * tf * 1.9 + 6.6, 4);
  // Combine; threshold crisper crack centerlines
  const crackCombined = Math.max(crackA, crackB * 0.8);
  const cracks = Math.pow(Math.max(0, crackCombined), 1.8) * crackDepth;

  // ── 4. LAVA CANALI (winding channels) ──────────────────────────────
  const lf = scale * 1.3;
  const lwx = noiseWarp.fbm(su * 0.9 + 7, sv * 0.9 + 3, 3) * (warpIntensity * 1.7);
  const lwy = noiseWarp.fbm(su * 0.9 + 11, sv * 0.9 + 13, 3) * (warpIntensity * 1.7);
  const canaliRaw = noiseFine.fractalRidge2((su + lwx) * lf * aspect + 9.9, (sv + lwy) * lf + 1.7, 4);
  // Threshold so only the strongest ridges become canali → sparse channels
  const canaliThresh = Math.max(0, canaliRaw - 0.45) * 1.8;
  const canali = -Math.pow(canaliThresh, 1.6) * canaliDepth;

  // ── 5. SPARSE CRATERS ──────────────────────────────────────────────
  // Venus has very few craters — single layer at a single scale
  const xC = noiseFine.worleyNoise2(su * scale * 2.4 * aspect + 11.1, sv * scale * 2.4 + 13.3);
  const sparseCraters = -Math.pow(Math.max(0, 0.10 - xC), 1.6) * 0.5 * 0.08;
  const sparseRim     = Math.pow(Math.max(0, 1.0 - Math.abs(xC - 0.13) * 16.0), 2.2) * 0.025;

  // ── 6. SURFACE TEXTURE ─────────────────────────────────────────────
  const grainRaw = (noiseFine.fbm(su * scale * 14.0 * aspect, sv * scale * 14.0, 3, 2.0, 0.50) + 1) * 0.5;
  const grain = (grainRaw - 0.5) * 0.04;

  return plains + coronaeRing + coronaeBowl + cracks + canali + sparseCraters + sparseRim + grain;
};

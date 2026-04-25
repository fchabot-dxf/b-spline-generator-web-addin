/**
 * Stone (Cross-Canyon Mesa) 🪨🧱
 * Direct variation of `artifact`. Same plateau-flattening backbone,
 * same subtractive composition, same canyon primitive. The only
 * addition: a SECOND canyon family running perpendicular to the first.
 *
 * Where artifact has one canyon set carved with V-axis ×10 anisotropy
 * (long mostly-horizontal canyons), stone adds a matching set carved
 * with U-axis ×10 anisotropy (long mostly-vertical canyons). Where the
 * two perpendicular families cross, the mesa is split into rectangular
 * stone-block shapes.
 *
 * Composition (subtractive, identical to artifact except step 3):
 *   1. Mesa base    — pow<1 lifted FBM → flat tablelands.
 *   2. H-canyons    — artifact's signature: long horizontal canyons
 *                     from V-axis ×10 anisotropy.
 *   3. V-canyons    — same trick rotated: U-axis ×10 anisotropy →
 *                     long vertical canyons that cross the H-canyons
 *                     and split the mesa into block-shaped stones.
 *   4. Sparse pits  — flat-floor depressions (artifact carryover).
 */
export const id = 'stone';
export const label = 'Stone';
export const cMultiplier = 3.0;

export const tweaks = [
  { key: 'plateauPow',   label: 'Plateau Flatness',     default: 0.45, min: 0.20, max: 0.90, step: 0.05,  desc: 'Lower = flatter mesa tops' },
  { key: 'hCanyonDepth', label: 'Horizontal Canyons',   default: 0.18, min: 0.00, max: 0.40, step: 0.01,  desc: 'Depth of horizontal canyon set' },
  { key: 'vCanyonDepth', label: 'Vertical Canyons',     default: 0.18, min: 0.00, max: 0.40, step: 0.01,  desc: 'Depth of vertical canyon set' },
  { key: 'pitDepth',     label: 'Pit Depth',            default: 0.05, min: 0.00, max: 0.20, step: 0.005, desc: 'Sparse flat-floor depressions' },
];

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, octaves, roughness } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const plateauPow   = t.plateauPow   ?? 0.45;
  const hCanyonDepth = t.hCanyonDepth ?? 0.18;
  const vCanyonDepth = t.vCanyonDepth ?? 0.18;
  const pitDepth     = t.pitDepth     ?? 0.05;

  // ── 1. MESA BASE (artifact's pow<1 plateau trick) ──────────────────
  const f = scale * 2.5;
  const raw = (noiseFine.fbm(su * f * aspect, sv * f, octaves, 2.0, roughness) + 1) * 0.5;
  const base = Math.pow(raw, plateauPow);

  // Shared subtle domain warp so canyons don't run perfectly straight
  const cWarp = (noiseWarp.fbm(su * 2.0, sv * 2.0, 2) + 1.0) * 0.05;

  // ── 2. HORIZONTAL CANYONS (artifact's V-axis ×10 anisotropy) ──────
  const cFreq = scale * 0.08;
  const cValH = Math.abs(noiseFine.noise2(
    su * cFreq * aspect + cWarp,
    sv * cFreq * 10.0 + cWarp
  ));
  const hCanyon = Math.pow(Math.max(0, 1.0 - cValH * 6.5), 2.5) * hCanyonDepth;

  // ── 3. VERTICAL CANYONS (same trick, U-axis ×10 anisotropy) ───────
  // Coord offsets (+7.7, +13.3) decorrelate this layer from the H-set
  // so the canyon crossings aren't on a regular grid.
  const cValV = Math.abs(noiseFine.noise2(
    su * cFreq * 10.0 * aspect + cWarp + 7.7,
    sv * cFreq + cWarp + 13.3
  ));
  const vCanyon = Math.pow(Math.max(0, 1.0 - cValV * 6.5), 2.5) * vCanyonDepth;

  // ── 4. SPARSE FLAT-FLOOR PITS (artifact carryover) ─────────────────
  const c1Freq = scale * 0.16;
  const dCrater = noiseFine.worleyNoise2(su * c1Freq * aspect, sv * c1Freq);
  const pits = Math.pow(Math.max(0, 1.0 - dCrater * 1.8), 3.0) * pitDepth;

  return (base - hCanyon - vCanyon) - pits;
};

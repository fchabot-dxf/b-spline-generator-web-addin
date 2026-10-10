/**
 * Moon (Lunar) 🌑🪐
 * Heavily-cratered airless body — real impact-crater morphology via the
 * shared `craterField` model (bowl floors, raised rims, ejecta aprons,
 * central-peak clusters + terraced walls on complex/basin craters, a
 * power-law size mix, and locally-dominant overlap so a newer crater's
 * rim reads as cutting an older one) plus wide, smooth maria basins with
 * few craters, sinuous rilles confined to those maria, and highland
 * roughness in between.
 *
 * T78 (Fred: "the planet ones aren't planet-like at all, craters don't
 * look like craters either") REWORK, refined against two of Fred's own
 * reference photos (T78 MOON REFERENCE amendments):
 *   - near/far-side photo: wide, irregularly-lobed, slightly LOWER maria
 *     basins with few craters vs saturated, overlapping-crater highlands
 *     (far side has almost no maria) — the new `mariaAmount` tweak (0 =
 *     all highlands, like the far side) controls the near/far-side mix.
 *   - close-up photo: crater TYPES genuinely differ by size (simple bowl
 *     vs terraced-wall-and-central-peak-cluster complex craters vs a
 *     flat-floored, rim-only giant basin peppered with small fresh
 *     craters), doublets, and partly buried/degraded older craters — all
 *     modelled in `craterField.js` (shared with Mars, since Fred's own
 *     dispatch calls Mars's craters "the same crater model").
 *   - bright ray systems are ALBEDO, not relief (explicit in the
 *     amendment) — never modelled as height here.
 *
 * Composition (large → small):
 *   1. Maria/Highlands relief — low-freq FBM drives BOTH the highland
 *                               relief amplitude AND which areas are
 *                               "maria" (a smoothed threshold, shaped by
 *                               `mariaAmount`) — maria settle to a low,
 *                               near-flat floor; highlands keep full,
 *                               rough relief.
 *   2. Crater field         — `craterField()` (shared with Mars), density
 *                             suppressed (not eliminated) inside maria.
 *   3. Sinuous rilles        — sparse fractalRidge2 NEGATIVE channels,
 *                              gated to maria only (rilles only form on
 *                              smooth lava, never on cratered highlands).
 *   4. Regolith dust         — micro FBM grain.
 */
import { craterField } from './craterField.js';

export const id = 'moon';
export const label = 'Moon Surface';
export const cMultiplier = 3.0;
// the photo layer's "Filter shows through" normalises this filter's output by its declared span (core/terrain.js):
// MEASURED 2026-10-10 (seat A), default tweaks, 8 seeds x 7x9 / 9x12 / 12x9 boards, the 0.5 / 99.5 percentiles.
export const nominalRange = [-0.67, 0.27];

export const tweaks = [
  { key: 'highlandHeight', label: 'Highland Height', default: 0.45, min: 0.10, max: 1.00, step: 0.05, desc: 'Highland vs maria amplitude' },
  { key: 'craterDepth',    label: 'Crater Depth',    default: 0.32, min: 0.00, max: 0.70, step: 0.02, desc: 'Overall crater pit depth' },
  { key: 'rimSharpness',   label: 'Rim Sharpness',   default: 0.12, min: 0.00, max: 0.30, step: 0.01, desc: 'Raised crater rim amplitude' },
  { key: 'rilleAmount',    label: 'Rille Amount',    default: 0.06, min: 0.00, max: 0.20, step: 0.01, desc: 'Sinuous lava-channel rilles' },
  // T78 MOON REFERENCE (Fred): "0 = all highlands like the far side" —
  // an old saved pattern with no key at all reads this default (0.55),
  // matching the near-side look every earlier render already showed.
  { key: 'mariaAmount',    label: 'Maria Amount',    default: 0.55, min: 0.00, max: 1.00, step: 0.05, desc: 'How much of the surface is smooth maria vs cratered highlands (0 = all highlands, far-side style)' },
];

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const highlandHeight = t.highlandHeight ?? 0.45;
  const craterDepth    = t.craterDepth    ?? 0.32;
  const rimSharpness   = t.rimSharpness   ?? 0.12;
  const rilleAmount    = t.rilleAmount    ?? 0.06;
  const mariaAmount    = t.mariaAmount    ?? 0.55;

  // ── 1. MARIA / HIGHLANDS RELIEF ────────────────────────────────────
  const cf = scale * 0.40;
  const wx = noiseWarp.fbm(su * 0.7, sv * 0.7, 2) * (warpIntensity * 0.9);
  const wy = noiseWarp.fbm(su * 0.7 + 5, sv * 0.7 + 9, 2) * (warpIntensity * 0.9);
  const reliefRaw = (noiseFine.fbm(su * cf * aspect + wx, sv * cf + wy, 4, 2.0, 0.55) + 1) * 0.5;
  const reliefMask = Math.pow(reliefRaw, 2.0); // 0 = smooth candidate, 1 = rugged highland

  // mariaAmount=0 -> threshold so low almost nothing qualifies (far-side,
  // all-highlands look); mariaAmount=1 -> threshold high enough that most
  // of the smoother half of the surface floods into maria.
  const mariaThreshold = 0.08 + mariaAmount * 0.62;
  const maria = 1 - smoothstep01(mariaThreshold - 0.12, mariaThreshold + 0.12, reliefMask);

  const highlandRelief = reliefMask * highlandHeight;
  // Maria: a low, gently-undulating "flooded" floor -- never perfectly
  // flat (real maria have faint wrinkle-ridge texture), but far smoother
  // and LOWER than the highlands per the reference photo.
  const mariaFloor = highlandHeight * 0.10 + (reliefRaw - 0.5) * 0.05;
  const relief = mariaFloor * maria + highlandRelief * (1 - maria);

  // ── 2. CRATER FIELD (shared with Mars) ─────────────────────────────
  const craters = craterField(noiseFine, su, sv, aspect, scale, {
    craterDepth: craterDepth / 0.32,
    rimHeight: rimSharpness / 0.12,
    mariaGate: maria,
  });

  // ── 3. SINUOUS RILLES (maria only) ─────────────────────────────────
  const rf = scale * 1.8;
  const rwx = noiseWarp.fbm(su * 1.2, sv * 1.2, 3) * (warpIntensity * 1.2);
  const rwy = noiseWarp.fbm(su * 1.2 + 4, sv * 1.2 + 7, 3) * (warpIntensity * 1.2);
  const rilleRaw = noiseFine.fractalRidge2((su + rwx) * rf * aspect, (sv + rwy) * rf, 4);
  const rilleThresh = Math.max(0, rilleRaw - 0.55) * 2.5;
  const rilles = -Math.pow(rilleThresh, 1.6) * rilleAmount * maria;

  // ── 4. REGOLITH DUST ───────────────────────────────────────────────
  const dustRaw = (noiseFine.fbm(su * scale * 18.0 * aspect, sv * scale * 18.0, 3, 2.0, 0.45) + 1) * 0.5;
  const dust = (dustRaw - 0.5) * 0.035;

  return relief + craters + rilles + dust;
};

function smoothstep01(a, b, x) {
  const tt = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return tt * tt * (3 - 2 * tt);
}

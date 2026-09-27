/**
 * Anatomical (Chest) 🧘‍♂️🧬
 * A lean torso, skin stretched over bone — a visible ribcage, sternum
 * ridge + xiphoid, costal margin, clavicles, a sunken abdomen with faint
 * ab lines and hip bones, and a real skin layer (fine creases + subtle
 * pore texture) on top. Front-facing only (this is a height field, not a
 * full 3D body).
 *
 * T78 item 7 (Fred, THREE rounds of direction on this filter):
 *   1. "the anatomical filter needs work done too" -- first direction was
 *      a believable MUSCLE relief (pecs/abs/rib striations).
 *   2. SUPERSEDED immediately (Fred: "I'd want it to be more skin and
 *      bony like") -- the actual target: lean torso, skin over BONE.
 *   3. T78 ANATOMICAL REFERENCE (a real photo of an emaciated torso, FORM
 *      only): confirmed/refined #2 -- prominent clavicles with hollows;
 *      ribs as separate raised bands down BOTH FLANKS, strongest at the
 *      sides, fading toward the front/centre; a sternum line down the
 *      centre with the chest flattened either side; a SUNKEN abdomen
 *      (faint ab lines, not blocks) with a hollow navel; the iliac crest
 *      (hip bones) jutting at the waist; thin skin over everything, bony
 *      edges reading through SOFTLY, never hard-edged.
 *
 * This file implements direction #3 only -- the muscle-mound version
 * (direction #1) never shipped.
 *
 * URGENT AMEND (Fred, via the advisor): the board's default symmetry is
 * 'x' (core/state.js), which means terrain.js ALREADY folds the surface
 * coordinate before calling ANY filter's own fn() -- `su` arrives pre-
 * folded to `|u - 0.5| * 2`, i.e. `su` already IS "distance from the
 * board centreline, 0..1" by the time this file ever sees it. A first
 * version of this file re-folded that same value again (`dx = |su*2-1|`),
 * which put the sternum at su=0.5 (a fold-of-a-fold) instead of su=0, and
 * doubled the whole ribcage into a mirrored pair INSIDE what was already
 * one half of the board -- terrain.js's own outer mirror then doubled
 * THAT again, so the rendered board showed four repeats, not one torso.
 * This file now builds only the HALF-TORSO terrain.js expects: `dx = su`
 * directly (0 at the sternum, 1 at the flank) -- no internal fold at all.
 * A different noiseType/board with symmetry:'none' would see this exact
 * same half-torso un-mirrored (by design -- this file draws only ITS OWN
 * half regardless of what the board does with it afterwards).
 *
 * Local coordinates:
 *   dx = su  -- 0 at the sternum centreline, 1 at the torso edge/flank
 *   dy = sv  -- 0 at the neck/top, 1 at the waist/bottom
 *
 * Composition (skeleton -> skin):
 *   1. Silhouette   — neck, clavicles, deltoids (structural shape only,
 *                     not muscle mass).
 *   2. Sternum ridge — a raised centreline strip, tapering to the xiphoid.
 *   3. Ribcage       — 6-9 curved raised bands (count varies per seed)
 *                      sweeping down-and-out from the sternum, strongest
 *                      at the flanks, fading to near-zero at the centre;
 *                      intercostal grooves are the natural gaps between
 *                      adjacent bands. Angle, spacing, and lateral reach
 *                      also vary per seed (see the T78 AMEND note below).
 *   4. Costal margin — one more prominent arc (curving the OPPOSITE way
 *                      from the ribs -- upward toward the sides) marking
 *                      where the ribcage ends.
 *   5. Abdomen       — SUNKEN (concave), faint ab lines, a hollow navel.
 *   6. Iliac crest   — two ridges jutting at the waist sides.
 *   7. Skin layer    — fine creases/folds across the bands + a subtle
 *                      pore/stretch-texture FBM grain, smoothing every
 *                      transition rather than leaving hard edges.
 */
export const id = 'chest';
export const label = 'Anatomical';
export const cMultiplier = 1.8;

export const tweaks = [
  // T78 item 7: tweak KEYS kept for saved projects; MEANING changed to
  // match the new skin-over-bone model (documented per-key below).
  { key: 'pectoralStrength', label: 'Soft Tissue',     default: 0.12, min: 0.00, max: 0.40, step: 0.02, desc: 'Overall flesh thickness over the skeleton (was pectoral mound height)' },
  { key: 'absStrength',      label: 'Abdomen',         default: 0.10, min: 0.00, max: 0.30, step: 0.01, desc: 'Sunken-abdomen depth + faint ab lines (was six-pack mound depth)' },
  { key: 'ribStrength',      label: 'Rib Prominence',  default: 0.14, min: 0.00, max: 0.30, step: 0.01, desc: 'Ribcage + costal margin height -- the MAIN control now (was side-rib striation amplitude)' },
  { key: 'skinDetail',       label: 'Skin Detail',     default: 0.06, min: 0.00, max: 0.20, step: 0.01, desc: 'Fine skin creases + pore/stretch texture' },
];

function smoothstep01(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function gaussianBand(d, width) {
  return Math.exp(-(d * d) / (2 * width * width));
}

// T78 AMEND (Fred: "I want the structure to reshuffle" -- "angle of ribs,
// size, extent"): the skeleton was near-fully deterministic across seeds
// (only fine skin texture varied), which is wrong for a filter that's
// meant to reroll like every other one. `hashInt`/`seedRandom` (the same
// integer-bit-mixing technique craterField.js already uses for Moon/Mars,
// duplicated here rather than shared since chest.js has no natural import
// relationship with that file) derive a few per-seed structural draws from
// the caller's own already-seeded `noiseFine`, so the SKELETON itself
// (not just its surface grain) now varies with the terrain's own seed:
// rib angle (how steeply they sweep down toward the flank), rib size
// (spacing between adjacent ribs, i.e. how "long" the ribcage reads), and
// rib extent (how many ribs / how far down the torso the ribcage runs).
function hashInt(x) {
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = x ^ (x >>> 16);
  return x >>> 0;
}
function seedRandom(noiseFine, salt) {
  const f = noiseFine.noise2(0.5173 + salt * 3.71, 0.7291 + salt * 5.13);
  return hashInt(Math.floor((f * 0.5 + 0.5) * 0xffffffff) | 0) / 4294967296;
}

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, octaves, roughness, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const softTissue = t.pectoralStrength ?? 0.12;
  const absStrength = t.absStrength ?? 0.10;
  const ribStrength = t.ribStrength ?? 0.14;
  const skinDetail = t.skinDetail ?? 0.06;

  // T78 AMEND (Fred: "I want the structure to reshuffle" -- rib angle/
  // size/extent/count, then "clavicular same size, extent, angle"): per-
  // seed structural draws, NOT tweaks (they're not user-facing controls,
  // just what makes the skeleton itself vary with the terrain's own seed
  // instead of only its surface texture).
  const ribCount = 6 + Math.floor(seedRandom(noiseFine, 1) * 4); // 6..9 ribs
  // Angle allows the OPPOSITE sign too (Fred) -- some seeds curve the ribs
  // UP toward the flank instead of down, not just varying how steeply they
  // slope in the one anatomically-typical direction.
  const ribAngle = -0.22 + seedRandom(noiseFine, 2) * 0.44; // -0.22..0.22, sign varies per seed
  const ribSize = 0.045 + seedRandom(noiseFine, 3) * 0.030; // spacing between ribs (also scales each rib's own band width)
  const ribBandWidth = ribSize * 0.26; // stays well under half the spacing (see the T78 tuning note below) regardless of ribSize
  const ribExtent = 0.24 + seedRandom(noiseFine, 4) * 0.26; // how far laterally ribs must reach before hitting full strength -- smaller = ribs cover MORE of the flank
  const ribStartY = 0.14 + seedRandom(noiseFine, 5) * 0.05; // where the ribcage begins, just below the clavicles

  const clavicleAngle = -0.10 + seedRandom(noiseFine, 6) * 0.20; // slope from neck to shoulder -- sign varies per seed too
  const clavicleSize = 10.0 + seedRandom(noiseFine, 7) * 8.0; // band sharpness -- LOWER reads as a bigger/thicker clavicle
  const clavicleExtent = 1.0 + seedRandom(noiseFine, 8) * 1.2; // lateral decay rate -- LOWER reaches further toward the shoulder

  // su arrives already fold-mirrored by terrain.js (default symmetry:'x'):
  // 0 at the board centreline, 1 at the board edge. No internal re-fold.
  const dx = su; // 0 at sternum centreline, 1 at torso edge/flank
  const dy = sv; // 0 at neck, 1 at waist

  // ── 1. SILHOUETTE (structural shape, not muscle) ────────────────────
  const neck = Math.exp(-(dx * dx) * 40.0) * Math.max(0, 1.0 - dy * 7.0) * 0.30;
  const clavicle = Math.max(0, 1.0 - Math.abs(dy - (0.12 + dx * clavicleAngle)) * clavicleSize) * Math.exp(-dx * clavicleExtent) * 0.18;
  const deltoid = gaussianBand(dx - 0.9, 0.18) * gaussianBand(dy - 0.22, 0.14) * 0.30;

  // ── 2. STERNUM RIDGE + XIPHOID ──────────────────────────────────────
  // A raised centreline strip from just below the clavicles down to
  // where the ribcage ends, tapering off (the xiphoid point) rather than
  // stopping abruptly.
  const sternumBand = gaussianBand(dx, 0.055);
  const sternumLengthMask = smoothstep01(0.10, 0.16, dy) * (1 - smoothstep01(0.46, 0.58, dy));
  const sternumRidge = sternumBand * sternumLengthMask * 0.22;

  // ── 3. RIBCAGE (curved bands, strongest at the flanks) ──────────────
  // Each rib sweeps DOWN and OUT from the sternum (a quadratic arc in dx)
  // -- ribFrontFade suppresses the whole ribcage near the centreline
  // (per the reference: "fading toward the front") and the sternum ridge
  // covers that same region instead.
  const ribFrontFade = smoothstep01(0.06, ribExtent, dx);
  const ribJitter = noiseFine.noise2(su * 6.0, sv * 6.0) * 0.012; // organic irregularity, not a perfect arc
  let ribcage = 0;
  for (let k = 0; k < ribCount; k++) {
    const ribY = ribStartY + k * ribSize + ribAngle * dx * dx + ribJitter;
    ribcage += gaussianBand(dy - ribY, ribBandWidth);
  }
  // Ribs fade out again near the very bottom of the ribcage span (the
  // costal margin below takes over there instead of another plain rib).
  const ribSpanFade = 1 - smoothstep01(0.50, 0.60, dy);
  ribcage *= ribFrontFade * ribSpanFade * ribStrength;

  // ── 4. COSTAL MARGIN (the lower rib-cage arch) ──────────────────────
  // One more prominent band curving the OPPOSITE way from the ribs above
  // it (upward toward the flanks), marking the classic inverted-V where
  // the ribcage ends and the abdomen begins.
  const marginBaseY = ribStartY + ribCount * ribSize;
  const marginY = marginBaseY - 0.12 * dx * dx + ribJitter;
  const costalMargin = gaussianBand(dy - marginY, 0.020) * ribFrontFade * ribStrength * 1.25;

  // ── 5. ABDOMEN (sunken, faint ab lines, hollow navel) ───────────────
  const abdomenMask = smoothstep01(marginBaseY - 0.02, marginBaseY + 0.10, dy);
  const abdomenConcavity = -absStrength * abdomenMask * (1 - dx * 0.55);
  const abLineWarp = noiseFine.noise2(su * 3.0, sv * 3.0) * 1.2;
  const abLines = Math.sin((dy + abLineWarp * 0.03) * 11.0) * absStrength * 0.10 * abdomenMask * (1 - dx * 0.6);
  const navelDx = dx; const navelDy = dy - 0.80;
  const navelDist2 = navelDx * navelDx * 30.0 + navelDy * navelDy * 90.0;
  const navel = -Math.exp(-navelDist2) * absStrength * 0.6;
  const abdomen = abdomenConcavity + abLines + navel;

  // ── 6. ILIAC CREST (hip bones jutting at the waist) ─────────────────
  const iliacY = 0.90 - dx * 0.16;
  const iliacCrest = gaussianBand(dy - iliacY, 0.022) * smoothstep01(0.22, 0.55, dx) * ribStrength * 1.1;

  // ── 7. SOFT TISSUE (a gentle flesh layer, not a muscle mound) ───────
  const softTissueLayer = gaussianBand(dx - 0.25, 0.55) * gaussianBand(dy - 0.35, 0.45) * softTissue;

  // ── 8. SKIN LAYER (fine creases + pore/stretch texture) ─────────────
  // T78 tuning: a first attempt used a much higher spatial frequency
  // (26x) which, even at a tiny nominal amplitude, produced a steep
  // per-vertex slope that flat mesh shading turned into a dominant,
  // distracting stripe pattern (slope ~ amplitude x frequency, and a
  // high frequency wins that multiplication even at low amplitude) --
  // caught by rendering, not by reasoning about the numbers alone. A
  // gentler, lower-frequency crease (a handful of broad folds, not fine
  // engraved lines) reads as skin instead.
  const foldWarp = noiseFine.noise2(su * 5.0, sv * 5.0) * 0.6;
  const folds = Math.sin(dy * 9.0 + dx * 1.2 + foldWarp) * skinDetail * 0.06;
  const poreF = scale * 22.0;
  const poreRaw = (noiseFine.fbm(su * poreF * aspect, sv * poreF, Math.min(3, octaves ?? 3), 2.0, roughness ?? 0.5) + 1) * 0.5;
  const pores = (poreRaw - 0.5) * skinDetail;

  // Broad warped skin drape (kept from the old file, much smaller weight
  // now that bone structure carries most of the relief).
  const f = scale * 2.5;
  const swarp = warpIntensity * 0.5;
  const wx = noiseWarp.noise2(su * 2.5, sv * 2.5) * swarp;
  const wz = noiseWarp.noise2(su * 2.5 + 5, sv * 2.5 + 2) * swarp;
  const drape = (noiseFine.fbm((su + wx) * f * aspect, (sv + wz) * f, octaves ?? 4, 2.0, roughness ?? 0.5) + 1.0) * 0.5;

  return neck + clavicle + deltoid + sternumRidge + ribcage + costalMargin
    + abdomen + iliacCrest + softTissueLayer + folds + pores + (drape - 0.5) * 0.08;
};

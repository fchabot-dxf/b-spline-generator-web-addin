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
 * Local coordinates (same convention the old file used):
 *   dx = |su*2 - 1|  -- 0 at the sternum centreline, 1 at the torso edge
 *   dy = sv          -- 0 at the neck/top, 1 at the waist/bottom
 *
 * Composition (skeleton -> skin):
 *   1. Silhouette   — neck, clavicles, deltoids (structural shape only,
 *                     not muscle mass).
 *   2. Sternum ridge — a raised centreline strip, tapering to the xiphoid.
 *   3. Ribcage       — 7 curved raised bands sweeping down-and-out from
 *                      the sternum, strongest at the flanks, fading to
 *                      near-zero at the centre; intercostal grooves are
 *                      the natural gaps between adjacent bands.
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

const NUM_RIBS = 7;
const RIB_START_Y = 0.16; // just below the clavicles
const RIB_SPACING = 0.058;
// T78 tuning: a first attempt used RIB_BAND_WIDTH:0.028 against this same
// spacing -- a gaussian's own visually-significant extent runs several
// widths, so adjacent ribs' bands overlapped enough to merge into one
// solid mound with no visible grooves at all (confirmed with a direct
// grayscale heightmap dump, not by eyeballing a lit 3D render, which
// hid the problem under shading). Narrowed well below half the spacing
// so each rib reads as a separate raised band with a real intercostal
// groove between it and its neighbors.
const RIB_BAND_WIDTH = 0.014;
const RIB_CURVE = 0.20; // ribs slope DOWNWARD as they sweep toward the flank

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, octaves, roughness, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const softTissue = t.pectoralStrength ?? 0.12;
  const absStrength = t.absStrength ?? 0.10;
  const ribStrength = t.ribStrength ?? 0.14;
  const skinDetail = t.skinDetail ?? 0.06;

  const dx = Math.abs(su * 2 - 1); // 0 at sternum centreline, 1 at torso edge
  const dy = sv; // 0 at neck, 1 at waist

  // ── 1. SILHOUETTE (structural shape, not muscle) ────────────────────
  const neck = Math.exp(-(dx * dx) * 40.0) * Math.max(0, 1.0 - dy * 7.0) * 0.30;
  const clavicle = Math.max(0, 1.0 - Math.abs(dy - (0.12 + dx * 0.10)) * 14.0) * Math.exp(-dx * 1.5) * 0.18;
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
  const ribFrontFade = smoothstep01(0.06, 0.38, dx);
  const ribJitter = noiseFine.noise2(su * 6.0, sv * 6.0) * 0.012; // organic irregularity, not a perfect arc
  let ribcage = 0;
  for (let k = 0; k < NUM_RIBS; k++) {
    const ribY = RIB_START_Y + k * RIB_SPACING + RIB_CURVE * dx * dx + ribJitter;
    ribcage += gaussianBand(dy - ribY, RIB_BAND_WIDTH);
  }
  // Ribs fade out again near the very bottom of the ribcage span (the
  // costal margin below takes over there instead of another plain rib).
  const ribSpanFade = 1 - smoothstep01(0.50, 0.60, dy);
  ribcage *= ribFrontFade * ribSpanFade * ribStrength;

  // ── 4. COSTAL MARGIN (the lower rib-cage arch) ──────────────────────
  // One more prominent band curving the OPPOSITE way from the ribs above
  // it (upward toward the flanks), marking the classic inverted-V where
  // the ribcage ends and the abdomen begins.
  const marginBaseY = RIB_START_Y + NUM_RIBS * RIB_SPACING;
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

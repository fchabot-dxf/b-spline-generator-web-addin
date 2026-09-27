/**
 * Anatomical (Chest) 🧘‍♂️🧬
 * A lean torso, skin stretched over bone — a visible ribcage, sternum
 * ridge + xiphoid, costal margin, clavicles, a sunken abdomen with faint
 * ab lines, and a real skin layer (fine creases + subtle
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
 *   dx = su^build  -- 0 at the sternum centreline, 1 at the torso edge/flank
 *   dy = 1 - sv    -- 0 at the neck, 1 at the waist (sv=0 is the bottom
 *                     edge of the board as rendered, so the neck end is
 *                     measured from sv=1 to put it at the top)
 *
 * Composition (skeleton -> skin), in three stacked canvas sections:
 *   1. Shoulders     — neck, clavicles, deltoids.
 *   2. Ribcage       — sternum (raised or carved), curved rib bands
 *                      (strongest at the flanks, fading toward the centre),
 *                      and the costal margin where the ribcage ends.
 *   3. Abdomen       — SUNKEN (concave), faint ab lines, a hollow navel.
 *                      No hip bones (Fred removed them in T78 AMEND 8).
 *   Skin layer on top of everything — fine creases/folds + a subtle
 *   pore/stretch-texture FBM grain, smoothing every transition.
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
  // Fred: -30..+10 degrees around each seed's own rib angle.
  { key: 'ribAngle',         label: 'Rib Angle',       default: 0,    min: -30,  max: 10,   step: 1,    desc: 'Turns the ribs around this seed\'s own angle, in degrees (0 = the seed\'s own look; + sweeps down, - sweeps up)' },
];

function smoothstep01(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function gaussianBand(d, width) {
  return Math.exp(-(d * d) / (2 * width * width));
}

// Per-seed structural draws from the caller's own seeded noiseFine (raw
// Perlin output isn't uniform, so it's bit-mixed first -- the same
// technique craterField.js uses for Moon/Mars).
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

// T78 AMEND 8 (Fred): every part varies per seed, in three stacked canvas
// sections -- shoulders, ribcage, abdomen. A section starts where the one
// above ends and every part is faded to its own section's window, so no part
// can draw inside another section. Each section has one LEAD angle; only
// ANGLES follow a neighbour (costal margin <- ribs),
// every other parameter is its own independent draw. Levels and tilts are
// fractions of the section's own height; a part may reach its section's edge
// and fade there, but never crosses into the next section.
//
// name: [salt, min, max]. Salts are fixed per row so adding a row never
// reshuffles the others. Per-rib rows add the rib index to the salt.
const VARY = {
  shouldersHeight:   [1, 0.18, 0.32],
  ribcageHeight:     [2, 0.60, 0.85],   // fraction of the board left below the shoulders (abdomen gets the rest)
  build:             [3, 0.65, 1.55],   // lateral power curve: lean .. broad

  // 1. SHOULDERS -- lead angle: clavicle
  clavicleLevel:     [4, 0.35, 0.65],   // fraction of section, at the centreline
  clavicleTilt:      [5, -0.60, 0.60],  // fraction of section, centre -> flank
  clavicleCurve:     [25, 0.6, 2.0],    // tilt shape across the width (dx^p)
  clavicleWidth:     [6, 0.06, 0.15],   // fraction of section
  clavicleReach:     [7, 0.2, 1.4],     // lateral decay rate, lower = reaches further
  clavicleStrength:  [31, 0.5, 1.5],
  // Fred: keep the current long band, but also allow the look of the old
  // hip-bone bump -- a short bold bar from partway out to the shoulder.
  // 0 = long band, 1 = bump; pushed toward the ends so most seeds are one
  // clear style rather than a blend.
  clavicleBump:      [46, 0, 1],
  clavicleBumpStart: [47, 0.15, 0.50],  // dx where the bump bar begins
  neckWidth:         [8, 20, 70],       // lateral falloff, higher = thinner
  neckLength:        [9, 0.3, 0.9],     // fraction of section
  neckStrength:      [30, 0.4, 1.3],
  deltoidPos:        [10, 0.60, 0.98],
  deltoidLevel:      [11, 0.20, 0.90],  // fraction of section
  deltoidSize:       [12, 0.08, 0.32],
  deltoidStrength:   [32, 0.3, 1.4],

  // 2. RIBCAGE -- lead angle: ribs
  ribCount:          [13, 3, 8],        // floored -> 3..7 (Fred), capped by the room left
  // Absolute (board fraction), not a share of the ribcage. Ranges marked
  // (Fred) below are narrowed to the seeds he approved: seeds 2/3/42/77
  // ("love these ribs") vs 6/18/11/1/123.
  ribBend:           [14, -0.07, 0.07], // rise/drop at the flank (Fred)
  ribCurve:          [26, 1.3, 3.0],    // bend shape across the width (dx^p)
  ribFan:            [27, -0.25, 0.25], // lower ribs bend more (+) or less (-)
  ribReach:          [15, 0.05, 0.70],  // dx where ribs reach full strength
  ribProminence:     [34, 1.0, 1.4],    // (Fred)
  ribSize:           [41, 0.18, 0.34],  // band width as a fraction of its gap (Fred)
  // Fred: "a lot more gradual variation". Rib to rib, gaps and thickness
  // follow a smooth trend down the stack with only a little per-rib jitter;
  // along each rib, height and thickness swell and thin gradually.
  ribGapTrend:       [42, -0.45, 0.45], // gaps grow (+) or shrink (-) down the stack
  ribSizeTrend:      [43, -0.35, 0.35], // ribs thicken (+) or thin (-) down the stack
  ribGap:            [100, -1, 1],      // per rib: small jitter on the gap trend
  ribThickness:      [120, -1, 1],      // per rib: small jitter on the size trend
  ribSwing:          [44, 0.10, 0.55],  // height/thickness change along each rib
  ribWaves:          [45, 1.5, 2.5],    // swells along each rib (Fred)
  marginBendJitter:  [16, -0.05, 0.05], // costal margin = lowest rib's bend + this (fraction of section)
  marginWidth:       [17, 0.012, 0.032],
  marginStrength:    [35, 0.6, 1.7],
  // Sternum: depth is an absolute height, negative = carved into the
  // surface. The range's midpoint is below zero (Fred: "allow the range
  // median depth to be below surface to look carved").
  sternumDepth:      [37, -0.20, 0.12],
  sternumDepthSwing: [38, 0.02, 0.12],  // depth change along its length
  sternumWidthSwing: [40, 0.0, 0.5],    // width change along its length
  sternumWaves:      [39, 1.5, 5.0],    // bumps along its length
  sternumWidth:      [18, 0.015, 0.05],
  sternumStart:      [19, 0.3, 1.0],    // fraction of the shoulders section
  sternumEnd:        [20, 0.4, 1.0],    // fraction of the ribcage section

  // 3. ABDOMEN -- lead angle: ab lines (no hip bones, Fred)
  abLineTilt:        [22, -0.70, 0.35], // fraction of section, centre -> flank
  navelLevel:        [24, 0.10, 0.60],  // fraction of section
  navelSize:         [29, 0.6, 1.6],
};

// Fred: "more spaced". The ribs claim this much room each first; whatever is
// left is what the bend may use. Every seed Fred marked bad had a mean rib
// gap <= 0.072; every seed he loved or passed had >= 0.075.
const MIN_RIB_SPACING = 0.075;
// Relief reads through slope, so a wide rib at the same height looks flat.
// Rib height scales with width around this reference, within these limits.
const RIB_REFERENCE_WIDTH = 0.015;
const RIB_HEIGHT_LIMITS = [0.8, 3.0];

function vary(noiseFine, [salt, lo, hi], index = 0) {
  return lo + seedRandom(noiseFine, salt + index) * (hi - lo);
}

const layoutCache = new WeakMap();
function layout(noiseFine, ribAngleDeg = 0, aspect = 7 / 9) {
  let perSeed = layoutCache.get(noiseFine);
  if (!perSeed) {
    perSeed = new Map();
    layoutCache.set(noiseFine, perSeed);
  }
  const cacheKey = `${ribAngleDeg}|${aspect}`;
  const cached = perSeed.get(cacheKey);
  if (cached) return cached;
  const v = (name, index) => vary(noiseFine, VARY[name], index);

  const h1 = v('shouldersHeight');
  const h2 = (1 - h1) * v('ribcageHeight');
  const top2 = h1;
  const top3 = h1 + h2;
  const h3 = 1 - top3;

  const clavicleLevel = v('clavicleLevel');
  const clavicleTilt = v('clavicleTilt');
  const clavicleCurve = v('clavicleCurve');

  // The ribs claim their spacing first; the bend gets the room that's left,
  // scaled (not clamped) so the whole bend range shrinks for a crowded
  // ribcage instead of piling seeds up at a limit. The stack then gives up
  // exactly as much height as its most-bent rib needs, so every rib's full
  // curve stays inside the ribcage section. The last slot of the stack is
  // the costal margin.
  const ribFan = v('ribFan');
  const ribCount = Math.max(3, Math.min(Math.floor(v('ribCount')), Math.floor((h2 * 0.92) / MIN_RIB_SPACING) - 1));
  const bendRoom = Math.max(0, h2 * 0.92 - (ribCount + 1) * MIN_RIB_SPACING);
  const maxReserve = VARY.ribBend[2] * (1 + Math.abs(ribFan));
  const ribBend = v('ribBend') * Math.min(1, bendRoom / maxReserve);

  // The Rib Angle tweak turns the whole ribcage around the seed's own angle,
  // measured sternum -> flank across the real half-width (bend is in board
  // heights, so slope = bend / (aspect / 2)). The extra turn is NOT squeezed
  // into the section (that collapsed most seeds to 3 ribs and still fell
  // short of the angle); instead the ribcage/abdomen boundary bends with it.
  let ribTurn = 0;
  if (ribAngleDeg !== 0) {
    const halfWidth = aspect / 2;
    const seedAngle = Math.atan(ribBend / halfWidth);
    const turned = Math.max(-1.4, Math.min(1.4, seedAngle + (ribAngleDeg * Math.PI) / 180));
    ribTurn = Math.tan(turned) * halfWidth - ribBend;
  }
  const reserve = Math.abs(ribBend) * (1 + Math.abs(ribFan));
  const usable = h2 * 0.92 - reserve;
  const ribStart = top2 + Math.max(0, -ribBend) * (1 + Math.abs(ribFan));
  const stackPos = (i) => (i / ribCount) * 2 - 1; // -1 top rib .. +1 costal margin
  const gapTrend = v('ribGapTrend');
  const sizeTrend = v('ribSizeTrend');
  const gaps = [];
  for (let i = 0; i <= ribCount; i++) gaps.push(Math.max(0.4, 1 + gapTrend * stackPos(i) + 0.12 * v('ribGap', i)));
  const gapTotal = gaps.reduce((a, b) => a + b, 0);
  const ribSize = v('ribSize');
  const ribs = [];
  let acc = 0;
  for (let i = 0; i <= ribCount; i++) {
    acc += gaps[i];
    const thickness = 1 + sizeTrend * stackPos(i) + 0.08 * v('ribThickness', i);
    const width = usable * (gaps[i] / gapTotal) * ribSize * thickness;
    ribs.push({
      y0: ribStart + usable * (acc - 0.3 * gaps[i]) / gapTotal,
      width,
      height: Math.min(RIB_HEIGHT_LIMITS[1], Math.max(RIB_HEIGHT_LIMITS[0], width / RIB_REFERENCE_WIDTH)),
      bend: ribBend * (1 + ribFan * stackPos(i)),
      swellRow: 40 + i * 7.1,
    });
  }
  const margin = ribs.pop();

  const sternumStart = h1 * v('sternumStart');
  const sternumEnd = top2 + h2 * v('sternumEnd');
  const sternumDepth = v('sternumDepth');
  const sternumDepthSwing = v('sternumDepthSwing');
  const sternumWidth = v('sternumWidth');
  const sternumWidthSwing = v('sternumWidthSwing');
  const sternumFreq = v('sternumWaves') / (sternumEnd - sternumStart);
  const alongSternum = (dy, offset) => noiseFine.noise2((dy - sternumStart) * sternumFreq, offset) * 1.4;

  const L = {
    h1, top2, h2, top3, h3,
    build: v('build'),
    clavicleY: (dx) => h1 * (clavicleLevel + clavicleTilt * Math.pow(dx, clavicleCurve)),
    clavicleWidth: h1 * v('clavicleWidth'),
    clavicleReach: v('clavicleReach'),
    clavicleStrength: v('clavicleStrength'),
    clavicleBump: smoothstep01(0.3, 0.7, v('clavicleBump')),
    clavicleBumpStart: v('clavicleBumpStart'),
    neckWidth: v('neckWidth'),
    neckEnd: h1 * v('neckLength'),
    neckStrength: v('neckStrength'),
    deltoidPos: v('deltoidPos'),
    deltoidY: h1 * v('deltoidLevel'),
    deltoidSize: v('deltoidSize'),
    deltoidStrength: v('deltoidStrength'),
    ribs, ribCount, ribBend, ribFan, ribTurn,
    // How far the ribcage (and the ribcage/abdomen boundary) moves down at a
    // given rib-curve position, from the Rib Angle tweak. A down-sweep drops
    // the flank ends; an up-sweep keeps the flank ends and drops the centre,
    // where the ribs are faded anyway, so the shoulders are never touched.
    turnShift: (shape) => (ribTurn > 0 ? ribTurn * shape : -ribTurn * (1 - shape)),
    ribCurve: v('ribCurve'),
    ribSwing: v('ribSwing'),
    ribWaves: v('ribWaves'),
    ribReach: v('ribReach'),
    ribProminence: v('ribProminence'),
    marginApex: margin.y0,
    marginBend: margin.bend + v('marginBendJitter') * h2,
    marginWidth: v('marginWidth'),
    marginStrength: v('marginStrength'),
    sternumStart, sternumEnd, sternumDepth,
    sternumDepthAt: (dy) => sternumDepth + sternumDepthSwing * alongSternum(dy, 17.3),
    sternumWidthAt: (dy) => sternumWidth * Math.max(0.3, 1 + sternumWidthSwing * alongSternum(dy, 29.1)),
    abLineTilt: v('abLineTilt') * h3,
    navelY: top3 + h3 * v('navelLevel'),
    navelSize: v('navelSize'),
  };
  perSeed.set(cacheKey, L);
  return L;
}
export const _layout = layout;

const SECTION_EDGE = 0.025;
function sectionWindow(dy, from, to) {
  return smoothstep01(from - SECTION_EDGE, from + SECTION_EDGE, dy)
    * (1 - smoothstep01(to - SECTION_EDGE, to + SECTION_EDGE, dy));
}

export const fn = (su, sv, aspect, params, noiseRefs) => {
  const { scale, octaves, roughness, warpIntensity } = params;
  const { noiseFine, noiseWarp } = noiseRefs;
  const t = params.tweaks ?? {};
  const softTissue = t.pectoralStrength ?? 0.12;
  const absStrength = t.absStrength ?? 0.10;
  const ribStrength = t.ribStrength ?? 0.14;
  const skinDetail = t.skinDetail ?? 0.06;

  const L = layout(noiseFine, t.ribAngle ?? 0, aspect);
  const dx = Math.pow(su, L.build);
  const dy = 1 - sv;

  // ── 1. SHOULDERS ────────────────────────────────────────────────────
  const neck = Math.exp(-(dx * dx) * L.neckWidth) * Math.max(0, 1 - dy / L.neckEnd) * 0.20 * L.neckStrength;
  const bandReach = Math.exp(-dx * L.clavicleReach);
  const bumpReach = smoothstep01(L.clavicleBumpStart, L.clavicleBumpStart + 0.25, dx);
  const clavicleReach = bandReach + (bumpReach - bandReach) * L.clavicleBump;
  const clavicle = gaussianBand(dy - L.clavicleY(dx), L.clavicleWidth) * clavicleReach * 0.24 * L.clavicleStrength;
  const deltoid = gaussianBand(dx - L.deltoidPos, L.deltoidSize) * gaussianBand(dy - L.deltoidY, L.h1 * 0.22) * 0.18 * L.deltoidStrength;
  const shoulders = (neck + clavicle + deltoid) * sectionWindow(dy, -1, L.top2);

  // ── 2. RIBCAGE ──────────────────────────────────────────────────────
  // The sternum is a centreline strip running from the shoulders into the
  // ribcage; it can't collide with anything, so it isn't windowed. Its
  // width is measured on su, not dx: build>1 flattens dx near the centre
  // and turned it into a wide block.
  const sternumLength = smoothstep01(L.sternumStart, L.sternumStart + 0.04, dy)
    * (1 - smoothstep01(L.sternumEnd - 0.06, L.sternumEnd, dy));
  const sternum = sternumLength > 0
    ? gaussianBand(su, L.sternumWidthAt(dy)) * sternumLength * L.sternumDepthAt(dy)
    : 0;

  // A short ramp left a hard vertical edge on wide ribs; keep it gradual.
  const ribFrontFade = smoothstep01(0.02, L.ribReach + 0.15, dx);
  const ribJitter = noiseFine.noise2(su * 6.0, sv * 6.0) * 0.012;
  const bendShape = Math.pow(dx, L.ribCurve);
  const turnShift = L.turnShift(bendShape);
  const ribcageBottom = L.top3 + turnShift;
  let ribcage = 0;
  for (const rib of L.ribs) {
    const swell = 1 + L.ribSwing * noiseFine.noise2(dx * L.ribWaves, rib.swellRow) * 1.4;
    ribcage += gaussianBand(dy - (rib.y0 + rib.bend * bendShape + turnShift + ribJitter), rib.width * Math.max(0.4, 1 + 0.6 * (swell - 1)))
      * Math.max(0, swell) * rib.height;
  }
  ribcage *= ribFrontFade * ribStrength * L.ribProminence;
  const marginY = L.marginApex + L.marginBend * bendShape + turnShift + ribJitter;
  const costalMargin = gaussianBand(dy - marginY, L.marginWidth) * ribFrontFade * ribStrength * 1.25 * L.marginStrength;
  const ribcageSection = (ribcage + costalMargin) * sectionWindow(dy, L.top2, ribcageBottom);

  // ── 3. ABDOMEN (sunken, faint ab lines, hollow navel) ───────────────
  const abdomenMask = smoothstep01(ribcageBottom - 0.02, ribcageBottom + 0.10, dy);
  const abdomenConcavity = -absStrength * abdomenMask * (1 - dx * 0.55);
  const abLineWarp = noiseFine.noise2(su * 3.0, sv * 3.0) * 1.2;
  const abLineDy = dy - L.abLineTilt * dx;
  const abLines = Math.sin((abLineDy + abLineWarp * 0.03) * 11.0) * absStrength * 0.10 * abdomenMask * (1 - dx * 0.6);
  const navelDy = dy - (L.navelY + L.turnShift(0));
  const navelSize2 = L.navelSize * L.navelSize;
  const navel = -Math.exp(-(dx * dx * 30.0 + navelDy * navelDy * 90.0) / navelSize2) * absStrength * 0.6;
  const abdomenSection = (abdomenConcavity + abLines + navel) * sectionWindow(dy, ribcageBottom, 2);

  // ── SOFT TISSUE (a gentle flesh layer, not a muscle mound) ──────────
  const softTissueLayer = gaussianBand(dx - 0.25, 0.55) * gaussianBand(dy - 0.35, 0.45) * softTissue;

  // ── SKIN LAYER (fine creases + pore/stretch texture) ────────────────
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

  return shoulders + sternum + ribcageSection + abdomenSection
    + softTissueLayer + folds + pores + (drape - 0.5) * 0.08;
};

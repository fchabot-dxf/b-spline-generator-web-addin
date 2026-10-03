/**
 * editor-shape-lattice-generator.js — SE14 Slice 1 (T53/T54), REPLACED
 * for T55: the pure silhouette generator, now a declared PRESET table
 * (hourglass | bottle) instead of the T53/T54 bust/keypoint-bulge model
 * (Fred: "I'd prefer a simpler hourglass shape — look in the sketch
 * builder add-in"). No DOM, no editor object — same "pure function"
 * contract `computePattern`/`shapeToPrimitives` already set.
 *
 * Ported from the frame-builder's own recipes, read directly (not
 * assumed from the dispatch's own summary):
 *   `frame-builder/sketches/template_1/phases/p02_*.py` — HOURGLASS.
 *   `frame-builder/sketches/template_2/phases/p02_*.py` — BOTTLE.
 * Both build a per-side arc chain (2 or 3 circular arcs + 1-2 straight
 * "horn" segments) with every joint held EXACTLY tangent by Fusion's own
 * sketch solver — `Radius` seed dimensions on each arc are later DELETED
 * (`p02_09_radius_removal.py`: "Surgically deletes the temporary seed
 * radius dimensions") once tangency has taken over, confirming the
 * raw seed coordinates in `p02_03_loop.py`/`p02_04_arcs.py` are NOT the
 * final geometry — only the topology (which arc connects to which,
 * which arc centers pin to which skeleton line) is authoritative. This
 * module re-derives the FINAL tangent geometry analytically (closed
 * form) for an ARBITRARY region, rather than copying the source's own
 * fixed-aspect-ratio numbers, which was verified NECESSARY: the source's
 * own per-side arc-center X values differ from each other by a tiny,
 * hand-tuning-noise amount (e.g. hourglass shoulder/waist/hip centers at
 * widthIn*{0.34996, 0.35, 0.34996} — visibly meant to be the same value)
 * — this module deliberately shares ONE exact skeleton-column X per
 * preset (a disclosed simplification, not a copy of the source's own
 * incidental asymmetry), which makes the tangency algebra exact and
 * aspect-ratio-independent (see `_solveHourglass`/`_solveBottle`).
 */
import { lcgPoints } from '../core/terrain.js';
import { arcCenterParam } from './path-layout.js';
import { arcPointAtAngle as _arcPointAt } from './editor-primitives.js'; // audit tidy-up: the one copy

const MIX = (a, b, t) => a + (b - a) * t;

/** Per-item derived-sub-seed convention — every logical random value
 *  draws from its OWN seed via a proper avalanche hash (T54 fix:
 *  Murmur3's own `fmix32` finalizer, after combining seed+salt via two
 *  different multiplicative constants — a linear XOR mix left nearby
 *  seeds producing near-identical output, measured directly). */
function _subSeed(seed, salt) {
  let h = (Math.imul(seed, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
function _draw(seed, salt) {
  return lcgPoints(_subSeed(seed, salt), 1)[0].u;
}

/** F13: the solver's own seeded draw in [0, 1) (one PRNG for every seeded
 *  shape: the Shape Lattice jitter and the frame's [Generate]). */
export const seededUnit = (seed, salt) => _draw(seed, salt);

/** SE14 §4 — the declared style vocabulary (unchanged by T55). Only
 *  `straight`/`curve`/`kink` are wired; the rest are declared, not yet
 *  wired, an additive-later extension point. */
export const ALL_STYLES = [
  'straight', 'curve', 'kink',
  'arc-deep', 'arc-flat', 'arc-in', 'arc-in-deep',
  'ellipse-out', 'ellipse-in', 'sharp', 'step-out', 'step-in', 'notch', 's-bend',
];
export const WIRED_STYLES = ['straight', 'curve', 'kink'];

/**
 * T55 — declared preset table. Each preset's `params` are the TRUE
 * independent degrees of freedom: exact tangency between adjacent arcs
 * (and between an end arc and its vertical "horn") removes 1-2 degrees
 * of freedom from the frame-builder recipe's own naive param wishlist,
 * so quantities like "horn length" or "notch height" are DERIVED here
 * (see each solver's own doc comment for the closed-form relationship),
 * not independently settable — declared honestly rather than exposing a
 * param combination that could request a non-tangent, impossible shape.
 * `jitter` is the gentle per-param HALF-RANGE the seed varies a param
 * within when the caller doesn't pin it explicitly (T55's own dispatch:
 * "seed: optional small variation of the params... default ON but
 * gentle" — a much narrower role than T53/54's own per-zone-width
 * randomization, since the shape's TOPOLOGY here is fixed by the preset,
 * only its proportions vary).
 */
// T74 AMEND 0 (advisor, measured live in Fusion on 847f289: the bottle
// spawned 0.45in off): `widthExpr` is the manifest's own contour_width
// Distance dim's DRIVING expression — declared HERE, per preset, rather
// than an if/else keyed by preset name in the manifest producer, so a
// future preset's own author states its shape's true measured width
// right alongside the params that determine it, not in a second,
// separately-maintained lookup elsewhere. Written in this module's OWN
// camelCase param names — editor-sketch-manifest.js translates each token
// to its Fusion name (PARAM_FUSION_NAMES, the SAME translation
// `parameters` itself already gets) at the one place that boundary
// crossing already happens, not duplicated here. Both presets' own body
// touches the FULL contour width unconditionally (no width-fraction param
// exists for either), so neither declares an explicit `widthExpr` here —
// `resolveWidthExpr`'s own default ('contour_width') already covers both.
// T74 AMEND 3 (Fred: "it needs to fill the box same as hourglass"):
// the bottle's own `bodyWidth` fraction (previously the reason it DID
// need an explicit multiplied `widthExpr` here) is RETIRED — its body
// now always spans the full half-width, same as the hourglass, so the
// two presets' own width expressions are identical and the per-preset
// multiplier mechanism sits unused (kept, not deleted, as a declared slot
// for a FUTURE preset whose body genuinely is a fraction of the contour
// width — see resolveWidthExpr's own doc comment).
export const PRESETS = {
  hourglass: {
    label: 'Hourglass',
    params: {
      waistReach: 0.55, // 0-1: how far in from the edge (fraction of halfW) the waist pinches
      cornerRadius: 0.22, // 0-1: shoulder/hip arc radius, fraction of halfW (shared, top/bottom symmetric)
      waistCenterY: 0, // -1..1: vertical position of the pinch, fraction of halfH (0 = region's own center)
    },
    jitter: { waistReach: 0.08, cornerRadius: 0.05, waistCenterY: 0.08 },
  },
  bottle: {
    label: 'Bottle',
    params: {
      neckWidth: 0.5, // 0-1: narrow top half-width, fraction of halfW
      skeletonX: 0.72, // fraction of halfW, must sit strictly between neckWidth and 1 (S-curve tightness)
      neckLength: 0.32, // 0-1: how far down the straight neck run extends before the S-curve, fraction of halfH
    },
    jitter: { neckWidth: 0.06, skeletonX: 0.05, neckLength: 0.06 },
  },
  // T6 TAB TOP: a FRAME-ONLY preset (Template 6): no Shape Lattice button offers it (properties-shape-lattice.js
  // lists hourglass / bottle by hand). Its params are frame-only keys with plain defaults (DERIVED_PARAM_DEFAULTS
  // .tabTop, the same values), so there is no seeded jitter.
  tabTop: {
    label: 'Tab Top',
    frameOnly: true,
    params: { tabWidth: 0.5, tabHeight: 0.5 }, // = TAB_TOP_DEFAULT_WIDTH / _HEIGHT (declared below; literal here)
    jitter: { tabWidth: 0, tabHeight: 0 },
  },
  // T8 DIPPED TOP + LEFT-ONLY WAVE: a FRAME-ONLY preset (Template 8), like tabTop: no Shape Lattice button offers
  // it. `waveHeight`/`waveReach` are Template 1's own per-side pinch construction (`hourglassConstruction`'s
  // `left`), reused for the ONLY pinch this preset has (the right side is a plain straight edge, Template 1's
  // classic corners, no pinch at all); `topDipWidth`/`topDipDepth`/`topDipPosition` are Template 5's dip
  // (`topDip`), `topDipPosition` new (0 = T5's own centred dip). `waveCornerRadius` is Template 1's own plain
  // `cornerRadius`, renamed (this preset's only side, so no Top/Bottom split): a PLAIN preset param on purpose,
  // not a DERIVED_PARAM_DEFAULTS entry -- see that table's own doc comment for why (a literal default needs the
  // SAME always-clamped treatment an explicit value gets, which only the plain/jittered path gives it).
  dippedLeftWave: {
    label: 'Dipped Top + Left-Only Wave',
    frameOnly: true,
    // MEASURED: 0.4 collapsed the LEFT horn at 12x6 (hornLen 0.34in < frame_thickness 0.75in) -- 0.2 keeps a safe
    // margin (hornLen 1.04in) at every board this template's own tests cover.
    params: { waveHeight: 0, waveReach: 0.2, waveCornerRadius: 0.22, topDipWidth: 0.5, topDipPosition: 0, topDipDepth: 0.14 },
    // frameOnly, no seeded variation (a frame always sets every one from its model, as T6) -- SALT entries exist
    // only so `_jitteredParam` has one to read; jitterHalf 0 makes the draw itself inert.
    jitter: { waveHeight: 0, waveReach: 0, waveCornerRadius: 0, topDipWidth: 0, topDipPosition: 0, topDipDepth: 0 },
  },
  // T9 I SHAPE: a FRAME-ONLY preset (Template 9): no Shape Lattice button offers it, like tabTop. A capital serif
  // I -- full-width top/bottom flanges, a narrower stem between them, all straight lines, 12 pieces and 12
  // corners (4 of them INSIDE, reflex corners where a shoulder meets a stem side) -- Template 6's single notch,
  // doubled top/bottom. Its params are frame-only keys with plain defaults (DERIVED_PARAM_DEFAULTS.iShape, the
  // same values), so there is no seeded jitter, exactly as tabTop.
  iShape: {
    label: 'I Shape',
    frameOnly: true,
    params: { stemWidth: 0.45, flangeHeight: 0.4 }, // = I_SHAPE_DEFAULT_STEM_WIDTH / _FLANGE_HEIGHT (declared below; literal here)
    jitter: { stemWidth: 0, flangeHeight: 0 },
  },
  // T7 DIAMOND-TOP HOURGLASS: a FRAME-ONLY preset (Template 7): no Shape Lattice button offers it, like tabTop/
  // iShape. A 90-degree gable roof (2 straight bars, mitred at the peak and each eave) over an hourglass S-curve
  // side (concave neck arc, convex body arc, tangent to each other and to a straight base side) and a plain
  // straight base -- ported directly from fb_engine/t7_geometry.py's own tested closed form (read before writing
  // this, not re-derived from scratch), ONLY place this algebra lives on the JS side:
  // diamondTopHourglassConstruction. `gableNeckWidth`/`neckHeight`/`bodyFlareHeight` = fb_engine/t7_geometry.py's
  // own NECK_WIDTH_OF_HW_DEFAULT/NECK_HEIGHT_FRAC_DEFAULT/BODY_FLARE_HEIGHT_FRAC_DEFAULT (0.50/0.18/0.72) -- same
  // numeric defaults, declared twice (Python + JS) since there is no cross-language import here; keep them in
  // sync if either changes. "gable" prefix (not the plain `neckWidth` bottle already uses): FRAME_ONLY_PARAM_KEYS
  // and the manifest's own exclusion filter (editor-sketch-manifest.js) key by bare param NAME across every
  // preset, not per-preset -- a bare `neckWidth` here would silently exclude BOTTLE's own real `neckWidth`
  // parameter from the Fusion manifest too (caught by tests/editor-sketch-manifest.test.js's own
  // manifestFromShape(bottle) count check before this shipped).
  diamondTopHourglass: {
    label: 'Diamond-top Hourglass',
    frameOnly: true,
    params: { gableNeckWidth: 0.50, neckHeight: 0.18, bodyFlareHeight: 0.72 },
    jitter: { gableNeckWidth: 0, neckHeight: 0, bodyFlareHeight: 0 },
  },
  // T11 HOURGLASS ROOF: a FRAME-ONLY preset (Template 11): no Shape Lattice button offers it, like tabTop/
  // iShape/diamondTopHourglass. Template 7's own gable roof + eave over Template 1's own 3-arc shoulder/waist/
  // hip pinch side (reused verbatim, fb_engine/t11_geometry.py's own module docstring) and a plain straight base.
  // Reuses TEMPLATE 1's OWN param key names (waistReach, cornerRadiusTop, cornerRadiusBottom, waistCenterY,
  // waistRadius) rather than fresh ones -- deliberately: this IS Template 1's own hourglass side, just with the
  // top horns replaced by a roof (template_data.py's own FRAME_HANDLES comment). Because these keys are REAL,
  // already-SHAPE_PARAM_KEYS.hourglass params (not frame-only), they must NEVER be added to
  // FRAME_ONLY_PARAM_KEYS -- that list is keyed by bare param NAME across every preset, and doing so would
  // silently exclude Template 1's own identically-named params from the Fusion manifest too (the same collision
  // class diamondTopHourglass's own "gable" prefix comment above already warns about, just the opposite
  // direction: THERE a fresh name had to avoid colliding with an existing one, HERE the existing name is reused
  // on purpose, so it must stay OUT of that list instead of being added to it). `waistRadius` omitted here (as
  // Template 1's own hourglass omits it): it is a DERIVED_PARAM_DEFAULTS key, never a plain preset param.
  diamondTopHourglassPinch: {
    label: 'Hourglass Roof',
    frameOnly: true,
    params: { waistReach: 0.55, cornerRadiusTop: 0.22, cornerRadiusBottom: 0.22, waistCenterY: 0 },
    jitter: { waistReach: 0, cornerRadiusTop: 0, cornerRadiusBottom: 0, waistCenterY: 0 },
  },
};

/**
 * SIL-RESOLVE (F5) — DECLARED feasible ranges. Every preset param is resolved
 * inside these, in the declared ORDER (a later param's range depends on the
 * earlier ones), by the solvers AND read by the panel's sliders, so a slider
 * never has a dead zone that silently clamps. Base ranges are the panel's
 * own slider limits; the geometric limits below narrow them:
 *
 * HOURGLASS (depth d = hw*waistReach, shoulder radius Rs = hw*cornerRadius):
 *   - the waist radius is Rw = max(d - Rs, WAIST_MIN_RADIUS_OF_DEPTH * d).
 *     For Rw = d - Rs this is the original shared-column construction,
 *     unchanged; below the floor the centres separate and the arcs stay
 *     externally tangent (the old code let Rw go NEGATIVE here: Fred's loop);
 *   - the notch half-height is dy = sqrt(d * (2*(Rs+Rw) - d)), so it needs
 *     dy <= H = hh - stroke - |waistCenterY*hh| (the shoulder arc may not
 *     start above the top corner). The minimum dy is d, so waistReach <= H/hw,
 *     and then Rs <= (H^2/d + d)/2 - Rw;
 *   - the drawn shoulder radius stays positive: Rs > stroke.
 * BOTTLE: the derived hip centre must stay above the bottom edge:
 *   neckLength <= (2hh - stroke - hw*(1-neckWidth)) / (2hh), so neckWidth has a
 *   floor from the board's aspect; drawn radii and neck stay positive.
 */
export const WAIST_MIN_RADIUS_OF_DEPTH = 0.5;
// Every straight horn keeps at least this length (fraction of the half-height):
// at the feasible edge an arc would otherwise start exactly at a corner, a
// zero-length line (and a zero-length entity in the Fusion export).
export const HORN_MIN_OF_HALF_HEIGHT = 0.02;
export const PARAM_ORDER = {
  // T3 TAPERED HOURGLASS: `topInset` is resolved LAST (not beside waistReach), so the index of every other key
  // -- the frame [Generate] salt (frame-handles.js generateFrameSeeds: FRAME_GEN_SALT + index) -- is unchanged
  // and a Template 1 Generate draws exactly the shape it always did. Its range reads only waistReach; the
  // earlier ranges ignore it on purpose (a narrower top only relaxes them: see _hourglassRange).
  // T4 OFFSET HOURGLASS: the LEFT pinch's own height and depth come after topInset, for the same reason (every
  // earlier key keeps its index), and after every radius they read (the radii stay shared L/R).
  // T5 HOURGLASS DIPPED TOP: the top dip's half width and depth come LAST again (every earlier key keeps its
  // index); the width before the depth, whose range reads it.
  // T10 ARCHED HOURGLASS: `archRise` resolved LAST of all (every earlier key, dip included, keeps its
  // index); its own range reads the already-resolved shoulder position (hourglassConstruction's own `shoulderY`), the
  // SAME "eats into the horn, never adds height" cap this template's own preview was built and approved against.
  // F30 item 3 (Fred's own taper copies): `taperAngle` resolved LAST of ALL (after archRise -- every
  // earlier key, including it, keeps its index): the upper side (above the pinch) leans by this many degrees
  // from vertical, +in/-out (see hourglassConstruction's own taper doc comment). A frame-only key, like every
  // other param this far down the list.
  hourglass: ['waistCenterY', 'waistReach', 'cornerRadius', 'waistRadius', 'cornerRadiusTop', 'cornerRadiusBottom', 'topInset',
    'waistCenterYLeft', 'waistReachLeft', 'topDipWidth', 'topDipDepth', 'archRise', 'taperAngle'],
  // F30 item 3: `taperAngle` resolved last here too, same meaning, the SAME shared construction applied to the
  // neck's own concave tangency instead of the shoulder's convex one (bottleConstruction's own taper doc comment).
  bottle: ['neckWidth', 'skeletonX', 'neckLength', 'bodyRadius', 'taperAngle'],
  // T6 TAB TOP (frame-only preset): the tab's half width, then its height (both frame-only keys, FRAME_ONLY_PARAM_KEYS).
  tabTop: ['tabWidth', 'tabHeight'],
  // T8 DIPPED TOP + LEFT-ONLY WAVE (frame-only preset): the wave's height then reach (waveCornerRadius/waveRadius
  // right after, since they read it), then the dip's width, position, then depth (as T5: width before the params
  // that read it).
  dippedLeftWave: ['waveHeight', 'waveReach', 'waveCornerRadius', 'waveRadius', 'topDipWidth', 'topDipPosition', 'topDipDepth'],
  // T9 I SHAPE (frame-only preset): the stem's half width, then the flange height (both frame-only keys,
  // FRAME_ONLY_PARAM_KEYS).
  iShape: ['stemWidth', 'flangeHeight'],
  // T7 DIAMOND-TOP HOURGLASS (frame-only preset): the neck's half width, then its height (depends on nothing
  // else), then the body flare height (its own range reads the already-resolved neckHeight, enforcing
  // bodyFlareHeight strictly below it -- the neck sits closer to the eave than the body's full-width point).
  diamondTopHourglass: ['gableNeckWidth', 'neckHeight', 'bodyFlareHeight'],
  // T11 HOURGLASS ROOF (frame-only preset): Template 1's own 5 hourglass-side keys -- NOT template_data.py's own
  // FRAME_HANDLES order (that table orders by UI label, waistReach first), but Template 1's own PARAM_ORDER.
  // hourglass ordering (waistCenterY, waistReach, corner(s), waistRadius last): `_hourglassRange` (this preset's
  // own range fallback, no dedicated range function of its own yet) reads `v.waistCenterY` unconditionally when
  // resolving waistReach's own range (and `v.waistReach` when resolving the corners') -- MEASURED: the
  // FRAME_HANDLES order left waistCenterY unresolved (undefined) at that point, producing a silent NaN range
  // (`Math.abs(undefined)` propagating through), caught by a real `generateSilhouette` call producing NaN
  // keypoints, not assumed safe. `waistRadius` resolved LAST: its own derived default
  // (DERIVED_PARAM_DEFAULTS.diamondTopHourglassPinch) reads the already-resolved waistReach/cornerRadiusTop. The
  // roof itself (`a`) is never a resolved param here: no FRAME_HANDLES entry controls it.
  diamondTopHourglassPinch: ['waistCenterY', 'waistReach', 'cornerRadiusTop', 'cornerRadiusBottom', 'waistRadius'],
};
const BASE_RANGES = {
  // F23/H11: cornerRadiusTop/cornerRadiusBottom used to have entries here too
  // ([0.04, 0.95], the same "panel slider limit" carried over verbatim from
  // the pre-F12 shared `cornerRadius`) -- removed since _hourglassRange's
  // corner branch no longer reads them (geometry-only now, see there).
  hourglass: { waistCenterY: [-0.6, 0.6], waistReach: [0.05, 0.92], cornerRadius: [0.04, 0.95] },
  // F24: neckLength used to have an entry here too ([0.08, 0.85]) -- removed
  // since _bottleRange's neckLength branch no longer reads it (geometry-only
  // now, mirroring F23's hourglass corner fix). NOTE (pre-existing, not
  // touched): skeletonX here is ALREADY dead -- `_bottleRange`'s own
  // skeletonX branch computes its range entirely from `nw` and never reads
  // this pair; left as-is, not this task's mess.
  bottle: { neckWidth: [0.05, 0.85], skeletonX: [0.1, 0.95] },
};

/**
 * F12 SHAPE-PARAMS (Fred: "for lattice I think more is better"): params with
 * no preset default of their own. Each DEFAULTS to today's rule, so a pattern
 * saved without it (and every frame) keeps its exact shape; an explicit value
 * (a slider, a handle) is clamped into its feasible range. Resolved after the
 * params they derive from (PARAM_ORDER). All fractions of hw.
 *   waistRadius         the hourglass waist, independent of the corners
 *                       (default: the old coupled rule, max(d - Rs, 0.5 d))
 *   cornerRadiusTop/Bottom  the shoulder / hip corners separately (default:
 *                       the shared cornerRadius, which an old pattern stores)
 *   bodyRadius          the bottle's body shoulder (default: the shared column)
 */
export const DERIVED_PARAM_DEFAULTS = {
  hourglass: {
    waistRadius: (v) => Math.max(v.waistReach - v.cornerRadius, WAIST_MIN_RADIUS_OF_DEPTH * v.waistReach),
    cornerRadiusTop: (v) => v.cornerRadius,
    cornerRadiusBottom: (v) => v.cornerRadius,
    // T3 TAPERED HOURGLASS (Fred: "the top narrower than the base"): how far the TOP horns sit in from the
    // outer edge, a fraction of hw. Default 0 = the full-width top of Template 1 (and of every Shape Lattice
    // pattern), bit for bit. A frame-only param: never in SHAPE_PARAM_KEYS, never a Fusion user parameter
    // (FRAME_ONLY_PARAM_KEYS).
    topInset: () => 0,
    // T4 OFFSET HOURGLASS (the Hourglass NOT mirrored: each waist pinch at its own height and depth): the LEFT
    // pinch's centre height (fraction of hh) and depth (fraction of hw). Default = the right one's, i.e. the
    // mirrored Template 1 pinch, bit for bit. Frame-only params (FRAME_ONLY_PARAM_KEYS); `waistCenterY` /
    // `waistReach` then set the RIGHT pinch alone. The radii (corners, waist) stay shared by both sides.
    waistCenterYLeft: (v) => v.waistCenterY,
    waistReachLeft: (v) => v.waistReach,
    // T5 HOURGLASS DIPPED TOP (Template 1 with the top edge dipped in the middle): the dip's half width (centre
    // line -> where each short straight stub from a top corner ends, fraction of hw) and depth (below the top
    // edge, fraction of hh). Depth default 0 = NO dip: the flat Template 1 top, bit for bit (hourglassConstruction
    // `topDip`). Frame-only params (FRAME_ONLY_PARAM_KEYS).
    topDipWidth: () => TOP_DIP_DEFAULT_WIDTH,
    topDipDepth: () => 0,
    // T10 ARCHED HOURGLASS (Template 1 with the flat top replaced by one arc spanning the full width, its apex
    // on the top edge, its own two ends pulled DOWN into the board -- eating into the existing top horns, never
    // adding height above them): the rise, a fraction of hh. Default 0 = NO arch: the flat Template 1 top, bit
    // for bit (hourglassConstruction `arch`). A frame-only param (FRAME_ONLY_PARAM_KEYS).
    archRise: () => 0,
    // F30 item 3 (Fred's own taper copies): the upper side's own lean, degrees from vertical, +in/-out. Default
    // 0 = perfectly vertical, the flat Template 1 side, bit for bit. A frame-only param; the taper copies always
    // set an explicit value (default 8, Fred's own call).
    taperAngle: () => 0,
  },
  bottle: {
    bodyRadius: (v) => 1 - v.skeletonX,
    taperAngle: () => 0, // F30 item 3: same meaning as the hourglass preset's own, see above
  },
  // T6 TAB TOP: every param has a plain default (no seeded jitter: a frame always sets both from its model).
  tabTop: { tabWidth: () => TAB_TOP_DEFAULT_WIDTH, tabHeight: () => TAB_TOP_DEFAULT_HEIGHT },
  // T8 DIPPED TOP + LEFT-ONLY WAVE: ONLY `waveRadius` is derived (Template 1's own `waistRadius` formula,
  // guaranteed feasible by construction once `waveReach`/`waveCornerRadius` are ALREADY resolved -- the same
  // trust T1's own `waistRadius` default relies on). Every OTHER key (waveHeight, waveReach, waveCornerRadius,
  // topDipWidth, topDipPosition, topDipDepth) is a PLAIN preset param instead (PRESETS.dippedLeftWave.params),
  // on purpose: `_resolveParams`'s "absent -> derived(v), UNCLAMPED" rule (this file's own header comment: "it is
  // feasible by construction") only holds for a default that genuinely IS always feasible, the way hourglass's
  // `topDipDepth: () => 0` trivially is -- MEASURED at 5.51x1.97 (a very short, wide board), this preset's own
  // literal defaults (waveReach 0.4, waveCornerRadius 0.22, topDipDepth 0.14) are NOT always feasible, so they
  // need the SAME always-clamped treatment an explicit value gets (`_jitteredParam`, the plain-param path).
  dippedLeftWave: {
    waveRadius: (v) => Math.max(v.waveReach - v.waveCornerRadius, WAIST_MIN_RADIUS_OF_DEPTH * v.waveReach),
  },
  // T9 I SHAPE: every param has a plain default (no seeded jitter: a frame always sets both from its model, as T6).
  iShape: { stemWidth: () => I_SHAPE_DEFAULT_STEM_WIDTH, flangeHeight: () => I_SHAPE_DEFAULT_FLANGE_HEIGHT },
  // T7 DIAMOND-TOP HOURGLASS: every param has a plain default (no seeded jitter: a frame always sets all 3 from
  // its model, as T6) -- fb_engine/t7_geometry.py's own NECK_WIDTH_OF_HW_DEFAULT/NECK_HEIGHT_FRAC_DEFAULT/
  // BODY_FLARE_HEIGHT_FRAC_DEFAULT (see PRESETS.diamondTopHourglass's own doc comment on keeping these in sync).
  diamondTopHourglass: {
    gableNeckWidth: () => 0.50,
    neckHeight: () => 0.18,
    bodyFlareHeight: () => 0.72,
  },
  // T11 HOURGLASS ROOF: every param has a plain default (no seeded jitter: a frame always sets all 5 from its
  // model/seeds, as T6/T7/T9) EXCEPT waistRadius, which is DERIVED exactly the way Template 1's own hourglass
  // waistRadius is (fb_engine/t11_geometry.py's own `_waist_radius_frac`, ported verbatim: reads the resolved
  // waistReach and cornerRadiusTop -- NOT the plain shared `cornerRadius` Template 1 itself reads, since T11 has
  // no shared corner key at all).
  diamondTopHourglassPinch: {
    waistRadius: (v) => Math.max(v.waistReach - v.cornerRadiusTop, WAIST_MIN_RADIUS_OF_DEPTH * v.waistReach),
  },
};

/** F12: the params the Shape Lattice panel offers (a slider and a handle each).
 *  `cornerRadius` stays the shared base both corners default to (and what old
 *  patterns and frames set), but the panel edits the corners separately. */
export const SHAPE_PARAM_KEYS = {
  hourglass: ['waistReach', 'cornerRadiusTop', 'cornerRadiusBottom', 'waistCenterY', 'waistRadius'],
  bottle: ['neckWidth', 'skeletonX', 'neckLength', 'bodyRadius'],
};
const EPS_FRAC = 1e-3;

/** T3 TAPERED HOURGLASS: resolved params that only a FRAME template sets. The Shape Lattice never offers them and
 *  its Fusion manifest never sends them (editor-sketch-manifest.js; Fred's rule: no new parameters). */
export const FRAME_ONLY_PARAM_KEYS = Object.freeze(['topInset', 'waistCenterYLeft', 'waistReachLeft', 'topDipWidth', 'topDipDepth',
  'tabWidth', 'tabHeight',
  // T8 DIPPED TOP + LEFT-ONLY WAVE (frame-only preset; topDipWidth/topDipDepth already listed above are shared
  // with T5's identically-named keys, so only its OWN new keys are added here):
  'topDipPosition', 'waveHeight', 'waveReach', 'waveCornerRadius', 'waveRadius',
  // T9 I SHAPE (frame-only preset):
  'stemWidth', 'flangeHeight',
  // T10 ARCHED HOURGLASS:
  'archRise',
  // T7 DIAMOND-TOP HOURGLASS (frame-only preset):
  'gableNeckWidth', 'neckHeight', 'bodyFlareHeight',
  // F30 item 3 (the taper copies, both the hourglass and bottle presets):
  'taperAngle']);

/**
 * T6 TAB TOP (a frame-only preset: the Shape Lattice has no button for it): a rectangle with a narrower rectangular
 * tab centred on top, all straight lines, 8 pieces and 8 corners (2 of them INSIDE, reflex corners where a shoulder
 * meets a tab side). Params (region-local): `tabWidth` = the tab's half width a, a fraction of hw; `tabHeight` =
 * the tab's height (the top edge down to the shoulders), a fraction of hh. Pieces, clockwise from the tab's top
 * right corner (the hourglass's own start and direction, so `mirrorSegmentIndex(i, 8)` pairs them):
 *   0 tab side R, 1 shoulder R, 2 side R, 3 base, 4 side L, 5 shoulder L, 6 tab side L, 7 tab top.
 */
export const TAB_TOP_SEGMENT_COUNT = 8;
const TAB_TOP_DEFAULT_WIDTH = 0.5;
const TAB_TOP_DEFAULT_HEIGHT = 0.5;
// The silhouette alone (no frame): a tab, shoulders and a body always there. The frame's own rule (a tab side
// at least 2 x the frame thickness, every bar at least the thickness long) narrows these (frame-handles.js).
const TAB_TOP_RANGES = { tabWidth: [0.05, 0.95], tabHeight: [0.05, 1.9] };

/**
 * T9 I SHAPE (a frame-only preset, like tabTop): a capital serif I -- full-width top and bottom flanges, a
 * narrower stem between them, all straight lines, 12 pieces and 12 corners (4 of them INSIDE, reflex corners
 * where a shoulder meets a stem side) -- Template 6's single notch, doubled top AND bottom, with the 4-fold
 * (left/right AND top/bottom) symmetry p02_05_symmetry builds into the Fusion sketch. Params (region-local):
 * `stemWidth` = the stem's half width a, a fraction of hw; `flangeHeight` = each flange's height (the top/bottom
 * edge down/up to its own shoulder), a fraction of hh (shared top and bottom). Pieces, clockwise from the
 * top-left corner (matching FRAME_SEED_MAP's own `prim` indices in template_data.py):
 *   0 top edge, 1 flange side TR, 2 shoulder TR, 3 stem side R, 4 shoulder BR, 5 flange side BR, 6 bottom edge,
 *   7 flange side BL, 8 shoulder BL, 9 stem side L, 10 shoulder TL, 11 flange side TL.
 */
export const I_SHAPE_SEGMENT_COUNT = 12;
const I_SHAPE_DEFAULT_STEM_WIDTH = 0.45;
const I_SHAPE_DEFAULT_FLANGE_HEIGHT = 0.4;
// The silhouette alone (no frame): flanges, shoulders and a stem always there. `flangeHeight` is a fraction of hh
// (NOT 2hh: each flange is its own hh-based measurement, so the stem-positive ceiling is < 1, not < 0.5 -- MEASURED,
// a wrongly-assumed 0.5-ish ceiling here excluded the frame's own safe window entirely at 12x6, 0.48 vs the frame
// rule's own [0.545, 0.591], and left `_narrow` (frame-handles.js) no choice but its fallback: AS CLOSE TO 0.48 AS
// the frame ceiling allowed, a near-zero stem whose offset then broke `outline-offset.js`'s own cascading-collapse
// re-join -- not a self-intersection the frame rule would have produced, a silhouette ceiling that was simply
// wrong). 0.95 keeps a safe margin below the true 1.0 (where the stem reaches zero).
// The frame's own rule (no bar shorter than the thickness, no flange side shorter than ~2 x it) narrows these
// further (frame-handles.js).
const I_SHAPE_RANGES = { stemWidth: [0.05, 0.95], flangeHeight: [0.05, 0.95] };

/**
 * T5 HOURGLASS DIPPED TOP: the top edge is a short straight stub from each top corner, then a smooth inward dip
 * built like a side waist: a convex shoulder arc, a concave dip arc, a convex shoulder arc (the frame's four
 * mitered corners stay square). Symmetric about the centre line, all three arcs one radius r: with the half
 * width a (centre line -> the stub's end) and the depth D, the shoulder centre (a, top + r) and the dip centre
 * (0, top + D - r) (y down) are r + r apart, so r = (a^2 + D^2) / 4D, and the joints sit at (+/-a/2, top + D/2).
 * The outline then has 16 segments: Template 1's 0..10 unchanged, 11 left stub, 12 left shoulder, 13 dip,
 * 14 right shoulder, 15 right stub (the flat top edge, segment 11, is what it replaces).
 */
export const TOP_DIP_SEGMENT_COUNT = 16;
const TOP_DIP_DEFAULT_WIDTH = 0.72;
export const TOP_DIP_MIN_WIDTH = 0.15; // fraction of hw: a dip narrower than this is a notch, not a dip
const TOP_DIP_MAX_OF_WIDTH = 0.8; // D <= 0.8 a: each shoulder arc sweeps under ~77 deg (at D = a it is 90)
/** T5: the mirror of segment `i` of the 16-segment dipped outline (the sides as Template 1, the top 11 <-> 15,
 *  12 <-> 14, the dip 13 itself). */
export function topDipMirrorIndex(i) {
  return i <= 10 ? 10 - i : 26 - i;
}
/** T5: the largest dip depth whose three arcs keep radius >= rMin at half width a (r = (a^2 + D^2) / 4D falls
 *  as D grows up to a). */
export function topDipDepthForRadius(a, rMin) {
  return a >= 2 * rMin ? Infinity : 2 * rMin - Math.sqrt(4 * rMin * rMin - a * a);
}

/** Narrow [lo, hi] by a geometric bound; if the geometry leaves no room
 *  inside the base range, validity wins (min = max = the geometric bound). */
function _range(lo, hi, geoLo = -Infinity, geoHi = Infinity) {
  const a = Math.max(lo, geoLo), b = Math.min(hi, geoHi);
  return a <= b ? { min: a, max: b } : { min: Math.min(b, geoHi), max: Math.min(b, geoHi) };
}

function _hourglassRange(key, region, stroke, v) {
  const hw = region.w / 2, hh = region.h / 2;
  if (key === 'waistRadius') return _optionalRange('hourglass', region, stroke, v);
  // T3 TAPERED HOURGLASS: the top horns move in by i = topInset * hw, never past the waist pinch (the top is
  // never narrower than the waist): 0 <= i < d. With the waist centre fixed, the top corner's own tangency is
  // the full-width one with d -> d - i (hourglassConstruction), and every bound the ranges above/below put on
  // the corners and the waist radius (2S > d, the keyhole, dy <= H) only RELAXES as d shrinks (d <= H), so a
  // value feasible at i = 0 stays feasible at every i in range: those ranges keep reading the full depth.
  if (key === 'topInset') return _range(0, Infinity, -Infinity, v.waistReach - EPS_FRAC);
  if (key === 'waistCenterYLeft' || key === 'waistReachLeft') return _hourglassLeftRange(key, region, stroke, v);
  if (key === 'topDipWidth' || key === 'topDipDepth') return _topDipRange(key, region, stroke, v);
  // T10 ARCHED HOURGLASS: the rise never reaches the shoulder arc (the arch sits ABOVE it, eating into the horn's
  // own length only -- the advisor's own rule, confirmed by Fred's "flat is fine on extreme landscape" call):
  // the same `hornLen` / `HORN_MIN_OF_HALF_HEIGHT` margin `_topDipRange`'s own ceiling already uses, read at
  // whichever side (T4's own left pinch, if ever combined) has the shorter horn.
  if (key === 'archRise') {
    const horn = HORN_MIN_OF_HALF_HEIGHT * hh;
    const g = hourglassConstruction(region, { ...v, archRise: undefined });
    const hornLen = Math.min(hh + g.shoulderY, g.left ? hh + g.left.shoulderY : Infinity);
    return _range(0, Infinity, -Infinity, Math.max(hornLen - horn, horn) / hh);
  }
  // F30 item 3 (Fred's own taper copies): the declared band is [-15, 15] (0 = Template 1/2 exactly); only the
  // negative (outward-leaning) side can ever run past the point _taperedCorner's own tangency has a real
  // solution (MEASURED there: the hourglass shoulder is already at full board width, so every negative angle
  // takes its inset branch; the bottle neck never does) -- `_taperRange` finds that floor directly. The shoulder
  // and waist circles are the same `side()` algebra `hourglassConstruction` uses, inlined (not a full call: this
  // runs on every resolve, for every template, taper or not -- the F12 dense sweep timed out before this inline).
  if (key === 'taperAngle') {
    const waistCenterY = hh * v.waistCenterY;
    const radiusWaist = hw * (v.waistRadius ?? DERIVED_PARAM_DEFAULTS.hourglass.waistRadius(v));
    const waistCx = hw - hw * v.waistReach + radiusWaist;
    const topInset = hw * (v.topInset ?? DERIVED_PARAM_DEFAULTS.hourglass.topInset(v));
    const r = hw * (v.cornerRadiusTop ?? DERIVED_PARAM_DEFAULTS.hourglass.cornerRadiusTop(v));
    const S = r + radiusWaist, d = hw * v.waistReach - topInset, dy = Math.sqrt(Math.max(0, d * (2 * S - d)));
    const circle = { cx: hw - topInset - r, cy: waistCenterY - dy, r };
    const pinch = { cx: waistCx, cy: waistCenterY, r: radiusWaist };
    // H23 item 59 (Arched + taper): same `hh - archRise` target-line substitution as
    // hourglassConstruction's own topTaper -- archRise is 0 bit for bit for every template but T10, so this
    // is a no-op everywhere else (inlined, not a full hourglassConstruction call, same reason the rest of
    // this branch is already inlined: this runs on every resolve, for every template, taper or not).
    const archRise = hh * (v.archRise ?? DERIVED_PARAM_DEFAULTS.hourglass.archRise(v));
    return _range(-15, 15, _taperRange(circle, pinch, +1, hw, hh - archRise), 15);
  }
  if (key === 'cornerRadiusTop' || key === 'cornerRadiusBottom') {
    // F12: each corner has its OWN vertical room (y-down: a lower waist leaves
    // more above it): its arc centre may not rise above the top (sink below
    // the bottom) horn; and 2S >= d for a real tangency with the waist.
    const wcy = hh * v.waistCenterY, horn = HORN_MIN_OF_HALF_HEIGHT * hh;
    const H = hh - stroke - horn + (key === 'cornerRadiusTop' ? wcy : -wcy);
    const d = hw * v.waistReach;
    const rw = hw * (v.waistRadius ?? DERIVED_PARAM_DEFAULTS.hourglass.waistRadius(v));
    const sMax = (H * H / d + d) / 2;
    // the keyhole bound (see _optionalRange), per side: dy >= R in the major-waist
    // regime, i.e. R >= d - sqrt(2 d Rw) (binding only while Rw <= 2d)
    const keyhole = rw <= 2 * d ? d - Math.sqrt(2 * d * rw) : -Infinity;
    // F23/H11 (Fred, iPad: "shouldn't the handle... allow the handle to go
    // further and make the arc wider" -- Shoulder/Hip): [0.04, 0.95] here
    // used to come from BASE_RANGES, same as every other branch in this
    // function -- but that table is "the panel's own slider limits" (this
    // file's own header comment) predating the F12 corner split, carried
    // over verbatim by handleMigrations rather than ever re-derived
    // geometrically. Measured live (fb-app board sizes) against
    // outlineDefects: the true tangent/simple limit is ~2.6-2.7x wider than
    // 0.95 at 7x9's low bbox and the 0.04 floor is ~40x tighter than
    // geometry needs there; at 12x6 the floor is a closer ~1.1x. `waistRadius`
    // (the other F12 corner-ish param, just above) already gets the correct
    // geometry-only treatment via `_optionalRange`'s `_range(0, Infinity,
    // geoLo, geoHi)` -- same pattern here, not the BASE_RANGES pair, so a
    // manual drag reaches the actual outline limit instead of an unrelated
    // UI artifact. The panel's own handle clamp (`frameHandles` in
    // frame-handles.js) already reads its min/max from this same function
    // every drag, so it widens for free -- no separate UI change needed.
    return _range(0, Infinity, Math.max(stroke + EPS_FRAC * hw, d / 2 - rw + EPS_FRAC * hw, keyhole) / hw, (sMax - rw) / hw);
  }
  const [lo, hi] = BASE_RANGES.hourglass[key];
  if (key === 'waistCenterY') return _range(lo, hi);
  const H = hh - stroke - Math.abs(v.waistCenterY) * hh - HORN_MIN_OF_HALF_HEIGHT * hh;
  if (key === 'waistReach') return _range(lo, hi, -Infinity, H / hw);
  const d = hw * v.waistReach;
  const k = WAIST_MIN_RADIUS_OF_DEPTH;
  const sMax = (H * H / d + d) / 2; // largest Rs + Rw that still fits vertically
  // In the Rw = d - Rs branch S = d always fits; past it Rs = S - k*d.
  const rsMax = Math.max(sMax - k * d, (1 - k) * d);
  return _range(lo, hi, (stroke + EPS_FRAC * hw) / hw, rsMax / hw);
}

/**
 * T4 OFFSET HOURGLASS: the LEFT pinch's own range, resolved after every radius (shared L/R) and after the right
 * pinch. Exactly the conditions the ranges above put on the right side, now read the other way round (the radii
 * are fixed, the pinch moves): per corner c (top: the depth measured from its own horn, d - topInset),
 *   2 S_c > d_c (a real tangency, S_c = r_c + Rw), the keyhole d_c - sqrt(2 d_c Rw) <= r_c, and the notch
 *   dy_c = sqrt(d_c (2 S_c - d_c)) fits vertically: dy_top <= H + wcy, dy_bottom <= H - wcy (y down, H = hh -
 *   stroke - the minimum horn); plus the right side's own d <= H - |wcy| and the base bands.
 * waistCenterYLeft reads the RIGHT depth (the left one is resolved after it and defaults to it), so the right
 * pinch's own height is always inside it; waistReachLeft then takes the interval of valid depths that holds the
 * right depth (valid at that height by the rule above), so neither range is ever empty.
 */
function _hourglassLeftRange(key, region, stroke, v) {
  const hw = region.w / 2, hh = region.h / 2, eps = EPS_FRAC * hw;
  const D = DERIVED_PARAM_DEFAULTS.hourglass;
  const Hc = hh - stroke - HORN_MIN_OF_HALF_HEIGHT * hh;
  const rw = hw * (v.waistRadius ?? D.waistRadius(v));
  const inset = hw * (v.topInset ?? D.topInset(v));
  const corners = [
    { r: hw * (v.cornerRadiusTop ?? D.cornerRadiusTop(v)), inset, sign: +1 }, // top: room above = H + wcy
    { r: hw * (v.cornerRadiusBottom ?? D.cornerRadiusBottom(v)), inset: 0, sign: -1 },
  ];
  const d0 = hw * v.waistReach; // the right pinch's depth
  if (key === 'waistCenterYLeft') {
    const [lo, hi] = BASE_RANGES.hourglass.waistCenterY;
    let geoLo = -(Hc - d0), geoHi = Hc - d0;
    for (const c of corners) {
      const d = d0 - c.inset, S = c.r + rw, dy = Math.sqrt(Math.max(0, d * (2 * S - d)));
      if (c.sign > 0) geoLo = Math.max(geoLo, dy - Hc); else geoHi = Math.min(geoHi, Hc - dy);
    }
    // the right pinch's own height is valid by the right side's rules: never lost to rounding at an edge
    return _range(lo, hi, Math.min(geoLo / hh, v.waistCenterY), Math.max(geoHi / hh, v.waistCenterY));
  }
  const wcy = hh * v.waistCenterYLeft;
  const [lo, hi] = BASE_RANGES.hourglass.waistReach;
  let geoLo = corners[0].inset + eps, geoHi = Hc - Math.abs(wcy);
  for (const c of corners) {
    const S = c.r + rw, H = Hc + c.sign * wcy;
    geoHi = Math.min(geoHi, c.inset + 2 * S - 2 * eps); // 2S > d (the corner ranges' own margin)
    const t = (Math.sqrt(2 * rw) + Math.sqrt(2 * rw + 4 * c.r)) / 2; // keyhole: sqrt(d) <= t
    geoHi = Math.min(geoHi, c.inset + t * t);
    if (H < S) { // the notch fits outside (S - q, S + q): keep the side the right depth is on
      const q = Math.sqrt(S * S - Math.max(0, H) * H), dRef = d0 - c.inset;
      if (dRef <= S) geoHi = Math.min(geoHi, c.inset + S - q); else geoLo = Math.max(geoLo, c.inset + S + q);
    }
  }
  // at the right pinch's own height the right depth is valid (the right side's rules): kept exactly, so a left
  // pinch equal to the right one draws the mirrored Template 1 outline bit for bit
  if (v.waistCenterYLeft === v.waistCenterY) return _range(lo, hi, Math.min(geoLo / hw, v.waistReach), Math.max(geoHi / hw, v.waistReach));
  return _range(lo, hi, geoLo / hw, geoHi / hw);
}

/**
 * T5 HOURGLASS DIPPED TOP: the dip's ranges, resolved after every other param. Its width a (fraction of hw):
 * each straight stub keeps at least the minimum horn length (from the top corner, drawn at hw - stroke, to a).
 * Its depth D (fraction of hh), read at that width: at least the minimum horn (a real dip, so the outline keeps
 * its 16 segments), at most TOP_DIP_MAX_OF_WIDTH x a, above the top horns' lower ends (the side shoulders
 * start there: the dip never reaches down to them), and shallow enough that the drawn arcs keep
 * MIN_ARC_RADIUS_IN (r - stroke >= it, topDipDepthForRadius).
 */
function _topDipRange(key, region, stroke, v) {
  const hw = region.w / 2, hh = region.h / 2, horn = HORN_MIN_OF_HALF_HEIGHT * hh;
  const inset = hw * (v.topInset ?? DERIVED_PARAM_DEFAULTS.hourglass.topInset(v));
  if (key === 'topDipWidth') return _range(TOP_DIP_MIN_WIDTH, Infinity, -Infinity, (hw - stroke - inset - horn) / hw);
  const a = hw * v.topDipWidth;
  const g = hourglassConstruction(region, { ...v, topDipDepth: undefined });
  const hornLen = Math.min(hh + g.shoulderY, g.left ? hh + g.left.shoulderY : Infinity); // y down: top at -hh
  const dMax = Math.min(TOP_DIP_MAX_OF_WIDTH * a, hornLen - horn, topDipDepthForRadius(a, MIN_ARC_RADIUS_IN + stroke));
  // never below the minimum, even where the top horns are shorter than it (a tiny board): the outline keeps its
  // 16 segments, as the Fusion sketch always has them (the dip sits between the stubs, clear of the sides)
  return _range(HORN_MIN_OF_HALF_HEIGHT, Infinity, -Infinity, Math.max(dMax, horn) / hh);
}

/** T6 TAB TOP: the silhouette's own ranges (fractions): the tab inside the sides, the shoulders below the top, a
 *  body below the shoulders; with a stroke inset the drawn tab keeps a positive width. */
function _tabTopRange(key, region, stroke) {
  const hw = region.w / 2, [lo, hi] = TAB_TOP_RANGES[key];
  if (key === 'tabWidth') return _range(lo, hi, (2 * stroke + EPS_FRAC * hw) / hw);
  return _range(lo, hi);
}

/** T9 I SHAPE: the silhouette's own ranges (fractions): the stem inside the flanges, a flange shorter than half
 *  the height (so the stem keeps a positive length); with a stroke inset the drawn stem/flanges keep a positive
 *  size. */
function _iShapeRange(key, region, stroke) {
  const hw = region.w / 2, hh = region.h / 2, [lo, hi] = I_SHAPE_RANGES[key];
  if (key === 'stemWidth') return _range(lo, hi, (2 * stroke + EPS_FRAC * hw) / hw);
  return _range(lo, hi, -Infinity, (hh - stroke - EPS_FRAC * hh) / hh);
}

/**
 * T7 DIAMOND-TOP HOURGLASS: the silhouette's own ranges (fractions). FIRST CUT, DELIBERATELY CONSERVATIVE, not
 * yet visually verified (no browser/Fusion render from this seat) -- see LIVE_CHECK.md.
 *
 * MEASURED, not assumed: a full board x handle-value sweep (tests/frame-template-7.test.js) found the genuine
 * valid region for this 3-parameter family is NOT simply "every value in [0,1] works, clamp the obvious ends" --
 * both a too-narrow neck/body gap AND a too-large one can push the neck arc's own circle (`cNeck.x - rNeck`)
 * past the centreline, crossing its own mirror (a real `selfIntersection`, not theoretical), and the failure is
 * NOT monotonic in either direction, so no single-sided cap closes it. Rather than chase a precise analytic
 * boundary for a 3-parameter x board-aspect-ratio family (open-ended, and unverifiable without a live render),
 * these bounds are a NARROW, directly-tested-safe box around the template's own defaults, confirmed clean across
 * every portrait/square board this app's own test boards cover (7x9, 9x12, 8x8, 7x7, 9x9) at both the box's
 * corners and its centre -- a real loss of handle range versus the theoretical [0,1], accepted deliberately
 * (project_portrait_only: Fred builds portrait boards; a landscape board's own handle range is not this seat's
 * priority to perfect) rather than shipping a wider range this seat cannot verify. Widen it only after a live
 * visual check (or a real Fusion golden) confirms a wider value still looks right -- [Generate] has its own,
 * independent safety net regardless (frame-handles.js generateValidFrameSeeds retries a bad draw against the
 * real inner-profile defects, the same mechanism Template 10 already relies on).
 *   gableNeckWidth: the neck's own half width, fraction of hw ("gable" prefix, not the plain `neckWidth` bottle
 *     already uses -- see PRESETS.diamondTopHourglass's own doc comment). Capped relative to the roof's own
 *     half-width `a` (`0.85 * a/hw`): past `a` the "neck" would be WIDER than the eave, not a pinch at all.
 *   neckHeight / bodyFlareHeight: how far down from the eave the neck / the full-width point sit, fraction of
 *     the run below the eave ("rest") -- bodyFlareHeight (resolved after neckHeight) kept a real margin above
 *     it, not just "the ordering holds".
 */
function _diamondTopHourglassRange(key, region, stroke, v) {
  const hw = region.w / 2, hh = region.h / 2;
  const a = Math.min(0.62 * hw, 0.84 * hh);
  if (key === 'gableNeckWidth') return _range(0.15, Math.min(0.92, 0.85 * a / hw));
  if (key === 'neckHeight') return _range(0.05, 0.25);
  // bodyFlareHeight, read after neckHeight (PARAM_ORDER): a real minimum gap (0.4) and an absolute ceiling
  // (0.75) that stayed clean at every tested board down to the smallest square one (7x7) -- see this function's
  // own doc comment for why neither bound alone (just "above neckHeight", just "below 1") was ever sufficient.
  return _range(v.neckHeight + 0.4, 0.75);
}

/**
 * T11 HOURGLASS ROOF: the side's own ranges. NOT `_hourglassRange`/`_optionalRange`'s own hourglass branches
 * reused directly -- MEASURED: both hardcode a single shared `v.cornerRadius` (Template 1's own key, read via
 * `DERIVED_PARAM_DEFAULTS.hourglass.waistRadius`), which T11 never has (its own corners are split from the
 * start -- no shared-then-overridden stage the way Template 3's narrow top sequences cornerRadius -> waistRadius
 * -> cornerRadiusTop/Bottom) -- reusing them produced a silent NaN (`v.cornerRadius` undefined, propagating
 * through `Math.max(NaN, ...)`) the first time a real `generateSilhouette` call exercised this preset, caught by
 * a direct probe, not assumed safe. Same formulas, read off `v.cornerRadiusTop` directly instead, and against the
 * side's own virtual half-height (`hhR = hh - a/2`, the room BELOW the roof's own eave,
 * diamondTopHourglassPinchConstruction's own doc comment) rather than the full region's `hh` -- the roof eats
 * into the side's own vertical room, the same reduced-room fact that construction already establishes.
 */
function _diamondTopHourglassPinchRange(key, region, stroke, v) {
  const hw = region.w / 2, hh = region.h / 2;
  const a = Math.min(0.62 * hw, 0.84 * hh);
  const hhR = hh - a / 2;
  // The TOP corner's own depth is measured from ITS OWN horn (d - topInset, same convention
  // `hourglassConstruction`'s own T3 topInset uses) -- the roof's eave sits `a` out, so the shoulder's horn sits
  // `hw - topInset = a` out too (diamondTopHourglassPinchConstruction's own `topX`).
  const topInset = hw - a;
  // Template 1's own base band is [-0.6, 0.6] (BASE_RANGES, a UI-slider-limit, not a geometric derivation) and
  // its own corners tolerate the full band at its defaults (MEASURED directly). T11's TOP corner has LESS margin
  // (its own depth is shrunk by `topInset`, see the cornerRadiusTop/Bottom branch below) and genuinely does NOT
  // tolerate the full band at ITS OWN default corner sizes: a drag to +-0.6 left 4-8 non-tangent defects, not
  // assumed safe. waistCenterY resolves FIRST (PARAM_ORDER, mirroring Template 1's own order), before
  // waistReach/cornerRadiusTop/Bottom are known, so there is no later-resolved value to validate THIS range
  // against yet (the same "deliberately narrow, directly-tested-safe box" compromise
  // `_diamondTopHourglassRange`'s own doc comment already names for Template 7's neck/body heights, rather than
  // a fully general cross-param feasibility solve nothing else in this file attempts either): narrowed to
  // [-0.5, 0.5], MEASURED clean (0 defects) at every default-proportion drag tested, vs 4-8 at the full +-0.6.
  if (key === 'waistCenterY') return _range(-0.5, 0.5);
  if (key === 'waistReach') {
    // MEASURED, not assumed: the TOP corner's own depth is `hw*waistReach - topInset` (the branch below, and
    // waistRadius's own) -- with NO floor here, a generated `waistReach` below `topInset/hw` (~0.38 at 7x9) makes
    // that depth NEGATIVE, a physically invalid tangency (the shoulder horn would sit on the wrong side of the
    // pinch). Caught by a real `generateValidFrameSeeds` draw producing a negative resolved `cornerRadiusTop`/
    // `waistRadius` and six non-tangent defects, not assumed safe from Template 1's own floor (0.05, which never
    // needed this: topInset is always 0 there, no roof eating into the top corner's own depth).
    const H = hhR - stroke - Math.abs(v.waistCenterY) * hhR - HORN_MIN_OF_HALF_HEIGHT * hhR;
    return _range(Math.max(0.05, topInset / hw + EPS_FRAC), 0.92, -Infinity, H / hw);
  }
  if (key === 'cornerRadiusTop' || key === 'cornerRadiusBottom') {
    // Resolved before waistRadius (PARAM_ORDER): the same geometry-only treatment Template 1's own shared
    // `cornerRadius` gets (`_hourglassRange`'s own generic fallback, k = WAIST_MIN_RADIUS_OF_DEPTH standing in
    // for a not-yet-resolved waistRadius), per corner (its own vertical room, wcy signed by which corner, and its
    // own depth -- the TOP corner's `d` shrunk by `topInset`, MEASURED: using the full `hw*waistReach` for the top
    // corner too (an earlier version of this branch did) let `cornerRadiusTop` range past what the ACTUAL
    // inset-shortened tangency allows, feeding a stale upper bound into waistRadius's own range below).
    const isTop = key === 'cornerRadiusTop';
    const wcy = hhR * v.waistCenterY, horn = HORN_MIN_OF_HALF_HEIGHT * hhR;
    const H = hhR - stroke - horn + (isTop ? wcy : -wcy);
    const d = hw * v.waistReach - (isTop ? topInset : 0), k = WAIST_MIN_RADIUS_OF_DEPTH;
    const sMax = (H * H / d + d) / 2;
    const rsMax = Math.max(sMax - k * d, (1 - k) * d);
    return _range(0.04, 0.95, (stroke + EPS_FRAC * hw) / hw, rsMax / hw);
  }
  // waistRadius, resolved last: BOTH corners already resolved -- `_optionalRange`'s own hourglass formula,
  // computed per corner (the top's own `d` shrunk by `topInset`, as above) and INTERSECTED. MEASURED, not
  // assumed: an earlier version of this branch checked only `cornerRadiusTop` (mirroring `_optionalRange`'s own
  // hourglass formula verbatim, which only ever has ONE corner to check) -- Template 1 never needs the other
  // corner's own constraint because both corners share one `cornerRadius`; T11's independent corners do NOT, so
  // a generated `cornerRadiusBottom` could leave NO waistRadius that also keeps the BOTTOM corner's own tangency
  // real, and the un-intersected range let `waistRadius` land there anyway -- caught by a real `generateSilhouette`
  // call producing non-tangent defects on BOTH sides' shoulder/waist/hip chains, not assumed safe.
  const wcy = hhR * v.waistCenterY, horn = HORN_MIN_OF_HALF_HEIGHT * hhR, eps = EPS_FRAC * hw;
  const corners = [
    { r: hw * v.cornerRadiusTop, d: hw * v.waistReach - topInset, H: hhR - stroke - horn + wcy },
    { r: hw * v.cornerRadiusBottom, d: hw * v.waistReach, H: hhR - stroke - horn - wcy },
  ];
  let lo = 0, hi = Infinity;
  for (const c of corners) {
    const sMax = (c.H * c.H / c.d + c.d) / 2;
    const keyhole = c.r < c.d ? (c.d - c.r) * (c.d - c.r) / (2 * c.d) : 0;
    lo = Math.max(lo, Math.max(c.d / 2 - c.r + eps, keyhole, eps) / hw);
    hi = Math.min(hi, (sMax - c.r) / hw);
  }
  return _range(0, Infinity, lo, hi);
}

function _bottleRange(key, region, stroke, v) {
  const hw = region.w / 2, hh = region.h / 2;
  if (key === 'bodyRadius') return _optionalRange('bottle', region, stroke, v);
  // F30 item 3: the SAME taper floor as the hourglass shoulder, just the neck's own concave tangency (convexSign
  // -1) against the body as the pinch -- see _hourglassRange's own doc comment on this branch (same reason this
  // inlines bottleConstruction's own pre-taper algebra instead of calling it: every resolve pays for this).
  if (key === 'taperAngle') {
    const neckHalfW = hw * v.neckWidth, skelX = hw * v.skeletonX, radiusNeck = skelX - neckHalfW;
    const radiusBody = hw * (v.bodyRadius ?? DERIVED_PARAM_DEFAULTS.bottle.bodyRadius(v));
    const bodyCx = hw - radiusBody;
    const neckCenterY = -hh + hh * 2 * v.neckLength;
    const sumNB = radiusNeck + radiusBody;
    const hipCenterY = neckCenterY + Math.sqrt(Math.max(0, sumNB * sumNB - (bodyCx - skelX) ** 2));
    const circle = { cx: skelX, cy: neckCenterY, r: radiusNeck };
    const pinch = { cx: bodyCx, cy: hipCenterY, r: radiusBody };
    return _range(-15, 15, _taperRange(circle, pinch, -1, hw, hh), 15);
  }
  if (key === 'neckLength') {
    // F24: used to be clamped into a declared [0.08, 0.85] UI-slider band
    // (BASE_RANGES) -- the same "panel slider limit predates the geometric
    // derivation" artifact F23 already retired for the hourglass corners
    // (Fred's own follow-up: "the same leftover-declared-band artifact you
    // flagged"). Geometry only now: the floor is a fixed clearance (stroke
    // + the minimum horn) over the full drawn height (independent of
    // neckWidth); the ceiling keeps the hip centre above the bottom edge
    // for the CURRENT neckWidth (unchanged formula, just no longer
    // intersected with a declared pair).
    const horn = HORN_MIN_OF_HALF_HEIGHT * hh;
    const top = (2 * hh - stroke - horn - hw * (1 - v.neckWidth)) / (2 * hh);
    return _range(0, Infinity, (stroke + horn) / (2 * hh), top);
  }
  const [lo, hi] = BASE_RANGES.bottle[key];
  if (key === 'neckWidth') {
    // hip centre above the bottom edge even at the shortest neck:
    // hw*(1-nw) <= 2hh*(1-nlLo) - stroke; and the drawn neck stays positive.
    // F24: the worst-case (shortest) neck used here is neckLength's OWN true
    // geometric floor (its branch above), not the old declared band value --
    // using the declared 0.08 here would silently re-import the same
    // artifact into neckWidth's own floor even after retiring it above.
    const horn = HORN_MIN_OF_HALF_HEIGHT * hh;
    const nlLoTrue = (stroke + horn) / (2 * hh);
    const floorFromHeight = 1 - (2 * hh * (1 - nlLoTrue) - stroke - horn) / hw;
    return _range(lo, hi, Math.max(floorFromHeight, (stroke + EPS_FRAC * hw) / hw));
  }
  const nw = v.neckWidth;
  if (key === 'skeletonX') {
    // the old span rule, plus the drawn body radius (hw - skelX) > stroke
    return _range(nw + (1 - nw) * 0.15, nw + (1 - nw) * 0.85, -Infinity, 1 - (stroke + EPS_FRAC * hw) / hw);
  }
}

/**
 * F8 (S4 parity): the ONE degree of freedom each construction was missing
 * versus Fusion's own solve (MEASURED on the S4 goldens):
 *   - hourglass `waistRadius`: Fusion's waist radius is independent (7x9: 0.68
 *     in vs the derived max(d - Rs, 0.5d) = 0.52);
 *   - bottle `bodyRadius`: Fusion's neck and body arc centres are NOT on one
 *     column (7x9: 2.696 vs 2.578 in).
 * F12 made both first-class Shape Lattice params (DERIVED_PARAM_DEFAULTS: absent
 * means the original rule); their feasible range is `_optionalRange`.
 */

/**
 * F8: a frame template's fitted shape MODEL (frame-defs `shapeModel`, fitted
 * from the Fusion goldens by frame_shape_fit.py) evaluated for one region,
 * turned into this preset's own params. The feature -> param mapping encodes
 * the constructions above, so it lives beside them:
 *   hourglass: notch, cornerR, waistR, waistCy (+ depth to pick the tangency root)
 *              ->  waistReach, cornerRadius, waistRadius, waistCenterY
 *   bottle:    neckHalfW, neckR, neckTop, bodyR ->  neckWidth, skeletonX, neckLength, bodyRadius
 */
export function paramsFromShapeModel(preset, model, region) {
  const hw = region.w / 2, hh = region.h / 2;
  const f = {};
  // F30 item 3: a feature can also carry a scale-INVARIANT `const` term (e.g. the taper copies' own taperAngle, a
  // degree value that must not grow/shrink with the board) alongside the usual hw/hh-scaled ones; absent for
  // every other feature, so every existing fitted/provisional model is unaffected.
  for (const [name, c] of Object.entries(model.features)) f[name] = c.hw * hw + c.hh * hh + (c.const || 0);
  // T6 TAB TOP (frame_shape_fit.py `tab_top`): the tab's half width and height, in inches.
  if (preset === 'tabTop') return { tabWidth: f.tabHalfWidth / hw, tabHeight: f.tabHeight / hh };
  // T8 DIPPED TOP + LEFT-ONLY WAVE (frame_shape_fit.py `dipped_left_wave`): self-contained, like tabTop -- no
  // right pinch to share a depth-root pick with, so `waveDepth` (the extractor's own DIRECT measurement, not a
  // fitted approximation needing reconciling against the tangency equation the way T1's LEAST-SQUARES-fitted
  // `depth` does) is read straight, simplifying T4's own `notchLeft` root-picking dance away. NOT yet exercised
  // by a real fit (no goldens recorded for this template: only the provisional model, built directly from the
  // SAME fraction it will read back out, so this direct reading is exactly correct there); once goldens exist,
  // a real fitted `waveDepth`/`waveNotch` pair could, in principle, want the same root-picking treatment T1/T4's
  // `depth`/`notch` get -- deferred, and NAMED here, rather than built and left untestable without live goldens.
  if (preset === 'dippedLeftWave') {
    const out = {};
    if (f.waveDepth != null) out.waveReach = f.waveDepth / hw;
    if (f.waveCy != null) out.waveHeight = f.waveCy / hh;
    if (f.waveCornerR != null) out.waveCornerRadius = f.waveCornerR / hw;
    if (f.waveR != null) out.waveRadius = f.waveR / hw;
    if (f.topDipHalfWidth != null) out.topDipWidth = f.topDipHalfWidth / hw;
    if (f.topDipPosition != null) out.topDipPosition = f.topDipPosition / hw;
    if (f.topDipDepth != null) out.topDipDepth = f.topDipDepth / hh;
    return out;
  }
  if (preset === 'bottle') {
    const outB = { neckWidth: f.neckHalfW / hw, skeletonX: (f.neckHalfW + f.neckR) / hw,
      neckLength: f.neckTop / (2 * hh), bodyRadius: f.bodyR / hw };
    // F30 item 3 (Template 13, the taper copies): a scale-invariant `const` feature (see this function's own
    // doc comment above).
    if (f.taperAngle != null) outB.taperAngle = f.taperAngle;
    return outB;
  }
  // T9 I SHAPE (frame_shape_fit.py `i_shape`): the stem's half width and the flange height, in inches.
  if (preset === 'iShape') return { stemWidth: f.stemHalfWidth / hw, flangeHeight: f.flangeHeight / hh };
  // T7 DIAMOND-TOP HOURGLASS (frame_shape_fit.py `diamond_top_hourglass`): `gableNeckWidth` is plain (hw-linear,
  // like every simple fraction above); `neckHeight`/`bodyFlareHeight` are each "fraction x rest" (the run below
  // the eave). `rest = 2*hh - a` IS exactly hw/hh-linear for a PORTRAIT board (see
  // provisional_diamond_top_hourglass_model's own doc comment: `a`'s min() is binding at 0.62*hw whenever
  // hw<hh, which every board this app builds satisfies) -- the fitted/provisional inch value divided back by
  // THIS construction's own TRUE `rest` (computed at the default handle proportions, which don't change `rest`
  // itself) round-trips exactly, not approximately.
  if (preset === 'diamondTopHourglass') {
    const g = diamondTopHourglassConstruction(region, {});
    return { gableNeckWidth: f.gableNeckWidth / hw, neckHeight: f.neckHeight / g.rest, bodyFlareHeight: f.bodyFlareHeight / g.rest };
  }
  // Depth from the construction's own tangency: d = S +/- sqrt(S^2 - notch^2); the
  // fitted depth only picks the root (minor when the waist centre is outside the
  // shoulder column, major inside: Fusion's T1 is minor at 7x9, major at 12x6).
  const S = f.cornerR + f.waistR;
  const disc = Math.sqrt(Math.max(0, S * S - f.notch * f.notch));
  const depth = Math.abs(S - disc - f.depth) <= Math.abs(S + disc - f.depth) ? S - disc : S + disc;
  const out = { waistReach: depth / hw, cornerRadius: f.cornerR / hw, waistRadius: f.waistR / hw, waistCenterY: f.waistCy / hh };
  // T3 TAPERED HOURGLASS: a narrow-top model (frame_shape_fit.py `hourglass_narrow_top`) also carries the top
  // inset and the two corners separately (its cornerR / notch are then the HIP's: the full-width side, the one
  // the depth root above is for). Absent (Template 1): exactly the four params above.
  if (f.topInset != null) out.topInset = f.topInset / hw;
  if (f.cornerRTop != null) out.cornerRadiusTop = f.cornerRTop / hw;
  if (f.cornerRBottom != null) out.cornerRadiusBottom = f.cornerRBottom / hw;
  // T4 OFFSET HOURGLASS: an offset-waist model (frame_shape_fit.py `hourglass_offset_waist`) also carries the LEFT
  // pinch: its own centre height and notch (+ depth, to pick the root), the radii shared with the right.
  if (f.waistCyLeft != null) out.waistCenterYLeft = f.waistCyLeft / hh;
  if (f.notchLeft != null) {
    const discL = Math.sqrt(Math.max(0, S * S - f.notchLeft * f.notchLeft)), ref = f.depthLeft ?? f.depth;
    out.waistReachLeft = (Math.abs(S - discL - ref) <= Math.abs(S + discL - ref) ? S - discL : S + discL) / hw;
  }
  // T5 HOURGLASS DIPPED TOP: a dipped-top model (frame_shape_fit.py `hourglass_dipped_top`) also carries the top
  // dip's half width (centre line -> the stub's end) and its depth below the top edge.
  if (f.topDipHalfWidth != null) out.topDipWidth = f.topDipHalfWidth / hw;
  if (f.topDipDepth != null) out.topDipDepth = f.topDipDepth / hh;
  // T10 ARCHED HOURGLASS: an arched-top model (frame_shape_fit.py `hourglass_arched_top`) also carries the
  // arch's own rise (above the top corners, eating into the horn -- hourglassConstruction's own `arch.rise`).
  if (f.archRise != null) out.archRise = f.archRise / hw;
  // F30 item 3 (Template 12, the taper copies): a scale-invariant `const` feature (see this function's own doc
  // comment above).
  if (f.taperAngle != null) out.taperAngle = f.taperAngle;
  return out;
}

function _optionalRange(preset, region, stroke, v) {
  const hw = region.w / 2, hh = region.h / 2, horn = HORN_MIN_OF_HALF_HEIGHT * hh, eps = EPS_FRAC * hw;
  if (preset === 'hourglass') {
    const d = hw * v.waistReach, rs = hw * v.cornerRadius;
    const H = hh - stroke - Math.abs(v.waistCenterY) * hh - horn;
    const sMax = (H * H / d + d) / 2; // dy = sqrt(d(2S - d)) <= H
    // 2S > d for a real tangency: at 2S = d the notch closes (dy = 0) and the waist
    // arc has no span (F12: reachable once the waist radius is a user param).
    // F12: and a MAJOR waist (Rs + Rw < d) swings each corner arc past its own
    // vertical extreme, so the notch must hold both: dy >= Rs, i.e. Rw >= (d - Rs)^2 / 2d
    // (a narrower "keyhole" slot crosses the corner arcs; today's derived rule
    // always satisfies it: dy = sqrt(2 d Rs) >= Rs).
    const keyhole = rs < d ? (d - rs) * (d - rs) / (2 * d) : 0;
    return _range(0, Infinity, Math.max(d / 2 - rs + eps, keyhole, eps) / hw, (sMax - rs) / hw);
  }
  const nhw = hw * v.neckWidth, skel = hw * v.skeletonX, rN = skel - nhw, a = hw - skel;
  const nC = -hh + 2 * hh * v.neckLength;
  const lMax = hh - stroke - horn - nC; // hip centre stays above the bottom edge
  const rbMax = (lMax * lMax - rN * rN + a * a) / (2 * (rN + a)); // from L^2 = (rN+rB)^2 - (rB-a)^2
  return _range(0, 1, Math.max(stroke + eps, (a - rN) / 2 + eps) / hw, rbMax / hw);
}

/** Fred: "Limit the arcs radius in frame and lattice to .125in minimum". Every arc of both presets, as the
 *  param that sets its radius (a fraction of hw) -> the smallest fraction whose DRAWN arc is MIN_ARC_RADIUS_IN.
 *  The drawn contour is the outline offset inward by the stroke half-width `s` (0 for a frame): a convex arc
 *  (the hourglass shoulder/hip corners, the bottle body) draws at R - s, a concave one (the hourglass waist, the
 *  bottle neck, whose radius is skeletonX - neckWidth) at R + s.
 *  Applied on top of the geometric range (`_withArcFloor`); where the geometry has no room for it the geometry
 *  wins (min = max), the same "validity wins" rule `_range` already uses. */
export const MIN_ARC_RADIUS_IN = 0.125;
function _arcFloorFrac(preset, key, region, stroke, v) {
  if (preset === 'tabTop' || preset === 'iShape') return -Infinity; // T6, T9: no arcs
  const hw = region.w / 2;
  const convex = (MIN_ARC_RADIUS_IN + stroke) / hw, concave = Math.max(0, MIN_ARC_RADIUS_IN - stroke) / hw;
  if (preset === 'bottle') {
    if (key === 'bodyRadius') return convex;
    if (key === 'skeletonX') return v.neckWidth + concave;
    return -Infinity;
  }
  if (key === 'waistRadius' || key === 'waveRadius') return concave;
  return ['cornerRadius', 'cornerRadiusTop', 'cornerRadiusBottom', 'waveCornerRadius'].includes(key) ? convex : -Infinity;
}
function _withArcFloor(preset, key, region, stroke, v, r) {
  const f = _arcFloorFrac(preset, key, region, stroke, v);
  if (!(f > r.min)) return r;
  return f <= r.max ? { min: f, max: r.max } : { min: r.max, max: r.max };
}

/**
 * T8 DIPPED TOP + LEFT-ONLY WAVE: ranges for the one pinch this preset has (`waveHeight`/`waveReach`, Template
 * 1's own per-side construction, `_hourglassRange`'s plain waistCenterY/waistReach branches with no right pinch
 * to stay consistent with -- so, unlike `_hourglassLeftRange`, there is no "at the right pinch's own height..."
 * fallback: each corner's room is measured directly against the full half height) and the dip (`topDipWidth`/
 * `topDipPosition`/`topDipDepth`, `_topDipRange`'s own formula, `topDipPosition` new: the dip's stubs stay clear
 * of BOTH top corners at its shifted position).
 */
function _dippedLeftWaveRange(key, region, stroke, v) {
  const hw = region.w / 2, hh = region.h / 2, horn = HORN_MIN_OF_HALF_HEIGHT * hh;
  // waveHeight resolves FIRST (PARAM_ORDER), same as hourglass's own waistCenterY: an unconditional band, never
  // reading waveReach (not yet resolved) -- waveReach's own range below reads the now-resolved waveHeight instead.
  if (key === 'waveHeight') return _range(-0.6, 0.6);
  if (key === 'waveReach') {
    const H = hh - stroke - horn - Math.abs(hh * v.waveHeight);
    return _range(0.05, 0.92, -Infinity, H / hw);
  }
  if (key === 'waveCornerRadius') {
    // Template 1's own PLAIN `cornerRadius` range (not the later F12 cornerRadiusTop/Bottom split, which reads an
    // already-resolved waistRadius this preset's own PARAM_ORDER doesn't have yet at this point): rsMax's own
    // Math.max(sMax - k*d, (1-k)*d) fallback (not simply sMax - k*d) is what keeps this finite and sane at a
    // small, wide board like 5.51x1.97 (MEASURED: the plain subtraction alone went negative there).
    const H = hh - stroke - horn - Math.abs(hh * v.waveHeight);
    const d = hw * v.waveReach, k = WAIST_MIN_RADIUS_OF_DEPTH;
    const sMax = (H * H / d + d) / 2;
    const rsMax = Math.max(sMax - k * d, (1 - k) * d);
    return _range(0.04, 0.95, (stroke + EPS_FRAC * hw) / hw, rsMax / hw);
  }
  if (key === 'waveRadius') {
    const d = hw * v.waveReach, rs = hw * v.waveCornerRadius;
    const H = hh - stroke - horn - Math.abs(hh * v.waveHeight);
    const sMax = (H * H / d + d) / 2;
    const keyhole = rs < d ? (d - rs) * (d - rs) / (2 * d) : 0;
    return _range(0, Infinity, Math.max(d / 2 - rs + EPS_FRAC * hw, keyhole, EPS_FRAC * hw) / hw, (sMax - rs) / hw);
  }
  if (key === 'topDipWidth') return _range(TOP_DIP_MIN_WIDTH, Infinity, -Infinity, (hw - stroke - horn) / hw);
  const a = hw * v.topDipWidth;
  if (key === 'topDipPosition') {
    // both stubs stay clear of their own corner: a shift right shortens the right stub and lengthens the left one.
    const room = (hw - stroke - horn - a) / hw;
    return _range(-Infinity, Infinity, -room, room);
  }
  // topDipDepth, read at this width (T5's own `_topDipRange`, mirrored: this preset's only side is the LEFT one,
  // so the depth ceiling is how far down the wave's OWN shoulder arc starts, not a min() over both sides -- the
  // plain right side has no shoulder to collide with at all).
  const g = hourglassConstruction(region, {
    waistReach: v.waveReach, waistCenterY: v.waveHeight, cornerRadius: v.waveCornerRadius, waistRadius: v.waveRadius,
    waistCenterYLeft: v.waveHeight, waistReachLeft: v.waveReach,
  });
  const hornLen = hh + g.left.shoulderY; // y down, top at -hh
  const dMax = Math.min(TOP_DIP_MAX_OF_WIDTH * a, hornLen - horn, topDipDepthForRadius(a, MIN_ARC_RADIUS_IN + stroke));
  return _range(HORN_MIN_OF_HALF_HEIGHT, Infinity, -Infinity, Math.max(dMax, horn) / hh);
}

/** `{ param: {min, max} }` for `preset` on `region`, each conditional on the
 *  params resolved before it (PARAM_ORDER). `params` supplies those earlier
 *  values (e.g. a solver's own `params` output). */
/** The preset's own range function (T6: `tabTop`, T7: `diamondTopHourglass`, T8: `dippedLeftWave`, T9: `iShape`;
 *  hourglass is the default). */
const _rangeFn = (preset) => (preset === 'bottle' ? _bottleRange : preset === 'tabTop' ? _tabTopRange
  : preset === 'dippedLeftWave' ? _dippedLeftWaveRange : preset === 'iShape' ? _iShapeRange
    : preset === 'diamondTopHourglass' ? _diamondTopHourglassRange
      : preset === 'diamondTopHourglassPinch' ? _diamondTopHourglassPinchRange : _hourglassRange);

export function feasibleParamRanges(preset, region, params, strokeHalfWidth = 0) {
  const fn = _rangeFn(preset);
  const derived = DERIVED_PARAM_DEFAULTS[preset];
  const v = { ...params };
  const out = {};
  for (const key of PARAM_ORDER[preset]) {
    out[key] = _withArcFloor(preset, key, region, strokeHalfWidth, v, fn(key, region, strokeHalfWidth, v));
    if (v[key] == null && derived[key]) v[key] = derived[key](v); // a later range reads the declared default
  }
  return out;
}

/** Resolve a preset's params in declared order, each inside its feasible
 *  range: explicit value (clamped only if genuinely infeasible), else the
 *  default + seeded jitter. */
function _resolveParams(preset, region, params, seed, strokeHalfWidth) {
  const p = PRESETS[preset].params, j = PRESETS[preset].jitter, salt = SALT[preset];
  const fn = _rangeFn(preset);
  const derived = DERIVED_PARAM_DEFAULTS[preset];
  const v = {};
  for (const key of PARAM_ORDER[preset]) {
    const r = _withArcFloor(preset, key, region, strokeHalfWidth, v, fn(key, region, strokeHalfWidth, v));
    if (derived[key]) {
      // F12: explicit -> clamped into its feasible range; absent -> today's rule, unclamped
      // (it is feasible by construction), so an old pattern resolves bit-for-bit as before --
      // except the MIN_ARC_RADIUS_IN floor, which a derived radius is raised to as well.
      const floor = _arcFloorFrac(preset, key, region, strokeHalfWidth, v);
      v[key] = params[key] != null ? Math.max(r.min, Math.min(r.max, params[key]))
        : Math.min(Math.max(derived[key](v), floor), Math.max(r.max, derived[key](v)));
    } else {
      v[key] = _jitteredParam(params[key], p[key], j[key], seed, salt[key], r.min, r.max);
    }
  }
  return v;
}

/**
 * F30 item 3 (Fred's own taper copies, "Hourglass - Tapered sides" / "Narrow Neck - Tapered sides"): the upper
 * side's own corner (the shoulder's convex arc for the hourglass preset, the neck's concave arc for bottle),
 * tapered by `taperDeg` from vertical, +in/-out. ONE shared construction, declared once, used by both presets'
 * own corner (`convexSign` +1/-1 is the only thing that differs between them).
 *
 * Positive (leans INWARD going up, narrower top): the corner's own circle stays exactly where the preset's
 * existing tangency algebra already puts it (untouched); the NEW tangent line at this angle crosses the safe
 * zone's own top (y=-hh) at a SMALLER half-width than before -- that crossing is the new, narrower top corner.
 *
 * Negative (leans OUTWARD going up, wider top): the SAME construction would put that crossing PAST the board's
 * own side edge for a shape already at (or near) full width there -- past the board, which the frame can never
 * do. So the branch flips: the top corner is pinned to the board's own side edge instead (hw, -hh -- the
 * preset's own UNTAPERED corner position), and the circle's own POSITION insets instead (same radius, still
 * externally tangent to the pinch at the same centre-distance S -- only WHERE it sits moves): the set of valid
 * centres is the line parallel to the (now fully known: fixed point + given angle) tangent line, offset inward
 * by the radius, intersected with the circle of radius S around the pinch's own centre.
 *
 * ONE rule picks the branch (does the first approach's own corner stay inside the board?), not a per-preset or
 * per-sign special case -- MEASURED: Template 1 (already full board width at the top) needs the inset branch
 * for every negative angle; Template 2 (already narrower at the top) stays on the first branch across the whole
 * declared band. Falls back to the closest point on the tangent line (never throws) if no exact tangency exists
 * at all (a steep angle + an already-tight pinch) -- `_taperRange` keeps normal resolution well clear of that
 * case; this is a backstop for a pathological combination, not the normal path (Fred: "don't worry too much
 * about extremes... enough that it never crashes").
 */
function _taperedCorner(circle, pinchCircle, convexSign, taperDeg, hw, hh) {
  if (!taperDeg) return { cx: circle.cx, cy: circle.cy, hornX: circle.cx + convexSign * circle.r, hornY: circle.cy, topCornerX: circle.cx + convexSign * circle.r, exact: true };
  const r = circle.r, S = r + pinchCircle.r;
  const th = (taperDeg * Math.PI) / 180;
  const dir = { x: Math.sin(th), y: Math.cos(th) }; // the "down" direction of the slanted side
  const n = { x: dir.y, y: -dir.x };
  const tanA = { x: circle.cx + convexSign * r * n.x, y: circle.cy + convexSign * r * n.y };
  const topXA = tanA.x + ((-hh - tanA.y) / dir.y) * dir.x;
  if (topXA <= hw + 1e-9) return { cx: circle.cx, cy: circle.cy, hornX: tanA.x, hornY: tanA.y, topCornerX: topXA, exact: true };
  const p0 = { x: hw - convexSign * r * n.x, y: -hh - convexSign * r * n.y };
  const fx = p0.x - pinchCircle.cx, fy = p0.y - pinchCircle.cy;
  const A = dir.x * dir.x + dir.y * dir.y, B = 2 * (fx * dir.x + fy * dir.y), C = fx * fx + fy * fy - S * S;
  const disc = B * B - 4 * A * C;
  let cx, cy;
  if (disc < 0) { // no exact tangency: the closest point on the line (never throw; _taperRange avoids this in normal use)
    const t = -(fx * dir.x + fy * dir.y) / A;
    cx = p0.x + t * dir.x; cy = p0.y + t * dir.y;
  } else {
    const s = Math.sqrt(disc), t1 = (-B + s) / (2 * A), t2 = (-B - s) / (2 * A);
    const p1 = { x: p0.x + t1 * dir.x, y: p0.y + t1 * dir.y }, p2 = { x: p0.x + t2 * dir.x, y: p0.y + t2 * dir.y };
    const d1 = Math.hypot(p1.x - circle.cx, p1.y - circle.cy), d2 = Math.hypot(p2.x - circle.cx, p2.y - circle.cy);
    ({ x: cx, y: cy } = d1 < d2 ? p1 : p2);
  }
  return { cx, cy, hornX: cx + convexSign * r * n.x, hornY: cy + convexSign * r * n.y, topCornerX: hw, exact: disc >= 0 };
}

/** F30 item 3: the negative-taper floor, shared by both presets -- bisects `_taperedCorner`'s own `exact` flag
 *  (false only in its pathological fallback, see its doc comment) down from 0 toward `lo` (-15 declared), so a
 *  resolved/generated/dragged taperAngle never reaches the one case that draws a non-tangent, self-crossing
 *  corner. Positive never needs this (the inward lean only narrows, _taperedCorner's branch A the whole way, see
 *  its own doc comment's MEASURED note) -- callers only use this for the negative side. Cheap (no outline/defect
 *  build, just the same closed-form corner): fine to call from a range function on every resolve.
 */
function _taperRange(circle, pinchCircle, convexSign, hw, hh, lo = -15) {
  if (_taperedCorner(circle, pinchCircle, convexSign, lo, hw, hh).exact) return lo;
  let a = lo, b = 0; // _taperedCorner(...,0,...) is always exact (the early return)
  // 18 halvings of a 15 deg span resolve the floor to ~6e-5 deg -- far past "clean" (Fred: "don't worry too much
  // about extremes"), and this runs on every resolve of every hourglass/bottle shape, taper or not.
  for (let i = 0; i < 18; i++) {
    const mid = (a + b) / 2;
    if (_taperedCorner(circle, pinchCircle, convexSign, mid, hw, hh).exact) b = mid; else a = mid;
  }
  return b;
}

/** F30 item 3: the "Taper angle" handle's own inverse -- given the UNTAPERED circle (`circle`, e.g. the
 *  shoulder/neck at taperAngle 0: callers get this the same way `_taperRange`'s own callers do, by resolving the
 *  construction once with `taperAngle: 0`) and a desired top-corner X (a horizontal drag's own position, region-
 *  local), the taperDeg whose `_taperedCorner(...).topCornerX` matches it. `topCornerX` has no closed-form
 *  inverse (taper's own two branches and Branch B's line-circle intersection make it transcendental) but IS
 *  monotonic in taperDeg (editor-shape-lattice-
 *  interaction.js's own handle test confirms this, narrower as the angle increases) across the declared
 *  [-15, 15] band, narrowed to this circle's own true floor exactly like `_taperRange` -- so a bisection on the
 *  SAME closed-form corner is exact and cheap (one drag frame, not a hot resolve loop).
 */
export function taperAngleForTopCornerX(circle, pinchCircle, convexSign, desiredX, hw, hh) {
  const floor = _taperRange(circle, pinchCircle, convexSign, hw, hh);
  const xAt = (deg) => _taperedCorner(circle, pinchCircle, convexSign, deg, hw, hh).topCornerX;
  if (desiredX >= xAt(floor)) return floor; // dragged past the floor: clamp (the range function clamps again anyway)
  if (desiredX <= xAt(15)) return 15;
  let a = floor, b = 15; // xAt is monotonically decreasing: xAt(a) > desiredX > xAt(b)
  for (let i = 0; i < 24; i++) {
    const mid = (a + b) / 2;
    if (xAt(mid) > desiredX) a = mid; else b = mid;
  }
  return b;
}

/** SIL-RESOLVE (F5): the hourglass construction from RESOLVED fraction params
 *  (region-local, right side, Y-down). The ONE place this algebra lives; the
 *  solver and the on-canvas handles (editor-shape-lattice-interaction.js)
 *  both call it. */
export function hourglassConstruction(region, resolved) {
  const hw = region.w / 2, hh = region.h / 2;
  const D = DERIVED_PARAM_DEFAULTS.hourglass;
  const depth = hw * resolved.waistReach;
  const waistCenterY = hh * resolved.waistCenterY;
  const radiusWaist = hw * (resolved.waistRadius ?? D.waistRadius(resolved));
  const waistCx = hw - depth + radiusWaist;
  // T3 TAPERED HOURGLASS: the top horns sit `topInset` in from the edge (0 = Template 1).
  const topInset = hw * (resolved.topInset ?? D.topInset(resolved));
  // F12: each corner arc (radius r, centre (hw - r, y)) externally tangent to the
  // waist arc: centre distance r + Rw, so dy = sqrt(d (2 (r + Rw) - d)); the unit
  // vector corner-centre -> waist-centre carries the tangent junction.
  // T3: a side whose horn sits `inset` in has its corner centre at hw - inset - r, so
  // the same algebra holds with the depth measured from that horn: d -> d - inset.
  const side = (frac, sign, inset) => {
    const r = hw * frac, S = r + radiusWaist, d = depth - inset, dy = Math.sqrt(Math.max(0, d * (2 * S - d)));
    return { r, S, d, dy, cx: hw - inset - r, y: waistCenterY + sign * dy, ux: (S - d) / S, uy: dy / S };
  };
  const top0 = side(resolved.cornerRadiusTop ?? D.cornerRadiusTop(resolved), -1, topInset);
  const bot = side(resolved.cornerRadiusBottom ?? D.cornerRadiusBottom(resolved), +1, 0);
  // H23 item 59 (Arched + taper): archRise must be known BEFORE the taper corner is solved -- moved up from
  // its own old position below (still used there, unchanged, for `arch.halfWidth`/`arch.radius`). Computing it
  // here first is what lets the very next line pass the taper's own REAL target line.
  const archRise = hh * (resolved.archRise ?? D.archRise(resolved));
  // F30 item 3 (Fred's own taper copies): the shoulder's own corner, tapered -- see _taperedCorner's own doc
  // comment. Untouched (top === top0, bit for bit) when taperAngle is 0, the default for every template but the
  // two new copies.
  const taperAngle = resolved.taperAngle ?? D.taperAngle(resolved);
  // H23 item 59 (Arched + taper, ported from tools/repro/f30_item5_arched_taper_diagram.mjs @4be8963's own
  // header comment): `_taperedCorner`'s own `hh` parameter is the TARGET LINE's distance from centre, not
  // necessarily the board's half-height. For every flat-top hourglass (archRise 0, every template but T10)
  // that target line IS the board edge (-hh), so `hh - archRise` reduces to plain `hh` -- bit for bit
  // unchanged. For T10 the horn never reaches the board edge at all; it stops at the arch's own chord,
  // `-hh + archRise` (eaten into, same as `hourglassConstruction`'s own `arch` block below does
  // unconditionally) -- `hh - archRise` is exactly that target line's own distance from centre.
  const topTaper = _taperedCorner({ cx: top0.cx, cy: top0.y, r: top0.r }, { cx: waistCx, cy: waistCenterY, r: radiusWaist }, +1, taperAngle, hw, hh - archRise);
  const topDist = Math.hypot(waistCx - topTaper.cx, waistCenterY - topTaper.cy) || 1;
  const top = taperAngle ? { ...top0, cx: topTaper.cx, y: topTaper.cy, ux: (waistCx - topTaper.cx) / topDist, uy: (waistCenterY - topTaper.cy) / topDist } : top0;
  // T4 OFFSET HOURGLASS: the LEFT side's own construction (in mirrored local coordinates: +x = outward), only
  // when a left pinch is set: the same algebra at its own height and depth, every radius the right side's.
  // Absent (Template 1-3, the Shape Lattice): no `left`, the left side is the exact mirror of this one.
  const left = (resolved.waistCenterYLeft != null || resolved.waistReachLeft != null) ? hourglassConstruction(region, {
    ...resolved, waistCenterYLeft: undefined, waistReachLeft: undefined,
    waistCenterY: resolved.waistCenterYLeft ?? resolved.waistCenterY,
    waistReach: resolved.waistReachLeft ?? resolved.waistReach,
    // the right side's own fractions (not r / hw: no round trip), resolved by the right side's rules
    waistRadius: resolved.waistRadius ?? D.waistRadius(resolved),
    cornerRadiusTop: resolved.cornerRadiusTop ?? D.cornerRadiusTop(resolved),
    cornerRadiusBottom: resolved.cornerRadiusBottom ?? D.cornerRadiusBottom(resolved),
    topInset: resolved.topInset ?? D.topInset(resolved),
  }) : undefined;
  // T5 HOURGLASS DIPPED TOP: the top dip (see TOP_DIP_SEGMENT_COUNT), only when a depth is set (> 0); absent
  // (Templates 1-4, the Shape Lattice): no `topDip`, the flat top edge.
  // T8 DIPPED TOP + LEFT-ONLY WAVE: `topDipPosition` (default 0, Template 5's own centred dip) shifts the whole
  // dip left/right by that many hw -- the two shoulder centres and the dip centre all move by the same amount,
  // so the three arcs keep their T5 radius formula (a, D unchanged by a shift) and stay mutually tangent; only
  // each centre's X gains the offset.
  const dipDepth = hh * (resolved.topDipDepth ?? D.topDipDepth(resolved));
  const dipPosition = hw * (resolved.topDipPosition ?? 0);
  let topDip = null;
  if (dipDepth > 0) {
    const a = hw * (resolved.topDipWidth ?? D.topDipWidth(resolved)), r = (a * a + dipDepth * dipDepth) / (4 * dipDepth);
    // y down, the top edge at -hh: the shoulder centres (+/-a, -hh + r), the dip centre (0, -hh + D - r)
    topDip = { halfWidth: a, depth: dipDepth, radius: r, position: dipPosition, shoulderCy: -hh + r, dipCy: -hh + dipDepth - r };
  }
  // T10 ARCHED HOURGLASS: the top arc, only when a rise is set (> 0); absent (Templates 1-9, the Shape Lattice):
  // no `arch`, the flat top edge. Its chord spans the FULL top horn-to-horn width (topX, T3's topInset already
  // applied) and sits `rise` BELOW the top edge -- eating into the horn's own length, never adding height above
  // it (the advisor's own correction, confirmed against Fred's sketch). The radius is the exact one circle
  // through both chord ends tangent to the top edge (sagitta over half-chord: R = (a^2 + rise^2) / (2 rise) --
  // the same construction T5's own dip arcs use, here a single arc instead of three chained ones, so no stub,
  // no separate shoulder arc, and the Fusion phase ties it to the top line with a Tangent, not an expression).
  // F30 item 3: the top horns' own x is now the TAPERED corner's (identical to `hw - topInset` at taperAngle 0,
  // the removed line's own formula -- confirmed by _taperedCorner's own early return).
  const topX = topTaper.topCornerX;
  let arch = null;
  if (archRise > 0) {
    const r = (topX * topX + archRise * archRise) / (2 * archRise);
    arch = { rise: archRise, radius: r, halfWidth: topX };
  }
  return {
    ...(left ? { left } : {}),
    ...(topDip ? { topDip } : {}),
    ...(arch ? { arch } : {}),
    hw, hh, depth, radiusWaist, waistCenterY, waistCx,
    topInset, topX, // T3: the top horns' x (hw for Template 1)
    taperAngle, shoulderHornX: topTaper.hornX, shoulderHornY: topTaper.hornY, // F30 item 3: the horn's own actual
    // end where it meets the shoulder arc -- equals (topX, shoulderY) when untapered, since the tangent is then
    // vertical; a DIFFERENT point once the horn is slanted, so _solveHourglass can no longer assume the same x.
    waistX: hw - depth, // the pinch's innermost x
    cornerRadiusTop: top.r, cornerRadiusBottom: bot.r, cornerRadius: top.r,
    shoulderCx: top.cx, shoulderY: top.y, hipCx: bot.cx, hipY: bot.y, notchHalfSpan: top.dy,
    ux: top.ux, uy: top.uy, uxBottom: bot.ux, uyBottom: bot.uy,
    // F8: the concave waist is a MAJOR arc when its two junctions subtend more
    // than a half-turn about its centre (symmetric: exactly when Rs + Rw < d).
    waistMajor: Math.atan2(top.dy, top.S - top.d) + Math.atan2(bot.dy, bot.S - bot.d) > Math.PI,
  };
}

/** F12: the bottle construction from RESOLVED params (region-local, right side,
 *  Y-down), the ONE place this algebra lives (the solver and the handles). */
export function bottleConstruction(region, resolved) {
  const hw = region.w / 2, hh = region.h / 2;
  const D = DERIVED_PARAM_DEFAULTS.bottle;
  const neckHalfW = hw * resolved.neckWidth;
  const skelX = hw * resolved.skeletonX; // the neck arc's centre column
  const radiusNeck = skelX - neckHalfW; // concave (upper) arc
  const radiusBody = hw * (resolved.bodyRadius ?? D.bodyRadius(resolved)); // convex (lower)
  const bodyCx = hw - radiusBody;
  const neckCenterY = -hh + hh * 2 * resolved.neckLength;
  const sumNB = radiusNeck + radiusBody;
  // The body's own position, from the UNTAPERED neck column -- fixed once, here, same as hourglassConstruction's
  // `bot` is computed independent of any top taper: a neck taper (below) never moves the body.
  const hipCenterY = neckCenterY + Math.sqrt(Math.max(0, sumNB * sumNB - (bodyCx - skelX) ** 2)); // derived (tangency)
  // F30 item 3 (Fred's own taper copies): the neck's own corner, tapered -- the shared _taperedCorner (see its own
  // doc comment), concave this time (convexSign -1: at taperAngle 0 the early return reproduces (skelX,
  // neckCenterY, neckHalfW) exactly, bit for bit). The body circle above is the fixed pinch it tapers against.
  const taperAngle = resolved.taperAngle ?? D.taperAngle(resolved);
  const neckTaper = _taperedCorner({ cx: skelX, cy: neckCenterY, r: radiusNeck }, { cx: bodyCx, cy: hipCenterY, r: radiusBody }, -1, taperAngle, hw, hh);
  const neckDist = Math.hypot(bodyCx - neckTaper.cx, hipCenterY - neckTaper.cy) || 1;
  const skelXTaper = taperAngle ? neckTaper.cx : skelX;
  const neckCenterYTaper = taperAngle ? neckTaper.cy : neckCenterY;
  const bux = taperAngle ? (bodyCx - neckTaper.cx) / neckDist : (bodyCx - skelX) / sumNB;
  const buy = taperAngle ? (hipCenterY - neckTaper.cy) / neckDist : (hipCenterY - neckCenterY) / sumNB;
  return { hw, hh, neckHalfW, skelX: skelXTaper, radiusNeck, radiusBody, bodyCx, neckCenterY: neckCenterYTaper, hipCenterY,
    bux, buy,
    taperAngle, neckTopX: neckTaper.topCornerX, // F30 item 3: the horn's own flat-top x (neckHalfW untapered)
    neckHornX: neckTaper.hornX, neckHornY: neckTaper.hornY, // the horn's own end where it meets the neck arc
  };
}

const SALT = {
  hourglass: { waistReach: 601, cornerRadius: 602, waistCenterY: 603 },
  bottle: { neckWidth: 611, skeletonX: 613, neckLength: 614 },
  // T8 DIPPED TOP + LEFT-ONLY WAVE: frameOnly (jitter 0 for every one), so these values are never actually drawn
  // from -- present only because the plain/jittered resolution path (PRESETS.dippedLeftWave.params, see
  // DERIVED_PARAM_DEFAULTS.dippedLeftWave's own doc comment) reads `salt[key]` unconditionally.
  dippedLeftWave: { waveHeight: 621, waveReach: 622, waveCornerRadius: 623, topDipWidth: 624, topDipPosition: 625, topDipDepth: 626 },
  // T9 I SHAPE: frameOnly (jitter 0 for both), same reason as dippedLeftWave's own comment above.
  iShape: { stemWidth: 631, flangeHeight: 632 },
  // T7 DIAMOND-TOP HOURGLASS: frameOnly (jitter 0 for all 3), same reason as dippedLeftWave's own comment above.
  diamondTopHourglass: { gableNeckWidth: 641, neckHeight: 642, bodyFlareHeight: 643 },
  // T11 HOURGLASS ROOF: frameOnly (jitter 0 for all 4 plain keys; waistRadius is DERIVED, no salt needed), same
  // reason as dippedLeftWave's own comment above.
  diamondTopHourglassPinch: { waistReach: 651, cornerRadiusTop: 652, cornerRadiusBottom: 653, waistCenterY: 654 },
};

/** Explicit param value wins; else default + a gentle seeded jitter,
 *  clamped to `[lo,hi]` so an extreme jitter draw can't produce a
 *  degenerate (non-positive radius) shape. Same "explicit overrides
 *  random" duality T53/54's own `_zoneWidth` used, generalized. */
function _jitteredParam(explicitValue, defaultValue, jitterHalf, seed, salt, lo, hi) {
  const v = explicitValue != null ? explicitValue : defaultValue + (_draw(seed, salt) - 0.5) * 2 * jitterHalf;
  return Math.max(lo, Math.min(hi, v));
}

/** Ground-truth (Slice 1, T53): `decomposeSegment`'s own CAD "bulge
 *  factor" — `R = |chord/2 * (1+b^2)/(2b)|` — inverted here to go the
 *  OTHER direction: given a KNOWN radius and chord (from an
 *  analytically-solved tangent arc), find the bulge that reproduces it
 *  exactly. Solving the quadratic `h*b^2 - 2Rb + h = 0` (h=halfChord)
 *  for the smaller (minor-arc) root: `b = (R - sqrt(R^2-h^2)) / h`.
 *  `R===h` exactly (a true semicircle) gives `b=1` — `_arcPrimitive`
 *  special-cases that below rather than clamping it to 0.999, since a
 *  tangent-circle construction where the arc's own two endpoints are
 *  its neighbors' shared tangent points ALWAYS produces an exact
 *  semicircle for the middle (waist/neck) arc of both presets here (see
 *  each solver's own doc comment) — losing precision on a case this
 *  common, in a design whose whole point is "exact tangent arcs", isn't
 *  acceptable. */
function _bulgeFromRadius(R, halfChord, major = false) {
  const disc = Math.max(0, R * R - halfChord * halfChord); // clamp: float noise can push this just under 0 at R===h
  // F8: the PLUS root is the major arc (sweep > 180 deg, bulge > 1) — Fusion's
  // own T1 waist at 12x6 wraps 244 deg; the minor root alone could not draw it.
  return (R + (major ? 1 : -1) * Math.sqrt(disc)) / halfChord;
}

/** SE14 §4's `kink` construction (unchanged from T53): two `L`s meeting
 *  at a new apex offset perpendicular from the chord's own midpoint. */
function _bulgeApex(a, b, signedBulge, cx) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const od = mx >= cx ? 1 : -1;
  const nx = -dy / len, ny = dx / len;
  const h = signedBulge * (len / 2) * od;
  return { x: mx + nx * h, y: my + ny * h };
}

/** Ground-truth #3's own ported bulge->arc formula (unchanged shape from
 *  T53), PLUS a T55 addition: an exact semicircle special-case (see
 *  `_bulgeFromRadius`'s own doc comment) that builds the arc directly
 *  from the chord midpoint (a semicircle's center IS its chord's
 *  midpoint, since a chord of length===diameter is a diameter) rather
 *  than round-tripping through `arcCenterParam` with a clamped bulge. */
function _arcPrimitive(a, b, signedBulge, cx, up = false) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const od = mx >= cx ? 1 : -1;
  const perpLeftX = -dy / len;
  // T5 HOURGLASS DIPPED TOP (`up`): a top-edge arc's outside is up, (0, -1): perpLeft (-dy, dx)/len . (0, -1).
  const perpLeftIsOutward = up ? -dx / len > 0 : perpLeftX * od > 0;
  // Sign is unaffected by the clamp below (it only clips MAGNITUDE), so
  // this same boolean is valid whether or not the semicircle branch below
  // fires — computed once, from the unclamped sign, and reused by both.
  const isOutward = signedBulge > 0;
  // `sweep` in arcCenterParam's own SVG-command convention: sweep=0 <=>
  // dTheta<0 (`path-layout.js`'s own `if (!sweep && dTheta>0) dTheta-=TAU`).
  const sweep = isOutward === perpLeftIsOutward ? 0 : 1;

  if (Math.abs(Math.abs(signedBulge) - 1) < 1e-6) {
    // Exact semicircle (Ground-truth: R===halfChord makes the chord a
    // diameter, so the center IS the chord's own midpoint — no need to
    // round-trip through arcCenterParam with a clamped bulge at all).
    const R = len / 2;
    const theta1 = Math.atan2(a.y - my, a.x - mx);
    const dTheta = sweep === 0 ? -Math.PI : Math.PI;
    return { type: 'A', cx: mx, cy: my, rx: R, ry: R, phi: 0, theta1, dTheta };
  }

  // SIL-RESOLVE (F5): was +/-0.999, which rebuilt near-semicircle arcs (bulge
  // 0.999..1-1e-6) with a visibly wrong radius and centre (0.013 off on a
  // 200-wide board): exactly the generalized waist arc just below a semicircle.
  // F8: |bulge| > 1 is a MAJOR arc (same side, same sweep flag, large-arc
  // flag set); only the exact-semicircle case above is special-cased.
  const large = Math.abs(signedBulge) > 1 ? 1 : 0;
  const bClamped = large ? signedBulge : Math.max(-(1 - 1e-9), Math.min(1 - 1e-9, signedBulge));
  const R = Math.abs(((len / 2) * (1 + bClamped * bClamped)) / (2 * bClamped));
  const param = arcCenterParam(a.x, a.y, R, R, 0, large, sweep, b.x, b.y);
  if (!param) return { type: 'L', p0: a, p1: b };
  const { cx: ccx, cy: ccy, rx, ry, phi, theta1, dTheta } = param;
  return { type: 'A', cx: ccx, cy: ccy, rx, ry, phi, theta1, dTheta };
}

/** One `PATTERN.shape.segments[i]` entry -> its own primitive(s) — same
 *  contract as T53/54 (unchanged): `bulge` unsigned magnitude, `dir`
 *  carries the sign, `style:'straight'`/near-zero bulge -> `L`,
 *  `'kink'` -> two `L`s via the apex construction, else `'curve'` via
 *  the (now semicircle-aware) bulge->arc formula. */
function _segmentToPrimitives(a, b, seg, cx) {
  const style = seg.style || 'straight';
  const signedBulge = (seg.dir === 'in' ? -1 : 1) * Math.abs(seg.bulge || 0);
  if (style === 'straight' || Math.abs(signedBulge) < 0.001) {
    return [{ type: 'L', p0: a, p1: b }];
  }
  if (style === 'kink') {
    const apex = _bulgeApex(a, b, signedBulge, cx);
    return [{ type: 'L', p0: a, p1: apex }, { type: 'L', p0: apex, p1: b }];
  }
  return [_arcPrimitive(a, b, signedBulge, cx, seg.outward === 'up')];
}

/** A solved arc's own {centerLocal, radius, outward} plus its two chord
 *  endpoints (also local, region-centered, Y-DOWN) -> a default `curve`
 *  segment entry (`{style,bulge,dir,cornerRadius}`), via the exact
 *  inverse bulge formula. `outward` (bool) directly encodes convex
 *  (bulges away from the vertical centerline, `dir:'out'`) vs concave
 *  (`dir:'in'`) — determined by the solver from which side of the chord
 *  the known center sits, not re-derived from `od`/`perpLeftIsOutward`
 *  (those are `_arcPrimitive`'s own internal, reused only to BUILD the
 *  final primitive, not to classify direction here). */
function _curveSegment(a, b, radius, outward, major = false, up = false) {
  const halfChord = Math.hypot(b.x - a.x, b.y - a.y) / 2;
  const bulge = _bulgeFromRadius(radius, halfChord, major);
  // T5 HOURGLASS DIPPED TOP: `up` = a TOP-edge arc, whose outside is up (-y), not away from the centre line.
  return { style: 'curve', bulge, dir: outward ? 'out' : 'in', cornerRadius: 0, ...(up ? { outward: 'up' } : {}) };
}
const STRAIGHT_SEGMENT = { style: 'straight', bulge: 0, dir: 'out', cornerRadius: 0 };

/**
 * HOURGLASS (frame-builder Template 1). Per side (right, then mirrored):
 * top-corner -[horn, straight]- shoulderTangentPt -[shoulder arc,
 * CONVEX]- shoulderWaistJunction -[waist arc, CONCAVE]- waistHipJunction
 * -[hip arc, CONVEX]- hipTangentPt -[horn, straight]- bottom-corner.
 * 12 segments total (2 straight top/bottom edges + 2x(2 horns + 3 arcs)
 * per side) — matches the source's own "12-segment clockwise frame
 * outline" (`p02_03_loop.py`'s own doc comment), a topology check, not
 * a coincidence.
 *
 * Closed form (all three arc centers share ONE skeleton column X,
 * `skelX`, a disclosed simplification — see module header): the
 * shoulder/hip arcs are tangent to the vertical horn at x=halfW (radius
 * = halfW-skelX) AND tangent to the waist arc (radius_waist =
 * skelX-waistX, where waistX is the pinch's own boundary reach). Since
 * both tangencies are EXTERNAL (shoulder is convex, waist is concave —
 * an inflection/S-curve pair) and the centers share one X, the center
 * SEPARATION is a pure vertical distance, giving (real units, so this
 * holds for ANY aspect ratio, not just the source's own 5.51x1.97):
 *   shoulderY - waistCenterY = radius_shoulder + radius_waist
 *                            = (halfW-skelX) + (skelX-waistX) = halfW-waistX
 * `skelX` CANCELS — the shoulder/hip offset from the waist's own Y only
 * depends on how far the waist pinches in, not on the skeleton column's
 * own position (which instead only sets the shoulder/hip radius). A
 * genuinely elegant, disclosed, VERIFIED (via `dot-product tangent`
 * tests) consequence of the tangency algebra, not assumed.
 *
 * A second consequence, also verified by test: the shoulder/hip arcs are
 * ALWAYS exactly quarter circles (90 degrees) — the horn-tangent radius
 * is horizontal, the waist-tangent radius is vertical (both centers
 * share `skelX`), and horizontal is-perpendicular-to-vertical always.
 * The waist arc itself is ALWAYS exactly a semicircle (180 degrees) —
 * its own two endpoints sit at `waistCenterY +/- radius_waist` on the
 * SAME x=skelX as its center, i.e. diametrically opposite.
 */
/**
 * T74 AMEND 2 `strokeHalfWidth` — a TRUE analytic inward offset of the
 * whole drawn contour by a constant amount (0 = today's exact behavior,
 * every arc CENTER (`skelX`/`shoulderY`/`hipY`/`waistCenterY`) stays
 * exactly where it always was; verified numerically (region 7x9,
 * defaults, halfWidth=0.1) before writing this comment: the shoulder arc
 * (convex, radius shrinks by halfWidth) and the waist arc (concave,
 * radius GROWS by halfWidth) land on the EXACT SAME shared tangent point
 * either way, confirming the sign for each. Only three kinds of
 * quantities ever change here: (1) an OUTER wall coordinate used directly
 * (`hw`/`hh`) shrinks toward center by `strokeHalfWidth`; (2) a radius
 * shrinks (convex) or grows (concave) by `strokeHalfWidth`; (3) an
 * arc-to-arc tangent junction's own position (`waistCenterY ∓
 * radiusWaist`) is recomputed from the ADJUSTED radius, since (unlike an
 * arc's own CENTER) a tangent junction point genuinely moves.
 */
function _solveHourglass(region, params, segmentsOverride, seed, strokeHalfWidth = 0) {
  // SIL-RESOLVE (F5): params resolved in declared order inside their
  // declared feasible ranges (see feasibleParamRanges).
  const resolvedAll = _resolveParams('hourglass', region, params, seed, strokeHalfWidth);

  const cx0 = region.x + region.w / 2, cy0 = region.y + region.h / 2;
  // Waist radius = the original shared-column value (depth - cornerRadius)
  // while above the declared floor; below it the centres separate and the
  // arcs stay externally tangent instead of going negative (Fred's loop).
  const { hw, hh, cornerRadiusTop, cornerRadiusBottom, radiusWaist, shoulderCx, shoulderY, hipCx, hipY,
    ux, uy, uxBottom, uyBottom, waistMajor, topInset, topX, shoulderHornX, shoulderHornY, left, topDip, arch,
  } = hourglassConstruction(region, resolvedAll);
  // T4 OFFSET HOURGLASS: the left side from its own construction (the right one's when no left pinch is set).
  const L = left || { shoulderCx, shoulderY, hipCx, hipY, ux, uy, uxBottom, uyBottom, waistMajor, shoulderHornX, shoulderHornY };

  // The ACTUAL drawn radii/walls (§ (2)/(1) above) -- everything from here
  // down uses these, never the raw params computed above directly.
  const topDrawn = cornerRadiusTop - strokeHalfWidth; // convex: shrinks
  const bottomDrawn = cornerRadiusBottom - strokeHalfWidth;
  const radiusWaistDrawn = radiusWaist + strokeHalfWidth; // concave: grows
  const hwDrawn = hw - strokeHalfWidth;
  const hhDrawn = hh - strokeHalfWidth;
  const topDrawnX = topX - strokeHalfWidth; // T3/F30 item 3: the top horns' own drawn x (hwDrawn - topInset when untapered)
  // F30 item 3: the horn's own end where it meets the shoulder arc, drawn -- same unit direction from the
  // (untouched) shoulder centre, scaled by the DRAWN radius instead of the full one (same pattern as the
  // existing shoulder/waist junction below). Equals (topDrawnX, shoulderY) when untapered (the normal is then
  // purely horizontal), so every existing template's own output is unchanged, confirmed bit for bit.
  const hornN = (cx, cy, hx, hy, r) => ({ x: (hx - cx) / r, y: (hy - cy) / r });
  const rHornN = hornN(shoulderCx, shoulderY, shoulderHornX, shoulderHornY, cornerRadiusTop);
  const lHornN = hornN(L.shoulderCx, L.shoulderY, L.shoulderHornX, L.shoulderHornY, cornerRadiusTop);

  const P = (x, y) => ({ x: cx0 + x, y: cy0 + y }); // local (right-positive, Y-down) -> world
  const M = (x, y) => ({ x: cx0 - x, y: cy0 + y }); // mirrored (left side)

  // T10 ARCHED HOURGLASS: the two chord ends sit `rise` BELOW the top edge (not stroke-adjusted, same as the
  // dip's own chord position above -- only its RADIUS gets the stroke treatment, right where the arc is built).
  const topY = -hhDrawn + (arch ? arch.rise : 0);
  // Right side, top -> bottom.
  const rTop = P(topDrawnX, topY);
  const rShoulderHorn = P(shoulderCx + topDrawn * rHornN.x, shoulderY + topDrawn * rHornN.y);
  // Tangent junctions lie on the centre line, the drawn radius out from each centre.
  const rShoulderWaistJct = P(shoulderCx + topDrawn * ux, shoulderY + topDrawn * uy);
  const rWaistHipJct = P(hipCx + bottomDrawn * uxBottom, hipY - bottomDrawn * uyBottom);
  const rHipHorn = P(hwDrawn, hipY);
  const rBottom = P(hwDrawn, hhDrawn);
  // Left side (the mirror of its own construction `L`: exactly the right side's unless T4 sets a left pinch), bottom -> top.
  const lBottom = M(hwDrawn, hhDrawn);
  const lHipHorn = M(hwDrawn, L.hipY);
  const lWaistHipJct = M(L.hipCx + bottomDrawn * L.uxBottom, L.hipY - bottomDrawn * L.uyBottom);
  const lShoulderWaistJct = M(L.shoulderCx + topDrawn * L.ux, L.shoulderY + topDrawn * L.uy);
  const lShoulderHorn = M(L.shoulderCx + topDrawn * lHornN.x, L.shoulderY + topDrawn * lHornN.y);
  const lTop = M(topDrawnX, topY);

  const keypoints = [
    rTop, rShoulderHorn, rShoulderWaistJct, rWaistHipJct, rHipHorn, rBottom,
    lBottom, lHipHorn, lWaistHipJct, lShoulderWaistJct, lShoulderHorn, lTop,
  ];

  const cxWorld = cx0;
  // `segments[i]` connects `keypoints[i] -> keypoints[(i+1)%n]` — since
  // `keypoints[0]===rTop`, the array below starts at the FIRST real edge
  // out of rTop (the horn) and the top edge (lTop -> rTop) is the very
  // LAST entry, matching the loop's own wraparound.
  const fresh = [
    STRAIGHT_SEGMENT, // rTop -> rShoulderHorn (horn)
    _curveSegment(rShoulderHorn, rShoulderWaistJct, topDrawn, true), // shoulder, convex
    _curveSegment(rShoulderWaistJct, rWaistHipJct, radiusWaistDrawn, false, waistMajor), // waist, concave
    _curveSegment(rWaistHipJct, rHipHorn, bottomDrawn, true), // hip, convex
    STRAIGHT_SEGMENT, // rHipHorn -> rBottom (horn)
    STRAIGHT_SEGMENT, // bottom edge: rBottom -> lBottom
    STRAIGHT_SEGMENT, // lBottom -> lHipHorn (horn)
    _curveSegment(lHipHorn, lWaistHipJct, bottomDrawn, true), // hip, convex
    _curveSegment(lWaistHipJct, lShoulderWaistJct, radiusWaistDrawn, false, L.waistMajor), // waist, concave
    _curveSegment(lShoulderWaistJct, lShoulderHorn, topDrawn, true), // shoulder, convex
    STRAIGHT_SEGMENT, // lShoulderHorn -> lTop (horn)
    STRAIGHT_SEGMENT, // top edge: lTop -> rTop
  ];
  // T5 HOURGLASS DIPPED TOP: the flat top edge (segment 11) becomes stub, shoulder, dip, shoulder, stub. The
  // joints sit on the line between the shoulder and dip centres, the DRAWN radius out from each (a convex arc
  // shrinks by the stroke, the concave dip grows by it: the same joint either way). Their bulge is outward UP
  // (the top edge's own outside), not away from the centre line as for a side arc.
  let mirror = null;
  if (topDip) {
    const { halfWidth: a, depth: dd, radius: r, position: pos = 0 } = topDip;
    const rsDrawn = r - strokeHalfWidth, rdDrawn = r + strokeHalfWidth;
    const ux2 = -a / (2 * r), uy2 = (dd - 2 * r) / (2 * r); // unit, shoulder centre -> dip centre (right side)
    // T8 DIPPED TOP + LEFT-ONLY WAVE: `pos` shifts the whole dip (both shoulders + the dip itself) right by that
    // many world units (0 = Template 5's own centred dip): added to every RIGHT-side local x before P(), and
    // subtracted before M() (which itself negates x), so a left- and right-side point at the same nominal local
    // x end up `pos` apart from their un-shifted (centred) position, in the SAME world direction.
    const rDipStart = P(a + pos, -hhDrawn), lDipStart = M(a - pos, -hhDrawn);
    const rDipJct = P(a + pos + rsDrawn * ux2, -hh + r + rsDrawn * uy2), lDipJct = M(a - pos + rsDrawn * ux2, -hh + r + rsDrawn * uy2);
    keypoints.push(lDipStart, lDipJct, rDipJct, rDipStart);
    fresh.splice(11, 1,
      STRAIGHT_SEGMENT, // left stub: lTop -> lDipStart
      _curveSegment(lDipStart, lDipJct, rsDrawn, true, false, true), // left top shoulder, convex
      _curveSegment(lDipJct, rDipJct, rdDrawn, false, false, true), // the dip, concave
      _curveSegment(rDipJct, rDipStart, rsDrawn, true, false, true), // right top shoulder, convex
      STRAIGHT_SEGMENT); // right stub: rDipStart -> rTop
    mirror = fresh.map((_, i) => topDipMirrorIndex(i));
  } else if (arch) {
    // T10 ARCHED HOURGLASS: the flat top edge (segment 11) becomes ONE arc, lTop -> rTop directly (no stub, no
    // separate shoulder arc: unlike T5's dip, this one piece's own two ends ARE the chord, already shifted down
    // by `rise` above). Its radius shrinks by the stroke like any other convex arc; the stroke does not re-seat
    // the chord (same simplification T5's own dip radius takes).
    const archRadiusDrawn = arch.radius - strokeHalfWidth;
    fresh[11] = _curveSegment(lTop, rTop, archRadiusDrawn, true, false, true); // the arch, convex, bulges UP
    // No `mirror` override needed: segment 11 (self-mirrored, same as T1's own flat top) stays
    // `mirrorSegmentIndex(11, 12) === 11`, the plain formula's own fixed point.
  }
  const { segments, hasUserSegments } = _mergeSegments(fresh, segmentsOverride);

  // T59 (SE14 Slice 3's own deferred "axis-locked parametric handles"):
  // the RESOLVED params (explicit value, or default+jitter, already
  // clamped) — a param handle on canvas needs these to seed its own
  // drag-start value and compute its anchor point; PATTERN.shape.params
  // alone only has whatever the user has EXPLICITLY pinned, not a
  // seed-jittered one still sitting at its default. Same fraction units
  // `PATTERN.shape.params` itself stores (0-1, not the `hw`-scaled real-
  // unit values computed just above).
  // F12: every declared param, the derived ones (waistRadius, the two corners) included.
  const resolvedParams = { ...resolvedAll };
  // T3 TAPERED HOURGLASS: a frame-only param is reported only when the caller set it, so a Shape Lattice
  // pattern's (and Template 1's) resolved params -- what a handle seeds from and what the Fusion manifest
  // walks -- are exactly what they were before it existed.
  for (const k of FRAME_ONLY_PARAM_KEYS) if (!params || params[k] == null) delete resolvedParams[k];

  return { keypoints, segments, cx: cxWorld, params: resolvedParams, hasUserSegments, ...(mirror ? { mirror } : {}) };
}

function _normalizeSegment(seg) {
  const out = {
    style: (seg && seg.style) || 'straight',
    bulge: (seg && seg.bulge) || 0,
    dir: (seg && seg.dir) || 'out',
    cornerRadius: (seg && seg.cornerRadius) || 0,
  };
  if (seg && seg.user === true) out.user = true;
  return out;
}

/**
 * SIL-RESOLVE (F5) — declared segment OWNERSHIP. A stored segment is
 * USER-owned when the segment editor wrote it (`user: true`) or when its
 * style/direction differs from what the solver produces (legacy styled
 * segments saved before the flag existed). Every other stored segment is
 * SOLVER-owned and is replaced by the fresh solve, so a slider change never
 * reuses a bulge computed for the OLD params (measured: that alone made 8
 * non-tangent joints at Fred's params). Returns the merged list plus
 * whether any user-owned segment is in it.
 */
function _mergeSegments(fresh, override) {
  if (!Array.isArray(override) || override.length !== fresh.length) return { segments: fresh, hasUserSegments: false };
  let hasUserSegments = false;
  const segments = fresh.map((f, i) => {
    const o = _normalizeSegment(override[i]);
    const own = o.user === true || o.style !== f.style || (o.style !== 'straight' && o.dir !== f.dir);
    if (!own) return f;
    hasUserSegments = true;
    return { ...o, user: true };
  });
  return { segments, hasUserSegments };
}

/**
 * BOTTLE (frame-builder Template 2). Per side (right, then mirrored):
 * top-corner(narrow) -[horn]- neckHornEnd -[neck/waist arc, CONCAVE]-
 * junction -[hip arc, CONVEX]- hipHornEnd -[horn]- bottom-corner(wide).
 * 10 segments total (2 straight edges + 2x(2 horns + 2 arcs)).
 *
 * Same closed-form shape as the hourglass (shared skeleton column X,
 * `skelX`, cancels out of the arc-arc tangency): with `neckHalfW` (narrow
 * top) and `hw` (wide bottom — T74 AMEND 3, see below),
 *   hipCenterY - neckCenterY = radius_neck + radius_body
 *                             = (skelX-neckHalfW) + (hw-skelX)
 *                             = hw - neckHalfW
 * `neckCenterY` is the one independent Y anchor (derived from the
 * declared `neckLength`); `hipCenterY` (and hence the body horn's own
 * length) is DERIVED, not independently settable — same disclosed
 * "tangency removes a degree of freedom" finding as the hourglass.
 *
 * T74 AMEND 3 (Fred: "it needs to fill the box same as hourglass"): the
 * body's own half-width used to be `hw * bodyWidth`, a genuine 0..1
 * fraction never necessarily 1 — retired entirely, along with `bodyWidth`
 * itself (params/jitter/salt/handle/manifest-name/widthExpr, everywhere).
 * The body now always sits at the FULL `hw`, exactly like the hourglass's
 * own body already did — the bottle "fills the box" the same way, so its
 * own contour_width Distance dim is now the SAME bare expression the
 * hourglass uses (resolveWidthExpr's own default), never a scaled one.
 */
// T74 AMEND 2 `strokeHalfWidth` — same analytic inward offset as
// `_solveHourglass`'s own doc comment describes (verified there
// numerically): `skelX`/`neckCenterY`/`hipCenterY` are arc CENTERS and
// never shift; `neckHalfW`/`hw`/`hh` are outer-wall coordinates and shrink
// toward center by `strokeHalfWidth`; `radiusNeck` (concave) grows and
// `radiusBody` (convex) shrinks by `strokeHalfWidth`; `junctionY` (the
// neck/body arcs' own shared tangent point, not a center) is recomputed
// from the ADJUSTED `radiusNeck`.
function _solveBottle(region, params, segmentsOverride, seed, strokeHalfWidth = 0) {
  // SIL-RESOLVE (F5): declared-order resolution inside feasible ranges.
  const resolvedAll = _resolveParams('bottle', region, params, seed, strokeHalfWidth);
  const cx0 = region.x + region.w / 2, cy0 = region.y + region.h / 2;
  // F8/F12: the body radius (bodyRadius, default the shared column) sets the body
  // centre at hw - rB; the external tangency with the neck arc gives its height.
  const { hw, hh, neckHalfW, skelX, radiusNeck, radiusBody, neckCenterY, hipCenterY, bux, buy, neckTopX,
    neckHornX, neckHornY } = bottleConstruction(region, resolvedAll);

  // The ACTUAL drawn radii/walls -- everything from here down uses these.
  const radiusNeckDrawn = radiusNeck + strokeHalfWidth; // concave: grows
  const radiusBodyDrawn = radiusBody - strokeHalfWidth; // convex: shrinks
  const hwDrawn = hw - strokeHalfWidth;
  const hhDrawn = hh - strokeHalfWidth;
  const neckTopXDrawn = neckTopX - strokeHalfWidth; // F30 item 3: the top horns' own drawn x (neckHalfWDrawn untapered)
  // F30 item 3: the horn's own end where it meets the neck arc, drawn -- same unit direction from the (untouched)
  // neck centre, scaled by the drawn radius (same pattern as _solveHourglass's own rShoulderHorn). Equals
  // (neckTopXDrawn, neckCenterY) when untapered, confirmed bit for bit.
  const neckHornN = { x: (neckHornX - skelX) / radiusNeck, y: (neckHornY - neckCenterY) / radiusNeck };
  // Shared tangent point: on the centre line, the drawn neck radius out from the neck centre.
  const junctionX = skelX + bux * radiusNeckDrawn;
  const junctionY = neckCenterY + buy * radiusNeckDrawn;

  const P = (x, y) => ({ x: cx0 + x, y: cy0 + y });
  const M = (x, y) => ({ x: cx0 - x, y: cy0 + y });

  const rTop = P(neckTopXDrawn, -hhDrawn);
  const rNeckHorn = P(skelX + radiusNeckDrawn * neckHornN.x, neckCenterY + radiusNeckDrawn * neckHornN.y);
  const rJunction = P(junctionX, junctionY);
  const rHipHorn = P(hwDrawn, hipCenterY);
  const rBottom = P(hwDrawn, hhDrawn);
  const lBottom = M(hwDrawn, hhDrawn);
  const lHipHorn = M(hwDrawn, hipCenterY);
  const lJunction = M(junctionX, junctionY);
  const lNeckHorn = M(skelX + radiusNeckDrawn * neckHornN.x, neckCenterY + radiusNeckDrawn * neckHornN.y);
  const lTop = M(neckTopXDrawn, -hhDrawn);

  const keypoints = [rTop, rNeckHorn, rJunction, rHipHorn, rBottom, lBottom, lHipHorn, lJunction, lNeckHorn, lTop];

  // Same wraparound convention as the hourglass solver above: `keypoints[0]
  // ===rTop`, so this array starts at the first real edge out of rTop and
  // the top edge (lTop -> rTop) is the LAST entry.
  const fresh = [
    STRAIGHT_SEGMENT, // rTop -> rNeckHorn (horn)
    _curveSegment(rNeckHorn, rJunction, radiusNeckDrawn, false), // neck/waist, concave
    _curveSegment(rJunction, rHipHorn, radiusBodyDrawn, true), // hip/body, convex
    STRAIGHT_SEGMENT, // rHipHorn -> rBottom (horn)
    STRAIGHT_SEGMENT, // bottom edge
    STRAIGHT_SEGMENT, // lBottom -> lHipHorn (horn)
    _curveSegment(lHipHorn, lJunction, radiusBodyDrawn, true), // hip/body, convex
    _curveSegment(lJunction, lNeckHorn, radiusNeckDrawn, false), // neck/waist, concave
    STRAIGHT_SEGMENT, // lNeckHorn -> lTop (horn)
    STRAIGHT_SEGMENT, // top edge: lTop -> rTop
  ];
  const { segments, hasUserSegments } = _mergeSegments(fresh, segmentsOverride);

  // T59: see _solveHourglass's own doc comment on why this is returned.
  // F12: every declared param, the derived bodyRadius included.
  const resolvedParams = { ...resolvedAll };
  // F30 item 3: taperAngle is bottle's own first frame-only param (see _solveHourglass's own doc comment on
  // this exact loop, T3) -- reported only when the caller set it, so a Shape Lattice pattern's (and Template 2's)
  // resolved params stay exactly what they were before it existed.
  for (const k of FRAME_ONLY_PARAM_KEYS) if (!params || params[k] == null) delete resolvedParams[k];

  return { keypoints, segments, cx: cx0, params: resolvedParams, hasUserSegments };
}

/** T6 TAB TOP: the construction from RESOLVED params (region-local, Y-down, inches): the tab's half width and
 *  height, and the shoulders' y (region top + height). The ONE place this algebra lives (solver and handles). */
export function tabTopConstruction(region, resolved) {
  const hw = region.w / 2, hh = region.h / 2, D = DERIVED_PARAM_DEFAULTS.tabTop;
  const halfWidth = hw * (resolved.tabWidth ?? D.tabWidth(resolved));
  const height = hh * (resolved.tabHeight ?? D.tabHeight(resolved));
  return { hw, hh, halfWidth, height, shoulderY: -hh + height };
}

/**
 * T6 TAB TOP solver: 8 straight pieces (see TAB_TOP_SEGMENT_COUNT). `strokeHalfWidth` insets the drawn outline
 * (every wall moves in by it: the tab sides in, the shoulders down, the top down, the sides and base in). The
 * outline carries its own mirror table (= mirrorSegmentIndex(i, 8)) so a from-frame contour that drops a piece
 * still pairs the right ones.
 */
function _solveTabTop(region, params, segmentsOverride, seed, strokeHalfWidth = 0) {
  const resolvedAll = _resolveParams('tabTop', region, params, seed, strokeHalfWidth);
  const cx0 = region.x + region.w / 2, cy0 = region.y + region.h / 2;
  const { hw, hh, halfWidth, shoulderY } = tabTopConstruction(region, resolvedAll);
  const s = strokeHalfWidth, hwD = hw - s, hhD = hh - s, aD = halfWidth - s, yS = shoulderY + s;
  const P = (x, y) => ({ x: cx0 + x, y: cy0 + y });
  const keypoints = [
    P(aD, -hhD), P(aD, yS), P(hwD, yS), P(hwD, hhD), // tab top R, inside R, shoulder R, bottom R
    P(-hwD, hhD), P(-hwD, yS), P(-aD, yS), P(-aD, -hhD), // bottom L, shoulder L, inside L, tab top L
  ];
  const fresh = keypoints.map(() => STRAIGHT_SEGMENT);
  const { segments, hasUserSegments } = _mergeSegments(fresh, segmentsOverride);
  const mirror = fresh.map((_, i) => (i === 3 || i === 7 ? i : 6 - i));
  return { keypoints, segments, cx: cx0, params: { ...resolvedAll }, hasUserSegments, mirror };
}

/** T9 I SHAPE: the construction from RESOLVED params (region-local, Y-down, inches): the stem's half width, the
 *  flange height, and the two shoulders' y (symmetric about the centre: top at -hh + height, bottom at
 *  hh - height). The ONE place this algebra lives (solver and handles). */
export function iShapeConstruction(region, resolved) {
  const hw = region.w / 2, hh = region.h / 2, D = DERIVED_PARAM_DEFAULTS.iShape;
  const halfWidth = hw * (resolved.stemWidth ?? D.stemWidth(resolved));
  const height = hh * (resolved.flangeHeight ?? D.flangeHeight(resolved));
  return { hw, hh, halfWidth, height, topShoulderY: -hh + height, bottomShoulderY: hh - height };
}

/**
 * T9 I SHAPE solver: 12 straight pieces (see I_SHAPE_SEGMENT_COUNT). `strokeHalfWidth` insets the drawn outline
 * (every wall moves in by it: the flange sides in, the shoulders toward the centre, the stem sides in, the top
 * and base in) -- Template 6's own tab inset, applied at all 4 notches.
 */
function _solveIShape(region, params, segmentsOverride, seed, strokeHalfWidth = 0) {
  const resolvedAll = _resolveParams('iShape', region, params, seed, strokeHalfWidth);
  const cx0 = region.x + region.w / 2, cy0 = region.y + region.h / 2;
  const { hw, hh, halfWidth, topShoulderY, bottomShoulderY } = iShapeConstruction(region, resolvedAll);
  const s = strokeHalfWidth, hwD = hw - s, hhD = hh - s, aD = halfWidth - s;
  const ysT = topShoulderY + s, ysB = bottomShoulderY - s;
  const P = (x, y) => ({ x: cx0 + x, y: cy0 + y });
  const keypoints = [
    P(-hwD, -hhD), P(hwD, -hhD), P(hwD, ysT), P(aD, ysT), // TL, TR, notch TR outer, notch TR inner
    P(aD, ysB), P(hwD, ysB), P(hwD, hhD), P(-hwD, hhD), // notch BR inner, notch BR outer, BR, BL
    P(-hwD, ysB), P(-aD, ysB), P(-aD, ysT), P(-hwD, ysT), // notch BL outer, notch BL inner, notch TL inner, notch TL outer
  ];
  const fresh = keypoints.map(() => STRAIGHT_SEGMENT);
  const { segments, hasUserSegments } = _mergeSegments(fresh, segmentsOverride);
  return { keypoints, segments, cx: cx0, params: { ...resolvedAll }, hasUserSegments };
}

/**
 * T7 DIAMOND-TOP HOURGLASS: the construction from RESOLVED params (region-local, Y-DOWN, inches), ported directly
 * from fb_engine/t7_geometry.py's own tested closed form (`t7_outline`) and fb_engine/t7_roof_eave.py's own
 * `roof_geometry` -- read before writing this, not re-derived. The ONE place this algebra lives (solver and
 * on-canvas handles, editor-shape-lattice-interaction.js). Coordinates here are Y-DOWN (top = -hh, matching
 * every other construction in this file); the Python source is Y-UP, board-local -- the underlying vector
 * algebra (`rBody`/`rNeck` from chord/centre differences) is coordinate-direction-agnostic, so no sign flip is
 * needed beyond building E/N/B/peak/base in THIS file's own Y-DOWN convention from the start.
 *
 *   a: the 90-degree roof's own half-width/height (rise=run), capped so it never outgrows the board.
 *   peak/E: the apex and the right eave tip (mirror x for the left).
 *   rest: the vertical run from the eave down to the base.
 *   N/B: the neck (narrowest) and body (full-width) points, placed by the 3 handle fractions.
 *   rNeck/cNeck (concave), rBody/cBody (convex): the two tangent arcs, solved exactly as t7_outline does --
 *     the body arc passes through N and B and is tangent to the vertical side at B; the neck arc passes through
 *     E and N and is tangent to the body arc at N (the genuine S-curve: opposite curvature, centres colinear
 *     with N).
 */
export function diamondTopHourglassConstruction(region, resolved) {
  const hw = region.w / 2, hh = region.h / 2, D = DERIVED_PARAM_DEFAULTS.diamondTopHourglass;
  const neckWidthOfHw = resolved.gableNeckWidth ?? D.gableNeckWidth(resolved);
  const neckHeightFrac = resolved.neckHeight ?? D.neckHeight(resolved);
  const bodyFlareFrac = resolved.bodyFlareHeight ?? D.bodyFlareHeight(resolved);
  const a = Math.min(0.62 * hw, 0.84 * hh);
  const peak = { x: 0, y: -hh };
  const E = { x: a, y: -hh + a };
  const rest = 2 * hh - a;
  const nx = Math.max(neckWidthOfHw * hw, a * 0.70);
  const N = { x: nx, y: E.y + neckHeightFrac * rest };
  const B = { x: hw, y: E.y + bodyFlareFrac * rest };
  const base = { x: hw, y: hh };

  const dy = N.y - B.y, dxN = N.x - B.x;
  const rBody = -(dxN * dxN + dy * dy) / (2 * dxN);
  const cBody = { x: hw - rBody, y: B.y };
  let ux = N.x - cBody.x, uy = N.y - cBody.y;
  const ulen = Math.hypot(ux, uy) || 1;
  ux /= ulen; uy /= ulen;
  const vx = N.x - E.x, vy = N.y - E.y;
  const vDotU = vx * ux + vy * uy, v2 = vx * vx + vy * vy;
  const rNeck = -v2 / (2 * vDotU);
  const cNeck = { x: N.x + rNeck * ux, y: N.y + rNeck * uy };

  return { hw, hh, a, rest, peak, E, N, B, base, rNeck, cNeck, rBody, cBody };
}

/**
 * T11 HOURGLASS ROOF: Template 7's own gable roof + eave (`a`, `peak`, `E` -- the identical formula,
 * diamondTopHourglassConstruction's own) over Template 1's own 3-arc shoulder/waist/hip pinch side, REUSED by
 * calling `hourglassConstruction` itself rather than re-deriving its algebra a second time (the ONE place that
 * algebra lives, per that function's own doc comment) -- ported from fb_engine/t11_geometry.py's own
 * `t11_outline`/`_hourglass_side` (read before writing this, not re-derived from scratch), the only other place
 * this exact composition exists.
 *
 * The trick: Template 1's own side construction is always resolved against the FULL region half-height (`hh`,
 * read directly for `waistCenterY = hh * waistCenterYFrac`) -- but T11's side only has the room BELOW the roof's
 * own eave to work with, a shorter "virtual" region. Calling `hourglassConstruction` with a virtual region of the
 * SAME width but height `2*hh - a` (so ITS OWN internal half-height is `hh - a/2`, the sub-region's true half-
 * height) reproduces fb_engine/t11_geometry.py's own `_hourglass_side(region_w, region_h=eave_y, ...)` call
 * exactly -- `topInset = hw - a` (as a FRACTION of hw, `(hw-a)/hw`, since `hourglassConstruction` itself multiplies
 * by hw) places the side's own top horn exactly at x=a, directly below E (the eave's own vertical straight bar).
 *
 * The sub-call's own return is in ITS region's local frame (Y-down, origin at the SUB-region's own centre) --
 * every Y-valued field is re-expressed in the OUTER region's own frame (origin at the full region's centre) by
 * adding `a/2` (the two origins are exactly that far apart on Y, both derived from the SAME sub-region anchored
 * flush with the full region's own bottom edge): MEASURED, not assumed -- verified by hand against
 * fb_engine/t11_geometry.py's own `t11_outline()` at 7x9/thickness 0.75 (every one of shoulderHorn/
 * shoulderWaistJct/waistHipJct/hipHorn/CWaist's own board-coordinate values converts to this function's frame and
 * matches to the last published digit). X-valued fields (shoulderCx, hipCx, topX, waistX) need no shift: the
 * sub-region shares the full region's own vertical centreline.
 */
export function diamondTopHourglassPinchConstruction(region, resolved) {
  const hw = region.w / 2, hh = region.h / 2;
  const a = Math.min(0.62 * hw, 0.84 * hh);
  const peak = { x: 0, y: -hh };
  const E = { x: a, y: -hh + a };
  const g = hourglassConstruction({ w: region.w, h: 2 * hh - a }, { ...resolved, topInset: (hw - a) / hw });
  const shift = a / 2;
  return {
    hw, hh, a, peak, E, base: { x: hw, y: hh },
    depth: g.depth, radiusWaist: g.radiusWaist, waistCenterY: g.waistCenterY + shift, waistCx: g.waistCx,
    topX: g.topX, waistX: g.waistX,
    cornerRadiusTop: g.cornerRadiusTop, cornerRadiusBottom: g.cornerRadiusBottom,
    shoulderCx: g.shoulderCx, shoulderY: g.shoulderY + shift,
    hipCx: g.hipCx, hipY: g.hipY + shift,
    ux: g.ux, uy: g.uy, uxBottom: g.uxBottom, uyBottom: g.uyBottom,
    notchHalfSpan: g.notchHalfSpan, waistMajor: g.waistMajor,
  };
}

/** The true line-circle intersection between a line through `p0` (direction `(ux,uy)`, a UNIT vector) and the
 *  circle `(center, radius)`, choosing whichever root's own `s` (distance along the line from `p0`) is closer to
 *  `referenceS` -- the other root is the line's far-side crossing, not a real corner. Ported from
 *  fb_engine/t7_roof_eave.py's own `_line_circle_intersection_nearer` (shared by the miter inset below; pure
 *  vector algebra, coordinate-direction-agnostic). */
function _lineCircleIntersectionNearer(p0, ux, uy, center, radius, referenceS) {
  const px = p0.x - center.x, py = p0.y - center.y;
  const b = 2 * (px * ux + py * uy), c = px * px + py * py - radius * radius;
  const disc = Math.max(0, b * b - 4 * c), sq = Math.sqrt(disc);
  const s1 = (-b + sq) / 2, s2 = (-b - sq) / 2;
  const s = Math.abs(s1 - referenceS) < Math.abs(s2 - referenceS) ? s1 : s2;
  return { x: p0.x + s * ux, y: p0.y + s * uy };
}

/**
 * T7 DIAMOND-TOP HOURGLASS: a curve segment (`{style,bulge,dir,cornerRadius}`) for a chord (world coords
 * `a`->`b`) whose tangent circle's CENTRE is already independently known (`center`, `radius` --
 * `diamondTopHourglassConstruction`'s own closed-form solve, verified exactly against
 * fb_engine/t7_geometry.py's own tested math). `cx` is the region's own world centre-line x (the 4th arg
 * `generateSilhouette`'s own loop already threads through every `_segmentToPrimitives` call). `sweepSign`
 * (+1/-1) is the dTheta sign this arc must sweep (see below) -- for a SINGLE, consistently-oriented closed
 * outline, a CONVEX piece always sweeps one rotational sense about its own centre and a CONCAVE piece always
 * sweeps the other, regardless of the specific board/handle numbers (a topological fact about the outline's own
 * fixed orientation, not something that can flip) -- `+1` for the body arc (convex), `-1` for the neck arc
 * (concave) MEASURED against the one known-good case (see below) and consistent on both the right and the
 * mirrored left side.
 *
 * MEASURED, not assumed (the TWO bugs this function fixes): (1) `_curveSegment`'s own "radius + outward(bool)"
 * contract picks one of the (generically 2) circles of that radius through `a`/`b` via a side-of-centreline
 * heuristic (`_arcPrimitive`'s own `od`/`perpLeftIsOutward`) that silently FLIPS which side the correct
 * tangent-circle's centre actually lands on as this shape's own handle-driven proportions change; (2) even once
 * the CENTRE is right, the SAME centre is reachable via two different (`largeArc`,`sweep`) SVG-flag pairs that
 * sweep in OPPOSITE rotational directions (the minor arc one way, the major arc the other) -- picking the first
 * centre-match alone (as an earlier version of this function did) can silently pick the reversed one, which
 * looks fine positionally but hands the next segment a backwards tangent (`outlineDefects`' own `notTangent`,
 * `detail: -1` -- exactly opposite, not merely misaligned). Every OTHER preset in this codebase only ever calls
 * `_curveSegment` with a FIXED semantic convexity on arcs whose own centre/sweep relationship never flips
 * across their declared range, so neither bug was ever exercised before. Rather than re-deriving
 * `_arcPrimitive`'s exact sign convention by hand (shared, heavily-used code; a wrong by-hand re-derivation here
 * is exactly as risky as the bug itself), this tries all 4 `(major, dir)` combinations through the SAME
 * production functions (`_bulgeFromRadius` + `_segmentToPrimitives`) and keeps whichever one's RECONSTRUCTED
 * centre AND dTheta sign both match the known-correct ones -- self-verifying against ground truth via the real
 * pipeline, not a predicted sign.
 */
/** Every `(major,dir)` combination whose reconstructed primitive's centre matches `center` (there are at most
 *  2: the same circle, swept the short way or the long way around) -- the raw material
 *  `_tangentPairForKnownCenters` below picks between, and `_curveSegmentForKnownCenter` falls back to when it
 *  has no partner arc to check consistency against (the single-arc heuristic, kept only as that fallback). */
function _knownCentreCandidates(a, b, center, radius, cx) {
  const halfChord = Math.hypot(b.x - a.x, b.y - a.y) / 2;
  const sameCentre = (p) => p.type === 'A' && Math.hypot(p.cx - center.x, p.cy - center.y) < 1e-6 * Math.max(1, radius);
  const out = [];
  for (const major of [false, true]) {
    const bulge = _bulgeFromRadius(radius, halfChord, major);
    for (const dir of ['out', 'in']) {
      const seg = { style: 'curve', bulge, dir, cornerRadius: 0 };
      const [prim] = _segmentToPrimitives(a, b, seg, cx);
      if (sameCentre(prim)) out.push({ seg, prim });
    }
  }
  return out;
}

/** The direction-of-travel tangent (unit vector) at an arc primitive's own start/end -- same formula
 *  `outlineDefects`' own `dirAt` uses (the sign `s` flips the raw derivative so it always points the way theta
 *  actually moves along this arc, not just "theta increasing"). */
const _arcTangentAt = (p, atEnd) => {
  const th = atEnd ? p.theta1 + p.dTheta : p.theta1, s = p.dTheta > 0 ? 1 : -1;
  return { x: -Math.sin(th) * s, y: Math.cos(th) * s };
};
const _endTangent = (p) => _arcTangentAt(p, true);

/**
 * T7 DIAMOND-TOP HOURGLASS: the (segment, segment) PAIR for two arcs that share a tangent point `shared` --
 * centres/radii already known (`diamondTopHourglassConstruction`'s own closed-form solve) -- picked so their
 * tangents AT `shared` actually agree (dot product near +1), not just each arc's own centre/radius being right.
 * `afterDir`, when given, is the direction of the STRAIGHT piece the second arc's own END must also be tangent
 * to (e.g. the vertical side below the body arc) -- checked together with the shared-point agreement, not as a
 * separate, later pass, so a candidate that is only tangent at ONE of its two real joints is never picked.
 *
 * MEASURED, not assumed (the bugs this fixes, both found by a full board x handle-value sweep,
 * tests/frame-template-7.test.js, AFTER `_curveSegmentForKnownCenter`'s own single-arc fix): (1) checking each
 * arc's own end-tangent against ITS OWN chord independently is not enough -- two arcs can each look fine
 * against their own chord and still hand each other an exactly-reversed tangent at the shared point
 * (`outlineDefects`' own `notTangent, detail: -1`); (2) even once the SHARED point agrees, the same arc can
 * still be tangent-inconsistent at its OTHER end (the straight side next to it) -- `beforeDir`/`afterDir` catch
 * that too, in the SAME search, rather than a plausible-looking pair being accepted and failing one joint over.
 * `beforeDir`: the straight piece BEFORE `aStart` (checked against the first arc's own START tangent) --
 * `afterDir`: the straight piece AFTER `bEnd` (checked against the second arc's own END tangent). Pass whichever
 * applies (the right side's own body arc ends at a straight side: `afterDir`; the left side's own traversal
 * meets its straight side FIRST: `beforeDir`).
 */
function _tangentPairForKnownCenters(aStart, shared, bEnd, cA, rA, cB, rB, cx, { beforeDir, afterDir } = {}) {
  const candA = _knownCentreCandidates(aStart, shared, cA, rA, cx);
  const candB = _knownCentreCandidates(shared, bEnd, cB, rB, cx);
  let best = null, bestScore = -Infinity;
  for (const a of candA) {
    const beforeOk = !beforeDir || (() => {
      const t = _arcTangentAt(a.prim, false);
      return t.x * beforeDir.x + t.y * beforeDir.y > 1 - 1e-6;
    })();
    const ta = _endTangent(a.prim);
    for (const b of candB) {
      const tb = _arcTangentAt(b.prim, false);
      const sharedDot = ta.x * tb.x + ta.y * tb.y;
      const tEnd = _endTangent(b.prim);
      const afterOk = !afterDir || tEnd.x * afterDir.x + tEnd.y * afterDir.y > 1 - 1e-6;
      if (beforeOk && sharedDot > 1 - 1e-6 && afterOk) return [a.seg, b.seg];
      // No combination satisfied every joint exactly (an extreme board/handle corner outside this template's own
      // tested-safe range, e.g. 5.51x1.97 -- LIVE_CHECK.md) -- keep the best-agreeing candidate instead of
      // throwing, so the app degrades to a visibly imperfect preview rather than a hard crash. Scored on the
      // SHARED-point agreement primarily (the worse failure mode, a visibly reversed arc), the straight-side
      // agreements as a tiebreaker.
      const score = sharedDot + (beforeOk ? 0.1 : 0) + (afterOk ? 0.1 : 0);
      if (score > bestScore) { bestScore = score; best = [a.seg, b.seg]; }
    }
  }
  if (best) return best;
  // Only reachable if NEITHER centre candidate set even matched its own circle (a/b not actually on the circle
  // `cA`/`cB`/`rA`/`rB` describe) -- a real construction bug, not an extreme-range quality issue; fails loudly.
  throw new Error('_tangentPairForKnownCenters: no centre-matching candidate at all (a construction bug, not a range issue)');
}

/** Single-arc fallback (no partner to check against -- unused by the neck/body pair today, kept for parity with
 *  `_curveSegment`'s own single-arc contract and any future caller with only one known centre). */
function _curveSegmentForKnownCenter(a, b, center, radius, cx) {
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const { seg, prim } of _knownCentreCandidates(a, b, center, radius, cx)) {
    const t = _endTangent(prim);
    if (t.x * dx + t.y * dy > 0) return seg;
  }
  throw new Error('_curveSegmentForKnownCenter: no (major, dir) combination matched the known centre and sweep');
}

/**
 * T7 DIAMOND-TOP HOURGLASS solver: 9 pieces (see this module's own `_OUTLINE` convention in
 * template_data.py: roof_R, arc_neck_R, arc_body_R, side_R, bottom_edge, side_L, arc_body_L, arc_neck_L, roof_L).
 * `strokeHalfWidth` insets the drawn outline exactly as every other preset's own inset does (an arc centre never
 * moves, a convex radius shrinks, a concave one grows; a straight wall translates inward) -- UNEXERCISED with a
 * non-zero value by any real caller today (this is a frame-only preset: the Frame tab's own profile render,
 * frame-handles.js and contour-from-frame.js all call `generateSilhouette` with no 3rd argument, i.e. 0 -- same
 * as every other frame-only preset's own callers), implemented anyway rather than left half-done, reusing the
 * SAME true-miter (peak) / line-circle-intersection (eave) math fb_engine/t7_roof_eave.py already proves for
 * Fusion's own `frame_thickness` offset, with `s` in place of `frame_thickness`.
 *
 * The neck/body arcs use `_curveSegmentForKnownCenter` (not the plain `_curveSegment`): MEASURED, not assumed,
 * that a fixed convex/concave label is not enough here (see that function's own doc comment) -- self-verified
 * against the already-known, independently-solved `cNeck`/`cBody` instead.
 */
function _solveDiamondTopHourglass(region, params, segmentsOverride, seed, strokeHalfWidth = 0) {
  const resolvedAll = _resolveParams('diamondTopHourglass', region, params, seed, strokeHalfWidth);
  const cx0 = region.x + region.w / 2, cy0 = region.y + region.h / 2;
  const g = diamondTopHourglassConstruction(region, resolvedAll);
  const s = strokeHalfWidth;
  const P = (x, y) => ({ x: cx0 + x, y: cy0 + y });
  const M = (x, y) => ({ x: cx0 - x, y: cy0 + y });

  const rBodyDrawn = g.rBody - s, rNeckDrawn = g.rNeck + s;
  const hwD = g.hw - s, hhD = g.hh - s;
  const baseR = P(hwD, hhD), baseL = M(hwD, hhD);
  // Peak: the true miter offset (t7_roof_eave.peak_inner_corner) -- both roof lines at +/-45deg, so by symmetry
  // the inset peak lies exactly on the centreline, s*sqrt(2) toward the interior (+y, this Y-DOWN convention).
  const peakIn = { x: 0, y: -g.hh + s * Math.SQRT2 };
  // Eave (right; mirror x for the left): the roof line's own inward normal (toward the board centre), offset by
  // s, intersected with the neck arc's own GROWN (concave) offset circle -- t7_roof_eave.eave_inner_corner.
  const dxE = g.E.x - g.peak.x, dyE = g.E.y - g.peak.y, lineLen = Math.hypot(dxE, dyE);
  let nx = -dyE / lineLen, ny = dxE / lineLen;
  const mid = { x: (g.peak.x + g.E.x) / 2, y: (g.peak.y + g.E.y) / 2 };
  if (nx * (0 - mid.x) + ny * (0 - mid.y) < 0) { nx = -nx; ny = -ny; }
  const p0 = { x: g.peak.x + nx * s, y: g.peak.y + ny * s };
  const eaveInR = _lineCircleIntersectionNearer(p0, dxE / lineLen, dyE / lineLen, g.cNeck, rNeckDrawn, lineLen);
  const eaveInL = { x: -eaveInR.x, y: eaveInR.y };

  const peakR = P(peakIn.x, peakIn.y), peakL = peakR; // one shared point, both roof lines end there
  const eaveR = P(eaveInR.x, eaveInR.y), eaveL = P(eaveInL.x, eaveInL.y);
  const bR = P(hwD, g.B.y), bL = M(hwD, g.B.y); // tangent point x shifts WITH the inset wall (see module docstring)
  // The arcs' own centres never move under the inset; mirrored for the left (M negates x only).
  const cNeckR = P(g.cNeck.x, g.cNeck.y), cNeckL = M(g.cNeck.x, g.cNeck.y);
  const cBodyR = P(g.cBody.x, g.cBody.y), cBodyL = M(g.cBody.x, g.cBody.y);
  // N (the neck/body arcs' own mutual tangent point) is NOT a wall tangent point -- it shifts along the
  // cNeck->cBody line under inset (centres fixed, but rNeck GROWS and rBody SHRINKS by the same `s`, so the
  // point `rNeckDrawn` from cNeck along that line moves toward cBody). MEASURED: reusing the un-inset N here
  // (an earlier version of this function did) put it off both the grown AND the shrunk circle by exactly `s`,
  // which `_curveSegmentForKnownCenter` could never match for ANY (major,dir) pair -- caught by a real non-zero
  // stroke width (manifestFromShape's own PATTERN_DEFAULTS default), not assumed safe at s=0 alone.
  const ux = (g.cBody.x - g.cNeck.x) / (g.rNeck + g.rBody), uy = (g.cBody.y - g.cNeck.y) / (g.rNeck + g.rBody);
  const nInset = { x: g.cNeck.x + rNeckDrawn * ux, y: g.cNeck.y + rNeckDrawn * uy };
  const nR = P(nInset.x, nInset.y), nL = M(nInset.x, nInset.y);

  // Right side and left side: the neck/body arc PAIR resolved together per side (`_tangentPairForKnownCenters`),
  // not independently -- see that function's own doc comment for why an independent, per-arc choice is not
  // enough (two arcs can each look fine against their own chord and still disagree with each other at N). The
  // right side's own traversal is eaveR->nR->bR (neck then body); the left side runs the OPPOSITE way round the
  // loop (bL->nL->eaveL, p02_02_loop.py's own clockwise convention), so its pair is resolved body-then-neck.
  // The straight side below each body arc (side_R: bR->baseR; side_L: baseL->bL) is a real tangent joint too,
  // checked in the SAME search as the shared-point agreement (see _tangentPairForKnownCenters' own doc comment).
  const sideRDir = { x: baseR.x - bR.x, y: baseR.y - bR.y };
  const sideLDir = { x: bL.x - baseL.x, y: bL.y - baseL.y };
  const [neckSegR, bodySegR] = _tangentPairForKnownCenters(eaveR, nR, bR, cNeckR, rNeckDrawn, cBodyR, rBodyDrawn, cx0, { afterDir: sideRDir });
  const [bodySegL, neckSegL] = _tangentPairForKnownCenters(bL, nL, eaveL, cBodyL, rBodyDrawn, cNeckL, rNeckDrawn, cx0, { beforeDir: sideLDir });

  const keypoints = [peakR, eaveR, nR, bR, baseR, baseL, bL, nL, eaveL];
  const fresh = [
    STRAIGHT_SEGMENT, // 0: peak -> eave_R (roof_R)
    neckSegR, // 1: eave_R -> N_R (neck, concave)
    bodySegR, // 2: N_R -> B_R (body, convex)
    STRAIGHT_SEGMENT, // 3: B_R -> base_R (side_R)
    STRAIGHT_SEGMENT, // 4: base_R -> base_L (bottom_edge)
    STRAIGHT_SEGMENT, // 5: base_L -> B_L (side_L)
    bodySegL, // 6: B_L -> N_L (body, convex)
    neckSegL, // 7: N_L -> eave_L (neck, concave)
    STRAIGHT_SEGMENT, // 8: eave_L -> peak (roof_L)
  ];
  const { segments, hasUserSegments } = _mergeSegments(fresh, segmentsOverride);
  // T6 TAB TOP's own convention: a declared mirror table, not the generic default. bottom_edge (4) straddles the
  // centreline and self-maps; every other piece i pairs with 8-i (which also gives 4 -> 4).
  const mirror = fresh.map((_, i) => 8 - i);

  return { keypoints, segments, cx: cx0, params: { ...resolvedAll }, hasUserSegments, mirror };
}

/**
 * T11 HOURGLASS ROOF solver: 13 pieces (see this module's own `_OUTLINE` convention in template_data.py:
 * roof_R, eave_straight_R, arc_shoulder_R, arc_waist_R, arc_hip_R, side_straight_R, bottom_edge, side_straight_L,
 * arc_hip_L, arc_waist_L, arc_shoulder_L, eave_straight_L, roof_L). The shoulder/waist/hip arcs are drawn exactly
 * as `_solveHourglass` draws Template 1's own (same construction, reused via `diamondTopHourglassPinchConstruction`
 * -- the horn-to-arc and arc-to-arc joints are all simple "drawn radius out from a fixed centre" points, no
 * intersection search needed, exactly as Template 1's own convex/concave corners never flip). `strokeHalfWidth`
 * insets the drawn outline the same way as Template 1's (an arc centre never moves, a convex radius shrinks, a
 * concave one grows) PLUS the roof's own peak (Template 7's true-miter formula, identical: both roof lines at
 * +/-45deg, symmetric) and the eave corner, which is a PLAIN two-straight-line miter (the 45-degree roof line
 * meeting the VERTICAL eave bar) -- simpler than Template 7's own eave (a line/CIRCLE intersection, because
 * Template 7's roof runs straight into its neck arc with no intervening straight bar): mirrors
 * fb_engine/t11_geometry.py's own `_line_line_inner_corner` (the general two-offset-line intersection),
 * specialized to this one fixed pair. UNEXERCISED with a non-zero stroke by any real caller today (a frame-only
 * preset: every real caller passes 0, same as every other frame-only preset here) -- implemented anyway rather
 * than left half-done, same call Template 7's own solver made.
 */
function _solveDiamondTopHourglassPinch(region, params, segmentsOverride, seed, strokeHalfWidth = 0) {
  const resolvedAll = _resolveParams('diamondTopHourglassPinch', region, params, seed, strokeHalfWidth);
  const cx0 = region.x + region.w / 2, cy0 = region.y + region.h / 2;
  const g = diamondTopHourglassPinchConstruction(region, resolvedAll);
  const s = strokeHalfWidth;
  const P = (x, y) => ({ x: cx0 + x, y: cy0 + y });
  const M = (x, y) => ({ x: cx0 - x, y: cy0 + y });

  const topDrawn = g.cornerRadiusTop - s, bottomDrawn = g.cornerRadiusBottom - s; // convex: shrinks
  const radiusWaistDrawn = g.radiusWaist + s; // concave: grows
  const hwDrawn = g.hw - s, hhDrawn = g.hh - s;
  const topDrawnX = g.topX - s; // the eave's own x under inset (== a - s, same x the eave corner below lands on)

  // Peak: the true miter offset (t7_roof_eave.peak_inner_corner, diamondTopHourglass's own `_solveDiamondTop
  // Hourglass`) -- both roof lines at +/-45deg, so by symmetry the inset peak lies exactly on the centreline,
  // s*sqrt(2) toward the interior (+y, this Y-DOWN convention).
  const peakIn = { x: 0, y: -g.hh + s * Math.SQRT2 };
  // Eave corner (right; mirror x for the left): a plain two-line miter (the roof line, direction peak->E, meeting
  // the VERTICAL eave bar) -- each line offset inward by `s` along its own normal, then intersected. The eave
  // line's x is constant along its own length, so the intersection reduces to one division (no general line-line
  // solve needed).
  const dxRoof = g.E.x - g.peak.x, dyRoof = g.E.y - g.peak.y, roofLen = Math.hypot(dxRoof, dyRoof);
  const ruxR = dxRoof / roofLen, ruyR = dyRoof / roofLen;
  let nxR = -ruyR, nyR = ruxR;
  const roofMid = { x: (g.peak.x + g.E.x) / 2, y: (g.peak.y + g.E.y) / 2 };
  if (nxR * (0 - roofMid.x) + nyR * (0 - roofMid.y) < 0) { nxR = -nxR; nyR = -nyR; }
  let nxE = -1, nyE = 0; // the eave bar is vertical; its inward normal points toward the centreline (x=0)
  if (nxE * (0 - g.E.x) < 0) { nxE = -nxE; nyE = -nyE; }
  const p0Roof = { x: g.peak.x + nxR * s, y: g.peak.y + nyR * s };
  const p0Eave = { x: g.E.x + nxE * s, y: g.E.y + nyE * s };
  const tRoof = (p0Eave.x - p0Roof.x) / ruxR;
  const eaveInR = { x: p0Roof.x + tRoof * ruxR, y: p0Roof.y + tRoof * ruyR };
  const eaveInL = { x: -eaveInR.x, y: eaveInR.y };

  const peakPt = P(peakIn.x, peakIn.y); // one shared point, both roof lines end there
  const eaveR = P(eaveInR.x, eaveInR.y), eaveL = P(eaveInL.x, eaveInL.y);
  // Right side, top -> bottom (shoulder/waist/hip exactly as `_solveHourglass`'s own right side).
  const rShoulderHorn = P(topDrawnX, g.shoulderY);
  const rShoulderWaistJct = P(g.shoulderCx + topDrawn * g.ux, g.shoulderY + topDrawn * g.uy);
  const rWaistHipJct = P(g.hipCx + bottomDrawn * g.uxBottom, g.hipY - bottomDrawn * g.uyBottom);
  const rHipHorn = P(hwDrawn, g.hipY);
  const rBase = P(hwDrawn, hhDrawn);
  const lBase = M(hwDrawn, hhDrawn);
  const lHipHorn = M(hwDrawn, g.hipY);
  const lWaistHipJct = M(g.hipCx + bottomDrawn * g.uxBottom, g.hipY - bottomDrawn * g.uyBottom);
  const lShoulderWaistJct = M(g.shoulderCx + topDrawn * g.ux, g.shoulderY + topDrawn * g.uy);
  const lShoulderHorn = M(topDrawnX, g.shoulderY);

  const keypoints = [peakPt, eaveR, rShoulderHorn, rShoulderWaistJct, rWaistHipJct, rHipHorn, rBase,
    lBase, lHipHorn, lWaistHipJct, lShoulderWaistJct, lShoulderHorn, eaveL];
  const fresh = [
    STRAIGHT_SEGMENT, // 0: peak -> eave_R (roof_R)
    STRAIGHT_SEGMENT, // 1: eave_R -> shoulder horn R (eave_straight_R)
    _curveSegment(rShoulderHorn, rShoulderWaistJct, topDrawn, true), // 2: shoulder, convex
    _curveSegment(rShoulderWaistJct, rWaistHipJct, radiusWaistDrawn, false, g.waistMajor), // 3: waist, concave
    _curveSegment(rWaistHipJct, rHipHorn, bottomDrawn, true), // 4: hip, convex
    STRAIGHT_SEGMENT, // 5: hip horn R -> base R (side_straight_R)
    STRAIGHT_SEGMENT, // 6: base R -> base L (bottom_edge)
    STRAIGHT_SEGMENT, // 7: base L -> hip horn L (side_straight_L)
    _curveSegment(lHipHorn, lWaistHipJct, bottomDrawn, true), // 8: hip, convex
    _curveSegment(lWaistHipJct, lShoulderWaistJct, radiusWaistDrawn, false, g.waistMajor), // 9: waist, concave
    _curveSegment(lShoulderWaistJct, lShoulderHorn, topDrawn, true), // 10: shoulder, convex
    STRAIGHT_SEGMENT, // 11: shoulder horn L -> eave_L (eave_straight_L)
    STRAIGHT_SEGMENT, // 12: eave_L -> peak (roof_L)
  ];
  const { segments, hasUserSegments } = _mergeSegments(fresh, segmentsOverride);
  // Template 6's own convention: a declared mirror table, not the generic default. bottom_edge (6) straddles the
  // centreline and self-maps; every other piece i pairs with 12-i (which also gives 6 -> 6).
  const mirror = fresh.map((_, i) => 12 - i);

  const resolvedParams = { ...resolvedAll };
  for (const k of FRAME_ONLY_PARAM_KEYS) if (!params || params[k] == null) delete resolvedParams[k];

  return { keypoints, segments, cx: cx0, params: resolvedParams, hasUserSegments, mirror };
}

/**
 * T8 DIPPED TOP + LEFT-ONLY WAVE solver: 12 pieces. The right side and base are a plain straight edge (Template
 * 1's classic square corners, no pinch at all); the left side reuses `hourglassConstruction`'s own `left`
 * sub-construction (this preset's `waveHeight`/`waveReach` standing in for `waistCenterYLeft`/`waistReachLeft`,
 * the SAME per-side arc algebra Template 1's own leg uses); the top reuses its `topDip` (Template 5's dip,
 * this preset's own `topDipPosition` shifting it off the centre line). `strokeHalfWidth` insets the drawn
 * outline exactly as `_solveHourglass` does (every wall in, a convex radius shrinks, a concave one grows, an
 * arc centre never moves) -- not a new algebra, the same one applied to one side's arcs plus the dip.
 *
 * Piece order, clockwise from the top-right corner (matches FRAME_SEED_MAP's own `prim` indices in
 * template_data.py):
 *   0 side_R (the WHOLE right side, one straight line, corner to corner), 1 bottom edge, 2 left horn (at the BL
 *   corner), 3 hip arc, 4 waist/wave arc (the pinch), 5 shoulder arc, 6 left horn (at the TL corner), 7 left top
 *   stub, 8 left top shoulder arc, 9 the dip, 10 right top shoulder arc, 11 right top stub.
 */
function _solveDippedLeftWave(region, params, segmentsOverride, seed, strokeHalfWidth = 0) {
  const resolvedAll = _resolveParams('dippedLeftWave', region, params, seed, strokeHalfWidth);
  const cx0 = region.x + region.w / 2, cy0 = region.y + region.h / 2;
  const hw = region.w / 2, hh = region.h / 2;

  // Reuse hourglassConstruction's own `left` (Template 1's per-side arc construction, region-local/right-side/
  // Y-down until mirrored below) and `topDip` (Template 5's dip, extended for `topDipPosition`) by feeding it
  // this preset's own params under the hourglass preset's own key names. The base/"right" waistReach/waistCenterY
  // below are never actually read (the `??` in hourglassConstruction's own `left` branch always prefers
  // waistReachLeft/waistCenterYLeft, both always set here), so they carry the SAME wave values rather than an
  // unrelated placeholder -- inert, but not a magic number either.
  const g = hourglassConstruction(region, {
    waistReach: resolvedAll.waveReach, waistCenterY: resolvedAll.waveHeight,
    cornerRadius: resolvedAll.waveCornerRadius, waistRadius: resolvedAll.waveRadius,
    waistCenterYLeft: resolvedAll.waveHeight, waistReachLeft: resolvedAll.waveReach,
    topDipWidth: resolvedAll.topDipWidth, topDipDepth: resolvedAll.topDipDepth, topDipPosition: resolvedAll.topDipPosition,
  });
  const L = g.left, { halfWidth: a, depth: dd, radius: r, position: pos } = g.topDip;

  // The ACTUAL drawn radii/walls -- everything from here down uses these.
  const cornerDrawn = resolvedAll.waveCornerRadius * hw - strokeHalfWidth; // convex: shrinks
  const waveRadiusDrawn = resolvedAll.waveRadius * hw + strokeHalfWidth; // concave: grows
  const hwDrawn = hw - strokeHalfWidth, hhDrawn = hh - strokeHalfWidth;

  const P = (x, y) => ({ x: cx0 + x, y: cy0 + y }); // local (right-positive, Y-down) -> world
  const M = (x, y) => ({ x: cx0 - x, y: cy0 + y }); // mirrored (left side)

  // Right side + base: plain corner-to-corner, no arcs.
  const rTop = P(hwDrawn, -hhDrawn);
  const rBottom = P(hwDrawn, hhDrawn);
  // Left side (the wave), bottom -> top, exactly `_solveHourglass`'s own left-side construction.
  const lBottom = M(hwDrawn, hhDrawn);
  const lHipHorn = M(hwDrawn, L.hipY);
  const lWaistHipJct = M(L.hipCx + cornerDrawn * L.uxBottom, L.hipY - cornerDrawn * L.uyBottom);
  const lShoulderWaistJct = M(L.shoulderCx + cornerDrawn * L.ux, L.shoulderY + cornerDrawn * L.uy);
  const lShoulderHorn = M(hwDrawn, L.shoulderY);
  const lTop = M(hwDrawn, -hhDrawn);

  // Top dip, exactly `_solveHourglass`'s own topDip construction (position-shifted).
  const rsDrawn = r - strokeHalfWidth, rdDrawn = r + strokeHalfWidth;
  const ux2 = -a / (2 * r), uy2 = (dd - 2 * r) / (2 * r);
  const rDipStart = P(a + pos, -hhDrawn), lDipStart = M(a - pos, -hhDrawn);
  const rDipJct = P(a + pos + rsDrawn * ux2, -hh + r + rsDrawn * uy2);
  const lDipJct = M(a - pos + rsDrawn * ux2, -hh + r + rsDrawn * uy2);

  const keypoints = [rTop, rBottom, lBottom, lHipHorn, lWaistHipJct, lShoulderWaistJct, lShoulderHorn, lTop,
    lDipStart, lDipJct, rDipJct, rDipStart];

  const fresh = [
    STRAIGHT_SEGMENT, // 0: rTop -> rBottom (the whole right side)
    STRAIGHT_SEGMENT, // 1: rBottom -> lBottom (bottom edge)
    STRAIGHT_SEGMENT, // 2: lBottom -> lHipHorn (horn)
    _curveSegment(lHipHorn, lWaistHipJct, cornerDrawn, true), // 3: hip, convex
    _curveSegment(lWaistHipJct, lShoulderWaistJct, waveRadiusDrawn, false, L.waistMajor), // 4: the wave, concave
    _curveSegment(lShoulderWaistJct, lShoulderHorn, cornerDrawn, true), // 5: shoulder, convex
    STRAIGHT_SEGMENT, // 6: lShoulderHorn -> lTop (horn)
    STRAIGHT_SEGMENT, // 7: lTop -> lDipStart (left stub)
    _curveSegment(lDipStart, lDipJct, rsDrawn, true, false, true), // 8: left top shoulder, convex
    _curveSegment(lDipJct, rDipJct, rdDrawn, false, false, true), // 9: the dip, concave
    _curveSegment(rDipJct, rDipStart, rsDrawn, true, false, true), // 10: right top shoulder, convex
    STRAIGHT_SEGMENT, // 11: rDipStart -> rTop (right stub)
  ];
  const { segments, hasUserSegments } = _mergeSegments(fresh, segmentsOverride);

  return { keypoints, segments, cx: cx0, params: { ...resolvedAll }, hasUserSegments };
}

/**
 * `region: {x,y,w,h}` (SE14 §3, Q5 ruling) + `shape` ->
 * `{ keypoints, segments, primitives, cx, params }`. `shape.preset`
 * selects `'hourglass'` (default) or `'bottle'`; `shape.params` overrides
 * that preset's own declared params (each falls back to its own default +
 * gentle seeded jitter — see `PRESETS`); `shape.segments`, if an array
 * of exactly the preset's own expected length, is REUSED verbatim (a
 * per-segment style override survives a param/seed change), else the
 * preset's own analytically-exact default segments are used. `keypoints`
 * is one FLAT closed loop (`keypoints[i] -> keypoints[(i+1)%n]` is
 * `segments[i]`), clockwise: top edge, right side top->bottom, bottom
 * edge, left side bottom->top — replacing T53/54's own asymmetric
 * `leftKpts`/`rightKpts` split (nothing else in the codebase consumed
 * that shape yet, so this is a clean break, not a compatibility risk).
 * `primitives` is `shapeToPrimitives`' own `{type:'L'|'A',...}` shape —
 * no fillets this slice (`cornerRadius` on a segment is read/passed
 * through but never applied — Slice 2's own job, unstarted, see
 * WORK-LOG). `params` (T59) is the FULLY RESOLVED param set this call
 * actually used — explicit `shape.params` values pass through unchanged,
 * an unpinned one reflects its own default+jitter draw — the only way a
 * caller (an on-canvas param handle, T59) learns a param's CURRENT value
 * when it was never explicitly pinned.
 */
export function generateSilhouette(region, shape, strokeHalfWidth = 0) {
  const preset = (shape && shape.preset) || 'hourglass';
  const seed = ((shape && shape.seed) || 42) >>> 0;
  const params = (shape && shape.params) || {};
  const segmentsOverride = shape && shape.segments;

  const solved =
    preset === 'bottle'
      ? _solveBottle(region, params, segmentsOverride, seed, strokeHalfWidth)
      : preset === 'tabTop' // T6 TAB TOP (a frame-only preset)
        ? _solveTabTop(region, params, segmentsOverride, seed, strokeHalfWidth)
        : preset === 'dippedLeftWave' // T8 DIPPED TOP + LEFT-ONLY WAVE (a frame-only preset)
          ? _solveDippedLeftWave(region, params, segmentsOverride, seed, strokeHalfWidth)
          : preset === 'iShape' // T9 I SHAPE (a frame-only preset)
            ? _solveIShape(region, params, segmentsOverride, seed, strokeHalfWidth)
            : preset === 'diamondTopHourglass' // T7 DIAMOND-TOP HOURGLASS (a frame-only preset)
              ? _solveDiamondTopHourglass(region, params, segmentsOverride, seed, strokeHalfWidth)
              : preset === 'diamondTopHourglassPinch' // T11 HOURGLASS ROOF (a frame-only preset)
                ? _solveDiamondTopHourglassPinch(region, params, segmentsOverride, seed, strokeHalfWidth)
                : _solveHourglass(region, params, segmentsOverride, seed, strokeHalfWidth);

  const { keypoints, segments, cx, params: resolvedParams, hasUserSegments, mirror } = solved;
  const n = keypoints.length;
  const primitives = [];
  for (let i = 0; i < n; i++) {
    primitives.push(..._segmentToPrimitives(keypoints[i], keypoints[(i + 1) % n], segments[i], cx));
  }

  // T5 HOURGLASS DIPPED TOP: a dipped outline says which segment mirrors which (topDipMirrorIndex); absent
  // (every other outline): the plain mirrorSegmentIndex rule holds.
  return { preset, keypoints, segments, primitives, cx, params: resolvedParams, hasUserSegments, ...(mirror ? { mirror } : {}) };
}

/**
 * T74 AMEND 2/3 (Fred, confirmed after back-and-forth): `contour_width`/
 * `contour_height` declare the OUTSIDE edge of the drawn stroke, not its
 * centerline. `generateSilhouette`'s own optional 3rd arg (`strokeHalfWidth`,
 * default 0 — every existing caller/test keeps working against the exact
 * SAME "touches region" geometry it always has) is a TRUE, ANALYTIC inward
 * offset applied INSIDE each solver (see `_solveHourglass`/`_solveBottle`'s
 * own doc comments for the verified per-quantity derivation: outer walls
 * shrink toward center by `strokeHalfWidth`, a CONVEX arc's radius shrinks
 * by the same amount, a CONCAVE arc's radius GROWS by it, every arc CENTER
 * stays exactly fixed) — never a generic path-offset/re-parse, so the
 * primitive list keeps its EXACT topology (same count, same order, same
 * types) no matter the inset amount, which `manifestFromShape`'s own
 * segment/mirror/tangent-constraint bookkeeping depends on. "The neck and
 * other features scale the same way from the outside" falls out for free:
 * every internal feature is defined relative to a wall or another arc's
 * radius, so shrinking/growing radii by the SAME constant amount threads
 * through consistently, with no per-feature special-casing needed here.
 *
 * Every real consumer of "the contour's own actual drawn geometry" — the
 * app's own `regenerateSilhouette`, the manifest's own `manifestFromShape`,
 * and the lattice-fill's own `resolveShapeBoundaryExtent` — calls THIS
 * wrapper, never bare `generateSilhouette`, so app / Fusion / fill-clip
 * geometry can never drift into three independently-computed insets.
 */
export function generateContourSilhouette(region, shape, strokeWidth) {
  return generateSilhouette(region, shape, (strokeWidth || 0) / 2);
}

/** T58 (SE14 Slice 3) — an `A` primitive's own END point, run FORWARD
 *  through the exact same endpoint<->center parametrization
 *  `arcCenterParam` (path-layout.js) documents and inverts — the
 *  standard SVG-spec point(theta) = center + R(phi)*(rx cos theta, ry sin
 *  theta) construction, at `theta1+dTheta`. `phi` is always 0 for every
 *  arc THIS module ever produces (`_arcPrimitive`'s own two return
 *  branches both pass literal `phi:0`/`arcCenterParam`'s own `phiDeg=0`
 *  arg) but the general rotated form costs nothing extra and keeps this
 *  a real inverse of `arcCenterParam`, not a special-cased one. */

/**
 * SIL-RESOLVE (F5) — the declared outline GUARD (F3 AMEND 7b's inversion
 * detector). Shared by the Shape Lattice preview and the future frame preview:
 * a silhouette is drawable only if this returns []. Checks, on the closed
 * primitive loop:
 *   - every arc has a positive radius and sweeps less than a full turn
 *     (a major arc is legitimate: F8, Fusion's own T1 waist at 12x6);
 *   - every joint that touches an ARC is tangent (a joint between two
 *     straight lines may be a sharp corner, which is how the bounding-box
 *     corners are built). `requireTangency: false` skips this when the user
 *     has styled segments on purpose (a kink is a deliberate corner);
 *   - the loop is SIMPLE: no two non-adjacent pieces cross.
 * Returns a list of `{ kind, index, detail }`; empty means clean.
 */
export function outlineDefects(primitives, { samplesPerArc = 10, tangentTol = 1e-4, requireTangency = true } = {}) {
  const defects = [];
  const n = primitives.length;
  const dirAt = (p, atEnd) => {
    if (p.type === 'L') {
      const dx = p.p1.x - p.p0.x, dy = p.p1.y - p.p0.y, len = Math.hypot(dx, dy) || 1;
      return { x: dx / len, y: dy / len };
    }
    const th = atEnd ? p.theta1 + p.dTheta : p.theta1;
    const s = p.dTheta > 0 ? 1 : -1; // travel direction along the arc (phi is always 0 here)
    return { x: -Math.sin(th) * s, y: Math.cos(th) * s };
  };
  primitives.forEach((p, i) => {
    if (p.type !== 'A') return;
    if (!(p.rx > 0) || !(p.ry > 0)) defects.push({ kind: 'nonPositiveRadius', index: i, detail: p.rx });
    // F8: a MAJOR arc (> 180 deg) is legitimate (Fusion's own T1 waist at 12x6
    // wraps 244 deg); only a full turn or more is a loop. Loops that cross
    // themselves are the selfIntersection check below (Fred's F5 fish).
    if (Math.abs(p.dTheta) >= 2 * Math.PI - 1e-6) defects.push({ kind: 'reversedArc', index: i, detail: p.dTheta });
  });
  primitives.forEach((p, i) => {
    if (p.type === 'L' && Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y) < 1e-9) {
      defects.push({ kind: 'degenerateLine', index: i, detail: 0 });
    }
  });
  for (let i = 0; i < n && requireTangency; i++) {
    const a = primitives[i], b = primitives[(i + 1) % n];
    if (a.type === 'L' && b.type === 'L') continue;
    const ta = dirAt(a, true), tb = dirAt(b, false);
    if (ta.x * tb.x + ta.y * tb.y < 1 - tangentTol) defects.push({ kind: 'notTangent', index: i, detail: ta.x * tb.x + ta.y * tb.y });
  }
  // Simple loop: polyline each piece, then test every non-adjacent pair.
  const polys = primitives.map((p) => {
    if (p.type === 'L') return [p.p0, p.p1];
    const pts = [];
    for (let k = 0; k <= samplesPerArc; k++) pts.push(_arcPointAt(p, p.theta1 + (p.dTheta * k) / samplesPerArc));
    return pts;
  });
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const hits = (p1, p2, q1, q2) => {
    const d1 = cross(q1, q2, p1), d2 = cross(q1, q2, p2), d3 = cross(p1, p2, q1), d4 = cross(p1, p2, q2);
    return ((d1 > 1e-12 && d2 < -1e-12) || (d1 < -1e-12 && d2 > 1e-12))
      && ((d3 > 1e-12 && d4 < -1e-12) || (d3 < -1e-12 && d4 > 1e-12));
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent across the wraparound
      const A = polys[i], B = polys[j];
      let crossed = false;
      for (let u = 0; u < A.length - 1 && !crossed; u++) {
        for (let v = 0; v < B.length - 1; v++) {
          if (hits(A[u], A[u + 1], B[v], B[v + 1])) { crossed = true; break; }
        }
      }
      if (crossed) defects.push({ kind: 'selfIntersection', index: i, detail: j });
    }
  }
  return defects;
}

const _fmt = (n) => (Math.round(n * 1000) / 1000).toString();
const _fmtDigits = (n, digits) => { const k = 10 ** digits; return (Math.round(n * k) / k).toString(); };

/**
 * SE14 §3's own primitive list -> one SVG path `d` string (`M`, then one
 * `L`/`A` per primitive, `Z`) — the exact shape a `<path d="...">` needs
 * for emission (§6), and the SAME primitive list `insideSpans`/
 * `primitivesBBox` (editor-lattice-boundary.js) already consume directly
 * — no round-trip through that module's own `_parseD` either way (this
 * module's own header comment already named that as worth doing, not yet
 * built; this is it).
 *
 * `largeArc`/`sweep` are read straight off `dTheta`'s own sign/magnitude
 * — the exact inverse of `arcCenterParam`'s own documented convention
 * (path-layout.js:108-109: sweep=0 <=> dTheta<=0, sweep=1 <=> dTheta>=0),
 * so re-parsing this `d` string through `arcCenterParam` reproduces the
 * SAME `{cx,cy,rx,ry,phi,theta1,dTheta}` this function started from —
 * verified directly (a round-trip test), not just argued.
 *
 * A degenerate (rx<=0 or ry<=0) arc primitive is skipped — same "declined
 * gracefully" convention `arcCenterParam` itself uses for a degenerate
 * INPUT (returns null, caller falls back to a straight line); a
 * genuinely zero-radius arc can only arise from a zero `cornerRadius`
 * pinned to 0 exactly (never produced by this module's own solvers,
 * which always derive a strictly positive radius from a strictly
 * positive `waistReach`/width-gap), so this is a defensive floor, not a
 * path this module's own presets ever actually take.
 */
export function primitivesToPathD(primitives) {
  if (!primitives || !primitives.length) return '';
  const parts = [];
  let started = false;
  for (const prim of primitives) {
    if (prim.type === 'L') {
      if (!started) { parts.push(`M ${_fmt(prim.p0.x)} ${_fmt(prim.p0.y)}`); started = true; }
      parts.push(`L ${_fmt(prim.p1.x)} ${_fmt(prim.p1.y)}`);
    } else if (prim.type === 'A') {
      if (prim.rx <= 0 || prim.ry <= 0) continue; // defensive: see doc comment above
      if (!started) {
        const p0 = _arcPointAt(prim, prim.theta1);
        parts.push(`M ${_fmt(p0.x)} ${_fmt(p0.y)}`);
        started = true;
      }
      const p1 = _arcPointAt(prim, prim.theta1 + prim.dTheta);
      const largeArc = Math.abs(prim.dTheta) > Math.PI ? 1 : 0;
      const sweep = prim.dTheta > 0 ? 1 : 0;
      const phiDeg = (prim.phi * 180) / Math.PI;
      parts.push(`A ${_fmt(prim.rx)} ${_fmt(prim.ry)} ${_fmt(phiDeg)} ${largeArc} ${sweep} ${_fmt(p1.x)} ${_fmt(p1.y)}`);
    }
  }
  if (started) parts.push('Z');
  return parts.join(' ');
}

/**
 * T73 (SE14b): ONE primitive's own SELF-CONTAINED, OPEN `d` string — its
 * own `M` start, then a single `L`/`A` command, NEVER a trailing `Z`.
 * `primitivesToPathD` above can't be reused for a single-primitive call:
 * it unconditionally appends `Z` once `started` is true, which for
 * an `'L'` re-traces the same 2-point line back onto itself (harmless but
 * redundant) and for an `'A'` draws a spurious straight chord across the
 * arc's own two endpoints — visibly wrong for what's supposed to be an
 * OPEN curve. Used to draw the contour as N independent per-segment
 * elements (one call per primitive) rather than one combined closed path
 * — each element's own `d` is exactly what a caller re-deriving the
 * combined boundary (editor-lattice-pattern.js's own multi-element
 * `_resolveBoundaryPrimitives`) can concatenate back into one closed loop,
 * by simply joining every element's own commands and appending ONE
 * trailing `Z` at the very end — never re-deriving the geometry a second
 * way.
 */
/* F27 item 3: `digits` (default 3, `_fmt`'s own grain, unchanged for every existing caller) -- the stripe tool
 * writes its arc stripes at STRIPE_D_DIGITS (editor-stripe-tool.js): at 3 decimals a short sub-arc's centre,
 * re-derived from its rounded endpoints by `arcCenterParam`, drifts (MEASURED on the hourglass's 90deg shoulder
 * arc, r 0.848: ~1.6e-3 at 3 stripes, ~6e-3 at 10, ~1.2e-2 at 20), so N stripes of one arc would no longer share
 * one centre in Fusion ("arc slots sharing a centre", the checklist) nor merge back for a re-stripe. */
export function primitiveToPathD(prim, digits = 3) {
  const f = digits === 3 ? _fmt : (n) => _fmtDigits(n, digits);
  if (prim.type === 'L') {
    return `M ${f(prim.p0.x)} ${f(prim.p0.y)} L ${f(prim.p1.x)} ${f(prim.p1.y)}`;
  }
  if (prim.type === 'A') {
    if (prim.rx <= 0 || prim.ry <= 0) return ''; // same defensive floor as primitivesToPathD
    const p0 = _arcPointAt(prim, prim.theta1);
    const p1 = _arcPointAt(prim, prim.theta1 + prim.dTheta);
    const largeArc = Math.abs(prim.dTheta) > Math.PI ? 1 : 0;
    const sweep = prim.dTheta > 0 ? 1 : 0;
    const phiDeg = (prim.phi * 180) / Math.PI;
    return `M ${f(p0.x)} ${f(p0.y)} A ${f(prim.rx)} ${f(prim.ry)} ${f(phiDeg)} ${largeArc} ${sweep} ${f(p1.x)} ${f(p1.y)}`;
  }
  return '';
}

/**
 * T73: the exact inverse of splitting a silhouette into N per-primitive
 * `primitiveToPathD` strings — joins them back into ONE closed-loop `d`,
 * in primitive order. Each input string is its own self-contained
 * `M ... L|A ...` (never a `Z`, per `primitiveToPathD`'s own contract) —
 * every one AFTER the first has its own leading `M x y` stripped (the
 * SAME coordinate the previous segment's own command already ended at,
 * by construction — the Coincident joint chain every adjacent pair of
 * silhouette primitives already shares), then one trailing `Z` closes the
 * whole loop. Lets `_resolveBoundaryPrimitives` (editor-lattice-
 * pattern.js) re-derive the SAME combined boundary
 * `insetPathDToPrimitives`/`insetGeneratedPresetPathDToPrimitives` already
 * know how to inset, from N live per-segment elements instead of one.
 */
export function joinSegmentPathsIntoClosedD(dStrings) {
  const nonEmpty = dStrings.filter(Boolean);
  if (!nonEmpty.length) return '';
  const parts = [nonEmpty[0]];
  for (let i = 1; i < nonEmpty.length; i++) {
    parts.push(nonEmpty[i].replace(/^M\s+-?[\d.]+\s+-?[\d.]+\s+/, ''));
  }
  parts.push('Z');
  return parts.join(' ');
}

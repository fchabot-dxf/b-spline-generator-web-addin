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
  hourglass: ['waistCenterY', 'waistReach', 'cornerRadius', 'waistRadius', 'cornerRadiusTop', 'cornerRadiusBottom', 'topInset',
    'waistCenterYLeft', 'waistReachLeft', 'topDipWidth', 'topDipDepth'],
  bottle: ['neckWidth', 'skeletonX', 'neckLength', 'bodyRadius'],
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
  },
  bottle: { bodyRadius: (v) => 1 - v.skeletonX },
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
export const FRAME_ONLY_PARAM_KEYS = Object.freeze(['topInset', 'waistCenterYLeft', 'waistReachLeft', 'topDipWidth', 'topDipDepth']);

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
const TOP_DIP_MIN_WIDTH = 0.15; // fraction of hw: a dip narrower than this is a notch, not a dip
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

function _bottleRange(key, region, stroke, v) {
  const hw = region.w / 2, hh = region.h / 2;
  if (key === 'bodyRadius') return _optionalRange('bottle', region, stroke, v);
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
  for (const [name, c] of Object.entries(model.features)) f[name] = c.hw * hw + c.hh * hh;
  if (preset === 'bottle') {
    return { neckWidth: f.neckHalfW / hw, skeletonX: (f.neckHalfW + f.neckR) / hw,
      neckLength: f.neckTop / (2 * hh), bodyRadius: f.bodyR / hw };
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
  const hw = region.w / 2;
  const convex = (MIN_ARC_RADIUS_IN + stroke) / hw, concave = Math.max(0, MIN_ARC_RADIUS_IN - stroke) / hw;
  if (preset === 'bottle') {
    if (key === 'bodyRadius') return convex;
    if (key === 'skeletonX') return v.neckWidth + concave;
    return -Infinity;
  }
  if (key === 'waistRadius') return concave;
  return ['cornerRadius', 'cornerRadiusTop', 'cornerRadiusBottom'].includes(key) ? convex : -Infinity;
}
function _withArcFloor(preset, key, region, stroke, v, r) {
  const f = _arcFloorFrac(preset, key, region, stroke, v);
  if (!(f > r.min)) return r;
  return f <= r.max ? { min: f, max: r.max } : { min: r.max, max: r.max };
}

/** `{ param: {min, max} }` for `preset` on `region`, each conditional on the
 *  params resolved before it (PARAM_ORDER). `params` supplies those earlier
 *  values (e.g. a solver's own `params` output). */
export function feasibleParamRanges(preset, region, params, strokeHalfWidth = 0) {
  const fn = preset === 'bottle' ? _bottleRange : _hourglassRange;
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
  const fn = preset === 'bottle' ? _bottleRange : _hourglassRange;
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
  const top = side(resolved.cornerRadiusTop ?? D.cornerRadiusTop(resolved), -1, topInset);
  const bot = side(resolved.cornerRadiusBottom ?? D.cornerRadiusBottom(resolved), +1, 0);
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
  const dipDepth = hh * (resolved.topDipDepth ?? D.topDipDepth(resolved));
  let topDip = null;
  if (dipDepth > 0) {
    const a = hw * (resolved.topDipWidth ?? D.topDipWidth(resolved)), r = (a * a + dipDepth * dipDepth) / (4 * dipDepth);
    // y down, the top edge at -hh: the shoulder centres (+/-a, -hh + r), the dip centre (0, -hh + D - r)
    topDip = { halfWidth: a, depth: dipDepth, radius: r, shoulderCy: -hh + r, dipCy: -hh + dipDepth - r };
  }
  return {
    ...(left ? { left } : {}),
    ...(topDip ? { topDip } : {}),
    hw, hh, depth, radiusWaist, waistCenterY, waistCx,
    topInset, topX: hw - topInset, // T3: the top horns' x (hw for Template 1)
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
  const neckHalfW = hw * resolved.neckWidth;
  const skelX = hw * resolved.skeletonX; // the neck arc's centre column
  const radiusNeck = skelX - neckHalfW; // concave (upper) arc
  const radiusBody = hw * (resolved.bodyRadius ?? DERIVED_PARAM_DEFAULTS.bottle.bodyRadius(resolved)); // convex (lower)
  const bodyCx = hw - radiusBody;
  const neckCenterY = -hh + hh * 2 * resolved.neckLength;
  const sumNB = radiusNeck + radiusBody;
  const hipCenterY = neckCenterY + Math.sqrt(Math.max(0, sumNB * sumNB - (bodyCx - skelX) ** 2)); // derived (tangency)
  return { hw, hh, neckHalfW, skelX, radiusNeck, radiusBody, bodyCx, neckCenterY, hipCenterY,
    bux: (bodyCx - skelX) / sumNB, buy: (hipCenterY - neckCenterY) / sumNB };
}

const SALT = {
  hourglass: { waistReach: 601, cornerRadius: 602, waistCenterY: 603 },
  bottle: { neckWidth: 611, skeletonX: 613, neckLength: 614 },
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
    ux, uy, uxBottom, uyBottom, waistMajor, topInset, left, topDip } = hourglassConstruction(region, resolvedAll);
  // T4 OFFSET HOURGLASS: the left side from its own construction (the right one's when no left pinch is set).
  const L = left || { shoulderCx, shoulderY, hipCx, hipY, ux, uy, uxBottom, uyBottom, waistMajor };

  // The ACTUAL drawn radii/walls (§ (2)/(1) above) -- everything from here
  // down uses these, never the raw params computed above directly.
  const topDrawn = cornerRadiusTop - strokeHalfWidth; // convex: shrinks
  const bottomDrawn = cornerRadiusBottom - strokeHalfWidth;
  const radiusWaistDrawn = radiusWaist + strokeHalfWidth; // concave: grows
  const hwDrawn = hw - strokeHalfWidth;
  const hhDrawn = hh - strokeHalfWidth;
  const topDrawnX = hwDrawn - topInset; // T3: the top horns' drawn x (hwDrawn exactly when topInset is 0)

  const P = (x, y) => ({ x: cx0 + x, y: cy0 + y }); // local (right-positive, Y-down) -> world
  const M = (x, y) => ({ x: cx0 - x, y: cy0 + y }); // mirrored (left side)

  // Right side, top -> bottom.
  const rTop = P(topDrawnX, -hhDrawn);
  const rShoulderHorn = P(topDrawnX, shoulderY);
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
  const lShoulderHorn = M(topDrawnX, L.shoulderY);
  const lTop = M(topDrawnX, -hhDrawn);

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
    const { halfWidth: a, depth: dd, radius: r } = topDip;
    const rsDrawn = r - strokeHalfWidth, rdDrawn = r + strokeHalfWidth;
    const ux2 = -a / (2 * r), uy2 = (dd - 2 * r) / (2 * r); // unit, shoulder centre -> dip centre (right side)
    const rDipStart = P(a, -hhDrawn), lDipStart = M(a, -hhDrawn);
    const rDipJct = P(a + rsDrawn * ux2, -hh + r + rsDrawn * uy2), lDipJct = M(a + rsDrawn * ux2, -hh + r + rsDrawn * uy2);
    keypoints.push(lDipStart, lDipJct, rDipJct, rDipStart);
    fresh.splice(11, 1,
      STRAIGHT_SEGMENT, // left stub: lTop -> lDipStart
      _curveSegment(lDipStart, lDipJct, rsDrawn, true, false, true), // left top shoulder, convex
      _curveSegment(lDipJct, rDipJct, rdDrawn, false, false, true), // the dip, concave
      _curveSegment(rDipJct, rDipStart, rsDrawn, true, false, true), // right top shoulder, convex
      STRAIGHT_SEGMENT); // right stub: rDipStart -> rTop
    mirror = fresh.map((_, i) => topDipMirrorIndex(i));
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
  const { hw, hh, neckHalfW, skelX, radiusNeck, radiusBody, neckCenterY, hipCenterY, bux, buy } =
    bottleConstruction(region, resolvedAll);

  // The ACTUAL drawn radii/walls -- everything from here down uses these.
  const radiusNeckDrawn = radiusNeck + strokeHalfWidth; // concave: grows
  const radiusBodyDrawn = radiusBody - strokeHalfWidth; // convex: shrinks
  const hwDrawn = hw - strokeHalfWidth;
  const hhDrawn = hh - strokeHalfWidth;
  const neckHalfWDrawn = neckHalfW - strokeHalfWidth;
  // Shared tangent point: on the centre line, the drawn neck radius out from the neck centre.
  const junctionX = skelX + bux * radiusNeckDrawn;
  const junctionY = neckCenterY + buy * radiusNeckDrawn;

  const P = (x, y) => ({ x: cx0 + x, y: cy0 + y });
  const M = (x, y) => ({ x: cx0 - x, y: cy0 + y });

  const rTop = P(neckHalfWDrawn, -hhDrawn);
  const rNeckHorn = P(neckHalfWDrawn, neckCenterY);
  const rJunction = P(junctionX, junctionY);
  const rHipHorn = P(hwDrawn, hipCenterY);
  const rBottom = P(hwDrawn, hhDrawn);
  const lBottom = M(hwDrawn, hhDrawn);
  const lHipHorn = M(hwDrawn, hipCenterY);
  const lJunction = M(junctionX, junctionY);
  const lNeckHorn = M(neckHalfWDrawn, neckCenterY);
  const lTop = M(neckHalfWDrawn, -hhDrawn);

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

  return { keypoints, segments, cx: cx0, params: resolvedParams, hasUserSegments };
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

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
      bodyWidth: 0.92, // 0-1: wide bottom half-width, fraction of halfW
      skeletonX: 0.72, // fraction of halfW, must sit strictly between neckWidth and bodyWidth (S-curve tightness)
      neckLength: 0.32, // 0-1: how far down the straight neck run extends before the S-curve, fraction of halfH
    },
    jitter: { neckWidth: 0.06, bodyWidth: 0.04, skeletonX: 0.05, neckLength: 0.06 },
  },
};

const SALT = {
  hourglass: { waistReach: 601, cornerRadius: 602, waistCenterY: 603 },
  bottle: { neckWidth: 611, bodyWidth: 612, skeletonX: 613, neckLength: 614 },
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
function _bulgeFromRadius(R, halfChord) {
  const disc = Math.max(0, R * R - halfChord * halfChord); // clamp: float noise can push this just under 0 at R===h
  return (R - Math.sqrt(disc)) / halfChord;
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
function _arcPrimitive(a, b, signedBulge, cx) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const od = mx >= cx ? 1 : -1;
  const perpLeftX = -dy / len;
  const perpLeftIsOutward = perpLeftX * od > 0;
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

  const bClamped = Math.max(-0.999, Math.min(0.999, signedBulge));
  const R = Math.abs(((len / 2) * (1 + bClamped * bClamped)) / (2 * bClamped));
  const param = arcCenterParam(a.x, a.y, R, R, 0, 0, sweep, b.x, b.y);
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
  return [_arcPrimitive(a, b, signedBulge, cx)];
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
function _curveSegment(a, b, radius, outward) {
  const halfChord = Math.hypot(b.x - a.x, b.y - a.y) / 2;
  const bulge = _bulgeFromRadius(radius, halfChord);
  return { style: 'curve', bulge, dir: outward ? 'out' : 'in', cornerRadius: 0 };
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
function _solveHourglass(region, params, segmentsOverride, seed) {
  const p = PRESETS.hourglass.params;
  const j = PRESETS.hourglass.jitter;
  const s = SALT.hourglass;
  const waistReach = _jitteredParam(params.waistReach, p.waistReach, j.waistReach, seed, s.waistReach, 0.05, 0.92);
  const cornerRadiusFrac = _jitteredParam(
    params.cornerRadius, p.cornerRadius, j.cornerRadius, seed, s.cornerRadius, 0.04, 0.95 - waistReach
  );
  const waistCenterYFrac = _jitteredParam(
    params.waistCenterY, p.waistCenterY, j.waistCenterY, seed, s.waistCenterY, -0.6, 0.6
  );

  const hw = region.w / 2, hh = region.h / 2, cx0 = region.x + hw, cy0 = region.y + hh;
  const waistX = hw * (1 - waistReach); // boundary reach at the pinch (local, right side, from centerline)
  const cornerRadius = hw * cornerRadiusFrac; // shoulder/hip radius (real units)
  const skelX = hw - cornerRadius; // shared arc-center column X (local, right side positive)
  const waistCenterY = hh * waistCenterYFrac; // local, Y-DOWN (0 = region's own vertical center)
  const radiusWaist = skelX - waistX;
  const notchHalfSpan = cornerRadius + radiusWaist; // = halfW - waistX, shoulder/hip offset from waistCenterY
  const shoulderY = waistCenterY - notchHalfSpan; // ABOVE (smaller Y) the waist
  const hipY = waistCenterY + notchHalfSpan; // BELOW (larger Y) the waist

  const P = (x, y) => ({ x: cx0 + x, y: cy0 + y }); // local (right-positive, Y-down) -> world
  const M = (x, y) => ({ x: cx0 - x, y: cy0 + y }); // mirrored (left side)

  // Right side, top -> bottom.
  const rTop = P(hw, -hh);
  const rShoulderHorn = P(hw, shoulderY);
  const rShoulderWaistJct = P(skelX, waistCenterY - radiusWaist);
  const rWaistHipJct = P(skelX, waistCenterY + radiusWaist);
  const rHipHorn = P(hw, hipY);
  const rBottom = P(hw, hh);
  // Left side (exact mirror), bottom -> top.
  const lBottom = M(hw, hh);
  const lHipHorn = M(hw, hipY);
  const lWaistHipJct = M(skelX, waistCenterY + radiusWaist);
  const lShoulderWaistJct = M(skelX, waistCenterY - radiusWaist);
  const lShoulderHorn = M(hw, shoulderY);
  const lTop = M(hw, -hh);

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
    _curveSegment(rShoulderHorn, rShoulderWaistJct, cornerRadius, true), // shoulder, convex
    _curveSegment(rShoulderWaistJct, rWaistHipJct, radiusWaist, false), // waist, concave
    _curveSegment(rWaistHipJct, rHipHorn, cornerRadius, true), // hip, convex
    STRAIGHT_SEGMENT, // rHipHorn -> rBottom (horn)
    STRAIGHT_SEGMENT, // bottom edge: rBottom -> lBottom
    STRAIGHT_SEGMENT, // lBottom -> lHipHorn (horn)
    _curveSegment(lHipHorn, lWaistHipJct, cornerRadius, true), // hip, convex
    _curveSegment(lWaistHipJct, lShoulderWaistJct, radiusWaist, false), // waist, concave
    _curveSegment(lShoulderWaistJct, lShoulderHorn, cornerRadius, true), // shoulder, convex
    STRAIGHT_SEGMENT, // lShoulderHorn -> lTop (horn)
    STRAIGHT_SEGMENT, // top edge: lTop -> rTop
  ];
  const segments = Array.isArray(segmentsOverride) && segmentsOverride.length === keypoints.length
    ? segmentsOverride.map(_normalizeSegment)
    : fresh;

  // T59 (SE14 Slice 3's own deferred "axis-locked parametric handles"):
  // the RESOLVED params (explicit value, or default+jitter, already
  // clamped) — a param handle on canvas needs these to seed its own
  // drag-start value and compute its anchor point; PATTERN.shape.params
  // alone only has whatever the user has EXPLICITLY pinned, not a
  // seed-jittered one still sitting at its default. Same fraction units
  // `PATTERN.shape.params` itself stores (0-1, not the `hw`-scaled real-
  // unit values computed just above).
  const resolvedParams = { waistReach, cornerRadius: cornerRadiusFrac, waistCenterY: waistCenterYFrac };

  return { keypoints, segments, cx: cxWorld, params: resolvedParams };
}

function _normalizeSegment(seg) {
  return {
    style: (seg && seg.style) || 'straight',
    bulge: (seg && seg.bulge) || 0,
    dir: (seg && seg.dir) || 'out',
    cornerRadius: (seg && seg.cornerRadius) || 0,
  };
}

/**
 * BOTTLE (frame-builder Template 2). Per side (right, then mirrored):
 * top-corner(narrow) -[horn]- neckHornEnd -[neck/waist arc, CONCAVE]-
 * junction -[hip arc, CONVEX]- hipHornEnd -[horn]- bottom-corner(wide).
 * 10 segments total (2 straight edges + 2x(2 horns + 2 arcs)).
 *
 * Same closed-form shape as the hourglass (shared skeleton column X,
 * `skelX`, cancels out of the arc-arc tangency): with `neckHalfW` (narrow
 * top) and `bodyHalfW` (wide bottom),
 *   hipCenterY - neckCenterY = radius_neck + radius_body
 *                             = (skelX-neckHalfW) + (bodyHalfW-skelX)
 *                             = bodyHalfW - neckHalfW
 * `neckCenterY` is the one independent Y anchor (derived from the
 * declared `neckLength`); `hipCenterY` (and hence the body horn's own
 * length) is DERIVED, not independently settable — same disclosed
 * "tangency removes a degree of freedom" finding as the hourglass.
 */
function _solveBottle(region, params, segmentsOverride, seed) {
  const p = PRESETS.bottle.params;
  const j = PRESETS.bottle.jitter;
  const s = SALT.bottle;
  const neckWidth = _jitteredParam(params.neckWidth, p.neckWidth, j.neckWidth, seed, s.neckWidth, 0.05, 0.85);
  const bodyWidth = _jitteredParam(
    params.bodyWidth, p.bodyWidth, j.bodyWidth, seed, s.bodyWidth, Math.min(0.98, neckWidth + 0.08), 0.98
  );
  const skeletonXFrac = _jitteredParam(
    params.skeletonX, p.skeletonX, j.skeletonX, seed, s.skeletonX,
    neckWidth + (bodyWidth - neckWidth) * 0.15, neckWidth + (bodyWidth - neckWidth) * 0.85
  );
  const neckLengthFrac = _jitteredParam(
    params.neckLength, p.neckLength, j.neckLength, seed, s.neckLength, 0.08, 0.85
  );

  const hw = region.w / 2, hh = region.h / 2, cx0 = region.x + hw, cy0 = region.y + hh;
  const neckHalfW = hw * neckWidth;
  const bodyHalfW = hw * bodyWidth;
  const skelX = hw * skeletonXFrac;
  const radiusNeck = skelX - neckHalfW; // concave (upper) arc
  const radiusBody = bodyHalfW - skelX; // convex (lower) arc
  const neckCenterY = -hh + hh * 2 * neckLengthFrac; // local Y-down; top edge at -hh
  const hipCenterY = neckCenterY + radiusNeck + radiusBody; // derived (tangency)
  const junctionY = neckCenterY + radiusNeck; // shared tangent point, on x=skelX

  const P = (x, y) => ({ x: cx0 + x, y: cy0 + y });
  const M = (x, y) => ({ x: cx0 - x, y: cy0 + y });

  const rTop = P(neckHalfW, -hh);
  const rNeckHorn = P(neckHalfW, neckCenterY);
  const rJunction = P(skelX, junctionY);
  const rHipHorn = P(bodyHalfW, hipCenterY);
  const rBottom = P(bodyHalfW, hh);
  const lBottom = M(bodyHalfW, hh);
  const lHipHorn = M(bodyHalfW, hipCenterY);
  const lJunction = M(skelX, junctionY);
  const lNeckHorn = M(neckHalfW, neckCenterY);
  const lTop = M(neckHalfW, -hh);

  const keypoints = [rTop, rNeckHorn, rJunction, rHipHorn, rBottom, lBottom, lHipHorn, lJunction, lNeckHorn, lTop];

  // Same wraparound convention as the hourglass solver above: `keypoints[0]
  // ===rTop`, so this array starts at the first real edge out of rTop and
  // the top edge (lTop -> rTop) is the LAST entry.
  const fresh = [
    STRAIGHT_SEGMENT, // rTop -> rNeckHorn (horn)
    _curveSegment(rNeckHorn, rJunction, radiusNeck, false), // neck/waist, concave
    _curveSegment(rJunction, rHipHorn, radiusBody, true), // hip/body, convex
    STRAIGHT_SEGMENT, // rHipHorn -> rBottom (horn)
    STRAIGHT_SEGMENT, // bottom edge
    STRAIGHT_SEGMENT, // lBottom -> lHipHorn (horn)
    _curveSegment(lHipHorn, lJunction, radiusBody, true), // hip/body, convex
    _curveSegment(lJunction, lNeckHorn, radiusNeck, false), // neck/waist, concave
    STRAIGHT_SEGMENT, // lNeckHorn -> lTop (horn)
    STRAIGHT_SEGMENT, // top edge: lTop -> rTop
  ];
  const segments = Array.isArray(segmentsOverride) && segmentsOverride.length === keypoints.length
    ? segmentsOverride.map(_normalizeSegment)
    : fresh;

  // T59: see _solveHourglass's own doc comment on why this is returned.
  const resolvedParams = { neckWidth, bodyWidth, skeletonX: skeletonXFrac, neckLength: neckLengthFrac };

  return { keypoints, segments, cx: cx0, params: resolvedParams };
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
export function generateSilhouette(region, shape) {
  const preset = (shape && shape.preset) || 'hourglass';
  const seed = ((shape && shape.seed) || 42) >>> 0;
  const params = (shape && shape.params) || {};
  const segmentsOverride = shape && shape.segments;

  const solved =
    preset === 'bottle'
      ? _solveBottle(region, params, segmentsOverride, seed)
      : _solveHourglass(region, params, segmentsOverride, seed);

  const { keypoints, segments, cx, params: resolvedParams } = solved;
  const n = keypoints.length;
  const primitives = [];
  for (let i = 0; i < n; i++) {
    primitives.push(..._segmentToPrimitives(keypoints[i], keypoints[(i + 1) % n], segments[i], cx));
  }

  return { preset, keypoints, segments, primitives, cx, params: resolvedParams };
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
function _arcPointAt(prim, theta) {
  const cosPhi = Math.cos(prim.phi), sinPhi = Math.sin(prim.phi);
  const ex = prim.rx * Math.cos(theta), ey = prim.ry * Math.sin(theta);
  return { x: prim.cx + ex * cosPhi - ey * sinPhi, y: prim.cy + ex * sinPhi + ey * cosPhi };
}

const _fmt = (n) => (Math.round(n * 1000) / 1000).toString();

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

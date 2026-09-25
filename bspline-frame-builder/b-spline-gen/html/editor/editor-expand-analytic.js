/**
 * editor-expand-analytic.js — SE12 Slice 1: the analytic (non-sampling,
 * non-polygon-clipping) live-expand engine. See SE12-LIVE-EXPAND-DESIGN.md.
 *
 * A round-capped stroke's TRUE offset outline has a closed form — 2
 * straight banks + 2 semicircular `A` arcs — unlike editor-expand-shape.js's
 * expandGeometric, which samples the path at 0.02" steps via
 * getPointAtLength() and hands the resulting point-cloud to a
 * polygon-clipping union. That sampling approach is exactly what Fred's
 * hard requirement rules out for live-expand ("straight lines need to be
 * just straight lines and arcs need to be true arcs" — no traced/
 * polygonized geometry). This module produces exact `A` commands instead,
 * with zero sampling and zero network dependency.
 *
 * Works entirely in the element's LOCAL frame (the coordinates a `<line>`'s
 * own x1/y1/x2/y2 attributes carry). World transforms — dragging, rotating,
 * or baking into carve/export coordinates — are Slice 0's job
 * (isSimilarity/bakeArcSimilar, path-layout.js), not this module's: an
 * outline computed here composes with a later similarity bake exactly like
 * any other `A`-bearing path would.
 *
 * SE12 T38 AMEND (Fred: "ellipse and curved path too please"): an
 * ellipse's true offset has NO closed form (unlike a circle's) — its
 * outline is FIT with biarcs instead (fitOffsetWithBiarcs,
 * editor-expand-biarc.js), to within a declared tolerance. One-way
 * dependency only (this file imports the fitter; the fitter never
 * imports shape-specific code back), so there's no cycle risk.
 */
import { fitOffsetWithBiarcs } from './editor-expand-biarc.js';

/**
 * Which stroke-linecap values this engine can express analytically today.
 * Declared as data, not inferred per call site, so a NEW cap kind is one
 * line to add here (when its own closed form is built) rather than a
 * silent fallthrough somewhere else. `round` is the lattice's own case —
 * every rail/tie is drawn with linecap:'round' (editor-lattice.js). T44:
 * `butt`/`square` are ALSO exact closed forms (4 straight segments, no
 * arcs at all — a plain rectangle, extended by half the stroke width at
 * both ends for `square`) — built this turn, in both `lineOutlinePathD`
 * (below) and `pathOutlinePathD`'s own open-subpath caps
 * (editor-expand-path.js's `_buildCap`), so a table flip here covers
 * both engines identically rather than needing two separate declarations.
 */
export const SUPPORTED_LINE_CAPS = Object.freeze({
  round: true,
  butt: true,
  square: true,
});

/**
 * The analytic offset outline of a line segment (x1,y1)-(x2,y2) with total
 * stroke width `strokeWidth` and cap style `cap`, as a filled path `d`
 * string tracing a single closed loop (2 straight banks + 2 true
 * semicircular `A` arcs for a round cap — Fred: "a line's outline = 2
 * straight segments + 2 true semicircle arcs").
 *
 * A zero-length line degenerates to a full circle of radius strokeWidth/2
 * centered at the point (its own round cap swallows the whole "line") —
 * expressed as two `A` semicircles rather than one 360° arc, since SVG's
 * arc command can't represent a full circle in a single `A` (coincident
 * start/end is degenerate for the endpoint-to-center parametrization); two
 * half-circles is the standard workaround, same shape arcToCubics'
 * existing "full circle via two 180deg arcs" test already exercises.
 *
 * Returns `{ d, unsupported }`: `d` is the path string and `unsupported`
 * is `null` on success; `d` is `null` and `unsupported` names the
 * requested cap when it isn't (yet) supported — never throws, so a caller
 * can decide what "decline" means for it (e.g. fall back to the existing
 * destructive Expand flow for that element).
 */
export function lineOutlinePathD({ x1, y1, x2, y2, strokeWidth, cap = 'round' }) {
  if (!SUPPORTED_LINE_CAPS[cap]) {
    return { d: null, unsupported: cap };
  }

  const r = strokeWidth / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);

  if (len < 1e-9) {
    // T44: butt/square both need a line DIRECTION to build a rectangle
    // from (butt has no extension at all, but the stroke width still
    // applies PERPENDICULAR to a direction that a zero-length line simply
    // doesn't have) — round alone has a direction-independent degenerate
    // shape (a full circle), so it's the only cap with a sensible
    // zero-length result; declined honestly for the other two rather than
    // guessing an arbitrary direction.
    if (cap !== 'round') return { d: null, unsupported: 'zero-length' };
    const d = `M ${x1 - r} ${y1} A ${r} ${r} 0 1 0 ${x1 + r} ${y1} A ${r} ${r} 0 1 0 ${x1 - r} ${y1} Z`;
    // T45 ADD-ON (Fred, via Fusion measurement): this shape IS a true full
    // circle (two coincident-center semicircle A's — SVG's own workaround
    // for "A can't express a full circle in one command"), unlike the
    // capsule's own two round caps below (genuinely separate half-circles,
    // different centers). Declared here, not inferred later from the `d`
    // string, so the Fusion export can emit a native `<circle>` (Fusion's
    // importSVG turns that into a true SketchCircle at exact radius; two
    // A's import as two separate SketchArcs instead — measured, not
    // assumed, per the advisor's own Fusion sketch: 82 SketchArcs, 0
    // SketchCircles before this fix).
    return { d, unsupported: null, circles: [{ cx: x1, cy: y1, r }] };
  }

  // Unit direction p1->p2, and its +90 deg normal (offset direction for
  // one "bank" of the capsule — the other bank is the same offset negated).
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;

  // T44: 'square' extends BOTH endpoints outward along the line direction
  // by r before offsetting perpendicular — same construction as 'butt'
  // but on an extended segment, matching the SVG spec's own "square cap
  // = butt cap on a segment lengthened by half the stroke width at each
  // end" definition exactly. 'butt' itself reuses (ex1,ex2) = (p1,p2)
  // unchanged (extension 0), so both share one code path below rather
  // than two near-duplicate rectangle constructions.
  const ext = cap === 'square' ? r : 0;
  const ex1 = { x: x1 - ux * ext, y: y1 - uy * ext };
  const ex2 = { x: x2 + ux * ext, y: y2 + uy * ext };

  if (cap === 'butt' || cap === 'square') {
    const L1 = { x: ex1.x + nx * r, y: ex1.y + ny * r };
    const L2 = { x: ex2.x + nx * r, y: ex2.y + ny * r };
    const R1 = { x: ex1.x - nx * r, y: ex1.y - ny * r };
    const R2 = { x: ex2.x - nx * r, y: ex2.y - ny * r };
    const d = `M ${L1.x} ${L1.y} L ${L2.x} ${L2.y} L ${R2.x} ${R2.y} L ${R1.x} ${R1.y} Z`;
    return { d, unsupported: null };
  }

  const L1 = { x: x1 + nx * r, y: y1 + ny * r };
  const L2 = { x: x2 + nx * r, y: y2 + ny * r };
  const R1 = { x: x1 - nx * r, y: y1 - ny * r };
  const R2 = { x: x2 - nx * r, y: y2 - ny * r };

  // sweep=0 for BOTH cap arcs (verified against arcToCubics' own sampled
  // midpoint, not asserted algebraically — see the "sweep, verified not
  // guessed" test below, and WORK-LOG for the two other arc-sweep formulas
  // this same session already got wrong by trusting derivation alone):
  // sweep=0 makes the p2-side arc (L2->R2) bulge past x2, away from p1,
  // and the p1-side arc (R1->L1) bulge past x1, away from p2 — the two
  // caps a real round-capped stroke actually has.
  const d = `M ${L1.x} ${L1.y} L ${L2.x} ${L2.y} A ${r} ${r} 0 0 0 ${R2.x} ${R2.y} L ${R1.x} ${R1.y} A ${r} ${r} 0 0 0 ${L1.x} ${L1.y} Z`;
  return { d, unsupported: null };
}

/** A closed loop tracing a circle of radius `radius` centered at (cx,cy),
 *  as two `A` semicircles — same construction lineOutlinePathD's own
 *  zero-length-line case already uses (SVG's `A` can't express a full
 *  circle in one command; two half-circles is the standard workaround),
 *  factored out here since both a stroked circle's rings AND the
 *  degenerate-line case need exactly this shape. */
function _circleLoopD(cx, cy, radius) {
  return `M ${cx - radius} ${cy} A ${radius} ${radius} 0 1 0 ${cx + radius} ${cy} A ${radius} ${radius} 0 1 0 ${cx - radius} ${cy} Z`;
}

/**
 * The analytic outline of a circle (center cx,cy, radius r), gated by
 * `mode` — the same three-way split every shape kind in this module
 * follows (Fred's dispatch, item "Filled shapes"):
 *   'stroke' (default): the shape is unfilled — two concentric circles
 *     at r ± strokeWidth/2 ("circle → two concentric circles"), ONE path
 *     with two subpaths so a later evenodd fill renders the annulus as a
 *     ring, not a solid disk. If the stroke is wide enough to swallow
 *     the whole circle (strokeWidth/2 >= r), only the outer ring is
 *     returned (one subpath) — the hole would have zero/negative radius.
 *   'fill': the shape is filled, no stroke — the outline IS the circle's
 *     own exact edge, radius r, no offset at all.
 *   'both': filled AND stroked — the combined visual boundary is the
 *     edge offset OUTWARD by strokeWidth/2 only (no inner ring: the
 *     shape is already solid, there's no hole to trace).
 * `r ± strokeWidth/2` is exact by construction in every mode — no
 * offsetting algorithm needed, unlike a general shape.
 */
export function circleOutlinePathD({ cx, cy, r, strokeWidth, mode = 'stroke' }) {
  const half = strokeWidth / 2;
  // T45 ADD-ON: every ring this function ever produces IS a true full
  // circle (via _circleLoopD's own two-coincident-semicircle-A
  // construction) — never a partial arc — so `circles` always covers the
  // WHOLE of `d` here, never a mix. Declared per ring so the Fusion export
  // can emit each as a native `<circle>` (see lineOutlinePathD's own
  // zero-length case for the fuller "why" — same fix, same reasoning).
  if (mode === 'fill') return { d: _circleLoopD(cx, cy, r), unsupported: null, circles: [{ cx, cy, r }] };
  if (mode === 'both') return { d: _circleLoopD(cx, cy, r + half), unsupported: null, circles: [{ cx, cy, r: r + half }] };

  const innerR = r - half;
  // T51 (SE13 boundary-fill fix): the INNER ring alone, exact (a circle
  // offset inward is just a smaller concentric circle, no fitting needed)
  // — the boundary-cutting engine's own "true inward-offset boundary"
  // need (editor-lattice-boundary.js), reusing this SAME exact-offset
  // math rather than approximating a per-crossing shrink (T50's own dead
  // end, deleted). `null` when the stroke swallows the whole circle, same
  // "declined gracefully" convention as everywhere else in this codebase.
  if (mode === 'inner') {
    return innerR > 1e-9
      ? { d: _circleLoopD(cx, cy, innerR), unsupported: null, circles: [{ cx, cy, r: innerR }] }
      : { d: null, unsupported: 'collapsed' };
  }

  const outerR = r + half;
  const outer = _circleLoopD(cx, cy, outerR);
  if (innerR <= 1e-9) return { d: outer, unsupported: null, circles: [{ cx, cy, r: outerR }] };
  const inner = _circleLoopD(cx, cy, innerR);
  return { d: `${outer} ${inner}`, unsupported: null, circles: [{ cx, cy, r: outerR }, { cx, cy, r: innerR }] };
}

/** A sharp-cornered rect boundary, 4 straight lines — the shape a rect's
 *  own edge already is (mode:'fill'), and what its offset-INWARD ring
 *  looks like too (offsetting a corner inward never needs rounding —
 *  only outward offsetting opens a gap at a convex corner that a round
 *  join has to fill). */
function _rectLoopD(x, y, w, h) {
  return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
}

/** The Minkowski-sum outward offset of a rect's own edge by `half`: a
 *  standard rounded-rect path (4 straight edges + 4 quarter `A` arcs of
 *  radius `half`, each centered on one of the rect's own original sharp
 *  corners — verified numerically against arcToCubics, not assumed, see
 *  WORK-LOG) — exactly what offsetting a sharp corner OUTWARD by a round
 *  amount produces (Fred: "round joins"). */
function _rectRoundedOuterD(x, y, w, h, half) {
  const oX = x - half, oY = y - half, oW = w + 2 * half, oH = h + 2 * half;
  return `M ${oX + half} ${oY} `
    + `L ${oX + oW - half} ${oY} `
    + `A ${half} ${half} 0 0 1 ${oX + oW} ${oY + half} `
    + `L ${oX + oW} ${oY + oH - half} `
    + `A ${half} ${half} 0 0 1 ${oX + oW - half} ${oY + oH} `
    + `L ${oX + half} ${oY + oH} `
    + `A ${half} ${half} 0 0 1 ${oX} ${oY + oH - half} `
    + `L ${oX} ${oY + half} `
    + `A ${half} ${half} 0 0 1 ${oX + half} ${oY} Z`;
}

/**
 * The analytic outline of an axis-aligned rect (x,y,width,height), gated
 * by `mode` (same three-way split circleOutlinePathD follows):
 *   'stroke' (default): the Minkowski-sum outer boundary (rect inflated
 *     by strokeWidth/2, ROUND corners) plus a sharp-cornered inner rect
 *     offset INWARD by strokeWidth/2. The inner ring vanishes ("if w >=
 *     min side the inner ring vanishes") when the stroke is wide enough
 *     that the inward offset would invert (strokeWidth >= the rect's own
 *     shorter side).
 *   'fill': the outline IS the rect's own exact edge, no offset.
 *   'both': the outer (rounded) ring only, no inner — already solid.
 */
export function rectOutlinePathD({ x, y, width, height, strokeWidth, mode = 'stroke' }) {
  const half = strokeWidth / 2;
  if (mode === 'fill') return { d: _rectLoopD(x, y, width, height), unsupported: null };
  if (mode === 'both') return { d: _rectRoundedOuterD(x, y, width, height, half), unsupported: null };

  const iW = width - strokeWidth, iH = height - strokeWidth;
  // T51: the INNER ring alone (see circleOutlinePathD's own T51 comment
  // for the "why") — exact, sharp-cornered, no offsetting algorithm
  // needed for a rect's own inward offset.
  if (mode === 'inner') {
    return Math.min(iW, iH) > 1e-9
      ? { d: _rectLoopD(x + half, y + half, iW, iH), unsupported: null }
      : { d: null, unsupported: 'collapsed' };
  }

  const outer = _rectRoundedOuterD(x, y, width, height, half);
  if (Math.min(iW, iH) <= 1e-9) return { d: outer, unsupported: null };
  const inner = _rectLoopD(x + half, y + half, iW, iH);
  return { d: `${outer} ${inner}`, unsupported: null };
}

/** Ellipse point + unit tangent (CCW parametrization) at angle `t`, and
 *  the outward unit normal (tangent rotated -90deg — verified against
 *  the rightmost point t=0, where outward must be +x: T=(0,1) there,
 *  rotate-by-(-90): (x,y)->(y,-x) gives (1,0), matching). Shared by the
 *  offset-point/tangent closures below and the min-curvature check. */
function _ellipsePointTangent(cx, cy, rx, ry, t) {
  const cos = Math.cos(t), sin = Math.sin(t);
  const point = { x: cx + rx * cos, y: cy + ry * sin };
  const dx = -rx * sin, dy = ry * cos;
  const mag = Math.hypot(dx, dy);
  const tangent = { x: dx / mag, y: dy / mag };
  const normal = { x: tangent.y, y: -tangent.x }; // outward, CCW convention
  return { point, tangent, normal };
}

/** A closed biarc-fitted loop offsetting the ellipse boundary by `off`
 *  (positive = outward, negative = inward, 0 = the ellipse's own exact
 *  edge) — 4 quarter-turns [0,pi/2],[pi/2,pi],[pi,3pi/2],[3pi/2,2pi], fit
 *  separately (matching the same quadrant boundaries lineOutlinePathD's
 *  own cap construction and this module's other shapes implicitly use)
 *  rather than one 2pi span, so the fitter never has to discover the
 *  seam on its own. */
function _ellipseOffsetLoopD(cx, cy, rx, ry, off, tolerance) {
  const paramToPoint = (t) => {
    const { point, normal } = _ellipsePointTangent(cx, cy, rx, ry, t);
    return { x: point.x + off * normal.x, y: point.y + off * normal.y };
  };
  // The offset curve's tangent direction equals the SOURCE curve's own
  // tangent direction at the same parameter (a constant-distance normal
  // offset doesn't rotate the tangent, only reparametrizes speed) — no
  // separate offset-tangent formula needed.
  const paramToTangent = (t) => _ellipsePointTangent(cx, cy, rx, ry, t).tangent;

  const quarters = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, 2 * Math.PI];
  const allSegs = [];
  let start = null;
  for (let i = 0; i < 4; i++) {
    const { startPoint, segments } = fitOffsetWithBiarcs(paramToPoint, paramToTangent, quarters[i], quarters[i + 1], tolerance);
    if (i === 0) start = startPoint;
    allSegs.push(...segments);
  }
  const body = allSegs.map((s) => s.join(' ')).join(' ');
  return `M ${start.x} ${start.y} ${body} Z`;
}

/**
 * The analytic (biarc-FIT, not exact — no closed form exists) outline of
 * an ellipse (center cx,cy, radii rx,ry), gated by `mode` like every
 * other shape in this module:
 *   'stroke' (default): outer offset loop (+strokeWidth/2) + inner
 *     offset loop (-strokeWidth/2), biarc-fit each to `tolerance`
 *     (Fred: 0.001in default). The inner ring VANISHES (same concept
 *     circleOutlinePathD/rectOutlinePathD already use, generalized to an
 *     ellipse's own non-constant curvature) when strokeWidth/2 meets or
 *     exceeds the ellipse's OWN minimum radius of curvature
 *     (`min(ry^2/rx, rx^2/ry)`, tightest at the major-axis ends) — past
 *     that point the inward offset would overshoot the local center of
 *     curvature there, the cusp/self-intersection case Fred's own
 *     amendment names, resolved the same way circle/rect resolve their
 *     own "stroke swallows the whole shape" case: omit the ring, don't
 *     try to render a self-intersecting loop.
 *   'fill': the ellipse's own exact edge (offset 0).
 *   'both': outer offset loop only, no inner.
 */
export function ellipseOutlinePathD({ cx, cy, rx, ry, strokeWidth, mode = 'stroke', tolerance = 0.001 }) {
  const half = strokeWidth / 2;
  if (mode === 'fill') return { d: _ellipseOffsetLoopD(cx, cy, rx, ry, 0, tolerance), unsupported: null };
  if (mode === 'both') return { d: _ellipseOffsetLoopD(cx, cy, rx, ry, half, tolerance), unsupported: null };

  const minCurvatureRadius = Math.min((ry * ry) / rx, (rx * rx) / ry);
  // T51: the INNER ring alone (see circleOutlinePathD's own T51 comment)
  // — the TRUE biarc-fit inward offset, not an analytic shortcut (an
  // ellipse's own true parallel curve is not another ellipse, so
  // `rx-half,ry-half` would be wrong — this module's own established
  // finding, ellipseOutlinePathD's own header comment).
  if (mode === 'inner') {
    return half < minCurvatureRadius
      ? { d: _ellipseOffsetLoopD(cx, cy, rx, ry, -half, tolerance), unsupported: null }
      : { d: null, unsupported: 'collapsed' };
  }

  const outer = _ellipseOffsetLoopD(cx, cy, rx, ry, half, tolerance);
  if (half >= minCurvatureRadius) return { d: outer, unsupported: null };
  const inner = _ellipseOffsetLoopD(cx, cy, rx, ry, -half, tolerance);
  return { d: `${outer} ${inner}`, unsupported: null };
}

/** Point, unit tangent, and SIGNED curvature of a cubic Bezier
 *  (P0,P1,P2,P3) at parameter t — signed so a caller can tell which side
 *  of the curve is locally concave at t (positive = bending toward the
 *  LEFT/+90deg-normal side, using the same 2D-cross-product convention
 *  `_turnSign`-style logic elsewhere in this session already relies on). */
export function _cubicPointTangentCurvature(P0, P1, P2, P3, t) {
  const u = 1 - t;
  const point = {
    x: u * u * u * P0.x + 3 * u * u * t * P1.x + 3 * u * t * t * P2.x + t * t * t * P3.x,
    y: u * u * u * P0.y + 3 * u * u * t * P1.y + 3 * u * t * t * P2.y + t * t * t * P3.y,
  };
  const d1 = {
    x: 3 * u * u * (P1.x - P0.x) + 6 * u * t * (P2.x - P1.x) + 3 * t * t * (P3.x - P2.x),
    y: 3 * u * u * (P1.y - P0.y) + 6 * u * t * (P2.y - P1.y) + 3 * t * t * (P3.y - P2.y),
  };
  const d2 = {
    x: 6 * u * (P2.x - 2 * P1.x + P0.x) + 6 * t * (P3.x - 2 * P2.x + P1.x),
    y: 6 * u * (P2.y - 2 * P1.y + P0.y) + 6 * t * (P3.y - 2 * P2.y + P1.y),
  };
  const speed = Math.hypot(d1.x, d1.y);
  const tangent = speed > 1e-9 ? { x: d1.x / speed, y: d1.y / speed } : { x: 1, y: 0 };
  const cross = d1.x * d2.y - d1.y * d2.x;
  const curvature = speed > 1e-9 ? cross / (speed * speed * speed) : 0;
  return { point, tangent, curvature };
}

/** Same +90deg ("left") normal convention lineOutlinePathD itself uses
 *  (N=(-T.y,T.x)) — kept consistent so the same sweep=0 cap formula
 *  applies unchanged below, rather than introducing a second convention
 *  to reconcile (ellipseOutlinePathD's own -90deg "outward" convention
 *  is unrelated: a closed shape has a natural outward, an open segment
 *  does not — "left"/"right" is all there is here). */
export function _cubicOffsetPoint(P0, P1, P2, P3, t, side, half, clampFactor = 0.97) {
  const { point, tangent, curvature } = _cubicPointTangentCurvature(P0, P1, P2, P3, t);
  const normal = { x: -tangent.y, y: tangent.x };
  // side=+1 is the LEFT bank (+normal), side=-1 is RIGHT (-normal). That
  // bank is on the CONCAVE side at t exactly when side and curvature
  // carry the same sign (offsetting further INTO a bend the curve is
  // already turning toward) — there, the offset can never exceed the
  // curve's own local radius of curvature (1/|curvature|) without
  // overshooting past its center and self-intersecting; clamp to just
  // under it. The convex side never has this problem at any offset.
  let off = half;
  if (side * curvature > 1e-9) {
    const localRadius = 1 / Math.abs(curvature);
    if (off >= localRadius) off = localRadius * clampFactor;
  }
  return { x: point.x + side * off * normal.x, y: point.y + side * off * normal.y };
}

/**
 * The biarc-FIT outline of a SINGLE stroked cubic Bezier segment
 * (P0,P1,P2,P3), round-capped — the direct curved-segment analog of
 * lineOutlinePathD (2 offset banks + 2 round caps), except the banks are
 * biarc-fit (no closed form for a cubic's true offset) and per-point
 * curvature-clamped on whichever side is locally concave at each t (an
 * S-curve bends BOTH ways along its own length, so — unlike
 * ellipseOutlinePathD's constant-sign curvature — a single "does the
 * whole ring vanish" check is wrong here; the clamp has to be local).
 * `cap`: only 'round' is built here — this function's OWN gate, decoupled
 * from SUPPORTED_LINE_CAPS (T44 flipped that shared table's butt/square to
 * true for lineOutlinePathD/pathOutlinePathD, which now build them for
 * real; this function's body never grew a butt/square construction, so
 * sharing that table would silently start accepting them and returning a
 * round-cap shape instead of declining). Declined the same way (never
 * throws) for anything but round.
 */
const _CUBIC_SEGMENT_SUPPORTED_CAPS = Object.freeze({ round: true, butt: false, square: false });
export function cubicSegmentOutlinePathD({ x1, y1, cx1, cy1, cx2, cy2, x2, y2, strokeWidth, cap = 'round', tolerance = 0.001 }) {
  if (!_CUBIC_SEGMENT_SUPPORTED_CAPS[cap]) return { d: null, unsupported: cap };
  const half = strokeWidth / 2;
  const P0 = { x: x1, y: y1 }, P1 = { x: cx1, y: cy1 }, P2 = { x: cx2, y: cy2 }, P3 = { x: x2, y: y2 };

  const leftPoint = (t) => _cubicOffsetPoint(P0, P1, P2, P3, t, 1, half);
  const leftTangent = (t) => _cubicPointTangentCurvature(P0, P1, P2, P3, t).tangent;
  const rightPoint = (t) => _cubicOffsetPoint(P0, P1, P2, P3, t, -1, half);
  // Traced t: 1 -> 0 for the right bank (closing the loop, same order
  // lineOutlinePathD's own R2->R1 direction follows) — tangent reverses
  // sign to match the direction of travel.
  const rightTangentReversed = (t) => { const tt = _cubicPointTangentCurvature(P0, P1, P2, P3, t).tangent; return { x: -tt.x, y: -tt.y }; };

  const left = fitOffsetWithBiarcs(leftPoint, leftTangent, 0, 1, tolerance);
  const right = fitOffsetWithBiarcs((t) => rightPoint(1 - t), rightTangentReversed, 0, 1, tolerance);

  const r = half;
  const L1 = leftPoint(0), R2 = rightPoint(1), R1 = rightPoint(0), L1again = leftPoint(0);
  const leftBody = left.segments.map((s) => s.join(' ')).join(' ');
  const rightBody = right.segments.map((s) => s.join(' ')).join(' ');
  // Caps: same sweep=0, radius=half construction lineOutlinePathD itself
  // uses (verified there against arcToCubics' own sampled midpoint) —
  // centered on the curve's own endpoint, from the left-offset point to
  // the right-offset point at that SAME parameter.
  const d = `M ${L1.x} ${L1.y} ${leftBody} A ${r} ${r} 0 0 0 ${R2.x} ${R2.y} ${rightBody} A ${r} ${r} 0 0 0 ${L1again.x} ${L1again.y} Z`;
  return { d, unsupported: null };
}

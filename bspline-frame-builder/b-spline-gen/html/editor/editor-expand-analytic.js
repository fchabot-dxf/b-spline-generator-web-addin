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
 */

/**
 * Which stroke-linecap values this engine can express analytically today.
 * Declared as data, not inferred per call site, so a NEW cap kind is one
 * line to add here (when its own closed form is built) rather than a
 * silent fallthrough somewhere else. `round` is the lattice's own case —
 * every rail/tie is drawn with linecap:'round' (editor-lattice.js). `butt`/
 * `square` are a genuinely different, still-analytic closed form (4
 * straight segments, no arcs at all) — just not yet built; declaring them
 * `false` here means a caller gets an explicit decline (see
 * lineOutlinePathD's `unsupported` return field), never a wrong shape
 * produced by treating them as round.
 */
export const SUPPORTED_LINE_CAPS = Object.freeze({
  round: true,
  butt: false,
  square: false,
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
    const d = `M ${x1 - r} ${y1} A ${r} ${r} 0 1 0 ${x1 + r} ${y1} A ${r} ${r} 0 1 0 ${x1 - r} ${y1} Z`;
    return { d, unsupported: null };
  }

  // Unit direction p1->p2, and its +90 deg normal (offset direction for
  // one "bank" of the capsule — the other bank is the same offset negated).
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;

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
  if (mode === 'fill') return { d: _circleLoopD(cx, cy, r), unsupported: null };
  if (mode === 'both') return { d: _circleLoopD(cx, cy, r + half), unsupported: null };

  const outerR = r + half;
  const innerR = r - half;
  const outer = _circleLoopD(cx, cy, outerR);
  if (innerR <= 1e-9) return { d: outer, unsupported: null };
  const inner = _circleLoopD(cx, cy, innerR);
  return { d: `${outer} ${inner}`, unsupported: null };
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

  const outer = _rectRoundedOuterD(x, y, width, height, half);
  const iW = width - strokeWidth, iH = height - strokeWidth;
  if (Math.min(iW, iH) <= 1e-9) return { d: outer, unsupported: null };
  const inner = _rectLoopD(x + half, y + half, iW, iH);
  return { d: `${outer} ${inner}`, unsupported: null };
}

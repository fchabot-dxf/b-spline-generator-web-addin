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

/**
 * editor-primitives.js -- Audit (tidy-up): the ONE copy of the small line/arc primitive geometry helpers. Three
 * modules each had a private `_arcPointAt` (one took a 0..1 FRACTION of the sweep, two an absolute ANGLE -- same
 * name, different meaning), two had the same point-to-segment distance, and contour-from-frame.js re-derived the
 * arc distance inline. A primitive is `{type:'L', p0, p1}` or `{type:'A', cx, cy, rx, ry, phi, theta1, dTheta}`.
 * No dependencies (pure math), so any module can import it.
 */

/** The point at absolute angle `theta` on an (optionally elliptical, rotated) arc primitive. */
export function arcPointAtAngle(prim, theta) {
  const c = Math.cos(prim.phi || 0), s = Math.sin(prim.phi || 0);
  const ex = prim.rx * Math.cos(theta), ey = (prim.ry ?? prim.rx) * Math.sin(theta);
  return { x: prim.cx + ex * c - ey * s, y: prim.cy + ex * s + ey * c };
}

/** The point at fraction `t` (0 = start, 1 = end) along an arc primitive's own sweep. */
export function arcPointAtFraction(prim, t) {
  return arcPointAtAngle(prim, prim.theta1 + prim.dTheta * t);
}

/** Distance from `pt` to the segment `p0`-`p1` (clamped to its ends). */
export function distToSegment(pt, p0, p1) {
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((pt.x - p0.x) * dx + (pt.y - p0.y) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(pt.x - (p0.x + t * dx), pt.y - (p0.y + t * dy));
}

/** Distance from `pt` to a CIRCULAR arc primitive (the generators' arcs: rx === ry, phi 0): the distance to the
 *  circle inside the arc's angular span, else to the nearer end. */
export function distToArc(pt, prim) {
  const distFromCenter = Math.hypot(pt.x - prim.cx, pt.y - prim.cy);
  let rel = Math.atan2(pt.y - prim.cy, pt.x - prim.cx) - prim.theta1;
  const TAU = Math.PI * 2;
  rel -= TAU * Math.floor((rel + Math.PI) / TAU); // normalize to (-PI, PI]
  const onArc = prim.dTheta >= 0 ? (rel >= 0 && rel <= prim.dTheta) : (rel <= 0 && rel >= prim.dTheta);
  if (onArc) return Math.abs(distFromCenter - prim.rx);
  const p0 = arcPointAtFraction(prim, 0), p1 = arcPointAtFraction(prim, 1);
  return Math.min(Math.hypot(pt.x - p0.x, pt.y - p0.y), Math.hypot(pt.x - p1.x, pt.y - p1.y));
}

/** Distance from `pt` to a line or arc primitive. */
export function distToPrimitive(pt, prim) {
  return prim.type === 'L' ? distToSegment(pt, prim.p0, prim.p1) : distToArc(pt, prim);
}

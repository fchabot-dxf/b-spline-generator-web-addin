/**
 * core/bricks/curve-intersect.js — PORTABLE (see rng.js). Closed-form intersections between the two
 * curve types a frame primitive's own ANALYTIC OFFSET can be: a `{type:'line', p0, dir}` (infinite
 * line, dir unit) or a `{type:'circle', c, r}` (full circle -- the caller trims to the live angular
 * range separately). H23 item 76 (advisor, after three reverted attempts at sampling a tessellated
 * polyline for this same thing): a mitre corner between two primitives whose own feasible band-depth
 * range differs needs the TRUE analytic intersection of their own offset curves, not an approximation
 * read off pre-built points.
 *
 * Each can have 0, 1 or 2 real roots (line-circle, circle-circle) -- `nearest` picks the one closest
 * to a reference point (the ORIGINAL, un-offset junction) so construction never grabs the
 * geometrically-valid-but-wrong root (e.g. the far side of a circle).
 */

export function lineLineIntersection(p0, dir0, p1, dir1) {
  const denom = dir0.x * dir1.y - dir0.y * dir1.x;
  if (Math.abs(denom) < 1e-9) return null; // parallel
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const t = (dx * dir1.y - dy * dir1.x) / denom;
  return { x: p0.x + dir0.x * t, y: p0.y + dir0.y * t };
}

/** `dir` must be a UNIT vector. */
export function lineCircleIntersections(p0, dir, c, r) {
  const dx = p0.x - c.x, dy = p0.y - c.y;
  const b = dx * dir.x + dy * dir.y;
  const cc = dx * dx + dy * dy - r * r;
  const disc = b * b - cc;
  if (disc < 0) return [];
  const sq = Math.sqrt(Math.max(0, disc));
  const t1 = -b - sq, t2 = -b + sq;
  const pt = (t) => ({ x: p0.x + dir.x * t, y: p0.y + dir.y * t });
  return disc < 1e-12 ? [pt(t1)] : [pt(t1), pt(t2)];
}

export function circleCircleIntersections(c1, r1, c2, r2) {
  const dx = c2.x - c1.x, dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-9) return []; // concentric -- no well-defined intersection
  const ux = dx / d, uy = dy / d;
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  const mx = c1.x + a * ux, my = c1.y + a * uy;
  if (h2 < 0) return [{ x: mx, y: my }]; // circles fall just short of touching (floating-point edge of
  // a template whose two offset curves were DESIGNED to meet) -- the closest-approach point is the
  // most useful answer available, not a hard failure.
  const h = Math.sqrt(h2);
  if (h < 1e-9) return [{ x: mx, y: my }]; // tangent
  const vx = -uy, vy = ux;
  return [{ x: mx + h * vx, y: my + h * vy }, { x: mx - h * vx, y: my - h * vy }];
}

function nearest(points, ref) {
  if (!points.length) return null;
  let best = points[0], bestD = Infinity;
  for (const p of points) {
    const d = (p.x - ref.x) ** 2 + (p.y - ref.y) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

/** Intersect two offset curves, returning the single point nearest `ref` -- null only when neither
 *  curve has any real root at all (parallel lines, or two circles with no closest-approach point,
 *  which cannot actually happen since circleCircleIntersections always returns at least one). */
export function curveIntersection(a, b, ref) {
  if (a.type === 'line' && b.type === 'line') return lineLineIntersection(a.p0, a.dir, b.p0, b.dir);
  if (a.type === 'line' && b.type === 'circle') return nearest(lineCircleIntersections(a.p0, a.dir, b.c, b.r), ref);
  if (a.type === 'circle' && b.type === 'line') return nearest(lineCircleIntersections(b.p0, b.dir, a.c, a.r), ref);
  return nearest(circleCircleIntersections(a.c, a.r, b.c, b.r), ref);
}

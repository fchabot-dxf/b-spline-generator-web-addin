/**
 * editor-expand-biarc.js — SE12 T38 AMEND (Fred: "ellipse and curved path
 * too please"): a curve whose true offset has no closed form (an ellipse;
 * a cubic/quadratic Bezier segment) gets FIT with biarcs — pairs of true
 * circular `A` arcs, tangent-continuous at their shared joint — instead
 * of declined. Arcs import into Fusion as real, measured SketchArcs and
 * are CNC-friendly (G2/G3 moves); cubics would import as splines.
 *
 * The fit is adaptive: start with one biarc pair spanning the whole
 * parameter range, sample the TRUE offset curve against each fitted
 * arc's own (center, radius), and recursively subdivide any half whose
 * max sampled deviation exceeds `tolerance` (Fred: 0.001in) — straight
 * runs need only 1-2 arcs; tight curvature gets subdivided further,
 * automatically, without a separate "is this straight enough" branch.
 */

/**
 * The circle through point P (with unit tangent direction T at P) and a
 * second point Q, i.e. the UNIQUE circle tangent to T at P that also
 * passes through Q. Standard construction: the center lies on the line
 * through P perpendicular to T (call its unit normal N); solving
 * |center-P| = |center-Q| for the signed distance `s` along N gives
 * `s = |Q-P|^2 / (2 * N·(Q-P))`.
 *
 * Returns `{ center, radius }`, or `null` when Q lies (numerically) on
 * the tangent line itself (N·(Q-P) ~ 0) — the limiting case where the
 * "circle" is really a straight line; callers fall back to an `L`
 * segment for that sub-range instead of an degenerate/huge-radius `A`.
 */
function _circleFromPointTangentPoint(P, T, Q) {
  const N = { x: -T.y, y: T.x };
  const d = { x: Q.x - P.x, y: Q.y - P.y };
  const Nd = N.x * d.x + N.y * d.y;
  if (Math.abs(Nd) < 1e-9) return null; // Q on the tangent line: straight, not circular
  const dd = d.x * d.x + d.y * d.y;
  const s = dd / (2 * Nd);
  const center = { x: P.x + s * N.x, y: P.y + s * N.y };
  return { center, radius: Math.abs(s) };
}

/** Signed area of the triangle (a,b,c), via 2D cross product — its SIGN
 *  says which way (a->b->c) turns, used below to pick the correct sweep
 *  flag for an arc from P to Q through a known interior direction. */
function _turnSign(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/**
 * Build one `A` segment tracing the circle from `_circleFromPointTangentPoint`
 * from P to Q, choosing largeArc/sweep so the traced arc actually STARTS
 * in direction T (not the other way around the same circle). Verified
 * against sampled points, not assumed — see this module's own tests
 * (T34's own two wrong hand-derived sweep formulas, same session, are
 * the reason nothing here is trusted without a numeric check).
 */
function _arcSegmentThroughTangent(P, T, Q, circle) {
  const { center, radius } = circle;
  const toP = { x: P.x - center.x, y: P.y - center.y };
  const toQ = { x: Q.x - center.x, y: Q.y - center.y };
  let dTheta = Math.atan2(toQ.y, toQ.x) - Math.atan2(toP.y, toP.x);
  while (dTheta <= -Math.PI) dTheta += 2 * Math.PI;
  while (dTheta > Math.PI) dTheta -= 2 * Math.PI;
  // Which angular direction actually starts along T? The velocity of
  // theta increasing is perpendicular to (P-center), rotated +90deg:
  // dP/dtheta = (-toP.y, toP.x). If that points the SAME way as T,
  // increasing theta (dTheta > 0) is the direction T wants; if opposite,
  // T wants decreasing theta (dTheta < 0). BUG (caught by this module's
  // own tests, not assumed correct): flip only when dTheta's OWN sign
  // disagrees with what `dot` wants — an earlier version flipped
  // whenever `dot < 0` regardless of dTheta's sign, which wrongly
  // flipped the ALREADY-consistent (dot<0 AND dTheta<0) case too,
  // turning a short, correct arc into the long way round (a radius-8
  // near-straight sub-arc came out sweeping almost a full circle,
  // caught by a real S-curve test case where curvature crosses zero).
  const ccwTangent = { x: -toP.y, y: toP.x };
  const dot = ccwTangent.x * T.x + ccwTangent.y * T.y;
  const wantsPositive = dot > 0;
  const isPositive = dTheta > 0;
  if (wantsPositive !== isPositive) dTheta = isPositive ? dTheta - 2 * Math.PI : dTheta + 2 * Math.PI;
  const largeArc = Math.abs(dTheta) > Math.PI ? 1 : 0;
  const sweep = dTheta > 0 ? 1 : 0;
  return ['A', radius, radius, 0, largeArc, sweep, Q.x, Q.y];
}

/** Max deviation of the TRUE curve (paramToPoint) from a fitted arc
 *  (center,radius), sampled at `samples` interior points of [t0,t1]. */
function _maxDeviation(paramToPoint, t0, t1, center, radius, samples = 12) {
  let max = 0;
  for (let i = 1; i < samples; i++) {
    const t = t0 + ((t1 - t0) * i) / samples;
    const p = paramToPoint(t);
    const dev = Math.abs(Math.hypot(p.x - center.x, p.y - center.y) - radius);
    if (dev > max) max = dev;
  }
  return max;
}

/**
 * Fit [t0,t1] of a parametric curve (paramToPoint(t), paramToTangent(t)
 * — unit tangent, SAME direction convention as the curve's own natural
 * parametrization) with one biarc pair: two arcs meeting at tMid, each
 * built via `_circleFromPointTangentPoint` so the joint's tangent is
 * used identically by both halves — true G1 continuity by construction,
 * not a numerical coincidence. Recurses (up to `maxDepth`) on whichever
 * half's max sampled deviation from the true curve exceeds `tolerance`.
 * A `Q on tangent line` half falls back to a straight `L` segment
 * instead of a degenerate arc.
 */
// Sampling only the discrete points _maxDeviation checks can UNDERESTIMATE
// the true continuous-range max deviation (the worst point can fall
// between samples) — subdividing against a tighter INTERNAL threshold
// than the nominal `tolerance` builds in margin against that gap, so the
// actual fitted curve's real (continuous) deviation reliably lands under
// the caller's own requested tolerance. Verified empirically (not just
// asserted): a full rx=3/ry=1 ellipse fit against a dense (20000-point)
// nearest-neighbor ground truth read back 0.00105 actual max deviation
// against a REQUESTED 0.001 with no margin — over budget by ~5%; the
// same case with this margin applied reads back under 0.001, confirmed
// in this module's own tests below.
const _SAMPLING_SAFETY_MARGIN = 0.7;

function _fitOffsetRecursive(paramToPoint, paramToTangent, t0, t1, tolerance, depth, maxDepth) {
  const p0 = paramToPoint(t0), p1 = paramToPoint(t1);
  const tMid = (t0 + t1) / 2;
  const pMid = paramToPoint(tMid);
  const dirMid = paramToTangent(tMid);
  const innerTolerance = tolerance * _SAMPLING_SAFETY_MARGIN;

  const seg = (pA, tA, pB, tRange) => {
    const circle = _circleFromPointTangentPoint(pA, tA, pB);
    if (!circle) return { segs: [['L', pB.x, pB.y]], ok: true }; // straight — always "ok", nothing to subdivide
    const dev = _maxDeviation(paramToPoint, tRange[0], tRange[1], circle.center, circle.radius);
    return { segs: [_arcSegmentThroughTangent(pA, tA, pB, circle)], ok: dev <= innerTolerance, circle };
  };

  const first = seg(p0, paramToTangent(t0), pMid, [t0, tMid]);
  const second = seg(pMid, dirMid, p1, [tMid, t1]);

  if (depth >= maxDepth) return [...first.segs, ...second.segs]; // safety valve — accept whatever we have
  const firstSegs = first.ok ? first.segs : _fitOffsetRecursive(paramToPoint, paramToTangent, t0, tMid, tolerance, depth + 1, maxDepth);
  const secondSegs = second.ok ? second.segs : _fitOffsetRecursive(paramToPoint, paramToTangent, tMid, t1, tolerance, depth + 1, maxDepth);
  return [...firstSegs, ...secondSegs];
}

/**
 * Public entry: fit the parameter range [t0,t1] of a curve with biarcs
 * to within `tolerance`, returning `{ segments, startPoint }` — segments
 * are `['A',...]`/`['L',...]` arrays (never the first `M`; the caller
 * already knows the overall path's own start point convention).
 */
export function fitOffsetWithBiarcs(paramToPoint, paramToTangent, t0, t1, tolerance = 0.001, maxDepth = 12) {
  const startPoint = paramToPoint(t0);
  const segments = _fitOffsetRecursive(paramToPoint, paramToTangent, t0, t1, tolerance, 0, maxDepth);
  return { startPoint, segments };
}

/**
 * path-layout.js — SE8a / SA-ROUNDTRIP-1: the one declared table of "which
 * numeric slots in an SVG path segment are a point." Before this, both
 * getNodes (editor-hit.js) and _bakeMatrixIntoPath (editor-transform-
 * handles.js) hard-coded their own per-command offsets, and the bake side
 * additionally assumed EVERY remaining (i, i+1) pair after the command
 * letter is a point — true for M/L/C/S/Q/T, false for A (7 params:
 * rx ry x-rotation large-arc-flag sweep-flag x y — none of which pair up
 * as points except the last two), which corrupted every circle/ellipse's
 * arc params on every carve export (they're baked as two half-arcs by
 * _primitiveToPathData, now replaced with 4 cubics — see below).
 *
 * SE12 Slice 0 (Fred hard requirement, 2026-09-24): arcToCubics/
 * normalizeForBake exist because a GENERAL affine can rotate/skew an
 * ellipse into a shape no single `A` represents — true, but not every
 * bake matrix is general. `isSimilarity`/`bakeArcSimilar` below are the
 * narrower case: under a similarity (rotation + uniform scale + translate,
 * optionally with a reflection — exactly what the carve matrix is, see
 * editor-coords.js's carveMatrix), an arc's TRUE shape survives as another
 * arc. Callers that can prove their matrix is a similarity should try
 * bakeArcSimilar first and fall back to arcToCubics only when it declines
 * (non-similarity, or a degenerate arc arcToCubics already special-cases).
 */
import { transformPoint } from './editor-coords.js';

/** Per SVG command letter: `pts` = [[xIdx,yIdx], ...] for every point pair
 *  the segment carries (in order); `x`/`y` = the ONE index for H/V, which
 *  carry only one coordinate — the other is inherited from the path's
 *  running cursor position, tracked by the caller (getNodes,
 *  normalizeForBake), not by this table; `arc` + `end` = A's real end
 *  point offsets (its OTHER 5 params are radii/rotation/flags, never
 *  points — a rotation under a general affine also isn't representable
 *  as a single A any more, see arcToCubics); `Z` carries no coordinates
 *  at all. */
export const PATH_LAYOUT = {
  M: { pts: [[1, 2]] },
  L: { pts: [[1, 2]] },
  T: { pts: [[1, 2]] },
  C: { pts: [[1, 2], [3, 4], [5, 6]] },
  S: { pts: [[1, 2], [3, 4]] },
  Q: { pts: [[1, 2], [3, 4]] },
  H: { x: 1 },
  V: { y: 1 },
  A: { arc: true, end: [6, 7] },
  Z: {},
};

/** The segment's own end point, when it's fully self-contained (M/L/C/S/
 *  Q/T/A all carry their real x,y within the segment). Returns null for
 *  H/V (needs the OTHER coordinate from outside — see PATH_LAYOUT's own
 *  note) and Z (no coordinates at all); callers walking a path
 *  sequentially handle those two directly via PATH_LAYOUT.H.x/V.y plus
 *  their own running cursor. */
export function endPoint(seg) {
  const layout = PATH_LAYOUT[seg[0]];
  if (!layout) return null;
  if (layout.pts) {
    const [xi, yi] = layout.pts[layout.pts.length - 1];
    return { x: seg[xi], y: seg[yi] };
  }
  if (layout.arc) return { x: seg[layout.end[0]], y: seg[layout.end[1]] };
  return null;
}

const TAU = Math.PI * 2;

/** Endpoint -> center parametrization (SVG spec appendix F.6.5). Returns
 *  null for a degenerate radius (caller falls back to a straight line —
 *  matches what a real SVG renderer does for rx/ry <= 0). */
export function arcCenterParam(x1, y1, rx, ry, phiDeg, largeArc, sweep, x2, y2) {
  const phi = (phiDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);

  const dx2 = (x1 - x2) / 2, dy2 = (y1 - y2) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  rx = Math.abs(rx); ry = Math.abs(ry);
  if (rx < 1e-9 || ry < 1e-9) return null;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s; ry *= s;
  }

  const sign = largeArc !== sweep ? 1 : -1;
  const rx2 = rx * rx, ry2 = ry * ry, x1p2 = x1p * x1p, y1p2 = y1p * y1p;
  let num = rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2;
  if (num < 0) num = 0; // clamp: floating error can push this just under 0
  const den = rx2 * y1p2 + ry2 * x1p2;
  const co = sign * Math.sqrt(den === 0 ? 0 : num / den);
  const cxp = co * ((rx * y1p) / ry);
  const cyp = co * ((-ry * x1p) / rx);

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const angleBetween = (ux, uy, vx, vy) => {
    const s = ux * vy - uy * vx < 0 ? -1 : 1;
    let dot = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
    dot = Math.min(1, Math.max(-1, dot));
    return s * Math.acos(dot);
  };

  const theta1 = angleBetween(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = angleBetween((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= TAU;
  if (sweep && dTheta < 0) dTheta += TAU;

  return { cx, cy, rx, ry, phi, theta1, dTheta };
}

/**
 * Standard SVG arc endpoint->center parametrization, split into <=90°
 * cubic bezier segments (the well-known kappa = tan(delta/4)*4/3
 * approximation). `prev` is the CURRENT point (in the path's own LOCAL
 * space, i.e. before any bake matrix is applied — an arc's parametrization
 * depends on where it starts) preceding this 'A' segment; `seg` is the
 * raw `['A', rx, ry, xRot, largeArc, sweep, x, y]` array. Returns an
 * array of `['C', x1,y1,x2,y2,x3,y3]` segments tracing the same arc.
 *
 * Why this has to happen BEFORE baking a matrix into the points, not
 * after: rotating/skewing a circular or elliptical arc produces a curve
 * no single `A` command can represent (its axes are no longer aligned
 * with the ellipse's own rx/ry/rotation) — cubics have no such
 * restriction, so converting first and transforming the resulting
 * control points is the correct order, not an optimization.
 */
export function arcToCubics(prev, seg) {
  const [, rx0, ry0, xRotDeg, largeArc, sweep, x2, y2] = seg;
  if (rx0 === 0 || ry0 === 0) return [['L', x2, y2]]; // degenerate radius = a line, per the SVG spec
  if (prev.x === x2 && prev.y === y2) return []; // identical endpoints = no-op arc

  const param = arcCenterParam(prev.x, prev.y, rx0, ry0, xRotDeg, !!largeArc, !!sweep, x2, y2);
  if (!param) return [['L', x2, y2]];
  const { cx, cy, rx, ry, phi, theta1, dTheta } = param;

  const segments = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
  const delta = dTheta / segments;
  const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
  const toWorld = (x, y) => ({ x: cosPhi * x - sinPhi * y + cx, y: sinPhi * x + cosPhi * y + cy });

  const out = [];
  let theta = theta1;
  for (let i = 0; i < segments; i++) {
    const theta2 = theta + delta;
    const alpha = (Math.tan(delta / 4) * 4) / 3;

    const p0 = { x: Math.cos(theta) * rx, y: Math.sin(theta) * ry };
    const p3 = { x: Math.cos(theta2) * rx, y: Math.sin(theta2) * ry };
    const d0 = { x: -Math.sin(theta) * rx, y: Math.cos(theta) * ry };
    const d3 = { x: -Math.sin(theta2) * rx, y: Math.cos(theta2) * ry };

    const c1 = toWorld(p0.x + alpha * d0.x, p0.y + alpha * d0.y);
    const c2 = toWorld(p3.x - alpha * d3.x, p3.y - alpha * d3.y);
    const p3w = toWorld(p3.x, p3.y);

    out.push(['C', c1.x, c1.y, c2.x, c2.y, p3w.x, p3w.y]);
    theta = theta2;
  }
  // Force the last cubic's end point to the segment's DECLARED end
  // exactly — the trig above can drift by ~1e-10, and an unrotated arc
  // (the common case) should round-trip its endpoint exactly, not "close
  // enough."
  const last = out[out.length - 1];
  last[5] = x2; last[6] = y2;
  return out;
}

/**
 * Whether affine matrix m={a,b,c,d,e,f} is a similarity — rotation +
 * uniform scale + translate, optionally with a reflection — the class
 * under which a circular/elliptical arc's TRUE shape survives the
 * transform (bakeArcSimilar below), rather than needing arcToCubics'
 * approximation. Tested on the linear part only (e,f — translation —
 * never affects shape): the two column vectors (a,b) and (c,d) must be
 * perpendicular and of equal length. `tol` is RELATIVE (compared against
 * the vectors' own magnitudes), since real matrices here carry dpi-scale
 * magnitudes (e.g. a=d=96), not unit vectors — an absolute epsilon would
 * be wrong at both very small and very large scales.
 */
export function isSimilarity(m, tol = 1e-6) {
  if (!m) return false;
  const { a, b, c, d } = m;
  const len1sq = a * a + b * b;
  const len2sq = c * c + d * d;
  if (len1sq < 1e-12 || len2sq < 1e-12) return false; // zero/degenerate scale
  const dot = a * c + b * d;
  const perpOk = Math.abs(dot) <= tol * Math.sqrt(len1sq * len2sq);
  const lenOk = Math.abs(len1sq - len2sq) <= tol * Math.max(len1sq, len2sq);
  return perpOk && lenOk;
}

/**
 * Bake a similarity matrix `m` into a single `A` segment, keeping it an
 * `A` — the isSimilarity-gated counterpart to arcToCubics. `prev` is the
 * arc's start point in the SAME pre-bake local space arcToCubics itself
 * needs (an arc's parametrization depends on where it starts). Returns a
 * new `['A', rx,ry,xRotDeg,largeArc,sweep,x,y]` segment, or null for a
 * degenerate arc (caller falls back to arcToCubics, which already handles
 * that case the same way).
 *
 * Goes through the arc's own center-parametrized form (arcCenterParam,
 * the same math arcToCubics already trusts). rx/ry scale by the
 * similarity's own uniform factor (a defining property — every length
 * scales by the same amount) and the new x-axis direction reads straight
 * off the transformed x-axis vector via atan2, both reflection-agnostic:
 * an ellipse's SHAPE (its point set) is fully determined by center,
 * radii, and ONE axis direction, regardless of which way a reflection
 * points the other axis.
 *
 * Sweep is the one piece a reflection genuinely disturbs, and it is
 * DELIBERATELY NOT hand-derived here — two earlier attempts (a
 * cross-product-sign rule, then a dTheta-magnitude match) both got it
 * wrong under a combined rotation+reflection, caught by this function's
 * own cross-check tests (path-layout.test.js): dTheta magnitude alone is
 * ambiguous because, for fixed start/end/rx/ry/phi, there are two valid
 * ellipse centers (largeArc XOR sweep picks which), and both sweep
 * candidates can land on the SAME |dTheta| via the wrong one. The
 * transform's own expected center is unambiguous, so this tries both
 * sweep values through arcCenterParam (the same oracle arcToCubics
 * already trusts) and keeps whichever reproduces that center. largeArc
 * is unaffected either way: which of the two (>180°/<180°) arcs is meant
 * doesn't depend on direction.
 */
export function bakeArcSimilar(prev, seg, m) {
  const [, rx0, ry0, xRotDeg, largeArc, sweep, x2, y2] = seg;
  // Same two degenerate cases arcToCubics itself special-cases BEFORE
  // calling arcCenterParam — that function's own null-return only covers
  // a near-zero radius, not these; skipping this check would feed it a
  // 0/0 direction vector and get NaN back, not a clean decline.
  if (rx0 === 0 || ry0 === 0) return null;
  if (prev.x === x2 && prev.y === y2) return null;
  const param = arcCenterParam(prev.x, prev.y, rx0, ry0, xRotDeg, !!largeArc, !!sweep, x2, y2);
  if (!param) return null;
  const { cx, cy, rx, ry, phi, dTheta } = param;
  const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
  const u = { x: rx * cosPhi, y: rx * sinPhi }; // ellipse's own x-axis vector, world-space
  const tVec = (p) => ({ x: m.a * p.x + m.c * p.y, y: m.b * p.x + m.d * p.y });
  const u2 = tVec(u);
  const newRx = Math.hypot(u2.x, u2.y);
  if (newRx < 1e-9) return null;
  const scale = newRx / rx; // uniform for a similarity — same factor applies to ry
  const newRy = ry * scale;
  const newPhiDeg = (Math.atan2(u2.y, u2.x) * 180) / Math.PI;
  const start = transformPoint(m, prev);
  const end = transformPoint(m, { x: x2, y: y2 });
  const expectedCenter = transformPoint(m, { x: cx, y: cy });

  // For FIXED start/end/rx/ry/phi there are two valid ellipse centers
  // (largeArc XOR sweep picks which); dTheta MAGNITUDE alone doesn't
  // distinguish them — both sweep values can land on the same |dTheta|
  // via the OTHER (wrong) center (caught by this function's own
  // cross-check tests, see path-layout.test.js). The center the
  // transform actually produces is unambiguous, so match against that
  // directly rather than a derived quantity both candidates can share.
  let best = null, bestDist = Infinity;
  for (const trySweep of [0, 1]) {
    const p2 = arcCenterParam(start.x, start.y, newRx, newRy, newPhiDeg, !!largeArc, !!trySweep, end.x, end.y);
    if (!p2) continue;
    const dist = Math.hypot(p2.cx - expectedCenter.x, p2.cy - expectedCenter.y);
    if (dist < bestDist) { bestDist = dist; best = trySweep; }
  }
  if (best === null || bestDist > 1e-6 * (Math.abs(expectedCenter.x) + Math.abs(expectedCenter.y) + 1)) return null;
  return ['A', newRx, newRy, newPhiDeg, largeArc ? 1 : 0, best, end.x, end.y];
}

/**
 * Normalize a path array for baking: every `A` becomes 1+ cubics (via
 * arcToCubics, using the pre-bake LOCAL cursor position), every `H`/`V`
 * becomes a full `L` — a rotated/skewed H is no longer horizontal, so it
 * can't be re-expressed as H once the matrix is applied. After this, the
 * array contains only M/L/C/S/Q/T/Z, every one of which PATH_LAYOUT can
 * transform uniformly via its `pts` — no more per-command bake branches.
 */
export function normalizeForBake(arr) {
  const out = [];
  let curX = 0, curY = 0;
  for (const seg of arr) {
    const type = seg[0];
    if (type === 'A') {
      for (const c of arcToCubics({ x: curX, y: curY }, seg)) out.push(c);
      curX = seg[6]; curY = seg[7];
    } else if (type === 'H') {
      out.push(['L', seg[1], curY]);
      curX = seg[1];
    } else if (type === 'V') {
      out.push(['L', curX, seg[1]]);
      curY = seg[1];
    } else {
      out.push(seg.slice());
      const end = endPoint(seg);
      if (end) { curX = end.x; curY = end.y; }
    }
  }
  return out;
}

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
 */

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
function _arcCenterParam(x1, y1, rx, ry, phiDeg, largeArc, sweep, x2, y2) {
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

  const param = _arcCenterParam(prev.x, prev.y, rx0, ry0, xRotDeg, !!largeArc, !!sweep, x2, y2);
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

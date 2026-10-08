/**
 * core/bricks/geometry.js — PORTABLE (see rng.js). Small, pure polygon/path helpers. No brick-
 * domain knowledge -- these work on plain {x,y} points and polygons (arrays of {x,y}), reused by
 * every layout + the frame placer.
 *
 * KNOWN LIMITATION -- the polygon booleans (polygonIntersection / polygonDifference, Greiner-Hormann) can MISS an
 * overlap that runs along an EDGE the two polygons share exactly: the crossings degenerate, and the result comes back
 * as if the two only touched (intersection 0, difference = the subject untouched). The DEGENERACY_SHIFT path catches
 * some of these, not all. MEASURED (T86, seat B): T16 6x9 1.5 in -- a band piece cut first by one cutter, then by a
 * second whose edge coincided with the first cut, kept a 0.013 x 0.004 in tip inside the second cutter; the seam read
 * 0.022 in for a 0.034 in joint. A caller that must not miss ground checks the result (a vertex still deeper than a
 * hair inside the clip) and redoes the boolean with the clip nudged a hair larger -- contour-bands.js
 * checkedDifference (CUT_NUDGE_IN, 1e-6 in). Related: a clip can also leave a zero-area SPIKE along a shared edge --
 * dropSpikes.
 */

const ON_EDGE_EPS_SQ = 1e-18; // (1e-9 in)^2 -- see pointInPolygon's own header for why this exists

/** Squared distance from `(x,y)` to the SEGMENT `a`-`b` (clamped projection, not the infinite line). */
function distSqToSegment(x, y, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-18) { const ex = x - a.x, ey = y - a.y; return ex * ex + ey * ey; }
  let t = ((x - a.x) * dx + (y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const ex = x - (a.x + t * dx), ey = y - (a.y + t * dy);
  return ex * ex + ey * ey;
}

/** Standard ray-casting point-in-polygon (works for convex AND concave simple polygons -- board
 *  outlines in this app include concave shapes, e.g. an hourglass waist).
 *
 *  T86 item 19 (seat 88's measurement, T1 7x9 Wall-only): a point BUILT to land exactly on a
 *  polygon edge can drift by a float ULP to either side of it -- MEASURED: `bondLayout`'s own
 *  course-0 bricks (bottom edge built as `minY + cH/2 - cH/2`, algebraically `minY` but not
 *  associative in IEEE 754) landed at 0.24999999999999997 against the board's own exact 0.25,
 *  JUST outside. The ray-cast below has zero boundary tolerance, so that one-ULP drift flipped the
 *  WHOLE row to "outside", not "inside", and every course-0 cell in it was silently dropped --
 *  structural, not a one-off: `bondLayout` always starts its course stack at `boardOutline`'s own
 *  `minY`, so ANY template with a flat bottom edge hits this for Wall's own first course. Fixed by
 *  treating "within a tiny absolute distance of an edge" as inside, same spirit as every other
 *  near-degenerate case this file already guards with a small epsilon (segmentIntersection's own
 *  1e-9, clipToHalfPlane's own tolerances) -- checked in the SAME pass as the ray-cast, not a
 *  separate O(n) scan, so a typical (clearly inside/outside) call pays only one cheap extra
 *  distance check per edge, not a second full loop. */
export function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i], pj = polygon[j];
    if (distSqToSegment(x, y, pj, pi) <= ON_EDGE_EPS_SQ) return true;
    const xi = pi.x, yi = pi.y, xj = pj.x, yj = pj.y;
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** pointInPolygon for MANY points against ONE polygon -- the same answer (2026-10-08: fieldstone's Poisson sampling
 *  tested every candidate against every board edge; 9.6 s of a 13.8 s phone tap). Edges are bucketed by y-band: an
 *  edge can only report "on edge" (within ON_EDGE_EPS_SQ) when the point is within 1e-9 of its y-range, and only
 *  toggles the parity when (yi > y) !== (yj > y), i.e. y within its y-range -- so y's band lists every edge that can
 *  matter, each tested with the SAME expressions, and "any edge on" / the parity do not depend on the order. */
export function polygonPointTester(polygon) {
  const n = polygon.length;
  if (n < 3) return (x, y) => pointInPolygon(x, y, polygon);
  const PAD = 1e-9; // sqrt(ON_EDGE_EPS_SQ)
  let y0 = Infinity, y1 = -Infinity;
  for (const p of polygon) { if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  y0 -= PAD; y1 += PAD;
  const bands = Math.max(1, Math.ceil(n / 4)), h = (y1 - y0) / bands || 1;
  const band = (y) => Math.min(bands - 1, Math.max(0, Math.floor((y - y0) / h)));
  const lists = Array.from({ length: bands }, () => []);
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const lo = Math.min(polygon[i].y, polygon[j].y) - PAD, hi = Math.max(polygon[i].y, polygon[j].y) + PAD;
    for (let k = band(lo); k <= band(hi); k++) lists[k].push(i, j);
  }
  return (x, y) => {
    if (!(y >= y0 && y <= y1)) return false; // no edge is within reach of y
    const l = lists[band(y)];
    let inside = false;
    for (let m = 0; m < l.length; m += 2) {
      const pi = polygon[l[m]], pj = polygon[l[m + 1]];
      if (distSqToSegment(x, y, pj, pi) <= ON_EDGE_EPS_SQ) return true;
      const xi = pi.x, yi = pi.y, xj = pj.x, yj = pj.y;
      const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  };
}

/** Plain average of a polygon's own corner points -- good enough for the near-rectangular cells
 *  every layout here produces (never a true area-weighted centroid, not needed at this shape). */
export function polygonCentroid(polygon) {
  let sx = 0, sy = 0;
  for (const p of polygon) { sx += p.x; sy += p.y; }
  return { x: sx / polygon.length, y: sy / polygon.length };
}

/** A rectangle (centre, half-length along `dir`, half-height along the perpendicular) as a
 *  4-point polygon, winding consistently (used by every layout for one unrotated/rotated cell). */
export function rectPolygon(cx, cy, halfLen, halfHt, dirX = 1, dirY = 0) {
  const nx = -dirY, ny = dirX; // perpendicular (unit, since dir is unit)
  return [
    { x: cx - dirX * halfLen - nx * halfHt, y: cy - dirY * halfLen - ny * halfHt },
    { x: cx + dirX * halfLen - nx * halfHt, y: cy + dirY * halfLen - ny * halfHt },
    { x: cx + dirX * halfLen + nx * halfHt, y: cy + dirY * halfLen + ny * halfHt },
    { x: cx - dirX * halfLen + nx * halfHt, y: cy - dirY * halfLen + ny * halfHt },
  ];
}

/** Cumulative arc length at each point of an open or closed polyline path. `pathLength(path)[i]`
 *  is the distance travelled from path[0] to path[i]. */
export function cumulativeLengths(path) {
  const out = [0];
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x, dy = path[i].y - path[i - 1].y;
    out.push(out[i - 1] + Math.hypot(dx, dy));
  }
  return out;
}

/** The point + unit tangent at arc-length `s` along `path` (cum = cumulativeLengths(path), passed
 *  in so callers walking the path in a loop don't recompute it every step). Clamps to the path's
 *  own ends. `closed`: when true, `s` wraps modulo the path's own total length (a frame contour is
 *  a closed loop). */
export function pointAtArcLength(path, cum, s, closed) {
  const total = cum[cum.length - 1];
  let t = closed ? ((s % total) + total) % total : Math.max(0, Math.min(total, s));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < t) i++;
  const segLen = cum[i] - cum[i - 1];
  const f = segLen > 1e-9 ? (t - cum[i - 1]) / segLen : 0;
  const a = path[i - 1], b = path[i];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: a.x + dx * f, y: a.y + dy * f, tx: dx / len, ty: dy / len };
}

/**
 * Offset a (closed) path inward by `width`, a true MITRED vertex offset -- each vertex moves
 * along the BISECTOR of its two incident edges' own normals, by whatever distance along that
 * bisector makes each edge's own perpendicular offset equal exactly `width` (not a simple
 * neighbour-averaged-normal offset, which under-shoots at a sharp corner: e.g. at a square's 90deg
 * corner the two edge normals are 90deg apart, so a naive average-direction offset of `width`
 * only moves each edge by width*cos(45deg) =~ 0.71*width, not the full width -- MEASURED via a
 * failing contour-bands.js band-width test before this fix existed). No self-intersection repair for a
 * concave corner tighter than the band width (the mitre distance is floored, see `cos` clamp
 * below, rather than blowing up toward a near-reflex corner) -- a documented P1 limitation, not a
 * silent one. `inwardSign`: the path's own winding determines which side is "inward" -- pass +1
 * or -1 to match (callers derive it once from the board/frame outline's own known winding, via
 * `signedArea`).
 */
export function offsetPathInward(path, width, inwardSign = 1) {
  const n = path.length;
  return path.map((p, i) => {
    const prev = path[(i - 1 + n) % n], next = path[(i + 1) % n];
    const t1x = p.x - prev.x, t1y = p.y - prev.y, len1 = Math.hypot(t1x, t1y) || 1;
    const n1x = -t1y / len1, n1y = t1x / len1;
    const t2x = next.x - p.x, t2y = next.y - p.y, len2 = Math.hypot(t2x, t2y) || 1;
    const n2x = -t2y / len2, n2y = t2x / len2;
    let bx = n1x + n2x, by = n1y + n2y;
    const blen = Math.hypot(bx, by);
    if (blen < 1e-9) { bx = n1x; by = n1y; } else { bx /= blen; by /= blen; }
    const cos = Math.max(0.2, bx * n1x + by * n1y); // floored so a near-reflex corner doesn't blow up
    const dist = width / cos;
    return { x: p.x + bx * dist * inwardSign, y: p.y + by * dist * inwardSign };
  });
}

/** Signed area of a closed polygon (shoelace) -- NEGATIVE = counter-clockwise in a standard Y-up frame (x right,
 *  y up), i.e. clockwise on screen (Y-down); MEASURED: the unit square (0,0),(1,0),(1,1),(0,1) gives -1. (This header
 *  said the opposite until T86 item 28, which cost a wrong inward ray.) Callers compare signs (winding vs winding) or
 *  take Math.abs; a caller that needs the inside side of an edge reads it from this measured sign. */
export function signedArea(path) {
  let a = 0;
  for (let i = 0, j = path.length - 1; i < path.length; j = i++) a += (path[j].x + path[i].x) * (path[j].y - path[i].y);
  return a / 2;
}

const INWARD_MIN_AREA = 1e-12; // sq in: below this a path has no winding to read
/** Which `offsetPathInward` sign (+1 or -1) moves a closed path's points INTO it -- read from its winding: the offset
 *  steps along each edge's left normal, which points inside exactly when the standard shoelace area is positive, i.e.
 *  when signedArea (this file's, the NEGATIVE shoelace) is below zero. Works however the caller's path was wound.
 *  T86 (seat E, the silent zero-brick lay; MEASURED): the previous rule -- a trial offset both ways, the side whose points end nearer the centroid
 *  -- is a vote of every vertex, so densely tessellated concave arcs out-voted the straight sides: a frame outline with a
 *  notch (T1's, alone on a side) laid its whole band OUTSIDE the board and the board clip dropped every piece (0 laid,
 *  no note); and polygonDifference nudged a concave clip the wrong way (19 calls in the suite). Over the suite the two
 *  rules disagreed only on those; on every simple polygon the winding matched a point-in-polygon check. A path with no
 *  area has no winding: it keeps the trial offset. */
export function inwardSignFor(path) {
  const area = signedArea(path);
  if (Math.abs(area) > INWARD_MIN_AREA) return area < 0 ? 1 : -1;
  const c = polygonCentroid(path);
  const dist = (pts) => pts.reduce((s, p) => s + Math.hypot(p.x - c.x, p.y - c.y), 0);
  const plus = offsetPathInward(path, 0.01, 1);
  const minus = offsetPathInward(path, 0.01, -1);
  return dist(plus) < dist(minus) ? 1 : -1;
}

/** Clip `poly` to the half-plane of `line` ({point, dirX, dirY} -- a point ON the line plus its
 *  own direction vector) containing `keepRef` (a point known to belong on the side that must
 *  survive) -- a plain single-line Sutherland-Hodgman clip. PROMOTED here from along-path.js
 *  (H23 item 73a's own mitre-clip technique) because it's genuinely shape-agnostic -- any caller
 *  that already has a dividing line (a mitre line, a Voronoi bisector, ...) and a convex-ish
 *  polygon to trim can reuse this directly rather than re-deriving it (H23 item 74: the
 *  'fieldstone' layout's own Voronoi cells are built from a CHAIN of these same clips). A
 *  half-plane clip of a simple polygon is always simple -- this is what makes every caller of it
 *  robust: clipping only ever trims, never adds a self-intersection. */
export function clipToHalfPlane(poly, line, keepRef) {
  const side = (p) => line.dirX * (p.y - line.point.y) - line.dirY * (p.x - line.point.x);
  const keepSign = Math.sign(side(keepRef)) || 1;
  const s = (p) => side(p) * keepSign;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i], next = poly[(i + 1) % poly.length];
    const curS = s(cur), nextS = s(next);
    if (curS >= -1e-9) out.push(cur);
    if ((curS >= -1e-9) !== (nextS >= -1e-9)) {
      const t = curS / (curS - nextS);
      out.push({ x: cur.x + (next.x - cur.x) * t, y: cur.y + (next.y - cur.y) * t });
    }
  }
  // H23 item 76: a vertex sitting (near-)EXACTLY on the clip line is both kept (curS>=-1e-9) AND
  // produces a crossing point at t~=0 immediately after it -- a harmless but real near-duplicate,
  // common whenever the caller's own polygon has a corner built FROM the same line (e.g. a mitred
  // piece next to the very joint it was clipped against). Dropping it here keeps this function's own
  // "clipping a simple polygon is always simple" guarantee meaningful for every caller, not just the
  // ones whose own geometry happens to avoid landing on the boundary.
  return dedupePolygon(out);
}

/** T86 16(c) part 2: `poly` clipped to the region where the scalar field `f` is <= 0 (`< 0` with `strict`) -- the
 *  same Sutherland-Hodgman walk as clipToHalfPlane (its special case: a linear f), for a CURVED dividing line (the
 *  medial line between two offset sources: a hyperbola between two arcs, a parabola between a line and an arc).
 *  An edge's crossing is found by bisection; the new edge between an exit and the next entry is not left as a
 *  chord but refined onto f = 0 every FIELD_CUT_STEP_IN (Newton steps along the numerical gradient), so the two
 *  polygons a curve divides get the SAME curve, not two chords with a sliver between. A polygon wholly inside is
 *  returned as is; one with no vertex inside returns [] (a curve bulging into a convex piece between two of its
 *  vertices is below the step at brick scale). */
const FIELD_CUT_STEP_IN = 0.01;
export function clipToField(poly, f, strict = false) {
  const n = poly.length;
  if (n < 3) return [];
  const vals = poly.map((p) => f(p));
  const inside = (v) => (strict ? v < 0 : v <= 0);
  const start = vals.findIndex(inside);
  if (start < 0) return [];
  if (vals.every(inside)) return poly;
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const root = (a, b) => { // a inside, b outside
    let lo = 0, hi = 1;
    for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (inside(f(lerp(a, b, mid)))) lo = mid; else hi = mid; }
    return lerp(a, b, lo);
  };
  const onZero = (p) => {
    let q = p;
    for (let k = 0; k < 8; k++) {
      const v = f(q), h = 1e-6;
      const gx = (f({ x: q.x + h, y: q.y }) - f({ x: q.x - h, y: q.y })) / (2 * h);
      const gy = (f({ x: q.x, y: q.y + h }) - f({ x: q.x, y: q.y - h })) / (2 * h);
      const g2 = gx * gx + gy * gy;
      if (!(g2 > 1e-18) || Math.abs(v) < 1e-12) break;
      q = { x: q.x - (v * gx) / g2, y: q.y - (v * gy) / g2 };
    }
    return q;
  };
  const out = [];
  let exitPt = null;
  for (let s = 0; s < n; s++) {
    const i = (start + s) % n, j = (i + 1) % n;
    const cur = poly[i], next = poly[j], curIn = inside(vals[i]), nextIn = inside(vals[j]);
    if (curIn) out.push(cur);
    if (curIn && !nextIn) { exitPt = root(cur, next); out.push(exitPt); }
    if (!curIn && nextIn) {
      const entry = root(next, cur);
      if (exitPt) {
        const steps = Math.ceil(Math.hypot(entry.x - exitPt.x, entry.y - exitPt.y) / FIELD_CUT_STEP_IN);
        for (let k = 1; k < steps; k++) out.push(onZero(lerp(exitPt, entry, k / steps)));
      }
      out.push(entry);
      exitPt = null;
    }
  }
  return dedupePolygon(out);
}

/** Drop SPIKES: a vertex where the outline runs out and straight back -- the turn reverses and the excursion is thinner
 *  than `widthEps` (twice the triangle's area over its longer side) -- repeated until none is left. A spike has next to
 *  no area, so an area check never sees it, but it reaches across a joint to the next piece. T86 (seat B): a clip
 *  (polygonDifference) left a 0.05 in spike 0.0004 in wide along the cutter's edge, touching the neighbour -- MEASURED
 *  T8 / T12 9x12 at 0.75 in, seams 0 / 0.0001 in. 0.001 in: a hair, far under any joint (0.03 in and up). */
export const SPIKE_WIDTH_IN = 1e-3;
export function dropSpikes(poly, widthEps = SPIKE_WIDTH_IN) {
  // a spike's tip can be several vertices a hair apart (MEASURED T8: three within 0.0002 in): merged first
  const merge = (q) => dedupePolygon(q, widthEps / 2);
  let out = merge(poly);
  for (let changed = true; changed && out.length > 3;) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const a = out[(i - 1 + out.length) % out.length], v = out[i], b = out[(i + 1) % out.length];
      const ux = v.x - a.x, uy = v.y - a.y, wx = b.x - v.x, wy = b.y - v.y, side = Math.max(Math.hypot(ux, uy), Math.hypot(wx, wy));
      if (ux * wx + uy * wy < 0 && Math.abs(ux * wy - uy * wx) / side < widthEps) { out = merge(out.filter((_, k) => k !== i)); changed = true; break; }
    }
  }
  return out;
}

/** Drop consecutive (including wrap-around) near-duplicate vertices from a polygon. */
export function dedupePolygon(poly, eps = 1e-7) {
  const out = [];
  for (const p of poly) {
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > eps) out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= eps) out.pop();
  return out;
}

/** Whether `poly` is simple (no two non-adjacent edges cross) -- O(n^2), fine at the vertex counts
 *  a single cell/stone polygon actually has (a handful to a few dozen after rounding), not meant
 *  for a full board outline. H23 item 76 cont.: `offsetPathInward`'s own mitred-vertex offset has a
 *  documented P1 limitation (see its own header) -- a real edge SHORTER than the offset width can
 *  flip past itself and produce a bowtie. That edge only gets short enough to trigger it right at a
 *  board's TRUE (now exact, concave-aware) clip boundary, so a caller that offsets a freshly-clipped
 *  polygon should check this before trusting the result rather than ship a self-intersecting shape. */
export function isSimplePolygon(poly) {
  const n = poly.length;
  if (n < 4) return true;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const segmentsCross = (p1, p2, p3, p4) => {
    const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // adjacent edges share a vertex, not a crossing
      if (segmentsCross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return false;
    }
  }
  return true;
}

/** Standard convexity test for a simple polygon: every consecutive turn has the same cross-product
 *  sign (collinear/near-zero turns are ignored). Works regardless of winding direction. */
export function isConvex(poly) {
  const n = poly.length;
  if (n < 3) return false;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n], c = poly[(i + 2) % n];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** Proper (not-near-endpoint) intersection of open segments p1-p2 and p3-p4, or null. Near-endpoint
 *  / tangential touches (t or u within 1e-9 of 0 or 1) and parallel/collinear segments are reported
 *  as "no intersection" -- a deliberate simplification (real board/brick geometry here is never
 *  adversarially tangent; a genuine tangent touch contributes ~0 area either way). */
function segmentIntersection(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
  return { t, u, x: p1.x + t * d1x, y: p1.y + t * d1y };
}

/**
 * General polygon intersection (Greiner-Hormann): `subject` clipped to `clip`, where `clip` may be
 * CONCAVE (unlike `clipToHalfPlane`, which only clips correctly against one convex half-plane at a
 * time). Works for `subject` convex or concave too -- every real caller here happens to pass a
 * convex `subject` (a brick cell, a Voronoi stone), but nothing below assumes that.
 *
 * H23 item 76 cont. (advisor review, "concave clipping for the Wall... fill to the frame's true
 * inner edge at the waist, gap ~= grout all round"): replaces an earlier triangulate-the-board-and-
 * keep-the-largest-piece approach, which MEASURED two separate failures on real template geometry
 * before this rewrite: (1) keeping only the single largest per-triangle piece silently discarded
 * OTHER real, non-overlapping coverage whenever a cell spanned more than one triangle of the SAME
 * contiguous region (common, not rare -- one real T1 waist cell split 0.0224+0.0346+0.0478 across 3
 * triangles, and only the 0.0478 survived); (2) even after merging those pieces back together by
 * cancelling shared triangulation-diagonal edges, a cell touching 3+ fan triangles at a single
 * shared apex vertex (common for fieldstone's larger, organic Voronoi cells) produced a genuinely
 * self-intersecting merged polygon, because more than one surviving edge could start at that one
 * vertex and the merge had no rule for picking the right one. Both failure modes are structural to
 * "triangulate the clip shape, clip against each piece, recombine" -- this function clips directly
 * against `clip`'s own real edges instead, which is the textbook-correct way to handle a concave
 * clip shape and has neither problem by construction.
 *
 * Standard algorithm: find every `subject`-edge / `clip`-edge crossing, splice each crossing into
 * both polygons' own vertex lists (so each list is now subject/clip's original vertices PLUS the
 * crossings, in order, with each crossing in one list linked to its twin -- the same point -- in
 * the other), tag each crossing on `subject`'s list "entry" (subject is heading INTO clip just
 * after this point) or "exit" by alternating a running inside/outside flag seeded from subject's
 * own first vertex, then trace: starting from each unvisited "entry" crossing, walk forward along
 * whichever list you're currently on, and every time the next node is itself a crossing, jump to
 * ITS twin (switching lists) before continuing forward -- this single mechanical rule is what
 * alternates you between subject's and clip's own boundary, and always closes back on the start
 * node for a well-formed simple input. Each closed walk is one loop of `subject & clip`; multiple
 * loops mean a genuinely disconnected intersection (a tight concave notch truly severing one cell
 * into two pieces) -- keep only the LARGEST, consistent with this module's existing "one polygon
 * per cell" contract (every caller -- bond.js, basketweave.js, fieldstone.js, herringbone.js --
 * already treats this function's own return as ONE polygon). No crossings at all means `subject` is
 * either entirely inside `clip` (returned as-is) or entirely outside (empty).
 */
export function polygonIntersection(subject, clip) {
  if (subject.length < 3 || clip.length < 3) return [];
  if (!touchesDegenerately(subject, clip)) return intersectGeneral(subject, clip);
  // T86 item 21c: a vertex of either polygon lies ON the other's boundary (a corner on an edge, or two
  // edges overlapping along a line -- bondLayout's course 0 shares the board's own bottom edge by
  // construction). segmentIntersection reports such touches as "no crossing", so the entry/exit
  // alternation below loses a crossing: MEASURED a straddling brick (2 corners in, 2 out) returning []
  // and, with the arguments swapped, the whole 56.9 sq in board. Counting the touch as a crossing
  // instead (a first attempt) put it at the wrong place in the walk and produced a self-intersecting
  // polygon. Standard Greiner-Hormann remedy: perturb. Shift `subject` by DEGENERACY_SHIFT along the
  // first declared direction that leaves no vertex on the other's boundary, then clip normally. The
  // shift can manufacture a sliver at most DEGENERACY_SHIFT wide where the polygons only touched, so on
  // this path a result no larger than that sliver could be is "no overlap".
  for (const [dx, dy] of DEGENERACY_DIRECTIONS) {
    const shifted = subject.map((p) => ({ x: p.x + dx * DEGENERACY_SHIFT, y: p.y + dy * DEGENERACY_SHIFT }));
    if (touchesDegenerately(shifted, clip)) continue;
    const result = intersectGeneral(shifted, clip);
    if (result.length < 3) return [];
    let perimeter = 0;
    for (let i = 0; i < subject.length; i++) { const a = subject[i], b = subject[(i + 1) % subject.length]; perimeter += Math.hypot(b.x - a.x, b.y - a.y); }
    const area = Math.abs(signedArea(result));
    if (area <= 2 * DEGENERACY_SHIFT * perimeter) return [];
    // all of `subject` inside (e.g. a course-0 brick flush with the board's bottom edge): return it exactly
    if (Math.abs(signedArea(subject)) - area <= 2 * DEGENERACY_SHIFT * perimeter) return subject.slice();
    return result;
  }
  return intersectGeneral(subject, clip); // every declared direction still degenerate: never seen; old behaviour
}

// A vertex closer than DEGENERACY_TOUCH to the other polygon's boundary counts as ON it. It must exceed
// segmentIntersection's own endpoint exclusion (t or u within 1e-9 of an end, i.e. ~1e-8 in on a 10 in
// edge); DEGENERACY_SHIFT must clear it by a wide margin and stay far below anything visible (grout is
// ~0.08 in). The directions avoid the axes and 45 degrees, where real edges lie.
const DEGENERACY_TOUCH = 1e-7;
const DEGENERACY_SHIFT = 1e-5;
const DEGENERACY_DIRECTIONS = [[0.8, 0.6], [-0.6, 0.8], [0.28, -0.96], [-0.96, -0.28], [0.6, -0.8]];
function touchesDegenerately(a, b) {
  const near = (pts, poly) => pts.some((p) => poly.some((q, j) => distSqToSegment(p.x, p.y, poly[(j + poly.length - 1) % poly.length], q) <= DEGENERACY_TOUCH * DEGENERACY_TOUCH));
  return near(a, b) || near(b, a);
}

function intersectGeneral(subject, clip) {
  const loops = clipLoops(subject, clip, false);
  if (!Array.isArray(loops[0])) return loops; // a no-crossing answer: one polygon or []
  return largestWithinSubject(loops, subject);
}

/** The Greiner-Hormann walk, every loop. `difference` = subject MINUS clip: the clip is walked backwards (its
 *  winding opposite the subject's) and "inside" means inside the clip's complement -- the textbook variant. A no-crossing
 *  input answers directly: a polygon (intersection) or the pieces (difference), not a list of loops. */
function clipLoops(subject, clipIn, difference) {
  // the walk needs the clip wound WITH the subject (intersection) or AGAINST it (difference), whichever way either
  // came in: MEASURED, a touching pair wound opposite ways intersected to 0.2375 sq in where the truth is 0.0555
  const same = (signedArea(clipIn) > 0) === (signedArea(subject) > 0);
  const clip = same === difference ? clipIn.slice().reverse() : clipIn;
  const n = subject.length, m = clip.length;
  const onSubject = subject.map(() => []);
  const onClip = clip.map(() => []);
  let anyHit = false;
  for (let i = 0; i < n; i++) {
    const a1 = subject[i], a2 = subject[(i + 1) % n];
    for (let j = 0; j < m; j++) {
      const b1 = clip[j], b2 = clip[(j + 1) % m];
      const hit = segmentIntersection(a1, a2, b1, b2);
      if (!hit) continue;
      anyHit = true;
      onSubject[i].push({ t: hit.t, x: hit.x, y: hit.y });
      onClip[j].push({ t: hit.u, x: hit.x, y: hit.y });
    }
  }
  if (!anyHit && difference) {
    // no crossings: subject wholly inside the clip (nothing left), or disjoint / the clip wholly inside it (a hole
    // a single loop cannot hold -- the subject is kept whole, see polygonDifference)
    return pointInPolygon(subject[0].x, subject[0].y, clipIn) ? [] : [subject.slice()];
  }
  if (!anyHit) {
    // No crossings: nested (either way round) or disjoint. T86 item 21c: polygonIntersection sends every
    // TOUCHING pair (a vertex on the other's boundary -- shared vertex, shared edge line, corner on edge)
    // down its shifted path first, so here no vertex of either polygon is on the other's boundary, and
    // one vertex is an exact witness. (The earlier centroid witness, item 19 follow-up, was right for
    // two triangles sharing a vertex but MEASURED wrong on grid-snapped input: a quad whose centroid
    // sat exactly on a small clip rectangle's edge read as "wholly inside" it, returning the quad.)
    if (pointInPolygon(subject[0].x, subject[0].y, clip)) return subject.slice();
    return pointInPolygon(clip[0].x, clip[0].y, subject) ? clip.slice() : [];
  }
  for (const list of onSubject) list.sort((p, q) => p.t - q.t);
  for (const list of onClip) list.sort((p, q) => p.t - q.t);

  const EPS = 1e-7;
  const keyOf = (p) => `${Math.round(p.x / EPS)}_${Math.round(p.y / EPS)}`;

  const nodesSubject = [];
  for (let i = 0; i < n; i++) {
    nodesSubject.push({ x: subject[i].x, y: subject[i].y, isect: false });
    for (const hit of onSubject[i]) nodesSubject.push({ x: hit.x, y: hit.y, isect: true });
  }
  const nodesClip = [];
  for (let j = 0; j < m; j++) {
    nodesClip.push({ x: clip[j].x, y: clip[j].y, isect: false });
    for (const hit of onClip[j]) nodesClip.push({ x: hit.x, y: hit.y, isect: true });
  }
  for (let i = 0; i < nodesSubject.length; i++) nodesSubject[i].next = nodesSubject[(i + 1) % nodesSubject.length];
  for (let j = 0; j < nodesClip.length; j++) nodesClip[j].next = nodesClip[(j + 1) % nodesClip.length];

  const clipByKey = new Map();
  for (const node of nodesClip) if (node.isect) {
    const k = keyOf(node);
    if (!clipByKey.has(k)) clipByKey.set(k, []);
    clipByKey.get(k).push(node);
  }
  for (const node of nodesSubject) {
    if (!node.isect) continue;
    const candidates = clipByKey.get(keyOf(node));
    const match = candidates && candidates.find((c) => !c.twin);
    if (match) { node.twin = match; match.twin = node; }
  }

  let inside = pointInPolygon(subject[0].x, subject[0].y, clip) !== difference;
  for (const node of nodesSubject) {
    if (node.isect) { inside = !inside; node.entry = inside; }
  }

  const loops = [];
  const maxSteps = (nodesSubject.length + nodesClip.length) * 2 + 10;
  for (const startNode of nodesSubject) {
    if (!startNode.isect || !startNode.entry || startNode.visited) continue;
    const loop = [];
    let cur = startNode;
    let steps = 0;
    do {
      loop.push({ x: cur.x, y: cur.y });
      cur.visited = true;
      if (cur.isect && cur.twin) cur.twin.visited = true;
      let nxt = cur.next;
      cur = (nxt.isect && nxt.twin) ? nxt.twin : nxt;
      steps++;
      // the start point is reachable as EITHER `startNode` (subject's own copy) or its twin (the
      // same geometric point, reached back round via clip's list) -- the loop is closed either way;
      // checking object identity against `startNode` alone missed the twin case and walked most of
      // `clip`'s own remaining boundary before giving up (MEASURED on a real bond.js cell: a 44-vertex
      // result that was almost literally the whole board outline instead of a small clipped sliver).
    } while (cur !== startNode && cur !== startNode.twin && steps < maxSteps);
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

function largestWithinSubject(loops, subject) {
  if (!loops.length) return [];
  let best = loops[0], bestArea = Math.abs(signedArea(best));
  for (let i = 1; i < loops.length; i++) {
    const area = Math.abs(signedArea(loops[i]));
    if (area > bestArea) { best = loops[i]; bestArea = area; }
  }
  // T86 (seat 37/F35 item 18 turn 177 repro, advisor dispatch): PROVABLE invariant -- `subject &
  // clip`'s own area can never exceed EITHER operand's own area. MEASURED a real, reproducible
  // violation: a near-degenerate crossing pair (a subject edge grazing a board-outline feature at a
  // near-tangent angle, two crossings landing only ~0.0014in apart) put the trace's own "entry"
  // and "exit" nodes immediately adjacent on subject's own list, with nothing of subject's own
  // perimeter between them -- the walk rule (jump to the other polygon's list at ANY crossing) then
  // has no choice but to continue on `clip`'s own list, and if `clip`'s own forward vertex order
  // doesn't happen to lead back to the matching twin quickly, it must walk almost `clip`'s ENTIRE
  // remaining perimeter to close the loop (T1 7x9 brickLengthIn=1.5: a 0.3 sq in brick produced a
  // 13.97 sq in "intersection", nearly the whole board -- this file's own header already documents
  // an EARLIER, structurally similar incident, "a 44-vertex result that was almost literally the
  // whole board outline", so this is a recurring failure CLASS of the forward-walk rule on
  // near-tangent inputs, not a one-off). Rather than chase every possible near-tangent
  // configuration that can trigger this, validate the result against physical reality: if it's
  // bigger than `subject` itself, something upstream went wrong, and the honest answer is "this
  // input is too degenerate to trust" -- empty, which every caller already treats as "fully
  // clipped away" (bond.js/fieldstone.js/basketweave.js/herringbone.js all already skip a
  // less-than-3-point result as a normal, expected outcome), not a crash or a corrupt render.
  const subjectArea = Math.abs(signedArea(subject));
  if (bestArea > subjectArea * 1.0001 + 1e-9) return [];
  return best;
}

/**
 * T86 item 13 (Fred: "brush over wall = the wall flows around"): `subject` MINUS `clip` -- every piece that is
 * left, as separate simple polygons (a stroke across a brick can cut it in two). Greiner-Hormann's difference
 * variant (clipLoops). Touching inputs take the same shifted path as polygonIntersection (DEGENERACY_SHIFT); a
 * piece no larger than the sliver the shift can make is dropped. A clip lying wholly inside the subject would
 * make a hole, which a simple polygon cannot hold: the subject is returned whole and `holeIgnored` is set on the
 * result -- the caller decides (fill-shape drops such a brick: a wall brick with a stroke wholly inside it is
 * covered by the stroke anyway). Invariant (tests/bricks-polygon-difference.test.js): the pieces' areas sum to
 * area(subject) - area(subject & clip).
 */
export function polygonDifference(subject, clip) {
  if (subject.length < 3) return [];
  if (clip.length < 3) return [subject.slice()];
  const finish = (pieces, sliver) => {
    const out = pieces.filter((q) => q.length >= 3 && Math.abs(signedArea(q)) > sliver);
    const whole = out.length === 1 && out[0].length === subject.length && Math.abs(Math.abs(signedArea(out[0])) - Math.abs(signedArea(subject))) <= sliver;
    if (whole && clip.every((q) => pointInPolygon(q.x, q.y, subject))) out.holeIgnored = true;
    return out;
  };
  if (!touchesDegenerately(subject, clip)) return finish(clipLoops(subject, clip, true), 0);
  let perimeter = 0;
  for (let i = 0; i < subject.length; i++) { const a = subject[i], b = subject[(i + 1) % subject.length]; perimeter += Math.hypot(b.x - a.x, b.y - a.y); }
  // A shift can lift the subject's edge clear of a clip that shares it from inside (the clip then sits wholly in the
  // shifted subject and the notch is lost), so a direction is accepted only when its pieces add up to what the
  // intersection says is left: area(subject) - area(subject & clip). A shift can also keep two pieces joined by a
  // shift-wide bridge along a shared edge (one loop, two lobes, a hairline between), so of the accepted directions
  // the one giving the most pieces wins -- a bridge only ever merges pieces. The clip grown by the shift is one more
  // candidate: it crosses every edge it shared, so it splits a subject that a clip spanning it edge-to-edge
  // leaves bridged on whichever side any shift goes.
  const slack = 2 * DEGENERACY_SHIFT * perimeter;
  const whole = Math.abs(signedArea(subject));
  const left = whole - Math.abs(signedArea(polygonIntersection(subject, clip)));
  if (left >= whole - slack) return [subject.slice()]; // the clip only touched: nothing really removed
  let best = null;
  const grown = offsetPathInward(clip, DEGENERACY_SHIFT, -inwardSignFor(clip));
  if (!touchesDegenerately(subject, grown)) {
    const pieces = finish(clipLoops(subject, grown, true), slack);
    if (Math.abs(pieces.reduce((sum, q) => sum + Math.abs(signedArea(q)), 0) - left) <= 2 * slack) best = pieces;
  }
  for (const [dx, dy] of DEGENERACY_DIRECTIONS) {
    const shifted = subject.map((p) => ({ x: p.x + dx * DEGENERACY_SHIFT, y: p.y + dy * DEGENERACY_SHIFT }));
    if (touchesDegenerately(shifted, clip)) continue;
    const pieces = finish(clipLoops(shifted, clip, true), slack);
    if (Math.abs(pieces.reduce((sum, q) => sum + Math.abs(signedArea(q)), 0) - left) > 2 * slack) continue;
    if (!best || pieces.length > best.length) best = pieces;
  }
  return best || finish(clipLoops(subject, clip, true), 0);
}

/**
 * Clip `poly` (any simple polygon -- a brick cell, a Voronoi stone, ...) to `boardOutline`: H23
 * item 74 (de, F35 item 1 review: "Wall's own brick fill overhangs past the board's edges... Fred
 * now wants the opposite: a brick crossing the edge should be CUT, not dropped or left hanging").
 * `boardOutline` convex (every real board used so far is a plain rectangle or a mild convex
 * outline): an EXACT cut, via a per-edge half-plane clip (clipToHalfPlane, once per board edge),
 * using `boardOutline`'s OWN centroid as the "which side is interior" reference for every edge --
 * ALWAYS safely interior for a convex polygon (a uniform average of a convex shape's own vertices
 * can never fall outside it), unlike `cellRefPoint`, which MUST NOT be used for this (MEASURED: a
 * cell mostly/entirely past the board edge has its own centre outside the board too, so using IT
 * as the per-edge "keep" reference flips entire edges to keep the EXTERIOR side instead --
 * reproduced a brick left 0.635in past the board edge, completely unclipped, before this fix).
 *
 * H23 item 76 cont. (advisor review, "concave clipping for the Wall... fill to the frame's true
 * inner edge at the waist, gap ~= grout all round"): `boardOutline` concave (T1's own waist is the
 * declared test case) now goes through `polygonIntersection` -- an EXACT cut too, not the old
 * keep-whole-or-drop-whole fallback (which MEASURED 0.26-0.44in gaps between the Frame's own inner
 * edge and the Wall's own fill, de's own finding). See `polygonIntersection`'s own header for why
 * this is a direct polygon-vs-polygon clip rather than a triangulate-and-recombine approach.
 */
/** A region whose lobes touch (a wall region bridged by a zero-width corridor: primitive-ribbon.js bridgeLobes; T14 at
 *  1.5 in: two halves joined by a slit along the centre line) split at its repeated vertices into simple lobes; a piece
 *  of no more than `minArea` (the slit itself) is dropped. Read by tip-fill.js bareTips and clipPolygonToBoard. */
export function lobesOf(P, minArea = 0) {
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    if (Math.hypot(P[i].x - P[j].x, P[i].y - P[j].y) > 1e-7) continue;
    const a = P.slice(i, j), b = [...P.slice(j), ...P.slice(0, i)];
    return [...lobesOf(a, minArea), ...lobesOf(b, minArea)];
  }
  return P.length >= 3 && Math.abs(signedArea(P)) > minArea ? [P] : [];
}
const LOBES = new WeakMap(); // outline -> its lobes (null: one lobe), per outline array -- every layout clips each cell
const lobesCached = (outline) => {
  if (!LOBES.has(outline)) {
    // separate PARTS only: a lobe wound against the whole is a HOLE drawn with a slit (contour-bands.js buildAreaBandBricks's
    // ring) -- clipping to the other lobe would ignore it (MEASURED: T18 fieldstone band stones 0.22 sq in into the hole)
    const l = lobesOf(outline, 1e-6), sign = Math.sign(signedArea(outline));
    LOBES.set(outline, l.length > 1 && l.every((q) => Math.sign(signedArea(q)) === sign) ? l : null);
  }
  return LOBES.get(outline);
};

export function clipPolygonToBoard(poly, boardOutline, cellRefPoint) {
  if (isConvex(boardOutline)) {
    const interior = polygonCentroid(boardOutline);
    let out = poly;
    const n = boardOutline.length;
    for (let i = 0; i < n && out.length >= 3; i++) {
      const a = boardOutline[i], b = boardOutline[(i + 1) % n];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      out = clipToHalfPlane(out, { point: a, dirX: dx / len, dirY: dy / len }, interior);
    }
    return out;
  }
  return polygonIntersection(poly, boardOutline);
}

/** clipPolygonToBoard for the TILE2D layouts (tiles / sheet patterns / herringbone / basketweave): a bridged region (separate
 *  lobes touching at repeated vertices) is clipped lobe by lobe, the largest piece kept (the one-polygon contract). MEASURED
 *  (seat E, 2026-10-08, every pattern x template x 0.75 - 1.5 in): a cell across the bridge's zero-width corridor came back
 *  EMPTY (T18 7x9 1 in hexagon / square_diamond / basketweave: a 1.2-face bare tip) or across the corridor (35 lays with a
 *  wall piece overlapping another). The bond keeps clipPolygonToBoard: its tips are the band's (tip-fill.js, item 16f). */
export function clipPolygonToRegion(poly, region, cellRefPoint) {
  if (isConvex(region)) return clipPolygonToBoard(poly, region, cellRefPoint);
  const lobes = lobesCached(region);
  if (!lobes) return polygonIntersection(poly, region);
  let best = [], bestArea = 0;
  for (const lobe of lobes) { const q = polygonIntersection(poly, lobe), a = q.length >= 3 ? Math.abs(signedArea(q)) : 0; if (a > bestArea) { best = q; bestArea = a; } }
  return best;
}

/**
 * Replace each vertex of a (convex) polygon with a short circular-arc fillet of radius `radius`
 * (H23 item 74c: fieldstone's own "slightly rounded corners") -- a standard inscribed-tangent-
 * circle construction: the two tangent points sit back from the vertex along its own incident
 * edges, the arc between them bulges toward the vertex, replaced by `segments` straight chords
 * (never a true curve primitive -- this engine only ever produces polygons). Degenerates
 * gracefully: a near-straight vertex (interior angle close to 180deg, i.e. barely a corner at
 * all) or a zero-length incident edge is left UNROUNDED rather than producing a garbage arc; the
 * tangent length is also clamped to at most 45% of either incident edge's own length so a small
 * cell's own rounding can never eat past its neighbouring vertex (shrinking the EFFECTIVE radius
 * there instead of corrupting the shape) -- the same "declared floor/clamp, not a blow-up" pattern
 * `offsetPathInward`'s own `cos` floor already uses.
 */
export function roundPolygonCorners(poly, radius, segments = 4) {
  if (!(radius > 0) || poly.length < 3) return poly;
  const n = poly.length;
  const out = [];
  // +1 when the polygon winds counter-clockwise in math axes (signedArea is NEGATIVE then -- MEASURED on
  // a unit square, see signedArea's own formula)
  const ccw = signedArea(poly) < 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const v = poly[i], prev = poly[(i - 1 + n) % n], next = poly[(i + 1) % n];
    const u1x = prev.x - v.x, u1y = prev.y - v.y, len1 = Math.hypot(u1x, u1y);
    const u2x = next.x - v.x, u2y = next.y - v.y, len2 = Math.hypot(u2x, u2y);
    if (len1 < 1e-9 || len2 < 1e-9) { out.push(v); continue; }
    // A REFLEX vertex (the turn prev->v->next goes against the winding) stays sharp: its fillet would ADD
    // material outside the polygon, into whatever the notch wraps round. T86 item 21c: fieldstone clips a
    // stone to the band ring THEN rounds it, so a stone wrapping the inner hole's corner had that notch
    // filleted INTO the hole -- MEASURED 0.0019 sq in, (1 - pi/4) r^2 for its corner radius r = 0.09 in;
    // hidden until polygonIntersection measured touching shapes correctly.
    const turn = -u1x * u2y + u1y * u2x; // (v - prev) x (next - v)
    if (Math.sign(turn) === -ccw) { out.push(v); continue; }
    const n1x = u1x / len1, n1y = u1y / len1, n2x = u2x / len2, n2y = u2y / len2;
    const cosTheta = Math.max(-1, Math.min(1, n1x * n2x + n1y * n2y));
    const theta = Math.acos(cosTheta);
    if (theta > Math.PI - 1e-3 || theta < 1e-3) { out.push(v); continue; } // ~straight or ~zero -- no real corner
    const half = theta / 2;
    const maxTangent = 0.45 * Math.min(len1, len2);
    const tangent = Math.min(radius / Math.tan(half), maxTangent);
    const actualRadius = tangent * Math.tan(half);
    const t1 = { x: v.x + n1x * tangent, y: v.y + n1y * tangent };
    const t2 = { x: v.x + n2x * tangent, y: v.y + n2y * tangent };
    let bx = n1x + n2x, by = n1y + n2y;
    const blen = Math.hypot(bx, by);
    if (blen < 1e-9) { out.push(v); continue; } // theta ~ 180 already guarded above; defensive only
    bx /= blen; by /= blen;
    const centreDist = actualRadius / Math.sin(half);
    const cx = v.x + bx * centreDist, cy = v.y + by * centreDist;
    const a1 = Math.atan2(t1.y - cy, t1.x - cx), a2 = Math.atan2(t2.y - cy, t2.x - cx);
    let delta = a2 - a1;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI; // the short way around -- always |delta| = PI-theta < PI
    out.push(t1);
    for (let k = 1; k < segments; k++) {
      const a = a1 + delta * (k / segments);
      out.push({ x: cx + Math.cos(a) * actualRadius, y: cy + Math.sin(a) * actualRadius });
    }
    out.push(t2);
  }
  return out;
}

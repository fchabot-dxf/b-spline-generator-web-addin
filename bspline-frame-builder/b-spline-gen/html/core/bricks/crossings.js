/**
 * core/bricks/crossings.js — PORTABLE (see rng.js). T86 item 5 (Fred: "when it crosses another line, should conform,
 * straight cut, not mitre"; his picks on the crossing mock, 2026-10-07): where a brick stroke meets another stroke or the
 * frame, ONE of them runs through and the other is cut STRAIGHT along the through one's edge, a joint off it -- at a
 * 45 deg crossing the cut follows the edge (not square to the cut stroke, not a mitre). A stroke's own corners stay
 * mitred; only the crossing joint is a straight cut.
 *
 * Who runs through is DECLARED (CROSSING_RULE), never inferred per shape:
 *  - the frame always runs through (a stroke never cuts the frame);
 *  - a stroke that ENDS at a junction stops against the other one, whatever the order (a T, an end-touch: Fred's 5b);
 *  - at an X, the EARLIER stroke runs through (creation order = the strokes' document order).
 *
 * The cut stroke's path is split where it enters and leaves the through region; each free part is laid as its own open
 * ribbon whose end is a CUT JOINT on the region's edge (contour-bands opts.cutEnds), so the run is re-planned from the
 * fill set like any corner -- no clipped sliver.
 */
import { pointInPolygon, offsetPathInward, inwardSignFor, signedArea } from './geometry.js';

export const CROSSING_RULE = Object.freeze({ frameRunsThrough: true, endingStrokeStops: true, atAnX: 'earlier' });
/** A free part of a cut stroke shorter than this share of a brick length is not laid (it would be one sliver). */
export const MIN_PART_OF_BRICK = 0.25;
/** A part runs past its cut by (half its width) / tan(the crossing angle), so both its edges reach the cut line; at a
 *  near-parallel crossing that reach is capped at this many half-widths. */
const MAX_REACH_HALF_WIDTHS = 4;
const EPS = 1e-9;

const areaOf = (p) => (p && p.length >= 3 ? Math.abs(signedArea(p)) : 0);
const grow = (poly, d) => offsetPathInward(poly, d, -inwardSignFor(poly));

/** The polygon `poly` grown by a joint: the region a cut keeps clear of (its edge is the cut line). */
/** A ribbon outline traces its pieces and comes back along itself in places (MEASURED: 96 vertices on a straight stroke, many
 *  collinear or doubling back); a mitred offset turns each such vertex into a spike (the grown edge zig-zagged 0.14 in).
 *  So the outline is first reduced to its turning vertices: one whose neighbours are in line with it (within
 *  SIMPLIFY_SIN of a straight line or a straight reversal) goes, until none does. */
const SIMPLIFY_SIN = 1e-3;
export function simplifyOutline(poly) {
  let P = poly.filter((p, i) => Math.hypot(p.x - poly[(i + 1) % poly.length].x, p.y - poly[(i + 1) % poly.length].y) > EPS);
  for (let changed = true; changed && P.length > 3;) {
    changed = false;
    for (let i = 0; i < P.length && P.length > 3; i++) {
      const a = P[(i - 1 + P.length) % P.length], b = P[i], c = P[(i + 1) % P.length];
      const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y, lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
      if (lu < EPS || lv < EPS || Math.abs(ux * vy - uy * vx) / (lu * lv) < SIMPLIFY_SIN) { P.splice(i, 1); changed = true; i--; }
    }
  }
  return P;
}
export const throughRegion = (poly, joint) => grow(simplifyOutline(poly), joint);

function segDist(p, a, b) {
  const ex = b.x - a.x, ey = b.y - a.y, l = ex * ex + ey * ey || EPS, t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l));
  return Math.hypot(a.x + t * ex - p.x, a.y + t * ey - p.y);
}
const near = (p, poly, d) => pointInPolygon(p.x, p.y, poly) || poly.some((a, i) => segDist(p, a, poly[(i + 1) % poly.length]) <= d);

/**
 * Per stroke, the strokes it is CUT by (CROSSING_RULE). `strokes`: in creation order, each { points (its centreline),
 * regions (the polygons it covers: a brick stroke's ribbon outline; a Continuous run's pieces) } -- or { outline } for one
 * polygon. A pair whose regions do not meet (a joint apart) has no junction.
 * @returns {number[][]} cutBy[i] = indices of the strokes stroke i is cut against
 */
export function strokeCrossings(strokes, joint) {
  const n = strokes.length, cutBy = strokes.map(() => []);
  const ends = (s) => [s.points[0], s.points[s.points.length - 1]];
  // edges within a joint (crossing edges are 0 apart) or one inside the other -- MEASURED: two 4-vertex outlines in an X
  // have no vertex inside each other, so a vertex test alone missed every plain X
  const regionsOf = (s) => (s.regions || (s.outline ? [s.outline] : [])).filter((r) => r && r.length >= 3);
  const polysMeet = (A, B) => outlinesWithin(A, B, joint) || near(A[0], B, joint) || near(B[0], A, joint);
  const meets = (a, b) => regionsOf(a).some((A) => regionsOf(b).some((B) => polysMeet(A, B)));
  const endsOn = (s, t) => ends(s).some((p) => regionsOf(t).some((R) => near(p, R, joint)));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = strokes[i], b = strokes[j];
    if (!meets(a, b)) continue;
    const bEndsOnA = endsOn(b, a), aEndsOnB = endsOn(a, b);
    if (CROSSING_RULE.endingStrokeStops && aEndsOnB && !bEndsOnA) cutBy[i].push(j); // the earlier one ends on the later: it stops
    else cutBy[j].push(i); // a T (the later ends on the earlier), an X, or both ending at each other: the earlier runs through
  }
  return cutBy;
}

/** Whether two closed outlines come within `d` of each other along their edges (a crossing is 0 apart). */
function outlinesWithin(A, B, d) {
  for (let i = 0; i < A.length; i++) for (let k = 0; k < B.length; k++) {
    const a = A[i], b = A[(i + 1) % A.length], c = B[k], e = B[(k + 1) % B.length];
    if (segSeg(a, b, c, e) || segDist(a, c, e) <= d || segDist(b, c, e) <= d || segDist(c, a, b) <= d || segDist(e, a, b) <= d) return true;
  }
  return false;
}

/** The point where segment a-b meets segment c-d: { t along a-b, u along c-d } or null. */
function segSeg(a, b, c, d) {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y, den = rx * sy - ry * sx;
  if (Math.abs(den) < EPS) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den, u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null;
}

/** The polyline's point and tangent at arc length s (clamped). */
function along(points, cum, s) {
  const total = cum[cum.length - 1], v = Math.max(0, Math.min(total, s));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < v) i++;
  const a = points[i - 1], b = points[i], l = cum[i] - cum[i - 1] || EPS, f = (v - cum[i - 1]) / l;
  return { p: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, t: { x: (b.x - a.x) / l, y: (b.y - a.y) / l } };
}
/** The sub-polyline between arc lengths s0 < s1, keeping no vertex within `clear0` of s0 or `clear1` of s1: the run ends in
 *  ONE straight primitive across a cut's whole reach, so the cut joint clips every piece that crosses it (MEASURED: with
 *  the stroke's own sample points kept, the last primitive was only the tip, and the piece before it crossed the cut). */
function slice(points, cum, s0, s1, clear0 = 0, clear1 = 0) {
  const out = [along(points, cum, s0).p];
  for (let i = 1; i < points.length - 1; i++) if (cum[i] > s0 + clear0 + EPS && cum[i] < s1 - clear1 - EPS) out.push(points[i]);
  out.push(along(points, cum, s1).p);
  return out;
}

/**
 * The free parts of a stroke's centreline once it keeps clear of `regions` (each already grown by its joint: the cut
 * line is its edge). Each part: { points, start, end } -- `start` / `end` a CUT { point, dirX, dirY } (the region edge
 * the part stops on) or null at the stroke's own open end. A part runs past its cut far enough for both its edges to
 * reach the cut line (the ribbon's cut joint trims it). Parts shorter than MIN_PART_OF_BRICK of a brick are not laid.
 * @param {{x:number,y:number}[]} points the stroke's centreline
 * @param {Array<{x:number,y:number}[]>} regions the through regions
 * @param {{ halfWidth: number, brickLengthIn: number }} dims
 */
export function splitAtCrossings(points, regions, dims) {
  const live = regions.filter((r) => r && r.length >= 3 && areaOf(r) > EPS);
  if (!live.length || points.length < 2) return [{ points, start: null, end: null }];
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const total = cum[cum.length - 1];
  // every place the stroke's CENTRELINE or either of its EDGES (offset by halfWidth) crosses a region's edge: its arc length
  // and that edge -- MEASURED (the gate's strokes run, a Grey stone frame): a stroke's side met one stone before its
  // centreline entered another; cut on the centreline's stone, the end piece overlapped the first and was dropped (a 1 in gap)
  const h = dims.halfWidth, offsets = [0, h, -h];
  const at = (i, side) => { const a = points[i - 1], b = points[i], l = Math.hypot(b.x - a.x, b.y - a.y) || EPS, nx = -(b.y - a.y) / l, ny = (b.x - a.x) / l; return [{ x: a.x + nx * side, y: a.y + ny * side }, { x: b.x + nx * side, y: b.y + ny * side }]; };
  const events = [];
  for (let i = 1; i < points.length; i++) for (const side of offsets) {
    const [a, b] = at(i, side);
    for (const r of live) for (let k = 0; k < r.length; k++) {
      const c = r[k], d = r[(k + 1) % r.length], x = segSeg(a, b, c, d);
      if (x) events.push({ s: cum[i - 1] + x.t * (cum[i] - cum[i - 1]), edge: [c, d] });
    }
  }
  const inAny = (p) => live.some((r) => pointInPolygon(p.x, p.y, r));
  const blocked = (s) => { const { p, t } = along(points, cum, s); return offsets.some((side) => inAny({ x: p.x - t.y * side, y: p.y + t.x * side })); };
  if (!events.length && !blocked(0)) return [{ points, start: null, end: null }];
  events.sort((a, b) => a.s - b.s);
  const cuts = [{ s: 0, edge: null }, ...events, { s: total, edge: null }];
  const parts = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const a = cuts[k], b = cuts[k + 1];
    if (b.s - a.s < MIN_PART_OF_BRICK * dims.brickLengthIn || blocked((a.s + b.s) / 2)) continue;
    const cutAt = (ev, sign) => {
      if (!ev.edge) return { cut: null, reach: 0 };
      const [c, d] = ev.edge, el = Math.hypot(d.x - c.x, d.y - c.y) || EPS, dir = { x: (d.x - c.x) / el, y: (d.y - c.y) / el };
      const { t } = along(points, cum, ev.s), sin = Math.abs(t.x * dir.y - t.y * dir.x), cos = Math.abs(t.x * dir.x + t.y * dir.y);
      // the event may be either edge's contact: the far edge reaches the cut line a full width later
      const reach = Math.min(MAX_REACH_HALF_WIDTHS * h, (2 * h * cos) / Math.max(sin, EPS)) + h * 0.05;
      return { cut: { point: c, dirX: dir.x, dirY: dir.y }, reach: sign * reach }; // the cut line IS the edge hit
    };
    const s = cutAt(a, -1), e = cutAt(b, 1);
    const clear = (r) => (r ? 2 * Math.abs(r) + dims.halfWidth : 0);
    parts.push({ points: slice(points, cum, Math.max(0, a.s + s.reach), Math.min(total, b.s + e.reach), clear(s.reach), clear(e.reach)), start: s.cut, end: e.cut });
  }
  return parts;
}

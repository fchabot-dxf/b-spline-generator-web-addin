/**
 * core/bricks/region.js -- T86 item 18 (Fred: "once any area is painted, ONLY the painted areas get bricks"): turn
 * area-brush strokes into the wall's region. Portable (no DOM), board inches.
 *
 * strokesToRegion(strokes, minus, opts) -> { polygons: [{ outer, holes }] }
 *   strokes: [{ points: [{x,y}...], widthIn }]  -- the painted area (a polyline swept by a round brush of widthIn)
 *   minus:   the same shape -- each NEWER area's strokes (newest wins: an older wall flows around a newer one)
 *   opts.gapIn: the minus grows by this (one grout width from the caller), so two areas' bricks never butt
 *
 * The region is the zero contour of a distance field: inside = within widthIn/2 of a stroke AND farther than
 * widthIn/2 + gapIn from every minus stroke. Marching squares with linear interpolation on a grid of REGION_GRID_IN
 * (finer for thin strokes) traces it, so any union -- overlapping strokes, a stroke crossing itself, a closed ring
 * with its hole -- comes out as simple loops: outers counter-clockwise (x right, y up), holes clockwise.
 */
import { signedArea, pointInPolygon } from './geometry.js';

/** T86 item 18b (Fred: "a brush that draws is fine but I'd prefer it drew complete bricks"): how the wall meets a
 *  region. 'centroid' = a brick is laid WHOLE when its centroid lies inside the region, nothing is cut at the region's
 *  edge (the board outline, frame bands and exclusions still clip as before), and newest-wins partitions bricks by
 *  centroid (the minus is not grown, so every brick belongs to exactly one area). 'clip' = item 18's first form,
 *  cells cut at the region edge and the minus grown by a grout. */
export const WALL_REGION_PICK = 'centroid';

export const REGION_GRID_IN = 0.04; // grid step; a straight edge is exact, a round cap's chords sag < 0.001 in
const REGION_MAX_NODES = 600000; // a huge region coarsens the grid instead of stalling the lay
const REGION_SIMPLIFY_IN = 0.002; // collinear runs merged (RDP)

function segDist(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}
/** the strokes as capsules: [{a, b, r, x0, y0, x1, y1}] (a one-point stroke = a disc) */
function capsules(strokes, grow) {
  const out = [];
  for (const s of strokes || []) {
    const pts = (s && s.points) || [], r = (Number(s && s.widthIn) || 0) / 2 + grow;
    if (!pts.length || r <= 0) continue;
    const segs = pts.length === 1 ? [[pts[0], pts[0]]] : pts.slice(1).map((p, i) => [pts[i], p]);
    for (const [a, b] of segs) out.push({ a, b, r, x0: Math.min(a.x, b.x) - r, y0: Math.min(a.y, b.y) - r, x1: Math.max(a.x, b.x) + r, y1: Math.max(a.y, b.y) + r });
  }
  return out;
}
function rdp(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let best = -1, bd = tol;
    for (let k = i + 1; k < j; k++) { const d = segDist(pts[k].x, pts[k].y, pts[i], pts[j]); if (d > bd) { bd = d; best = k; } }
    if (best >= 0) { keep[best] = 1; stack.push([i, best], [best, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}

export function strokesToRegion(strokes, minus = [], opts = {}) {
  const add = capsules(strokes, 0), cut = capsules(minus, opts.gapIn || 0);
  if (!add.length) return { polygons: [] };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, rMin = Infinity;
  for (const c of add) { x0 = Math.min(x0, c.x0); y0 = Math.min(y0, c.y0); x1 = Math.max(x1, c.x1); y1 = Math.max(y1, c.y1); rMin = Math.min(rMin, c.r); }
  let h = Math.min(REGION_GRID_IN, rMin / 3);
  while (((x1 - x0) / h + 3) * ((y1 - y0) / h + 3) > REGION_MAX_NODES) h *= 1.25;
  x0 -= 2 * h; y0 -= 2 * h; x1 += 2 * h; y1 += 2 * h;
  const nx = Math.ceil((x1 - x0) / h) + 1, ny = Math.ceil((y1 - y0) / h) + 1;
  // the field: < 0 inside. Each capsule only touches the nodes under its own box.
  const fAdd = new Float64Array(nx * ny).fill(Infinity), fCut = new Float64Array(nx * ny).fill(Infinity);
  const splat = (list, f) => {
    for (const c of list) {
      const i0 = Math.max(0, Math.floor((c.x0 - x0) / h) - 1), i1 = Math.min(nx - 1, Math.ceil((c.x1 - x0) / h) + 1);
      const j0 = Math.max(0, Math.floor((c.y0 - y0) / h) - 1), j1 = Math.min(ny - 1, Math.ceil((c.y1 - y0) / h) + 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const v = segDist(x0 + i * h, y0 + j * h, c.a, c.b) - c.r, k = j * nx + i;
        if (v < f[k]) f[k] = v;
      }
    }
  };
  splat(add, fAdd); splat(cut, fCut);
  const F = new Float64Array(nx * ny);
  for (let k = 0; k < F.length; k++) { const a = Math.min(fAdd[k], 4 * h), m = Math.min(fCut[k], 4 * h); F[k] = Math.max(a, -m); if (F[k] === 0) F[k] = 1e-12; }
  const at = (i, j) => F[j * nx + i];
  const X = (i) => x0 + i * h, Y = (j) => y0 + j * h;
  // crossings live on grid edges: 'h' edge (i,j)-(i+1,j), 'v' edge (i,j)-(i,j+1)
  const point = new Map();
  const cross = (key, ax, ay, fa, bx, by, fb) => {
    if (!point.has(key)) { const t = fa / (fa - fb); point.set(key, { x: ax + t * (bx - ax), y: ay + t * (by - ay) }); }
    return key;
  };
  const next = new Map(); // segment start edge -> end edge, inside on the left
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const c = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]; // a b c d, counter-clockwise
    const inside = c.map((v) => v < 0);
    if (inside.every(Boolean) || !inside.some(Boolean)) continue;
    const corner = [[X(i), Y(j)], [X(i + 1), Y(j)], [X(i + 1), Y(j + 1)], [X(i), Y(j + 1)]];
    const edgeKey = [`h${i},${j}`, `v${i + 1},${j}`, `h${i},${j + 1}`, `v${i},${j}`];
    const xs = []; // crossings in counter-clockwise order round the cell: { key, exit }
    for (let e = 0; e < 4; e++) {
      const p = e, q = (e + 1) % 4;
      if (inside[p] === inside[q]) continue;
      // edges b->c and c->d / d->a run against their key's own direction: interpolate from the key's own start
      const [s, t] = e < 2 ? [p, q] : [q, p];
      xs.push({ key: cross(edgeKey[e], corner[s][0], corner[s][1], c[s], corner[t][0], corner[t][1], c[t]), exit: inside[p] });
    }
    const centreIn = (c[0] + c[1] + c[2] + c[3]) / 4 < 0;
    for (let k = 0; k < xs.length; k++) {
      if (!xs[k].exit) continue;
      // an exit joins the entry before it (cutting off an inside corner) -- or, in a saddle whose centre is inside,
      // the entry after it (cutting off an outside corner)
      const step = xs.length === 4 && centreIn ? 1 : -1;
      const entry = xs[(k + step + xs.length) % xs.length];
      next.set(xs[k].key, entry.key);
    }
  }
  // chain the segments into loops
  const loops = [];
  const used = new Set();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop = [];
    let k = start;
    while (k != null && !used.has(k)) { used.add(k); loop.push(point.get(k)); k = next.get(k); }
    if (loop.length >= 3) loops.push(rdp([...loop, loop[0]], REGION_SIMPLIFY_IN).slice(0, -1));
  }
  // signedArea is negative for a counter-clockwise loop (geometry.js): outers are counter-clockwise here
  const outers = loops.filter((l) => signedArea(l) < 0).map((outer) => ({ outer, holes: [] }));
  for (const hole of loops.filter((l) => signedArea(l) > 0)) {
    const host = outers.filter((o) => pointInPolygon(hole[0].x, hole[0].y, o.outer)).sort((a, b) => Math.abs(signedArea(a.outer)) - Math.abs(signedArea(b.outer)))[0];
    if (host) host.holes.push(hole);
  }
  return { polygons: outers };
}

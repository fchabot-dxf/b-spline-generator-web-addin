/**
 * frame-mesh.js — FB-APP S3 (F7), design §3.4: the 3D preview trims the
 * carved panel to the frame's cut profile and shows the frame bars in wood.
 *
 * ONE outline source: the spec is built by editor-frame-profile.js from the
 * generated frame definition (the same one the editor profile and the Fusion
 * build read). Everything here is plain geometry on flat arrays (testable
 * without WebGL); the THREE wrappers at the bottom only wrap those arrays.
 *
 * World mapping (MEASURED, drape-svg.js DRAPE_TEXTURE_FLIPY): editor/SVG
 * (x, y-down from the top) -> world (x - W/2, H/2 - y), z up.
 *
 * Trim (exact since F8): panel triangles wholly inside the outline stay in the
 * panel index (the drape overlay shares that geometry, so it is trimmed too);
 * the triangles the outline crosses are clipped to it into a separate rim mesh
 * (every attribute interpolated), so the panel ends exactly on the outline.
 * A wall runs along the outline from the underside to the top, in the
 * panel's own colours (as the panel's own side walls are).
 * Bars: the ring between the outline and the frame's inner edge, as a quad
 * strip between CORRESPONDING samples of the two (same primitive topology,
 * same fractions), extruded straight (no taper) from frame-bottom z up to the
 * panel underside. The corner correspondences are the miter lines.
 * Heights (F8 BLOCKER) come from the DRAWN panel triangles (panelSurface),
 * never from the grid arrays: the thickened underside is offset along the
 * surface normal, so its vertices are not on the x,y grid.
 */
import { FRAME_COLORS } from '../color-utils.js';
import { rectContains, rectToPrimitives } from '../inset-window.js';

/** Sample a closed primitive loop (editor coords) at fixed fractions per
 *  primitive, so two loops of the same topology correspond point-for-point. */
export function sampleOutline(primitives, arcSteps = 12) {
  const pts = [];
  for (const p of primitives) {
    if (p.type === 'L') { pts.push({ x: p.p0.x, y: p.p0.y }); continue; }
    for (let k = 0; k < arcSteps; k++) {
      const th = p.theta1 + (p.dTheta * k) / arcSteps;
      pts.push({ x: p.cx + p.rx * Math.cos(th), y: p.cy + p.ry * Math.sin(th) });
    }
  }
  return pts;
}

const _primLength = (p) => (p.type === 'L'
  ? Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y)
  : Math.abs(p.dTheta) * p.rx);
const _primPoint = (p, t) => (p.type === 'L'
  ? { x: p.p0.x + (p.p1.x - p.p0.x) * t, y: p.p0.y + (p.p1.y - p.p0.y) * t }
  : { x: p.cx + p.rx * Math.cos(p.theta1 + p.dTheta * t), y: p.cy + p.ry * Math.sin(p.theta1 + p.dTheta * t) });

/**
 * F7 AMEND (Fred: the bar top must meet the SCULPTED underside): sample two
 * loops of the same topology with the SAME number of steps per primitive pair,
 * each step no longer than `maxStep` (the terrain cell), so a bar top vertex
 * exists at least every cell along the ring and can follow the underside.
 */
export function samplePairedOutlines(outerPrims, innerPrims, maxStep) {
  if (outerPrims.length !== innerPrims.length) throw new Error('samplePairedOutlines: topologies differ');
  const outer = [], inner = [];
  outerPrims.forEach((po, i) => {
    const pi = innerPrims[i];
    const n = Math.max(1, Math.ceil(Math.max(_primLength(po), _primLength(pi)) / maxStep));
    for (let k = 0; k < n; k++) { outer.push(_primPoint(po, k / n)); inner.push(_primPoint(pi, k / n)); }
  });
  return { outer, inner };
}

export const toWorld = (pts, W, H) => pts.map((p) => ({ x: p.x - W / 2, y: H / 2 - p.y }));

export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** pointInPolygon for MANY points against one polygon -- the same answer, measured byte-identical (frame-clip-identical
 *  test): an edge toggles only when min(a.y, b.y) <= y < max(a.y, b.y), so each y-band lists every edge that can
 *  toggle there, and the per-edge test is the same expression (parity does not depend on order). The clip's slowest
 *  step was this test against the whole outline for every panel vertex. */
export function polygonPointTester(poly) {
  const n = poly.length;
  let y0 = Infinity, y1 = -Infinity;
  for (const p of poly) { if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  const bands = Math.max(1, Math.ceil(n / 4)), h = (y1 - y0) / bands || 1;
  const band = (y) => Math.min(bands - 1, Math.max(0, Math.floor((y - y0) / h)));
  const lists = Array.from({ length: bands }, () => []);
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const lo = Math.min(poly[i].y, poly[j].y), hi = Math.max(poly[i].y, poly[j].y);
    for (let k = band(lo); k <= band(hi); k++) lists[k].push(i, j);
  }
  return (x, y) => {
    if (!(y >= y0 && y < y1)) return false; // no edge can straddle y
    const l = lists[band(y)];
    let inside = false;
    for (let m = 0; m < l.length; m += 2) {
      const a = poly[l[m]], b = poly[l[m + 1]];
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  };
}

/**
 * The DRAWN panel surface at (x, y): every panel triangle above/below that
 * point (bucketed by grid cell), `lo` = the lowest (the underside, or the
 * panel's slanted side wall where the offset underside pulled in), `hi` = the
 * highest (the top). Each hit carries its triangle and barycentric weights so
 * any attribute can be read at that point (lerpAttr). Zero-area (vertical)
 * triangles have no height at a point and are skipped.
 */
export function panelSurface(positions, index, W, H, nx, nz) {
  const cw = W / Math.max(1, nx - 1), ch = H / Math.max(1, nz - 1);
  const ci = (x) => Math.floor((x + W / 2) / cw), cj = (y) => Math.floor((y + H / 2) / ch);
  const P = positions, E = 1e-9, nt = index.length / 3;
  // each triangle's cell box, then the cells' triangle lists as one flat array (count, then fill in triangle order)
  const box = new Int32Array(nt * 4);
  let gi0 = Infinity, gi1 = -Infinity, gj0 = Infinity, gj1 = -Infinity;
  for (let f = 0, t = 0; f < nt; f++, t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const i0 = ci(Math.min(P[a], P[b], P[c]) - E), i1 = ci(Math.max(P[a], P[b], P[c]) + E);
    const j0 = cj(Math.min(P[a + 1], P[b + 1], P[c + 1]) - E), j1 = cj(Math.max(P[a + 1], P[b + 1], P[c + 1]) + E);
    box[4 * f] = i0; box[4 * f + 1] = i1; box[4 * f + 2] = j0; box[4 * f + 3] = j1;
    if (i0 < gi0) gi0 = i0; if (i1 > gi1) gi1 = i1; if (j0 < gj0) gj0 = j0; if (j1 > gj1) gj1 = j1;
  }
  const gw = nt ? gi1 - gi0 + 1 : 0, gh = nt ? gj1 - gj0 + 1 : 0;
  const start = new Int32Array(gw * gh + 1);
  for (let f = 0; f < nt; f++) for (let i = box[4 * f]; i <= box[4 * f + 1]; i++) for (let j = box[4 * f + 2]; j <= box[4 * f + 3]; j++) start[(i - gi0) * gh + (j - gj0) + 1]++;
  for (let k = 0; k < gw * gh; k++) start[k + 1] += start[k];
  const fill = start.slice(0, gw * gh), tris = new Int32Array(start[gw * gh]);
  for (let f = 0; f < nt; f++) for (let i = box[4 * f]; i <= box[4 * f + 1]; i++) for (let j = box[4 * f + 2]; j <= box[4 * f + 3]; j++) tris[fill[(i - gi0) * gh + (j - gj0)]++] = 3 * f;
  return {
    at(x, y) {
      let lo = null, hi = null;
      const i = ci(x) - gi0, j = cj(y) - gj0;
      if (!(i >= 0 && i < gw && j >= 0 && j < gh)) return null;
      for (let r = start[i * gh + j], r1 = start[i * gh + j + 1]; r < r1; r++) {
        const t = tris[r];
        const h = baryHit(P, index, t, x, y);
        if (!h) continue;
        if (!lo || h.z < lo.z) lo = h;
        if (!hi || h.z > hi.z) hi = h;
      }
      return lo ? { lo, hi } : null;
    },
  };
}

/** Barycentric hit of triangle `t` (offset into `index`) at (x, y), with its z; null if outside or zero-area. */
export function baryHit(P, index, t, x, y, tol = 1e-7) {
  const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
  const d = (P[b + 1] - P[c + 1]) * (P[a] - P[c]) + (P[c] - P[b]) * (P[a + 1] - P[c + 1]);
  if (Math.abs(d) < 1e-14) return null;
  const u = ((P[b + 1] - P[c + 1]) * (x - P[c]) + (P[c] - P[b]) * (y - P[c + 1])) / d;
  const v = ((P[c + 1] - P[a + 1]) * (x - P[c]) + (P[a] - P[c]) * (y - P[c + 1])) / d;
  const w = 1 - u - v;
  if (u < -tol || v < -tol || w < -tol) return null;
  return { t, u, v, w, z: u * P[a + 2] + v * P[b + 2] + w * P[c + 2] };
}

/** Attribute `arr` (itemSize n) of `index`'s triangle at a hit's barycentric weights. */
export function lerpAttr(arr, n, index, h) {
  const a = index[h.t] * n, b = index[h.t + 1] * n, c = index[h.t + 2] * n, out = [];
  for (let k = 0; k < n; k++) out.push(h.u * arr[a + k] + h.v * arr[b + k] + h.w * arr[c + k]);
  return out;
}

const _area2 = (pts) => { let s = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; s += p.x * q.y - q.x * p.y; } return s; };

/**
 * triangle ∩ polygon (Weiler-Atherton against a convex clip): the CCW polygon
 * `poly` is walked; each run of it inside the CCW triangle `tri` is a chain
 * from an entry to an exit point on the triangle's boundary; every region is
 * closed by going from a chain's exit CCW along the triangle to the next entry.
 * Returns simple CCW loops (one per separate piece; a concave outline can
 * enter one triangle twice). No crossing: the whole triangle or nothing.
 */
function _trianglePolygonPieces(tri, poly) {
  const n = poly.length;
  const planes = [0, 1, 2].map((e) => ({ A: tri[e], B: tri[(e + 1) % 3] }));
  const side = (pl, X) => (pl.B.x - pl.A.x) * (X.y - pl.A.y) - (pl.B.y - pl.A.y) * (X.x - pl.A.x);
  const perim = (e, X) => { // position along the triangle boundary, 0..3
    const { A, B } = planes[e], dx = B.x - A.x, dy = B.y - A.y;
    return e + Math.max(0, Math.min(1, ((X.x - A.x) * dx + (X.y - A.y) * dy) / (dx * dx + dy * dy)));
  };
  let start = -1;
  for (let k = 0; k < n && start < 0; k++) if (planes.some((pl) => side(pl, poly[k]) < 0)) start = k;
  if (start < 0) return [poly.slice()]; // the polygon lies inside the triangle
  // T6 TAB TOP: `exitAtStart` -- an OPEN chain that leaves exactly at a segment's start (a polygon vertex ON the
  // triangle's boundary where the outline turns back out: a reflex vertex on a triangle edge, e.g. 7x9 at 0.05 in
  // cells) exits there. The plain walk skips such a segment ("only touching"); that is harmless when the chain
  // closes further on (every convex corner of Templates 1-5, walked exactly as before), but at a reflex vertex the
  // chain never closed and the whole triangle was lost to the centroid test. So the walk is redone with the rule
  // only when the plain one leaves a chain open.
  // A segment whose bounding box misses the triangle's is outside it: the walk skips it without the clip (the cost
  // MEASURED: the whole outline was clipped against every crossed triangle -- the frame-3d-sweep's slowest step). Not
  // while an exitAtStart chain is open: that rule reads a start point on an edge's LINE, which may lie off the box.
  const bx0 = Math.min(tri[0].x, tri[1].x, tri[2].x), bx1 = Math.max(tri[0].x, tri[1].x, tri[2].x);
  const by0 = Math.min(tri[0].y, tri[1].y, tri[2].y), by1 = Math.max(tri[0].y, tri[1].y, tri[2].y);
  const walk = (exitAtStart) => {
    const chains = [];
    let cur = null;
    for (let m = 0; m < n; m++) {
      const P = poly[(start + m) % n], Q = poly[(start + m + 1) % n];
      if (!(exitAtStart && cur) && ((P.x < bx0 && Q.x < bx0) || (P.x > bx1 && Q.x > bx1) || (P.y < by0 && Q.y < by0) || (P.y > by1 && Q.y > by1))) continue;
      const d = { x: Q.x - P.x, y: Q.y - P.y };
      let te = 0, tx = 1, ee = -1, ex = -1, empty = false;
      planes.forEach((pl, e) => { // Cyrus-Beck
        const f0 = side(pl, P), fd = (pl.B.x - pl.A.x) * d.y - (pl.B.y - pl.A.y) * d.x;
        if (fd === 0) { if (f0 < 0) empty = true; return; }
        const t = -f0 / fd;
        // ties count: a chain may enter / leave exactly at a polygon vertex on the boundary
        if (fd > 0) { if (t >= te) { te = t; ee = e; } } else if (t <= tx) { tx = t; ex = e; }
      });
      if (empty || te >= tx) { // outside, or only touching the triangle at one point
        if (exitAtStart && cur && !empty && ex >= 0 && tx === 0) { cur.exit = perim(ex, P); chains.push(cur); cur = null; }
        continue;
      }
      const at = (t) => ({ x: P.x + d.x * t, y: P.y + d.y * t });
      if (ee >= 0 && !cur) { const X = at(te); cur = { entry: perim(ee, X), pts: [X] }; }
      if (!cur) continue;
      if (ex >= 0) { const X = at(tx); cur.pts.push(X); cur.exit = perim(ex, X); chains.push(cur); cur = null; } else cur.pts.push(Q);
    }
    return { chains, open: !!cur };
  };
  let { chains, open } = walk(false);
  if (open) ({ chains } = walk(true));
  // A chain lying ON the triangle's boundary with the polygon's interior on the
  // far side (the outline running along a triangle edge the other way) has no
  // area inside: every segment's left side is outside the triangle. Drop it.
  const strictlyIn = (X) => planes.every((pl) => side(pl, X) > 0);
  const live = chains.filter((c) => c.pts.some((p, i) => {
    const q = c.pts[i + 1];
    if (!q) return false;
    const dx = q.x - p.x, dy = q.y - p.y, l = Math.hypot(dx, dy);
    if (!(l > 0)) return false;
    const e = 1e-4 * l;
    return strictlyIn({ x: (p.x + q.x) / 2 - (dy / l) * e, y: (p.y + q.y) / 2 + (dx / l) * e });
  }));
  if (!live.length) return null; // no crossing: decided by the caller
  const fwd = (from, to) => ((to - from) % 3 + 3) % 3; // CCW distance along the boundary
  // T6 TAB TOP: a reflex vertex of the outline lying ON a triangle edge ends one chain and starts the next at the
  // SAME boundary point. At such a RIGHT turn, linking them straight through is right only when the outline turns
  // there before the triangle's boundary does (clockwise from the incoming direction reversed: the region stays on
  // the left); otherwise the two are separate pieces touching at that point, and the boundary walk goes on to the
  // next entry. A left turn (every corner of Templates 1-5) links straight through, as before.
  const dirOf = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy); return l > 0 ? { x: dx / l, y: dy / l } : null; };
  const lastDir = (pts) => { for (let i = pts.length - 1; i > 0; i--) { const u = dirOf(pts[i - 1], pts[i]); if (u) return u; } return null; };
  const firstDir = (pts) => { for (let i = 1; i < pts.length; i++) { const u = dirOf(pts[0], pts[i]); if (u) return u; } return null; };
  const cw = (r, v) => { let a = (Math.atan2(r.y, r.x) - Math.atan2(v.y, v.x)) % (2 * Math.PI); if (a <= 0) a += 2 * Math.PI; return a; };
  const linkOk = (c, o) => {
    const din = lastDir(c.pts), dout = firstDir(o.pts), { A, B } = planes[Math.floor(c.exit) % 3], b = dirOf(A, B);
    if (!din || !dout || !b) return true;
    if (din.x * dout.y - din.y * dout.x >= 0) return true; // a left turn (a convex vertex of the CCW outline): as before
    const rev = { x: -din.x, y: -din.y };
    return cw(rev, dout) < cw(rev, b);
  };
  const reach = (c, o) => { const f = fwd(c.exit, o.entry); return f === 0 && o !== c && !linkOk(c, o) ? 3 : f; };
  const loops = [], used = new Set();
  for (const c0 of live) {
    if (used.has(c0)) continue;
    const loop = [];
    let c = c0;
    do {
      used.add(c);
      loop.push(...c.pts);
      let next = null;
      for (const o of live) if (!next || reach(c, o) < reach(c, next)) next = o;
      for (const v of [0, 1, 2].filter((v) => fwd(c.exit, v) > 0 && fwd(c.exit, v) < reach(c, next)).sort((u, v) => fwd(c.exit, u) - fwd(c.exit, v))) {
        loop.push(tri[v]);
      }
      c = next;
    } while (c !== c0 && !used.has(c));
    loops.push(loop);
  }
  return loops;
}

/** Ear-clip a CCW polygon into triangles (index triples into `pts`). */
function _earClip(pts) {
  const idx = pts.map((_, i) => i), tris = [];
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const inTri = (p, a, b, c) => cross(a, b, p) > 1e-12 && cross(b, c, p) > 1e-12 && cross(c, a, p) > 1e-12;
  while (idx.length > 3) {
    let cut = -1;
    for (let k = 0; k < idx.length && cut < 0; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      if (cross(pts[i0], pts[i1], pts[i2]) < -1e-12) continue; // reflex
      if (idx.some((j) => j !== i0 && j !== i1 && j !== i2 && inTri(pts[j], pts[i0], pts[i1], pts[i2]))) continue;
      cut = k;
    }
    if (cut < 0) cut = 0; // only degenerate (zero-area) corners are left
    tris.push([idx[(cut + idx.length - 1) % idx.length], idx[cut], idx[(cut + 1) % idx.length]]);
    idx.splice(cut, 1);
  }
  tris.push(idx);
  return tris;
}

/** Sutherland-Hodgman: convex `poly` (any winding) clipped to `inside(p)`; `cut(a,b)` interpolates the
 *  boundary crossing between two consecutive points where exactly one is inside. Winding is preserved. */
function _clipConvex(poly, inside, cut) {
  if (poly.length < 3) return [];
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i], prev = poly[(i + poly.length - 1) % poly.length];
    const curIn = inside(cur), prevIn = inside(prev);
    if (curIn !== prevIn) out.push(cut(prev, cur));
    if (curIn) out.push(cur);
  }
  return out;
}

/**
 * T82 item 3 (Fred: the hole's edge was JAGGED -- whole-triangle centroid culling left it wherever a
 * terrain triangle happened to straddle the rectangle, a staircase the shape of the terrain grid): convex
 * `poly` (a CCW triangle here) minus axis-aligned `rect`, as 0-4 convex polygons covering everything
 * outside the rect. Four sequential half-plane clips, each peeling one stripe (left of x1, right of x2,
 * below y1, above y2) off whatever is left; what remains after all four is inside the rect on every axis
 * -- i.e. the hole itself -- and is dropped. This sidesteps the "polygon with a hole" problem entirely
 * (never needed when the pieces are returned separately instead of as one loop), so it is exact even when
 * the rect sits fully inside `poly` with no shared edge.
 */
function _polyMinusRect(poly, rect) {
  const pieces = [];
  const atX = (x) => (a, b) => ({ x, y: a.y + (b.y - a.y) * ((x - a.x) / (b.x - a.x)) });
  const atY = (y) => (a, b) => ({ x: a.x + (b.x - a.x) * ((y - a.y) / (b.y - a.y)), y });
  let rest = poly;
  const left = _clipConvex(rest, (p) => p.x < rect.x1, atX(rect.x1));
  if (left.length >= 3) pieces.push(left);
  rest = _clipConvex(rest, (p) => p.x >= rect.x1, atX(rect.x1));
  const right = _clipConvex(rest, (p) => p.x > rect.x2, atX(rect.x2));
  if (right.length >= 3) pieces.push(right);
  rest = _clipConvex(rest, (p) => p.x <= rect.x2, atX(rect.x2));
  const below = _clipConvex(rest, (p) => p.y < rect.y1, atY(rect.y1));
  if (below.length >= 3) pieces.push(below);
  rest = _clipConvex(rest, (p) => p.y >= rect.y1, atY(rect.y1));
  const above = _clipConvex(rest, (p) => p.y > rect.y2, atY(rect.y2));
  if (above.length >= 3) pieces.push(above);
  return pieces;
}

/**
 * Exact trim of the panel to `poly` (world, closed). Triangles wholly inside
 * stay (`kept`, indices into the panel); the ones the outline crosses become
 * `rim` geometry: triangle ∩ polygon, re-triangulated with the source winding,
 * each new vertex's z and attributes (`attrs`: {name: {array, itemSize}})
 * interpolated in its source triangle. A zero-area (vertical) triangle has no
 * area to clip: it is kept whole when its centroid is inside.
 */
export function clipPanelToOutline(positions, index, poly, attrs = {}, cell = 0.1) {
  const P = positions, n = poly.length;
  const inside = new Int8Array(P.length / 3).fill(-1);
  const inPoly = polygonPointTester(poly);
  const isIn = (v) => (inside[v] < 0 ? (inside[v] = inPoly(P[v * 3], P[v * 3 + 1]) ? 1 : 0) : inside[v]) === 1;
  // outline segments bucketed by cell (one flat grid over the outline's cells), to find the triangles it crosses
  const cx = (x) => Math.floor(x / cell);
  let gi0 = Infinity, gi1 = -Infinity, gj0 = Infinity, gj1 = -Infinity;
  for (const p of poly) { gi0 = Math.min(gi0, cx(p.x)); gi1 = Math.max(gi1, cx(p.x)); gj0 = Math.min(gj0, cx(p.y)); gj1 = Math.max(gj1, cx(p.y)); }
  const gw = n ? gi1 - gi0 + 1 : 0, gh = n ? gj1 - gj0 + 1 : 0;
  const segCells = (k, each) => {
    const a = poly[k], b = poly[(k + 1) % n];
    for (let i = cx(Math.min(a.x, b.x)); i <= cx(Math.max(a.x, b.x)); i++) for (let j = cx(Math.min(a.y, b.y)); j <= cx(Math.max(a.y, b.y)); j++) each((i - gi0) * gh + (j - gj0));
  };
  const start = new Int32Array(gw * gh + 1);
  for (let k = 0; k < n; k++) segCells(k, (c) => start[c + 1]++);
  for (let c = 0; c < gw * gh; c++) start[c + 1] += start[c];
  const fill = start.slice(0, gw * gh), segs = new Int32Array(start[gw * gh]);
  for (let k = 0; k < n; k++) segCells(k, (c) => { segs[fill[c]++] = k; });
  const crossed = (x0, x1, y0, y1) => {
    for (let i = Math.max(cx(x0), gi0), ie = Math.min(cx(x1), gi1); i <= ie; i++) for (let j = Math.max(cx(y0), gj0), je = Math.min(cx(y1), gj1); j <= je; j++) {
      for (let r = start[(i - gi0) * gh + (j - gj0)], r1 = start[(i - gi0) * gh + (j - gj0) + 1]; r < r1; r++) {
        const k = segs[r];
        const a = poly[k], b = poly[(k + 1) % n];
        if (Math.max(a.x, b.x) >= x0 && Math.min(a.x, b.x) <= x1 && Math.max(a.y, b.y) >= y0 && Math.min(a.y, b.y) <= y1) return true;
      }
    }
    return false;
  };
  const kept = [], rim = { position: [], index: [] };
  const names = Object.keys(attrs);
  for (const nm of names) rim[nm] = [];
  const subjectCCW = _area2(poly) > 0 ? poly : poly.slice().reverse();
  for (let t = 0; t < index.length; t += 3) {
    const ia = index[t], ib = index[t + 1], ic = index[t + 2];
    const a = { x: P[ia * 3], y: P[ia * 3 + 1] }, b = { x: P[ib * 3], y: P[ib * 3 + 1] }, c = { x: P[ic * 3], y: P[ic * 3 + 1] };
    const hitsOutline = crossed(Math.min(a.x, b.x, c.x), Math.max(a.x, b.x, c.x), Math.min(a.y, b.y, c.y), Math.max(a.y, b.y, c.y));
    if (!hitsOutline) { if (isIn(ia) && isIn(ib) && isIn(ic)) kept.push(ia, ib, ic); continue; }
    const s2 = _area2([a, b, c]);
    if (Math.abs(s2) < 1e-14) {
      if (inPoly((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3)) kept.push(ia, ib, ic);
      continue;
    }
    const tri = s2 > 0 ? [a, b, c] : [a, c, b];
    let pieces = _trianglePolygonPieces(tri, subjectCCW);
    if (!pieces) { // nothing crosses it: wholly in or out, decided at a strictly interior point
      if (inPoly((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3)) kept.push(ia, ib, ic);
      continue;
    }
    for (const piece of pieces) {
      if (piece.length < 3 || Math.abs(_area2(piece)) < 1e-14) continue;
      const base = rim.position.length / 3;
      for (const q of piece) {
        const h = baryHit(P, index, t, q.x, q.y, Infinity);
        rim.position.push(q.x, q.y, h.z);
        for (const nm of names) rim[nm].push(...lerpAttr(attrs[nm].array, attrs[nm].itemSize, index, h));
      }
      for (const [i, j, k] of _earClip(piece)) {
        if (s2 > 0) rim.index.push(base + i, base + j, base + k);
        else rim.index.push(base + i, base + k, base + j); // keep the source triangle's facing
      }
    }
  }
  return { kept, rim };
}

/** A vertical strip along closed `poly` from zBot(p) to zTop(p). */
export function wallArrays(poly, zBot, zTop) {
  const n = poly.length, positions = [], index = [];
  poly.forEach((p) => { positions.push(p.x, p.y, zBot(p), p.x, p.y, zTop(p)); });
  for (let k = 0; k < n; k++) {
    const a = 2 * k, b = 2 * ((k + 1) % n);
    index.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return { positions, index };
}

/**
 * H23 item 67c (Fred's own close-up, reviewed again: the wall's black/white bands were
 * MISALIGNED with the rim's own dashes and BLURRY -- band edges fading over a wide gradient):
 * `wallArrays` above shares each vertex between its two neighbouring quads, so THREE's own
 * per-vertex colour interpolation smoothly BLENDS any two quads that sampled a different colour
 * -- the "wide gradient" is that blend, at the scale of one sample spacing, not a resolution
 * problem alone (item 67b's own WALL_COLOR_OVERSAMPLE already samples far finer than one stripe).
 * This is the SAME "flat colour per segment" fix the dispatch itself names (duplicate vertices at
 * every segment boundary, same principle `creasedNormals`, elsewhere in this file, already uses
 * for NORMALS at a hard edge): each segment between two consecutive `loop` points gets its OWN 4
 * vertices (never shared with its neighbours) and ONE flat colour, sampled at the segment's own
 * MIDPOINT via `colorAt` -- so a colour boundary falling between two loop points still lands on
 * the correct side of the nearer segment, with NO blend zone at all, matching the rim's own crisp,
 * per-pixel-exact texture edge instead of smearing across a whole sample spacing.
 */
export function wallArraysFlat(loop, zBot, zTop, colorAt) {
  const n = loop.length, positions = [], index = [], colors = [];
  for (let k = 0; k < n; k++) {
    const a = loop[k], b = loop[(k + 1) % n];
    const c = colorAt({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const base = positions.length / 3;
    positions.push(a.x, a.y, zBot(a), a.x, a.y, zTop(a), b.x, b.y, zBot(b), b.x, b.y, zTop(b));
    for (let i = 0; i < 4; i++) colors.push(c[0], c[1], c[2]);
    index.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  return { positions, index, colors };
}

/** The bar ring between corresponding `outer`/`inner` loops: top (at zTop) and bottom (at zBottom), outer
 *  wall and inner wall. `zTop`/`zBottom` are each a per-point function OR a fixed number, so the same
 *  primitive serves a bottom that follows the surface (the top, which always tracks the underside) as well
 *  as one that stays flat (both bars' own bottom, coplanar with the main frame's own frameBottomZ plane). */
export function ringArrays(outer, inner, zBottom, zTop, maxStep = Infinity, includeOuterWall = true) {
  const n = outer.length;
  if (inner.length !== n) throw new Error(`ringArrays: loops do not correspond (${n} vs ${inner.length})`);
  const positions = [], index = [];
  const v = (p, z) => { positions.push(p.x, p.y, z); return positions.length / 3 - 1; };
  const zb = typeof zBottom === 'function' ? zBottom : () => zBottom;
  // Rows across the ring width (outer -> inner), so the TOP follows the
  // underside across the bar too, not just along its edges.
  let widest = 0;
  for (let k = 0; k < n; k++) widest = Math.max(widest, Math.hypot(outer[k].x - inner[k].x, outer[k].y - inner[k].y));
  const rows = Math.max(1, Math.ceil(widest / maxStep));
  const at = (k, r) => ({ x: outer[k].x + (inner[k].x - outer[k].x) * (r / rows), y: outer[k].y + (inner[k].y - outer[k].y) * (r / rows) });
  const top = [];
  for (let r = 0; r <= rows; r++) top.push(Array.from({ length: n }, (_, k) => { const p = at(k, r); return v(p, zTop(p)); }));
  const oB = outer.map((p) => v(p, zb(p))), iB = inner.map((p) => v(p, zb(p)));
  for (let k = 0; k < n; k++) {
    const m = (k + 1) % n;
    for (let r = 0; r < rows; r++) {
      const a = top[r], b = top[r + 1];
      index.push(a[k], a[m], b[k], b[k], a[m], b[m]); // top, row r
    }
    index.push(oB[k], iB[k], oB[m], iB[k], iB[m], oB[m]); // bottom, per zBottom(p)
    const oT = top[0], iT = top[rows];
    // H23 item 67c: `includeOuterWall=false` leaves this one face out -- the OUTER wall vertices
    // (oB/oT) still exist (the bottom ring + top cap's own row 0 both need them), just not
    // connected into their own vertical quad here. Lets a caller fill that exact gap with a
    // SEPARATE, flat-coloured wallArraysFlat mesh instead (the bars' own outer wall needs crisp,
    // non-blended colour the SAME way frame-panel-wall now does; the rest of the ring -- this
    // inner wall, the top cap, the bottom -- stays uniformly wood-coloured, where smooth
    // shared-vertex interpolation is harmless since every vertex there is the SAME colour anyway).
    if (includeOuterWall) index.push(oB[k], oB[m], oT[k], oT[k], oB[m], oT[m]); // outer wall
    index.push(iB[k], iT[k], iB[m], iT[k], iT[m], iB[m]); // inner wall
  }
  // `rows`/`n` (H23 item 67b): so a caller building a MATCHING per-vertex colour array (the
  // bars' own outer-wall edge colour, applyFrameToPanel) can reproduce this function's exact
  // vertex order ([(rows+1) top rows of n][n outer-bottom][n inner-bottom]) without re-deriving
  // `rows` from `widest`/`maxStep` a 2nd time -- the one true computation stays here.
  return { positions, index, rows, n };
}

/**
 * H23 item 67b (Fred's own close-up: a striped black/white contour showed alternating wall-
 * colour/stripe-colour TRIANGLES along the rim): `panel`'s own 1-sample-per-cell resolution is
 * coarse enough that a single stripe (routinely narrower than one cell once a contour segment is
 * split into several) can start and end strictly BETWEEN two consecutive wall vertices -- the one
 * wall quad spanning them then linearly interpolates hard black-to-white across its own triangle,
 * which is exactly the "sawtooth" look. This oversamples the SAME boundary curve `panel`/`outer`/
 * `inner` already trace, SEPARATELY, for the wall's and bars' own colour-bearing geometry only --
 * never `panel` itself (the clip/trim polygon) or `outer`/`inner` as returned by `frameLoopsWorld`
 * (consumed elsewhere, e.g. index.js's own `_trimPoly`), since oversampling THOSE directly was
 * tried first and MEASURED to break `frame-bartop-drawn.test.js` (a new seam opens between the
 * panel and the bars when they stop sharing the exact same boundary resolution -- see this file's
 * own git history). Colour needs this; the panel/bars trim boundary does not.
 */
export const WALL_COLOR_OVERSAMPLE = 4;

/** The grid-fine world-space loops the trim, wall and bars all use (one place). */
export function frameLoopsWorld(spec, grid) {
  const { W, H, nx, nz } = grid;
  const cell = Math.min(W / Math.max(1, nx - 1), H / Math.max(1, nz - 1));
  const paired = samplePairedOutlines(spec.outerPrimitives, spec.innerPrimitives || spec.outerPrimitives, cell);
  const outer = toWorld(paired.outer, W, H);
  // F22: the panel's own trim loop (the outline offset outward by the panel lip); no lip = the outline itself
  const panel = spec.panelPrimitives ? toWorld(samplePairedOutlines(spec.panelPrimitives, spec.panelPrimitives, cell).outer, W, H) : outer;
  return { cell, outer, panel, inner: spec.innerPrimitives ? toWorld(paired.inner, W, H) : null };
}

/**
 * F17 item 4 (Fred, phone shot from below: the frame's shading was blurred at
 * its hard edges): smooth normals are kept only where the surface really is
 * smooth. Faces meeting at more than this angle get separate vertices with
 * their own normals (the bars' top/bottom/walls, the outline's sharp corners);
 * below it they stay shared and averaged (the bar top following the curved
 * underside, a wall along a curve). Declared once.
 */
export const FRAME_CREASE_ANGLE_DEG = 30;

/**
 * Indexed triangles -> `{ positions, index, normals, source }` with CREASED
 * normals: each face corner averages (area-weighted) the normals of the faces
 * around that vertex whose normal is within `creaseDeg` of its own face's;
 * corners of one vertex that end up with different normals get separate
 * vertices. `source[k]` = the input vertex new vertex k came from (to carry
 * other per-vertex attributes across). Pure.
 */
export function creasedNormals(positions, index, creaseDeg = FRAME_CREASE_ANGLE_DEG) {
  const cosMax = Math.cos(creaseDeg * Math.PI / 180);
  const nv = positions.length / 3, nc = index.length, nf = nc / 3;
  // face normals (unit) + areas
  const fn = new Float64Array(nf * 3), fa = new Float64Array(nf);
  for (let f = 0; f < nf; f++) {
    const a = 3 * index[3 * f], b = 3 * index[3 * f + 1], c = 3 * index[3 * f + 2];
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const len = Math.hypot(x, y, z);
    fa[f] = len / 2;
    if (len > 0) { fn[3 * f] = x / len; fn[3 * f + 1] = y / len; fn[3 * f + 2] = z / len; }
  }
  // vertex -> its face corners (compressed rows)
  const rowStart = new Int32Array(nv + 1);
  for (let k = 0; k < nc; k++) rowStart[index[k] + 1]++;
  for (let v = 0; v < nv; v++) rowStart[v + 1] += rowStart[v];
  const fill = rowStart.slice(0, nv), corners = new Int32Array(nc);
  for (let k = 0; k < nc; k++) corners[fill[index[k]]++] = k;
  const outIndex = new Array(nc), outPos = [], outN = [], source = [];
  for (let v = 0; v < nv; v++) {
    const r0 = rowStart[v], r1 = rowStart[v + 1];
    const made = []; // [nx, ny, nz, newVertex] for this vertex
    for (let r = r0; r < r1; r++) {
      const f = (corners[r] / 3) | 0;
      let x = 0, y = 0, z = 0;
      for (let q = r0; q < r1; q++) {
        const g = (corners[q] / 3) | 0;
        if (g !== f && fn[3 * f] * fn[3 * g] + fn[3 * f + 1] * fn[3 * g + 1] + fn[3 * f + 2] * fn[3 * g + 2] < cosMax) continue;
        x += fn[3 * g] * fa[g]; y += fn[3 * g + 1] * fa[g]; z += fn[3 * g + 2] * fa[g];
      }
      const len = Math.hypot(x, y, z) || 1;
      x /= len; y /= len; z /= len;
      let id = -1;
      for (const m of made) if (Math.abs(m[0] - x) < 1e-9 && Math.abs(m[1] - y) < 1e-9 && Math.abs(m[2] - z) < 1e-9) { id = m[3]; break; }
      if (id < 0) {
        id = source.length;
        made.push([x, y, z, id]);
        outPos.push(positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]);
        outN.push(x, y, z);
        source.push(v);
      }
      outIndex[corners[r]] = id;
    }
  }
  return { positions: outPos, index: outIndex, normals: outN, source };
}

/** A mesh with CREASED normals (hard edges stay hard). `attrs` = extra per-input-vertex attributes
 *  ({ name: { array, itemSize } }), carried across the vertex split. */
function _mesh(THREE, { positions, index }, material, attrs = {}) {
  const c = creasedNormals(positions, index);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(c.positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(c.normals, 3));
  for (const [name, { array, itemSize }] of Object.entries(attrs)) {
    const out = [];
    for (const v of c.source) for (let k = 0; k < itemSize; k++) out.push(array[v * itemSize + k]);
    g.setAttribute(name, new THREE.Float32BufferAttribute(out, itemSize));
  }
  g.setIndex(c.index);
  return new THREE.Mesh(g, material);
}

/**
 * Apply `spec` (see editor-frame-profile.js frameSolidSpec) to a built panel
 * mesh: trim its index in place (from the untrimmed copy kept in userData)
 * and return the extra meshes (edge wall + bars) the caller adds to the scene.
 * `spec == null` restores the untrimmed panel and returns [].
 *
 * H23 item 67 (Fred: "teint dans la masse" -- the board's edge should show
 * whatever artwork colour reaches it): `edgeSampler(u, v) -> {r,g,b} (0..1)
 * | null`, optional. When given, the panel's own outline wall and the
 * inset-window wall sample it (at each point's own uv, via the SAME
 * `lerpAttr`+`surf.at` machinery the heat-map colour already uses) INSTEAD
 * of the heat-map colour -- falling back to the heat-map when the sampler
 * returns null (no artwork at that point, e.g. fully transparent) or isn't
 * given at all, so omitting it reproduces the exact pre-item-67 behaviour.
 * Plain callback, not a canvas/texture reference, so this stays testable
 * with a fake and the caller (TerrainPreview) owns the real drape-canvas
 * sampling (drape-svg.js's sampleDrapeUV) -- one shared sampler, not a
 * colour pipeline duplicated in here.
 */
export function applyFrameToPanel(THREE, panelMesh, grid, spec, edgeSampler) {
  const geom = panelMesh.geometry;
  if (!geom.userData.fullIndex && geom.index) geom.userData.fullIndex = Array.from(geom.index.array);
  const full = geom.userData.fullIndex;
  if (!full) return [];
  if (!spec) { geom.setIndex(full.slice()); return []; }
  const { W, H, nx, nz, botPos } = grid;
  // Grid-fine loops: the edge wall must follow the terrain top even without bars.
  const { cell, outer, inner, panel } = frameLoopsWorld(spec, grid);
  const pos = geom.attributes.position.array;
  const attrs = {};
  for (const nm of ['color', 'uv', 'normal']) if (geom.attributes[nm]) attrs[nm] = geom.attributes[nm];
  const { kept, rim } = clipPanelToOutline(pos, full, panel, attrs, cell); // F22: the lip, else the outline
  const names = Object.keys(attrs);
  // The inset window is a literal hole -- no panel triangle may stay inside it. World mapping per this
  // file's own header comment: editor (x, y-down) -> world (x - W/2, H/2 - y), x unflipped, y flipped (and
  // therefore sorted the OTHER way: editor y1 < y2 becomes world y2' < y1').
  const win = spec.insetWindow;
  const windowed = win ? { x1: win.hole.x1 - W / 2, x2: win.hole.x2 - W / 2, y1: H / 2 - win.hole.y2, y2: H / 2 - win.hole.y1 } : null;
  let keptFinal = kept;
  if (windowed) {
    // T82 item 3 (Fred, phone shot from below: the hole's own edge was JAGGED): an EXACT clip against the
    // hole rectangle, the same quality as clipPanelToOutline's own outer trim above -- a straddling triangle
    // is cut to its true outside-the-rect pieces (_polyMinusRect) instead of being kept or dropped whole by
    // its centroid, which is what produced the staircase (the terrain grid's own shape) Fred saw.
    keptFinal = [];
    for (let t = 0; t < kept.length; t += 3) {
      const ia = kept[t], ib = kept[t + 1], ic = kept[t + 2];
      const a = { x: pos[ia * 3], y: pos[ia * 3 + 1] }, b = { x: pos[ib * 3], y: pos[ib * 3 + 1] }, c = { x: pos[ic * 3], y: pos[ic * 3 + 1] };
      const overlapsHole = Math.max(a.x, b.x, c.x) >= windowed.x1 && Math.min(a.x, b.x, c.x) <= windowed.x2
        && Math.max(a.y, b.y, c.y) >= windowed.y1 && Math.min(a.y, b.y, c.y) <= windowed.y2;
      if (!overlapsHole) { keptFinal.push(ia, ib, ic); continue; }
      const s2 = _area2([a, b, c]);
      if (Math.abs(s2) < 1e-14) { // zero-area: decide by centroid, as clipPanelToOutline's own trim does
        const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3;
        if (!rectContains(windowed, cx, cy)) keptFinal.push(ia, ib, ic);
        continue;
      }
      const triCCW = s2 > 0 ? [a, b, c] : [a, c, b];
      for (const piece of _polyMinusRect(triCCW, windowed)) {
        const base = rim.position.length / 3;
        for (const q of piece) {
          const h = baryHit(pos, kept, t, q.x, q.y, Infinity);
          rim.position.push(q.x, q.y, h.z);
          for (const nm of names) rim[nm].push(...lerpAttr(attrs[nm].array, attrs[nm].itemSize, kept, h));
        }
        for (let k = 1; k < piece.length - 1; k++) {
          if (s2 > 0) rim.index.push(base, base + k, base + k + 1);
          else rim.index.push(base, base + k + 1, base + k); // keep the source triangle's facing
        }
      }
    }
  }
  geom.setIndex(keptFinal);
  const extra = [];
  if (rim.index.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(rim.position, 3));
    for (const nm of Object.keys(attrs)) g.setAttribute(nm, new THREE.Float32BufferAttribute(rim[nm], attrs[nm].itemSize));
    g.setIndex(rim.index);
    if (!attrs.normal) g.computeVertexNormals();
    const m = new THREE.Mesh(g, panelMesh.material.clone());
    m.name = 'frame-panel-rim';
    extra.push(m);
  }
  if (botPos) { // a solid panel (thickened): the outline wall and the bars
    const surf = panelSurface(pos, full, W, H, nx, nz);
    // the walls read every loop point 4x (zBot + zTop of both its segments): one lookup per point object
    const hits = new Map();
    const at = (p) => { let h = hits.get(p); if (h === undefined) hits.set(p, (h = surf.at(p.x, p.y))); return h; };
    const top = (p) => at(p).hi.z;
    const bot = (p) => at(p).lo.z;
    const wallMat = panelMesh.material.clone();
    wallMat.side = THREE.DoubleSide;
    // H23 item 67b: a finer, colour-only sampling of the SAME boundary `panel` traces (its own
    // role as the trim/clip polygon above is untouched) -- see WALL_COLOR_OVERSAMPLE's own doc
    // comment for why (the saw-teeth fix).
    const panelPrimsForWall = spec.panelPrimitives || spec.outerPrimitives;
    const fineWallLoop = toWorld(samplePairedOutlines(panelPrimsForWall, panelPrimsForWall, cell / WALL_COLOR_OVERSAMPLE).outer, W, H);
    // H23 item 67: the artwork colour at this edge point if edgeSampler finds one there, else the
    // panel's own heat-map colour (today's look) -- see applyFrameToPanel's own doc comment. Only
    // overrides when the board has heat-map colour data at all (attrs.color) -- same precondition
    // as before this item (wallMat.vertexColors only reads true when the panel material has it,
    // which `useColours` in terrain-mesh.js already gates on that same data existing).
    const edgeColor = (p) => {
      const hit = at(p).hi;
      if (edgeSampler && attrs.uv) {
        const [u, v] = lerpAttr(attrs.uv.array, 2, full, hit);
        const c = edgeSampler(u, v);
        if (c) return [c.r, c.g, c.b];
      }
      return lerpAttr(attrs.color.array, 3, full, hit);
    };
    // H23 item 67c: wallArraysFlat (not wallArrays) -- flat, non-blended colour per segment, see
    // that function's own doc comment for why (the misalignment/blur rework).
    let wall;
    if (attrs.color) {
      const flat = wallArraysFlat(fineWallLoop, bot, top, edgeColor);
      wall = _mesh(THREE, flat, wallMat, { color: { array: flat.colors, itemSize: 3 } });
    } else {
      wall = _mesh(THREE, wallArrays(fineWallLoop, bot, top), wallMat, {});
    }
    wall.name = 'frame-panel-wall';
    extra.push(wall);
    if (inner || windowed) {
      // H8: spec.color is already the declared frame colour (frameSolidSpec,
      // editor-frame-profile.js) — this fallback only fires when it's null
      // (no matching wood found); Ash's own declared entry keeps it consistent.
      // H23 item 67d (Fred, direct: "the frame shouldn't change colour, only the board edge,
      // which is only about .25 in" -- a real, deliberate reversal of item 67b's own choice to
      // ALSO colour the bars): the frame's own wood moulding (the bars, main AND window) is a
      // SEPARATE piece of wood in Fred's own real craft practice, never dyed to match the panel's
      // own artwork -- only the B-spline PANEL's own side wall (frame-panel-wall / frame-window-
      // wall, both untouched by this item) gets the edge colour. Back to a single flat material
      // colour (no vertexColors, no per-vertex sampling, no WALL_COLOR_OVERSAMPLE -- there is no
      // colour boundary left to resolve on a UNIFORMLY wood-coloured surface), matching the
      // bars' own pre-item-67b look exactly.
      const barMat = new THREE.MeshPhongMaterial({ color: spec.color || FRAME_COLORS['3D Ash - Unfinished'],
        side: THREE.DoubleSide, shininess: 12, specular: 0x0a0a0a });
      capFrameBrightness(barMat);
      if (inner) {
        const bars = _mesh(THREE, ringArrays(outer, inner, spec.frameBottomZ, bot, cell), barMat);
        bars.name = 'frame-bars';
        extra.push(bars);
      }
      if (windowed) {
        // T82 item 3 (Fred, phone shot from the BOTTOM: "inset window doesn't show a frame in 3D" -- the
        // design's own "hide the subframe" meant hidden FROM THE FRONT by the panel overhang, not absent).
        // The SAME ring primitive as the main frame's own bars, between the window's outer and inner
        // (thickness-offset) rectangles, in the frame's own material (barMat). Z, per Fred's own follow-up
        // correction on the first bottom-view shot: the TOP conforms to the panel's own sculpted underside
        // (the bar mounts flush against it, no gap) but the BOTTOM stays FLAT, coplanar with the main
        // frame's own bottom (spec.frameBottomZ, the SAME plain constant the main frame's own ring call two
        // lines above passes) -- not terrain-following. So the bar's thickness genuinely VARIES (thicker
        // where the terrain dips deeper), which is correct and intended; only its top follows the terrain.
        const winPaired = samplePairedOutlines(rectToPrimitives(win.outer), rectToPrimitives(win.inner), cell);
        const winBars = _mesh(THREE,
          ringArrays(toWorld(winPaired.outer, W, H), toWorld(winPaired.inner, W, H), spec.frameBottomZ, bot, cell), barMat);
        winBars.name = 'frame-window-bars';
        extra.push(winBars);
      }
    }
    if (windowed) {
      // A real hole needs a wall at its own edge too (same top/bot hug as the outline's own wall above), or
      // it would look like a flat decal rather than an opening through the panel's own thickness -- sampled
      // the same way the outline's own wall is (not just the 4 corners), so it follows the sculpted
      // underside along each side.
      const winHoleLoop = toWorld(samplePairedOutlines(rectToPrimitives(win.hole), rectToPrimitives(win.hole), cell).outer, W, H);
      // Same "panel's own colours at the top edge" sampling the outline's own wall does above (wallAttrs) --
      // wallMat inherits vertexColors:true from panelMesh.material whenever the board has a carved/terrain
      // colour map (terrain-mesh.js's own useColours), and without a matching `color` attribute on THIS
      // geometry too, that material renders flat black here (the vertex colour attribute is simply unset,
      // not "no tint") instead of just losing its own per-vertex shading -- the exact reported symptom.
      // H23 item 67c: flat per-segment colour here too (wallArraysFlat), same fix/reason as
      // frame-panel-wall above.
      let winWall;
      if (attrs.color) {
        const flat = wallArraysFlat(winHoleLoop, bot, top, edgeColor);
        winWall = _mesh(THREE, flat, wallMat.clone(), { color: { array: flat.colors, itemSize: 3 } });
      } else {
        winWall = _mesh(THREE, wallArrays(winHoleLoop, bot, top), wallMat.clone(), {});
      }
      winWall.name = 'frame-window-wall';
      extra.push(winWall);
    }
  }
  return extra;
}

/** Fred: highlights on the 3D frame must never reach pure white. Every lit pixel of the frame bars is capped at
 *  FRAME_MAX_BRIGHTNESS per channel (a shader clamp after lighting), and their specular is kept dark. */
export const FRAME_MAX_BRIGHTNESS = 0.88;
export function capFrameBrightness(mat, max = FRAME_MAX_BRIGHTNESS) {
  if (!mat) return mat;
  const cap = Number(max).toFixed(3);
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>',
      `#include <dithering_fragment>\n  gl_FragColor.rgb = min(gl_FragColor.rgb, vec3(${cap}));`);
  };
  mat.customProgramCacheKey = () => `frameCap${cap}`;
  return mat;
}

/**
 * outline-offset.js — FB-APP F8 (Fred: the sim vs Fusion variation): the TRUE
 * inward offset of a closed line/arc outline by a distance t, i.e. the same
 * operation Fusion's Offset performs for the frame's inner edge
 * (sketches/template_N/phases/p03_02_encl_offset.py + p03_03_inner_corner_resolve.py).
 *
 *   - a line shifts along its inward normal by t;
 *   - an arc keeps its centre; its radius becomes r - t when it bulges outward
 *     (convex) and r + t when it bulges inward (concave);
 *   - consecutive offset pieces are re-joined: at a tangent joint they meet at
 *     the joint's own offset point; at a corner they are intersected (the miter
 *     point);
 *   - a piece that collapses (a convex arc with r <= t, or a piece whose joints
 *     cross) is dropped and its neighbours are intersected across it (Fusion's
 *     "merged regime"). It is kept as a zero-length placeholder so the result
 *     has the SAME primitive count/order as the input (the bars and miters pair
 *     outer and inner by index).
 *
 * Pure: primitives in, primitives out ({type:'L',p0,p1} | {type:'A',cx,cy,rx,ry,phi,theta1,dTheta}).
 */

const TAU = 2 * Math.PI;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const len = (a) => Math.hypot(a.x, a.y);
const unit = (a) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };

const _start = (p) => (p.type === 'L' ? p.p0 : { x: p.cx + p.rx * Math.cos(p.theta1), y: p.cy + p.rx * Math.sin(p.theta1) });
const _end = (p) => (p.type === 'L' ? p.p1 : { x: p.cx + p.rx * Math.cos(p.theta1 + p.dTheta), y: p.cy + p.rx * Math.sin(p.theta1 + p.dTheta) });
/** Unit travel direction at the start (s=0) or end (s=1) of a piece. */
function _tangent(p, s) {
  if (p.type === 'L') return unit(sub(p.p1, p.p0));
  const th = p.theta1 + p.dTheta * s, sg = Math.sign(p.dTheta) || 1;
  return { x: -Math.sin(th) * sg, y: Math.cos(th) * sg };
}

/** +1 or -1 such that `sign * leftNormal(dir)` points INTO the loop. */
function _inwardSign(prims) {
  // Shoelace over the endpoints (+ arc midpoints) gives the loop orientation.
  const pts = [];
  for (const p of prims) {
    pts.push(_start(p));
    if (p.type === 'A') pts.push({ x: p.cx + p.rx * Math.cos(p.theta1 + p.dTheta / 2), y: p.cy + p.rx * Math.sin(p.theta1 + p.dTheta / 2) });
  }
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const q = pts[(i + 1) % pts.length]; a += pts[i].x * q.y - q.x * pts[i].y; }
  return a > 0 ? 1 : -1; // leftNormal = (-dy, dx): inside for a positive-area loop
}
const _leftNormal = (d) => ({ x: -d.y, y: d.x });

/** The offset "carrier" of a piece: a line (point + dir) or a circle (centre + radius). */
function _carrier(p, t, inSign) {
  if (p.type === 'L') {
    const d = unit(sub(p.p1, p.p0)), n = mul(_leftNormal(d), inSign);
    return { kind: 'line', pt: add(p.p0, mul(n, t)), dir: d };
  }
  const mid = { x: p.cx + p.rx * Math.cos(p.theta1 + p.dTheta / 2), y: p.cy + p.rx * Math.sin(p.theta1 + p.dTheta / 2) };
  const n = mul(_leftNormal(_tangent(p, 0.5)), inSign);
  const convex = dot(n, sub({ x: p.cx, y: p.cy }, mid)) > 0; // centre on the inner side: bulges outward
  return { kind: 'circle', c: { x: p.cx, y: p.cy }, r: p.rx + (convex ? -t : t) };
}

/** Distance from q to one outline piece (segment, or the arc's own span). */
function _distTo(q, p) {
  if (p.type === 'L') {
    const d = sub(p.p1, p.p0), l2 = dot(d, d) || 1, s = Math.max(0, Math.min(1, dot(sub(q, p.p0), d) / l2));
    return len(sub(q, add(p.p0, mul(d, s))));
  }
  const c = { x: p.cx, y: p.cy }, a = Math.atan2(q.y - c.y, q.x - c.x);
  const onSpan = [-1, 0, 1].some((k) => { const u = (a + k * TAU - p.theta1) / p.dTheta; return u >= 0 && u <= 1; });
  return onSpan ? Math.abs(len(sub(q, c)) - p.rx) : Math.min(len(sub(q, _start(p))), len(sub(q, _end(p))));
}

function _inside(q, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > q.y) !== (b.y > q.y) && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Of two carriers' intersections, the joint is the one on the true offset:
 * inside the outline and at least t from every piece (the erosion's own
 * definition). When neither is (a neighbour between them is about to collapse)
 * the one nearest `ref`, the original joint, keeps the order so the
 * "runs backwards" rule below can drop that neighbour.
 * `ctx` = { prims, poly, t }. Parallel carriers (no intersection) keep `ref`.
 */
function _intersect(a, b, ref, ctx) {
  let cands = [];
  if (a.kind === 'line' && b.kind === 'line') {
    const den = a.dir.x * b.dir.y - a.dir.y * b.dir.x;
    if (Math.abs(den) > 1e-12) {
      const w = sub(b.pt, a.pt), s = (w.x * b.dir.y - w.y * b.dir.x) / den;
      cands = [add(a.pt, mul(a.dir, s))];
    }
  } else if (a.kind === 'circle' && b.kind === 'circle') {
    const d = len(sub(b.c, a.c));
    if (d > 1e-12) {
      const x = (d * d + a.r * a.r - b.r * b.r) / (2 * d), h2 = a.r * a.r - x * x;
      const e = unit(sub(b.c, a.c)), m = add(a.c, mul(e, x)), h = Math.sqrt(Math.max(0, h2)), nn = _leftNormal(e);
      cands = [add(m, mul(nn, h)), add(m, mul(nn, -h))];
    }
  } else {
    const L = a.kind === 'line' ? a : b, C = a.kind === 'line' ? b : a;
    const f = sub(L.pt, C.c), B = dot(f, L.dir), D = B * B - (dot(f, f) - C.r * C.r);
    const s = Math.sqrt(Math.max(0, D));
    cands = [add(L.pt, mul(L.dir, -B + s)), add(L.pt, mul(L.dir, -B - s))];
  }
  if (!cands.length) return ref;
  const onOffset = (q) => _inside(q, ctx.poly) && ctx.prims.every((p) => _distTo(q, p) >= ctx.t - 1e-6);
  const pool = cands.filter(onOffset).length ? cands.filter(onOffset) : cands;
  return pool.reduce((best, q) => (len(sub(q, ref)) < len(sub(best, ref)) ? q : best));
}

/** The offset joint between pieces a and b (original joint point `j`). */
function _join(pa, pb, ca, cb, j, t, inSign, ctx) {
  const ta = _tangent(pa, 1), tb = _tangent(pb, 0);
  const na = mul(_leftNormal(ta), inSign), nb = mul(_leftNormal(tb), inSign);
  if (dot(ta, tb) > 1 - 1e-9) return add(j, mul(na, t)); // tangent: the joint's own offset point
  return _intersect(ca, cb, add(j, mul(add(na, nb), t)), ctx); // corner: the miter point
}

function _signedSweep(c, p0, p1, orig) {
  let d = Math.atan2(p1.y - c.y, p1.x - c.x) - Math.atan2(p0.y - c.y, p0.x - c.x);
  // the representative of d (mod 2pi) closest to the original sweep keeps direction and major/minor
  const k = Math.round((orig - d) / TAU);
  return d + k * TAU;
}

export function offsetOutlineInward(prims, t) {
  const n = prims.length, inSign = _inwardSign(prims);
  const carriers = prims.map((p) => _carrier(p, t, inSign));
  const alive = prims.map((p, i) => !(carriers[i].kind === 'circle' && carriers[i].r <= 1e-9));
  const poly = [];
  for (const p of prims) for (let k = 0; k < (p.type === 'L' ? 1 : 16); k++) {
    poly.push(p.type === 'L' ? p.p0 : { x: p.cx + p.rx * Math.cos(p.theta1 + (p.dTheta * k) / 16), y: p.cy + p.rx * Math.sin(p.theta1 + (p.dTheta * k) / 16) });
  }
  const ctx = { prims, poly, t };
  let joints = [];
  for (let pass = 0; pass <= n; pass++) {
    // joint k sits between the last alive piece at or before k and the next alive piece after it
    joints = new Array(n);
    for (let k = 0; k < n; k++) {
      if (!alive[k]) continue;
      let m = (k + 1) % n; while (!alive[m]) m = (m + 1) % n;
      const direct = m === (k + 1) % n;
      const j = _end(prims[k]);
      joints[k] = direct ? _join(prims[k], prims[m], carriers[k], carriers[m], j, t, inSign, ctx)
        : _intersect(carriers[k], carriers[m], j, ctx);
    }
    // a piece whose two joints cross (runs backwards) has collapsed too
    let changed = false;
    for (let k = 0; k < n; k++) {
      if (!alive[k]) continue;
      let pk = (k - 1 + n) % n; while (!alive[pk]) pk = (pk - 1 + n) % n;
      const a = joints[pk], b = joints[k];
      const backwards = prims[k].type === 'L'
        ? dot(sub(b, a), sub(prims[k].p1, prims[k].p0)) < -1e-9
        : Math.sign(_signedSweep(carriers[k].c, a, b, prims[k].dTheta)) !== Math.sign(prims[k].dTheta);
      if (backwards) { alive[k] = false; changed = true; }
    }
    if (!changed) break;
  }
  return prims.map((p, k) => {
    let pk = (k - 1 + n) % n; while (!alive[pk]) pk = (pk - 1 + n) % n;
    const a = joints[pk];
    if (!alive[k]) return { type: 'L', p0: { ...a }, p1: { ...a }, collapsed: true };
    const b = joints[k];
    if (p.type === 'L') return { type: 'L', p0: a, p1: b };
    const c = carriers[k].c, r = carriers[k].r;
    return { type: 'A', cx: c.x, cy: c.y, rx: r, ry: r, phi: 0,
      theta1: Math.atan2(a.y - c.y, a.x - c.x), dTheta: _signedSweep(c, a, b, p.dTheta) };
  });
}

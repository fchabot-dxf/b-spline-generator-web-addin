/**
 * F8 AMEND: editor/outline-offset.js, the TRUE inward offset of a line/arc
 * outline (lines shifted, arcs concentric at r -/+ t, re-joined at the joints).
 * Cases with known answers; the real templates are checked against Fusion's own
 * offset in frame-parity-app.test.js.
 */
import { describe, it, expect } from 'vitest';
import { offsetOutlineInward } from '../bspline-frame-builder/b-spline-gen/html/editor/outline-offset.js';

const L = (x0, y0, x1, y1) => ({ type: 'L', p0: { x: x0, y: y0 }, p1: { x: x1, y: y1 } });
const A = (cx, cy, r, theta1, dTheta) => ({ type: 'A', cx, cy, rx: r, ry: r, phi: 0, theta1, dTheta });
const close = (p, q) => expect([+p.x.toFixed(9), +p.y.toFixed(9)]).toEqual([+q.x.toFixed(9), +q.y.toFixed(9)]);
const H = Math.PI / 2;

/** A 10x6 box (y down, clockwise on screen) with corner fillets of radius r. */
function roundedBox(r) {
  return [
    L(r, 0, 10 - r, 0), A(10 - r, r, r, -H, H),
    L(10, r, 10, 6 - r), A(10 - r, 6 - r, r, 0, H),
    L(10 - r, 6, r, 6), A(r, 6 - r, r, H, H),
    L(0, 6 - r, 0, r), A(r, r, r, Math.PI, H),
  ];
}

describe('offsetOutlineInward', () => {
  it('t=0 is the exact identity: every primitive comes back unchanged, nothing collapses', () => {
    // MEASURED regression (d3, T16/T17 "Arched Funnel"/"Tulip"): before the t=0 special case, a
    // line-arc corner's own joint solver could pick the wrong root of a 2-root circle/line
    // intersection right AT t=0 (`_inside`'s ray-cast is ambiguous exactly on a polygon vertex),
    // collapsing pieces that never should have moved at all. A line/arc mix (not just all-line)
    // exercises the exact corner kind that broke.
    const prims = [L(0, 0, 4, 0), A(5, 0, 1, Math.PI, -Math.PI), L(6, 0, 10, 0), L(10, 0, 10, 6), L(10, 6, 0, 6), L(0, 6, 0, 0)];
    const out = offsetOutlineInward(prims, 0);
    expect(out).toHaveLength(prims.length);
    expect(out.filter((p) => p.collapsed)).toHaveLength(0);
    out.forEach((p, i) => {
      expect(p.type).toBe(prims[i].type);
      if (p.type === 'L') { close(p.p0, prims[i].p0); close(p.p1, prims[i].p1); }
      else { expect([p.cx, p.cy, p.rx, p.theta1, p.dTheta]).toEqual([prims[i].cx, prims[i].cy, prims[i].rx, prims[i].theta1, prims[i].dTheta]); }
    });
    // returns clones, not the same objects -- callers must be free to mutate the result
    expect(out[0]).not.toBe(prims[0]);
    expect(out[0].p0).not.toBe(prims[0].p0);
  });

  it('a square: each side moves in by t, corners meet at the miter point', () => {
    const out = offsetOutlineInward([L(0, 0, 4, 0), L(4, 0, 4, 4), L(4, 4, 0, 4), L(0, 4, 0, 0)], 1);
    [[1, 1, 3, 1], [3, 1, 3, 3], [3, 3, 1, 3], [1, 3, 1, 1]].forEach(([a, b, c, d], i) => {
      close(out[i].p0, { x: a, y: b }); close(out[i].p1, { x: c, y: d });
    });
  });

  it('a convex fillet r > t stays concentric at r - t, tangent to the shifted sides', () => {
    const out = offsetOutlineInward(roundedBox(2), 0.5);
    expect(out).toHaveLength(8);
    expect(out[1]).toMatchObject({ type: 'A', cx: 8, cy: 2, rx: 1.5 });
    close(out[0].p1, { x: 8, y: 0.5 });
    close(out[2].p0, { x: 9.5, y: 2 });
    expect(out[1].dTheta).toBeCloseTo(H, 12);
  });

  it('a convex fillet r <= t collapses: the sides meet at a sharp miter, the count is kept', () => {
    const out = offsetOutlineInward(roundedBox(0.3), 1);
    expect(out).toHaveLength(8); // index pairing with the outline (bars, miters)
    expect(out.filter((p) => p.collapsed)).toHaveLength(4);
    close(out[0].p1, { x: 9, y: 1 });
    close(out[2].p0, { x: 9, y: 1 });
    close(out[2].p1, { x: 9, y: 5 });
  });

  it('a concave notch grows to r + t', () => {
    // a 10x6 box with a semicircular notch (r 1) cut into the top edge
    const prims = [L(0, 0, 4, 0), A(5, 0, 1, Math.PI, -Math.PI), L(6, 0, 10, 0), L(10, 0, 10, 6), L(10, 6, 0, 6), L(0, 6, 0, 0)];
    const out = offsetOutlineInward(prims, 0.5);
    expect(out[1]).toMatchObject({ type: 'A', cx: 5, cy: 0, rx: 1.5 });
    // the shifted top line (y = 0.5) meets the grown circle at x = 5 -/+ sqrt(1.5^2 - 0.5^2)
    close(out[0].p1, { x: 5 - Math.sqrt(2), y: 0.5 });
    close(out[2].p0, { x: 5 + Math.sqrt(2), y: 0.5 });
  });

  it('every inner point is exactly t from the outline (the offset\'s definition)', () => {
    const prims = roundedBox(2), t = 0.5, out = offsetOutlineInward(prims, t);
    // the box = the rect [2,8]x[2,4] grown by a disc of radius 2
    const dist = (q) => {
      const c = { x: Math.min(Math.max(q.x, 2), 8), y: Math.min(Math.max(q.y, 2), 4) };
      const d = Math.hypot(q.x - c.x, q.y - c.y);
      return d > 0 ? 2 - d : Math.min(q.x, 10 - q.x, q.y, 6 - q.y);
    };
    for (const p of out) {
      for (let k = 0; k <= 8; k++) {
        const q = p.type === 'L'
          ? { x: p.p0.x + (p.p1.x - p.p0.x) * k / 8, y: p.p0.y + (p.p1.y - p.p0.y) * k / 8 }
          : { x: p.cx + p.rx * Math.cos(p.theta1 + p.dTheta * k / 8), y: p.cy + p.rx * Math.sin(p.theta1 + p.dTheta * k / 8) };
        expect(dist(q)).toBeCloseTo(t, 9);
      }
    }
  });
});

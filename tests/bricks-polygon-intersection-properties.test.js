/**
 * T86 item 21c: polygonIntersection on TOUCHING inputs -- a corner on the other polygon's edge, two edges
 * overlapping along a line, a shared vertex. Real brick geometry is full of them: bondLayout's course 0
 * shares the board's own bottom edge by construction, and grid-snapped sizes put corners on edges.
 * MEASURED on main before the fix (3000 grid-snapped cases below, ~23% touching): 271 wrong areas, 75 areas
 * larger than an operand, 165 results that changed with argument order; d3's minimal straddling brick
 * returned [] (and the whole 56.9 sq in board with the arguments swapped).
 *
 * The properties, checked against an independent reference (Sutherland-Hodgman, exact for convex x
 * convex, touches included; an L-shaped clip is two rectangles, so its reference is the sum of two):
 *   - area(subject & clip) matches the reference (a disconnected result keeps only its largest loop, so
 *     for the L the area must lie between the larger piece and the sum)
 *   - area(subject & clip) <= min(area(subject), area(clip))
 *   - the result is a simple polygon (no self-intersection)
 *   - the area is the same with the arguments swapped (convex pairs)
 * Every coordinate is on a 0.25 in grid so touching cases are common, not luck; the run asserts that.
 */
import { describe, it, expect } from 'vitest';
import { polygonIntersection, signedArea, isSimplePolygon, isConvex } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';

const area = (p) => (p.length >= 3 ? Math.abs(signedArea(p)) : 0);
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

// Sutherland-Hodgman: subject clipped by each edge of a CONVEX clip, in turn.
function referenceClip(subject, clip) {
  let twice = 0;
  for (let i = 0; i < clip.length; i++) { const a = clip[i], b = clip[(i + 1) % clip.length]; twice += a.x * b.y - b.x * a.y; }
  const orient = twice > 0 ? 1 : -1;
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const side = (p) => ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) * orient;
    const prev = out; out = [];
    for (let j = 0; j < prev.length; j++) {
      const P = prev[j], Q = prev[(j + 1) % prev.length], sp = side(P), sq = side(Q);
      if (sp >= 0) out.push(P);
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push({ x: P.x + t * (Q.x - P.x), y: P.y + t * (Q.y - P.y) }); }
    }
  }
  return out;
}

function touches(a, b) {
  return a.some((p) => b.some((q, j) => {
    const s = b[(j + b.length - 1) % b.length], dx = q.x - s.x, dy = q.y - s.y;
    const t = Math.max(0, Math.min(1, ((p.x - s.x) * dx + (p.y - s.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p.x - s.x - t * dx, p.y - s.y - t * dy) < 1e-9;
  }));
}

function runProperties(seed, cases) {
  let state = seed >>> 0;
  const rnd = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const Q = 0.25;
  const randRect = () => { const x0 = int(0, 12), y0 = int(0, 12); return rect(x0 * Q, y0 * Q, (x0 + int(1, 8)) * Q, (y0 + int(1, 8)) * Q); };
  // a convex quad with one slanted side: a grid rect with one corner slid along its bottom/top edge
  const randQuad = () => {
    const r = randRect(), k = int(0, 3), p = r[k], c = r[(k + 2) % 4];
    r[k] = { x: p.x + (c.x - p.x) * (int(1, 3) / 8), y: p.y };
    return isConvex(r) ? r : randRect();
  };
  const TOL = 1e-3; // the perturbation path is accurate to ~1e-5 in x perimeter
  const fails = { area: [], operandBound: [], selfIntersecting: [], argumentOrder: [] };
  let touching = 0;
  for (let n = 0; n < cases; n++) {
    const subject = n % 2 ? randQuad() : randRect();
    const concave = n % 3 === 0;
    let clip, refMax, refMin;
    if (concave) {
      const x0 = int(0, 6), y0 = int(0, 6), w = int(3, 8), h = int(3, 8), a = int(1, w - 1), b = int(1, h - 1);
      clip = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + b], [x0 + a, y0 + b], [x0 + a, y0 + h], [x0, y0 + h]].map(([x, y]) => ({ x: x * Q, y: y * Q }));
      const p1 = area(referenceClip(subject, rect(x0 * Q, y0 * Q, (x0 + w) * Q, (y0 + b) * Q)));
      const p2 = area(referenceClip(subject, rect(x0 * Q, (y0 + b) * Q, (x0 + a) * Q, (y0 + h) * Q)));
      refMax = p1 + p2; refMin = Math.max(p1, p2);
    } else {
      clip = n % 4 === 1 ? randQuad() : randRect();
      refMax = refMin = area(referenceClip(subject, clip));
    }
    if (touches(subject, clip) || touches(clip, subject)) touching++;
    const result = polygonIntersection(subject, clip), a1 = area(result);
    const tag = { n, subject, clip, got: a1, reference: refMax };
    if (a1 < refMin - TOL || a1 > refMax + TOL) fails.area.push(tag);
    if (a1 > Math.min(area(subject), area(clip)) + TOL) fails.operandBound.push(tag);
    if (result.length >= 3 && !isSimplePolygon(result)) fails.selfIntersecting.push(tag);
    if (!concave) { const a2 = area(polygonIntersection(clip, subject)); if (Math.abs(a1 - a2) > TOL) fails.argumentOrder.push({ ...tag, swapped: a2 }); }
  }
  return { touching, fails };
}

describe('polygonIntersection properties on touching (degenerate) inputs (T86 item 21c)', () => {
  for (const seed of [12345, 777]) {
    it(`seed ${seed}: area matches the reference, never exceeds an operand, simple, argument-order free`, () => {
      const cases = 3000;
      const { touching, fails } = runProperties(seed, cases);
      expect(touching, 'the generator must actually produce touching cases').toBeGreaterThan(cases * 0.15);
      for (const [name, list] of Object.entries(fails)) expect(list.slice(0, 2), `${name}: ${list.length} of ${cases} failed`).toEqual([]);
    });
  }

  it("d3's minimal case: a brick straddling the board's right edge, bottom edges collinear, clips to its inside part", () => {
    const brick = rect(6.522, 0.25, 7.272, 0.45), board = rect(0.25, 0.25, 6.75, 9);
    for (const [a, b] of [[brick, board], [board, brick]]) {
      const r = polygonIntersection(a, b);
      expect(area(r)).toBeCloseTo((6.75 - 6.522) * 0.2, 4);
      expect(isSimplePolygon(r)).toBe(true);
      for (const p of r) { expect(p.x).toBeLessThanOrEqual(6.75 + 1e-4); expect(p.x).toBeGreaterThanOrEqual(6.522 - 1e-4); }
    }
  });

  it('a brick wholly inside the board but flush with its bottom edge comes back EXACTLY (not shifted)', () => {
    const brick = rect(1, 0.25, 2, 0.45);
    expect(polygonIntersection(brick, rect(0.25, 0.25, 6.75, 9))).toEqual(brick);
  });

  it('two bricks sharing only an edge do not overlap', () => {
    expect(area(polygonIntersection(rect(0, 0, 1, 0.5), rect(1, 0, 2, 0.5)))).toBe(0);
    expect(area(polygonIntersection(rect(0, 0, 1, 0.5), rect(0.5, 0.5, 1.5, 1)))).toBe(0);
  });
});

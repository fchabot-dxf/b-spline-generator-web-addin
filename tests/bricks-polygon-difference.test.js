/**
 * T86 item 13 (the wall flows around brush strokes): polygonDifference(A, C) = every piece of A outside C.
 * Properties on grid-snapped shapes (corners on a 0.25 in grid, so shared lines and corner-on-edge touches are
 * common, the case Greiner-Hormann gets wrong without the perturbation):
 *   - the pieces' areas sum to area(A) - area(A & C)    (polygonIntersection is verified against an independent
 *     reference in bricks-polygon-intersection-properties.test.js)
 *   - every piece lies inside A and outside C, and is weakly simple
 *   - either winding of either polygon gives the same answer (polygonIntersection's too: it was wrong on a touching
 *     pair wound opposite ways)
 *   - a C wholly inside A cannot be cut out of one loop: A comes back whole, flagged `holeIgnored`
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import { polygonDifference, polygonIntersection, signedArea, isConvex } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS }); // a heavy sweep: see heavy-test-timeout.js

const area = (p) => (p && p.length >= 3 ? Math.abs(signedArea(p)) : 0);
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

function weaklySimple(p) {
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const same = (u, v) => Math.hypot(u.x - v.x, u.y - v.y) < 1e-9;
  const n = p.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue;
    const a = p[i], b = p[(i + 1) % n], c = p[j], d = p[(j + 1) % n];
    if (same(a, c) || same(a, d) || same(b, c) || same(b, d)) continue;
    const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
    if (Math.max(Math.abs(d1), Math.abs(d2), Math.abs(d3), Math.abs(d4)) < 1e-12) continue;
    if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return false;
  }
  return true;
}

function run(seed, cases) {
  let state = seed >>> 0;
  const rnd = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const Q = 0.25;
  const randRect = () => { const x0 = int(0, 12), y0 = int(0, 12); return rect(x0 * Q, y0 * Q, (x0 + int(1, 8)) * Q, (y0 + int(1, 8)) * Q); };
  const randQuad = () => { const r = randRect(), k = int(0, 3), p = r[k], c = r[(k + 2) % 4]; r[k] = { x: p.x + (c.x - p.x) * (int(1, 3) / 8), y: p.y }; return isConvex(r) ? r : randRect(); };
  const TOL = 1e-3;
  const fails = { areaSum: [], outsideA: [], insideC: [], selfCrossing: [], hole: [], intersectionWinding: [] };
  for (let n = 0; n < cases; n++) {
    // either winding, either shape (brush bricks are wound the other way round from wall cells)
    const A = (n % 2 ? randQuad() : randRect()), C = (n % 3 ? randQuad() : randRect());
    if (int(0, 1)) A.reverse();
    if (int(0, 1)) C.reverse();
    // the reference itself: polygonIntersection must not care how either polygon is wound
    const inter = area(polygonIntersection(A, C));
    if ([[A, C.slice().reverse()], [A.slice().reverse(), C]].some(([a, c]) => Math.abs(area(polygonIntersection(a, c)) - inter) > TOL)) fails.intersectionWinding.push({ n, A, C });
    const pieces = polygonDifference(A, C);
    const tag = { n, A, C, pieces: pieces.length };
    if (pieces.holeIgnored) {
      if (!(pieces.length === 1 && Math.abs(area(pieces[0]) - area(A)) < TOL)) fails.hole.push(tag);
      continue;
    }
    const sum = pieces.reduce((s, q) => s + area(q), 0);
    if (Math.abs(sum - (area(A) - area(polygonIntersection(A, C)))) > TOL) fails.areaSum.push({ ...tag, sum, expect: area(A) - area(polygonIntersection(A, C)) });
    for (const q of pieces) {
      if (Math.abs(area(polygonIntersection(q, A)) - area(q)) > TOL) fails.outsideA.push(tag);
      if (area(polygonIntersection(q, C)) > TOL) fails.insideC.push(tag);
      if (!weaklySimple(q)) fails.selfCrossing.push(tag);
    }
  }
  return fails;
}

describe('polygonDifference (T86 item 13)', () => {
  for (const seed of [12345, 777]) {
    it(`seed ${seed}: pieces sum to A - (A & C), lie in A and out of C, never cross themselves`, () => {
      const fails = run(seed, 3000);
      for (const [name, list] of Object.entries(fails)) expect(list.slice(0, 2), `${name}: ${list.length} failed`).toEqual([]);
    });
  }
  it('a band across a brick cuts it in two', () => {
    const pieces = polygonDifference(rect(0, 0, 2, 0.5), rect(0.8, -1, 1.2, 1));
    expect(pieces.length).toBe(2);
    expect(pieces.map(area).sort()).toEqual([0.4, 0.4].map((v) => expect.closeTo(v, 6)));
  });
  it('a clip wholly inside: the subject whole, flagged', () => {
    const pieces = polygonDifference(rect(0, 0, 4, 4), rect(1, 1, 2, 2));
    expect(pieces.holeIgnored).toBe(true);
    expect(area(pieces[0])).toBeCloseTo(16, 6);
  });
  it('a subject wholly inside the clip: nothing left', () => {
    expect(polygonDifference(rect(1, 1, 2, 2), rect(0, 0, 4, 4))).toEqual([]);
  });
});

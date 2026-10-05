/**
 * T86 item 22 (Fred: a rustic running bond): `rustic` 0..1 varies brick lengths within a course (library.js RUSTIC:
 * 0.6-1.4 x the brick at 1), keeps every joint RUSTIC.minLap of a brick off the joints of the course below (the bond
 * stays staggered), fills each course end to end (closers from the clip, nothing left open) and lifts / sinks bricks by
 * up to RUSTIC.levelIn x rustic. Wall (running bond only, as the app sends it) and Brush. 0 / absent = today's lay.
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import { generateBricks, ENGINE_OPTIONS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { bricksAlongPath } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/along-path.js';
import { pointInPolygon, polygonIntersection, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { BRICK_SETS, RUSTIC } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS }); // pairwise + sampled checks: see heavy-test-timeout.js

const SET = BRICK_SETS[0], W = 7, H = 9, L = SET.brickLengthIn, J = SET.grout.widthIn;
const board = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
const area = (p) => Math.abs(signedArea(p));
const box = (p) => { const xs = p.map((q) => q.x), ys = p.map((q) => q.y); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; };
const lay = (extra, pattern = 'stretcher') => generateBricks({ boardOutline: board, set: SET, seed: 3, scale: 1, suppression: 0, clumping: 0, zones: [{ pattern }], ...extra }).bricks;
/** interior bricks (not cut by the board's left/right edges) grouped by course, left to right */
function courses(bricks) {
  const byY = new Map();
  for (const b of bricks) {
    const q = box(b.polygon);
    if (q.x0 < 1e-6 || q.x1 > W - 1e-6) continue;
    const k = Math.round((q.y0 + q.y1) * 500);
    if (!byY.has(k)) byY.set(k, []);
    byY.get(k).push(q);
  }
  return [...byY.entries()].sort((a, b) => a[0] - b[0]).map(([, qs]) => qs.sort((a, b) => a.x0 - b.x0));
}
function coverage(bricks) {
  let n = 0, c = 0;
  for (let x = 0.05; x < W; x += 0.1) for (let y = 0.05; y < H; y += 0.1) { n++; if (bricks.some((b) => pointInPolygon(x, y, b.polygon))) c++; }
  return c / n;
}

describe('rustic running bond (T86 item 22)', () => {
  it('is an option the engine honours', () => expect(ENGINE_OPTIONS).toContain('rustic'));
  it('0 / absent: today\'s lay exactly', () => {
    expect(lay({ rustic: 0 }).map((b) => b.polygon)).toEqual(lay({}).map((b) => b.polygon));
  });
  for (const r of [1, 0.5]) {
    it(`rustic ${r}: lengths in the declared range and varied, joints off the course below, no overlap, courses filled`, () => {
      const bricks = lay({ rustic: r });
      const lo = L * (1 - RUSTIC.lengthSpread * r), hi = L * (1 + RUSTIC.lengthSpread * r);
      const cs = courses(bricks);
      const lens = cs.flat().map((q) => q.x1 - q.x0);
      expect(Math.min(...lens)).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(Math.max(...lens)).toBeLessThanOrEqual(hi + 1e-9);
      expect(Math.max(...lens) - Math.min(...lens)).toBeGreaterThan(0.5 * (hi - lo)); // really varied
      // staggered: a joint (between two interior bricks) keeps minLap off every joint of the course below
      const joints = cs.map((qs) => qs.slice(1).map((q) => q.x0 - J / 2));
      let close = 0, total = 0;
      for (let c = 1; c < joints.length; c++) for (const j of joints[c]) { total++; if (joints[c - 1].some((k) => Math.abs(j - k) < RUSTIC.minLap * L - 1e-6)) close++; }
      expect(total).toBeGreaterThan(50);
      expect(close / total).toBeLessThan(0.03); // the nudge stays inside the length range, so a rare clash may remain
      for (let i = 0; i < bricks.length; i++) for (let j = i + 1; j < bricks.length; j++) {
        expect(area(polygonIntersection(bricks[i].polygon, bricks[j].polygon))).toBeLessThan(1e-6);
      }
      expect(Math.abs(coverage(bricks) - coverage(lay({})))).toBeLessThan(0.01); // the same wall area, just other lengths
    });
  }
  it('levels: lifted / sunk within the declared jitter', () => {
    const plain = lay({}), rough = lay({ rustic: 1 });
    const spread = (bs) => Math.max(...bs.map((b) => b.heightOffset)) - Math.min(...bs.map((b) => b.heightOffset));
    expect(spread(rough)).toBeGreaterThan(spread(plain));
    expect(spread(rough)).toBeLessThanOrEqual(spread(plain) + 2 * RUSTIC.levelIn + 1e-9);
  });
  it('a stack bond is not a running bond: lengths untouched (the app sends rustic for running bond only)', () => {
    expect(lay({ rustic: 1 }, 'stack').map((b) => b.polygon)).toEqual(lay({}, 'stack').map((b) => b.polygon));
  });
  it('a Brush stroke: varied lengths in range, no overlap, seeded', () => {
    const line = [{ x: 0.5, y: 4.5 }, { x: 6.5, y: 4.5 }];
    const plain = bricksAlongPath(line, { set: SET, seed: 5 }).bricks;
    const rough = bricksAlongPath(line, { set: SET, seed: 5, rustic: 1 }).bricks;
    const again = bricksAlongPath(line, { set: SET, seed: 5, rustic: 1 }).bricks;
    expect(again.map((b) => b.polygon)).toEqual(rough.map((b) => b.polygon));
    const lens = rough.slice(0, -2).map((b) => { const q = box(b.polygon); return q.x1 - q.x0; });
    expect(Math.max(...lens) - Math.min(...lens)).toBeGreaterThan(0.2 * L);
    expect(Math.max(...lens)).toBeLessThanOrEqual(L * (1 + RUSTIC.lengthSpread) + 1e-9);
    for (let i = 0; i < rough.length; i++) for (let j = i + 1; j < rough.length; j++) expect(area(polygonIntersection(rough[i].polygon, rough[j].polygon))).toBeLessThan(1e-6);
    expect(rough.map((b) => b.polygon)).not.toEqual(plain.map((b) => b.polygon));
  });
});

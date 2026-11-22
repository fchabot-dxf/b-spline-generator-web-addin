/**
 * STL-CROP worker R (Fred 2026-11-22, decision D: "allow to have a falloff from the edges of the bounding box"): a LIVE stamp setting
 * on the STL record, `cropFalloff: { widthIn (0 = off), profile (a BRUSH_FALLOFFS key), customCurve, edges: { left, right, front,
 * back, bottom } }`, applied in the STL pass body (core/stl/layer.js). Absent / width 0 = the pass body byte-identical to today.
 * The real record (createStlLayer on a real soup), the real pass, the brush's own curves (core/height/brush.js).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createStlLayer, stlPass, _resetStlCachesForTests } from '../bspline-frame-builder/b-spline-gen/html/core/stl/layer.js';
import { BRUSH_FALLOFFS, curveFromPoints } from '../bspline-frame-builder/b-spline-gen/html/core/height/brush.js';

const tri = (a, b, c) => [...a, ...b, ...c];
/** A 4 x 4 x 2 block centred on the origin: from above, a flat top over x, y in [-2, 2]. */
function block() {
  const P = (x, y, z) => [x, y, z];
  const v = [P(-2, -2, 0), P(2, -2, 0), P(2, 2, 0), P(-2, 2, 0), P(-2, -2, 2), P(2, -2, 2), P(2, 2, 2), P(-2, 2, 2)];
  const q = (a, b, c, d) => [tri(v[a], v[b], v[c]), tri(v[a], v[c], v[d])];
  return Float32Array.from([q(0, 3, 2, 1), q(4, 5, 6, 7), q(0, 1, 5, 4), q(1, 2, 6, 5), q(2, 3, 7, 6), q(3, 0, 4, 7)].flat(2));
}
/** A square pyramid: base [-2, 2]^2 at z 0, apex (0, 0, 4). */
function pyramid() {
  const A = [-2, -2, 0], B = [2, -2, 0], C = [2, 2, 0], D = [-2, 2, 0], T = [0, 0, 4];
  return Float32Array.from([tri(A, B, T), tri(B, C, T), tri(C, D, T), tri(D, A, T), tri(A, C, B), tri(A, D, C)].flat());
}
// a 10 x 10 in board on a 101 x 101 grid: dx = 0.1 in, column i at x = -5 + 0.1 i (the block's left edge x = -2 is column 30)
const GRID = { nx: 101, nz: 101, widthIn: 10, heightIn: 10 };
const BOARD = { widthIn: 10, heightIn: 10 };
const rec = (soup, extra = {}) => ({ ...createStlLayer({ soup, name: 't', board: BOARD }).record, unitIn: 1, ...extra });
const at = (body, i, j) => body[j * GRID.nx + i];

beforeEach(() => _resetStlCachesForTests());

describe('F1. absent or width 0 = the pass as before (pin)', () => {
  it('the body, coverage and depth are byte-identical with no cropFalloff, width 0, or no edge on', () => {
    const base = rec(block());
    const a = stlPass(base, GRID);
    const bodyA = Buffer.from(a.mask.body.buffer).toString('base64'), covA = Buffer.from(a.mask.isStamped.buffer).toString('base64');
    for (const fo of [{ widthIn: 0 }, { widthIn: 0, profile: 'dome', edges: { left: true } }, { widthIn: 1, edges: { left: false, right: false, front: false, back: false, bottom: false } }]) {
      _resetStlCachesForTests();
      const b = stlPass({ ...base, cropFalloff: fo }, GRID);
      expect(Buffer.from(b.mask.body.buffer).toString('base64')).toBe(bodyA);
      expect(Buffer.from(b.mask.isStamped.buffer).toString('base64')).toBe(covA);
      expect(b.depth).toBe(a.depth);
    }
  });
});

describe('F2. the side edges of the stamped footprint', () => {
  it('left only, 1 in, Smooth: the left edge column weighs 0, 1 in inside weighs 1, half way = the brush curve at 0.5; the right edge is untouched', () => {
    const r = rec(block(), { cropFalloff: { widthIn: 1, profile: 'smooth', edges: { left: true, right: false, front: false, back: false, bottom: false } } });
    const body = stlPass(r, GRID).mask.body;
    const j = 50;
    expect(at(body, 30, j)).toBeCloseTo(0, 6);                                // x = -2: the edge
    expect(at(body, 35, j)).toBeCloseTo(BRUSH_FALLOFFS.smooth.curve(0.5), 5); // x = -1.5
    expect(at(body, 40, j)).toBeCloseTo(1, 6);                                // x = -1: widthIn inside
    expect(at(body, 70, j)).toBeCloseTo(1, 6);                                // x = +2: the right edge, off
  });
  it('every built-in profile gives its own curve value at the middle of the band', () => {
    for (const key of ['smooth', 'linear', 'dome', 'soft', 'spike', 'plateau']) {
      _resetStlCachesForTests();
      const r = rec(block(), { cropFalloff: { widthIn: 1, profile: key, edges: { left: false, right: true, front: false, back: false, bottom: false } } });
      const body = stlPass(r, GRID).mask.body;
      expect(at(body, 65, 50), key).toBeCloseTo(BRUSH_FALLOFFS[key].curve(0.5), 5); // x = 1.5: 0.5 in inside the right edge
      expect(at(body, 64, 50), key).toBeCloseTo(BRUSH_FALLOFFS[key].curve(0.4), 5);
    }
  });
  it('edges absent = all on: front (-Y) and back (+Y) fade too, and the weights MULTIPLY in a corner', () => {
    const r = rec(block(), { cropFalloff: { widthIn: 1, profile: 'linear', edges: { bottom: false } } });
    const body = stlPass(r, GRID).mask.body;
    expect(at(body, 50, 30)).toBeCloseTo(0, 6);   // y = -2: the front edge
    expect(at(body, 50, 65)).toBeCloseTo(0.5, 5); // 0.5 in inside the back edge
    expect(at(body, 35, 35)).toBeCloseTo(0.25, 5); // 0.5 in from the left AND the front: 0.5 x 0.5
    expect(at(body, 50, 50)).toBeCloseTo(1, 6);
  });
  it('the footprint is the PLACED mesh: moved by position and turned by the rotation, the band moves with it', () => {
    const r = rec(block(), { position: { x: 1, y: 0, z: 0 }, cropFalloff: { widthIn: 1, profile: 'linear', edges: { left: true, right: false, front: false, back: false, bottom: false } } });
    const body = stlPass(r, GRID).mask.body;
    expect(at(body, 40, 50)).toBeCloseTo(0, 6);   // the left edge is now x = -1
    expect(at(body, 45, 50)).toBeCloseTo(0.5, 5);
    _resetStlCachesForTests();
    const t = rec(block(), { rotation: { x: 0, y: 0, z: 90 }, cropFalloff: { widthIn: 1, profile: 'linear', edges: { left: true, right: false, front: false, back: false, bottom: false } } });
    expect(at(stlPass(t, GRID).mask.body, 35, 50)).toBeCloseTo(0.5, 5); // a square turned 90: its board-left edge is still x = -2
  });
});

describe('F3. the bottom fade and the custom curve', () => {
  it('bottom: the body fades over widthIn above the model\'s lowest height (a pyramid rises out of the board)', () => {
    const plain = stlPass(rec(pyramid()), GRID).mask.body;
    _resetStlCachesForTests();
    const r = rec(pyramid(), { cropFalloff: { widthIn: 2, profile: 'linear', edges: { left: false, right: false, front: false, back: false, bottom: true } } });
    const body = stlPass(r, GRID).mask.body;
    // the pyramid's height at x = -1 (column 40), y = 0 is 2 in (half way up): t = 1 - 2/2 = 0 -> weight 1
    expect(at(body, 40, 50)).toBeCloseTo(at(plain, 40, 50), 4);
    // at x = -1.5 (column 35) its height is 1 in: weight = linear(0.5) = 0.5
    expect(at(body, 35, 50)).toBeCloseTo(at(plain, 35, 50) * 0.5, 4); // 16-bit stored positions: ~1e-5
    expect(at(body, 50, 50)).toBeCloseTo(1, 5); // the apex: far above the band
  });
  it('profile custom reads the record\'s customCurve through the brush\'s own curveFromPoints', () => {
    const pts = [[0, 1], [0.5, 0.2], [1, 0]];
    const r = rec(block(), { cropFalloff: { widthIn: 1, profile: 'custom', customCurve: pts, edges: { left: true, right: false, front: false, back: false, bottom: false } } });
    const body = stlPass(r, GRID).mask.body;
    const f = curveFromPoints(pts);
    expect(at(body, 35, 50)).toBeCloseTo(f(0.5), 5);
    expect(at(body, 33, 50)).toBeCloseTo(f(0.7), 5);
  });
  it('the cache keys the falloff: changing only the width gives a new body', () => {
    const base = rec(block());
    const one = stlPass({ ...base, cropFalloff: { widthIn: 1, profile: 'linear', edges: { left: true, right: false, front: false, back: false, bottom: false } } }, GRID).mask.body;
    const two = stlPass({ ...base, cropFalloff: { widthIn: 2, profile: 'linear', edges: { left: true, right: false, front: false, back: false, bottom: false } } }, GRID).mask.body;
    expect(at(one, 35, 50)).toBeCloseTo(0.5, 5);
    expect(at(two, 35, 50)).toBeCloseTo(0.25, 5);
  });
});

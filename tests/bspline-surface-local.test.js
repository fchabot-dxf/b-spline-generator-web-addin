/**
 * 2026-10-08 (seat A; seat D's phone audit: "Show mesh" on, spacing 0.05 -> 0.03 on an 8x10 board = ONE 6 s task).
 * evalBSplineSurface de-Boor-evaluated EVERY row of the control grid for each point, though the outer de Boor reads only
 * the 4 rows of v's span: ~3,400 iso-curve points x 334 rows of 268 there. It now evaluates only those 4, by the same
 * code into the same slots -- so the result is the same to the bit. The reference below is the old full evaluation.
 */
import { describe, it, expect } from 'vitest';
import { clampedKnots, deBoor, evalBSplineSurface } from '../bspline-frame-builder/b-spline-gen/html/core/bspline-math.js';

function fullEval(ctrl, nx, nz, U, V, u, v) { // the pre-2026-10-08 evaluation, every row
  const temp = [];
  for (let j = 0; j < nz; j++) {
    const row = [];
    for (let i = 0; i < nx; i++) row.push(ctrl[i][j]);
    temp.push(deBoor(3, U, row, u));
  }
  return deBoor(3, V, temp, v);
}

let seed = 20261008;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

describe('evalBSplineSurface: only the 4 rows of the span, the same result to the bit', () => {
  it('random grids (4..70 x 4..70), random + boundary parameters: x, y, z identical (Object.is)', () => {
    let checked = 0;
    for (let g = 0; g < 40; g++) {
      const nx = 4 + Math.floor(rnd() * 67), nz = 4 + Math.floor(rnd() * 67), W = 1 + rnd() * 10, H = 1 + rnd() * 10;
      const ctrl = Array.from({ length: nx }, (_, i) => Array.from({ length: nz }, (_, j) => ({
        x: -W / 2 + i * W / (nx - 1), y: -H / 2 + j * H / (nz - 1), z: (rnd() - 0.5) * 3,
      })));
      const U = clampedKnots(nx, 3).full, V = clampedKnots(nz, 3).full;
      const params = [0, 1, 0.5, ...Array.from({ length: 10 }, rnd), ...Array.from({ length: 4 }, (_, k) => (k + 1) / (nz - 3))];
      for (const u of params) for (const v of params) {
        const a = evalBSplineSurface(ctrl, nx, nz, U, V, u, v), b = fullEval(ctrl, nx, nz, U, V, u, v);
        expect(Object.is(a.x, b.x) && Object.is(a.y, b.y) && Object.is(a.z, b.z), `${nx}x${nz} u ${u} v ${v}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10000);
  });
});

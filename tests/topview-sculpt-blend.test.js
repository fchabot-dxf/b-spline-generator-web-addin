/**
 * Seat D 2026-10-08 (phone, Photo blur drag at CPU x4: each tick repaints the editor's backdrop, and _paintTopView's own
 * loop was 72 ms of a ~185 ms tick): the sculpt-delta blend is addSculptDeltas now -- the per-pixel modulo / floor /
 * divisions once per column and row. Its OUTPUT must stay byte-identical to the old per-pixel loop (the oracle below,
 * render-topview.js's bilinearSample exactly as it was).
 */
import { describe, it, expect } from 'vitest';
import { addSculptDeltas } from '../bspline-frame-builder/b-spline-gen/html/core/render-topview.js';

function bilinearSample(data, nx, nz, u, v) {
  const x = u * (nx - 1);
  const z = v * (nz - 1);
  const x0 = Math.floor(x), x1 = Math.min(nx - 1, x0 + 1);
  const z0 = Math.floor(z), z1 = Math.min(nz - 1, z0 + 1);
  const dx = x - x0, dy = z - z0;
  const v00 = data[z0 * nx + x0];
  const v10 = data[z0 * nx + x1];
  const v01 = data[z1 * nx + x0];
  const v11 = data[z1 * nx + x1];
  return v00 * (1 - dx) * (1 - dy) +
         v10 * dx * (1 - dy) +
         v01 * (1 - dx) * dy +
         v11 * dx * dy;
}
const oldBlend = (heights, nx, nz, pre, nxLow, nzLow) => {
  for (let k = 0; k < nx * nz; k++) {
    const u = (k % nx) / (nx - 1);
    const v = Math.floor(k / nx) / (nz - 1);
    heights[k] += bilinearSample(pre, nxLow, nzLow, u, v);
  }
  return heights;
};

// a deterministic, sculpt-like field (smooth bumps + fine noise), never all zero
const rnd = (seed) => () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
const field = (n, r, scale) => Float32Array.from({ length: n }, (_, i) => Math.sin(i * 0.013) * scale + (r() - 0.5) * scale * 0.1);

describe('addSculptDeltas: the backdrop sculpt blend, byte-identical to the per-pixel bilinearSample loop', () => {
  for (const [nx, nz, nxLow, nzLow] of [[384, 494, 140, 180], [384, 288, 97, 61], [17, 23, 5, 7], [384, 384, 2, 2]]) {
    it(`${nx}x${nz} from ${nxLow}x${nzLow}`, () => {
      const r = rnd(nx * 7 + nz);
      const base = field(nx * nz, r, 0.4), pre = field(nxLow * nzLow, r, 0.02);
      const want = oldBlend(new Float32Array(base), nx, nz, pre, nxLow, nzLow);
      const got = addSculptDeltas(new Float32Array(base), nx, nz, pre, nxLow, nzLow);
      expect(Buffer.from(got.buffer).equals(Buffer.from(want.buffer))).toBe(true);
    });
  }
});

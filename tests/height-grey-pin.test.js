/**
 * HEIGHT-PAINTER slice 5: the PINS. (1) The Lit view (core/height/shade.js shadeRaster with no look given) draws byte for
 * byte as before slice 5 -- the hash below was measured on height-painter-4 @ 1763a9a5 BEFORE the slice-5 code (sha256 of
 * the RGBA bytes). (2) A patch record's grey mapping (slice 5, `greyMapping`) never changes how it lays: the pass with and
 * without it is the same (an absent field = today).
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { shadeRaster, shadeSize } from '../bspline-frame-builder/b-spline-gen/html/core/height/shade.js';
import { heightPass, _resetHeightCachesForTests } from '../bspline-frame-builder/b-spline-gen/html/core/height/layer.js';
import { encodeRaster, ensureRasterDecoded } from '../bspline-frame-builder/b-spline-gen/html/core/height/raster.js';

const sha = (u8) => createHash('sha256').update(Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength)).digest('hex').slice(0, 16);
/** a 60 x 40 raster: a raised dome, a lowered groove, unpainted elsewhere */
function sample() {
  const cols = 60, rows = 40, d = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const q = Math.hypot(c - 20, r - 20) / 12;
    if (q < 1) d[r * cols + c] = 0.2 * Math.sqrt(1 - q * q);
    if (c >= 40 && c <= 50) d[r * cols + c] = -0.05 * (1 - Math.abs(c - 45) / 6);
  }
  return { cols, rows, d };
}

describe('the Lit view is unchanged', () => {
  it('shadeRaster without a look: the bytes measured before slice 5', () => {
    const { cols, rows, d } = sample();
    const { w, h } = shadeSize(cols, rows, 512);
    expect(sha(shadeRaster(d, cols, rows, w, h, 100, 100))).toBe('f678114f551a278c');
    const { w: w2, h: h2 } = shadeSize(cols, rows, 37);
    expect(sha(shadeRaster(d, cols, rows, w2, h2, 100, 80))).toBe('206702003f3e0f36');
  });
});

describe('a grey mapping on the record never changes the pass', () => {
  it('the same body and coverage with and without greyMapping', async () => {
    const { cols, rows, d } = sample();
    const raster = await encodeRaster(d, cols, rows);
    await ensureRasterDecoded(raster);
    const rec = { id: 'p', enabled: true, position: { x: 0, y: 0 }, rotation: 0, sizeIn: { w: 0.6, h: 0.4 }, raster };
    const grid = { nx: 31, nz: 21, widthIn: 1, heightIn: 0.8 };
    _resetHeightCachesForTests();
    const a = heightPass(rec, grid);
    _resetHeightCachesForTests();
    const b = heightPass({ ...rec, greyMapping: { zero: 'mid', whiteIn: 0.7, darkIn: 0.1 } }, grid);
    expect(sha(new Uint8Array(b.mask.body.buffer))).toBe(sha(new Uint8Array(a.mask.body.buffer)));
    expect(Array.from(b.mask.isStamped)).toEqual(Array.from(a.mask.isStamped));
    expect(a.mask.isStamped.some((v) => v)).toBe(true);
    expect({ ...b, mask: null }).toEqual({ ...a, mask: null });
  });
});

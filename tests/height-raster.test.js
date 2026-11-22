/**
 * HEIGHT-PAINTER slice 1 (HEIGHT-PAINTER-DESIGN.md section 7): a height patch's raster is Float32 inches in memory and is
 * STORED as Float16 -> deflate-raw (CompressionStream) -> base64, with a content hash `h` (the decode cache key, the undo
 * store key, the build digest's stand-in). core/height/raster.js.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  RASTER_ENC, encodeRaster, decodeRaster, f16Round, decodedRaster, ensureRasterDecoded, isStoredRaster, _resetRasterCacheForTests,
} from '../bspline-frame-builder/b-spline-gen/html/core/height/raster.js';

const COLS = 70, ROWS = 90; // a 0.7 x 0.9 in patch at 100 px/in
function relief() { // signed heights in inches: a dome, a groove, some tiny and some large values, a -0
  const a = new Float32Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const d = Math.hypot(c - 35, r - 45);
    a[r * COLS + c] = (d < 30 ? 0.4 * Math.cos((d / 30) * Math.PI / 2) : 0) - (c === 10 ? 0.123456 : 0) + (r === 3 ? 1.37 : 0) + (r === 80 ? 3e-6 : 0);
  }
  a[5] = -0;
  return a;
}

beforeEach(() => _resetRasterCacheForTests());

describe('Float16 rounding', () => {
  it('matches the platform Math.f16round on every value of a relief (round to nearest even, subnormals, signed zero)', () => {
    const a = relief();
    for (const v of [...a, 0.1, 0.2, 1 / 3, 65504, 70000, -2.5e-8, 6.1e-5, 5.96e-8, 1e-9, -0.000123]) {
      expect(Object.is(f16Round(v), Math.f16round(v)), String(v)).toBe(true);
    }
  });
});

describe('encode -> decode', () => {
  it('round-trips within Float16 precision: every decoded value IS the Float16 rounding of the input', async () => {
    const a = relief();
    const rec = await encodeRaster(a, COLS, ROWS);
    expect(rec).toMatchObject({ cols: COLS, rows: ROWS, enc: RASTER_ENC });
    expect(rec.enc).toBe('f16-deflate-b64');
    expect(typeof rec.data).toBe('string');
    expect(isStoredRaster(rec)).toBe(true);
    const back = await decodeRaster(rec);
    expect(back).toBeInstanceOf(Float32Array);
    expect(back.length).toBe(COLS * ROWS);
    for (let k = 0; k < a.length; k++) {
      expect(Object.is(back[k], Math.f16round(a[k])), `k=${k}`).toBe(true);
      expect(Math.abs(back[k] - a[k])).toBeLessThanOrEqual(Math.abs(a[k]) * 2 ** -11 + 2 ** -25);
    }
  });
  it('the hash is stable (same input, same h) and follows the content (one value changed, another h)', async () => {
    const a = relief();
    const r1 = await encodeRaster(a, COLS, ROWS);
    const r2 = await encodeRaster(Float32Array.from(a), COLS, ROWS);
    expect(r2.h).toBe(r1.h);
    expect(r2.data).toBe(r1.data);
    const b = Float32Array.from(a); b[1234] += 0.01;
    expect((await encodeRaster(b, COLS, ROWS)).h).not.toBe(r1.h);
    // the same bytes as another shape are another raster
    expect((await encodeRaster(a, ROWS, COLS)).h).not.toBe(r1.h);
  });
  it('compresses: an all-zero whole-board patch (7 x 9 in at 100 px/in) is far smaller than its 1.26 MB of Float16', async () => {
    const rec = await encodeRaster(new Float32Array(700 * 900), 700, 900);
    expect(rec.data.length).toBeLessThan(20000);
    const back = await decodeRaster(rec);
    expect(back.every((v) => v === 0)).toBe(true);
  });
});

describe('the decode cache (keyed by the content hash)', () => {
  it('an encoded raster is ready at once (encode primes the cache with the stored values); a fresh copy decodes once', async () => {
    const a = relief();
    const rec = await encodeRaster(a, COLS, ROWS);
    const ready = decodedRaster(rec);
    expect(ready).toBeInstanceOf(Float32Array);
    expect(ready[100]).toBe(Math.f16round(a[100]));
    _resetRasterCacheForTests();
    const copy = JSON.parse(JSON.stringify(rec)); // a saved project's record
    expect(decodedRaster(copy)).toBeUndefined();
    const d = await ensureRasterDecoded(copy);
    expect(decodedRaster(copy)).toBe(d);
    expect(await ensureRasterDecoded(copy)).toBe(d);
  });
});

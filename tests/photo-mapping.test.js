/**
 * 2026-10-10 (seat A + seat D): the photo sampler's mapping and terrain's board -> sample fold, exported once
 * (core/noise/photo.js photoPixelAt / photoSampleOf, core/terrain.js foldUV / unfoldUV) for the on-board footprint gizmo
 * and the preview's "not sampled" overlay. fn and generateHeightmap stay byte-identical (tests/heightmap-golden.test.js).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { fn, photoPixelAt, photoSampleOf } from '../bspline-frame-builder/b-spline-gen/html/core/noise/photo.js';
import { foldUV, unfoldUV } from '../bspline-frame-builder/b-spline-gen/html/core/terrain.js';
import { ensurePhotoDecoded, getProcessedPhotoImage, _resetPhotoStateForTests } from '../bspline-frame-builder/b-spline-gen/html/core/photo/state.js';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/photo/codec.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, decodeImageToGrey: vi.fn(async (url) => globalThis.__fakeDecoded[url]) };
});
const PHOTO = 'data:mapping';
beforeAll(async () => {
  _resetPhotoStateForTests();
  const w = 37, h = 29;
  globalThis.__fakeDecoded = { [PHOTO]: { data: Float32Array.from({ length: w * h }, (_, k) => k / (w * h)), w, h } }; // every pixel distinct
  await ensurePhotoDecoded(PHOTO);
});
const TWEAKS = [{}, { rotation: 33, scale: 1.7, offsetX: 0.12, offsetY: -0.08 }, { rotation: -120, scale: 0.6, repeat: 1 }, { scale: 2.4, offsetX: -0.3 }];
const paramsOf = (t) => ({ photoImageDataUrl: PHOTO, photoEdits: [], tweaks: t });

describe('photoPixelAt is the pixel fn reads', () => {
  it('fn = depth(img[photoPixelAt]) at many points, every tweak set', () => {
    for (const t of TWEAKS) {
      const p = paramsOf({ ...t, depth: 1 }), img = getProcessedPhotoImage(p);
      for (let k = 0; k < 400; k++) {
        const su = (k * 0.6180339) % 1.3 - 0.15, sv = (k * 0.4142135) % 1.3 - 0.15;
        expect(fn(su, sv, 7 / 9, p)).toBe(Math.max(0, Math.min(1, img.data[photoPixelAt(su, sv, 7 / 9, p, img)])));
      }
    }
  });
  it('no image: -1', () => { expect(photoPixelAt(0.5, 0.5, 1, paramsOf({}), null)).toBe(-1); });
});

describe('photoSampleOf inverts it: an image point lands where the sampler reads that pixel', () => {
  it('within one pixel, every tweak set and aspect', () => {
    for (const aspect of [7 / 9, 12 / 9]) for (const t of TWEAKS) {
      const p = paramsOf(t), img = getProcessedPhotoImage(p);
      for (let k = 1; k < 60; k++) {
        const u = 0.05 + ((k * 0.618) % 0.9), v = 0.05 + ((k * 0.414) % 0.9);
        const { su, sv } = photoSampleOf(u, v, aspect, p, img);
        const i = photoPixelAt(su, sv, aspect, p, img);
        expect(Math.abs((i % img.w) - Math.floor(u * img.w)), `${JSON.stringify(t)} u`).toBeLessThanOrEqual(1);
        expect(Math.abs(Math.floor(i / img.w) - Math.floor(v * img.h)), `${JSON.stringify(t)} v`).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('foldUV / unfoldUV: the board -> sample step, and back per mirror copy', () => {
  const CASES = [{}, { mapZoom: 2, seedOffsetX: 0.1, seedOffsetY: -0.05 }, { symmetry: 'x', symOffsetX: 0.1 }, { symmetry: 'radial', mapZoom: 0.75, symOffsetY: -0.08 }];
  it('every board point comes back from its own copy', () => {
    for (const c of CASES) {
      const params = { ...c };
      for (let k = 0; k < 200; k++) {
        const u = (k * 0.618) % 1, v = (k * 0.414) % 1;
        const f = foldUV(u, v, params);
        const sx = f.zu >= 0.5 + (c.symOffsetX || 0) ? 1 : -1, sy = f.zv >= 0.5 + (c.symOffsetY || 0) ? 1 : -1;
        const b = unfoldUV(f.su, f.sv, params, sx, sy);
        expect(b.u).toBeCloseTo(u, 9); expect(b.v).toBeCloseTo(v, 9);
      }
    }
  });
  it('the fold: a mirrored pair samples the same point (Symmetry X)', () => {
    const params = { symmetry: 'x' };
    const a = foldUV(0.3, 0.4, params), b = foldUV(0.7, 0.4, params);
    expect(a.su).toBeCloseTo(b.su, 12); expect(a.sv).toBe(b.sv);
  });
  it('fills a given out object (the heightmap reuses one)', () => {
    const out = {};
    expect(foldUV(0.2, 0.3, {}, out)).toBe(out);
    expect(out).toEqual({ zu: 0.2, zv: 0.3, su: 0.2, sv: 0.3, mu: 0.2, mv: 0.3 });
  });
});

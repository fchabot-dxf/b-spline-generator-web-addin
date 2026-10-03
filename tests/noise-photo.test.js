/**
 * F34 item 1 — core/noise/photo.js: the 'photo' filter's own fn() contract.
 * Canvas-free (mocks core/photo/codec.js's decodeImageToGrey, the one
 * function that actually touches a real <canvas>/<img> -- see that file's
 * own header comment) so this exercises real logic: registration,
 * neutral-when-empty, and sampling the processed image.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NoiseModes, NoiseLabels, NoiseList } from '../bspline-frame-builder/b-spline-gen/html/core/noise/index.js';
import * as photo from '../bspline-frame-builder/b-spline-gen/html/core/noise/photo.js';
import { ensurePhotoDecoded, _resetPhotoStateForTests } from '../bspline-frame-builder/b-spline-gen/html/core/photo/state.js';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/photo/codec.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, decodeImageToGrey: vi.fn(async (url) => globalThis.__fakeDecoded[url]) };
});

beforeEach(() => {
  _resetPhotoStateForTests();
  globalThis.__fakeDecoded = {};
});

describe('photo.js: registered in the filter registry', () => {
  it('is in NoiseModes/NoiseLabels/NoiseList, next to the other filters', () => {
    expect(NoiseModes.photo).toBe(photo.fn);
    expect(NoiseLabels.photo).toBe('Photo');
    expect(NoiseList.find((m) => m.id === 'photo')).toEqual({ id: 'photo', label: 'Photo' });
  });
});

describe('photo.js: fn() contract', () => {
  it('returns a neutral 0.5 when no photo is loaded', () => {
    expect(photo.fn(0.5, 0.5, 7 / 9, { photoImageDataUrl: null, photoEdits: [] })).toBe(0.5);
  });

  it('returns 0.5 while the image is still decoding (not yet in the cache)', () => {
    // ensurePhotoDecoded is never awaited here -- simulates mid-flight.
    globalThis.__fakeDecoded['data:fake'] = { data: Float32Array.from([0, 1]), w: 2, h: 1 };
    ensurePhotoDecoded('data:fake');
    expect(photo.fn(0.9, 0.5, 1, { photoImageDataUrl: 'data:fake', photoEdits: [] })).toBe(0.5);
  });

  it('samples the processed (decoded) image at (su, sv) once ready', async () => {
    globalThis.__fakeDecoded['data:fake2'] = { data: Float32Array.from([0, 1, 0.5, 0.25]), w: 2, h: 2 };
    await ensurePhotoDecoded('data:fake2');
    const params = { photoImageDataUrl: 'data:fake2', photoEdits: [] };
    expect(photo.fn(0.0, 0.0, 1, params)).toBe(0);    // top-left
    expect(photo.fn(0.9, 0.0, 1, params)).toBe(1);    // top-right
    expect(photo.fn(0.0, 0.9, 1, params)).toBe(0.5);  // bottom-left
    expect(photo.fn(0.9, 0.9, 1, params)).toBe(0.25); // bottom-right
  });

  it('clamps out-of-[0,1] su/sv to the image edge rather than tiling', async () => {
    globalThis.__fakeDecoded['data:fake3'] = { data: Float32Array.from([0.1, 0.9]), w: 2, h: 1 };
    await ensurePhotoDecoded('data:fake3');
    const params = { photoImageDataUrl: 'data:fake3', photoEdits: [] };
    expect(photo.fn(-5, 0, 1, params)).toBeCloseTo(0.1, 6); // Float32Array precision
    expect(photo.fn(5, 0, 1, params)).toBeCloseTo(0.9, 6);
  });

  it('declares no tweaks (crop/levels/etc. are NOT sliders in the generic Edit-Filter schema)', () => {
    expect(photo.tweaks).toEqual([]);
  });
});

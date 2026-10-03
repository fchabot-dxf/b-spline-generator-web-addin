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

  it('declares its own effect params (depth/scale/offset/rotation/repeat) via the generic tweaks schema -- NOT the editor\'s own crop/levels/etc., which are not sliders', () => {
    const keys = photo.tweaks.map((t) => t.key).sort();
    expect(keys).toEqual(['depth', 'offsetX', 'offsetY', 'repeat', 'rotation', 'scale'].sort());
  });

  it('every declared tweak default reproduces the pre-tweak identity sampling (no visible change from registering them)', () => {
    globalThis.__fakeDecoded['data:tw'] = { data: Float32Array.from([0, 1, 0.5, 0.25]), w: 2, h: 2 };
    return ensurePhotoDecoded('data:tw').then(() => {
      const base = { photoImageDataUrl: 'data:tw', photoEdits: [] };
      const withDefaults = { ...base, tweaks: Object.fromEntries(photo.tweaks.map((t) => [t.key, t.default])) };
      for (const [su, sv] of [[0, 0], [0.9, 0], [0, 0.9], [0.9, 0.9], [0.3, 0.7]]) {
        expect(photo.fn(su, sv, 1, withDefaults)).toBeCloseTo(photo.fn(su, sv, 1, base), 6);
      }
    });
  });
});

describe('photo.js: the effect-param tweaks (depth/scale/offset/rotation/repeat)', () => {
  const GRID4 = { data: Float32Array.from([0, 1 / 3, 2 / 3, 1, 1 / 3, 2 / 3, 1, 0, 2 / 3, 1, 0, 1 / 3, 1, 0, 1 / 3, 2 / 3]), w: 4, h: 4 };

  beforeEach(async () => {
    globalThis.__fakeDecoded['data:grid4'] = GRID4;
    await ensurePhotoDecoded('data:grid4');
  });

  const sampleWith = (tweaks, su = 0.5, sv = 0.5) =>
    photo.fn(su, sv, 1, { photoImageDataUrl: 'data:grid4', photoEdits: [], tweaks });

  it('depth=1 is unchanged; depth>1 pushes values further from mid-grey; depth=0 flattens to mid-grey', () => {
    // su=0.3,sv=0 hits grid index (i=1,j=0) = 1/3 -- NOT already clamped at 0 or 1, so depth=2 has
    // visible room to push it further from mid-grey without saturating.
    const raw = photo.fn(0.3, 0, 1, { photoImageDataUrl: 'data:grid4', photoEdits: [] }); // 1/3
    expect(raw).toBeCloseTo(1 / 3, 6);
    expect(sampleWith({ depth: 1 }, 0.3, 0)).toBeCloseTo(raw, 6);
    expect(sampleWith({ depth: 0 }, 0.3, 0)).toBeCloseTo(0.5, 6);
    expect(sampleWith({ depth: 2 }, 0.3, 0)).toBeLessThan(raw); // further below 0.5 than the raw value
  });

  it('scale > 1 zooms in: a point near the edge samples closer to the image centre', () => {
    const base = photo.fn(0.9, 0.5, 1, { photoImageDataUrl: 'data:grid4', photoEdits: [] });
    const zoomed = sampleWith({ scale: 2 }, 0.9, 0.5);
    // Zoomed in, su=0.9 maps to u = 0.5 + (0.9-0.5)/2 = 0.7, pulled toward centre -- a different pixel
    // than the un-zoomed (clamped-to-edge-ish) sample, for this clearly-varying test image.
    expect(zoomed).not.toBe(base);
  });

  it('offsetX pans the sampled column', () => {
    const left = photo.fn(0.25, 0.5, 1, { photoImageDataUrl: 'data:grid4', photoEdits: [] });
    const shifted = sampleWith({ offsetX: 0.25 }, 0, 0.5); // su=0 + offsetX=0.25 -> same u as su=0.25, offsetX=0
    expect(shifted).toBeCloseTo(left, 6);
  });

  it('rotation=180 degrees samples the point-mirrored pixel', () => {
    const corner = photo.fn(0.0, 0.0, 1, { photoImageDataUrl: 'data:grid4', photoEdits: [] });
    const oppositeCorner = photo.fn(1.0, 1.0, 1, { photoImageDataUrl: 'data:grid4', photoEdits: [] });
    expect(sampleWith({ rotation: 180 }, 0.0, 0.0)).toBeCloseTo(oppositeCorner, 6);
    expect(corner).not.toBeCloseTo(oppositeCorner, 6); // sanity: the test image isn't 180-symmetric
  });

  it('NEVER STRETCHES: one image pixel costs the SAME isotropic board distance in X as in Y, at both a 6x9 and a 9x12 board aspect (Fred: "a brick must never look stretched, whatever the board size or shape")', () => {
    // su_per_pixel * aspect (isotropic X distance per pixel) must equal
    // sv_per_pixel (isotropic Y distance per pixel) -- that equality IS the
    // "no separate x/y scale" property, regardless of the board's own aspect.
    const imgW = 40, imgH = 10; // a non-square (4:1) test image, like a brick's own proportions
    // Scan outward in small steps until the sampled pixel changes (every pixel in the ramp
    // image below has a unique value) -- a direct, empirical measurement of "how much su/sv
    // is one image pixel", not a re-derivation of the sampling formula.
    const sample = (aspect, su, sv) => photo.fn(su, sv, aspect, { photoImageDataUrl: 'data:aspect', photoEdits: [] });
    const stepFor = (aspect, axis) => {
      const STEP = 1e-5;
      let su = 0.5, sv = 0.5;
      const start = sample(aspect, su, sv);
      let steps = 0;
      while (steps < 200000) {
        if (axis === 'x') su += STEP; else sv += STEP;
        steps++;
        if (sample(aspect, su, sv) !== start) break;
      }
      return steps * STEP; // su (or sv) distance for one pixel step
    };

    globalThis.__fakeDecoded = { 'data:aspect': { data: Float32Array.from(Array.from({ length: imgW * imgH }, (_, k) => k / (imgW * imgH - 1))), w: imgW, h: imgH } };
    return ensurePhotoDecoded('data:aspect').then(() => {
      for (const aspect of [6 / 9, 9 / 12]) {
        const suPerPixel = stepFor(aspect, 'x');
        const svPerPixel = stepFor(aspect, 'y');
        const isoX = suPerPixel * aspect;
        const isoY = svPerPixel;
        expect(Math.abs(isoX - isoY) / isoY, `aspect=${aspect}`).toBeLessThan(0.02); // within 2%
      }
    });
  });

  it('repeat=0 (default) clamps past the edge; repeat=1 tiles instead', () => {
    const edgeValue = photo.fn(1.0, 0.5, 1, { photoImageDataUrl: 'data:grid4', photoEdits: [] });
    const clamped = sampleWith({ scale: 1, offsetX: 0.3, repeat: 0 }, 1.0, 0.5); // pushed past u=1
    expect(clamped).toBeCloseTo(edgeValue, 6);
    const tiled = sampleWith({ scale: 1, offsetX: 0.3, repeat: 1 }, 1.0, 0.5); // wraps back near u=0.3
    expect(tiled).not.toBeCloseTo(clamped, 6);
  });
});

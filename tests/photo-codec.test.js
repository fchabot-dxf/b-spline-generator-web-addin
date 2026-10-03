/**
 * F34 item 1 — core/photo/codec.js's own PURE half (rgbToGrey). The rest of
 * that file (decodeImageToGrey, encodeGreyToDataUrl) touches a real
 * <canvas>/<img> this repo's test environment cannot execute (see the
 * file's own header comment) and is verified live instead.
 */
import { describe, it, expect } from 'vitest';
import { rgbToGrey, PHOTO_MAX_DIM } from '../bspline-frame-builder/b-spline-gen/html/core/photo/codec.js';

describe('rgbToGrey: ITU-R BT.601 luma', () => {
  it('black is 0, white is 1', () => {
    expect(rgbToGrey(0, 0, 0)).toBe(0);
    expect(rgbToGrey(255, 255, 255)).toBeCloseTo(1, 9);
  });

  it('pure green reads brighter than pure red or blue (perceptual weighting, not a flat average)', () => {
    const r = rgbToGrey(255, 0, 0);
    const g = rgbToGrey(0, 255, 0);
    const b = rgbToGrey(0, 0, 255);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    expect(r).toBeGreaterThan(b); // 0.299 > 0.114
  });

  it('matches the declared 0.299/0.587/0.114 weights exactly', () => {
    expect(rgbToGrey(100, 150, 200)).toBeCloseTo((0.299 * 100 + 0.587 * 150 + 0.114 * 200) / 255, 12);
  });
});

describe('PHOTO_MAX_DIM: declared, sane', () => {
  it('is a positive number comfortably above any real terrain grid size', () => {
    expect(PHOTO_MAX_DIM).toBeGreaterThan(64);
  });
});

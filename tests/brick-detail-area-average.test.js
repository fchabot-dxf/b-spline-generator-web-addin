/**
 * Item 37 (seat E, measured): a brick sample's detail field was downsampled by the browser (drawImage's scaler), which
 * differs by canvas backend (GPU vs software: all 47 sample grids moved) and from page load to page load (7 of 47
 * moved under load, and stayed moved) -- so a reload of the same board carved a different 3D. The downsample is now
 * plain arithmetic on the decoded pixels (areaAverageGrey): these rows pin its numbers.
 */
import { describe, it, expect } from 'vitest';
import { areaAverageGrey } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-surface.js';

/** An RGBA image whose every pixel is grey `v(x, y)` (0..255). */
function greyImage(w, h, v) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4, g = v(x, y);
    rgba[o] = g; rgba[o + 1] = g; rgba[o + 2] = g; rgba[o + 3] = 255;
  }
  return rgba;
}

describe('areaAverageGrey: the detail field is the mean of the source pixels under each cell', () => {
  it('4x4 -> 2x2: each cell is the mean of its own 2x2 block', () => {
    const rgba = greyImage(4, 4, (x, y) => (x < 2 ? 0 : 200) + (y < 2 ? 0 : 50));
    const out = areaAverageGrey(rgba, 4, 0, 0, 4, 4, 2);
    expect(Array.from(out).map((v) => Math.round(v * 255))).toEqual([0, 200, 50, 250]);
  });

  it('a centre crop reads only the pixels inside it', () => {
    // 6 wide: columns 0 and 5 are white, the centre 4 columns are 0,40,80,120; crop x 1..5 -> 2 cells: (0+40)/2, (80+120)/2
    const rgba = greyImage(6, 2, (x) => (x === 0 || x === 5 ? 255 : (x - 1) * 40));
    const out = areaAverageGrey(rgba, 6, 1, 0, 4, 2, 2);
    expect(Math.round(out[0] * 255)).toBe(20);
    expect(Math.round(out[1] * 255)).toBe(100);
  });

  it('upsampling (grid finer than the crop) takes the nearest pixel, never an empty cell', () => {
    const rgba = greyImage(2, 2, (x, y) => (x + 2 * y) * 60);
    const out = areaAverageGrey(rgba, 2, 0, 0, 2, 2, 4);
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
    expect(Math.round(out[0] * 255)).toBe(0);
    expect(Math.round(out[15] * 255)).toBe(180);
  });

  it('the same pixels give the same field, call after call (no browser in the loop)', () => {
    const rgba = greyImage(97, 61, (x, y) => (x * 7 + y * 13) % 256);
    const a = areaAverageGrey(rgba, 97, 10.5, 3.25, 70, 50, 48);
    const b = areaAverageGrey(rgba, 97, 10.5, 3.25, 70, 50, 48);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a.length).toBe(48 * 48);
  });
});

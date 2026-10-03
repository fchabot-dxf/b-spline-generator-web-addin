import { describe, it, expect } from 'vitest';
import { applyPhotoEdits, OP_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/core/photo/ops.js';

// A tiny synthetic image: row-major, data[j*w+i]. Exact pixel expectations
// below are hand-derived (see WORK-LOG-fb-app.md's own F34 item 1 entry for
// the rotate90 derivation), not just "whatever the code happens to produce".
const img = (data, w, h) => ({ data: Float32Array.from(data), w, h });
const arr = (image) => Array.from(image.data);

describe('photo/ops.js: each op on a tiny synthetic image gives the expected pixels', () => {
  it('crop: a fractional sub-rectangle of a 3x3 image', () => {
    const base = img([0, 1, 2, 3, 4, 5, 6, 7, 8].map((v) => v / 8), 3, 3);
    const out = applyPhotoEdits(base, [{ op: 'crop', params: { x: 1 / 3, y: 1 / 3, w: 1 / 3, h: 1 / 3 } }]);
    expect(out.w).toBe(1);
    expect(out.h).toBe(1);
    expect(arr(out)).toEqual([4 / 8]);
  });

  it('crop: the top-left half of a 4x2 image', () => {
    const base = img([0, 1, 2, 3, 4, 5, 6, 7], 4, 2);
    const out = applyPhotoEdits(base, [{ op: 'crop', params: { x: 0, y: 0, w: 0.5, h: 1 } }]);
    expect([out.w, out.h]).toEqual([2, 2]);
    expect(arr(out)).toEqual([0, 1, 4, 5]);
  });

  it('rotate90 clockwise: top-left ends up top-right (2x2)', () => {
    // 0 1        2 0
    // 2 3   ->   3 1
    const base = img([0, 1, 2, 3], 2, 2);
    const out = applyPhotoEdits(base, [{ op: 'rotate90', params: { dir: 1 } }]);
    expect([out.w, out.h]).toEqual([2, 2]);
    expect(arr(out)).toEqual([2, 0, 3, 1]);
  });

  it('rotate90 counter-clockwise: the exact inverse of clockwise', () => {
    // 0 1        1 3
    // 2 3   ->   0 2
    const base = img([0, 1, 2, 3], 2, 2);
    const out = applyPhotoEdits(base, [{ op: 'rotate90', params: { dir: -1 } }]);
    expect(arr(out)).toEqual([1, 3, 0, 2]);
    // four CCW turns is the identity
    let roundTrip = base;
    for (let i = 0; i < 4; i++) roundTrip = applyPhotoEdits(roundTrip, [{ op: 'rotate90', params: { dir: -1 } }]);
    expect(arr(roundTrip)).toEqual(arr(base));
  });

  it('rotate90 swaps non-square dimensions (2x1 -> 1x2)', () => {
    const base = img([0, 1], 2, 1);
    const out = applyPhotoEdits(base, [{ op: 'rotate90', params: { dir: 1 } }]);
    expect([out.w, out.h]).toEqual([1, 2]);
    expect(arr(out)).toEqual([0, 1]);
  });

  it('straighten at 0 degrees is a no-op', () => {
    const base = img([0, 1, 2, 3], 2, 2);
    expect(arr(applyPhotoEdits(base, [{ op: 'straighten', params: { degrees: 0 } }]))).toEqual(arr(base));
  });

  it('straighten expands the canvas to fit the fully-rotated source (45deg of a square doubles toward its diagonal)', () => {
    const base = img(new Array(16).fill(0.5), 4, 4);
    const out = applyPhotoEdits(base, [{ op: 'straighten', params: { degrees: 45 } }]);
    const expectedSide = Math.round(4 * Math.SQRT2);
    expect(out.w).toBe(expectedSide);
    expect(out.h).toBe(expectedSide);
  });

  it('straighten at exactly 90deg approximates rotate90Op\'s own already-proven clockwise result (same sign convention, confirmed empirically rather than re-derived)', () => {
    // A bigger, non-constant image so bilinear interpolation at a few border
    // pixels can't accidentally make a WRONG sign convention look right.
    const n = 10;
    const data = Array.from({ length: n * n }, (_, k) => (k % n) / (n - 1));
    const base = img(data, n, n);
    const exact = applyPhotoEdits(base, [{ op: 'rotate90', params: { dir: 1 } }]);
    const free = applyPhotoEdits(base, [{ op: 'straighten', params: { degrees: 90 } }]);
    expect([free.w, free.h]).toEqual([exact.w, exact.h]);
    // Compare interior pixels only (bilinear sampling softens the exact edges/corners a little).
    for (let j = 2; j < exact.h - 2; j++) {
      for (let i = 2; i < exact.w - 2; i++) {
        expect(free.data[j * free.w + i]).toBeCloseTo(exact.data[j * exact.w + i], 1);
      }
    }
  });

  it('straighten fills the newly-exposed corners with neutral mid-grey (0.5), not the edge pixel or black', () => {
    const base = img(new Array(16).fill(1), 4, 4); // a solid WHITE square
    const out = applyPhotoEdits(base, [{ op: 'straighten', params: { degrees: 30 } }]);
    // The output's own corner (0,0) is outside the rotated white square for a 30deg turn of a
    // square -- must be the declared neutral fill, not accidentally sampled from the white source.
    expect(out.data[0]).toBeCloseTo(0.5, 6);
  });

  it('flip h mirrors left-right, flip v mirrors top-bottom', () => {
    const base = img([0, 1, 2, 3], 2, 2); // row0=[0,1] row1=[2,3]
    expect(arr(applyPhotoEdits(base, [{ op: 'flip', params: { axis: 'h' } }]))).toEqual([1, 0, 3, 2]);
    expect(arr(applyPhotoEdits(base, [{ op: 'flip', params: { axis: 'v' } }]))).toEqual([2, 3, 0, 1]);
  });

  it('flip is its own inverse', () => {
    const base = img([0, 1, 2, 3, 4, 5], 3, 2);
    const back = applyPhotoEdits(base, [
      { op: 'flip', params: { axis: 'h' } },
      { op: 'flip', params: { axis: 'h' } },
    ]);
    expect(arr(back)).toEqual(arr(base));
  });

  it('levels: black/white point normalizes, gamma=1 is linear', () => {
    const base = img([0, 0.25, 0.5, 0.75, 1], 5, 1);
    const out = applyPhotoEdits(base, [{ op: 'levels', params: { black: 0.25, white: 0.75, mid: 1 } }]);
    expect(arr(out).map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 0, 0.5, 1, 1]);
  });

  it('levels: mid (gamma) bends the midtones', () => {
    const base = img([0, 0.25, 1], 3, 1);
    const out = applyPhotoEdits(base, [{ op: 'levels', params: { black: 0, white: 1, mid: 2 } }]);
    const expected = [0, Math.sqrt(0.25), 1];
    arr(out).forEach((v, i) => expect(v).toBeCloseTo(expected[i], 9));
  });

  it('brightnessContrast: contrast steepens around mid-grey, brightness shifts', () => {
    const base = img([0.25, 0.5, 0.75], 3, 1);
    const out = applyPhotoEdits(base, [{ op: 'brightnessContrast', params: { contrast: 1, brightness: 0 } }]);
    expect(arr(out).map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 0.5, 1]);
    const out2 = applyPhotoEdits(base, [{ op: 'brightnessContrast', params: { contrast: 1, brightness: 0.1 } }]);
    expect(arr(out2).map((v) => Math.round(v * 1000) / 1000)).toEqual([0.1, 0.6, 1]);
  });

  it('blur: a box blur spreads a single bright pixel into its neighbours, edge-clamped', () => {
    const base = img([0, 0, 1, 0, 0], 5, 1);
    const out = applyPhotoEdits(base, [{ op: 'blur', params: { radius: 1 } }]);
    const third = 1 / 3;
    // Float32Array precision (~7 sig figs), not a real tolerance gap -- data is Float32, not Float64.
    arr(out).forEach((v, i) => expect(v).toBeCloseTo([0, third, third, third, 0][i], 6));
  });

  it('blur with radius 0 is a no-op', () => {
    const base = img([0, 0.4, 1], 3, 1);
    const out = applyPhotoEdits(base, [{ op: 'blur', params: { radius: 0 } }]);
    expect(arr(out)).toEqual(arr(base));
  });

  it('invert flips every pixel around 0.5', () => {
    const base = img([0, 0.3, 1], 3, 1);
    const out = applyPhotoEdits(base, [{ op: 'invert', params: {} }]);
    // Float32Array precision (~7 sig figs), not a real tolerance gap.
    arr(out).forEach((v, i) => expect(v).toBeCloseTo([1, 0.7, 0][i], 6));
  });

  it('applyPhotoEdits composes an ordered list, and order changes the result', () => {
    const base = img([0, 1, 2, 3], 2, 2);
    const cropThenRotate = applyPhotoEdits(base, [
      { op: 'crop', params: { x: 0, y: 0, w: 0.5, h: 1 } }, // left column: [0, 2], 1x2
      { op: 'rotate90', params: { dir: 1 } },
    ]);
    const rotateThenCrop = applyPhotoEdits(base, [
      { op: 'rotate90', params: { dir: 1 } },
      { op: 'crop', params: { x: 0, y: 0, w: 0.5, h: 1 } },
    ]);
    expect([cropThenRotate.w, cropThenRotate.h]).toEqual([2, 1]);
    expect(arr(cropThenRotate)).toEqual([2, 0]);
    expect([rotateThenCrop.w, rotateThenCrop.h]).toEqual([1, 2]);
    expect(arr(rotateThenCrop)).not.toEqual(arr(cropThenRotate));
  });

  it('an unknown op id is a no-op (forward-compat with a retired op name)', () => {
    const base = img([0, 0.5, 1], 3, 1);
    const out = applyPhotoEdits(base, [{ op: 'nonexistent', params: { whatever: 1 } }]);
    expect(arr(out)).toEqual(arr(base));
  });

  it('an empty or missing step list returns the base image unchanged', () => {
    const base = img([0, 0.5, 1], 3, 1);
    expect(arr(applyPhotoEdits(base, []))).toEqual(arr(base));
    expect(arr(applyPhotoEdits(base, undefined))).toEqual(arr(base));
  });

  it('OP_DEFAULTS declares every op id applyPhotoEdits understands', () => {
    const ids = ['crop', 'rotate90', 'straighten', 'flip', 'levels', 'brightnessContrast', 'blur', 'invert'];
    expect(Object.keys(OP_DEFAULTS).sort()).toEqual(ids.sort());
  });
});

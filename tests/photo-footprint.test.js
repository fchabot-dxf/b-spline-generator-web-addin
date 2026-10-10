/**
 * 2026-10-10 (Fred's picks, via the advisor): the photo's footprint on the editor's board (main/photo-footprint.js) --
 * where the photo lands (the sampler's own mapping inverted), the start placement, and what a move / scale / rotate drag
 * writes. 'whole' (core/terrain.js PHOTO_MIRROR_MODES): the whole photo, unsqueezed, cover-fitted to the source half.
 */
import { describe, it, expect } from 'vitest';
import { photoFootprint, snapRotation, dragPlacement, offsetsForCentre, fitRegionOf, PHOTO_GIZMO } from '../bspline-frame-builder/b-spline-gen/html/main/photo-footprint.js';
import { generateHeightmap } from '../bspline-frame-builder/b-spline-gen/html/core/terrain.js';
import { NoiseModes } from '../bspline-frame-builder/b-spline-gen/html/core/noise/index.js';
import { photoPixelAt } from '../bspline-frame-builder/b-spline-gen/html/core/noise/photo.js';
import { withFitExtra } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-view.js';

const IMG = { w: 40, h: 60, data: new Float32Array(40 * 60) }; // a portrait photo, 2 : 3
const BOARD = { widthIn: 7, heightIn: 9, mapZoom: 1, seedOffsetX: 0, seedOffsetY: 0, symOffsetX: 0, symOffsetY: 0, photoOrientation: 'upright' };
const board = (symmetry, mode = 'whole') => ({ ...BOARD, symmetry, photoMirrorMode: mode });
const close = (a, b, d = 9) => { expect(a[0]).toBeCloseTo(b[0], d); expect(a[1]).toBeCloseTo(b[1], d); };
const size = (pts) => [Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]), Math.hypot(pts[3][0] - pts[0][0], pts[3][1] - pts[0][1])];
const topAngle = (fp) => Math.atan2(fp.top[1] - fp.centre[1], fp.top[0] - fp.centre[0]) * 180 / Math.PI;

describe('where the photo starts (offsets 0, scale 1, rotation 0)', () => {
  it('no Symmetry: centred on the board, cover-fitted (a 2 : 3 photo on 7 x 9: its width binds), unsqueezed', () => {
    const fp = photoFootprint(board('none'), {}, IMG);
    close(fp.centre, [3.5, 4.5]);
    const [w, h] = size(fp.copies[0].pts);
    expect(w).toBeCloseTo(7, 9); expect(h).toBeCloseTo(10.5, 9);
    expect([fp.axisX, fp.axisY, fp.copies.length]).toEqual([null, null, 1]);
  });
  it("Mirror X, 'whole' (Fred: Fill): centred in the source half, filling it, unsqueezed; the mirror copy across the axis", () => {
    const fp = photoFootprint(board('x'), {}, IMG);
    expect(fp.axisX).toBeCloseTo(3.5, 9);
    close(fp.centre, [5.25, 4.5]); // the middle of the right (source) half
    const [w, h] = size(fp.copies[0].pts);
    expect(h).toBeCloseTo(9, 9); expect(w / h).toBeCloseTo(40 / 60, 9); // a 3.5 x 9 half: its height binds, sides run past
    expect(fp.copies.length).toBe(2);
    for (let k = 0; k < 4; k++) close(fp.copies[1].pts[k], [7 - fp.copies[0].pts[k][0], fp.copies[0].pts[k][1]]);
  });
  it("Mirror Y, 'whole': centred in the source (top) half", () => {
    close(photoFootprint(board('y'), {}, IMG).centre, [3.5, 2.25]);
  });
  it("'squeeze' (legacy): the photo cover-fitted to the whole board, then squeezed into the half (half as wide)", () => {
    const sq = size(photoFootprint(board('x', 'squeeze'), {}, IMG).copies[0].pts);
    expect(sq[1]).toBeCloseTo(10.5, 9); expect(sq[0] / sq[1]).toBeCloseTo(40 / 60 / 2, 9);
  });
});

describe('the footprint is where the sampler reads the photo', () => {
  // generateHeightmap's photo samples, read through the sampler: the image pixel each board point sees
  it("Mirror X 'whole': a board point inside the source copy reads the image pixel the footprint puts there", () => {
    const st = board('x'), tweaks = { scale: 0.8, offsetX: 0.05, rotation: 20 };
    const fp = photoFootprint(st, tweaks, IMG);
    const seen = [];
    const real = NoiseModes.photo;
    NoiseModes.photo = (su, sv, aspect, params, refs) => { seen.push(photoPixelAt(su, sv, aspect, params, IMG)); return 0.5; };
    try {
      generateHeightmap({ ...st, seed: 1, scale: 3, macroScale: 0.65, octaves: 2, roughness: 0.5, edgeMargin: 0, carveZ: 1, warpIntensity: 0,
        noiseType: 'simplex', photoLayer: true, photoImageDataUrl: 'x', photoEdits: [], filterTweaks: { photo: tweaks }, nx: 71, nz: 91 });
    } finally { NoiseModes.photo = real; }
    // the image centre's pixel is read at the footprint's centre (grid i = x / 7 * 70, row j = (1 - y / 9) * 90)
    const [cx, cy] = fp.centre, i = Math.round(cx / 7 * 70), j = Math.round((1 - cy / 9) * 90);
    const px = seen[j * 71 + i], col = px % IMG.w, row = Math.floor(px / IMG.w);
    expect(Math.abs(col - IMG.w / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(row - IMG.h / 2)).toBeLessThanOrEqual(1);
  });
});

describe('a drag', () => {
  const st = board('x'), t0 = { scale: 0.7, offsetX: 0.03, offsetY: -0.02, rotation: 10 };
  it('move: the footprint follows the pointer exactly', () => {
    const before = photoFootprint(st, t0, IMG).centre;
    const t = dragPlacement(st, t0, IMG, 'move', [5, 5], [5.4, 4.3]);
    close(photoFootprint(st, t, IMG).centre, [before[0] + 0.4, before[1] - 0.7]);
    expect([t.scale, t.rotation]).toEqual([0.7, 10]);
  });
  it('corner: scales about the centre (the centre stays), by the pointer distance ratio', () => {
    const fp = photoFootprint(st, t0, IMG), C = fp.centre, c0 = fp.copies[0].pts[2];
    const p = [C[0] + (c0[0] - C[0]) * 1.5, C[1] + (c0[1] - C[1]) * 1.5];
    const t = dragPlacement(st, t0, IMG, 'corner', c0, p);
    expect(t.scale).toBeCloseTo(0.7 * 1.5, 9);
    close(photoFootprint(st, t, IMG).centre, C);
    close(photoFootprint(st, t, IMG).copies[0].pts[2], p);
  });
  it('corner: scale stays in the Scale slider range', () => {
    const fp = photoFootprint(st, t0, IMG), C = fp.centre, c0 = fp.copies[0].pts[2];
    const far = dragPlacement(st, t0, IMG, 'corner', c0, [C[0] + (c0[0] - C[0]) * 100, C[1] + (c0[1] - C[1]) * 100]);
    expect(far.scale).toBe(3);
  });
  it('rotate: the knob turns the footprint by the pointer angle, the same way on screen, about the centre', () => {
    for (const orient of ['upright', 'legacy-flipped']) {
      const s = { ...st, photoOrientation: orient };
      const fp = photoFootprint(s, t0, IMG), C = fp.centre;
      const p0 = [C[0], C[1] - 2], turn = 37 * Math.PI / 180; // a clockwise turn on screen (y down)
      const p = [C[0] + 2 * Math.sin(turn), C[1] - 2 * Math.cos(turn)];
      const t = dragPlacement(s, t0, IMG, 'rotate', p0, p);
      const after = photoFootprint(s, t, IMG);
      close(after.centre, C);
      expect(((topAngle(after) - topAngle(fp) + 540) % 360) - 180).toBeCloseTo(37, 6);
    }
  });
  it('rotate: snaps within 3 degrees of 0 / 90 / 180 / -90', () => {
    expect([snapRotation(2.9), snapRotation(-2.9), snapRotation(87.5), snapRotation(-92), snapRotation(178), snapRotation(-178)]).toEqual([0, 0, 90, -90, 180, 180]);
    expect([snapRotation(3.5), snapRotation(45), snapRotation(190)]).toEqual([3.5, 45, -170]);
    expect(PHOTO_GIZMO.snapDeg).toBe(3);
  });
  it('offsetsForCentre is exact under a Map Zoom / pan and radial symmetry too', () => {
    const s = { ...board('radial'), mapZoom: 1.3, seedOffsetX: 0.04, symOffsetY: 0.1 };
    const o = offsetsForCentre(s, t0, IMG, [4.2, 1.7]);
    close(photoFootprint(s, { ...t0, ...o }, IMG).centre, [4.2, 1.7]);
  });
});

describe('Fit on the Photo tab holds the footprint', () => {
  it('the fit region grows to the source copy (its handles) past the board edge', () => {
    const fp = photoFootprint(board('x'), {}, IMG), r = fitRegionOf(fp);
    const xs = fp.copies[0].pts.map((q) => q[0]);
    expect(Math.max(...xs)).toBeGreaterThan(7); // the Fill footprint runs past the board's right edge
    const grown = withFitExtra(null, { _mW: 7, _mH: 9, _fitExtraRegion: r });
    expect(grown.x).toBe(0); expect(grown.x + grown.w).toBeGreaterThan(Math.max(...xs));
    expect(withFitExtra(null, { _mW: 7, _mH: 9 })).toBe(null); // no overlay: Fit unchanged
  });
});

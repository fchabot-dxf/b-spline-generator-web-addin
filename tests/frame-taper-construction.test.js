/**
 * F30 item 3 (Fred's own taper copies): the shared `taperAngle` construction (editor-shape-lattice-generator.js's
 * `_taperedCorner`/`_taperRange`, exercised through `hourglassConstruction`/`bottleConstruction` and the
 * `hourglass`/`bottle` solvers) that Template 12 ("Hourglass - Tapered sides") and Template 13 ("Narrow Neck -
 * Tapered sides") will build on. The upper side (above the pinch) leans by `taperAngle` degrees from vertical:
 * positive narrows the top (leans in), negative widens it (leans out, pinned to the board's own side edge past
 * the point a free tangent line would cross it). 0 = Template 1/2 exactly. These tests exercise the SHARED
 * preset-level construction directly (generateSilhouette), not a template -- Templates 12/13 (not yet built) get
 * their own template-level tests once they exist.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { frameMiters } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { offsetOutlineInward } from '../bspline-frame-builder/b-spline-gen/html/editor/outline-offset.js';
import {
  generateSilhouette, outlineDefects, paramsFromShapeModel, feasibleParamRanges, FRAME_ONLY_PARAM_KEYS, PARAM_ORDER,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';

const tplOf = (id) => FRAME_DEFS.templates.find((t) => t.id === id);
const T1 = tplOf('template_1'), T2 = tplOf('template_2');
const T = 0.75; // the default frame thickness
const BOARDS = [[7, 9], [6, 9], [11, 14], [5, 7]]; // portrait only, Fred's current usage
const innerOf = (outerPrims) => offsetOutlineInward(outerPrims, T).filter((p) => !p.collapsed);

describe('taperAngle is frame-only, appended last', () => {
  it('declared in PARAM_ORDER and FRAME_ONLY_PARAM_KEYS for both presets', () => {
    expect(PARAM_ORDER.hourglass[PARAM_ORDER.hourglass.length - 1]).toBe('taperAngle');
    expect(PARAM_ORDER.bottle[PARAM_ORDER.bottle.length - 1]).toBe('taperAngle');
    expect(FRAME_ONLY_PARAM_KEYS).toContain('taperAngle');
  });

  it('absent from resolved params unless the caller sets it (T3\'s own rule, now shared by bottle)', () => {
    const region = { x: 0, y: 0, w: 7, h: 9 };
    const h = generateSilhouette(region, { preset: 'hourglass', params: {} });
    const b = generateSilhouette(region, { preset: 'bottle', params: {} });
    expect(h.params).not.toHaveProperty('taperAngle');
    expect(b.params).not.toHaveProperty('taperAngle');
    const h2 = generateSilhouette(region, { preset: 'hourglass', params: { taperAngle: 5 } });
    const b2 = generateSilhouette(region, { preset: 'bottle', params: { taperAngle: 5 } });
    expect(h2.params.taperAngle).toBeCloseTo(5, 9);
    expect(b2.params.taperAngle).toBeCloseTo(5, 9);
  });
});

describe('taperAngle 0 reproduces Template 1 / Template 2 bit for bit', () => {
  it.each(BOARDS)('%dx%d: hourglass primitives identical with and without an explicit taperAngle: 0', (W, H) => {
    const region = { x: 0, y: 0, w: W, h: H };
    const params = paramsFromShapeModel('hourglass', T1.shapeModel, region);
    const a = generateSilhouette(region, { preset: 'hourglass', params });
    const b = generateSilhouette(region, { preset: 'hourglass', params: { ...params, taperAngle: 0 } });
    expect(b.primitives).toEqual(a.primitives);
  });

  it.each(BOARDS)('%dx%d: bottle primitives identical with and without an explicit taperAngle: 0', (W, H) => {
    const region = { x: 0, y: 0, w: W, h: H };
    const params = paramsFromShapeModel('bottle', T2.shapeModel, region);
    const a = generateSilhouette(region, { preset: 'bottle', params });
    const b = generateSilhouette(region, { preset: 'bottle', params: { ...params, taperAngle: 0 } });
    expect(b.primitives).toEqual(a.primitives);
  });
});

describe('positive taper narrows the top, negative widens it (Fred, 2026-10-01)', () => {
  it('hourglass: the top corner\'s own x strictly decreases as taperAngle increases from 0 to +10 (positive: '
    + 'Branch A, a free tangent line -- see _taperedCorner\'s own doc comment); 0 and every negative angle tie '
    + 'at the board edge (MEASURED: T1 is already full board width at the top, so Branch B pins instantly)', () => {
    const region = { x: 0, y: 0, w: 7, h: 9 };
    const params = paramsFromShapeModel('hourglass', T1.shapeModel, region);
    const topX = (deg) => {
      const sil = generateSilhouette(region, { preset: 'hourglass', params: { ...params, taperAngle: deg } });
      const top = sil.primitives[sil.primitives.length - 1]; // the top edge (last piece, see _solveHourglass)
      return top.p1.x; // rTop
    };
    const positive = [0, 5, 10].map(topX);
    for (let i = 1; i < positive.length; i++) expect(positive[i]).toBeLessThan(positive[i - 1]);
    const negative = [-10, -5, 0].map(topX);
    for (const x of negative) expect(x).toBeCloseTo(positive[0], 6); // pinned to the same board-edge x throughout
  });

  it('bottle: the top corner\'s own x strictly decreases as taperAngle increases from -10 to +10', () => {
    const region = { x: 0, y: 0, w: 7, h: 9 };
    const params = paramsFromShapeModel('bottle', T2.shapeModel, region);
    const topX = (deg) => {
      const sil = generateSilhouette(region, { preset: 'bottle', params: { ...params, taperAngle: deg } });
      const top = sil.primitives[sil.primitives.length - 1];
      return top.p1.x;
    };
    const xs = [-10, -5, 0, 5, 10].map(topX);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeLessThan(xs[i - 1]);
  });

  it('hourglass: a deep negative taper pins the top corner to the board\'s own half-width (the inset branch)', () => {
    const region = { x: 0, y: 0, w: 7, h: 9 };
    const params = paramsFromShapeModel('hourglass', T1.shapeModel, region);
    const sil = generateSilhouette(region, { preset: 'hourglass', params: { ...params, taperAngle: -10 } });
    const top = sil.primitives[sil.primitives.length - 1];
    expect(top.p1.x - sil.cx).toBeCloseTo(region.w / 2, 6); // MEASURED: T1 is already full board width at the top
  });
});

describe('the negative floor: resolved params never draw _taperedCorner\'s own non-tangent fallback', () => {
  it('hourglass at 7x9: an explicit -15 clamps to the true feasible floor (~-13.67 deg), not the raw request', () => {
    const region = { x: 0, y: 0, w: 7, h: 9 };
    const params = paramsFromShapeModel('hourglass', T1.shapeModel, region);
    const sil = generateSilhouette(region, { preset: 'hourglass', params: { ...params, taperAngle: -15 } });
    expect(sil.params.taperAngle).toBeGreaterThan(-15);
    expect(sil.params.taperAngle).toBeCloseTo(-13.666, 2);
  });

  it('bottle at 7x9: the full declared -15 is feasible (MEASURED: Narrow Neck never needs the inset branch)', () => {
    const region = { x: 0, y: 0, w: 7, h: 9 };
    const params = paramsFromShapeModel('bottle', T2.shapeModel, region);
    const sil = generateSilhouette(region, { preset: 'bottle', params: { ...params, taperAngle: -15 } });
    expect(sil.params.taperAngle).toBeCloseTo(-15, 6);
  });

  it.each(BOARDS)('%dx%d: feasibleParamRanges.taperAngle always keeps [-15, 15] on top, never flips min > max', (W, H) => {
    const region = { x: 0, y: 0, w: W, h: H };
    for (const preset of ['hourglass', 'bottle']) {
      const model = preset === 'hourglass' ? T1.shapeModel : T2.shapeModel;
      const params = paramsFromShapeModel(preset, model, region);
      const r = feasibleParamRanges(preset, region, params).taperAngle;
      expect(r.max).toBeCloseTo(15, 6);
      expect(r.min).toBeGreaterThanOrEqual(-15 - 1e-9);
      expect(r.min).toBeLessThanOrEqual(r.max);
    }
  });
});

describe('Fred: "don\'t worry too much about extremes... it\'s enough that Generate never produces a broken '
  + 'frame and tests confirm nothing crashes"', () => {
  it.each(BOARDS)('%dx%d: hourglass, every taperAngle from -15 to 15 (declared band, pre-clamp) gives a clean '
    + 'outer AND inner outline, with miters', (W, H) => {
    const region = { x: 0, y: 0, w: W, h: H };
    const params = paramsFromShapeModel('hourglass', T1.shapeModel, region);
    for (let deg = -15; deg <= 15; deg += 2.5) {
      const sil = generateSilhouette(region, { preset: 'hourglass', params: { ...params, taperAngle: deg } });
      expect(outlineDefects(sil.primitives), `deg ${deg}`).toEqual([]);
      const inner = innerOf(sil.primitives);
      expect(outlineDefects(inner, { requireTangency: false }), `deg ${deg}`).toEqual([]);
      expect(() => frameMiters(sil.primitives, offsetOutlineInward(sil.primitives, T)), `deg ${deg}`).not.toThrow();
    }
  });

  it.each(BOARDS)('%dx%d: bottle, every taperAngle from -15 to 15 (declared band) gives a clean outer AND inner '
    + 'outline, with miters', (W, H) => {
    const region = { x: 0, y: 0, w: W, h: H };
    const params = paramsFromShapeModel('bottle', T2.shapeModel, region);
    for (let deg = -15; deg <= 15; deg += 2.5) {
      const sil = generateSilhouette(region, { preset: 'bottle', params: { ...params, taperAngle: deg } });
      expect(outlineDefects(sil.primitives), `deg ${deg}`).toEqual([]);
      const inner = innerOf(sil.primitives);
      expect(outlineDefects(inner, { requireTangency: false }), `deg ${deg}`).toEqual([]);
      expect(() => frameMiters(sil.primitives, offsetOutlineInward(sil.primitives, T)), `deg ${deg}`).not.toThrow();
    }
  });
});

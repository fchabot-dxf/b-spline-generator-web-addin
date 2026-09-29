/**
 * T3 TAPERED HOURGLASS (Fred: a 12-piece frame exactly like the Hourglass, the TOP narrower than the base): the
 * frame-only `topInset` param of the hourglass construction (editor-shape-lattice-generator.js), its "Top width"
 * handle, and the guards that keep Template 1 and the Shape Lattice exactly as they were.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord, framePayload } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile, frameInnerProfile } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import {
  frameHandles, handleDragPatch, frameSeedGeometry, generateFrameSeeds,
} from '../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';
import {
  generateSilhouette, generateContourSilhouette, outlineDefects, feasibleParamRanges, hourglassConstruction,
  paramsFromShapeModel, PARAM_ORDER, SHAPE_PARAM_KEYS, FRAME_ONLY_PARAM_KEYS,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import { computeParamHandles, HANDLE_SEGMENT_INDEX } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-interaction.js';
import { manifestFromShape } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-sketch-manifest.js';

const tplOf = (id) => FRAME_DEFS.templates.find((t) => t.id === id);
const T1 = tplOf('template_1'), T3 = tplOf('template_3');
const BOARDS = [[7, 9], [12, 6], [9, 12], [8, 8]];
const board = (W, H) => ({ widthIn: W, heightIn: H });
const profile = (id, seeds, W = 7, H = 9) => frameCutProfile(FRAME_DEFS, normalizeFrameRecord({ templateId: id, seeds }), board(W, H));
const inner = (id, seeds, W = 7, H = 9) => frameInnerProfile(FRAME_DEFS, normalizeFrameRecord({ templateId: id, seeds }), board(W, H));

/** A few deterministic hourglass shapes (Shape Lattice-like params, regions, strokes). */
function shapes() {
  let s = 7;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const out = [];
  for (let i = 0; i < 60; i++) {
    const params = {};
    for (const k of ['waistReach', 'cornerRadius', 'waistCenterY', 'waistRadius', 'cornerRadiusTop', 'cornerRadiusBottom']) {
      if (rnd() < 0.6) params[k] = k === 'waistCenterY' ? rnd() - 0.5 : rnd();
    }
    out.push({ region: { x: rnd(), y: rnd(), w: 2 + rnd() * 10, h: 2 + rnd() * 10 }, params, seed: i, stroke: rnd() < 0.5 ? 0 : 0.1 });
  }
  return out;
}

describe('topInset 0 is Template 1, bit for bit', () => {
  it('the silhouette with topInset 0 equals the one without it (every number identical)', () => {
    for (const { region, params, seed, stroke } of shapes()) {
      const a = generateSilhouette(region, { preset: 'hourglass', params, seed }, stroke);
      const b = generateSilhouette(region, { preset: 'hourglass', params: { ...params, topInset: 0 }, seed }, stroke);
      expect(JSON.stringify(b.primitives)).toBe(JSON.stringify(a.primitives));
      expect(JSON.stringify(b.keypoints)).toBe(JSON.stringify(a.keypoints));
      expect(JSON.stringify(b.segments)).toBe(JSON.stringify(a.segments));
      // only an explicit topInset is reported back: a pattern's resolved params are exactly as before
      expect('topInset' in a.params).toBe(false);
      expect(b.params).toEqual({ ...a.params, topInset: 0 });
    }
  });

  it('a Template 3 frame with its top width at 0 draws the Template 1 outline (and inner edge) exactly', () => {
    for (const [W, H] of BOARDS) {
      const p1 = profile('template_1', {}, W, H), p3 = profile('template_3', { topInset: 0 }, W, H);
      expect(JSON.stringify(p3.primitives)).toBe(JSON.stringify(p1.primitives));
      const i1 = inner('template_1', {}, W, H), i3 = inner('template_3', { topInset: 0 }, W, H);
      expect(JSON.stringify(i3 && i3.primitives)).toBe(JSON.stringify(i1 && i1.primitives));
    }
  });

  it('a Template 1 record is untouched: no topInset anywhere in its params, its model or its handles', () => {
    const prof = profile('template_1', {});
    expect('topInset' in prof.params).toBe(false);
    expect(paramsFromShapeModel('hourglass', T1.shapeModel, prof.region)).not.toHaveProperty('topInset');
    expect(frameHandles(T1, prof).map((h) => h.key)).not.toContain('topInset');
    // a stray topInset seed on a Template 1 record is dropped by the record gate (not a T1 handle)
    expect(normalizeFrameRecord({ templateId: 'template_1', seeds: { topInset: 0.2 } }).seeds).toEqual({});
  });

  it('PARAM_ORDER keeps every Template 1 key at its old index (the [Generate] salt)', () => {
    expect(PARAM_ORDER.hourglass).toEqual(['waistCenterY', 'waistReach', 'cornerRadius', 'waistRadius', 'cornerRadiusTop', 'cornerRadiusBottom', 'topInset']);
  });
});

describe('Template 3: the narrow top', () => {
  it.each(BOARDS)('%dx%d: the provisional shape is a clean frame, top narrower than the base, the waist narrower than the top', (W, H) => {
    const prof = profile('template_3', {}, W, H);
    expect(prof.defects).toEqual([]);
    const inn = inner('template_3', {}, W, H);
    expect(inn && inn.defects).toEqual([]);
    const { region, params } = prof;
    const hw = region.w / 2;
    expect(params.topInset).toBeGreaterThan(0);
    const topHalf = hw * (1 - params.topInset), waistHalf = hw * (1 - params.waistReach);
    expect(topHalf).toBeLessThan(hw);
    expect(waistHalf).toBeLessThan(topHalf);
  });

  it('7x9 (Fred\'s sketch): a ~5 in top over the 6.5 in base', () => {
    const prof = profile('template_3', {});
    const top = prof.primitives[11];
    expect(Math.abs(top.p1.x - top.p0.x)).toBeGreaterThan(4.5);
    expect(Math.abs(top.p1.x - top.p0.x)).toBeLessThan(5.5);
    expect(prof.region.w).toBeCloseTo(6.5, 12);
  });

  it('the top keypoints sit at hw - i, the horn stays vertical and tangent to the shoulder', () => {
    for (const [W, H] of BOARDS) {
      for (const i of [0.05, 0.1, 0.2]) {
        const prof = profile('template_3', { topInset: i }, W, H);
        const { region, params } = prof;
        const cx0 = region.x + region.w / 2, hw = region.w / 2;
        const x = hw * (1 - params.topInset);
        const [horn, shoulder] = prof.primitives;
        const top = prof.primitives[11], hornL = prof.primitives[10];
        expect(horn.p0.x - cx0).toBeCloseTo(x, 9);
        expect(horn.p1.x - cx0).toBeCloseTo(x, 9); // vertical
        expect(cx0 - hornL.p0.x).toBeCloseTo(x, 9); // mirrored
        expect(Math.abs(top.p1.x - top.p0.x) / 2).toBeCloseTo(x, 9);
        expect(top.p0.y).toBeCloseTo(region.y, 9); // flat top on the safe-zone line
        expect(shoulder.cx - cx0).toBeCloseTo(x - shoulder.rx, 9); // tangent to the horn
        expect(outlineDefects(prof.primitives)).toEqual([]); // every joint tangent, no crossing
        const g = hourglassConstruction(region, params);
        expect(g.topX).toBeCloseTo(x, 12);
      }
    }
  });

  it('the Fusion seeds follow: top_edge and the top horns at the narrow x', () => {
    const prof = profile('template_3', { topInset: 0.2 });
    const geo = frameSeedGeometry(T3, prof, 7, 9);
    const x = prof.region.w / 2 * 0.8;
    expect(geo.top_edge.points[0][0]).toBeCloseTo(-x, 9);
    expect(geo.top_edge.points[1][0]).toBeCloseTo(x, 9);
    expect(geo.horn_TR.points[0][0]).toBeCloseTo(x, 9);
    expect(geo.horn_TL.points[0][0]).toBeCloseTo(-x, 9);
    expect(geo.bottom_edge.points[0][0]).toBeCloseTo(prof.region.w / 2, 9); // the base keeps the full width
  });
});

describe('Template 3: the Top width handle', () => {
  const drag = (seeds, dx) => {
    const rec = normalizeFrameRecord({ templateId: 'template_3', seeds });
    const prof = frameCutProfile(FRAME_DEFS, rec, board(7, 9));
    const h = frameHandles(T3, prof).find((q) => q.key === 'topInset');
    const pt = { x: h.anchor.x + dx, y: h.anchor.y };
    return { h, prof, rec, pt, next: normalizeFrameRecord({ ...rec, ...handleDragPatch(rec, h, pt, prof.region) }) };
  };

  it('is a position square midway down the right top horn, reading (edge - x) / hw', () => {
    const { h, prof } = drag({}, 0);
    const [horn] = prof.primitives;
    expect(h).toMatchObject({ key: 'topInset', label: 'Top width', axis: 'x', handleKind: 'position', binding: 'seeded' });
    expect(h.anchor.x).toBeCloseTo(horn.p0.x, 9);
    expect(h.anchor.y).toBeCloseTo((horn.p0.y + horn.p1.y) / 2, 9);
    expect(h.value).toBeCloseTo(prof.params.topInset, 12);
    expect(HANDLE_SEGMENT_INDEX.hourglass.topInset).toBe(0);
  });

  it('a drag writes only the seed (no parameter) and moves the top horns by exactly the drag', () => {
    const { prof, next } = drag({}, -0.2);
    expect(next.params).toEqual({});
    expect(next.seeds.topInset).toBeCloseTo(prof.params.topInset + 0.2 / (prof.region.w / 2), 12);
    const payload = framePayload(FRAME_DEFS, next);
    expect(Object.keys(payload.params).sort()).toEqual(T3.params.filter((p) => p.owner === 'frame').map((p) => p.name).sort());
    const after = frameCutProfile(FRAME_DEFS, next, board(7, 9));
    expect(after.primitives[0].p0.x).toBeCloseTo(prof.primitives[0].p0.x - 0.2, 9);
    expect(after.defects).toEqual([]);
  });

  it('never past the waist: dragged to the centreline it stops just outside the pinch, outline and inner edge valid', () => {
    const { h, prof, next } = drag({}, -10);
    const r = feasibleParamRanges('hourglass', prof.region, prof.params);
    expect(h.valueFromWorld({ x: prof.region.x + prof.region.w / 2, y: h.anchor.y })).toBeCloseTo(r.topInset.max, 12);
    expect(r.topInset.max).toBeLessThan(prof.params.waistReach);
    const after = frameCutProfile(FRAME_DEFS, next, board(7, 9));
    expect(after.params.topInset).toBeLessThan(after.params.waistReach);
    expect(after.defects).toEqual([]);
    const inn = frameInnerProfile(FRAME_DEFS, next, board(7, 9));
    expect(inn && inn.defects).toEqual([]);
  });

  it('dragged outward it stops at the full width (topInset 0 = the Template 1 top)', () => {
    const { next } = drag({}, 10);
    expect(next.seeds.topInset).toBe(0);
    expect(JSON.stringify(frameCutProfile(FRAME_DEFS, next, board(7, 9)).primitives))
      .toBe(JSON.stringify(profile('template_1', {}).primitives));
  });

  it('a seed past the waist (e.g. the waist later dragged in) is clamped to it, never an inverted top', () => {
    for (const [W, H] of BOARDS) {
      const prof = profile('template_3', { topInset: 0.95 }, W, H);
      expect(prof.params.topInset).toBeLessThan(prof.params.waistReach);
      expect(prof.defects).toEqual([]);
    }
  });

  it('[Generate] draws the top width too, always inside its range', () => {
    const region = profile('template_3', {}).region;
    for (let seed = 1; seed <= 50; seed++) {
      const seeds = generateFrameSeeds(T3, region, seed);
      const prof = profile('template_3', seeds);
      expect(prof.params.topInset).toBeCloseTo(seeds.topInset, 12);
      expect(prof.defects).toEqual([]);
    }
    expect(generateFrameSeeds(T1, region, 1)).not.toHaveProperty('topInset');
  });
});

describe('the Shape Lattice never gets topInset', () => {
  it('it is a frame-only param: not a Shape Lattice param, not a default handle', () => {
    expect(FRAME_ONLY_PARAM_KEYS).toEqual(['topInset']);
    expect(SHAPE_PARAM_KEYS.hourglass).not.toContain('topInset');
    const region = { x: 0, y: 0, w: 6, h: 8 };
    const sil = generateSilhouette(region, { preset: 'hourglass', params: {} });
    expect(computeParamHandles('hourglass', region, sil.params).map((h) => h.key)).not.toContain('topInset');
  });

  it('the Fusion manifest never emits a topInset user parameter, even if one reached a pattern', () => {
    const region = { x: 0, y: 0, w: 6, h: 8 };
    const plain = manifestFromShape({ preset: 'hourglass', params: {} }, region);
    const stray = manifestFromShape({ preset: 'hourglass', params: { topInset: 0.2 } }, region);
    for (const m of [plain, stray]) {
      const names = m.parameters.map((p) => p.name);
      expect(names).not.toContain('topInset');
      expect(names.some((n) => /top_?inset/i.test(n))).toBe(false);
    }
    // the stray value still draws (the contour is its own), but no new parameter name exists
    expect(stray.parameters.map((p) => p.name)).toEqual(plain.parameters.map((p) => p.name));
    expect(generateContourSilhouette(region, { preset: 'hourglass', params: {} }, 0.1).params).not.toHaveProperty('topInset');
  });
});

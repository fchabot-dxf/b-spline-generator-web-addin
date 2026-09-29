/**
 * T4 OFFSET HOURGLASS (Template 1 NOT mirrored: the left waist pinch and the right one each at their own height and
 * depth; top and base full width, still 12 pieces): the frame-only `waistCenterYLeft` / `waistReachLeft` params of
 * the hourglass construction (editor-shape-lattice-generator.js), their "Left waist position" / "Left waist reach"
 * handles, and the guards that keep Templates 1-3 and the Shape Lattice exactly as they were.
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
import {
  computeParamHandles, HANDLE_SEGMENT_INDEX, controlledSegments,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-interaction.js';
import { manifestFromShape } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-sketch-manifest.js';
import { frameLabel } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';

const tplOf = (id) => FRAME_DEFS.templates.find((t) => t.id === id);
const T1 = tplOf('template_1'), T4 = tplOf('template_4');
const BOARDS = [[7, 9], [12, 6], [9, 12], [8, 8]];
const LEFT = ['waistCenterYLeft', 'waistReachLeft'];
const board = (W, H) => ({ widthIn: W, heightIn: H });
const profile = (id, seeds, W = 7, H = 9) => frameCutProfile(FRAME_DEFS, normalizeFrameRecord({ templateId: id, seeds }), board(W, H));
const inner = (id, seeds, W = 7, H = 9) => frameInnerProfile(FRAME_DEFS, normalizeFrameRecord({ templateId: id, seeds }), board(W, H));
/** The waist arcs (right = primitive 2, left = 8) and their centres, y down. */
const waists = (prof) => ({ R: prof.primitives[2], L: prof.primitives[8] });

/** A few deterministic hourglass shapes (Shape Lattice-like params, regions, strokes). */
function shapes() {
  let s = 11;
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

describe('no left pinch set: Template 1, bit for bit', () => {
  it('without the left keys nothing changes: no `left` construction, no left params reported', () => {
    for (const { region, params, seed, stroke } of shapes()) {
      const a = generateSilhouette(region, { preset: 'hourglass', params, seed }, stroke);
      for (const k of LEFT) expect(k in a.params).toBe(false);
      expect(hourglassConstruction(region, a.params).left).toBeUndefined();
      expect(outlineDefects(a.primitives)).toEqual(outlineDefects(generateSilhouette(region, { preset: 'hourglass', params, seed }, stroke).primitives));
    }
  });

  it('the left pinch set to the right one\'s values draws the mirrored outline exactly', () => {
    for (const { region, params, seed, stroke } of shapes()) {
      const a = generateSilhouette(region, { preset: 'hourglass', params, seed }, stroke);
      const same = { ...params, waistCenterYLeft: a.params.waistCenterY, waistReachLeft: a.params.waistReach };
      const b = generateSilhouette(region, { preset: 'hourglass', params: same, seed }, stroke);
      expect(JSON.stringify(b.primitives)).toBe(JSON.stringify(a.primitives));
      expect(JSON.stringify(b.segments)).toBe(JSON.stringify(a.segments));
      expect(b.params).toEqual({ ...a.params, waistCenterYLeft: a.params.waistCenterY, waistReachLeft: a.params.waistReach });
    }
  });

  it('a Template 1 record is untouched: no left keys in its params, its model, its handles or its [Generate]', () => {
    const prof = profile('template_1', {});
    for (const k of LEFT) expect(k in prof.params).toBe(false);
    const m = paramsFromShapeModel('hourglass', T1.shapeModel, prof.region);
    for (const k of LEFT) expect(m).not.toHaveProperty(k);
    expect(frameHandles(T1, prof).map((h) => h.key).filter((k) => LEFT.includes(k))).toEqual([]);
    expect(normalizeFrameRecord({ templateId: 'template_1', seeds: { waistCenterYLeft: -0.3 } }).seeds).toEqual({});
    const g = generateFrameSeeds(T1, prof.region, 3);
    for (const k of LEFT) expect(g).not.toHaveProperty(k);
  });

  it('PARAM_ORDER keeps every earlier key at its old index (the [Generate] salt); the left keys come last', () => {
    // (T5 HOURGLASS DIPPED TOP appends its top dip keys AFTER these: every earlier index unchanged.)
    expect(PARAM_ORDER.hourglass.slice(0, 9)).toEqual(['waistCenterY', 'waistReach', 'cornerRadius', 'waistRadius', 'cornerRadiusTop',
      'cornerRadiusBottom', 'topInset', 'waistCenterYLeft', 'waistReachLeft']);
  });
});

describe('Template 4: the offset pinches', () => {
  it('is listed as "4. Offset Hourglass", 12 pieces, Template 1\'s regions / seed map / features / params', () => {
    expect(T4.name).toBe('Template 4 - Offset Hourglass');
    expect(frameLabel(T4)).toBe('4. Offset Hourglass');
    expect(T4.silhouettePreset).toBe('hourglass');
    expect(T4.regions).toEqual(T1.regions);
    expect(T4.seedMap).toEqual(T1.seedMap);
    expect(T4.params).toEqual(T1.params); // no new parameter
    expect(T4.shapeModel.provisional).toBeTruthy();
  });

  it.each(BOARDS)('%dx%d: the provisional shape is a clean frame, left pinch clearly higher than the right, full-width top and base', (W, H) => {
    const prof = profile('template_4', {}, W, H);
    expect(prof.primitives.length).toBe(12);
    expect(prof.defects).toEqual([]);
    const inn = inner('template_4', {}, W, H);
    expect(inn && inn.defects).toEqual([]);
    const { region, params } = prof;
    expect(params.waistCenterYLeft).toBeLessThan(params.waistCenterY - 0.3); // y down: the left pinch sits higher
    const { R, L } = waists(prof);
    expect(R.cy - L.cy).toBeGreaterThan(0.15 * region.h);
    expect(L.rx).toBeCloseTo(R.rx, 9); // the waist radius is shared
    const top = prof.primitives[11], bottom = prof.primitives[5];
    expect(Math.abs(top.p1.x - top.p0.x)).toBeCloseTo(region.w, 9);
    expect(Math.abs(bottom.p1.x - bottom.p0.x)).toBeCloseTo(region.w, 9);
  });

  it('7x9: the left waist centre ~60% up the safe zone, the right ~40%', () => {
    const prof = profile('template_4', {});
    const up = (y) => (prof.region.y + prof.region.h - y) / prof.region.h;
    const { R, L } = waists(prof);
    expect(up(L.cy)).toBeGreaterThan(0.55);
    expect(up(L.cy)).toBeLessThan(0.65);
    expect(up(R.cy)).toBeGreaterThan(0.35);
    expect(up(R.cy)).toBeLessThan(0.45);
  });

  it('the left side is its own construction: horns vertical, every joint tangent, corners and waist radii shared', () => {
    for (const [W, H] of BOARDS) {
      for (const [y, d] of [[-0.3, 0.2], [0.3, 0.3], [0, 0.15], [-0.1, 0.4]]) {
        const prof = profile('template_4', { waistCenterYLeft: y, waistReachLeft: d }, W, H);
        expect(prof.defects).toEqual([]);
        const { region, params } = prof;
        const cx0 = region.x + region.w / 2, hw = region.w / 2;
        const g = hourglassConstruction(region, params);
        expect(g.left).toBeTruthy();
        const [, shR, , hpR] = prof.primitives;
        const shL = prof.primitives[9], hpL = prof.primitives[7], wL = prof.primitives[8];
        expect(shL.rx).toBeCloseTo(shR.rx, 9);
        expect(hpL.rx).toBeCloseTo(hpR.rx, 9);
        expect(cx0 - shL.cx).toBeCloseTo(hw - shL.rx, 9); // tangent to the left side at -hw
        expect(cx0 - wL.cx).toBeCloseTo(g.left.waistCx, 9);
        expect(wL.cy - region.y - region.h / 2).toBeCloseTo(hh(region) * params.waistCenterYLeft, 9);
        expect(hw - (cx0 - wL.cx - wL.rx)).toBeCloseTo(hw * params.waistReachLeft, 9); // the left pinch depth
      }
    }
  });

  it('any left seed is clamped into a valid pinch (outline and inner edge), at every board', () => {
    for (const [W, H] of BOARDS) {
      for (const y of [-0.9, -0.5, 0, 0.5, 0.9]) {
        for (const d of [0, 0.3, 0.6, 0.95]) {
          const prof = profile('template_4', { waistCenterYLeft: y, waistReachLeft: d }, W, H);
          expect(prof.defects, `${W}x${H} ${y} ${d}`).toEqual([]);
        }
      }
    }
  });

  it('the Fusion seeds follow: each side\'s pins at its own centre heights', () => {
    const prof = profile('template_4', {});
    const geo = frameSeedGeometry(T4, prof, 7, 9);
    const { R, L } = waists(prof);
    expect(geo.skel_waist_pin_R.points[1][1]).toBeCloseTo(9 / 2 - R.cy, 9);
    expect(geo.skel_waist_pin_L.points[1][1]).toBeCloseTo(9 / 2 - L.cy, 9);
    expect(geo.skel_waist_pin_L.points[1][1] - geo.skel_waist_pin_R.points[1][1]).toBeGreaterThan(1);
    expect(geo.skel_shoulder_pin_L.points[1][1]).toBeGreaterThan(geo.skel_shoulder_pin_R.points[1][1] + 1);
  });
});

const hh = (region) => region.h / 2;

describe('Template 4: the left pinch handles', () => {
  const drag = (key, seeds, dx, dy, ctx) => {
    const rec = normalizeFrameRecord({ templateId: 'template_4', seeds });
    const prof = frameCutProfile(FRAME_DEFS, rec, board(7, 9));
    const hs = frameHandles(T4, prof);
    const h = hs.find((q) => q.key === key);
    const pt = { x: h.anchor.x + dx, y: h.anchor.y + dy };
    return { h, hs, prof, rec, pt, next: normalizeFrameRecord({ ...rec, ...handleDragPatch(rec, h, pt, prof.region, ctx) }) };
  };

  it('the table is Template 1\'s (the waist squares relabelled Right) + Left waist position / reach, all seeded', () => {
    const labels = Object.fromEntries(T1.handles.map((h) => [h.key, h.label]));
    labels.waistReach = 'Right waist reach';
    labels.waistCenterY = 'Right waist position';
    expect(T4.handles).toEqual([
      ...T1.handles.map((h) => ({ ...h, label: labels[h.key] })),
      { key: 'waistCenterYLeft', label: 'Left waist position', basis: 'hh', binding: 'seeded' },
      { key: 'waistReachLeft', label: 'Left waist reach', basis: 'hw', binding: 'seeded' },
    ]);
    const { hs } = drag('waistCenterYLeft', {}, 0, 0);
    expect(hs.map((h) => h.key)).toEqual(T4.handles.map((h) => h.key));
    expect(HANDLE_SEGMENT_INDEX.hourglass.waistCenterYLeft).toBe(8);
    expect(controlledSegments('hourglass', 'waistCenterYLeft', 12)).toEqual([8]); // the left waist alone
    expect(controlledSegments('hourglass', 'waistReach', 12)).toEqual([2, 8]); // unchanged
  });

  it('Left waist position: a square left of the centre line at the left pinch height; a drag moves the left side only', () => {
    const { h, prof, next } = drag('waistCenterYLeft', {}, 0, 0.4);
    const { L } = waists(prof);
    const cx0 = prof.region.x + prof.region.w / 2;
    expect(h).toMatchObject({ label: 'Left waist position', axis: 'y', handleKind: 'position', binding: 'seeded' });
    expect(h.anchor.y).toBeCloseTo(L.cy, 9);
    expect(h.anchor.x).toBeLessThan(cx0);
    expect(h.value).toBeCloseTo(prof.params.waistCenterYLeft, 12);
    expect(next.params).toEqual({});
    expect(next.seeds.waistCenterYLeft).toBeCloseTo(prof.params.waistCenterYLeft + 0.4 / hh(prof.region), 12);
    const after = frameCutProfile(FRAME_DEFS, next, board(7, 9));
    expect(after.defects).toEqual([]);
    expect(waists(after).L.cy).toBeCloseTo(L.cy + 0.4, 9);
    for (let i = 0; i <= 5; i++) expect(JSON.stringify(after.primitives[i])).toBe(JSON.stringify(prof.primitives[i])); // the right side stays
    const payload = framePayload(FRAME_DEFS, next);
    expect(Object.keys(payload.params).sort()).toEqual(T4.params.filter((p) => p.owner === 'frame').map((p) => p.name).sort());
  });

  it('Left waist reach: the square at the left waist centre; dragged outward the left pinch deepens (radius held)', () => {
    const { h, prof, next } = drag('waistReachLeft', {}, 0.3, 0);
    const { L } = waists(prof);
    expect(h).toMatchObject({ label: 'Left waist reach', axis: 'x', handleKind: 'position' });
    expect(h.anchor.x).toBeCloseTo(L.cx, 9);
    expect(h.anchor.y).toBeCloseTo(L.cy, 9);
    const after = frameCutProfile(FRAME_DEFS, next, board(7, 9));
    expect(after.defects).toEqual([]);
    expect(waists(after).L.cx).toBeCloseTo(L.cx + 0.3, 9); // the centre follows the pointer
    expect(waists(after).L.rx).toBeCloseTo(L.rx, 12);
    for (let i = 0; i <= 5; i++) expect(JSON.stringify(after.primitives[i])).toBe(JSON.stringify(prof.primitives[i]));
  });

  it('dragged far, each left handle stops at its range and the frame stays valid (outline and inner edge)', () => {
    for (const [key, dx, dy] of [['waistCenterYLeft', 0, -20], ['waistCenterYLeft', 0, 20], ['waistReachLeft', 20, 0], ['waistReachLeft', -20, 0]]) {
      const { next } = drag(key, {}, dx, dy);
      const after = frameCutProfile(FRAME_DEFS, next, board(7, 9));
      expect(after.defects, key).toEqual([]);
      const inn = frameInnerProfile(FRAME_DEFS, next, board(7, 9));
      expect(inn && inn.defects, key).toEqual([]);
    }
  });

  it('the right waist squares still move the right pinch; the left one keeps its own height', () => {
    const { prof, next } = drag('waistCenterY', {}, 0, 0.3);
    const after = frameCutProfile(FRAME_DEFS, next, board(7, 9));
    expect(after.defects).toEqual([]);
    expect(waists(after).R.cy).toBeCloseTo(waists(prof).R.cy + 0.3, 9);
    expect(waists(after).L.cy).toBeCloseTo(waists(prof).L.cy, 9);
  });

  it('the waist radius drag keeps BOTH waist centres put; grabbed on the left arc it follows that arc', () => {
    const rec = normalizeFrameRecord({ templateId: 'template_4' });
    const prof = frameCutProfile(FRAME_DEFS, rec, board(7, 9));
    const h = frameHandles(T4, prof).find((q) => q.key === 'waistRadius');
    const { R, L } = waists(prof);
    const pt = { x: L.cx + (L.rx + 0.2), y: L.cy }; // 0.2 outside the left rim, facing the pinch
    const next = normalizeFrameRecord({ ...rec, ...handleDragPatch(rec, h, pt, prof.region, { side: 1 }) });
    const after = frameCutProfile(FRAME_DEFS, next, board(7, 9));
    expect(after.defects).toEqual([]);
    const w = waists(after);
    expect(w.L.rx).toBeCloseTo(L.rx + 0.2, 6);
    expect(w.L.cx).toBeCloseTo(L.cx, 9);
    expect(w.R.cx).toBeCloseTo(R.cx, 9);
    expect(w.L.cy).toBeCloseTo(L.cy, 9);
  });

  it('a corner arc grabbed on the LEFT side solves on the left arc (grabbing it where it is changes nothing)', () => {
    const rec = normalizeFrameRecord({ templateId: 'template_4' });
    const prof = frameCutProfile(FRAME_DEFS, rec, board(7, 9));
    const h = frameHandles(T4, prof).find((q) => q.key === 'cornerRadiusTop');
    const a = h.arcs[1]; // the left shoulder
    const mid = { x: a.cx + a.rx * Math.cos(a.theta1 + a.dTheta / 2), y: a.cy + a.rx * Math.sin(a.theta1 + a.dTheta / 2) };
    expect(h.valueFromWorld(mid, { side: 1 })).toBeCloseTo(prof.params.cornerRadiusTop, 5);
  });

  it('[Generate] draws both pinches, always a valid frame', () => {
    const region = profile('template_4', {}).region;
    for (let seed = 1; seed <= 50; seed++) {
      const seeds = generateFrameSeeds(T4, region, seed);
      for (const k of LEFT) expect(seeds).toHaveProperty(k);
      const prof = profile('template_4', seeds);
      expect(prof.params.waistCenterYLeft).toBeCloseTo(seeds.waistCenterYLeft, 12);
      expect(prof.params.waistReachLeft).toBeCloseTo(seeds.waistReachLeft, 12);
      expect(prof.defects).toEqual([]);
      const inn = inner('template_4', seeds);
      expect(inn && inn.defects).toEqual([]);
    }
  });

  it('the left ranges hold the right pinch\'s own values (never empty)', () => {
    for (const [W, H] of BOARDS) {
      const prof = profile('template_4', {}, W, H);
      const r = feasibleParamRanges('hourglass', prof.region, { ...prof.params, waistReachLeft: undefined, waistCenterYLeft: prof.params.waistCenterY });
      expect(r.waistCenterYLeft.min).toBeLessThanOrEqual(prof.params.waistCenterY + 1e-12);
      expect(r.waistCenterYLeft.max).toBeGreaterThanOrEqual(prof.params.waistCenterY - 1e-12);
      expect(r.waistReachLeft.min).toBeLessThanOrEqual(prof.params.waistReach + 1e-12);
      expect(r.waistReachLeft.max).toBeGreaterThanOrEqual(prof.params.waistReach - 1e-12);
    }
  });
});

describe('the Shape Lattice never gets the left pinch', () => {
  it('frame-only params: not Shape Lattice params, not default handles', () => {
    for (const k of LEFT) {
      expect(FRAME_ONLY_PARAM_KEYS).toContain(k);
      expect(SHAPE_PARAM_KEYS.hourglass).not.toContain(k);
    }
    const region = { x: 0, y: 0, w: 6, h: 8 };
    const sil = generateSilhouette(region, { preset: 'hourglass', params: {} });
    expect(computeParamHandles('hourglass', region, sil.params).map((h) => h.key).filter((k) => LEFT.includes(k))).toEqual([]);
  });

  it('the Fusion manifest never emits a left pinch user parameter, even if one reached a pattern', () => {
    const region = { x: 0, y: 0, w: 6, h: 8 };
    const plain = manifestFromShape({ preset: 'hourglass', params: {} }, region);
    const stray = manifestFromShape({ preset: 'hourglass', params: { waistCenterYLeft: -0.2, waistReachLeft: 0.3 } }, region);
    expect(stray.parameters.map((p) => p.name)).toEqual(plain.parameters.map((p) => p.name));
    expect(generateContourSilhouette(region, { preset: 'hourglass', params: {} }, 0.1).params).not.toHaveProperty('waistCenterYLeft');
  });
});

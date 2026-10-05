/**
 * T5 HOURGLASS DIPPED TOP (Template 1 with the top edge dipped in the middle: a straight stub from each top corner,
 * then a convex shoulder arc, a concave dip arc and a convex shoulder arc; base flat, sides as Template 1, corners
 * square; 16 pieces): the frame-only `topDipWidth` / `topDipDepth` params of the hourglass construction
 * (editor-shape-lattice-generator.js), their "Top dip depth" / "Top dip width" handles, the dipped outline's own
 * mirror table, and the guards that keep Templates 1-4 and the Shape Lattice exactly as they were.
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord, framePayload } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile, frameInnerProfile, frameMiters } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import {
  frameHandles, handleDragPatch, frameSeedGeometry, generateFrameSeeds, frameParamRanges,
} from '../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';
import {
  generateSilhouette, generateContourSilhouette, outlineDefects, hourglassConstruction, paramsFromShapeModel,
  PARAM_ORDER, SHAPE_PARAM_KEYS, FRAME_ONLY_PARAM_KEYS, TOP_DIP_SEGMENT_COUNT, topDipMirrorIndex,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import {
  computeParamHandles, HANDLE_SEGMENT_INDEX, controlledSegments,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-interaction.js';
import { manifestFromShape } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-sketch-manifest.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { frameLabel } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';
import { computePattern, _resolveExtent, PATTERN_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { insetGeneratedPresetPathDToPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-boundary.js';
import { primitiveToPathD, joinSegmentPathsIntoClosedD } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import { sampleOutline, pointInPolygon } from '../bspline-frame-builder/b-spline-gen/html/core/preview/frame-mesh.js';
import { distToPrimitive } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-primitives.js';
vi.setConfig({ testTimeout: HEAVY_TEST_MS }); // the declared heavy-test timeout: timed out at 5 s under the fleet's load (turns 261-265)

const tplOf = (id) => FRAME_DEFS.templates.find((t) => t.id === id);
const T1 = tplOf('template_1'), T5 = tplOf('template_5');
const BOARDS = [[7, 9], [12, 6], [9, 12], [8, 8]];
const DIP = ['topDipWidth', 'topDipDepth'];
const board = (W, H) => ({ widthIn: W, heightIn: H });
const rec5 = (seeds) => normalizeFrameRecord({ templateId: 'template_5', seeds });
const profile = (id, seeds, W = 7, H = 9) => frameCutProfile(FRAME_DEFS, normalizeFrameRecord({ templateId: id, seeds }), board(W, H));
const inner = (id, seeds, W = 7, H = 9) => frameInnerProfile(FRAME_DEFS, normalizeFrameRecord({ templateId: id, seeds }), board(W, H));
const J = (x) => JSON.stringify(x);
/** H23 item 6: T5's sides are the SAME CONSTRUCTION as T1's, but no longer the SAME MEASURED NUMBERS --
 *  before this item T5's shapeModel was provisional, literally borrowing T1's own fitted cornerR/waistR
 *  coefficients (so "exactly T1's" was bit-for-bit true by construction); now T5 is fit from its OWN
 *  recorded goldens (needed to fix the 12x6 dip flip), and two separate Fusion solves of "the same"
 *  geometry (T1's four-arc side alone vs T5's with the dip also in the constraint system) land on
 *  genuinely-close-but-not-identical numbers (MEASURED max residual 12x6 gives ~0.031in). Same shape,
 *  not the same bits -- so this compares values, not JSON strings (same pattern as T3's own fix when
 *  its "topInset 0 = Template 1" numeric coincidence broke the same way). */
function expectPrimitiveClose(a, b, precision = 1) {
  expect(a.type).toBe(b.type);
  if (a.type === 'L') {
    expect(a.p0.x).toBeCloseTo(b.p0.x, precision); expect(a.p0.y).toBeCloseTo(b.p0.y, precision);
    expect(a.p1.x).toBeCloseTo(b.p1.x, precision); expect(a.p1.y).toBeCloseTo(b.p1.y, precision);
  } else {
    const wrap = (t) => ((t % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI; // pi and -pi are the same angle
    expect(a.cx).toBeCloseTo(b.cx, precision); expect(a.cy).toBeCloseTo(b.cy, precision);
    expect(a.rx).toBeCloseTo(b.rx, precision); expect(wrap(a.theta1)).toBeCloseTo(wrap(b.theta1), precision);
    expect(a.dTheta).toBeCloseTo(b.dTheta, precision);
  }
}
/** The dipped top: 11 left stub, 12 left shoulder, 13 dip, 14 right shoulder, 15 right stub. */
const top = (prof) => ({ stubL: prof.primitives[11], shL: prof.primitives[12], dip: prof.primitives[13], shR: prof.primitives[14], stubR: prof.primitives[15] });

/** A few deterministic hourglass shapes (Shape Lattice-like params, regions, strokes). */
function shapes() {
  let s = 23;
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

describe('no dip set: Template 1, bit for bit', () => {
  it('without the dip keys nothing changes: 12 pieces, no `topDip`, no mirror table, no dip params reported', () => {
    for (const { region, params, seed, stroke } of shapes()) {
      const a = generateSilhouette(region, { preset: 'hourglass', params, seed }, stroke);
      expect(a.primitives.length).toBe(12);
      expect(a).not.toHaveProperty('mirror');
      for (const k of DIP) expect(k in a.params).toBe(false);
      expect(hourglassConstruction(region, a.params).topDip).toBeUndefined();
      expect(a.segments.some((g) => 'outward' in g)).toBe(false);
    }
  });

  it('a Template 1 record is untouched: no dip keys in its params, its model, its handles or its [Generate]', () => {
    const prof = profile('template_1', {});
    for (const k of DIP) expect(k in prof.params).toBe(false);
    const m = paramsFromShapeModel('hourglass', T1.shapeModel, prof.region);
    for (const k of DIP) expect(m).not.toHaveProperty(k);
    expect(frameHandles(T1, prof).map((h) => h.key).filter((k) => DIP.includes(k))).toEqual([]);
    expect(normalizeFrameRecord({ templateId: 'template_1', seeds: { topDipDepth: 0.2 } }).seeds).toEqual({});
    const g = generateFrameSeeds(T1, prof.region, 3);
    for (const k of DIP) expect(g).not.toHaveProperty(k);
  });

  it('PARAM_ORDER keeps every earlier key at its old index (the [Generate] salt); the dip keys come last', () => {
    // T10 ARCHED HOURGLASS appended its own 'archRise' after the dip keys, and F30 item 3 appended 'taperAngle'
    // after that, so Template 1-9's own indices stay exactly where this test already pins them.
    expect(PARAM_ORDER.hourglass).toEqual(['waistCenterY', 'waistReach', 'cornerRadius', 'waistRadius', 'cornerRadiusTop',
      'cornerRadiusBottom', 'topInset', 'waistCenterYLeft', 'waistReachLeft', 'topDipWidth', 'topDipDepth', 'archRise',
      'taperAngle']);
  });
});

describe('Template 5: the dipped top', () => {
  it('is listed as "5. Hourglass Dipped Top", 16 pieces, Template 1\'s sides / params, the top dip in the model', () => {
    expect(T5.name).toBe('Template 5 - Hourglass Dipped Top');
    expect(frameLabel(T5)).toBe('5. Hourglass Dipped Top');
    expect(T5.silhouettePreset).toBe('hourglass');
    expect(T5.params).toEqual(T1.params); // no new parameter
    expect(T5.features).toEqual(T1.features); // 4 bars + the trim, the same bodies
    // H23 item 6: the provisional shim is retired -- T5 now has its own shapeModel,
    // fitted from its own live goldens (5.51x1.97 excluded: the dip collapses there,
    // the board too small for this frame to physically fit -- see frame_shape_fit.py).
    expect(T5.shapeModel.provisional).toBeUndefined();
    expect(T5.shapeModel.fit.fittedFrom).toEqual(['12x6', '7x9']);
    expect(T5.shapeModel.fit.excluded).toEqual(['5.51x1.97']);
    expect(T5.regions.outline).toHaveLength(TOP_DIP_SEGMENT_COUNT);
    expect(T5.regions.outline.slice(0, 5)).toEqual(['proj_top_edge_L', 'proj_arc_top_shoulder_L', 'proj_arc_top_dip',
      'proj_arc_top_shoulder_R', 'proj_top_edge_R']);
    expect(T5.regions.outline.slice(5)).toEqual(T1.regions.outline.slice(1)); // the sides and base: Template 1's
    expect(T5.regions.miters.map((m) => m[0])).toEqual(['proj_top_edge_L:S', 'proj_horn_TR:S', 'proj_bottom_edge:S', 'proj_horn_BL:S']);
  });

  it.each(BOARDS)('%dx%d: a clean 16-piece frame; the sides and base exactly Template 1\'s; the top dipped, symmetric, square corners', (W, H) => {
    const prof = profile('template_5', {}, W, H), p1 = profile('template_1', {}, W, H);
    expect(prof.primitives.length).toBe(16);
    expect(prof.defects).toEqual([]);
    const inn = inner('template_5', {}, W, H);
    expect(inn && inn.defects).toEqual([]);
    expect(inn.primitives.slice(11).every((p) => !p.collapsed)).toBe(true); // the top pieces never collapse
    for (let i = 0; i <= 10; i++) expectPrimitiveClose(prof.primitives[i], p1.primitives[i]);
    const { region } = prof, cx0 = region.x + region.w / 2, y0 = region.y;
    const { stubL, shL, dip, shR, stubR } = top(prof);
    for (const s of [stubL, stubR]) { expect(s.type).toBe('L'); expect(s.p0.y).toBeCloseTo(y0, 12); expect(s.p1.y).toBeCloseTo(y0, 12); }
    expect(stubL.p0).toEqual(p1.primitives[11].p0); // from the TL corner
    expect(stubR.p1).toEqual(p1.primitives[11].p1); // into the TR corner
    expect(stubL.p1.x - stubL.p0.x).toBeGreaterThan(0.2); // a real stub
    expect(stubR.p1.x - stubR.p0.x).toBeCloseTo(stubL.p1.x - stubL.p0.x, 9);
    for (const a of [shL, dip, shR]) expect(a.type).toBe('A');
    expect(dip.cx).toBeCloseTo(cx0, 9); // centred
    expect(dip.cy).toBeLessThan(y0); // concave: its centre above (outside) the top edge
    expect(shL.cy).toBeGreaterThan(y0); // convex: inside
    expect(shR.cx - cx0).toBeCloseTo(cx0 - shL.cx, 9);
    expect(shL.rx).toBeCloseTo(shR.rx, 9);
    expect(dip.cy + dip.rx - y0).toBeCloseTo(region.h / 2 * prof.params.topDipDepth, 9); // the dip's depth
    // the corners stay square: a vertical horn meets a horizontal stub
    expect(prof.primitives[0].p0.x).toBeCloseTo(prof.primitives[0].p1.x, 12);
    expect(prof.primitives[10].p0.x).toBeCloseTo(prof.primitives[10].p1.x, 12);
    // the base stays one flat edge
    expect(prof.primitives[5].p0.y).toBeCloseTo(prof.primitives[5].p1.y, 12);
  });

  it('7x9 defaults: a ~0.6 in deep dip, ~0.9 in straight stubs', () => {
    const prof = profile('template_5', {});
    const { stubL, dip } = top(prof);
    expect(dip.cy + dip.rx - prof.region.y).toBeCloseTo(0.6, 1);
    expect(stubL.p1.x - stubL.p0.x).toBeCloseTo(0.9, 1);
  });

  it('5.51x1.97: still a clean 16-piece outline (the board is too small for the frame: 0 bars, like the others)', () => {
    const prof = profile('template_5', {}, 5.51, 1.97);
    expect(prof.primitives.length).toBe(16);
    expect(prof.defects).toEqual([]);
    expect(prof.fit.ok).toBe(false);
    expect(profile('template_1', {}, 5.51, 1.97).fit.ok).toBe(false);
  });

  it.each(BOARDS)('%dx%d: 4 miters at the square corners, each a clean 45 deg (the frame thickness in both ways)', (W, H) => {
    const r = rec5({});
    const outer = frameCutProfile(FRAME_DEFS, r, board(W, H)), inn = frameInnerProfile(FRAME_DEFS, r, board(W, H));
    const miters = frameMiters(outer.primitives, inn.primitives);
    expect(miters).toHaveLength(4);
    for (const m of miters) {
      expect(Math.abs(m.inner.y - m.outer.y)).toBeCloseTo(0.75, 9);
      expect(Math.abs(m.inner.x - m.outer.x)).toBeCloseTo(0.75, 9);
    }
  });

  it('any dip seed is clamped into a valid top (outline and inner edge), at every board', () => {
    for (const [W, H] of BOARDS) {
      for (const w of [0, 0.3, 0.72, 0.99, 2]) {
        for (const d of [-1, 0, 0.1, 0.3, 0.9]) {
          const prof = profile('template_5', { topDipWidth: w, topDipDepth: d }, W, H);
          expect(prof.primitives.length, `${W}x${H} ${w} ${d}`).toBe(16);
          expect(prof.defects, `${W}x${H} ${w} ${d}`).toEqual([]);
        }
      }
    }
  });

  it('the Fusion seeds follow the dip: the five top pieces, the dip seeded just off the Y axis', () => {
    const prof = profile('template_5', {});
    const geo = frameSeedGeometry(T5, prof, 7, 9);
    const F = (p) => [p.x - 3.5, 4.5 - p.y];
    const { stubL, dip } = top(prof);
    expect(geo.top_edge_L.points).toEqual([F(stubL.p0), F(stubL.p1)]);
    expect(geo.arc_top_dip.points[1][0]).toBeCloseTo(0.01, 9); // the nudge
    expect(geo.arc_top_dip.points[1][1]).toBeCloseTo(4.5 - (dip.cy + dip.rx), 9);
    expect(geo.seed_rad_top_dip.radius).toBeCloseTo(dip.rx, 12);
    for (const k of ['top_edge_R', 'arc_top_shoulder_L', 'arc_top_shoulder_R', 'seed_rad_top_shoulder_L', 'seed_rad_top_shoulder_R']) expect(geo).toHaveProperty(k);
    expect(geo).not.toHaveProperty('top_edge');
  });
});

describe('Template 5: the top dip handles', () => {
  const drag = (key, seeds, dx, dy) => {
    const rec = rec5(seeds);
    const prof = frameCutProfile(FRAME_DEFS, rec, board(7, 9));
    const hs = frameHandles(T5, prof);
    const h = hs.find((q) => q.key === key);
    const pt = { x: h.anchor.x + dx, y: h.anchor.y + dy };
    return { h, hs, prof, rec, next: normalizeFrameRecord({ ...rec, ...handleDragPatch(rec, h, pt, prof.region) }) };
  };

  it('the table is Template 1\'s + Top dip depth / width, all seeded; the dip keys highlight their own arcs', () => {
    expect(T5.handles).toEqual([
      ...T1.handles,
      { key: 'topDipDepth', label: 'Top dip depth', basis: 'hh', binding: 'seeded' },
      { key: 'topDipWidth', label: 'Top dip width', basis: 'hw', binding: 'seeded' },
    ]);
    expect(T5.handleMigrations).toEqual({});
    const { hs } = drag('topDipDepth', {}, 0, 0);
    expect(hs.map((h) => h.key)).toEqual(T5.handles.map((h) => h.key));
    expect(HANDLE_SEGMENT_INDEX.hourglass).toMatchObject({ topDipDepth: 13, topDipWidth: 14 });
    expect(controlledSegments('hourglass', 'topDipDepth', 16)).toEqual([13]);
    expect(controlledSegments('hourglass', 'topDipWidth', 16)).toEqual([14, 12]);
    // the side handles keep their Template 1 mirror on the 16-piece outline
    expect(controlledSegments('hourglass', 'cornerRadiusTop', 16)).toEqual([1, 9]);
    expect(controlledSegments('hourglass', 'waistReach', 12)).toEqual([2, 8]); // unchanged
    expect([...Array(16).keys()].map(topDipMirrorIndex)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 15, 14, 13, 12, 11]);
  });

  it('the arc grips on the 16-piece outline hold the right arcs (Shoulder: both side shoulders, not the dip)', () => {
    const prof = profile('template_5', {});
    const hs = frameHandles(T5, prof);
    const sh = hs.find((h) => h.key === 'cornerRadiusTop'), wr = hs.find((h) => h.key === 'waistRadius');
    expect(J(sh.arcs)).toBe(J([prof.primitives[1], prof.primitives[9]]));
    expect(J(wr.arcs)).toBe(J([prof.primitives[2], prof.primitives[8]]));
    const a = sh.arcs[1];
    const mid = { x: a.cx + a.rx * Math.cos(a.theta1 + a.dTheta / 2), y: a.cy + a.rx * Math.sin(a.theta1 + a.dTheta / 2) };
    expect(sh.valueFromWorld(mid, { side: 1 })).toBeCloseTo(prof.params.cornerRadiusTop, 5);
  });

  it('Top dip depth: a square at the dip\'s lowest point; a drag down deepens the dip only', () => {
    const { h, prof, next } = drag('topDipDepth', {}, 0, 0.3);
    const { dip } = top(prof);
    expect(h).toMatchObject({ label: 'Top dip depth', axis: 'y', handleKind: 'position', binding: 'seeded' });
    expect(h.anchor.x).toBeCloseTo(dip.cx, 9);
    expect(h.anchor.y).toBeCloseTo(dip.cy + dip.rx, 9);
    expect(h.value).toBeCloseTo(prof.params.topDipDepth, 12);
    expect(next.params).toEqual({});
    expect(next.seeds.topDipDepth).toBeCloseTo(prof.params.topDipDepth + 0.3 / (prof.region.h / 2), 12);
    const after = frameCutProfile(FRAME_DEFS, next, board(7, 9));
    expect(after.defects).toEqual([]);
    const d2 = top(after).dip;
    expect(d2.cy + d2.rx).toBeCloseTo(dip.cy + dip.rx + 0.3, 9);
    for (let i = 0; i <= 10; i++) expect(J(after.primitives[i])).toBe(J(prof.primitives[i])); // the sides stay
    expect(J(top(after).stubL)).toBe(J(top(prof).stubL)); // the width is held
    const payload = framePayload(FRAME_DEFS, next);
    expect(Object.keys(payload.params).sort()).toEqual(T5.params.filter((p) => p.owner === 'frame').map((p) => p.name).sort());
  });

  it('Top dip width: a square where the right stub ends; a drag out widens the dip (both sides), depth held', () => {
    const { h, prof, next } = drag('topDipWidth', {}, -0.4, 0);
    const { stubR, dip } = top(prof);
    expect(h).toMatchObject({ label: 'Top dip width', axis: 'x', handleKind: 'position', binding: 'seeded' });
    expect(h.anchor.x).toBeCloseTo(stubR.p0.x, 9);
    expect(h.anchor.y).toBeCloseTo(stubR.p0.y, 9);
    const after = frameCutProfile(FRAME_DEFS, next, board(7, 9));
    expect(after.defects).toEqual([]);
    const t2 = top(after);
    expect(t2.stubR.p0.x).toBeCloseTo(stubR.p0.x - 0.4, 9);
    expect(t2.stubL.p1.x).toBeCloseTo(top(prof).stubL.p1.x + 0.4, 9);
    expect(t2.dip.cy + t2.dip.rx).toBeCloseTo(dip.cy + dip.rx, 9);
    for (let i = 0; i <= 10; i++) expect(J(after.primitives[i])).toBe(J(prof.primitives[i]));
  });

  it('dragged far, each dip handle stops at its range and the frame stays valid (outline and inner edge)', () => {
    for (const [key, dx, dy] of [['topDipDepth', 0, -20], ['topDipDepth', 0, 20], ['topDipWidth', 20, 0], ['topDipWidth', -20, 0]]) {
      const { next } = drag(key, {}, dx, dy);
      const after = frameCutProfile(FRAME_DEFS, next, board(7, 9));
      expect(after.primitives.length, key).toBe(16);
      expect(after.defects, key).toEqual([]);
      const inn = frameInnerProfile(FRAME_DEFS, next, board(7, 9));
      expect(inn && inn.defects, key).toEqual([]);
      expect(frameMiters(after.primitives, inn.primitives), key).toHaveLength(4);
    }
  });

  it('a high waist pinch leaves the dip less room: the frame ranges keep the inner edge open', () => {
    const region = profile('template_5', {}).region;
    for (const y of [-0.45, -0.3, 0, 0.3]) {
      const waist = { waistCenterY: y, waistReach: 0.55 };
      const r = frameParamRanges(T5, region, profile('template_5', waist).params, 0.75);
      for (const w of [r.topDipWidth.min, r.topDipWidth.max]) {
        const r2 = frameParamRanges(T5, region, profile('template_5', { ...waist, topDipWidth: w }).params, 0.75);
        expect(r2.topDipDepth.max, `${y} ${w}`).toBeGreaterThanOrEqual(r2.topDipDepth.min);
        for (const d of [r2.topDipDepth.min, r2.topDipDepth.max]) {
          const seeds = { ...waist, topDipWidth: w, topDipDepth: d };
          expect(profile('template_5', seeds).defects).toEqual([]);
          expect(inner('template_5', seeds).defects, `${y} ${w} ${d}`).toEqual([]);
        }
      }
    }
  });

  it('[Generate] draws the dip too, always a valid frame', () => {
    const region = profile('template_5', {}).region;
    for (let seed = 1; seed <= 50; seed++) {
      const seeds = generateFrameSeeds(T5, region, seed);
      for (const k of DIP) expect(seeds).toHaveProperty(k);
      const prof = profile('template_5', seeds);
      expect(prof.params.topDipDepth).toBeCloseTo(seeds.topDipDepth, 12);
      expect(prof.params.topDipWidth).toBeCloseTo(seeds.topDipWidth, 12);
      expect(prof.primitives.length).toBe(16);
      expect(prof.defects).toEqual([]);
      const inn = inner('template_5', seeds);
      expect(inn && inn.defects).toEqual([]);
    }
  });
});

describe('Shape Lattice "from frame" follows the dipped top', () => {
  const frame = (W = 7, H = 9) => ({ defs: FRAME_DEFS, record: rec5({}), board: board(W, H) });

  it.each(BOARDS)('%dx%d: the offset contour has the 16 pieces, the dip included, and its own mirror table', (W, H) => {
    const sil = frameContourSilhouette(frame(W, H), 0.25, 0.1);
    expect(sil.error).toBeUndefined();
    expect(sil.primitives.length).toBe(16);
    expect(sil.mirror).toEqual([...Array(16).keys()].map(topDipMirrorIndex));
    const prof = profile('template_5', {}, W, H), dip = prof.primitives[13], d = sil.primitives[13];
    expect(d.type).toBe('A');
    expect(d.cx).toBeCloseTo(dip.cx, 9);
    expect(d.rx).toBeCloseTo(dip.rx + 0.25 + 0.05, 9); // concave: grows by the offset (to the centreline)
  });

  it('the Fusion manifest pairs mirror entities by that table (never a side shoulder with the dip)', () => {
    const sil = frameContourSilhouette(frame(), 0.25, 0.1);
    const m = manifestFromShape({ preset: 'hourglass', params: {} }, sil.region, { silhouette: sil });
    const eq = m.constraints.filter((c) => c.type === 'Equal').map((c) => c.targets.join('-')).sort();
    const want = [];
    for (let i = 0; i < 16; i++) {
      const j = topDipMirrorIndex(i);
      if (j > i && sil.primitives[i].type === sil.primitives[j].type) want.push(`seg${i}-seg${j}`);
    }
    expect(eq).toEqual(want.sort());
    expect(eq).not.toContain('seg1-seg13');
  });

  it('Template 1\'s from-frame contour has no mirror table (the plain rule, as before)', () => {
    const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: 'template_1' }), board: board(7, 9) }, 0.25, 0.1);
    expect(sil).not.toHaveProperty('mirror');
    expect(sil.primitives.length).toBe(12);
  });
});

/**
 * Coordinator check (screenshot out_v25/06): a Shape Lattice rail at a height inside the dip's y-range meets the
 * contour 4 times, not 2, so it must come out as TWO pieces (left and right of the dip), never one full-width rail
 * across the dip. The lattice clips each row / column to the boundary's own inside spans (insideSpans, the same
 * generic rule that splits a vertical rail at a pinched side waist), so this is asserted, not special-cased: every
 * rail, tie and node lies inside the from-frame contour, for several seeds, boards and dips.
 */
describe('Shape Lattice from frame: every rail, tie and node stays inside the dipped contour', () => {
  const STROKE = 0.25, SPACING = PATTERN_DEFAULTS.spacing;
  // the boundary exactly as the app resolves it: the contour's per-segment `d`s joined and parsed back
  // (editor-lattice-pattern.js _resolveBoundaryPrimitives, centreline edge)
  const boundaryOf = (sil) => insetGeneratedPresetPathDToPrimitives(joinSegmentPathsIntoClosedD(sil.primitives.map((p) => primitiveToPathD(p))), 0);
  const inside = (q, poly, prims) => pointInPolygon(q.x, q.y, poly) || prims.some((p) => distToPrimitive(q, p) < 1e-6);
  const dips = (W, H) => {
    const region = profile('template_5', {}, W, H).region;
    const deepWide = frameParamRanges(T5, region, profile('template_5', {}, W, H).params, 0.75);
    const wide = deepWide.topDipWidth.max;
    const r2 = frameParamRanges(T5, region, profile('template_5', { topDipWidth: wide }, W, H).params, 0.75);
    return [{}, { topDipWidth: wide, topDipDepth: r2.topDipDepth.max }, { topDipWidth: 0.45, topDipDepth: 0.35 }, { topDipWidth: wide, topDipDepth: 0.1 }];
  };
  const CASES = [];
  for (const [W, H] of [[7, 9], [12, 6]]) for (const seeds of dips(W, H)) CASES.push([W, H, seeds]);

  it.each(CASES)('%dx%d %j', (W, H, seeds) => {
    const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: rec5(seeds), board: board(W, H) }, 0.25, STROKE);
    expect(sil.error).toBeUndefined();
    expect(sil.primitives.length).toBe(16);
    const prims = boundaryOf(sil);
    expect(prims.length).toBe(16);
    const poly = sampleOutline(prims, 96); // the boundary the lattice clips to (the drawn contour's own paths)
    const dip = sil.primitives[13], stubY = sil.primitives[11].p0.y, dipBottom = dip.cy + dip.rx;
    let splitRows = 0;
    for (let seed = 1; seed <= 8; seed++) {
      for (const rails of [PATTERN_DEFAULTS.rails, { ...PATTERN_DEFAULTS.rails, spacing: 0.5 }, { mode: 'count', count: [9, 11] }]) {
        const PATTERN = { ...PATTERN_DEFAULTS, seed, rails, boundary: { ...PATTERN_DEFAULTS.boundary, endRule: 'on-boundary' }, extent: { mode: 'boundary' } };
        const { segments, nodePoints } = computePattern(PATTERN, { extent: _resolveExtent(null, PATTERN, prims) });
        const W2 = (p) => ({ x: p.i * SPACING, y: p.j * SPACING });
        for (const g of segments) {
          const a = W2(g.a), b = W2(g.b);
          for (let t = 0; t <= 1.0001; t += 0.02) {
            const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
            expect(inside(q, poly, prims), `${g.kind} seed ${seed} at ${q.x.toFixed(3)},${q.y.toFixed(3)}`).toBe(true);
          }
        }
        for (const n of nodePoints) expect(inside(W2(n), poly, prims), `node seed ${seed}`).toBe(true);
        // a rail between the stubs' line and the dip bottom: two pieces, one each side of the dip
        const rows = new Map();
        for (const g of segments.filter((x) => x.kind === 'rail')) {
          const y = g.a.j * SPACING;
          if (y > stubY + 1e-6 && y < dipBottom - 1e-6) rows.set(y, [...(rows.get(y) || []), g]);
        }
        for (const [, pieces] of rows) {
          expect(pieces.length).toBe(2);
          const [l, r] = pieces.map((g) => [g.a.i * SPACING, g.b.i * SPACING].sort((u, v) => u - v)).sort((u, v) => u[0] - v[0]);
          expect(l[1]).toBeLessThan(dip.cx);
          expect(r[0]).toBeGreaterThan(dip.cx);
          splitRows++;
        }
      }
    }
    if (dipBottom - stubY > 2 * SPACING * 4) expect(splitRows).toBeGreaterThan(0); // a deep dip always has such a row
  });
});

describe('the edge-collinear guard is generic: a plain Shape Lattice column along an hourglass side edge', () => {
  // The same miscount on a SIDE: a vertical rail / tie exactly on a horn's line touches the shoulder and hip arcs
  // tangentially at the horn's ends (MEASURED before the guard: 108 lattice pieces outside the contour over 60
  // random hourglass / bottle shapes, vertical orientation). Every piece now stays inside.
  it('60 random preset contours, both orientations: every rail / tie midpoint is inside the contour', () => {
    let s = 3;
    const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 60; i++) {
      const preset = i % 3 ? 'hourglass' : 'bottle';
      const region = { x: 0.5, y: 0.5, w: 3 + rnd() * 8, h: 3 + rnd() * 8 };
      const sil = generateContourSilhouette(region, { preset, params: {}, seed: i }, 0.25);
      const prims = insetGeneratedPresetPathDToPrimitives(joinSegmentPathsIntoClosedD(sil.primitives.map((p) => primitiveToPathD(p))), 0);
      const poly = sampleOutline(prims, 96);
      for (const orientation of ['horizontal', 'vertical']) {
        const PATTERN = { ...PATTERN_DEFAULTS, seed: i + 1, orientation, boundary: { ...PATTERN_DEFAULTS.boundary, endRule: 'on-boundary' }, extent: { mode: 'boundary' } };
        const { segments } = computePattern(PATTERN, { extent: _resolveExtent(null, PATTERN, prims) });
        for (const g of segments) {
          const m = { x: ((g.a.i + g.b.i) / 2) * PATTERN_DEFAULTS.spacing, y: ((g.a.j + g.b.j) / 2) * PATTERN_DEFAULTS.spacing };
          const ok = pointInPolygon(m.x, m.y, poly) || prims.some((p) => distToPrimitive(m, p) < 1e-4);
          expect(ok, `${preset} #${i} ${orientation} ${g.kind} at ${m.x.toFixed(3)},${m.y.toFixed(3)}`).toBe(true);
        }
      }
    }
  });
});

describe('the Shape Lattice never gets the top dip', () => {
  it('frame-only params: not Shape Lattice params, not default handles', () => {
    for (const k of DIP) {
      expect(FRAME_ONLY_PARAM_KEYS).toContain(k);
      expect(SHAPE_PARAM_KEYS.hourglass).not.toContain(k);
    }
    const region = { x: 0, y: 0, w: 6, h: 8 };
    const sil = generateSilhouette(region, { preset: 'hourglass', params: {} });
    expect(computeParamHandles('hourglass', region, sil.params).map((h) => h.key).filter((k) => DIP.includes(k))).toEqual([]);
  });

  it('the Fusion manifest never emits a dip user parameter, even if one reached a pattern', () => {
    const region = { x: 0, y: 0, w: 6, h: 8 };
    const plain = manifestFromShape({ preset: 'hourglass', params: {} }, region);
    const stray = manifestFromShape({ preset: 'hourglass', params: { topDipDepth: 0.2, topDipWidth: 0.6 } }, region);
    expect(stray.parameters.map((p) => p.name)).toEqual(plain.parameters.map((p) => p.name));
    expect(generateContourSilhouette(region, { preset: 'hourglass', params: {} }, 0.1).params).not.toHaveProperty('topDipDepth');
  });
});

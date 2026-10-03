/**
 * T17 TULIP: Template 16's own one-piece arch, two outward-bulging lower curves and flat base,
 * plus two CONCAVE upper sides (arcs, not Template 16's plain lines) curving toward the centreline
 * from the arch ends to the waist -- every joint still a MITER. The frame-only `tulip` preset
 * (editor-shape-lattice-generator.js `_solveArchedTimer`/`archedFunnelConstruction`, upperCurveFrac
 * > 0), its 6 handles, and the guards that keep every other template and the Shape Lattice exactly
 * as they were.
 *
 * UNVERIFIED LIVE (no Fusion bridge available this turn): these tests prove the JS-side geometry is
 * internally consistent AND numerically matches fb_engine.t16_geometry.outline()'s own
 * independently-tested closed form EXACTLY -- they cannot prove the Fusion sketch build itself
 * solves cleanly (that is T84 item 3's own live matrix sweep, item 61). The new
 * ResolveCircleCircleCorner resolver (4 of this template's 6 corners) has its own dedicated
 * Fusion-side tests (fb_engine/test_inner_corners.py, fb_engine/test_t7_roof_eave.py) -- not
 * repeated here, since this file is the JS app side only.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile, frameInnerProfile, frameMiters, miterStaysInsideWood } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { frameHandles, handleDragPatch, frameSeedGeometry, frameParamRanges } from '../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';
import { PARAM_ORDER, FRAME_ONLY_PARAM_KEYS, paramsFromShapeModel, archedFunnelConstruction } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import { HANDLE_SEGMENT_INDEX, controlledSegments } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-interaction.js';
import { frameLabel } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';
import { sampleOutline } from '../bspline-frame-builder/b-spline-gen/html/core/preview/frame-mesh.js';

const tplOf = (id) => FRAME_DEFS.templates.find((t) => t.id === id);
const T17 = tplOf('template_17');
const PORTRAIT_BOARDS = [[6, 9], [7, 9], [9, 12]];
const KEYS = ['topWidth', 'archRiseFrac', 'waistWidthFrac', 'waistHeightFrac', 'bulgeFrac', 'upperCurveFrac'];
const T = 0.75;
const board = (W, H) => ({ widthIn: W, heightIn: H });
const rec17 = (seeds) => normalizeFrameRecord({ templateId: 'template_17', seeds });
const profile = (seeds, W = 7, H = 9) => frameCutProfile(FRAME_DEFS, rec17(seeds), board(W, H));
const inner = (seeds, W = 7, H = 9) => frameInnerProfile(FRAME_DEFS, rec17(seeds), board(W, H));
const primLength = (p) => (p.type === 'L' ? Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y) : p.rx * Math.abs(p.dTheta));
const primPt = (p, atEnd) => (p.type === 'L' ? (atEnd ? p.p1 : p.p0)
  : { x: p.cx + p.rx * Math.cos(atEnd ? p.theta1 + p.dTheta : p.theta1), y: p.cy + p.ry * Math.sin(atEnd ? p.theta1 + p.dTheta : p.theta1) });
const J = (x) => JSON.stringify(x);

describe('Template 17: listing and declaration', () => {
  it('is listed as "17. Tulip", the frame-only tulip preset, 6 bars, no new Fusion parameter', () => {
    expect(T17.name).toBe('Template 17 - Tulip');
    expect(frameLabel(T17)).toBe('17. Tulip');
    expect(T17.silhouettePreset).toBe('tulip');
    const T17_GEOMETRY_PARAMS = ['t16_hw', 't16_hh', 't16_ww', 't16_wy', 't16_bulge', 't16_lr_dx', 't16_lr_dy',
      't16_lr_chordlen', 't16_lr_nx', 't16_lr_ny', 't16_lr_halfchord', 't16_lr_r', 't16_lr_cx', 't16_lr_cy',
      't16_lr_u0x', 't16_lr_u0y', 't16_lr_u1x', 't16_lr_u1y', 't16_lr_bx', 't16_lr_by', 't16_lr_blen', 't16_lr_vx', 't16_lr_vy',
      't17_upper', 't17_ur_dx', 't17_ur_dy', 't17_ur_chordlen', 't17_ur_nx', 't17_ur_ny', 't17_ur_halfchord', 't17_ur_r',
      't17_ur_cx', 't17_ur_cy', 't17_ur_u0x', 't17_ur_u0y', 't17_ur_u1x', 't17_ur_u1y', 't17_ur_bx', 't17_ur_by',
      't17_ur_blen', 't17_ur_vx', 't17_ur_vy'];
    expect(T17.params.map((p) => p.name)).toEqual(['widthIn', 'heightIn', 'boundingboxoffset', ...T17_GEOMETRY_PARAMS, 'frame_thickness']);
    expect(T17.regions.outline).toEqual(['proj_upper_R', 'proj_lower_R', 'proj_base', 'proj_lower_L', 'proj_upper_L', 'proj_arch']);
    expect(T17.regions.miters).toHaveLength(6);
    expect(T17.regions.bars.map((b) => b.name)).toEqual(T17.features[0].bodyNames);
    expect(T17.regions.bars.map((b) => b.name)).toEqual(
      ['frame_upper_right', 'frame_lower_right', 'frame_base', 'frame_lower_left', 'frame_upper_left', 'frame_arch']);
    expect(T17.handles.map((h) => h.key)).toEqual(KEYS);
    for (const h of T17.handles) expect(h.binding).toBe('seeded');
  });

  it.each(PORTRAIT_BOARDS)('%dx%d: a clean 6-piece frame, A-A-L-A-A-A (every side an arc but the base), no defects', (W, H) => {
    const prof = profile({}, W, H);
    expect(prof.primitives.length, J({ W, H })).toBe(6);
    expect(prof.defects, J({ W, H })).toEqual([]);
    const inn = inner({}, W, H);
    if (inn) expect(inn.defects, J({ W, H })).toEqual([]);
    // 0 upper_R(A), 1 lower_R(A), 2 base(L), 3 lower_L(A), 4 upper_L(A), 5 arch(A) -- the ONE
    // difference from Template 16's own L-A-L-A-L-A: the two upper sides are now concave arcs.
    expect(prof.primitives.map((p) => p.type), J({ W, H })).toEqual(['A', 'A', 'L', 'A', 'A', 'A']);
  });

  it('every bar at the default is at least frame_thickness long, at every portrait board', () => {
    for (const [W, H] of PORTRAIT_BOARDS) {
      const prof = profile({}, W, H);
      prof.primitives.forEach((p, i) => expect(primLength(p), `${W}x${H} piece ${i}`).toBeGreaterThanOrEqual(T * 0.99));
    }
  });

  it('the outline is symmetric about the centreline: topL/topR, waistL/waistR, BL/BR mirror exactly', () => {
    const prof = profile({});
    const cx0 = prof.region.x + prof.region.w / 2;
    const [upperR, lowerR, base, , upperL] = prof.primitives;
    const topR = primPt(upperR, false), topL = primPt(upperL, true);
    const waistR = primPt(upperR, true), waistL = primPt(upperL, false);
    const BR = primPt(lowerR, true), BL = primPt(base, true);
    expect(topR.x - cx0).toBeCloseTo(-(topL.x - cx0), 9);
    expect(topR.y).toBeCloseTo(topL.y, 9);
    expect(waistR.x - cx0).toBeCloseTo(-(waistL.x - cx0), 9);
    expect(waistR.y).toBeCloseTo(waistL.y, 9);
    expect(BR.x - cx0).toBeCloseTo(-(BL.x - cx0), 9);
    expect(BR.y).toBeCloseTo(BL.y, 9);
  });

  // 0..W / 0..H (the true board edges), not the safe zone -- see Template 16's own copy of this
  // test for why (a convex arc's own bulge can swing slightly past its chord ends' own x/y, which
  // the BBox Border margin exists to absorb).
  it('the outer profile stays within the true board edges at every portrait board', () => {
    for (const [W, H] of PORTRAIT_BOARDS) {
      const prof = profile({}, W, H);
      const poly = sampleOutline(prof.primitives, 96);
      for (const p of poly) {
        expect(p.x, `${W}x${H} x=${p.x}`).toBeGreaterThanOrEqual(0 - 1e-6);
        expect(p.x, `${W}x${H} x=${p.x}`).toBeLessThanOrEqual(W + 1e-6);
        expect(p.y, `${W}x${H} y=${p.y}`).toBeGreaterThanOrEqual(0 - 1e-6);
        expect(p.y, `${W}x${H} y=${p.y}`).toBeLessThanOrEqual(H + 1e-6);
      }
    }
  });

  it('the 6 miters sit strictly inside the band, and no miter hooks outside the wood (Fred: no thin/needle tips)', () => {
    for (const [W, H] of PORTRAIT_BOARDS) {
      const outer = profile({}, W, H);
      const innerP = inner({}, W, H);
      const miters = frameMiters(outer.primitives, innerP.primitives);
      expect(miters, J({ W, H })).toHaveLength(6);
      const cx0 = outer.region.x + outer.region.w / 2, cy0 = outer.region.y + outer.region.h / 2;
      for (const m of miters) {
        const dOuter = Math.hypot(m.outer.x - cx0, m.outer.y - cy0);
        const dInner = Math.hypot(m.inner.x - cx0, m.inner.y - cy0);
        expect(dInner, J({ W, H, m })).toBeLessThan(dOuter);
      }
      expect(miterStaysInsideWood(outer.primitives, miters, T), J({ W, H })).toBe(true);
    }
  });

  // Board-local, Fusion y-up inches, BBO=0.25 -> HW=3.25, HH=4.25 (7x9); the lower-bulge/arch
  // points are IDENTICAL to Template 16's own copy of this test (the shared lower half) --
  // computed directly from fb_engine/t16_geometry.py's own outline(6.5, 8.5, 0.75,
  // upper_curve_frac=0.175), not re-derived here.
  it('the Fusion seeds match fb_engine.t16_geometry.outline()\'s own closed-form values exactly, at 7x9', () => {
    const prof = profile({}, 7, 9);
    const geo = frameSeedGeometry(T17, prof, 7, 9);
    expect(Object.keys(geo).sort()).toEqual(T17.seedMap.map((e) => e.id).sort());
    const approx = (pt, [x, y]) => { expect(pt[0]).toBeCloseTo(x, 6); expect(pt[1]).toBeCloseTo(y, 6); };
    const topR = [2.4375, 2.9825], topL = [-2.4375, 2.9825];
    const waistR = [1.235, -0.425], waistL = [-1.235, -0.425];
    const BR = [3.25, -4.25], BL = [-3.25, -4.25];
    const lowerRVia = [2.728444844556691, -2.081505526331574];
    const upperRVia = [1.2999169836556677, 1.468020859032738];
    const apex = [0, 4.25];
    approx(geo.upper_R.points[0], topR);
    approx(geo.upper_R.points[1], upperRVia);
    approx(geo.upper_R.points[2], waistR);
    approx(geo.lower_R.points[0], waistR);
    approx(geo.lower_R.points[1], lowerRVia);
    approx(geo.lower_R.points[2], BR);
    approx(geo.base.points[0], BR);
    approx(geo.base.points[1], BL);
    approx(geo.lower_L.points[0], BL);
    approx(geo.lower_L.points[2], waistL);
    approx(geo.upper_L.points[0], waistL);
    approx(geo.upper_L.points[1], [-upperRVia[0], upperRVia[1]]);
    approx(geo.upper_L.points[2], topL);
    approx(geo.arch.points[0], topL);
    approx(geo.arch.points[1], apex);
    approx(geo.arch.points[2], topR);
  });
});

describe('Template 17: the handles', () => {
  const drag = (key, seeds, dx, dy) => {
    const rec = rec17(seeds);
    const prof = frameCutProfile(FRAME_DEFS, rec, board(7, 9));
    const hs = frameHandles(T17, prof);
    const h = hs.find((q) => q.key === key);
    const pt = { x: h.anchor.x + dx, y: h.anchor.y + dy };
    return { h, hs, prof, rec, next: normalizeFrameRecord({ ...rec, ...handleDragPatch(rec, h, pt, prof.region) }) };
  };

  it('the table is exactly the approved 6, all seeded, with a generateRange narrower than the drag range', () => {
    expect(T17.handles).toEqual([
      { key: 'topWidth', label: 'Top width', basis: 'hw', binding: 'seeded', generateRange: { min: 0.64, max: 0.86 } },
      { key: 'archRiseFrac', label: 'Arch rise', basis: 'hw', binding: 'seeded', generateRange: { min: 0.205, max: 0.565 } },
      { key: 'waistWidthFrac', label: 'Waist width', basis: 'hw', binding: 'seeded', generateRange: { min: 0.335, max: 0.405 } },
      { key: 'waistHeightFrac', label: 'Waist height', basis: 'h', binding: 'seeded', generateRange: { min: 0.45, max: 0.67 } },
      { key: 'bulgeFrac', label: 'Lower bulge', basis: 'hw', binding: 'seeded', generateRange: { min: 0.089, max: 0.174 } },
      { key: 'upperCurveFrac', label: 'Upper side curve', basis: 'hw', binding: 'seeded', generateRange: { min: 0.09, max: 0.215 } },
    ]);
    expect(T17.handleMigrations).toEqual({});
    const { hs } = drag('topWidth', {}, 0, 0);
    expect(hs.map((h) => h.key).sort()).toEqual([...T17.handles.map((h) => h.key)].sort());
    expect(HANDLE_SEGMENT_INDEX.tulip).toEqual(
      { topWidth: 5, archRiseFrac: 5, waistWidthFrac: 1, waistHeightFrac: 1, bulgeFrac: 1, upperCurveFrac: 0 });
    expect(controlledSegments('tulip', 'upperCurveFrac', 6)).toEqual([0, 4]);
  });

  it('each handle round-trips: valueFromWorld at its own anchor returns its own resolved value', () => {
    const prof = profile({});
    const hs = frameHandles(T17, prof);
    for (const h of hs) expect(h.valueFromWorld(h.anchor), h.key).toBeCloseTo(h.value, 6);
  });

  it('dragged far, each handle stops at its own drag range and the frame stays valid (outline, inner edge, 6 miters, no thin tips)', () => {
    for (const [key, dx, dy] of [['topWidth', 20, 0], ['topWidth', -20, 0],
      ['archRiseFrac', 0, 20], ['archRiseFrac', 0, -20],
      ['waistWidthFrac', 20, 0], ['waistWidthFrac', -20, 0],
      ['waistHeightFrac', 0, 20], ['waistHeightFrac', 0, -20],
      ['bulgeFrac', 20, 0], ['bulgeFrac', -20, 0],
      ['upperCurveFrac', 20, 0], ['upperCurveFrac', -20, 0]]) {
      const { next } = drag(key, {}, dx, dy);
      const after = frameCutProfile(FRAME_DEFS, next, board(7, 9));
      expect(after.primitives.length, key).toBe(6);
      expect(after.defects, key).toEqual([]);
      const innAfter = frameInnerProfile(FRAME_DEFS, next, board(7, 9));
      expect(innAfter && innAfter.defects, key).toEqual([]);
      const miters = frameMiters(after.primitives, innAfter.primitives);
      expect(miters, key).toHaveLength(6);
      expect(miterStaysInsideWood(after.primitives, miters, T), key).toBe(true);
    }
  });

  it('every handle at its own declared generateRange extreme is still a clean, valid frame, at every portrait board', () => {
    for (const [W, H] of PORTRAIT_BOARDS) {
      for (const h of T17.handles) {
        for (const v of [h.generateRange.min, h.generateRange.max]) {
          const rec = rec17({ [h.key]: v });
          const prof = frameCutProfile(FRAME_DEFS, rec, board(W, H));
          const tag = J({ W, H, key: h.key, v });
          expect(prof.defects, tag).toEqual([]);
          const inn = frameInnerProfile(FRAME_DEFS, rec, board(W, H));
          expect(inn && inn.defects, tag).toEqual([]);
          const miters = frameMiters(prof.primitives, inn.primitives);
          expect(miters, tag).toHaveLength(6);
          expect(miterStaysInsideWood(prof.primitives, miters, T), tag).toBe(true);
        }
      }
    }
  });
});

describe('Template 17 does not disturb anything else', () => {
  it('upperCurveFrac is brand new and listed in FRAME_ONLY_PARAM_KEYS; the other 5 keys are shared with Template 16', () => {
    for (const k of KEYS) expect(FRAME_ONLY_PARAM_KEYS).toContain(k);
  });

  it('paramsFromShapeModel round-trips the provisional model exactly (every feature a plain hw/hh fraction)', () => {
    const region = profile({}).region;
    const out = paramsFromShapeModel('tulip', T17.shapeModel, region);
    expect(out.topWidth).toBeCloseTo(0.75, 9);
    expect(out.archRiseFrac).toBeCloseTo(0.39, 9);
    expect(out.waistWidthFrac).toBeCloseTo(0.38, 9);
    expect(out.waistHeightFrac).toBeCloseTo(0.55, 9);
    expect(out.bulgeFrac).toBeCloseTo(0.169, 9);
    expect(out.upperCurveFrac).toBeCloseTo(0.175, 9);
  });

  it('archedFunnelConstruction builds a real concave arc when upperCurveFrac > 0 (unlike Template 16\'s own straight sides)', () => {
    const g = archedFunnelConstruction({ w: 6.5, h: 8.5 }, { upperCurveFrac: 0.175 });
    expect(g.upperRadius).not.toBeNull();
    expect(g.upperRadius).toBeGreaterThan(0);
  });

  it('Templates 1-13/16 are unaffected: none of them declare template_17\'s own preset or outline', () => {
    for (const id of ['template_1', 'template_2', 'template_3', 'template_4', 'template_5', 'template_6',
      'template_7', 'template_8', 'template_9', 'template_10', 'template_11', 'template_12', 'template_13', 'template_16']) {
      const t = tplOf(id);
      expect(t.silhouettePreset, id).not.toBe('tulip');
    }
  });

  it('PARAM_ORDER.tulip matches the declared handle order exactly', () => {
    expect(PARAM_ORDER.tulip).toEqual(KEYS);
  });

  it('frameParamRanges does not crash and returns the full drag-feasible range for every handle', () => {
    const region = profile({}).region;
    const R = frameParamRanges(T17, region, { topWidth: 0.75, archRiseFrac: 0.39, waistWidthFrac: 0.38, waistHeightFrac: 0.55, bulgeFrac: 0.169, upperCurveFrac: 0.175 });
    for (const k of KEYS) { expect(R[k].min).toBeLessThan(R[k].max); }
  });
});

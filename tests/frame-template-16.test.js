/**
 * T16 ARCHED FUNNEL: a one-piece arch (the apex is a tangent point of its OWN single arc, never a
 * corner), two straight upper sides tapering to a waist, two outward-bulging lower curves, a flat
 * base -- every joint a MITER (fb_engine/t16_geometry.py's own module docstring), unlike every
 * earlier frame-only preset's own tangent chain. The frame-only `archedFunnel` preset
 * (editor-shape-lattice-generator.js `_solveArchedTimer`/`archedFunnelConstruction`), its 5 handles,
 * and the guards that keep every other template and the Shape Lattice exactly as they were.
 *
 * UNVERIFIED LIVE (no Fusion bridge available this turn): these tests prove the JS-side geometry is
 * internally consistent (closed, within the board, every bar long enough at the default, no defect
 * at every handle's own declared extreme) AND numerically matches fb_engine.t16_geometry.outline()'s
 * own independently-tested closed form EXACTLY (not approximately) -- they cannot prove the Fusion
 * sketch build itself solves cleanly (that is T84 item 3's own live matrix sweep, item 61).
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
const T16 = tplOf('template_16');
// Portrait boards (project_portrait_only: Fred currently builds portrait boards only).
const PORTRAIT_BOARDS = [[6, 9], [7, 9], [9, 12]];
const KEYS = ['topWidth', 'archRiseFrac', 'waistWidthFrac', 'waistHeightFrac', 'bulgeFrac'];
const T = 0.75; // the default frame thickness
const board = (W, H) => ({ widthIn: W, heightIn: H });
const rec16 = (seeds) => normalizeFrameRecord({ templateId: 'template_16', seeds });
const profile = (seeds, W = 7, H = 9) => frameCutProfile(FRAME_DEFS, rec16(seeds), board(W, H));
const inner = (seeds, W = 7, H = 9) => frameInnerProfile(FRAME_DEFS, rec16(seeds), board(W, H));
const primLength = (p) => (p.type === 'L' ? Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y) : p.rx * Math.abs(p.dTheta));
const J = (x) => JSON.stringify(x);

describe('Template 16: listing and declaration', () => {
  it('is listed as "16. Arched Funnel", the frame-only archedFunnel preset, 6 bars, no new Fusion parameter', () => {
    expect(T16.name).toBe('Template 16 - Arched Funnel');
    expect(frameLabel(T16)).toBe('16. Arched Funnel');
    expect(T16.silhouettePreset).toBe('archedFunnel');
    const T16_GEOMETRY_PARAMS = ['t16_hw', 't16_hh', 't16_ww', 't16_wy', 't16_bulge', 't16_lr_dx', 't16_lr_dy',
      't16_lr_chordlen', 't16_lr_nx', 't16_lr_ny', 't16_lr_halfchord', 't16_lr_r', 't16_lr_cx', 't16_lr_cy',
      't16_lr_u0x', 't16_lr_u0y', 't16_lr_u1x', 't16_lr_u1y', 't16_lr_bx', 't16_lr_by', 't16_lr_blen', 't16_lr_vx', 't16_lr_vy'];
    expect(T16.params.map((p) => p.name)).toEqual(['widthIn', 'heightIn', 'boundingboxoffset', ...T16_GEOMETRY_PARAMS, 'frame_thickness']);
    expect(T16.regions.outline).toEqual(['proj_upper_R', 'proj_lower_R', 'proj_base', 'proj_lower_L', 'proj_upper_L', 'proj_arch']);
    expect(T16.regions.miters).toHaveLength(6);
    expect(T16.regions.bars.map((b) => b.name)).toEqual(T16.features[0].bodyNames);
    expect(T16.regions.bars.map((b) => b.name)).toEqual(
      ['frame_upper_right', 'frame_lower_right', 'frame_base', 'frame_lower_left', 'frame_upper_left', 'frame_arch']);
    expect(T16.handles.map((h) => h.key)).toEqual(KEYS);
    for (const h of T16.handles) expect(h.binding).toBe('seeded'); // never a Fusion user parameter
  });

  it.each(PORTRAIT_BOARDS)('%dx%d: a clean 6-piece frame, L-A-L-A-L-A, no defects', (W, H) => {
    const prof = profile({}, W, H);
    expect(prof.primitives.length, J({ W, H })).toBe(6);
    expect(prof.defects, J({ W, H })).toEqual([]);
    const inn = inner({}, W, H);
    if (inn) expect(inn.defects, J({ W, H })).toEqual([]);
    // 0 upper_R(L), 1 lower_R(A), 2 base(L), 3 lower_L(A), 4 upper_L(L), 5 arch(A) --
    // editor-shape-lattice-generator.js's own _solveArchedTimer doc comment.
    expect(prof.primitives.map((p) => p.type), J({ W, H })).toEqual(['L', 'A', 'L', 'A', 'L', 'A']);
  });

  it('every bar at the default is at least frame_thickness long, at every portrait board', () => {
    for (const [W, H] of PORTRAIT_BOARDS) {
      const prof = profile({}, W, H);
      prof.primitives.forEach((p, i) => expect(primLength(p), `${W}x${H} piece ${i}`).toBeGreaterThanOrEqual(T * 0.99));
    }
  });

  // An arc primitive has no p0/p1 (it's {cx,cy,rx,ry,phi,theta1,dTheta}); this reads either
  // type's own start/end point generically, same shape _solveHourglass's own doc comment uses.
  const primPt = (p, atEnd) => (p.type === 'L' ? (atEnd ? p.p1 : p.p0)
    : { x: p.cx + p.rx * Math.cos(atEnd ? p.theta1 + p.dTheta : p.theta1), y: p.cy + p.ry * Math.sin(atEnd ? p.theta1 + p.dTheta : p.theta1) });

  it('the outline is symmetric about the centreline: topL/topR, waistL/waistR, BL/BR mirror exactly', () => {
    const prof = profile({});
    const cx0 = prof.region.x + prof.region.w / 2;
    const [upperR, lowerR, base, , upperL] = prof.primitives;
    // upperR: topR -> waistR; lowerR: waistR -> BR; base: BR -> BL; upperL: waistL -> topL.
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

  // 0..W / 0..H (the true board edges), not the safe zone: a convex arc's own bulge can swing
  // slightly past its two chord ends' own x/y -- MEASURED at 6x9 (~0.0008in into the BBox Border
  // margin), which the margin exists to absorb -- so the safe zone's own edge is too strict here.
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

  // T84 item 3: the seed geometry must match fb_engine.t16_geometry.outline()'s own independently-
  // tested closed form EXACTLY -- this is the one check that most directly bears on whether the
  // live Fusion build (item 61) will land on the SAME points the Python/Fusion side already proved
  // correct (fb_engine/test_t16_fusion_expressions.py), not just "a reasonable-looking shape".
  // Board-local, Fusion y-up inches, BBO=0.25 -> HW=3.25, HH=4.25 (7x9): computed directly from
  // fb_engine/t16_geometry.py's own outline(6.5, 8.5, 0.75), not re-derived here.
  it('the Fusion seeds match fb_engine.t16_geometry.outline()\'s own closed-form values exactly, at 7x9', () => {
    const prof = profile({}, 7, 9);
    const geo = frameSeedGeometry(T16, prof, 7, 9);
    expect(Object.keys(geo).sort()).toEqual(T16.seedMap.map((e) => e.id).sort());
    const approx = (pt, [x, y]) => { expect(pt[0]).toBeCloseTo(x, 6); expect(pt[1]).toBeCloseTo(y, 6); };
    const topR = [2.4375, 2.9825], topL = [-2.4375, 2.9825];
    const waistR = [1.235, -0.425], waistL = [-1.235, -0.425];
    const BR = [3.25, -4.25], BL = [-3.25, -4.25];
    const lowerRVia = [2.728444844556691, -2.081505526331574];
    const apex = [0, 4.25];
    approx(geo.upper_R.points[0], topR);
    approx(geo.upper_R.points[1], waistR);
    approx(geo.lower_R.points[0], waistR);
    approx(geo.lower_R.points[1], lowerRVia);
    approx(geo.lower_R.points[2], BR);
    approx(geo.base.points[0], BR);
    approx(geo.base.points[1], BL);
    approx(geo.lower_L.points[0], BL);
    approx(geo.lower_L.points[2], waistL);
    approx(geo.upper_L.points[0], waistL);
    approx(geo.upper_L.points[1], topL);
    approx(geo.arch.points[0], topL);
    approx(geo.arch.points[1], apex);
    approx(geo.arch.points[2], topR);
  });
});

describe('Template 16: the handles', () => {
  const drag = (key, seeds, dx, dy) => {
    const rec = rec16(seeds);
    const prof = frameCutProfile(FRAME_DEFS, rec, board(7, 9));
    const hs = frameHandles(T16, prof);
    const h = hs.find((q) => q.key === key);
    const pt = { x: h.anchor.x + dx, y: h.anchor.y + dy };
    return { h, hs, prof, rec, next: normalizeFrameRecord({ ...rec, ...handleDragPatch(rec, h, pt, prof.region) }) };
  };

  it('the table is exactly the approved 5, all seeded, with a generateRange narrower than the drag range', () => {
    expect(T16.handles).toEqual([
      { key: 'topWidth', label: 'Top width', basis: 'hw', binding: 'seeded', generateRange: { min: 0.58, max: 0.86 } },
      { key: 'archRiseFrac', label: 'Arch rise', basis: 'hw', binding: 'seeded', generateRange: { min: 0.205, max: 0.565 } },
      { key: 'waistWidthFrac', label: 'Waist width', basis: 'hw', binding: 'seeded', generateRange: { min: 0.355, max: 0.405 } },
      { key: 'waistHeightFrac', label: 'Waist height', basis: 'h', binding: 'seeded', generateRange: { min: 0.375, max: 0.66 } },
      { key: 'bulgeFrac', label: 'Lower bulge', basis: 'hw', binding: 'seeded', generateRange: { min: 0.089, max: 0.174 } },
    ]);
    expect(T16.handleMigrations).toEqual({});
    const { hs } = drag('topWidth', {}, 0, 0);
    expect(hs.map((h) => h.key).sort()).toEqual([...T16.handles.map((h) => h.key)].sort());
    expect(HANDLE_SEGMENT_INDEX.archedFunnel).toEqual(
      { topWidth: 5, archRiseFrac: 5, waistWidthFrac: 1, waistHeightFrac: 1, bulgeFrac: 1 });
    // confirms the generic mirror formula (not a declared SEGMENT_PAIRS table): base(2)/arch(5) self-map.
    expect(controlledSegments('archedFunnel', 'topWidth', 6)).toEqual([5]);
    expect(controlledSegments('archedFunnel', 'waistWidthFrac', 6)).toEqual([1, 3]);
  });

  it('each handle round-trips: valueFromWorld at its own anchor returns its own resolved value', () => {
    const prof = profile({});
    const hs = frameHandles(T16, prof);
    for (const h of hs) expect(h.valueFromWorld(h.anchor), h.key).toBeCloseTo(h.value, 6);
  });

  it('dragged far, each handle stops at its own drag range and the frame stays valid (outline, inner edge, 6 miters, no thin tips)', () => {
    for (const [key, dx, dy] of [['topWidth', 20, 0], ['topWidth', -20, 0],
      ['archRiseFrac', 0, 20], ['archRiseFrac', 0, -20],
      ['waistWidthFrac', 20, 0], ['waistWidthFrac', -20, 0],
      ['waistHeightFrac', 0, 20], ['waistHeightFrac', 0, -20],
      ['bulgeFrac', 20, 0], ['bulgeFrac', -20, 0]]) {
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
      for (const h of T16.handles) {
        for (const v of [h.generateRange.min, h.generateRange.max]) {
          const rec = rec16({ [h.key]: v });
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

describe('Template 16 does not disturb anything else', () => {
  it('its 5 keys are all brand new and listed in FRAME_ONLY_PARAM_KEYS', () => {
    for (const k of KEYS) expect(FRAME_ONLY_PARAM_KEYS).toContain(k);
  });

  it('paramsFromShapeModel round-trips the provisional model exactly (every feature a plain hw/hh fraction)', () => {
    const region = profile({}).region;
    const out = paramsFromShapeModel('archedFunnel', T16.shapeModel, region);
    expect(out.topWidth).toBeCloseTo(0.75, 9);
    expect(out.archRiseFrac).toBeCloseTo(0.39, 9);
    expect(out.waistWidthFrac).toBeCloseTo(0.38, 9);
    expect(out.waistHeightFrac).toBeCloseTo(0.55, 9);
    expect(out.bulgeFrac).toBeCloseTo(0.169, 9);
  });

  it('archedFunnelConstruction degenerates correctly: upperCurveFrac absent gives straight sides (no arc at all)', () => {
    const g = archedFunnelConstruction({ w: 6.5, h: 8.5 }, {});
    expect(g.upperRadius).toBeNull();
  });

  it('frameParamRanges does not crash and returns the full drag-feasible range for every handle', () => {
    const region = profile({}).region;
    const R = frameParamRanges(T16, region, { topWidth: 0.75, archRiseFrac: 0.39, waistWidthFrac: 0.38, waistHeightFrac: 0.55, bulgeFrac: 0.169 });
    for (const k of KEYS) { expect(R[k].min).toBeLessThan(R[k].max); }
  });

  it('Templates 1-13/17 are unaffected: none of them declare template_16\'s own preset or outline', () => {
    for (const id of ['template_1', 'template_2', 'template_3', 'template_4', 'template_5', 'template_6',
      'template_7', 'template_8', 'template_9', 'template_10', 'template_11', 'template_12', 'template_13', 'template_17']) {
      const t = tplOf(id);
      expect(t.silhouettePreset, id).not.toBe('archedFunnel');
    }
  });

  it('PARAM_ORDER.archedFunnel matches the declared handle order exactly', () => {
    expect(PARAM_ORDER.archedFunnel).toEqual(KEYS);
  });
});

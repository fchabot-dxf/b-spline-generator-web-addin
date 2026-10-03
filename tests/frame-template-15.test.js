/**
 * T15 FLASK (F31 item 2b, dispatch 2026-10-03, Fred approved the diagram as drawn,
 * tools/repro/f31_item2_flask_diagram.mjs): a straight neck (two vertical sides) meeting a dome
 * that bulges OUTWARD and down to the flat base, a flat top closing the neck -- every joint a
 * MITER (fb_engine/t15_flask_geometry.py's own module docstring), same structural class as
 * T14/T16/T17. The frame-only `flask` preset (editor-shape-lattice-generator.js `_solveFlask`/
 * `flaskConstruction`), its 3 handles, and the guards that keep every other template and the
 * Shape Lattice exactly as they were.
 *
 * UNVERIFIED LIVE (pending the item-61 matrix sweep): these tests prove the JS-side geometry is
 * internally consistent (closed, within the board, every bar long enough at the default, no defect
 * at every handle's own declared extreme) AND numerically matches
 * fb_engine.t15_flask_geometry.outline()'s own independently-tested closed form EXACTLY (not
 * approximately) -- they cannot prove the Fusion sketch build itself solves cleanly (that is the
 * live item-61 matrix sweep).
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile, frameInnerProfile, frameMiters, miterStaysInsideWood } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { frameHandles, handleDragPatch, frameSeedGeometry, frameParamRanges } from '../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';
import { PARAM_ORDER, FRAME_ONLY_PARAM_KEYS, paramsFromShapeModel, flaskConstruction } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import { HANDLE_SEGMENT_INDEX, controlledSegments } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-interaction.js';
import { frameLabel } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';
import { sampleOutline } from '../bspline-frame-builder/b-spline-gen/html/core/preview/frame-mesh.js';

const tplOf = (id) => FRAME_DEFS.templates.find((t) => t.id === id);
const T15 = tplOf('template_15');
// Portrait boards (project_portrait_only: Fred currently builds portrait boards only).
const PORTRAIT_BOARDS = [[6, 9], [7, 9], [9, 12]];
const KEYS = ['topWidth', 'neckHeightFrac', 'domeFullnessFrac'];
const T = 0.75; // the default frame thickness
const board = (W, H) => ({ widthIn: W, heightIn: H });
const rec15 = (seeds) => normalizeFrameRecord({ templateId: 'template_15', seeds });
const profile = (seeds, W = 7, H = 9) => frameCutProfile(FRAME_DEFS, rec15(seeds), board(W, H));
const inner = (seeds, W = 7, H = 9) => frameInnerProfile(FRAME_DEFS, rec15(seeds), board(W, H));
const primLength = (p) => (p.type === 'L' ? Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y) : p.rx * Math.abs(p.dTheta));
const J = (x) => JSON.stringify(x);

describe('Template 15: listing and declaration', () => {
  it('is listed as "15. Flask", the frame-only flask preset, 6 bars, no new Fusion parameter', () => {
    expect(T15.name).toBe('Template 15 - Flask');
    expect(frameLabel(T15)).toBe('15. Flask');
    expect(T15.silhouettePreset).toBe('flask');
    const T15_GEOMETRY_PARAMS = ['t15_hw', 't15_hh', 't15_nw', 't15_neckBottomY', 't15_bulge',
      't15_dr_dx', 't15_dr_dy', 't15_dr_chordlen', 't15_dr_nx', 't15_dr_ny', 't15_dr_halfchord', 't15_dr_r',
      't15_dr_cx', 't15_dr_cy', 't15_dr_u0x', 't15_dr_u0y', 't15_dr_u1x', 't15_dr_u1y', 't15_dr_bx', 't15_dr_by', 't15_dr_blen', 't15_dr_vx', 't15_dr_vy'];
    expect(T15.params.map((p) => p.name)).toEqual(['widthIn', 'heightIn', 'boundingboxoffset', ...T15_GEOMETRY_PARAMS, 'frame_thickness']);
    expect(T15.regions.outline).toEqual(['proj_neck_R', 'proj_dome_R', 'proj_base', 'proj_dome_L', 'proj_neck_L', 'proj_top']);
    expect(T15.regions.miters).toHaveLength(6);
    expect(T15.regions.bars.map((b) => b.name)).toEqual(T15.features[0].bodyNames);
    expect(T15.regions.bars.map((b) => b.name)).toEqual(
      ['frame_neck_right', 'frame_dome_right', 'frame_base', 'frame_dome_left', 'frame_neck_left', 'frame_top']);
    expect(T15.handles.map((h) => h.key)).toEqual(KEYS);
    for (const h of T15.handles) expect(h.binding).toBe('seeded'); // never a Fusion user parameter
  });

  it.each(PORTRAIT_BOARDS)('%dx%d: a clean 6-piece frame, L-A-L-A-L-L, no defects', (W, H) => {
    const prof = profile({}, W, H);
    expect(prof.primitives.length, J({ W, H })).toBe(6);
    expect(prof.defects, J({ W, H })).toEqual([]);
    const inn = inner({}, W, H);
    if (inn) expect(inn.defects, J({ W, H })).toEqual([]);
    // 0 neck_R(L), 1 dome_R(A), 2 base(L), 3 dome_L(A), 4 neck_L(L), 5 top(L) --
    // editor-shape-lattice-generator.js's own _solveFlask doc comment.
    expect(prof.primitives.map((p) => p.type), J({ W, H })).toEqual(['L', 'A', 'L', 'A', 'L', 'L']);
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

  it('the outline is symmetric about the centreline: topL/topR, neckBottomL/R, BL/BR mirror exactly', () => {
    const prof = profile({});
    const cx0 = prof.region.x + prof.region.w / 2;
    const [neckR, domeR, base] = prof.primitives;
    // neckR: topR -> neckBottomR; domeR: neckBottomR -> BR; base: BR -> BL; top: topL -> topR.
    const topR = primPt(neckR, false);
    const neckBottomR = primPt(neckR, true);
    const BR = primPt(domeR, true), BL = primPt(base, true);
    const top = prof.primitives[5], topL = primPt(top, false);
    const neckBottomL = primPt(prof.primitives[3], true); // dome_L: BL -> neckBottomL
    expect(topR.x - cx0).toBeCloseTo(-(topL.x - cx0), 9);
    expect(topR.y).toBeCloseTo(topL.y, 9);
    expect(neckBottomR.x - cx0).toBeCloseTo(-(neckBottomL.x - cx0), 9);
    expect(neckBottomR.y).toBeCloseTo(neckBottomL.y, 9);
    expect(BR.x - cx0).toBeCloseTo(-(BL.x - cx0), 9);
    expect(BR.y).toBeCloseTo(BL.y, 9);
  });

  // 0..W / 0..H (the true board edges), not the safe zone: a convex arc's own bulge can swing
  // slightly past its two chord ends' own x/y, same reasoning Template 14/16's own equivalent test uses.
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

  // Checks every handle's own frameParamRanges extreme (the full drag-feasible bound, not just
  // generateRange) against the true board edges, at every portrait board -- the cheapest layer
  // that can catch a board-edge overshoot before a live Fusion sweep has to (T14's own item-61
  // pinchReachFrac defect is the field precedent this test class exists to catch early).
  it('every handle at its own full DRAG-range extreme keeps the outline within the true board edges', () => {
    for (const [W, H] of PORTRAIT_BOARDS) {
      const region = profile({}, W, H).region;
      const R = frameParamRanges(T15, region, { topWidth: 0.45, neckHeightFrac: 0.45, domeFullnessFrac: 0.1421885365451818 });
      for (const key of KEYS) {
        for (const v of [R[key].min, R[key].max]) {
          const prof = profile({ [key]: v }, W, H);
          const poly = sampleOutline(prof.primitives, 96);
          const tag = `${W}x${H} ${key}=${v}`;
          for (const p of poly) {
            expect(p.x, `${tag} x=${p.x}`).toBeGreaterThanOrEqual(0 - 1e-6);
            expect(p.x, `${tag} x=${p.x}`).toBeLessThanOrEqual(W + 1e-6);
            expect(p.y, `${tag} y=${p.y}`).toBeGreaterThanOrEqual(0 - 1e-6);
            expect(p.y, `${tag} y=${p.y}`).toBeLessThanOrEqual(H + 1e-6);
          }
        }
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

  // F31 item 2b: the seed geometry must match fb_engine.t15_flask_geometry.outline()'s own
  // independently-tested closed form EXACTLY -- this is the one check that most directly bears on
  // whether the live Fusion build will land on the SAME points the Python/Fusion side already
  // proved correct (fb_engine/test_t15_fusion_expressions.py), not just "a reasonable-looking shape".
  // Board-local, Fusion y-up inches, BBO=0.25 -> HW=3.25, HH=4.25 (7x9): computed directly from
  // fb_engine/t15_flask_geometry.py's own outline(6.5, 8.5, 0.75), not re-derived here.
  it('the Fusion seeds match fb_engine.t15_flask_geometry.outline()\'s own closed-form values exactly, at 7x9', () => {
    const prof = profile({}, 7, 9);
    const geo = frameSeedGeometry(T15, prof, 7, 9);
    expect(Object.keys(geo).sort()).toEqual(T15.seedMap.map((e) => e.id).sort());
    const approx = (pt, [x, y]) => { expect(pt[0]).toBeCloseTo(x, 6); expect(pt[1]).toBeCloseTo(y, 6); };
    const topR = [1.4625, 4.25], topL = [-1.4625, 4.25];
    const neckBottomR = [1.4625, 0.425], neckBottomL = [-1.4625, 0.425];
    const BR = [3.25, -4.25], BL = [-3.25, -4.25];
    const domeRVia = [2.7878872562281574, -1.7474622255598224];
    approx(geo.neck_R.points[0], topR);
    approx(geo.neck_R.points[1], neckBottomR);
    approx(geo.dome_R.points[0], neckBottomR);
    approx(geo.dome_R.points[1], domeRVia);
    approx(geo.dome_R.points[2], BR);
    approx(geo.base.points[0], BR);
    approx(geo.base.points[1], BL);
    approx(geo.dome_L.points[0], BL);
    approx(geo.dome_L.points[2], neckBottomL);
    approx(geo.neck_L.points[0], neckBottomL);
    approx(geo.neck_L.points[1], topL);
    approx(geo.top.points[0], topL);
    approx(geo.top.points[1], topR);
  });
});

describe('Template 15: the handles', () => {
  const drag = (key, seeds, dx, dy) => {
    const rec = rec15(seeds);
    const prof = frameCutProfile(FRAME_DEFS, rec, board(7, 9));
    const hs = frameHandles(T15, prof);
    const h = hs.find((q) => q.key === key);
    const pt = { x: h.anchor.x + dx, y: h.anchor.y + dy };
    return { h, hs, prof, rec, next: normalizeFrameRecord({ ...rec, ...handleDragPatch(rec, h, pt, prof.region) }) };
  };

  it('the table is exactly the approved 3, all seeded, with a generateRange no wider than the drag range', () => {
    expect(T15.handles).toEqual([
      { key: 'topWidth', label: 'Top width', basis: 'hw', binding: 'seeded', generateRange: { min: 0.365, max: 0.48 } },
      { key: 'neckHeightFrac', label: 'Neck height', basis: 'h', binding: 'seeded', generateRange: { min: 0.27, max: 0.62 } },
      { key: 'domeFullnessFrac', label: 'Dome fullness', basis: 'hw', binding: 'seeded', generateRange: { min: 0.082, max: 0.151 } },
    ]);
    expect(T15.handleMigrations).toEqual({});
    const { hs } = drag('topWidth', {}, 0, 0);
    expect(hs.map((h) => h.key).sort()).toEqual([...T15.handles.map((h) => h.key)].sort());
    expect(HANDLE_SEGMENT_INDEX.flask).toEqual(
      { topWidth: 5, neckHeightFrac: 1, domeFullnessFrac: 1 });
    // confirms the generic mirror formula (not a declared SEGMENT_PAIRS table): base(2)/top(5) self-map.
    expect(controlledSegments('flask', 'topWidth', 6)).toEqual([5]);
    expect(controlledSegments('flask', 'neckHeightFrac', 6)).toEqual([1, 3]);
  });

  it('each handle round-trips: valueFromWorld at its own anchor returns its own resolved value', () => {
    const prof = profile({});
    const hs = frameHandles(T15, prof);
    for (const h of hs) expect(h.valueFromWorld(h.anchor), h.key).toBeCloseTo(h.value, 6);
  });

  it('dragged far, each handle stops at its own drag range and the frame stays valid (outline, inner edge, 6 miters, no thin tips)', () => {
    for (const [key, dx, dy] of [['topWidth', 20, 0], ['topWidth', -20, 0],
      ['neckHeightFrac', 0, 20], ['neckHeightFrac', 0, -20],
      ['domeFullnessFrac', 20, 0], ['domeFullnessFrac', -20, 0]]) {
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
      for (const h of T15.handles) {
        for (const v of [h.generateRange.min, h.generateRange.max]) {
          const rec = rec15({ [h.key]: v });
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

describe('Template 15 does not disturb anything else', () => {
  it('its new keys are listed in FRAME_ONLY_PARAM_KEYS (topWidth already was, shared with T14/T16/T17)', () => {
    for (const k of KEYS) expect(FRAME_ONLY_PARAM_KEYS).toContain(k);
  });

  it('paramsFromShapeModel round-trips the provisional model exactly (every feature a plain hw/hh fraction)', () => {
    const region = profile({}).region;
    const out = paramsFromShapeModel('flask', T15.shapeModel, region);
    expect(out.topWidth).toBeCloseTo(0.45, 9);
    expect(out.neckHeightFrac).toBeCloseTo(0.45, 9);
    expect(out.domeFullnessFrac).toBeCloseTo(0.1421885365451818, 9);
  });

  it('flaskConstruction is internally consistent: a positive dome radius, mirrored topR/neckBottomR L/R', () => {
    const g = flaskConstruction({ w: 6.5, h: 8.5 }, {});
    expect(g.domeRadius).toBeGreaterThan(0);
    expect(g.topR.x).toBeCloseTo(-g.topL.x, 9);
    expect(g.neckBottomR.x).toBeCloseTo(-g.neckBottomL.x, 9);
  });

  it('frameParamRanges does not crash and returns the full drag-feasible range for every handle', () => {
    const region = profile({}).region;
    const R = frameParamRanges(T15, region, { topWidth: 0.45, neckHeightFrac: 0.45, domeFullnessFrac: 0.1421885365451818 });
    for (const k of KEYS) { expect(R[k].min).toBeLessThan(R[k].max); }
  });

  it('Templates 1-14/16/17 are unaffected: none of them declare template_15\'s own preset or outline', () => {
    for (const id of ['template_1', 'template_2', 'template_3', 'template_4', 'template_5', 'template_6',
      'template_7', 'template_8', 'template_9', 'template_10', 'template_11', 'template_12', 'template_13',
      'template_14', 'template_16', 'template_17']) {
      const t = tplOf(id);
      expect(t.silhouettePreset, id).not.toBe('flask');
    }
  });

  it('PARAM_ORDER.flask matches the declared handle order exactly', () => {
    expect(PARAM_ORDER.flask).toEqual(KEYS);
  });
});

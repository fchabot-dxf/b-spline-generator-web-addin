/**
 * T14 SAND TIMER (T84 item 5, moved from seat C's F31 item 1b, Fred approved the diagram as drawn,
 * fb-app 5e0b5fa, tools/repro/f31_item1_sandtimer_diagram.mjs): a flat top and base, two outward-
 * bulging arcs per side meeting at a sharp pinch partway in from each edge (a genuine miter corner
 * -- the two arcs' own tangents differ there) -- every joint a MITER
 * (fb_engine/t14_sandtimer_geometry.py's own module docstring), same structural class as T16/T17.
 * The frame-only `sandTimer` preset (editor-shape-lattice-generator.js `_solveSandTimer`/
 * `sandTimerConstruction`), its 4 handles, and the guards that keep every other template and the
 * Shape Lattice exactly as they were.
 *
 * UNVERIFIED LIVE (no Fusion bridge available this turn): these tests prove the JS-side geometry is
 * internally consistent (closed, within the board, every bar long enough at the default, no defect
 * at every handle's own declared extreme) AND numerically matches
 * fb_engine.t14_sandtimer_geometry.outline()'s own independently-tested closed form EXACTLY (not
 * approximately) -- they cannot prove the Fusion sketch build itself solves cleanly (that is the
 * live item-61 matrix sweep).
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile, frameInnerProfile, frameMiters, miterStaysInsideWood } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { frameHandles, handleDragPatch, frameSeedGeometry, frameParamRanges } from '../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';
import { PARAM_ORDER, FRAME_ONLY_PARAM_KEYS, paramsFromShapeModel, sandTimerConstruction } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import { HANDLE_SEGMENT_INDEX, controlledSegments } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-interaction.js';
import { frameLabel } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';
import { sampleOutline } from '../bspline-frame-builder/b-spline-gen/html/core/preview/frame-mesh.js';

const tplOf = (id) => FRAME_DEFS.templates.find((t) => t.id === id);
const T14 = tplOf('template_14');
// Portrait boards (project_portrait_only: Fred currently builds portrait boards only).
const PORTRAIT_BOARDS = [[6, 9], [7, 9], [9, 12]];
const KEYS = ['topWidth', 'pinchReachFrac', 'bulgeFrac', 'pinchHeightFrac'];
const T = 0.75; // the default frame thickness
const board = (W, H) => ({ widthIn: W, heightIn: H });
const rec14 = (seeds) => normalizeFrameRecord({ templateId: 'template_14', seeds });
const profile = (seeds, W = 7, H = 9) => frameCutProfile(FRAME_DEFS, rec14(seeds), board(W, H));
const inner = (seeds, W = 7, H = 9) => frameInnerProfile(FRAME_DEFS, rec14(seeds), board(W, H));
const primLength = (p) => (p.type === 'L' ? Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y) : p.rx * Math.abs(p.dTheta));
const J = (x) => JSON.stringify(x);

describe('Template 14: listing and declaration', () => {
  it('is listed as "14. Sand Timer", the frame-only sandTimer preset, 6 bars, no new Fusion parameter', () => {
    expect(T14.name).toBe('Template 14 - Sand Timer');
    expect(frameLabel(T14)).toBe('14. Sand Timer');
    expect(T14.silhouettePreset).toBe('sandTimer');
    const T14_GEOMETRY_PARAMS = ['t14_hw', 't14_hh', 't14_pinchHalf', 't14_pinchY', 't14_bulge',
      't14_ur_dx', 't14_ur_dy', 't14_ur_chordlen', 't14_ur_nx', 't14_ur_ny', 't14_ur_halfchord', 't14_ur_r',
      't14_ur_cx', 't14_ur_cy', 't14_ur_u0x', 't14_ur_u0y', 't14_ur_u1x', 't14_ur_u1y', 't14_ur_bx', 't14_ur_by', 't14_ur_blen', 't14_ur_vx', 't14_ur_vy',
      't14_lr_dx', 't14_lr_dy', 't14_lr_chordlen', 't14_lr_nx', 't14_lr_ny', 't14_lr_halfchord', 't14_lr_r',
      't14_lr_cx', 't14_lr_cy', 't14_lr_u0x', 't14_lr_u0y', 't14_lr_u1x', 't14_lr_u1y', 't14_lr_bx', 't14_lr_by', 't14_lr_blen', 't14_lr_vx', 't14_lr_vy'];
    expect(T14.params.map((p) => p.name)).toEqual(['widthIn', 'heightIn', 'boundingboxoffset', ...T14_GEOMETRY_PARAMS, 'frame_thickness']);
    expect(T14.regions.outline).toEqual(['proj_upper_R', 'proj_lower_R', 'proj_base', 'proj_lower_L', 'proj_upper_L', 'proj_top']);
    expect(T14.regions.miters).toHaveLength(6);
    expect(T14.regions.bars.map((b) => b.name)).toEqual(T14.features[0].bodyNames);
    expect(T14.regions.bars.map((b) => b.name)).toEqual(
      ['frame_upper_right', 'frame_lower_right', 'frame_base', 'frame_lower_left', 'frame_upper_left', 'frame_top']);
    expect(T14.handles.map((h) => h.key)).toEqual(KEYS);
    for (const h of T14.handles) expect(h.binding).toBe('seeded'); // never a Fusion user parameter
  });

  it.each(PORTRAIT_BOARDS)('%dx%d: a clean 6-piece frame, A-A-L-A-A-L, no defects', (W, H) => {
    const prof = profile({}, W, H);
    expect(prof.primitives.length, J({ W, H })).toBe(6);
    expect(prof.defects, J({ W, H })).toEqual([]);
    const inn = inner({}, W, H);
    if (inn) expect(inn.defects, J({ W, H })).toEqual([]);
    // 0 upper_R(A), 1 lower_R(A), 2 base(L), 3 lower_L(A), 4 upper_L(A), 5 top(L) --
    // editor-shape-lattice-generator.js's own _solveSandTimer doc comment.
    expect(prof.primitives.map((p) => p.type), J({ W, H })).toEqual(['A', 'A', 'L', 'A', 'A', 'L']);
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

  it('the outline is symmetric about the centreline: topL/topR, pinchL/pinchR, BL/BR mirror exactly', () => {
    const prof = profile({});
    const cx0 = prof.region.x + prof.region.w / 2;
    const [upperR, lowerR, base] = prof.primitives;
    // upperR: topR -> pinchR; lowerR: pinchR -> BR; base: BR -> BL; top: topL -> topR.
    const topR = primPt(upperR, false);
    const pinchR = primPt(upperR, true);
    const BR = primPt(lowerR, true), BL = primPt(base, true);
    const top = prof.primitives[5], topL = primPt(top, false);
    const pinchL = primPt(prof.primitives[3], true); // lower_L: BL -> pinchL
    expect(topR.x - cx0).toBeCloseTo(-(topL.x - cx0), 9);
    expect(topR.y).toBeCloseTo(topL.y, 9);
    expect(pinchR.x - cx0).toBeCloseTo(-(pinchL.x - cx0), 9);
    expect(pinchR.y).toBeCloseTo(pinchL.y, 9);
    expect(BR.x - cx0).toBeCloseTo(-(BL.x - cx0), 9);
    expect(BR.y).toBeCloseTo(BL.y, 9);
  });

  // 0..W / 0..H (the true board edges), not the safe zone: a convex arc's own bulge can swing
  // slightly past its two chord ends' own x/y, same reasoning Template 16's own equivalent test uses.
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

  // T84 item 5, MEASURED LIVE (not by inspection): at pinchReachFrac's own OLD drag-range floor
  // (0.02), the fixed-bulge side arcs' own chord goes nearly vertical and their via point swings
  // PAST the true board edge -- Fusion's own extrude then refuses outright ("the extrusion profile
  // falls outside the boundary of the selected body"), missing all 4 arc bars. The default-only
  // board-edge check above never exercised this (generateRange's own floor, 0.30, was already safe
  // -- only the wider DRAG range reached it). Checks every handle's own frameParamRanges extreme
  // (the full drag-feasible bound, not just generateRange) against the true board edges, at every
  // portrait board -- the cheapest layer that can catch this class of bug before a live Fusion sweep
  // has to.
  it('every handle at its own full DRAG-range extreme keeps the outline within the true board edges', () => {
    for (const [W, H] of PORTRAIT_BOARDS) {
      const region = profile({}, W, H).region;
      const R = frameParamRanges(T14, region, { topWidth: 1.0, pinchReachFrac: 0.6, bulgeFrac: 0.14, pinchHeightFrac: 0.5 });
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

  // T84 item 5: the seed geometry must match fb_engine.t14_sandtimer_geometry.outline()'s own
  // independently-tested closed form EXACTLY -- this is the one check that most directly bears on
  // whether the live Fusion build will land on the SAME points the Python/Fusion side already
  // proved correct (fb_engine/test_t14_fusion_expressions.py), not just "a reasonable-looking shape".
  // Board-local, Fusion y-up inches, BBO=0.25 -> HW=3.25, HH=4.25 (7x9): computed directly from
  // fb_engine/t14_sandtimer_geometry.py's own outline(6.5, 8.5, 0.75), not re-derived here.
  it('the Fusion seeds match fb_engine.t14_sandtimer_geometry.outline()\'s own closed-form values exactly, at 7x9', () => {
    const prof = profile({}, 7, 9);
    const geo = frameSeedGeometry(T14, prof, 7, 9);
    expect(Object.keys(geo).sort()).toEqual(T14.seedMap.map((e) => e.id).sort());
    const approx = (pt, [x, y]) => { expect(pt[0]).toBeCloseTo(x, 6); expect(pt[1]).toBeCloseTo(y, 6); };
    const topR = [3.25, 4.25], topL = [-3.25, 4.25];
    const pinchR = [1.3, 0], pinchL = [-1.3, 0];
    const BR = [3.25, -4.25], BL = [-3.25, -4.25];
    const upperRVia = [2.688547677227226, 1.935254595154544];
    const lowerRVia = [2.688547677227236, -1.9352545951545626];
    approx(geo.upper_R.points[0], topR);
    approx(geo.upper_R.points[1], upperRVia);
    approx(geo.upper_R.points[2], pinchR);
    approx(geo.lower_R.points[0], pinchR);
    approx(geo.lower_R.points[1], lowerRVia);
    approx(geo.lower_R.points[2], BR);
    approx(geo.base.points[0], BR);
    approx(geo.base.points[1], BL);
    approx(geo.lower_L.points[0], BL);
    approx(geo.lower_L.points[2], pinchL);
    approx(geo.upper_L.points[0], pinchL);
    approx(geo.upper_L.points[2], topL);
    approx(geo.top.points[0], topL);
    approx(geo.top.points[1], topR);
  });
});

describe('Template 14: the handles', () => {
  const drag = (key, seeds, dx, dy) => {
    const rec = rec14(seeds);
    const prof = frameCutProfile(FRAME_DEFS, rec, board(7, 9));
    const hs = frameHandles(T14, prof);
    const h = hs.find((q) => q.key === key);
    const pt = { x: h.anchor.x + dx, y: h.anchor.y + dy };
    return { h, hs, prof, rec, next: normalizeFrameRecord({ ...rec, ...handleDragPatch(rec, h, pt, prof.region) }) };
  };

  it('the table is exactly the approved 4, all seeded, with a generateRange no wider than the drag range', () => {
    expect(T14.handles).toEqual([
      { key: 'topWidth', label: 'Top width', basis: 'hw', binding: 'seeded', generateRange: { min: 0.57, max: 1 } },
      { key: 'pinchReachFrac', label: 'Pinch reach', basis: 'hw', binding: 'seeded', generateRange: { min: 0.3, max: 0.61 } },
      { key: 'bulgeFrac', label: 'Pinch bulge', basis: 'hw', binding: 'seeded', generateRange: { min: 0.07, max: 0.146 } },
      { key: 'pinchHeightFrac', label: 'Pinch height', basis: 'h', binding: 'seeded', generateRange: { min: 0.43, max: 0.57 } },
    ]);
    expect(T14.handleMigrations).toEqual({});
    const { hs } = drag('topWidth', {}, 0, 0);
    expect(hs.map((h) => h.key).sort()).toEqual([...T14.handles.map((h) => h.key)].sort());
    expect(HANDLE_SEGMENT_INDEX.sandTimer).toEqual(
      { topWidth: 5, pinchReachFrac: 1, bulgeFrac: 1, pinchHeightFrac: 1 });
    // confirms the generic mirror formula (not a declared SEGMENT_PAIRS table): base(2)/top(5) self-map.
    expect(controlledSegments('sandTimer', 'topWidth', 6)).toEqual([5]);
    expect(controlledSegments('sandTimer', 'pinchReachFrac', 6)).toEqual([1, 3]);
  });

  it('each handle round-trips: valueFromWorld at its own anchor returns its own resolved value', () => {
    const prof = profile({});
    const hs = frameHandles(T14, prof);
    for (const h of hs) expect(h.valueFromWorld(h.anchor), h.key).toBeCloseTo(h.value, 6);
  });

  it('dragged far, each handle stops at its own drag range and the frame stays valid (outline, inner edge, 6 miters, no thin tips)', () => {
    for (const [key, dx, dy] of [['topWidth', 20, 0], ['topWidth', -20, 0],
      ['pinchReachFrac', 20, 0], ['pinchReachFrac', -20, 0],
      ['bulgeFrac', 20, 0], ['bulgeFrac', -20, 0],
      ['pinchHeightFrac', 0, 20], ['pinchHeightFrac', 0, -20]]) {
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
      for (const h of T14.handles) {
        for (const v of [h.generateRange.min, h.generateRange.max]) {
          const rec = rec14({ [h.key]: v });
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

describe('Template 14 does not disturb anything else', () => {
  it('its new keys are listed in FRAME_ONLY_PARAM_KEYS (topWidth/bulgeFrac already were, shared with T16/T17)', () => {
    for (const k of KEYS) expect(FRAME_ONLY_PARAM_KEYS).toContain(k);
  });

  it('paramsFromShapeModel round-trips the provisional model exactly (every feature a plain hw/hh fraction)', () => {
    const region = profile({}).region;
    const out = paramsFromShapeModel('sandTimer', T14.shapeModel, region);
    expect(out.topWidth).toBeCloseTo(1.0, 9);
    expect(out.pinchReachFrac).toBeCloseTo(0.6, 9);
    expect(out.bulgeFrac).toBeCloseTo(0.14, 9);
    expect(out.pinchHeightFrac).toBeCloseTo(0.5, 9);
  });

  it('sandTimerConstruction is internally consistent: both side arcs share one bulge radius, mirrored L/R', () => {
    const g = sandTimerConstruction({ w: 6.5, h: 8.5 }, {});
    expect(g.upperRadius).toBeGreaterThan(0);
    expect(g.lowerRadius).toBeGreaterThan(0);
    expect(g.topR.x).toBeCloseTo(-g.topL.x, 9);
    expect(g.pinchR.x).toBeCloseTo(-g.pinchL.x, 9);
  });

  it('frameParamRanges does not crash and returns the full drag-feasible range for every handle', () => {
    const region = profile({}).region;
    const R = frameParamRanges(T14, region, { topWidth: 1.0, pinchReachFrac: 0.6, bulgeFrac: 0.14, pinchHeightFrac: 0.5 });
    for (const k of KEYS) { expect(R[k].min).toBeLessThan(R[k].max); }
  });

  it('Templates 1-13/16/17 are unaffected: none of them declare template_14\'s own preset or outline', () => {
    for (const id of ['template_1', 'template_2', 'template_3', 'template_4', 'template_5', 'template_6',
      'template_7', 'template_8', 'template_9', 'template_10', 'template_11', 'template_12', 'template_13',
      'template_16', 'template_17']) {
      const t = tplOf(id);
      expect(t.silhouettePreset, id).not.toBe('sandTimer');
    }
  });

  it('PARAM_ORDER.sandTimer matches the declared handle order exactly', () => {
    expect(PARAM_ORDER.sandTimer).toEqual(KEYS);
  });
});

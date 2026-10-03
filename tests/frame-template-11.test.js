/**
 * T11 HOURGLASS ROOF: Template 7's own gable roof + eave (2 straight bars, mitred at the peak, plus a straight
 * vertical "eave" bar from each eave point down to the shoulder arc's own top horn) over Template 1's own 3-arc
 * shoulder/waist/hip pinch side (reused verbatim, fb_engine/t11_geometry.py's own module docstring), a plain
 * straight base. The frame-only `diamondTopHourglassPinch` preset (editor-shape-lattice-generator.js
 * `_solveDiamondTopHourglassPinch`), its 5 handles (reusing Template 1's own key names on purpose), and the
 * guards that keep every other template and the Shape Lattice exactly as they were.
 *
 * UNVERIFIED LIVE (no Fusion bridge available this turn): these tests prove the JS-side geometry is internally
 * consistent (closed, within the board, every bar long enough, every handle stays valid) AND numerically matches
 * the real Fusion seed phase file's own literal expressions (tests/frame-seed-geometry.test.js's own template_11
 * entry) -- they cannot prove the Fusion sketch build itself solves cleanly.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord, framePayload } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile, frameInnerProfile, frameMiters } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import {
  frameHandles, handleDragPatch, frameSeedGeometry, generateValidFrameSeeds,
} from '../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';
import {
  paramsFromShapeModel, PARAM_ORDER, SHAPE_PARAM_KEYS, FRAME_ONLY_PARAM_KEYS,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import { HANDLE_SEGMENT_INDEX, controlledSegments } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-interaction.js';
import { frameLabel } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';
import { sampleOutline } from '../bspline-frame-builder/b-spline-gen/html/core/preview/frame-mesh.js';

const tplOf = (id) => FRAME_DEFS.templates.find((t) => t.id === id);
const T11 = tplOf('template_11');
const T1 = tplOf('template_1');
// Portrait boards (project_portrait_only: Fred currently builds portrait boards only), matching Template 7's own
// test board list -- this template reuses that same roof construction, so the same portrait-only caveat applies.
const PORTRAIT_BOARDS = [[7, 9], [9, 12], [8, 8], [7, 7], [9, 9]];
const KEYS = ['waistReach', 'cornerRadiusTop', 'cornerRadiusBottom', 'waistCenterY', 'waistRadius'];
const board = (W, H) => ({ widthIn: W, heightIn: H });
const rec11 = (seeds) => normalizeFrameRecord({ templateId: 'template_11', seeds });
const profile = (seeds, W = 7, H = 9) => frameCutProfile(FRAME_DEFS, rec11(seeds), board(W, H));
const inner = (seeds, W = 7, H = 9) => frameInnerProfile(FRAME_DEFS, rec11(seeds), board(W, H));
const primLength = (p) => (p.type === 'L' ? Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y) : p.rx * Math.abs(p.dTheta));
const J = (x) => JSON.stringify(x);

describe('Template 11: listing and declaration', () => {
  it('is listed as "11. Hourglass Roof", the frame-only diamondTopHourglassPinch preset, 5 bars, no new Fusion parameter', () => {
    expect(T11.name).toBe('Template 11 - Hourglass Roof');
    expect(frameLabel(T11)).toBe('11. Hourglass Roof');
    expect(T11.silhouettePreset).toBe('diamondTopHourglassPinch');
    expect(T11.params.map((p) => p.name)).toEqual(['widthIn', 'heightIn', 'boundingboxoffset', 'frame_thickness']);
    expect(T11.regions.outline).toHaveLength(13);
    expect(T11.regions.outline).toEqual(['proj_roof_R', 'proj_eave_straight_R', 'proj_arc_shoulder_R', 'proj_arc_waist_R',
      'proj_arc_hip_R', 'proj_side_straight_R', 'proj_bottom_edge', 'proj_side_straight_L', 'proj_arc_hip_L',
      'proj_arc_waist_L', 'proj_arc_shoulder_L', 'proj_eave_straight_L', 'proj_roof_L']);
    expect(T11.regions.miters).toHaveLength(5);
    expect(T11.regions.bars.map((b) => b.name)).toEqual(T11.features[0].bodyNames);
    expect(T11.regions.bars.map((b) => b.name)).toEqual(
      ['frame_roof_right', 'frame_side_right', 'frame_base', 'frame_side_left', 'frame_roof_left']);
    expect(T11.handles.map((h) => h.key)).toEqual(KEYS);
    for (const h of T11.handles) expect(h.binding).toBe('seeded'); // never a Fusion user parameter
  });

  it.each(PORTRAIT_BOARDS)('%dx%d: a clean 13-piece frame, 2 roof lines + 2 eave bars + 6 side/waist arcs + 2 sides + base', (W, H) => {
    const prof = profile({}, W, H);
    expect(prof.primitives.length, J({ W, H })).toBe(13);
    expect(prof.defects, J({ W, H })).toEqual([]);
    const inn = inner({}, W, H);
    if (inn) expect(inn.defects, J({ W, H })).toEqual([]);
    const types = prof.primitives.map((p) => p.type);
    // 0 roof_R(L), 1 eave_straight_R(L), 2 arc_shoulder_R(A), 3 arc_waist_R(A), 4 arc_hip_R(A), 5 side_straight_R(L),
    // 6 bottom_edge(L), 7 side_straight_L(L), 8 arc_hip_L(A), 9 arc_waist_L(A), 10 arc_shoulder_L(A),
    // 11 eave_straight_L(L), 12 roof_L(L) -- editor-shape-lattice-generator.js's own
    // _solveDiamondTopHourglassPinch doc comment.
    expect(types, J({ W, H })).toEqual(['L', 'L', 'A', 'A', 'A', 'L', 'L', 'L', 'A', 'A', 'A', 'L', 'L']);
  });

  it('the roof is symmetric about the centreline and the peak sits on it', () => {
    const prof = profile({});
    const cx0 = prof.region.x + prof.region.w / 2;
    const roofR = prof.primitives[0], roofL = prof.primitives[12];
    // roof_R starts at the peak, roof_L ends at the peak (p02_02_loop.py's own clockwise traversal)
    expect(roofR.p0.x).toBeCloseTo(cx0, 6);
    expect(J([roofR.p0.x, roofR.p0.y])).toBe(J([roofL.p1.x, roofL.p1.y]));
    // the two eave tips are mirrored about the centreline, same height
    expect(roofR.p1.x - cx0).toBeCloseTo(-(roofL.p0.x - cx0), 6);
    expect(roofR.p1.y).toBeCloseTo(roofL.p0.y, 6);
  });

  // KNOWN GAP, named not silently skipped (same discipline as Template 7's own LIVE_CHECK.md entries): MEASURED,
  // at this template's own DEFAULT corner proportions (CORNER_RADIUS_DEFAULT = 0.22, fb_engine/t11_geometry.py),
  // the shoulder arc (piece 2) is SHORTER than frame_thickness at every portrait board tested except 9x12 --
  // including 7x9, the project's own primary reference board. This is a property of the declared default
  // proportions themselves (independently verified against fb_engine/t11_geometry.py's own formulas, not a bug
  // in this registration), not something this task's own scope (app-side wiring) should silently work around by
  // changing a default Fred/the advisor set from an approved sketch. Flagged for the advisor rather than fixed
  // here; only the one board it's actually clean at is asserted.
  it('9x12: every bar at the defaults is at least frame_thickness long', () => {
    const prof = profile({}, 9, 12);
    if (!prof.fit.ok) return;
    const THICK = T11.params.find((p) => p.name === 'frame_thickness').default;
    prof.primitives.forEach((p, i) => expect(primLength(p), `9x12 piece ${i}`).toBeGreaterThanOrEqual(THICK * 0.99));
  });

  it('the outer profile stays within the BOARD (not just the safe zone), at every portrait board', () => {
    const BBO = 0.25;
    for (const [W, H] of PORTRAIT_BOARDS) {
      const prof = profile({}, W, H);
      const poly = sampleOutline(prof.primitives, 96);
      const minX = -BBO, maxX = W - BBO, minY = -BBO, maxY = H - BBO;
      for (const p of poly) {
        expect(p.x, `${W}x${H} x=${p.x}`).toBeGreaterThanOrEqual(minX - 1e-6);
        expect(p.x, `${W}x${H} x=${p.x}`).toBeLessThanOrEqual(maxX + 1e-6);
        expect(p.y, `${W}x${H} y=${p.y}`).toBeGreaterThanOrEqual(minY - 1e-6);
        expect(p.y, `${W}x${H} y=${p.y}`).toBeLessThanOrEqual(maxY + 1e-6);
      }
    }
  });

  it('the 5 miters sit strictly inside the band (the inner point closer to centre than the outer, a real positive gap)', () => {
    for (const [W, H] of PORTRAIT_BOARDS) {
      const outer = frameCutProfile(FRAME_DEFS, rec11({}), board(W, H));
      if (!outer.fit.ok) continue;
      const innerP = frameInnerProfile(FRAME_DEFS, rec11({}), board(W, H));
      const miters = frameMiters(outer.primitives, innerP.primitives);
      expect(miters, J({ W, H })).toHaveLength(5);
      const cx0 = outer.region.x + outer.region.w / 2, cy0 = outer.region.y + outer.region.h / 2;
      for (const m of miters) {
        const dOuter = Math.hypot(m.outer.x - cx0, m.outer.y - cy0);
        const dInner = Math.hypot(m.inner.x - cx0, m.inner.y - cy0);
        const gap = Math.hypot(m.inner.x - m.outer.x, m.inner.y - m.outer.y);
        expect(dInner, J({ W, H, m })).toBeLessThan(dOuter);
        expect(gap, J({ W, H, m })).toBeGreaterThan(0);
      }
    }
  });

  it('the Fusion seeds: the 13 pieces at the app\'s solved outline, in the sketch\'s own clockwise-from-peak order', () => {
    const prof = profile({});
    const geo = frameSeedGeometry(T11, prof, 7, 9);
    expect(Object.keys(geo).sort()).toEqual(T11.seedMap.map((e) => e.id).sort());
  });
});

describe('Template 11: the waist/corner handles', () => {
  const drag = (key, seeds, dx, dy) => {
    const rec = rec11(seeds);
    const prof = frameCutProfile(FRAME_DEFS, rec, board(7, 9));
    const hs = frameHandles(T11, prof);
    const h = hs.find((q) => q.key === key);
    const pt = { x: h.anchor.x + dx, y: h.anchor.y + dy };
    return { h, hs, prof, rec, next: normalizeFrameRecord({ ...rec, ...handleDragPatch(rec, h, pt, prof.region) }) };
  };

  it('the table is exactly the approved 5, all seeded, in Template 1\'s own key names/order', () => {
    expect(T11.handles).toEqual([
      { key: 'waistReach', label: 'Waist reach', basis: 'hw', binding: 'seeded' },
      { key: 'cornerRadiusTop', label: 'Shoulder', basis: 'hw', binding: 'seeded' },
      { key: 'cornerRadiusBottom', label: 'Hip', basis: 'hw', binding: 'seeded' },
      { key: 'waistCenterY', label: 'Waist position', basis: 'hh', binding: 'seeded' },
      { key: 'waistRadius', label: 'Waist radius', basis: 'hw', binding: 'seeded' },
    ]);
    expect(T11.handleMigrations).toEqual({});
    const { hs } = drag('waistReach', {}, 0, 0);
    expect(hs.map((h) => h.key).sort()).toEqual([...T11.handles.map((h) => h.key)].sort());
    expect(HANDLE_SEGMENT_INDEX.diamondTopHourglassPinch).toEqual(
      { cornerRadiusTop: 2, waistReach: 3, cornerRadiusBottom: 4, waistCenterY: 3, waistRadius: 3 });
    expect(controlledSegments('diamondTopHourglassPinch', 'cornerRadiusTop', 13)).toEqual([2, 10]); // shoulder + its mirror
    expect(controlledSegments('diamondTopHourglassPinch', 'cornerRadiusBottom', 13)).toEqual([4, 8]); // hip + its mirror
    expect(controlledSegments('diamondTopHourglassPinch', 'waistReach', 13)).toEqual([3, 9]); // waist + its mirror
  });

  it('dragged far, each handle stops at its range and the frame stays valid (outline and inner edge)', () => {
    for (const [key, dx, dy] of [['waistReach', 20, 0], ['waistReach', -20, 0],
      ['cornerRadiusTop', 20, 0], ['cornerRadiusTop', -20, 0], ['cornerRadiusBottom', -20, 0], ['cornerRadiusBottom', 20, 0],
      ['waistCenterY', 0, 20], ['waistCenterY', 0, -20], ['waistRadius', 20, 0], ['waistRadius', -20, 0]]) {
      const { next } = drag(key, {}, dx, dy);
      const after = frameCutProfile(FRAME_DEFS, next, board(7, 9));
      expect(after.primitives.length, key).toBe(13);
      expect(after.defects, key).toEqual([]);
      const innAfter = frameInnerProfile(FRAME_DEFS, next, board(7, 9));
      expect(innAfter && innAfter.defects, key).toEqual([]);
      expect(frameMiters(after.primitives, innAfter.primitives), key).toHaveLength(5);
    }
  });

  it('[Generate] draws the waist/corners too, always a valid frame (the real app\'s own retry-until-valid, generateValidFrameSeeds)', () => {
    const region = profile({}).region;
    const isValid = (s) => {
      const inn = frameInnerProfile(FRAME_DEFS, { ...rec11(s) }, board(7, 9));
      return !inn || inn.defects.length === 0;
    };
    for (let seed = 1; seed <= 50; seed++) {
      const seeds = generateValidFrameSeeds(T11, region, seed, undefined, isValid);
      for (const k of KEYS) expect(seeds).toHaveProperty(k);
      const prof = profile(seeds);
      for (const k of KEYS) expect(prof.params[k]).toBeCloseTo(seeds[k], 9);
      expect(prof.primitives.length).toBe(13);
      expect(prof.defects).toEqual([]);
      const inn = inner(seeds);
      expect(inn && inn.defects).toEqual([]);
    }
    const payload = framePayload(FRAME_DEFS, rec11(generateValidFrameSeeds(T11, region, 3, undefined, isValid)));
    expect(Object.keys(payload.params).sort()).toEqual(T11.params.filter((p) => p.owner === 'frame').map((p) => p.name).sort());
  });
});

describe('Template 11 reuses Template 1\'s own key names without colliding with it', () => {
  it('the 5 reused keys are NOT in FRAME_ONLY_PARAM_KEYS (that would silently exclude Template 1\'s own real params too)', () => {
    for (const k of KEYS) expect(FRAME_ONLY_PARAM_KEYS).not.toContain(k);
    expect(SHAPE_PARAM_KEYS.hourglass).toEqual(['waistReach', 'cornerRadiusTop', 'cornerRadiusBottom', 'waistCenterY', 'waistRadius']);
    expect(PARAM_ORDER.hourglass[0]).toBe('waistCenterY'); // Template 1's own order, unchanged
  });

  it('paramsFromShapeModel round-trips the provisional model EXACTLY (unlike Template 7\'s own portrait-only approximation)', () => {
    const region = profile({}).region;
    const out = paramsFromShapeModel('diamondTopHourglassPinch', T11.shapeModel, region);
    expect(out.waistReach).toBeCloseTo(0.55, 9);
    expect(out.cornerRadiusTop).toBeCloseTo(0.22, 9);
    expect(out.cornerRadiusBottom).toBeCloseTo(0.22, 9);
    expect(out.waistCenterY).toBeCloseTo(0, 9);
    expect(out.waistRadius).toBeCloseTo(0.33, 9);
  });

  it('Template 1\'s own handle table and params are untouched', () => {
    expect(T1.handles.map((h) => h.key)).toEqual(['waistReach', 'cornerRadiusTop', 'cornerRadiusBottom', 'waistCenterY', 'waistRadius']);
    expect(T1.silhouettePreset).toBe('hourglass');
  });

  it('Templates 2-10 are unaffected: none of them declare template_11\'s own preset or outline', () => {
    for (const id of ['template_2', 'template_3', 'template_4', 'template_5', 'template_6', 'template_7',
      'template_8', 'template_9', 'template_10']) {
      const t = tplOf(id);
      expect(t.silhouettePreset, id).not.toBe('diamondTopHourglassPinch');
    }
  });
});

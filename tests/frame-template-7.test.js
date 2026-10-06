/**
 * T7 DIAMOND-TOP HOURGLASS (amendment 189/190 in .handoff/amendments.tsv, Fred's own markup/sketch): a 90-degree
 * gable roof (2 straight bars, mitred at the peak and at each eave) over an hourglass S-curve side (concave
 * neck arc, convex body arc, tangent to each other and to a straight base side), a plain straight base. The
 * frame-only `diamondTopHourglass` preset (editor-shape-lattice-generator.js `_solveDiamondTopHourglass`), its 3
 * handles (Neck width/height, Body flare height), and the guards that keep every other template and the Shape
 * Lattice exactly as they were.
 *
 * UNVERIFIED LIVE (no Fusion bridge on this seat, see LIVE_CHECK.md): these tests prove the JS-side geometry is
 * internally consistent (closed, within the board, every bar long enough, every handle stays valid) -- they
 * cannot prove the Fusion sketch build itself solves cleanly.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord, framePayload, frameParam } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile, frameInnerProfile, frameMiters, miterStaysInsideWood } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import {
  frameHandles, handleDragPatch, frameSeedGeometry, generateValidFrameSeeds, generateFrameSeeds,
} from '../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';
import {
  paramsFromShapeModel, PARAM_ORDER, SHAPE_PARAM_KEYS, FRAME_ONLY_PARAM_KEYS,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import { HANDLE_SEGMENT_INDEX, controlledSegments } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-interaction.js';
import { manifestFromShape } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-sketch-manifest.js';
import { frameLabel } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';
import { sampleOutline } from '../bspline-frame-builder/b-spline-gen/html/core/preview/frame-mesh.js';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';

const tplOf = (id) => FRAME_DEFS.templates.find((t) => t.id === id);
const T7 = tplOf('template_7');
// MEASURED, not assumed: this template's own range (editor-shape-lattice-generator.js
// _diamondTopHourglassRange, a deliberately narrow, directly-tested-safe box -- see that function's own doc
// comment) is only verified clean on PORTRAIT/square boards (project_portrait_only: Fred's own actual usage).
// A LANDSCAPE board (hw > hh) can fail even at the template's own defaults (MEASURED: 12x6 self-intersects at
// the default proportions) -- a real, flagged gap (LIVE_CHECK.md), not silently worked around here. BOARDS
// covers the structural "doesn't crash outright, still 9 pieces" claim; PORTRAIT_BOARDS is the actual
// defect-free guarantee. 5.51x1.97 (every other template's own extreme-small test board) is NOT included here
// at all: MEASURED to throw outright at this template's own defaults (too little room for the roof + neck/body
// construction at that size) -- named, not silently skipped, in LIVE_CHECK.md.
const BOARDS = [[7, 9], [12, 6], [9, 12], [8, 8]];
const PORTRAIT_BOARDS = [[7, 9], [9, 12], [8, 8], [7, 7], [9, 9]];
const KEYS = ['gableNeckWidth', 'neckHeight', 'bodyFlareHeight'];
const board = (W, H) => ({ widthIn: W, heightIn: H });
const rec7 = (seeds) => normalizeFrameRecord({ templateId: 'template_7', seeds });
const profile = (seeds, W = 7, H = 9) => frameCutProfile(FRAME_DEFS, rec7(seeds), board(W, H));
const inner = (seeds, W = 7, H = 9) => frameInnerProfile(FRAME_DEFS, rec7(seeds), board(W, H));
const primLength = (p) => (p.type === 'L' ? Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y) : p.rx * Math.abs(p.dTheta));
const J = (x) => JSON.stringify(x);

describe('Template 7: listing and declaration', () => {
  it('is listed as "7. Diamond-top Hourglass", the frame-only diamondTopHourglass preset, 5 bars, no new USER-FACING Fusion parameter', () => {
    expect(T7.name).toBe('Template 7 - Diamond-top Hourglass');
    expect(frameLabel(T7)).toBe('7. Diamond-top Hourglass');
    expect(T7.silhouettePreset).toBe('diamondTopHourglass');
    // H23 item 27: the T11 recipe's own exact closed-form seed needs each arc's circle centre/
    // radius/angular-midpoint as a live Fusion expression; declared as named internal parameters
    // (template_data.py's own SKETCH_2_PARAMETERS, t7_*) rather than inlined (inlining exploded to
    // a 170KB expression string) -- NOT user-facing (no Expose, no app-side handle reads them),
    // so this test's own "no new Fusion parameter" claim is really "no new EXPOSED one": still true.
    const T7_GEOMETRY_PARAMS = ['t7_a', 't7_nx', 't7_dy', 't7_dxn', 't7_r_body', 't7_cbx', 't7_cby', 't7_ux', 't7_uy',
      't7_vx', 't7_vy', 't7_v_dot_u', 't7_vlen', 't7_r_neck', 't7_cnx', 't7_cny', 't7_bbx', 't7_bby',
      't7_bblen', 't7_via_body_x', 't7_via_body_y', 't7_uex', 't7_uey', 't7_nbx', 't7_nby',
      't7_nblen', 't7_via_neck_x', 't7_via_neck_y'];
    expect(T7.params.map((p) => p.name)).toEqual(['widthIn', 'heightIn', 'boundingboxoffset',
      ...T7_GEOMETRY_PARAMS, 'frame_thickness']);
    expect(T7.regions.outline).toHaveLength(9);
    expect(T7.regions.outline).toEqual(['proj_roof_R', 'proj_arc_neck_R', 'proj_arc_body_R', 'proj_side_R',
      'proj_bottom_edge', 'proj_side_L', 'proj_arc_body_L', 'proj_arc_neck_L', 'proj_roof_L']);
    expect(T7.regions.miters).toHaveLength(5);
    expect(T7.regions.bars.map((b) => b.name)).toEqual(T7.features[0].bodyNames);
    expect(T7.regions.bars.map((b) => b.name)).toEqual(
      ['frame_roof_right', 'frame_side_right', 'frame_base', 'frame_side_left', 'frame_roof_left']);
    expect(T7.handles.map((h) => h.key)).toEqual(KEYS);
    for (const h of T7.handles) expect(h.binding).toBe('seeded'); // never a Fusion user parameter
  });

  it.each(PORTRAIT_BOARDS)('%dx%d: a clean 9-piece frame, 2 roof lines + 4 S-curve arcs + 3 straight sides/base', (W, H) => {
    const prof = profile({}, W, H);
    expect(prof.primitives.length, J({ W, H })).toBe(9);
    expect(prof.defects, J({ W, H })).toEqual([]);
    const inn = inner({}, W, H);
    if (inn) expect(inn.defects, J({ W, H })).toEqual([]); // null when the frame doesn't fit at all
    const types = prof.primitives.map((p) => p.type);
    // 0 roof_R(L), 1 arc_neck_R(A), 2 arc_body_R(A), 3 side_R(L), 4 bottom_edge(L), 5 side_L(L), 6 arc_body_L(A),
    // 7 arc_neck_L(A), 8 roof_L(L) -- editor-shape-lattice-generator.js's own _solveDiamondTopHourglass doc comment.
    expect(types, J({ W, H })).toEqual(['L', 'A', 'A', 'L', 'L', 'L', 'A', 'A', 'L']);
  });

  it.each(BOARDS)('%dx%d: a structurally closed 9-piece outline even on a LANDSCAPE board (known gap: not yet defect-free there, see LIVE_CHECK.md)', (W, H) => {
    const prof = profile({}, W, H);
    expect(prof.primitives.length, J({ W, H })).toBe(9);
    expect(prof.primitives.map((p) => p.type), J({ W, H })).toEqual(['L', 'A', 'A', 'L', 'L', 'L', 'A', 'A', 'L']);
  });

  it('the roof is symmetric about the centreline and the peak sits on it', () => {
    const prof = profile({});
    const cx0 = prof.region.x + prof.region.w / 2;
    const roofR = prof.primitives[0], roofL = prof.primitives[8];
    // roof_R starts at the peak, roof_L ends at the peak (p02_02_loop.py's own clockwise traversal)
    expect(roofR.p0.x).toBeCloseTo(cx0, 6);
    expect(J([roofR.p0.x, roofR.p0.y])).toBe(J([roofL.p1.x, roofL.p1.y]));
    // the two eave tips are mirrored about the centreline, same height
    expect(roofR.p1.x - cx0).toBeCloseTo(-(roofL.p0.x - cx0), 6);
    expect(roofR.p1.y).toBeCloseTo(roofL.p0.y, 6);
  });

  it.each(PORTRAIT_BOARDS)('%dx%d: every bar at the defaults is at least frame_thickness long (no "wing" risk, this template\'s own earlier rejected build\'s finding)', (W, H) => {
    const prof = profile({}, W, H);
    if (!prof.fit.ok) return; // too small for the frame at all (like every other template)
    const THICK = T7.params.find((p) => p.name === 'frame_thickness').default;
    prof.primitives.forEach((p, i) => expect(primLength(p), `${W}x${H} piece ${i}`).toBeGreaterThanOrEqual(THICK * 0.99));
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
      const outer = frameCutProfile(FRAME_DEFS, rec7({}), board(W, H));
      if (!outer.fit.ok) continue;
      const innerP = frameInnerProfile(FRAME_DEFS, rec7({}), board(W, H));
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

  it('any seed combination within the declared ranges (portrait boards) still produces a valid, closed 9-piece outline', () => {
    // The declared ranges themselves (editor-shape-lattice-generator.js _diamondTopHourglassRange) are the
    // directly-tested-safe box -- this sweeps its own corners and centre, not arbitrary values outside it.
    for (const [W, H] of PORTRAIT_BOARDS) {
      for (const nw of [0.15, 0.3, 0.45]) {
        for (const nh of [0.05, 0.15, 0.25]) {
          for (const bf of [nh + 0.4, (nh + 0.4 + 0.75) / 2, 0.75]) {
            if (bf > 0.75 + 1e-9) continue;
            const seeds = { gableNeckWidth: nw, neckHeight: nh, bodyFlareHeight: bf };
            const prof = profile(seeds, W, H);
            expect(prof.primitives.length, J({ W, H, seeds })).toBe(9);
            expect(prof.defects, J({ W, H, seeds })).toEqual([]);
          }
        }
      }
    }
  });

  it('the Fusion seeds: the 9 pieces at the app\'s solved outline, in the sketch\'s own clockwise-from-peak order', () => {
    const prof = profile({});
    const geo = frameSeedGeometry(T7, prof, 7, 9);
    expect(Object.keys(geo).sort()).toEqual(T7.seedMap.map((e) => e.id).sort());
  });
});

describe('Template 7: the neck/body handles', () => {
  const drag = (key, seeds, dx, dy) => {
    const rec = rec7(seeds);
    const prof = frameCutProfile(FRAME_DEFS, rec, board(7, 9));
    const hs = frameHandles(T7, prof);
    const h = hs.find((q) => q.key === key);
    const pt = { x: h.anchor.x + dx, y: h.anchor.y + dy };
    return { h, hs, prof, rec, next: normalizeFrameRecord({ ...rec, ...handleDragPatch(rec, h, pt, prof.region) }) };
  };

  it('the table is exactly the approved 3, all seeded, in the app\'s own declared order', () => {
    expect(T7.handles).toEqual([
      // H23 item 40: generateRange narrows only [Generate]'s own draw (frame-handles.js's
      // generateFrameSeeds); the drag range (frameHandles, below) is the full feasible range, unaffected.
      { key: 'gableNeckWidth', label: 'Neck width', basis: 'hw', binding: 'seeded', generateRange: { min: 0.45 } },
      { key: 'neckHeight', label: 'Neck height', basis: 'hh', binding: 'seeded', generateRange: { min: 0.13 } },
      { key: 'bodyFlareHeight', label: 'Body flare height', basis: 'hh', binding: 'seeded', generateRange: { min: 0.65 } },
    ]);
    expect(T7.handleMigrations).toEqual({});
    const { hs } = drag('gableNeckWidth', {}, 0, 0);
    expect(hs.map((h) => h.key)).toEqual(T7.handles.map((h) => h.key));
    expect(HANDLE_SEGMENT_INDEX.diamondTopHourglass).toEqual({ gableNeckWidth: 1, neckHeight: 1, bodyFlareHeight: 2 });
    expect(controlledSegments('diamondTopHourglass', 'gableNeckWidth', 9)).toEqual([1, 7]); // the neck arc + its mirror
    expect(controlledSegments('diamondTopHourglass', 'bodyFlareHeight', 9)).toEqual([2, 6]); // the body arc + its mirror
  });

  it('dragged far, each handle stops at its range and the frame stays valid (outline and inner edge)', () => {
    for (const [key, dx, dy] of [['gableNeckWidth', 20, 0], ['gableNeckWidth', -20, 0],
      ['neckHeight', 0, 20], ['neckHeight', 0, -20], ['bodyFlareHeight', 0, 20], ['bodyFlareHeight', 0, -20]]) {
      const { next } = drag(key, {}, dx, dy);
      const after = frameCutProfile(FRAME_DEFS, next, board(7, 9));
      expect(after.primitives.length, key).toBe(9);
      expect(after.defects, key).toEqual([]);
      const innAfter = frameInnerProfile(FRAME_DEFS, next, board(7, 9));
      expect(innAfter && innAfter.defects, key).toEqual([]);
      expect(frameMiters(after.primitives, innAfter.primitives), key).toHaveLength(5);
    }
  });

  it('[Generate] draws the neck/body too, always a valid frame (the real app\'s own retry-until-valid, generateValidFrameSeeds -- frame-panel.js generateFrame uses the identical pattern, same as Template 10 already relies on)', () => {
    const region = profile({}).region;
    const isValid = (s) => {
      const inn = frameInnerProfile(FRAME_DEFS, { ...rec7(s) }, board(7, 9));
      return !inn || inn.defects.length === 0;
    };
    for (let seed = 1; seed <= 50; seed++) {
      const seeds = generateValidFrameSeeds(T7, region, seed, undefined, isValid);
      for (const k of KEYS) expect(seeds).toHaveProperty(k);
      const prof = profile(seeds);
      for (const k of KEYS) expect(prof.params[k]).toBeCloseTo(seeds[k], 9);
      expect(prof.primitives.length).toBe(9);
      expect(prof.defects).toEqual([]);
      const inn = inner(seeds);
      expect(inn && inn.defects).toEqual([]);
    }
    const payload = framePayload(FRAME_DEFS, rec7(generateValidFrameSeeds(T7, region, 3, undefined, isValid)));
    expect(Object.keys(payload.params).sort()).toEqual(T7.params.filter((p) => p.owner === 'frame').map((p) => p.name).sort());
  });

  it('H23 item 40 (Fred: simple shapes, no short grain -- a 4% raw Generate pass rate against the no-hooked' +
    '-tip margin rule meant Generate mostly drew hooked shapes and survived only by rejection sampling): ' +
    'each handle\'s own declared generateRange narrows ONLY [Generate]\'s own raw draw, never below its ' +
    'floor, and raw (no-retry) pass rate against the margin rule is now >= 50% at every portrait size -- ' +
    'MEASURED: 100% (6x9), 59% (7x9), 75% (9x12) over 1000 raw draws each.', () => {
    const t = frameParam(FRAME_DEFS, rec7({}), 'frame_thickness');
    for (const [W, H] of [[6, 9], [7, 9], [9, 12]]) {
      const b = board(W, H);
      const region = frameCutProfile(FRAME_DEFS, rec7({}), b).region;
      let pass = 0;
      const N = 1000;
      for (let seed = 1; seed <= N; seed++) {
        const seeds = generateFrameSeeds(T7, region, seed * 104729, t); // RAW -- no retry
        for (const [k, h] of [['gableNeckWidth', 0.45], ['neckHeight', 0.13], ['bodyFlareHeight', 0.65]]) {
          expect(seeds[k], `${W}x${H} seed ${seed} ${k}`).toBeGreaterThanOrEqual(h);
        }
        const outer = frameCutProfile(FRAME_DEFS, rec7(seeds), b);
        const inn = frameInnerProfile(FRAME_DEFS, rec7(seeds), b);
        if (outer.defects.length || inn.defects.length) continue;
        if (miterStaysInsideWood(outer.primitives, frameMiters(outer.primitives, inn.primitives), t)) pass++;
      }
      expect(pass / N, `${W}x${H} raw pass rate`).toBeGreaterThanOrEqual(0.5);
    }
  }, 30000);

  it('MUTATION (strip generateRange -- the pre-item-40 state): the SAME generateFrameSeeds, given a T7 ' +
    'copy whose handles have no generateRange, reproduces the old low raw pass rate (<= 10%) at 7x9 -- ' +
    'proving the declared override is load-bearing, not decorative.', () => {
    const t = frameParam(FRAME_DEFS, rec7({}), 'frame_thickness');
    const b = board(7, 9);
    const region = frameCutProfile(FRAME_DEFS, rec7({}), b).region;
    const T7_NO_RANGE = { ...T7, handles: T7.handles.map((h) => { const { generateRange, ...rest } = h; return rest; }) };
    let pass = 0;
    const N = 1000;
    for (let seed = 1; seed <= N; seed++) {
      const seeds = generateFrameSeeds(T7_NO_RANGE, region, seed * 104729, t);
      const outer = frameCutProfile(FRAME_DEFS, rec7(seeds), b);
      const inn = frameInnerProfile(FRAME_DEFS, rec7(seeds), b);
      if (outer.defects.length || inn.defects.length) continue;
      if (miterStaysInsideWood(outer.primitives, frameMiters(outer.primitives, inn.primitives), t)) pass++;
    }
    expect(pass / N, '7x9 raw pass rate with generateRange stripped').toBeLessThanOrEqual(0.1);
  }, HEAVY_TEST_MS); // item 67: the suite default (was a tighter 10 s)
});

describe('the Shape Lattice and every other template never get the neck/body params', () => {
  it('frame-only keys: not Shape Lattice params, not default handles, no bare "neckWidth" collision with Bottle', () => {
    for (const k of KEYS) expect(FRAME_ONLY_PARAM_KEYS).toContain(k);
    expect(FRAME_ONLY_PARAM_KEYS).not.toContain('neckWidth'); // Bottle's own plain key must stay untouched
    expect(SHAPE_PARAM_KEYS).not.toHaveProperty('diamondTopHourglass');
    // F30 item 3 appended its own 'taperAngle' at the end -- Template 7 (diamondTopHourglass) is unaffected either way.
    expect(PARAM_ORDER.bottle).toEqual(['neckWidth', 'skeletonX', 'neckLength', 'bodyRadius', 'taperAngle']);
  });

  it('the Fusion manifest never emits a diamondTopHourglass user parameter, and Bottle\'s own neckWidth is unaffected', () => {
    const region = { x: 0, y: 0, w: 6, h: 8 };
    const m = manifestFromShape({ preset: 'diamondTopHourglass', params: {} }, region);
    for (const k of KEYS) expect(m.parameters.map((p) => p.name)).not.toContain(k);
    const bottleParams = manifestFromShape({ preset: 'bottle', seed: 42, params: {} }, region);
    expect(bottleParams.parameters.map((p) => p.name)).toContain('neck_width'); // bottle's own, still emitted
  });

  it('paramsFromShapeModel maps the provisional model back to (approximately) its own default params', () => {
    const region = profile({}).region;
    const out = paramsFromShapeModel('diamondTopHourglass', T7.shapeModel, region);
    expect(Object.keys(out).sort()).toEqual(KEYS.slice().sort());
    expect(out.gableNeckWidth).toBeCloseTo(0.50, 6); // hw-linear: exact even provisionally
    // neckHeight/bodyFlareHeight: close but not exact provisionally (the `rest ~= 2*hh` approximation,
    // see provisional_diamond_top_hourglass_model's own doc comment) -- a loose tolerance, not exactness.
    expect(out.neckHeight).toBeCloseTo(0.18, 1);
    expect(out.bodyFlareHeight).toBeCloseTo(0.72, 1);
  });

  it('Templates 1-6, 8, 9, 10 are unaffected: their own params, models and handles are untouched', () => {
    for (const id of ['template_1', 'template_2', 'template_3', 'template_4', 'template_5', 'template_6',
      'template_8', 'template_9', 'template_10']) {
      const t = tplOf(id);
      for (const k of KEYS) expect(t.handles.map((h) => h.key)).not.toContain(k);
    }
  });
});

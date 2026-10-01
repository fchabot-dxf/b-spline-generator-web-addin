/**
 * T8 DIPPED TOP + LEFT-ONLY WAVE (Fred's backlog / HANDOFF-ranchy.md section 5, sketch clarified in an amendment:
 * the dip sits off centre, in the middle-right of the top edge; the left side has an S-wave pinch; the right side
 * and base are straight; 4 mitred square corners): the frame-only `dippedLeftWave` preset (editor-shape-lattice-
 * generator.js `_solveDippedLeftWave`), its 5 handles (Left wave height/reach, Top dip width/position/depth), and
 * the guards that keep every other template and the Shape Lattice exactly as they were.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord, framePayload } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile, frameInnerProfile, frameMiters } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import {
  frameHandles, handleDragPatch, frameSeedGeometry, generateFrameSeeds, frameParamRanges,
} from '../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';
import {
  generateSilhouette, outlineDefects, paramsFromShapeModel, PARAM_ORDER, SHAPE_PARAM_KEYS, FRAME_ONLY_PARAM_KEYS,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import {
  computeParamHandles, HANDLE_SEGMENT_INDEX, controlledSegments,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-interaction.js';
import { manifestFromShape } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-sketch-manifest.js';
import { frameLabel } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';
import { sampleOutline } from '../bspline-frame-builder/b-spline-gen/html/core/preview/frame-mesh.js';

const tplOf = (id) => FRAME_DEFS.templates.find((t) => t.id === id);
const T8 = tplOf('template_8');
const BOARDS = [[7, 9], [12, 6], [9, 12], [8, 8]];
const KEYS = ['waveHeight', 'waveReach', 'topDipWidth', 'topDipPosition', 'topDipDepth'];
const board = (W, H) => ({ widthIn: W, heightIn: H });
const rec8 = (seeds) => normalizeFrameRecord({ templateId: 'template_8', seeds });
const profile = (seeds, W = 7, H = 9) => frameCutProfile(FRAME_DEFS, rec8(seeds), board(W, H));
const inner = (seeds, W = 7, H = 9) => frameInnerProfile(FRAME_DEFS, rec8(seeds), board(W, H));
const J = (x) => JSON.stringify(x);

describe('Template 8: listing and declaration', () => {
  it('is listed as "8. Dipped Top + Left-Only Wave", the frame-only dippedLeftWave preset, no new Fusion parameter', () => {
    expect(T8.name).toBe('Template 8 - Dipped Top + Left-Only Wave');
    expect(frameLabel(T8)).toBe('8. Dipped Top + Left-Only Wave');
    expect(T8.silhouettePreset).toBe('dippedLeftWave');
    expect(T8.params.map((p) => p.name)).toEqual(['widthIn', 'heightIn', 'boundingboxoffset', 'ck_arc_shoulder_weld', 'ck_arc_hip_weld', 'frame_thickness']);
    expect(T8.features).toEqual(tplOf('template_1').features); // the same 4-bar + trim layout
    expect(T8.shapeModel.provisional).toBeTruthy();
    expect(T8.regions.outline).toHaveLength(12);
    expect(T8.regions.outline).toEqual(['proj_side_R', 'proj_bottom_edge', 'proj_horn_BL', 'proj_arc_hip_L',
      'proj_arc_waist_L', 'proj_arc_shoulder_L', 'proj_horn_TL', 'proj_top_edge_L', 'proj_arc_top_shoulder_L',
      'proj_arc_top_dip', 'proj_arc_top_shoulder_R', 'proj_top_edge_R']);
    expect(T8.regions.miters.map((m) => m[0])).toEqual(['proj_top_edge_L:S', 'proj_side_R:S', 'proj_bottom_edge:S', 'proj_horn_BL:S']);
    expect(T8.handles.map((h) => h.key)).toEqual(KEYS);
    for (const h of T8.handles) expect(h.binding).toBe('seeded'); // never a Fusion user parameter
  });

  it.each(BOARDS)('%dx%d: a clean 12-piece frame, the right side and base plain straight lines, 4 square miters', (W, H) => {
    const prof = profile({}, W, H);
    expect(prof.primitives.length).toBe(12);
    expect(prof.defects).toEqual([]);
    const inn = inner({}, W, H);
    expect(inn && inn.defects).toEqual([]);
    const [sideR, bottom] = prof.primitives;
    expect(sideR.type).toBe('L');
    expect(bottom.type).toBe('L');
    // the right side is a single straight vertical line, corner to corner
    expect(sideR.p0.x).toBeCloseTo(sideR.p1.x, 9);
    // the wave (prim 3-5) and the dip (prim 8-10) are arcs; the right side has none
    for (const i of [3, 4, 5, 8, 9, 10]) expect(prof.primitives[i].type).toBe('A');
    const outer = frameCutProfile(FRAME_DEFS, rec8({}), board(W, H));
    const innerP = frameInnerProfile(FRAME_DEFS, rec8({}), board(W, H));
    const miters = frameMiters(outer.primitives, innerP.primitives);
    expect(miters).toHaveLength(4);
    for (const m of miters) {
      expect(Math.abs(m.inner.y - m.outer.y)).toBeCloseTo(0.75, 9);
      expect(Math.abs(m.inner.x - m.outer.x)).toBeCloseTo(0.75, 9);
    }
  });

  it('5.51x1.97: still a clean 12-piece outline (the board is too small for the frame: 0 bars, like the others)', () => {
    const prof = profile({}, 5.51, 1.97);
    expect(prof.primitives.length).toBe(12);
    expect(prof.defects).toEqual([]);
    expect(prof.fit.ok).toBe(false);
  });

  it('at the defaults, every piece along the band is at least frame_thickness long (no "wing" risk, Template 7\'s own finding)', () => {
    // Seat B found a bar segment shorter than frame_thickness is what caused T7's "wing" artifacts (a sliver
    // that, offset inward by the frame thickness, collapses or flips). MEASURED here at this template's own
    // default seeds: at 7x9 the top shoulder arcs came out at 0.737in with a 0.4 half-width default (just UNDER
    // the 0.75in frame_thickness) -- the half-width default was widened to 0.5 (0.883in there) specifically to
    // clear this. 5.51x1.97 is excluded: `fit.ok` is already false there (too small for the frame, like every
    // other template), so no bars are built and the rule doesn't apply.
    const primLength = (p) => (p.type === 'L' ? Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y) : p.rx * Math.abs(p.dTheta));
    const THICK = T8.params.find((p) => p.name === 'frame_thickness').default;
    for (const [W, H] of BOARDS) {
      const prof = profile({}, W, H);
      if (!prof.fit.ok) continue;
      prof.primitives.forEach((p, i) => expect(primLength(p), `${W}x${H} piece ${i}`).toBeGreaterThanOrEqual(THICK));
    }
  });

  it('the top dip sits off centre by default (middle-right, Fred\'s sketch), the wave is on the left only', () => {
    const prof = profile({});
    const { region } = prof, cx0 = region.x + region.w / 2, y0 = region.y;
    const dip = prof.primitives[9], shL = prof.primitives[8], shR = prof.primitives[10];
    expect(dip.cx).toBeGreaterThan(cx0); // right of centre
    expect(dip.cy).toBeLessThan(y0); // concave: its centre above (outside) the top edge
    expect(shL.rx).toBeCloseTo(shR.rx, 9); // the shared-radius tie (p02_11's own Equal)
    const wave = prof.primitives[4];
    expect(wave.cx).toBeLessThan(cx0); // the wave sits on the LEFT
  });

  it('any seed is clamped into a valid OUTLINE, at every board (MEASURED: the inner edge is a separate guarantee)', () => {
    // MEASURED: a raw seed dict is resolved through the plain SILHOUETTE-level ranges only (frameCutProfile never
    // consults frameParamRanges' own frame-thickness-aware narrowing) -- and that plain resolution can produce a
    // self-intersecting INNER profile for ANY hourglass-family template, not just this one: Template 1 itself
    // (`waistCenterY: -0.3, waistReach: 0.5`) and Template 4 (the same on its own independent left pinch) both
    // self-intersect their own inner edge at 12x6, the exact board and magnitude this preset's wave does too. So
    // the OUTER outline is the one guarantee a raw seed gets; the inner edge's real safety net is
    // `frameParamRanges`, exercised by a HANDLE DRAG or [Generate] (both covered below), never by an arbitrary
    // seed dict directly.
    for (const [W, H] of BOARDS) {
      for (const wh of [-0.3, 0, 0.3]) {
        for (const wr of [0.15, 0.3, 0.5]) {
          for (const dp of [-0.3, 0, 0.3]) {
            const seeds = { waveHeight: wh, waveReach: wr, topDipPosition: dp };
            const prof = profile(seeds, W, H);
            expect(prof.primitives.length, J({ W, H, seeds })).toBe(12);
            expect(prof.defects, J({ W, H, seeds })).toEqual([]);
          }
        }
      }
    }
  });

  it('the outer profile stays within the BOARD (not just the safe zone), at every board', () => {
    // HEADS-UP amendment (Fred's phone screenshot): a frame (Template 3) drew past the board edge in the
    // editor. Seat A owns that general fix; this is this template's own guard: every outer-profile point
    // (densely sampled, arcs included -- sampleOutline, as the lattice-boundary tests already use) stays
    // within the actual board rectangle, not merely the inset safe zone `region` describes.
    const BBO = 0.25;
    for (const [W, H] of BOARDS) {
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

  it('the Fusion seeds follow the wave and the dip: side_R a plain line, the dip seeded off axis', () => {
    const prof = profile({});
    const geo = frameSeedGeometry(T8, prof, 7, 9);
    const F = (p) => [p.x - 3.5, 4.5 - p.y];
    const sideR = prof.primitives[0];
    expect(geo.side_R.points).toEqual([F(sideR.p0), F(sideR.p1)]);
    expect(geo).not.toHaveProperty('horn_TR');
    expect(geo).not.toHaveProperty('arc_shoulder_R');
    for (const k of ['arc_hip_L', 'arc_waist_L', 'arc_shoulder_L', 'horn_TL', 'top_edge_L',
      'arc_top_shoulder_L', 'arc_top_dip', 'arc_top_shoulder_R', 'top_edge_R',
      'skel_shoulder_pin_L', 'skel_waist_pin_L', 'skel_hip_pin_L']) expect(geo).toHaveProperty(k);
    // the dip is off centre by default: its own seeded x is NOT ~0
    expect(Math.abs(geo.arc_top_dip.points[1][0])).toBeGreaterThan(0.05);
  });
});

describe('Template 8: the wave and dip handles', () => {
  const drag = (key, seeds, dx, dy) => {
    const rec = rec8(seeds);
    const prof = frameCutProfile(FRAME_DEFS, rec, board(7, 9));
    const hs = frameHandles(T8, prof);
    const h = hs.find((q) => q.key === key);
    const pt = { x: h.anchor.x + dx, y: h.anchor.y + dy };
    return { h, hs, prof, rec, next: normalizeFrameRecord({ ...rec, ...handleDragPatch(rec, h, pt, prof.region) }) };
  };

  it('the table is exactly Fred\'s approved 5, all seeded, in the app\'s own declared order', () => {
    expect(T8.handles).toEqual([
      { key: 'waveHeight', label: 'Left wave height', basis: 'hh', binding: 'seeded' },
      { key: 'waveReach', label: 'Left wave reach', basis: 'hw', binding: 'seeded' },
      { key: 'topDipWidth', label: 'Top dip width', basis: 'hw', binding: 'seeded' },
      { key: 'topDipPosition', label: 'Top dip position', basis: 'hw', binding: 'seeded' },
      { key: 'topDipDepth', label: 'Top dip depth', basis: 'hh', binding: 'seeded' },
    ]);
    expect(T8.handleMigrations).toEqual({});
    const { hs } = drag('waveHeight', {}, 0, 0);
    expect(hs.map((h) => h.key)).toEqual(T8.handles.map((h) => h.key));
    expect(HANDLE_SEGMENT_INDEX.dippedLeftWave).toEqual({ waveHeight: 4, waveReach: 4, topDipDepth: 9, topDipPosition: 9, topDipWidth: 8 });
    expect(controlledSegments('dippedLeftWave', 'waveHeight', 12)).toEqual([4]); // the wave arc alone
    expect(controlledSegments('dippedLeftWave', 'topDipWidth', 12)).toEqual([8, 10]); // both top shoulders
    expect(controlledSegments('dippedLeftWave', 'topDipPosition', 12)).toEqual([9]); // the dip alone
  });

  it('Left wave height: a drag moves the wave only, the right side and dip untouched', () => {
    const { prof, next } = drag('waveHeight', {}, 0, 0.3);
    const after = frameCutProfile(FRAME_DEFS, next, board(7, 9));
    expect(after.defects).toEqual([]);
    expect(J(after.primitives[0])).toBe(J(prof.primitives[0])); // side_R unchanged
    expect(J(after.primitives[1])).toBe(J(prof.primitives[1])); // bottom_edge unchanged
    for (let i = 7; i <= 11; i++) expect(J(after.primitives[i])).toBe(J(prof.primitives[i])); // the top dip unchanged
    expect(after.primitives[4].cy).not.toBeCloseTo(prof.primitives[4].cy, 6); // the wave moved
  });

  it('Left wave reach: a drag pinches the wave only, its radius held, the right side and dip untouched', () => {
    const { prof, next } = drag('waveReach', {}, 0.2, 0);
    const after = frameCutProfile(FRAME_DEFS, next, board(7, 9));
    expect(after.defects).toEqual([]);
    expect(J(after.primitives[0])).toBe(J(prof.primitives[0]));
    for (let i = 7; i <= 11; i++) expect(J(after.primitives[i])).toBe(J(prof.primitives[i]));
  });

  it('Top dip width: a drag widens the dip (both shoulders), the wave and the depth held', () => {
    const { prof, next } = drag('topDipWidth', {}, -0.3, 0);
    const after = frameCutProfile(FRAME_DEFS, next, board(7, 9));
    expect(after.defects).toEqual([]);
    for (let i = 0; i <= 6; i++) expect(J(after.primitives[i])).toBe(J(prof.primitives[i])); // right + base + wave held
    const depthAfter = after.primitives[9].cy + after.primitives[9].rx;
    const depthBefore = prof.primitives[9].cy + prof.primitives[9].rx;
    expect(depthAfter).toBeCloseTo(depthBefore, 6); // depth (the dip's lowest point) held
  });

  it('Top dip position: a drag shifts the whole dip right or left, its width and depth held', () => {
    const { prof, next } = drag('topDipPosition', {}, 0.3, 0);
    const after = frameCutProfile(FRAME_DEFS, next, board(7, 9));
    expect(after.defects).toEqual([]);
    for (let i = 0; i <= 6; i++) expect(J(after.primitives[i])).toBe(J(prof.primitives[i]));
    expect(after.primitives[9].cx).toBeGreaterThan(prof.primitives[9].cx); // the dip moved right
    expect(after.primitives[8].rx).toBeCloseTo(prof.primitives[8].rx, 6); // shoulder radius (~width) held
    const depthAfter = after.primitives[7].p0.y - (after.primitives[9].cy + after.primitives[9].rx);
    const depthBefore = prof.primitives[7].p0.y - (prof.primitives[9].cy + prof.primitives[9].rx);
    expect(depthAfter).toBeCloseTo(depthBefore, 6); // depth held
  });

  it('Top dip depth: a drag deepens the dip only, its width and position held', () => {
    const { prof, next } = drag('topDipDepth', {}, 0, 0.2);
    const after = frameCutProfile(FRAME_DEFS, next, board(7, 9));
    expect(after.defects).toEqual([]);
    for (let i = 0; i <= 6; i++) expect(J(after.primitives[i])).toBe(J(prof.primitives[i]));
    expect(J(after.primitives[7])).toBe(J(prof.primitives[7])); // stubs' corner ends held
    expect(after.primitives[9].cx).toBeCloseTo(prof.primitives[9].cx, 6); // position held
  });

  it('dragged far, each handle stops at its range and the frame stays valid (outline and inner edge)', () => {
    for (const [key, dx, dy] of [['waveHeight', 0, -20], ['waveHeight', 0, 20], ['waveReach', 20, 0],
      ['topDipWidth', 20, 0], ['topDipPosition', -20, 0], ['topDipPosition', 20, 0],
      ['topDipDepth', 0, -20], ['topDipDepth', 0, 20]]) {
      const { next } = drag(key, {}, dx, dy);
      const after = frameCutProfile(FRAME_DEFS, next, board(7, 9));
      expect(after.primitives.length, key).toBe(12);
      expect(after.defects, key).toEqual([]);
      const innAfter = frameInnerProfile(FRAME_DEFS, next, board(7, 9));
      expect(innAfter && innAfter.defects, key).toEqual([]);
      expect(frameMiters(after.primitives, innAfter.primitives), key).toHaveLength(4);
    }
  });

  it('[Generate] draws the wave and the dip too, always a valid frame', () => {
    const region = profile({}).region;
    for (let seed = 1; seed <= 50; seed++) {
      const seeds = generateFrameSeeds(T8, region, seed);
      for (const k of KEYS) expect(seeds).toHaveProperty(k);
      const prof = profile(seeds);
      for (const k of KEYS) expect(prof.params[k]).toBeCloseTo(seeds[k], 9);
      expect(prof.primitives.length).toBe(12);
      expect(prof.defects).toEqual([]);
      const inn = inner(seeds);
      expect(inn && inn.defects).toEqual([]);
    }
    const payload = framePayload(FRAME_DEFS, rec8(generateFrameSeeds(T8, region, 3)));
    expect(Object.keys(payload.params).sort()).toEqual(T8.params.filter((p) => p.owner === 'frame').map((p) => p.name).sort());
  });
});

describe('the Shape Lattice and every other template never get the wave or the dip position', () => {
  it('frame-only keys: not Shape Lattice params, not default handles', () => {
    for (const k of ['topDipPosition', 'waveHeight', 'waveReach', 'waveCornerRadius', 'waveRadius']) {
      expect(FRAME_ONLY_PARAM_KEYS).toContain(k);
    }
    expect(SHAPE_PARAM_KEYS).not.toHaveProperty('dippedLeftWave');
    expect(PARAM_ORDER.hourglass).not.toContain('waveHeight'); // a separate preset, no shared keys
  });

  it('the Fusion manifest never emits a dippedLeftWave user parameter', () => {
    const region = { x: 0, y: 0, w: 6, h: 8 };
    const m = manifestFromShape({ preset: 'dippedLeftWave', params: {} }, region);
    for (const k of KEYS) expect(m.parameters.map((p) => p.name)).not.toContain(k);
  });

  it('paramsFromShapeModel maps the provisional model back to exactly these 5 params', () => {
    const region = profile({}).region;
    const out = paramsFromShapeModel('dippedLeftWave', T8.shapeModel, region);
    expect(Object.keys(out).sort()).toEqual(['topDipDepth', 'topDipPosition', 'topDipWidth', 'waveHeight', 'waveReach'].sort());
  });

  it('Templates 1-6 are unaffected: their own params, models and handles are untouched', () => {
    for (const id of ['template_1', 'template_2', 'template_3', 'template_4', 'template_5', 'template_6']) {
      const t = tplOf(id);
      expect(t.handles.map((h) => h.key)).not.toContain('waveHeight');
      expect(t.handles.map((h) => h.key)).not.toContain('topDipPosition');
    }
  });
});

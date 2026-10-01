/**
 * T7 DIAMOND-TOP HOURGLASS. ORIGINAL spec (Fred, HANDOFF-ranchy.md section 5): "A 90 deg diamond peak (45 deg
 * miters), pinched waist, round hips, flat base." REVISED by Fred's own reference sketch (T82 item 1 REFERENCE
 * amendment, template_sketches_2026-09-30.jpg): "a 90 deg diamond peak (two straight roof bars), a short
 * horizontal ledge where each roof bar meets the side, then the pinched waist, then hips that FLARE OUTWARD
 * down to a wider flat base (bell-like)." The waist/hip/shoulder-ARC geometry is still Template 1's OWN,
 * unchanged. Declares its own N-BAR corners/bars (5, no reflex corner) like Template 6.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile, frameInnerProfile, frameMiters } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import {
  generateSilhouette, PARAM_ORDER, SHAPE_PARAM_KEYS, FRAME_ONLY_PARAM_KEYS, TOP_PEAK_SEGMENT_COUNT, topPeakMirrorIndex,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import { controlledSegments, HANDLE_SEGMENT_INDEX } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-interaction.js';
import { frameLabel } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';

const tplOf = (id) => FRAME_DEFS.templates.find((t) => t.id === id);
const T1 = tplOf('template_1'), T7 = tplOf('template_7');
const REGION = { x: 0, y: 0, w: 7, h: 9 };
const BOARDS = [[7, 9], [12, 6], [5.51, 1.97]]; // the three golden sizes used throughout this project

describe('Template 7: listing and declaration', () => {
  it('is listed as "7. Diamond-top Hourglass", reuses the hourglass preset, no new Fusion parameter, 5 bars', () => {
    expect(T7.name).toBe('Template 7 - Diamond-top Hourglass');
    expect(frameLabel(T7)).toBe('7. Diamond-top Hourglass');
    expect(T7.silhouettePreset).toBe('hourglass'); // reused, not a dedicated preset (T3/T4/T5's own precedent)
    // same constraint-toggle set as Template 1 (the sides/waist/hip phases are unchanged)
    expect(T7.params.map((p) => p.name)).toEqual(['widthIn', 'heightIn', 'boundingboxoffset',
      'ck_arc_shoulder_weld', 'ck_arc_hip_weld', 'ck_skel_shoulder_equal', 'ck_skel_waist_equal', 'frame_thickness']);
    expect(T7.regions.miters).toHaveLength(5);
    expect(T7.regions.bars.map((b) => b.name)).toEqual(T7.features[0].bodyNames);
    expect(T7.regions.bars.map((b) => b.name)).toEqual(
      ['frame_roof_right', 'frame_side_right', 'frame_base', 'frame_side_left', 'frame_roof_left']);
    // the ledge is WELDED to the curvy side (same bar), not its own bar: 6 pieces per side now, not 5.
    expect(T7.regions.bars.find((b) => b.name === 'frame_side_right').curves).toEqual(
      ['proj_ledge_R', 'proj_horn_TR', 'proj_arc_shoulder_R', 'proj_arc_waist_R', 'proj_arc_hip_R', 'proj_horn_BR']);
    expect(T7.regions.bars.find((b) => b.name === 'frame_side_left').curves).toEqual(
      ['proj_horn_BL', 'proj_arc_hip_L', 'proj_arc_waist_L', 'proj_arc_shoulder_L', 'proj_horn_TL', 'proj_ledge_L']);
    expect(T7.regions.corners.map((c) => c.id)).toEqual(['peak', 'shoulder_R', 'BR', 'BL', 'shoulder_L']);
    expect(T7.regions.corners.some((c) => c.reflex)).toBe(false); // no inside corner, unlike Template 6's tab
    // the one non-axis-aligned corner: its own Direction is NOT a plain (+-1, +-1) (see p03_03's own doc
    // comment) -- asserted here so a future edit can't silently "fix" it back to the wrong convention.
    const peak = T7.regions.corners.find((c) => c.id === 'peak');
    expect(peak.direction[0]).toBe(0);
    expect(peak.direction[1]).toBeCloseTo(-Math.SQRT2, 9);
  });

  it('Fred\'s approved handle list: shoulder ledge width, waist reach, waist height, hip flare -- the peak stays 90 deg (not a handle)', () => {
    expect(T7.handles.map((h) => h.key)).toEqual(['waistReach', 'waistCenterY', 'shoulderLedgeWidth', 'hipFlare']);
    expect(T7.handles.every((h) => h.binding === 'seeded')).toBe(true); // T7 sends no Fusion parameter of its own
  });

  it('inherits Template 1\'s own FITTED shape model exactly, plus topPeak/shoulderLedge/hipFlare features', () => {
    expect(T7.shapeModel.provisional).toBeFalsy(); // a REAL fit (from Template 1's own goldens), not a stub
    expect(T7.shapeModel.features.cornerR).toEqual(T1.shapeModel.features.cornerR);
    expect(T7.shapeModel.features.depth).toEqual(T1.shapeModel.features.depth);
    expect(T7.shapeModel.features.notch).toEqual(T1.shapeModel.features.notch);
    expect(T7.shapeModel.features.waistCy).toEqual(T1.shapeModel.features.waistCy);
    expect(T7.shapeModel.features.waistR).toEqual(T1.shapeModel.features.waistR);
    expect(T7.shapeModel.features.topPeak).toEqual({ hw: 0, hh: 0 });
    // both carry a real fraction-of-hw default (frame_definition.py's own T7_SHOULDER_LEDGE_DEFAULT_OF_HW /
    // T7_HIP_FLARE_DEFAULT_OF_HW), non-vacuous: neither is the {hw:0,hh:0} presence-only shape topPeak uses.
    expect(T7.shapeModel.features.shoulderLedge.hw).toBeGreaterThan(0);
    expect(T7.shapeModel.features.hipFlare.hw).toBeGreaterThan(0);
  });

  it('the app resolves topPeak=1 through the REAL frame-record pipeline, no seeds needed (no handle of its own)', () => {
    const rec = normalizeFrameRecord({ templateId: 'template_7', seeds: {} });
    const prof = frameCutProfile(FRAME_DEFS, rec, { widthIn: 7, heightIn: 9 });
    expect(prof.primitives).toHaveLength(15); // not 12: this is the REAL, non-vacuous proof topPeak actually turned on
    expect(prof.defects).toEqual([]);
    const inner = frameInnerProfile(FRAME_DEFS, rec, { widthIn: 7, heightIn: 9 });
    expect(inner.primitives).toHaveLength(15);
    // 7, not 5: frameMiters is PURELY GEOMETRIC (any non-collinear line-to-line join), unaware of
    // template_data.py's own 5-bar declaration -- it also draws a corner line at each ledge/horn WELD (a real
    // 90 deg bend in the drawn outline, even though Fusion cuts it as one continuous bar, not a separate
    // mitered joint: see template_data.py's own FRAME_BARS doc comment). 5 real bar-to-bar miters (peak,
    // BR, BL, and the two roof/ledge junctions) + 2 ledge/horn bend lines = 7.
    const miters = frameMiters(prof.primitives, inner.primitives);
    expect(miters).toHaveLength(7);
  });
});

describe('Template 7: the outer profile stays within the board (Fred, 2026-09-30: "the frame\'s outer profile must equal the board outline")', () => {
  it.each(BOARDS)('at %d x %d in, every sampled outline point is inside [0,W]x[0,H]', (W, H) => {
    const rec = normalizeFrameRecord({ templateId: 'template_7', seeds: {} });
    const prof = frameCutProfile(FRAME_DEFS, rec, { widthIn: W, heightIn: H });
    expect(prof.defects).toEqual([]);
    expect(prof.polygon.length).toBeGreaterThan(0); // non-vacuous: real sampled points, not an empty outline
    for (const p of prof.polygon) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-6);
      expect(p.x).toBeLessThanOrEqual(W + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(-1e-6);
      expect(p.y).toBeLessThanOrEqual(H + 1e-6);
    }
  });

  it('MEASURED regression: the peak sits ON the safe zone\'s own top edge, not above it (the bug Fred saw live)', () => {
    const rec = normalizeFrameRecord({ templateId: 'template_7', seeds: {} });
    for (const [W, H] of BOARDS) {
      const prof = frameCutProfile(FRAME_DEFS, rec, { widthIn: W, heightIn: H });
      const peakY = Math.min(...prof.polygon.map((p) => p.y));
      expect(peakY).toBeCloseTo(prof.region.y, 6); // exactly the safe zone's own top edge, never above it
    }
  });

  it('MEASURED regression: the hip flare is capped at the boundingboxoffset margin, never past the true board edge', () => {
    const rec = normalizeFrameRecord({ templateId: 'template_7', seeds: {} });
    const prof = frameCutProfile(FRAME_DEFS, rec, { widthIn: 7, heightIn: 9 });
    const maxX = Math.max(...prof.polygon.map((p) => p.x));
    const minX = Math.min(...prof.polygon.map((p) => p.x));
    expect(maxX).toBeLessThanOrEqual(7 + 1e-6);
    expect(minX).toBeGreaterThanOrEqual(0 - 1e-6);
    // non-vacuous: the hip DOES flare past the safe zone's own edge (region.x + region.w), just not past the board
    expect(maxX).toBeGreaterThan(prof.region.x + prof.region.w);
  });
});

describe('Template 7: the 90 deg peak geometry (independent re-derivation, not re-trusting the generator)', () => {
  it('15 primitives; the shoulder/waist/hip arcs and the bottom anatomy (1-9) are BIT FOR BIT what topPeak=0 (plain Template 1) draws -- only the TOP HORNS\' own length differs', () => {
    // the top horns' own length is now COUPLED to the roof's own rise (peak pinned to the board's own top
    // edge, _solveHourglass's own `topEdgeY`), so primitives 0/10 (the top horns themselves) are NOT bit for
    // bit any more -- only their SHOULDER-side endpoint (shared with the shoulder arc) is unaffected.
    const on = generateSilhouette(REGION, { preset: 'hourglass', seed: 42, params: { topPeak: 1, shoulderLedgeWidth: 0.35 } });
    const off = generateSilhouette(REGION, { preset: 'hourglass', seed: 42, params: { topPeak: 0 } });
    expect(on.primitives).toHaveLength(15);
    expect(off.primitives).toHaveLength(12);
    for (let i = 1; i <= 9; i++) expect(on.primitives[i]).toEqual(off.primitives[i]);
    expect(on.primitives[0].p1).toEqual(off.primitives[0].p1); // the shoulder-side end of the right horn
    expect(on.primitives[10].p0).toEqual(off.primitives[10].p0); // the shoulder-side end of the left horn
    expect(on.primitives[0].p0).not.toEqual(off.primitives[0].p0); // but the horn's own TOP end moved
  });

  it('topPeak defaults to 0 (unset): a Shape Lattice pattern and Template 1 itself draw the exact same flat top they always did', () => {
    const noKey = generateSilhouette(REGION, { preset: 'hourglass', seed: 42 });
    const explicitOff = generateSilhouette(REGION, { preset: 'hourglass', seed: 42, params: { topPeak: 0 } });
    expect(noKey.primitives).toEqual(explicitOff.primitives);
    expect(noKey.primitives).toHaveLength(12);
    expect(noKey.params.topPeak).toBeUndefined(); // frame-only: never reported unless the caller set it
  });

  it('a REAL 90 deg apex: independent check via the two roof lines\' own direction vectors (dot product ~ 0), not the formula that built them', () => {
    const sil = generateSilhouette(REGION, { preset: 'hourglass', seed: 42, params: { topPeak: 1, shoulderLedgeWidth: 0.35 } });
    const roofL = sil.primitives[12], roofR = sil.primitives[13]; // ledgeInnerL->peak, peak->ledgeInnerR
    const peak = roofL.p1;
    expect(roofR.p0).toEqual(peak); // the two roof lines genuinely share one point (the apex)
    const dL = { x: roofL.p0.x - peak.x, y: roofL.p0.y - peak.y }; // peak -> ledgeInnerL
    const dR = { x: roofR.p1.x - peak.x, y: roofR.p1.y - peak.y }; // peak -> ledgeInnerR
    const dot = dL.x * dR.x + dL.y * dR.y;
    const nL = Math.hypot(dL.x, dL.y), nR = Math.hypot(dR.x, dR.y);
    expect(nL).toBeGreaterThan(0); expect(nR).toBeGreaterThan(0); // non-vacuous: real, non-zero-length legs
    expect(dot / (nL * nR)).toBeCloseTo(0, 9); // cos(90 deg) = 0
    expect(nL).toBeCloseTo(nR, 9); // symmetric: the two roof lines are the same length
  });

  it('the peak sits exactly on the centre line, for an asymmetric region origin too', () => {
    const region2 = { x: 2, y: -3, w: 7, h: 9 };
    const sil = generateSilhouette(region2, { preset: 'hourglass', seed: 42, params: { topPeak: 1 } });
    expect(sil.primitives[13].p0.x).toBeCloseTo(region2.x + region2.w / 2, 9);
  });

  it('MEASURED, not assumed: the peak sits exactly at the region\'s own top edge (-hhDrawn), regardless of `hh` -- the fix for the board-overflow bug Fred saw live', () => {
    for (const h of [9, 16, 30]) {
      const region = { x: 0, y: 0, w: 7, h };
      const sil = generateSilhouette(region, { preset: 'hourglass', seed: 42, params: { topPeak: 1 } });
      const peakY = sil.primitives[13].p0.y;
      expect(peakY).toBeCloseTo(region.y, 9); // ON the top edge, never above it (region.y is world y=0 here)
    }
  });

  it('a wider ledge shrinks the roof\'s own rise (less headroom eaten from the horn), a narrower ledge grows it', () => {
    const rise = (ledge) => {
      const sil = generateSilhouette(REGION, { preset: 'hourglass', seed: 42, params: { topPeak: 1, shoulderLedgeWidth: ledge } });
      const peak = sil.primitives[13].p0, ledgeInnerR = sil.primitives[13].p1;
      return ledgeInnerR.y - peak.y; // Y-down: the peak sits ABOVE (smaller y than) the ledge -- a positive drop
    };
    const riseNarrow = rise(0.3), riseWide = rise(0.6);
    expect(riseWide).toBeLessThan(riseNarrow);
    expect(riseWide).toBeGreaterThan(0); // non-vacuous: still a real, positive rise
  });
});

describe('Template 7: hip flare (reference sketch: hips that FLARE OUTWARD to a wider base)', () => {
  // a realistic margin (region.x/y > 0, matching frameCutProfile's own `{x: bbo, y: bbo, ...}`): hipFlare's
  // own range is capped at that margin (the board-edge cap, editor-shape-lattice-generator.js's own doc
  // comment on the `hipFlare` range branch), so REGION's own x=0 would clamp any flare away to nothing.
  const MARGINED_REGION = { x: 0.25, y: 0.25, w: 6.5, h: 8.5 };
  it('a nonzero hipFlare widens the bottom horns/base past the top horns\' own half-width', () => {
    const off = generateSilhouette(MARGINED_REGION, { preset: 'hourglass', seed: 42, params: { topPeak: 1, hipFlare: 0 } });
    const on = generateSilhouette(MARGINED_REGION, { preset: 'hourglass', seed: 42, params: { topPeak: 1, hipFlare: 0.1 } });
    const bottomEdgeOff = off.primitives[5], bottomEdgeOn = on.primitives[5]; // rBottom -> lBottom
    const widthOff = Math.abs(bottomEdgeOff.p1.x - bottomEdgeOff.p0.x);
    const widthOn = Math.abs(bottomEdgeOn.p1.x - bottomEdgeOn.p0.x);
    expect(widthOn).toBeGreaterThan(widthOff);
    // the TOP horns' own half-width is untouched by hipFlare (only the bottom widens)
    expect(off.primitives[0].p0.x).toBeCloseTo(on.primitives[0].p0.x, 9);
  });

  it('hipFlare defaults to 0 (unset): Templates 1-6 (and T7 with hipFlare unset) draw Template 1\'s own symmetric hip, bit for bit', () => {
    const noKey = generateSilhouette(REGION, { preset: 'hourglass', seed: 42 });
    const explicitOff = generateSilhouette(REGION, { preset: 'hourglass', seed: 42, params: { hipFlare: 0 } });
    expect(noKey.primitives).toEqual(explicitOff.primitives);
  });
});

describe('Template 7: mirror table + handle highlighting', () => {
  it('topPeakMirrorIndex: sides unchanged (0..10 as Template 1), the ledge/roof pairs swap (11<->14, 12<->13), no self-mirrored piece', () => {
    for (let i = 0; i <= 10; i++) expect(topPeakMirrorIndex(i)).toBe(10 - i);
    expect(topPeakMirrorIndex(11)).toBe(14);
    expect(topPeakMirrorIndex(12)).toBe(13);
    expect(topPeakMirrorIndex(13)).toBe(12);
    expect(topPeakMirrorIndex(14)).toBe(11);
  });

  it('an existing handle (e.g. waistReach) still highlights the correct mirrored pair at n=15, not the generic (wrong) mirrorSegmentIndex(i,15)', () => {
    const i = HANDLE_SEGMENT_INDEX.hourglass.waistReach;
    const got = controlledSegments('hourglass', 'waistReach', TOP_PEAK_SEGMENT_COUNT);
    expect(got).toEqual([i, topPeakMirrorIndex(i)].sort((a, b) => a - b));
  });

  it('shoulderLedgeWidth and hipFlare each highlight a real, distinct mirrored pair', () => {
    for (const key of ['shoulderLedgeWidth', 'hipFlare']) {
      const i = HANDLE_SEGMENT_INDEX.hourglass[key];
      expect(i).not.toBeUndefined();
      const got = controlledSegments('hourglass', key, TOP_PEAK_SEGMENT_COUNT).sort((a, b) => a - b);
      expect(got).toEqual([i, topPeakMirrorIndex(i)].sort((a, b) => a - b));
    }
  });
});

describe('Template 7: frame-only params, never user-facing', () => {
  it('topPeak/shoulderLedgeWidth/hipFlare are declared frame-only and appended in order (every earlier key keeps its own index)', () => {
    for (const key of ['topPeak', 'shoulderLedgeWidth', 'hipFlare']) expect(FRAME_ONLY_PARAM_KEYS).toContain(key);
    expect(PARAM_ORDER.hourglass.slice(-3)).toEqual(['topPeak', 'shoulderLedgeWidth', 'hipFlare']);
    expect(SHAPE_PARAM_KEYS.hourglass).not.toContain('topPeak');
    expect(SHAPE_PARAM_KEYS.hourglass).not.toContain('shoulderLedgeWidth'); // never a Shape Lattice slider
    expect(SHAPE_PARAM_KEYS.hourglass).not.toContain('hipFlare');
  });
});

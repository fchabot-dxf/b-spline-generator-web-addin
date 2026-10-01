/**
 * F21/F26 CONTOUR-FROM-FRAME: the Shape Lattice contour as the frame's OUTER edge offset by Distance
 * (editor/contour-from-frame.js), the ONE source for the drawn contour, its fill clip and the Fusion manifest.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameInnerProfile, frameCutProfile } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import {
  contourSilhouette, frameContourSilhouette, contourFromFrameOf, CONTOUR_FROM_FRAME_DEFAULTS,
  frameWindowGeometry, frameWindowHoleLoop,
} from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { insetWindowGeometry, rectToPrimitives } from '../bspline-frame-builder/b-spline-gen/html/core/inset-window.js';
import { generateContourSilhouette, outlineDefects } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import { PATTERN_DEFAULTS, computePattern } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { buildSketchManifest, latticeExtentFor } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-sketch-manifest.js';
import { boardRegion } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-interaction.js';
import { sizedBoardRegion } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-boundary.js';
import { sampleOutline, pointInPolygon } from '../bspline-frame-builder/b-spline-gen/html/core/preview/frame-mesh.js';

const SW = 0.07;
const frameOf = (templateId, W, H, extra = {}) => ({
  defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId, ...extra }), board: { widthIn: W, heightIn: H },
});
/** Points along a primitive loop (lines: 20 each, arcs: 40 each). */
function samples(prims) {
  const out = [];
  for (const p of prims) {
    if (p.collapsed) continue;
    if (p.type === 'L') for (let k = 0; k <= 20; k++) out.push({ x: p.p0.x + (p.p1.x - p.p0.x) * k / 20, y: p.p0.y + (p.p1.y - p.p0.y) * k / 20 });
    else for (let k = 0; k <= 40; k++) { const th = p.theta1 + p.dTheta * k / 40; out.push({ x: p.cx + p.rx * Math.cos(th), y: p.cy + p.rx * Math.sin(th) }); }
  }
  return out;
}
/** Exact distance from a point to a primitive loop (lines + circular arcs). */
function distTo(q, prims) {
  let best = Infinity;
  for (const p of prims) {
    if (p.collapsed) continue;
    if (p.type === 'L') {
      const dx = p.p1.x - p.p0.x, dy = p.p1.y - p.p0.y, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, ((q.x - p.p0.x) * dx + (q.y - p.p0.y) * dy) / L2)) : 0;
      best = Math.min(best, Math.hypot(p.p0.x + t * dx - q.x, p.p0.y + t * dy - q.y));
    } else {
      let rel = Math.atan2(q.y - p.cy, q.x - p.cx) - p.theta1;
      rel -= 2 * Math.PI * Math.floor((rel + Math.PI) / (2 * Math.PI));
      const on = p.dTheta >= 0 ? rel >= 0 && rel <= p.dTheta : rel <= 0 && rel >= p.dTheta;
      if (on) best = Math.min(best, Math.abs(Math.hypot(q.x - p.cx, q.y - p.cy) - p.rx));
      else for (const th of [p.theta1, p.theta1 + p.dTheta]) best = Math.min(best, Math.hypot(p.cx + p.rx * Math.cos(th) - q.x, p.cy + p.rx * Math.sin(th) - q.y));
    }
  }
  return best;
}

/** T6 TAB TOP: the outline's INSIDE (reflex) corners -- line-line joints turning against the loop's own turn. An offset
 *  corner there is the two offset lines' meeting point (Fusion's sharp offset), sqrt(2) x the offset from the reflex
 *  vertex, not the offset itself; the exact-distance checks skip the few samples that near. None on Templates 1-5. */
function reflexVertices(prims) {
  const n = prims.length, pts = prims.map((p) => (p.type === 'L' ? p.p0 : null));
  let area = 0;
  const loop = sampleOutline(prims);
  for (let i = 0; i < loop.length; i++) { const a = loop[i], b = loop[(i + 1) % loop.length]; area += a.x * b.y - b.x * a.y; }
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = prims[(i - 1 + n) % n], b = prims[i];
    if (a.type !== 'L' || b.type !== 'L') continue;
    const cr = (a.p1.x - a.p0.x) * (b.p1.y - b.p0.y) - (a.p1.y - a.p0.y) * (b.p1.x - b.p0.x);
    if (Math.abs(cr) > 1e-12 && Math.sign(cr) !== Math.sign(area)) out.push(pts[i]);
  }
  return out;
}
const nearAny = (q, vs, r) => vs.some((v) => Math.hypot(q.x - v.x, q.y - v.y) < r);

describe('the frame-offset contour == the frame OUTER edge offset by Distance (to its outside edge) -- F26', () => {
  const CASES = [];
  for (const id of ['template_1', 'template_2', 'template_3', 'template_4', 'template_5', 'template_6']) for (const [W, H] of [[7, 9], [12, 6], [9, 12]]) for (const d of [0.1, 0.25, 0.5]) CASES.push([id, W, H, d]);
  it.each(CASES)('%s %sx%s, distance %s', (id, W, H, d) => {
    const frame = frameOf(id, W, H);
    const sil = frameContourSilhouette(frame, d, SW);
    expect(sil.error).toBeUndefined();
    // F26: the reference is the frame's OUTER edge (its cut profile), not the inner edge -- a positive
    // distance still moves the contour INWARD (unchanged direction), just measured from a different origin.
    const outer = frameCutProfile(frame.defs, frame.record, frame.board).primitives;
    // every centerline point sits EXACTLY d + stroke/2 from the frame's outer edge (a concentric offset);
    // at a merged corner a point may only be FARTHER (the corner cuts inside the collapsed arc)
    const ds = samples(sil.primitives).map((q) => distTo(q, outer));
    for (const v of ds) expect(v).toBeGreaterThan(d + SW / 2 - 2e-3);
    const reflex = reflexVertices(outer);
    const onLines = sil.primitives.filter((p) => p.type === 'L').flatMap((p) => samples([p])).filter((q) => !nearAny(q, reflex, 1.5 * (d + SW / 2)));
    for (const q of onLines) expect(Math.abs(distTo(q, outer) - (d + SW / 2))).toBeLessThan(2e-3);
    // validity: simple, positive radii; tangent everywhere except the declared merged corners
    expect(outlineDefects(sil.primitives, { requireTangency: false })).toEqual([]);
    expect(outlineDefects(sil.primitives).filter((x) => !(x.kind === 'notTangent' && sil.corners.includes(x.index)))).toEqual([]);
    // the OUTSIDE region = the centerline's extent + half a stroke
    const pts = samples(sil.primitives), xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
    expect(sil.region.w).toBeCloseTo(Math.max(...xs) - Math.min(...xs) + SW, 2);
    expect(sil.region.h).toBeCloseTo(Math.max(...ys) - Math.min(...ys) + SW, 2);
  });

  it('a corner arc smaller than the offset merges into a corner: fewer segments, the corner declared (Fred: "just less segments")', () => {
    // F26: the offset is now measured from the OUTER edge directly, so a distance needs to be roughly
    // `old distance + frame_thickness` (T1's own default 0.75) to collapse the SAME corner arc as before.
    const sil = frameContourSilhouette(frameOf('template_1', 7, 9), 1.0, SW);
    expect(sil.primitives.length).toBeLessThan(12); // T1's outline has 12 pieces
    expect(sil.corners.length).toBeGreaterThan(0);
    expect(sil.segments).toHaveLength(sil.primitives.length);
  });

  it('follows the frame: a Shoulder seed and a Trim offset change each move the contour', () => {
    const base = frameContourSilhouette(frameOf('template_1', 9, 12), 0.25, SW).primitives;
    for (const extra of [{ seeds: { cornerRadiusTop: 0.5 } }, { params: { boundingboxoffset: 0.6 } }]) {
      const moved = frameContourSilhouette(frameOf('template_1', 9, 12, extra), 0.25, SW).primitives;
      expect(JSON.stringify(moved)).not.toBe(JSON.stringify(base));
    }
  });

  it('F26: frame_thickness alone does NOT move an outer-edge-referenced contour (it only ever affected the OLD inner-edge reference)', () => {
    // MEASURED, not assumed: frameCutProfile's own construction (region = boundingboxoffset + the shape
    // params) never reads frame_thickness at all, so the outer edge -- and therefore this contour -- is
    // thickness-independent by construction. Proving it directly, not inferring it from the formula.
    const base = frameContourSilhouette(frameOf('template_1', 9, 12), 0.25, SW).primitives;
    const moved = frameContourSilhouette(frameOf('template_1', 9, 12, { params: { frame_thickness: 0.5 } }), 0.25, SW).primitives;
    expect(JSON.stringify(moved)).toBe(JSON.stringify(base));
  });
});

/**
 * F26 (Fred, screenshot: "offset from frame at 0 is clamped to the inside of frame rather than outside, and
 * doesn't accept negative value"): distance 0 sits ON the frame's outer edge; negative distances offset
 * OUTWARD of it (accepted everywhere, not clamped away). MEASURED at the checklist's own 0 / +0.5 / -0.25.
 */
describe('F26: distance is measured from the OUTER edge, negatives offset outward', () => {
  it.each(['template_1', 'template_2', 'template_3', 'template_4', 'template_5', 'template_6'])('%s: distance 0 sits exactly on the outer edge (stroke/2 in)', (id) => {
    const frame = frameOf(id, 9, 12);
    const sil = frameContourSilhouette(frame, 0, SW);
    expect(sil.error).toBeUndefined();
    const outer = frameCutProfile(frame.defs, frame.record, frame.board).primitives, reflex = reflexVertices(outer);
    for (const q of samples(sil.primitives).filter((q) => !nearAny(q, reflex, 1.5 * SW / 2))) expect(Math.abs(distTo(q, outer) - SW / 2)).toBeLessThan(2e-3);
  });

  // Only the MIDDLE of each straight segment, not its own ends: an outward offset (F26, new) makes a line
  // GROW past its original endpoints into the corner region (the arc there grows too, MEASURED: T1 9x12's
  // corner radius 0.8423 -> 1.0573 at -0.25), so a sample near a line's own end can have a genuinely
  // DIFFERENT nearest point on the outer outline (the corner's own arc or corner point, not "the same line
  // shifted") -- a real geometric fact about offsetting outward, not a test tolerance problem. An inward
  // offset (the existing "distance N" sweep above) never hits this: a line SHRINKS inward, so its ends stay
  // safely within its own corresponding original line's span.
  const midOfLine = (p) => Array.from({ length: 5 }, (_, k) => {
    const t = 0.4 + 0.05 * k; // the middle 20% of the line's own span
    return { x: p.p0.x + (p.p1.x - p.p0.x) * t, y: p.p0.y + (p.p1.y - p.p0.y) * t };
  });

  it.each(['template_1', 'template_2', 'template_3', 'template_4', 'template_5', 'template_6'])('%s: distance +0.5 sits 0.5 + stroke/2 INSIDE the outer edge (unchanged direction from before F26)', (id) => {
    const frame = frameOf(id, 9, 12);
    const sil = frameContourSilhouette(frame, 0.5, SW);
    expect(sil.error).toBeUndefined();
    const outer = frameCutProfile(frame.defs, frame.record, frame.board).primitives;
    for (const v of samples(sil.primitives).map((q) => distTo(q, outer))) expect(v).toBeGreaterThan(0.5 + SW / 2 - 2e-3);
    const midLines = sil.primitives.filter((p) => p.type === 'L').flatMap(midOfLine);
    for (const q of midLines) expect(Math.abs(distTo(q, outer) - (0.5 + SW / 2))).toBeLessThan(2e-3);
  });

  it.each(['template_1', 'template_2', 'template_3', 'template_4', 'template_5', 'template_6'])('%s: distance -0.25 (NEW: negative is accepted, not clamped to the default) sits 0.25 - stroke/2 OUTSIDE the outer edge', (id) => {
    const frame = frameOf(id, 9, 12);
    const sil = frameContourSilhouette(frame, -0.25, SW);
    expect(sil.error).toBeUndefined();
    const outer = frameCutProfile(frame.defs, frame.record, frame.board).primitives;
    // PROVEN outside, not assumed: every centerline point must be OUTSIDE the frame's own outer polygon
    // (the SAME sampleOutline/pointInPolygon the implementation's own validity check reads).
    const outlinePts = sampleOutline(outer);
    for (const q of samples(sil.primitives)) expect(pointInPolygon(q.x, q.y, outlinePts)).toBe(false);
    const midLines = sil.primitives.filter((p) => p.type === 'L').flatMap(midOfLine);
    for (const q of midLines) expect(Math.abs(distTo(q, outer) - (0.25 - SW / 2))).toBeLessThan(2e-3);
  });

  it('contourFromFrameOf no longer clamps a negative distance to the default (was: silently forced to 0.25)', () => {
    expect(contourFromFrameOf({ contour: { fromFrame: { on: true, distance: -0.25 } } }).distance).toBe(-0.25);
    expect(contourFromFrameOf({ contour: { fromFrame: { on: true, distance: 0 } } }).distance).toBe(0);
    // still falls back on a genuinely non-finite value (NaN, a broken save), not on sign
    expect(contourFromFrameOf({ contour: { fromFrame: { on: true, distance: 'x' } } }).distance).toBe(CONTOUR_FROM_FRAME_DEFAULTS.distance);
  });
});

describe('the toggle, the default, the fallbacks', () => {
  const region = sizedBoardRegion(boardRegion({ _mW: 7, _mH: 9 }), null);
  const pattern = (fromFrame) => ({ shape: { ...PATTERN_DEFAULTS.shape }, contour: { ...PATTERN_DEFAULTS.contour, ...(fromFrame ? { fromFrame } : {}) } });

  it('old patterns (no key) are OFF; the declared default is off, 0.25 in from the outer edge (F26)', () => {
    expect(PATTERN_DEFAULTS.contour.fromFrame).toEqual({ on: false, distance: 0, distanceRef: 'outer' });
    expect(CONTOUR_FROM_FRAME_DEFAULTS).toEqual({ on: false, distance: 0, distanceRef: 'outer' });
    // contourFromFrameOf's own return shape is unchanged (on/distance only) -- distanceRef is the
    // MIGRATION's own concern (app-init.js), not a runtime reader's.
    expect(contourFromFrameOf({ contour: { show: true } })).toEqual({ on: false, distance: 0 });
    expect(contourFromFrameOf({})).toEqual({ on: false, distance: 0 });
  });

  it('OFF = exactly the preset contour (even with a frame chosen), and ON never touches the preset shape', () => {
    const p = pattern({ on: false, distance: 0.25 });
    const shapeBefore = JSON.stringify(p.shape);
    expect(contourSilhouette(p, region, SW, frameOf('template_1', 7, 9)).primitives)
      .toEqual(generateContourSilhouette(region, p.shape, SW).primitives);
    const on = pattern({ on: true, distance: 0.25 });
    expect(contourSilhouette(on, region, SW, frameOf('template_1', 7, 9)).fromFrame).toBe(true);
    expect(JSON.stringify(on.shape)).toBe(shapeBefore);
  });

  it('ON without a frame (or a distance leaving no loop): the preset is drawn and the reason is given', () => {
    const on = pattern({ on: true, distance: 0.25 });
    const none = contourSilhouette(on, region, SW, null);
    expect(none.fromFrameError).toBe('noFrame');
    expect(none.primitives).toEqual(generateContourSilhouette(region, on.shape, SW).primitives);
    const huge = contourSilhouette(pattern({ on: true, distance: 4 }), region, SW, frameOf('template_1', 7, 9));
    expect(huge.fromFrameError).toBeDefined();
  });
});

describe('Send: the manifest contour and its fill clip read the SAME frame-offset contour', () => {
  const W = 9, H = 12;
  const frame = frameOf('template_1', W, H);
  const p = {
    ...JSON.parse(JSON.stringify(PATTERN_DEFAULTS)),
    extent: { mode: 'boundary' },
    contour: { ...PATTERN_DEFAULTS.contour, fromFrame: { on: true, distance: 0.25 } },
  };
  p.shape.source = 'generated';
  const region = boardRegion({ _mW: W, _mH: H });

  it('one contour slot per kept piece; no Tangent at a merged corner; contour_width = the outside width; the fill clips to it', () => {
    const sil = frameContourSilhouette(frame, 0.25, PATTERN_DEFAULTS.widths.rails);
    const m = buildSketchManifest(p, region, { frame });
    const seg = m.entities.filter((e) => /^seg/.test(e.id));
    expect(seg).toHaveLength(sil.primitives.length);
    const tangents = m.constraints.filter((c) => c.type === 'Tangent' && c.targets.every((t) => /^seg/.test(t)));
    for (const k of sil.corners) {
      const a = `seg${k}`, b = `seg${(k + 1) % sil.primitives.length}`;
      expect(tangents.some((c) => c.targets.includes(a) && c.targets.includes(b))).toBe(false);
    }
    const cw = m.parameters.find((q) => q.name === 'contour_width');
    if (cw) expect(cw.value).toBeCloseTo(sil.region.w, 9);
    // the fill extent is built from the frame-offset contour, not the preset
    const withFrame = latticeExtentFor(p, region, frame), preset = latticeExtentFor(p, region, null);
    expect(JSON.stringify(withFrame.primitives)).not.toBe(JSON.stringify(preset.primitives));
    // no preset shape parameter reaches Fusion for a frame-driven contour
    expect(m.parameters.map((q) => q.name)).not.toContain('waist_reach');
  });

  it('the Send fill follows the frame-offset contour: its rails differ from the preset contour\'s', () => {
    const off = { ...p, contour: { ...p.contour, fromFrame: { on: false, distance: 0.25 } } };
    const rails = (m) => JSON.stringify(m.entities.filter((e) => /^rail/.test(e.id)));
    const onRails = rails(buildSketchManifest(p, region, { frame }));
    expect(onRails.length).toBeGreaterThan(2); // non-vacuous: the fill produced rails
    expect(onRails).not.toBe(rails(buildSketchManifest(off, region, { frame })));
  });

  it('OFF: the manifest is byte-identical with or without a frame passed', () => {
    const off = { ...p, contour: { ...p.contour, fromFrame: { on: false, distance: 0.25 } } };
    expect(JSON.stringify(buildSketchManifest(off, region, { frame }))).toBe(JSON.stringify(buildSketchManifest(off, region, {})));
  });
});

/**
 * T82 item 2 (INSET-WINDOW-DESIGN.md): the frame's own inset window, as the Shape Lattice pattern generator
 * and the Fusion fill extent need it. inset-window.js's own insetWindowGeometry/rectContains are covered in
 * tests/inset-window.test.js; this covers the frame-thickness WIRING (frameWindowGeometry/frameWindowHoleLoop)
 * and the fromFrame-gated hole exclusion in the Fusion/manifest fill path (resolveShapeBoundaryExtent via
 * latticeExtentFor) -- the app-side DOM path (_resolveBoundaryPrimitives, editor-lattice-pattern.js) shares
 * the identical helper and gate, a two-line difference from the manifest path proven here.
 */
describe('T82 item 2: frameWindowGeometry / frameWindowHoleLoop', () => {
  it('null with no frame, no window, or a disabled window (the default)', () => {
    expect(frameWindowGeometry(null)).toBeNull();
    expect(frameWindowHoleLoop(null)).toBeNull();
    expect(frameWindowGeometry(frameOf('template_1', 9, 12))).toBeNull(); // normalizeFrameRecord's own default: disabled
  });

  it('resolves the SAME frame_thickness frameContourSilhouette itself uses (record override, else the template default)', () => {
    const win = { enabled: true, x1: 2, y1: 2, x2: 6, y2: 6 };
    const frame = frameOf('template_1', 9, 12, { insetWindow: win });
    const tpl = FRAME_DEFS.templates.find((t) => t.id === 'template_1');
    const ft = tpl.params.find((p) => p.name === 'frame_thickness').default;
    expect(frameWindowGeometry(frame)).toEqual(insetWindowGeometry(frame.record, ft, frame.record.panelLip));

    const overridden = frameOf('template_1', 9, 12, { insetWindow: win, params: { frame_thickness: ft + 0.2 } });
    const g = frameWindowGeometry(overridden);
    expect(g).toEqual(insetWindowGeometry(overridden.record, ft + 0.2, overridden.record.panelLip));
    // non-vacuous: the override actually moves the inner/hole rectangles vs the default thickness
    expect(g.inner).not.toEqual(frameWindowGeometry(frame).inner);
  });

  it('frameWindowHoleLoop is the hole rectangle as a closed 4-line loop, matching rectToPrimitives directly', () => {
    const win = { enabled: true, x1: 2, y1: 2, x2: 6, y2: 6 };
    const frame = frameOf('template_1', 9, 12, { insetWindow: win });
    const geom = frameWindowGeometry(frame);
    expect(frameWindowHoleLoop(frame)).toEqual(rectToPrimitives(geom.hole));
  });

  it('below insetWindowGeometry\'s own validity floor (window bars <= 2*frame_thickness): null, not a degenerate loop', () => {
    const frame = frameOf('template_1', 9, 12, { insetWindow: { enabled: true, x1: 0, y1: 0, x2: 1, y2: 1 } });
    expect(frameWindowGeometry(frame)).toBeNull();
    expect(frameWindowHoleLoop(frame)).toBeNull();
  });
});

describe('T82 item 2: the Fusion fill extent (resolveShapeBoundaryExtent via latticeExtentFor) skips the inset window, gated on fromFrame', () => {
  const W = 9, H = 12;
  const win = { enabled: true, x1: 3, y1: 4, x2: 6, y2: 8 };
  const frame = frameOf('template_1', W, H, { insetWindow: win });
  const region = boardRegion({ _mW: W, _mH: H });
  const spacing = PATTERN_DEFAULTS.spacing;
  const basePattern = (fromFrameOn) => ({
    ...JSON.parse(JSON.stringify(PATTERN_DEFAULTS)),
    shape: { ...PATTERN_DEFAULTS.shape, source: 'generated' },
    extent: { mode: 'boundary' },
    contour: { ...PATTERN_DEFAULTS.contour, fromFrame: { on: fromFrameOn, distance: 0.25 } },
  });

  it('fromFrame ON: the extent\'s primitives include the window\'s own hole loop, scaled to lattice units', () => {
    const extent = latticeExtentFor(basePattern(true), region, frame);
    const holeLatticeLoop = frameWindowHoleLoop(frame).map((pr) => ({
      type: 'L', p0: { x: pr.p0.x / spacing, y: pr.p0.y / spacing }, p1: { x: pr.p1.x / spacing, y: pr.p1.y / spacing },
    }));
    for (const seg of holeLatticeLoop) {
      expect(extent.primitives.some((p) => p.type === 'L'
        && Math.abs(p.p0.x - seg.p0.x) < 1e-9 && Math.abs(p.p0.y - seg.p0.y) < 1e-9
        && Math.abs(p.p1.x - seg.p1.x) < 1e-9 && Math.abs(p.p1.y - seg.p1.y) < 1e-9)).toBe(true);
    }
  });

  it('fromFrame OFF: byte-identical to before T82 item 2 -- the window is never appended even though the record has one', () => {
    const extentOn = latticeExtentFor(basePattern(true), region, frame);
    const extentOff = latticeExtentFor(basePattern(false), region, frame);
    // non-vacuous: ON really did add exactly the hole's 4 line primitives vs OFF
    expect(extentOn.primitives.length).toBe(extentOff.primitives.length + 4);
    expect(extentOff.primitives).toEqual(latticeExtentFor(basePattern(false), region, null).primitives);
  });

  it('fromFrame ON but no window on the record: unaffected (same primitives as a frame with no insetWindow at all)', () => {
    const plainFrame = frameOf('template_1', W, H);
    const withDisabledWindow = frameOf('template_1', W, H, { insetWindow: { ...win, enabled: false } });
    expect(latticeExtentFor(basePattern(true), region, withDisabledWindow).primitives)
      .toEqual(latticeExtentFor(basePattern(true), region, plainFrame).primitives);
  });
});

describe('T82 item 2: end to end -- a rail row crossing the window is split into two pieces at the hole\'s own edges', () => {
  it('MEASURED: the row at board y=6 (inside the window) emits two rail segments, clipped exactly to the hole', () => {
    const W = 12, H = 16;
    const win = { x1: 5, y1: 5, x2: 7, y2: 7 }; // a small window near board center, away from template_1's own waist pinch
    const frame = frameOf('template_1', W, H, { insetWindow: { enabled: true, ...win } });
    const region = boardRegion({ _mW: W, _mH: H });
    const spacing = PATTERN_DEFAULTS.spacing;
    const pattern = {
      ...JSON.parse(JSON.stringify(PATTERN_DEFAULTS)),
      shape: { ...PATTERN_DEFAULTS.shape, source: 'generated' },
      extent: { mode: 'boundary' },
      contour: { ...PATTERN_DEFAULTS.contour, fromFrame: { on: true, distance: 0.25 } },
      rails: { every: 1, offset: 0 },
      ties: { ...PATTERN_DEFAULTS.ties, mode: 'density', density: 0 },
      boundary: { ...PATTERN_DEFAULTS.boundary, endRule: 'on-boundary' },
    };

    // Precondition, MEASURED not assumed: all 4 window corners must sit strictly inside the frame-offset
    // contour, or the frame's own outline -- not the window -- would be doing any clipping seen below.
    const sil = frameContourSilhouette(frame, 0.25, PATTERN_DEFAULTS.widths.rails);
    expect(sil.error).toBeUndefined();
    const outline = sampleOutline(sil.primitives);
    for (const [x, y] of [[win.x1, win.y1], [win.x2, win.y1], [win.x2, win.y2], [win.x1, win.y2]]) {
      expect(pointInPolygon(x, y, outline)).toBe(true);
    }

    // The actual exclusion boundary is the window's own HOLE (outer rect offset inward by frame_thickness,
    // then panelLip) per insetWindowGeometry, not the raw outer x1/y1/x2/y2 the record declares -- read back
    // the real computed hole rather than assuming it equals the outer rect.
    const hole = frameWindowGeometry(frame).hole;
    expect(hole.y1).toBeLessThan(6);
    expect(hole.y2).toBeGreaterThan(6); // precondition: board y=6 really does fall inside the computed hole

    const extent = latticeExtentFor(pattern, region, frame);
    const { segments } = computePattern(pattern, { extent });
    const j = Math.round(6 / spacing); // board y=6, inside the hole's own y-range
    const rowSegs = segments.filter((s) => s.kind === 'rail' && s.a.j === j);

    expect(rowSegs).toHaveLength(2); // split by the hole, not one continuous rail
    const sorted = rowSegs.slice().sort((a, b) => a.a.i - b.a.i);
    expect(sorted[0].b.i).toBeCloseTo(hole.x1 / spacing, 6); // left piece ends exactly at the hole's left edge
    expect(sorted[1].a.i).toBeCloseTo(hole.x2 / spacing, 6); // right piece starts exactly at the hole's right edge

    // Sanity (non-vacuous): the IDENTICAL pattern/contour (fromFrame still ON) against a frame with no
    // window at all gives ONE unbroken rail at this same row -- isolates the split above to the window,
    // not to some other difference between the two calls.
    const plainFrame = frameOf('template_1', W, H); // no insetWindow key -> normalizeFrameRecord's own default: disabled
    const plainExtent = latticeExtentFor(pattern, region, plainFrame);
    const { segments: plainSegs } = computePattern(pattern, { extent: plainExtent });
    expect(plainSegs.filter((s) => s.kind === 'rail' && s.a.j === j)).toHaveLength(1);
  });
});

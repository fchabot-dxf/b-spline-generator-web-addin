/**
 * F21 CONTOUR-FROM-FRAME: the Shape Lattice contour as the frame's inner edge offset inward by Distance
 * (editor/contour-from-frame.js), the ONE source for the drawn contour, its fill clip and the Fusion manifest.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameInnerProfile } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import {
  contourSilhouette, frameContourSilhouette, contourFromFrameOf, CONTOUR_FROM_FRAME_DEFAULTS,
} from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { generateContourSilhouette, outlineDefects } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import { PATTERN_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { buildSketchManifest, latticeExtentFor } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-sketch-manifest.js';
import { boardRegion } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-interaction.js';
import { sizedBoardRegion } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-boundary.js';

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

describe('the frame-offset contour == the frame inner edge offset inward by Distance (to its outside edge)', () => {
  const CASES = [];
  for (const id of ['template_1', 'template_2']) for (const [W, H] of [[7, 9], [12, 6], [9, 12]]) for (const d of [0.1, 0.25, 0.5]) CASES.push([id, W, H, d]);
  it.each(CASES)('%s %sx%s, distance %s', (id, W, H, d) => {
    const frame = frameOf(id, W, H);
    const sil = frameContourSilhouette(frame, d, SW);
    expect(sil.error).toBeUndefined();
    const inner = frameInnerProfile(frame.defs, frame.record, frame.board).primitives;
    // every centerline point sits EXACTLY d + stroke/2 from the frame's inner edge (a concentric offset);
    // at a merged corner a point may only be FARTHER (the corner cuts inside the collapsed arc)
    const ds = samples(sil.primitives).map((q) => distTo(q, inner));
    for (const v of ds) expect(v).toBeGreaterThan(d + SW / 2 - 2e-3);
    const onLines = sil.primitives.filter((p) => p.type === 'L').flatMap((p) => samples([p]));
    for (const q of onLines) expect(Math.abs(distTo(q, inner) - (d + SW / 2))).toBeLessThan(2e-3);
    // validity: simple, positive radii; tangent everywhere except the declared merged corners
    expect(outlineDefects(sil.primitives, { requireTangency: false })).toEqual([]);
    expect(outlineDefects(sil.primitives).filter((x) => !(x.kind === 'notTangent' && sil.corners.includes(x.index)))).toEqual([]);
    // the OUTSIDE region = the centerline's extent + half a stroke
    const pts = samples(sil.primitives), xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
    expect(sil.region.w).toBeCloseTo(Math.max(...xs) - Math.min(...xs) + SW, 2);
    expect(sil.region.h).toBeCloseTo(Math.max(...ys) - Math.min(...ys) + SW, 2);
  });

  it('a corner arc smaller than the offset merges into a corner: fewer segments, the corner declared (Fred: "just less segments")', () => {
    const sil = frameContourSilhouette(frameOf('template_1', 7, 9), 0.25, SW);
    expect(sil.primitives.length).toBeLessThan(12); // T1's outline has 12 pieces
    expect(sil.corners.length).toBeGreaterThan(0);
    expect(sil.segments).toHaveLength(sil.primitives.length);
  });

  it('follows the frame: a Shoulder seed, a thickness and a Trim offset change each move the contour', () => {
    const base = frameContourSilhouette(frameOf('template_1', 9, 12), 0.25, SW).primitives;
    for (const extra of [{ seeds: { cornerRadiusTop: 0.5 } }, { params: { frame_thickness: 0.5 } }, { params: { boundingboxoffset: 0.6 } }]) {
      const moved = frameContourSilhouette(frameOf('template_1', 9, 12, extra), 0.25, SW).primitives;
      expect(JSON.stringify(moved)).not.toBe(JSON.stringify(base));
    }
  });
});

describe('the toggle, the default, the fallbacks', () => {
  const region = sizedBoardRegion(boardRegion({ _mW: 7, _mH: 9 }), null);
  const pattern = (fromFrame) => ({ shape: { ...PATTERN_DEFAULTS.shape }, contour: { ...PATTERN_DEFAULTS.contour, ...(fromFrame ? { fromFrame } : {}) } });

  it('old patterns (no key) are OFF; the declared default is off, 0.25 in', () => {
    expect(PATTERN_DEFAULTS.contour.fromFrame).toEqual({ on: false, distance: 0.25 });
    expect(CONTOUR_FROM_FRAME_DEFAULTS).toEqual({ on: false, distance: 0.25 });
    expect(contourFromFrameOf({ contour: { show: true } })).toEqual({ on: false, distance: 0.25 });
    expect(contourFromFrameOf({})).toEqual({ on: false, distance: 0.25 });
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

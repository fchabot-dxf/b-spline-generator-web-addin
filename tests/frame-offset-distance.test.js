/**
 * Fred 2026-10-10: "Offset from frame" is back (main/brick-panel.js setFrameOffset -> frameOffset.distance, the key
 * frameBandContour reads). What the distance does to the contour the bands follow, on the real silhouette: 0 is the
 * frame's outer edge exactly as before, 0.25 is that edge 0.25 in further in -- every point of it, all the way round.
 * (A pin of the silhouette's existing offset: the reopened control only writes the distance it already honoured.)
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { pointInPolygon, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { tess } from './bare-ground.js';

const segDist = (p, a, b) => { const ex = b.x - a.x, ey = b.y - a.y, l = ex * ex + ey * ey || 1e-12, t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l)); return Math.hypot(a.x + t * ex - p.x, a.y + t * ey - p.y); };
// the silhouette as the bands get it: through buildRibbonPrimitives (brick-panel resolveFrameGeom), then tessellated
const outline = (tpl, W, H, d) => tess(buildRibbonPrimitives(frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: W, heightIn: H } }, d, 0).primitives));

describe('Offset from frame: the distance moves the band contour in by exactly that much', () => {
  for (const [tpl, W, H] of [['template_1', 7, 9], ['template_9', 9, 12]]) {
    it(`${tpl} ${W}x${H}: 0.25 lies 0.25 in inside the outer edge, all the way round`, () => {
      const C0 = outline(tpl, W, H, 0), C1 = outline(tpl, W, H, 0.25);
      expect(Math.abs(signedArea(C1))).toBeLessThan(Math.abs(signedArea(C0)));
      const ds = C1.map((p) => {
        expect(pointInPolygon(p.x, p.y, C0)).toBe(true);
        return Math.min(...C0.map((a, i) => segDist(p, a, C0[(i + 1) % C0.length])));
      }).sort((a, b) => a - b);
      expect(ds[0]).toBeGreaterThan(0.25 - 0.01); // never nearer than the distance (the arcs' chord error)
      expect(ds[ds.length - 1]).toBeLessThan(0.25 * Math.SQRT2 + 0.01); // a mitred reflex corner: 0.25 x sqrt 2 (MEASURED 0.354)
      expect(ds[ds.length >> 1]).toBeCloseTo(0.25, 2); // along the run: 0.25
    });
  }
});

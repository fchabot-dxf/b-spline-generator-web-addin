/**
 * geometry.js polygonPointTester: pointInPolygon for many points against one polygon, the SAME answer -- including its
 * on-edge rule (within ON_EDGE_EPS_SQ of any edge = inside, T86 item 19's one-ULP drift). 2026-10-08: fieldstone's
 * Poisson sampling tested every candidate against every board edge (9.6 s of a 13.8 s phone tap at 4x CPU).
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { pointInPolygon, polygonPointTester } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

const innerPath = (tpl, W, H) => bricksContourBands(buildRibbonPrimitives(frameContourSilhouette({ defs: FRAME_DEFS,
  record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: W, heightIn: H } }, 0, 0).primitives), FRAME_PRESETS.single_soldier, { set: BRICK_SETS[2], seed: 1 }).innerPath;
const POLYS = [
  ['an axis-aligned rectangle', [{ x: 0.25, y: 0.25 }, { x: 6.75, y: 0.25 }, { x: 6.75, y: 8.75 }, { x: 0.25, y: 8.75 }]],
  ['a concave L', [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 8 }, { x: 0, y: 8 }]],
  ['T1 7x9 inner path', innerPath('template_1', 7, 9)],
  ['T14 9x12 inner path (an hourglass waist)', innerPath('template_14', 9, 12)],
  ['T10 7x9 inner path (an arch)', innerPath('template_10', 7, 9)],
];

let s = 12345; const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);

describe('polygonPointTester === pointInPolygon', () => {
  for (const [name, poly] of POLYS) {
    it(name, () => {
      const test = polygonPointTester(poly);
      const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
      const x0 = Math.min(...xs) - 0.5, x1 = Math.max(...xs) + 0.5, y0 = Math.min(...ys) - 0.5, y1 = Math.max(...ys) + 0.5;
      const pts = [];
      for (let k = 0; k < 4000; k++) pts.push({ x: x0 + rnd() * (x1 - x0), y: y0 + rnd() * (y1 - y0) });
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        pts.push(a, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, { x: a.x + 1e-10, y: a.y }, { x: a.x, y: a.y - 1e-10 },
          { x: a.x + (b.x - a.x) * 0.3, y: a.y + (b.y - a.y) * 0.3 + 1e-10 }, { x: a.x, y: a.y + 1e-8 });
      }
      let inside = 0;
      for (const p of pts) {
        const want = pointInPolygon(p.x, p.y, poly);
        if (test(p.x, p.y) !== want) throw new Error(`differs at (${p.x}, ${p.y}): want ${want}`);
        inside += want ? 1 : 0;
      }
      expect(inside).toBeGreaterThan(0); // the sample reaches both sides
      expect(inside).toBeLessThan(pts.length);
    });
  }
});

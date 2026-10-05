/**
 * T86 item 16(b) (advisor contact sheet, main 5559125: "the wall doesn't meet the band" at 1.25/1.5 in bricks on
 * T1/T12, Stretcher wall + Soldier band, 7x9). MEASURED on 5559125: a void in the wall inside the band's inner
 * edge on every size -- T1 0.06 / 0.11 / 0.12 / 0.32 sq in at 0.75 / 1 / 1.25 / 1.5 in, T12 up to 0.24 -- the
 * missing end pieces that item 21c traced to polygonIntersection on touching shapes. On main after 21c and 16(c)
 * part 1: no void beyond a grout joint at any size. This pins it: inside the band's inner edge, every point is
 * covered by a wall brick or lies within one grout joint of one.
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS }); // a heavy sweep: see heavy-test-timeout.js
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { FRAME_PRESETS, BRICK_SETS, scaledSet } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { pointInPolygon } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';

const RED = BRICK_SETS.find((s) => s.layout === 'bond');
const BOARD = [{ x: 0, y: 0 }, { x: 7, y: 0 }, { x: 7, y: 9 }, { x: 0, y: 9 }];
const STEP = 0.03; // in: the sampling grid
const MAX_VOID_SQ_IN = 0.02; // a missing end piece was 0.06-0.32

function distToPolygon(x, y, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1e-18;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L2));
    best = Math.min(best, Math.hypot(x - a.x - t * dx, y - a.y - t * dy));
  }
  return best;
}

describe('the wall meets the band inner edge at every brick size (T86 item 16(b))', () => {
  for (const templateId of ['template_1', 'template_12']) {
    for (const size of [0.75, 1, 1.25, 1.5]) {
      it(`${templateId}, ${size} in bricks: no void beyond a grout joint`, () => {
        const record = normalizeFrameRecord({ templateId });
        const sil = frameContourSilhouette({ defs: FRAME_DEFS, record, board: { widthIn: 7, heightIn: 9 } }, 0, 0);
        const primitives = buildRibbonPrimitives(sil.primitives);
        const scale = size / RED.brickLengthIn;
        const { bricks } = generateBricks({ boardOutline: BOARD, set: RED, frame: { primitives, bands: FRAME_PRESETS.single_soldier }, seed: 1, scale });
        const inner = bricksContourBands(primitives, FRAME_PRESETS.single_soldier, { set: RED, seed: 1, scale }).innerPath;
        const reach = scaledSet(RED, scale).grout.widthIn; // a point this close to a brick is in a joint
        const polys = bricks.map((b) => b.polygon);
        let voids = 0;
        for (let x = STEP / 2; x < 7; x += STEP) for (let y = STEP / 2; y < 9; y += STEP) {
          if (!pointInPolygon(x, y, inner)) continue;
          if (polys.some((p) => pointInPolygon(x, y, p))) continue;
          if (polys.some((p) => distToPolygon(x, y, p) <= reach)) continue;
          voids++;
        }
        expect(voids * STEP * STEP, 'uncovered area beyond a grout joint, sq in').toBeLessThanOrEqual(MAX_VOID_SQ_IN);
      });
    }
  }
});

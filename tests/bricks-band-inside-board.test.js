/**
 * No band piece is laid outside the board (advisor, size sheet v3: T1 7x9 Soldier/Stretcher/Soldier at 1.25 in --
 * the middle band fanned out past the frame outline). T86 item 19's wall invariant, extended to bands
 * (contour-bands.js clipBandPiecesToBoard). Real template geometry (the same frameContourSilhouette +
 * buildRibbonPrimitives chokepoint the Brick tab uses), every size on the size sheet, both stacks. Measured before
 * the clip: up to 26.6 sq in of band outside the board (T1 1.25 in three_band, 100 pieces).
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { polygonIntersection, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

const SET = BRICK_SETS[0];
const ARC_STEPS = 256; // a board fine enough that a chord's sag is far under the tolerance below
const TOL = 2e-3; // sq in outside, per piece

const boardOf = (prims) => prims.flatMap((p) => (p.type === 'arc'
  ? Array.from({ length: ARC_STEPS }, (_, k) => { const t = p.theta1 + ((p.theta2 - p.theta1) * k) / ARC_STEPS; return { x: p.cx + p.r * Math.cos(t), y: p.cy + p.r * Math.sin(t) }; })
  : [p.p0]));

describe('band pieces stay inside the board', () => {
  for (const templateId of ['template_1', 'template_9', 'template_12', 'template_18']) {
    for (const preset of ['single_soldier', 'three_band']) {
      it(`${templateId} ${preset}: no piece outside at 0.75 / 1 / 1.25 / 1.5 in`, () => {
        const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId }), board: { widthIn: 7, heightIn: 9 } }, 0, 0);
        const prims = buildRibbonPrimitives(sil.primitives);
        const board = boardOf(prims);
        const outside = [];
        for (const L of [0.75, 1, 1.25, 1.5]) {
          const { bricks } = bricksContourBands(prims, FRAME_PRESETS[preset], { set: SET, seed: 1, scale: L / SET.brickLengthIn });
          expect(bricks.length).toBeGreaterThan(0);
          for (const b of bricks) {
            const o = Math.abs(signedArea(b.polygon)) - Math.abs(signedArea(polygonIntersection(b.polygon, board)));
            if (o > TOL) outside.push(`${L} in ${b.id}: ${o.toFixed(3)} sq in`);
          }
        }
        expect(outside.slice(0, 5), `${outside.length} pieces outside`).toEqual([]);
      });
    }
  }
});

/**
 * No band piece is laid outside the board (advisor, size sheet v3: T1 7x9 Soldier/Stretcher/Soldier at 1.25 in --
 * the middle band fanned out past the frame outline). T86 item 19's wall invariant, extended to bands
 * (contour-bands.js clipPiecesToBoard). Real template geometry (the same frameContourSilhouette +
 * buildRibbonPrimitives chokepoint the Brick tab uses), every size on the size sheet, both stacks. Measured before
 * the clip: up to 26.6 sq in of band outside the board (T1 1.25 in three_band, 100 pieces).
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { polygonIntersection, signedArea, pointInPolygon } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
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

  // T86 item 28 (advisor): Fred's default -- T1 7x9, three_band, Red Brick at 1.25 in -- overran the board and left
  // no wall; at 1.5 in the inverted ring made a lens with four bare patches. Through the whole engine now: the stack
  // is reduced, a wall region remains, nothing outside, no band overlap, and the board is covered (no bare patch
  // wider than a joint: every sample point is in a piece or within 1.5 grout widths of one).
  for (const L of [1.25, 1.5]) {
    it(`T1 7x9 three_band Red Brick at ${L} in: reduced, a wall, nothing outside, no overlap, no bare patch`, () => {
      const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: 'template_1' }), board: { widthIn: 7, heightIn: 9 } }, 0, 0);
      const prims = buildRibbonPrimitives(sil.primitives);
      const board = boardOf(prims);
      const r = generateBricks({ boardOutline: [{ x: 0, y: 0 }, { x: 7, y: 0 }, { x: 7, y: 9 }, { x: 0, y: 9 }], set: SET, seed: 1,
        scale: L / SET.brickLengthIn, suppression: 0, clumping: 0, frame: { primitives: prims, bands: FRAME_PRESETS.three_band } });
      expect(r.bandsReduced && r.bandsReduced.kept).toBeLessThan(3);
      expect(r.bricks.length).toBeGreaterThan(0);
      const pieces = [...r.frameBricks, ...r.bricks].map((b) => b.polygon);
      for (const q of r.frameBricks.map((b) => b.polygon)) expect(Math.abs(signedArea(q)) - Math.abs(signedArea(polygonIntersection(q, board)))).toBeLessThan(TOL);
      for (let i = 0; i < r.frameBricks.length; i++) for (let j = i + 1; j < r.frameBricks.length; j++) {
        if (r.frameBricks[i].bandIndex === r.frameBricks[j].bandIndex) continue;
        expect(Math.abs(signedArea(polygonIntersection(r.frameBricks[i].polygon, r.frameBricks[j].polygon)))).toBeLessThan(TOL);
      }
      // 21b joint rule: every seam is now a full joint, many of them diagonal; the four axis probes missed a point 0.016 in
      // from a brick inside a diagonal joint, so "near" is the TRUE distance to the nearest piece (exact, not looser)
      const reach = 1.5 * SET.grout.widthIn;
      const distTo = (x, y, q) => { let best = Infinity; for (let i = 0; i < q.length; i++) { const a = q[i], b = q[(i + 1) % q.length], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)); best = Math.min(best, Math.hypot(x - a.x - t * dx, y - a.y - t * dy)); } return best; };
      const near = (x, y) => pieces.some((q) => pointInPolygon(x, y, q) || distTo(x, y, q) <= reach);
      const bare = [];
      for (let x = 0.3; x < 6.75; x += 0.1) for (let y = 0.3; y < 8.75; y += 0.1) if (pointInPolygon(x, y, board) && !near(x, y)) bare.push(`(${x.toFixed(1)},${y.toFixed(1)})`);
      expect(bare.slice(0, 5), `${bare.length} bare sample points`).toEqual([]);
    });
  }
});

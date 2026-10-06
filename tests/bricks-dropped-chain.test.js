/**
 * T86 item 34 (advisor; Fred's "make the app do the best result"): where a band is deeper than a stretch of the outline
 * can hold, the dropped primitives' ground is filled by the corner patch (primitive-ribbon buildPatch), whole fan
 * pieces following the outline -- never left bare. MEASURED before (single band, every preset alike):
 *   - T7 at 1.5 in, 7x9 / 6x9: 4.9 / 2.9 sq in bare -- the whole roof gable. Both roof lines drop between the hooks;
 *     the patch walked only the FIRST dropped primitive, whose far tangent point does not exist: no patch at all.
 *   - T18 / T19 6x9 at 1.25 in: 0.69 / 0.74 sq in -- an r 1.09 shoulder ARC drops where its neighbours' offsets never
 *     cross; the notch construction (meant for a dropped LINE) laid straight-chord fans, the crescent left bare.
 * After: 0.03 / 0.00 and 0.01 / 0.06 sq in. Bare = inside the board, outside the wall, farther than a joint and a
 * half from every band piece.
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { pointInPolygon } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });

const SET = BRICK_SETS[0], STEP = 0.05, REACH = 0.045;
const box = (p) => { const xs = p.map((q) => q.x), ys = p.map((q) => q.y); return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]; };
function distTo(x, y, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
    best = Math.min(best, Math.hypot(x - a.x - t * dx, y - a.y - t * dy));
  }
  return best;
}
function tessellate(prims) {
  const pts = [];
  for (const p of prims) {
    if (p.type === 'arc') for (let k = 0; k < 64; k++) { const t = p.theta1 + ((p.theta2 - p.theta1) * k) / 64; pts.push({ x: p.cx + p.r * Math.cos(t), y: p.cy + p.r * Math.sin(t) }); }
    else pts.push(p.p0);
  }
  return pts;
}
function bareBandGround(id, W, H, L) {
  const prims = buildRibbonPrimitives(frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: id }), board: { widthIn: W, heightIn: H } }, 0, 0).primitives);
  const { bricks, innerPath } = bricksContourBands(prims, FRAME_PRESETS.single_soldier, { set: SET, seed: 1, scale: L / SET.brickLengthIn });
  const board = tessellate(prims), bx = bricks.map((b) => box(b.polygon));
  let n = 0;
  for (let x = STEP / 2; x < W; x += STEP) for (let y = STEP / 2; y < H; y += STEP) {
    if (!pointInPolygon(x, y, board) || (innerPath.length >= 3 && pointInPolygon(x, y, innerPath))) continue;
    if (!bricks.some((b, k) => x >= bx[k][0] - REACH && x <= bx[k][1] + REACH && y >= bx[k][2] - REACH && y <= bx[k][3] + REACH
      && (pointInPolygon(x, y, b.polygon) || distTo(x, y, b.polygon) <= REACH))) n++;
  }
  return n * STEP * STEP;
}

describe('dropped primitives: their ground is a patch of whole fan pieces, not bare (T86 item 34)', () => {
  // [template, board, brick in, bare before (sq in)]
  const CASES = [['template_7', 7, 9, 1.5, 4.9], ['template_7', 6, 9, 1.5, 2.9], ['template_18', 6, 9, 1.25, 0.69], ['template_19', 6, 9, 1.25, 0.74]];
  it.each(CASES)('%s %sx%s at %s in single_soldier: bare band ground under 0.1 sq in (was %s)', (id, W, H, L) => {
    expect(bareBandGround(id, W, H, L)).toBeLessThan(0.1);
  });
});

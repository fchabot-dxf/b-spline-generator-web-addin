/**
 * T86 item 33 (advisor; Fred liked the stone look -- stones whole and natural, no sliver fill): a stone ring leaves no
 * bare ground beyond its joints. MEASURED on ring-pinch before (White rocks three_band, 19 templates x 0.75 / 1 /
 * 1.25 in, 7x9, both stone sets): 66.5 sq in bare, per lay median 0.59, max 1.28 -- from two causes in fieldstone.js:
 *   - the ring was clipped as ONE slit polygon: the stone across its zero-width bridge was cut in two, the seed kept
 *     its piece, often under the floor and dropped (the bridge void, bottom-right of the board, 56 of 57 lays);
 *   - a fence phantom bounded EVERY cell, not just its twin's: at a ring corner it took a neighbour's ground.
 * After (a phantom bounds only its twin's cell; the stones are clipped to the annulus, outer edge minus inner edge):
 * 11.7 sq in, median 0.09, max 0.47; no overlap, no self-crossing, nothing > 10x median. Bare = inside the board,
 * outside the wall, farther than a joint from every stone (the joint mouths at the board edge stay: mortar).
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

const ROCKS = BRICK_SETS.find((s) => s.layout === 'fieldstone');
const W = 7, H = 9, STEP = 0.04;
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
function bareRingGround(templateId, L, inBox = () => true) {
  const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId }), board: { widthIn: W, heightIn: H } }, 0, 0);
  const prims = buildRibbonPrimitives(sil.primitives);
  const { bricks, innerPath } = bricksContourBands(prims, FRAME_PRESETS.three_band, { set: ROCKS, seed: 1, scale: L / ROCKS.brickLengthIn });
  const board = tessellate(prims), bx = bricks.map((b) => box(b.polygon)), J = ROCKS.grout.widthIn;
  let n = 0;
  for (let x = STEP / 2; x < W; x += STEP) for (let y = STEP / 2; y < H; y += STEP) {
    if (!inBox(x, y) || !pointInPolygon(x, y, board) || (innerPath.length >= 3 && pointInPolygon(x, y, innerPath))) continue;
    const near = bricks.some((b, k) => x >= bx[k][0] - J && x <= bx[k][1] + J && y >= bx[k][2] - J && y <= bx[k][3] + J
      && (pointInPolygon(x, y, b.polygon) || distTo(x, y, b.polygon) <= J));
    if (!near) n++;
  }
  return n * STEP * STEP;
}

describe('a stone ring leaves no bare ground beyond its joints (T86 item 33)', () => {
  // the worst lays before, at 1.25 in: [template, bare before, sq in] -- after 0.09-0.17
  const CASES = [['template_19', 1.28], ['template_6', 1.08], ['template_2', 0.95], ['template_7', 0.93], ['template_3', 0.84], ['template_10', 0.76]];
  it.each(CASES)('%s White rocks three_band 1.25 in: bare ring ground under 0.3 sq in (was %s)', (id) => {
    expect(bareRingGround(id, 1.25)).toBeLessThan(0.3);
  });
  // the slit's bridge runs from the outline's first point (the board's bottom-right on these) to the inner edge
  const BRIDGE_BOX = (x, y) => x > 5.9 && y > 7.6;
  it.each(['template_1', 'template_5', 'template_11', 'template_14', 'template_17', 'template_18'])('%s White rocks three_band 1 in: no void at the slit bridge', (id) => {
    expect(bareRingGround(id, 1, BRIDGE_BOX)).toBeLessThan(0.05);
  });
});

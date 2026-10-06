/**
 * T86 item 21b (seat B, fc; Fred circled T11 double_course 1.25: "is this one getting fixed?"): a frame band's
 * CORNERS -- no piece over another, no bare ground in the band. Measured on neck-medial 44f375e over every
 * FRAME_PRESET x 19 templates x 0.75 / 1 / 1.25 in: corner overlap 13.2 sq in, band voids 70.3. The cases below are
 * one per mechanism:
 *   T11 double_course 1.25 -- butt / lapped at a 45 deg corner: the vertical got no piece (primitive-ribbon
 *                             BUTT_SQUARE_WINDOW_DEG: the mitre outside it);
 *   T9 quoin_corners 1.25  -- a quoin block at a reflex corner: the I-beam web went bare (block: convex corners only);
 *   T8 single_soldier 1.25 -- a corner dropping TWO primitives had no joint (buildPatch over the dropped chain);
 *   T12 double_course 1.25 -- a butt corner near square but not square left wedges (cut parallel to the face met);
 *   T5 quoin_corners 0.75  -- a run shorter than the block lay under it (block needs room on both runs);
 *   T18 three_band 1.25    -- the shoulder fans over the top bar (contour-bands yieldAtMedialLine: a fan yields).
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { polygonIntersection, pointInPolygon, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });

const SET = BRICK_SETS[0], W = 7, H = 9;
const area = (p) => (p && p.length >= 3 ? Math.abs(signedArea(p)) : 0);
const box = (p) => { const xs = p.map((q) => q.x), ys = p.map((q) => q.y); return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]; };

function lay(templateId, preset, L) {
  const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId }), board: { widthIn: W, heightIn: H } }, 0, 0);
  const prims = buildRibbonPrimitives(sil.primitives);
  return { prims, ...bricksContourBands(prims, FRAME_PRESETS[preset], { set: SET, seed: 1, scale: L / SET.brickLengthIn }) };
}
function overlap(bricks) {
  const bx = bricks.map((b) => box(b.polygon));
  let sum = 0;
  for (let i = 0; i < bricks.length; i++) for (let j = i + 1; j < bricks.length; j++) {
    const a = bx[i], b = bx[j];
    if (a[1] < b[0] || b[1] < a[0] || a[3] < b[2] || b[3] < a[2]) continue;
    sum += area(polygonIntersection(bricks[i].polygon, bricks[j].polygon));
  }
  return sum;
}
function tessellate(prims) {
  const pts = [];
  for (const p of prims) {
    if (p.type === 'arc') for (let k = 0; k < 64; k++) { const t = p.theta1 + ((p.theta2 - p.theta1) * k) / 64; pts.push({ x: p.cx + p.r * Math.cos(t), y: p.cy + p.r * Math.sin(t) }); }
    else pts.push(p.p0);
  }
  return pts;
}
function distToPolygon(x, y, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
    best = Math.min(best, Math.hypot(x - a.x - t * dx, y - a.y - t * dy));
  }
  return best;
}
/** bare ground in the band, sq in: grid points (STEP) inside the board, outside the band's inner path, and farther
 *  than JOINT_IN from every band piece (the widest ordinary joint on these boards is 0.044 in from a brick) */
const STEP = 0.04, JOINT_IN = 0.045;
function bandVoid({ prims, bricks, innerPath }) {
  const board = tessellate(prims), bx = bricks.map((b) => box(b.polygon));
  let n = 0;
  for (let x = STEP / 2; x < W; x += STEP) for (let y = STEP / 2; y < H; y += STEP) {
    if (!pointInPolygon(x, y, board) || (innerPath.length >= 3 && pointInPolygon(x, y, innerPath))) continue;
    const near = bricks.some((b, k) => x >= bx[k][0] - JOINT_IN && x <= bx[k][1] + JOINT_IN && y >= bx[k][2] - JOINT_IN && y <= bx[k][3] + JOINT_IN
      && (pointInPolygon(x, y, b.polygon) || distToPolygon(x, y, b.polygon) <= JOINT_IN));
    if (!near) n++;
  }
  return n * STEP * STEP;
}

describe('frame band corners: no piece over another, no bare ground (T86 item 21b)', () => {
  // [template, preset, size, the void is asserted here]. T8 and T18: under the joint rule (every joint its declared width)
  // the tapered joints these used to show are gone, but each fan's constant-width joints converge on its apex in a small
  // MORTAR KNOT (declared, accepted by the advisor: T18 1.25 in ~0.027 sq in per shoulder, T8 ~0.009) that this probe's
  // 0.045 in reach reads as bare -- so these two assert overlap only.
  const CASES = [['template_11', 'double_course', 1.25, true], ['template_9', 'quoin_corners', 1.25, true], ['template_8', 'single_soldier', 1.25, false],
    ['template_12', 'double_course', 1.25, true], ['template_5', 'quoin_corners', 0.75, true], ['template_18', 'three_band', 1.25, false]];
  for (const [id, preset, L, voidAsserted] of CASES) {
    it(`${id} ${preset} ${L} in`, () => {
      const r = lay(id, preset, L);
      expect(overlap(r.bricks)).toBeLessThan(0.01);
      if (voidAsserted) expect(bandVoid(r)).toBeLessThan(0.01);
    });
  }
});

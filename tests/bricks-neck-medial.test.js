/**
 * T86 item 16(c) part 2 (seat B, fc): where a frame's band is deeper than half the local gap (a neck, a waist, an X),
 * the pieces of ONE row from opposite sides of the board used to lay over the same ground (main 7633a5e, 7x9, Red
 * Brick seed 1: 14.10 sq in over 19 templates x 3 presets x 3 sizes; T18 / T19 1.25 in 1.11 each, T14 0.82).
 * contour-bands.js yieldAtMedialLine gives each point to the piece whose own depth there is smallest -- the side of
 * the medial line it lies on. These boards are symmetric about x = 3.5, so their necks are LEFT pieces over RIGHT
 * pieces; a corner's own fan residual (21b) stays within one side and is not measured here.
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { clipToField, clipToHalfPlane, polygonCentroid, polygonIntersection, pointInPolygon, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });

const SET = BRICK_SETS[0], W = 7, H = 9, MID = W / 2;
const area = (p) => (p && p.length >= 3 ? Math.abs(signedArea(p)) : 0);

function lay(templateId, preset, L) {
  const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId }), board: { widthIn: W, heightIn: H } }, 0, 0);
  const prims = buildRibbonPrimitives(sil.primitives);
  const r = generateBricks({
    boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }],
    set: SET, seed: 1, scale: L / SET.brickLengthIn, suppression: 0, clumping: 0,
    frame: { primitives: prims, bands: FRAME_PRESETS[preset] },
  });
  return { r };
}
function box(p) { const xs = p.map((q) => q.x), ys = p.map((q) => q.y); return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]; }
/** overlap between a piece left of the centre line and one right of it */
function crossSideOverlap(frame) {
  const side = frame.map((b) => Math.sign(polygonCentroid(b.polygon).x - MID));
  const bx = frame.map((b) => box(b.polygon));
  let sum = 0;
  for (let i = 0; i < frame.length; i++) for (let j = i + 1; j < frame.length; j++) {
    if (side[i] * side[j] >= 0) continue;
    const a = bx[i], b = bx[j];
    if (a[1] < b[0] || b[1] < a[0] || a[3] < b[2] || b[3] < a[2]) continue;
    sum += area(polygonIntersection(frame[i].polygon, frame[j].polygon));
  }
  return sum;
}
function nearestOnSeg(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}
/** the closest pair of points between two polygons (vertex to edge, both ways) */
function closest(A, B) {
  let best = { d: Infinity };
  for (const [P, Q] of [[A, B], [B, A]]) for (const p of P) for (let i = 0; i < Q.length; i++) {
    const q = nearestOnSeg(p.x, p.y, Q[i], Q[(i + 1) % Q.length]), d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best.d) best = { d, x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  }
  return best;
}
/** the narrowest joint of the medial seam: a left piece against a right piece, closest where the board's centre line
 *  crosses the neck (|x - 3.5| <= 0.1, y inside the declared neck window). The seam must be a joint, not two pieces
 *  abutting (seat A's Fusion e2e: a 0-gap seam becomes zero-area sliver profiles). Ordinary joints elsewhere (an arc's
 *  own voussoir joints straddling x = 3.5, the shoulders' corner seams, a mitre) are outside the window: 21b's. */
function narrowestSeam(frame, [y0, y1]) {
  const side = frame.map((b) => Math.sign(polygonCentroid(b.polygon).x - MID));
  const bx = frame.map((b) => box(b.polygon));
  let worst = Infinity;
  for (let i = 0; i < frame.length; i++) for (let j = i + 1; j < frame.length; j++) {
    if (side[i] * side[j] >= 0) continue;
    const a = bx[i], b = bx[j], m = 0.1;
    if (a[1] + m < b[0] || b[1] + m < a[0] || a[3] + m < b[2] || b[3] + m < a[2]) continue;
    const c = closest(frame[i].polygon, frame[j].polygon);
    if (Math.abs(c.x - MID) <= 0.1 && c.y >= y0 && c.y <= y1) worst = Math.min(worst, c.d);
  }
  return worst;
}
/** the ground covered in the neck strip (|x - 3.5| < 0.6): grid points (0.02 in) inside any brick, frame or wall,
 *  times the cell area -- the union measure the sweep uses, here on a grid */
const STEP = 0.02;
function neckCover(bricks) {
  const boxes = bricks.map((b) => box(b.polygon));
  let n = 0;
  for (let i = 0; MID - 0.6 + i * STEP <= MID + 0.6; i++) for (let j = 1; j * STEP < H; j++) {
    const x = MID - 0.6 + i * STEP, y = j * STEP;
    if (bricks.some((b, k) => x >= boxes[k][0] && x <= boxes[k][1] && y >= boxes[k][2] && y <= boxes[k][3] && pointInPolygon(x, y, b.polygon))) n++;
  }
  return n * STEP * STEP;
}
/** neck cover on main 0443c48 (before this item), sq in. The cut may give up only a far piece's tongue left inside a
 *  near-side joint (the shapely sweep: at most 0.0998 sq in, T18 1.25, every opened gap narrower than the board's own
 *  widest joint; this grid reads it as 0.133). COVER_LOSS_IN2 bounds it; T14's X left bare (the no-hole drop guard
 *  removed) loses 0.217 here and fails. */
const COVER_LOSS_IN2 = 0.16;
const MAIN_NECK_COVER = { template_18: 9.3192, template_19: 9.2828, template_14: 9.4436, template_16: 9.1340 };
/** frame digests of T1 7x9 at 1 in on main (0443c48, before this item) -- byte-identical means the same digest */
const MAIN_T1_DIGESTS = { single_soldier: 2521265454, three_band: 2521265454, double_course: 807046501 };

describe('one row meeting itself across a neck: split at the medial line (T86 16(c) part 2)', () => {
  // [template, preset, size, the neck window in y (in) where the medial seam runs]
  const NECKS = [['template_18', 'single_soldier', 1.25, [4, 7]], ['template_19', 'single_soldier', 1.25, [4, 7]],
    ['template_14', 'single_soldier', 1.25, [3.6, 5.4]], ['template_16', 'three_band', 0.75, [3.5, 5.5]]];
  for (const [id, preset, L, neck] of NECKS) {
    it(`${id} ${preset} ${L} in: no overlap across the neck, the seam is a joint, the ground stays covered`, () => {
      const { r } = lay(id, preset, L);
      expect(crossSideOverlap(r.frameBricks)).toBeLessThan(0.01);
      expect(narrowestSeam(r.frameBricks, neck)).toBeGreaterThan(SET.grout.widthIn - 0.002);
      expect(neckCover([...r.frameBricks, ...r.bricks])).toBeGreaterThan(MAIN_NECK_COVER[id] - COVER_LOSS_IN2); // what the frame leaves is the wall's
    });
  }

  it('a board with no neck is laid exactly as before (T1, every preset, 1 in: digest of main)', () => {
    const digest = (frame) => {
      let h = 2166136261;
      for (const ch of JSON.stringify(frame.map((b) => [b.id, b.polygon]))) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
      return h;
    };
    const got = Object.fromEntries(['single_soldier', 'three_band', 'double_course'].map((p) => [p, digest(lay('template_1', p, 1).r.frameBricks)]));
    expect(got).toEqual(MAIN_T1_DIGESTS);
  });
});

describe('clipToField (geometry.js): a polygon clipped to f <= 0 for a curved f', () => {
  const square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  it('a linear field is the half-plane clip', () => {
    const f = (p) => p.x + 0.5 * p.y - 0.7;
    const half = clipToHalfPlane(square, { point: { x: 0.7, y: 0 }, dirX: -0.5 / Math.hypot(1, 0.5), dirY: 1 / Math.hypot(1, 0.5) }, { x: 0, y: 0 });
    expect(area(clipToField(square, f))).toBeCloseTo(area(half), 9);
  });
  it('a circular field follows the arc, not its chord (quarter disc pi/4, chord would give 1/2)', () => {
    expect(area(clipToField(square, (p) => Math.hypot(p.x, p.y) - 1))).toBeCloseTo(Math.PI / 4, 4);
  });
  it('wholly inside returns the same polygon; no vertex inside returns []', () => {
    expect(clipToField(square, () => -1)).toBe(square);
    expect(clipToField(square, () => 1)).toEqual([]);
  });
  it('strict: a tie (f = 0) is outside', () => {
    expect(clipToField(square, () => 0, true)).toEqual([]);
    expect(clipToField(square, () => 0)).toBe(square);
  });
});

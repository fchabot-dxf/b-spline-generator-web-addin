/**
 * T86 item 16b-REOPENED (advisor's size sheet v2: "the wall drops bricks at 1.25 in and up"): re-measured on main
 * 7f862c5 (seat E, 2026-10-07) over every template x 0.75 / 1 / 1.25 / 1.5 in, 7x9, a single soldier band:
 *  - the wall covers its own region (generateBricks interiorOutline) at >= 99.0 % of the bond's ideal share
 *    L*H / ((L+J)(H+J)) in all 76 lays -- no dropped courses; what shrinks with the size is the REGION (the soldier
 *    band's depth is the brick length: T1 30.5 -> 13.6 sq in from 0.75 to 1.5 in);
 *  - bare board ground (inside the contour, in no brick, more than a joint from every brick) is <= 0.18 sq in per lay;
 *  - T9 at 1.5 in has NO wall interior: the band covers the board (0.15 sq in bare) -- a single band is laid as
 *    requested by the declared fit rule (contour-bands.js fitBandStack: the outermost band is never reduced).
 * This matrix pins all three.
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { pointInPolygon, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { BRICK_SETS, FRAME_PRESETS, scaledSet } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });

const SET = BRICK_SETS[0];
const W = 7, H = 9;
const SIZES = [0.75, 1, 1.25, 1.5];
const TEMPLATES = FRAME_DEFS.templates.map((t) => t.id).filter((k) => /^template_\d+$/.test(k));
/** the declared bars (measured worst + margin): wall share of its region vs the bond's ideal, bare ground per lay */
const COVER_MIN_RATIO = 0.98, REGION_MIN_SQIN = 1, BARE_MAX_SQIN = 0.3, GRID_IN = 0.04;
/** where the single soldier band covers the board and no wall interior remains (measured) */
const NO_WALL_ROOM = new Set(['template_9 1.5']);
/** T86 item 16(d): the largest single bare patch, as a share of ONE brick face (L x H of the scaled set). A dropped wall
 *  brick is one patch: T1's top-right corner brick (dropped before item 21c d23c428) left 0.16-0.37 of a face at
 *  0.75-1.5 in; main is <= 0.02 at 0.75-1.25 in (seat D, 2026-10-07). The 1.5 in wall tips are item 16f's parked class
 *  and are capped at today's measure instead (PATCH_KNOWN, a face share each). */
const PATCH_MAX_FACE = 0.05;
const PATCH_KNOWN = { 'template_15 1.5': 0.2, 'template_16 1.5': 0.08, 'template_9 1.5': 0.25 }; // measured 0.195 / 0.072 / 0.240

const area = (p) => (p && p.length >= 3 ? Math.abs(signedArea(p)) : 0);
const tess = (prims) => prims.flatMap((p) => (p.type === 'arc'
  ? Array.from({ length: 32 }, (_, k) => { const t = p.theta1 + ((p.theta2 - p.theta1) * k) / 32; return { x: p.cx + p.r * Math.cos(t), y: p.cy + p.r * Math.sin(t) }; })
  : [p.p0]));
const segDist = (px, py, a, b) => {
  const ex = b.x - a.x, ey = b.y - a.y, l = ex * ex + ey * ey, u = l ? Math.max(0, Math.min(1, ((px - a.x) * ex + (py - a.y) * ey) / l)) : 0;
  return Math.hypot(a.x + u * ex - px, a.y + u * ey - py);
};
/** a brick's polygon + its box grown by one joint (the only bricks that can be "near" a point lie in its box) */
const boxesOf = (bricks, J) => bricks.map((b) => { const xs = b.polygon.map((p) => p.x), ys = b.polygon.map((p) => p.y); return { p: b.polygon, x0: Math.min(...xs) - J, x1: Math.max(...xs) + J, y0: Math.min(...ys) - J, y1: Math.max(...ys) + J }; });
const nearBox = (b, x, y, J) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1
  && (pointInPolygon(x, y, b.p) || b.p.some((q, i) => segDist(x, y, q, b.p[(i + 1) % b.p.length]) <= J * 1.05));
/** board ground inside the contour that is in no brick and more than one joint from every brick -- the reference scan
 *  (every box per grid point); kept to pin bareSqIn below to it */
function bareSqInScan(contour, bricks, J) {
  const boxes = boxesOf(bricks, J);
  let bare = 0;
  for (let y = GRID_IN / 2; y < H; y += GRID_IN) for (let x = GRID_IN / 2; x < W; x += GRID_IN) {
    if (!pointInPolygon(x, y, contour)) continue;
    if (!boxes.some((b) => nearBox(b, x, y, J))) bare++;
  }
  return bare * GRID_IN * GRID_IN;
}
/** The same count, with the boxes bucketed on a coarse grid (load-proofing, seat D 2026-10-07): a box is filed in every
 *  bucket it overlaps, so the bucket of a point holds every box that contains it -- the same `nearBox` test on the same
 *  candidates that can pass it, so the same verdict per point. MEASURED before: this scan was 0.86 s of template_1's
 *  1.44 s (the rest is generateBricks), and the template_1 case (4 sizes) timed out at 35-38 s in 2 of 12 loaded runs. */
const BUCKET_IN = 0.25;
function bareGround(contour, bricks, J) {
  const nx = Math.ceil(W / BUCKET_IN) + 1, buckets = new Map();
  const cell = (v) => Math.floor(v / BUCKET_IN);
  for (const b of boxesOf(bricks, J)) {
    for (let j = cell(b.y0); j <= cell(b.y1); j++) for (let i = cell(b.x0); i <= cell(b.x1); i++) {
      const k = j * nx + i;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(b);
    }
  }
  const bare = new Set(), cols = Math.ceil(W / GRID_IN) + 1;
  let row = 0;
  for (let y = GRID_IN / 2; y < H; y += GRID_IN, row++) for (let x = GRID_IN / 2, col = 0; x < W; x += GRID_IN, col++) {
    if (!pointInPolygon(x, y, contour)) continue;
    if (!(buckets.get(cell(y) * nx + cell(x)) || []).some((b) => nearBox(b, x, y, J))) bare.add(row * cols + col);
  }
  // T86 item 16(d): the largest CONNECTED bare patch (4-neighbour grid points) -- one dropped wall brick is one patch
  let largest = 0;
  const seen = new Set();
  for (const s of bare) {
    if (seen.has(s)) continue;
    let n = 0;
    for (const st = [s], _ = seen.add(s); st.length; n++) {
      const c = st.pop();
      for (const k of [c + 1, c - 1, c + cols, c - cols]) if (bare.has(k) && !seen.has(k)) { seen.add(k); st.push(k); }
    }
    largest = Math.max(largest, n);
  }
  return { sqIn: bare.size * GRID_IN * GRID_IN, largestSqIn: largest * GRID_IN * GRID_IN };
}
const bareSqIn = (contour, bricks, J) => bareGround(contour, bricks, J).sqIn;

const LAY_BOARD = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
const contourCache = new Map();
/** a template's Wall contour (single soldier band), once per template */
function contourOf(tpl) {
  if (!contourCache.has(tpl)) {
    const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: W, heightIn: H } }, 0, 0);
    const prims = buildRibbonPrimitives(sil.primitives);
    contourCache.set(tpl, { prims, contour: tess(prims) });
  }
  return contourCache.get(tpl);
}
const layAt = (prims, L) => generateBricks({ boardOutline: LAY_BOARD, set: SET, seed: 1, scale: L / SET.brickLengthIn, suppression: 0, clumping: 0, frame: { primitives: prims, bands: FRAME_PRESETS.single_soldier } });

describe('T86 item 16b-REOPENED: the wall covers its region at every size; no bare ground (single soldier, 7x9)', () => {
  // one case per template x size (was one per template, 4 sizes: the same lays and checks, each case a quarter)
  it.each(TEMPLATES.flatMap((tpl) => SIZES.map((L) => [tpl, L])))('%s at %s in', (tpl, L) => {
    const { prims, contour } = contourOf(tpl);
    const s = scaledSet(SET, L / SET.brickLengthIn), J = s.grout.widthIn;
    const ideal = (s.brickLengthIn * s.brickHeightIn) / ((s.brickLengthIn + J) * (s.brickHeightIn + J));
    const r = layAt(prims, L);
    const region = area(r.interiorOutline), wall = r.bricks.reduce((t, b) => t + area(b.polygon), 0);
    const tag = `${tpl} ${L}`;
    if (NO_WALL_ROOM.has(tag)) expect(r.bricks.length, tag).toBe(0);
    else if (region >= REGION_MIN_SQIN) expect(wall / region / ideal, `${tag}: wall share of its region vs the ideal`).toBeGreaterThanOrEqual(COVER_MIN_RATIO);
    const bare = bareGround(contour, [...r.frameBricks, ...r.bricks], J);
    expect(bare.sqIn, `${tag}: bare ground sq in`).toBeLessThanOrEqual(BARE_MAX_SQIN);
    const face = s.brickLengthIn * s.brickHeightIn;
    expect(bare.largestSqIn / face, `${tag}: largest bare patch, share of one brick face`).toBeLessThanOrEqual(PATCH_KNOWN[tag] ?? PATCH_MAX_FACE);
  });
  // the bucketed count IS the reference scan's (a curved waist, a template with no wall room, and a lay with a hole
  // punched in it so the bare count is not 0)
  it.each([['template_1', 1], ['template_9', 1.5], ['template_5', 0.75]])('bareSqIn equals the reference scan: %s at %s in', (tpl, L) => {
    const { prims, contour } = contourOf(tpl);
    const J = scaledSet(SET, L / SET.brickLengthIn).grout.widthIn;
    const r = layAt(prims, L);
    const all = [...r.frameBricks, ...r.bricks];
    const holed = all.filter((_, i) => i % 7 !== 3);
    expect(bareSqIn(contour, all, J)).toBe(bareSqInScan(contour, all, J));
    const bare = bareSqIn(contour, holed, J);
    expect(bare).toBeGreaterThan(0);
    expect(bare).toBe(bareSqInScan(contour, holed, J));
  });
});

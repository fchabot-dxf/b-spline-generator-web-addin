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

const area = (p) => (p && p.length >= 3 ? Math.abs(signedArea(p)) : 0);
const tess = (prims) => prims.flatMap((p) => (p.type === 'arc'
  ? Array.from({ length: 32 }, (_, k) => { const t = p.theta1 + ((p.theta2 - p.theta1) * k) / 32; return { x: p.cx + p.r * Math.cos(t), y: p.cy + p.r * Math.sin(t) }; })
  : [p.p0]));
const segDist = (px, py, a, b) => {
  const ex = b.x - a.x, ey = b.y - a.y, l = ex * ex + ey * ey, u = l ? Math.max(0, Math.min(1, ((px - a.x) * ex + (py - a.y) * ey) / l)) : 0;
  return Math.hypot(a.x + u * ex - px, a.y + u * ey - py);
};
/** board ground inside the contour that is in no brick and more than one joint from every brick */
function bareSqIn(contour, bricks, J) {
  const boxes = bricks.map((b) => { const xs = b.polygon.map((p) => p.x), ys = b.polygon.map((p) => p.y); return { p: b.polygon, x0: Math.min(...xs) - J, x1: Math.max(...xs) + J, y0: Math.min(...ys) - J, y1: Math.max(...ys) + J }; });
  let bare = 0;
  for (let y = GRID_IN / 2; y < H; y += GRID_IN) for (let x = GRID_IN / 2; x < W; x += GRID_IN) {
    if (!pointInPolygon(x, y, contour)) continue;
    const near = boxes.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1
      && (pointInPolygon(x, y, b.p) || b.p.some((q, i) => segDist(x, y, q, b.p[(i + 1) % b.p.length]) <= J * 1.05)));
    if (!near) bare++;
  }
  return bare * GRID_IN * GRID_IN;
}

describe('T86 item 16b-REOPENED: the wall covers its region at every size; no bare ground (single soldier, 7x9)', () => {
  it.each(TEMPLATES)('%s at 0.75 / 1 / 1.25 / 1.5 in', (tpl) => {
    const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: W, heightIn: H } }, 0, 0);
    const prims = buildRibbonPrimitives(sil.primitives), contour = tess(prims);
    for (const L of SIZES) {
      const s = scaledSet(SET, L / SET.brickLengthIn), J = s.grout.widthIn;
      const ideal = (s.brickLengthIn * s.brickHeightIn) / ((s.brickLengthIn + J) * (s.brickHeightIn + J));
      const r = generateBricks({ boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], set: SET, seed: 1, scale: L / SET.brickLengthIn, suppression: 0, clumping: 0, frame: { primitives: prims, bands: FRAME_PRESETS.single_soldier } });
      const region = area(r.interiorOutline), wall = r.bricks.reduce((t, b) => t + area(b.polygon), 0);
      const tag = `${tpl} ${L}`;
      if (NO_WALL_ROOM.has(tag)) expect(r.bricks.length, tag).toBe(0);
      else if (region >= REGION_MIN_SQIN) expect(wall / region / ideal, `${tag}: wall share of its region vs the ideal`).toBeGreaterThanOrEqual(COVER_MIN_RATIO);
      expect(bareSqIn(contour, [...r.frameBricks, ...r.bricks], J), `${tag}: bare ground sq in`).toBeLessThanOrEqual(BARE_MAX_SQIN);
    }
  });
});

/**
 * Coursed rubble runs to its region's edge (seat E, 2026-10-08; Fred's joint rule, every seam a real grout joint): a last
 * course the edge would leave thinner than half a course joins the one before it, and a stone the edge cuts to a sliver
 * under the floor joins its neighbour in the course (layouts/coursed-rubble.js COURSED_RUBBLE.edgeCourseShare). MEASURED on
 * main: the rubble stopped 1.5 - 2 joints short of its region (the bottom row, the slanted sides, beside a tall stone) --
 * every Grey stone wall x template x 7x9 / 9x12 x 0.75 - 1.5 in x single soldier / three-band (304 lays): 370.78 sq in of
 * bare board -> 196.67, 297 lays better, none worse; no overlap, nothing off the outline. The dots where four rounded stones
 * meet are the declared look (cornerRound) and stay. Shots: shots/seatE/gaps/cr_T1_1in.png (main) vs cr_fix4_*.
 * Default run: FAST; RUBBLE_EDGE_FULL=1 runs all 304 lays against today's per-size worst.
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { BRICK_SETS, FRAME_PRESETS, scaledSet } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { pointInPolygon, polygonIntersection, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { tess, bareGround } from './bare-ground.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });

const STONE = BRICK_SETS.find((s) => s.layout === 'coursed_rubble');
/** the FAST lays: [template, W, H, size, preset, bare sq in today] -- main left 0.603 / 1.160 / 0.573 */
const FAST = [['template_1', 7, 9, 1, 'single_soldier', 0.3168], ['template_18', 7, 9, 1.25, 'single_soldier', 0.1392], ['template_10', 7, 9, 1, 'single_soldier', 0.2672]];
/** size -> [largest patch sq in, bare sq in] at today's worst of the 304 lays -- a cap */
const RUBBLE_CAPS = { 0.75: [0.216, 0.6384], 1: [0.4128, 1.3248], 1.25: [0.7104, 1.5488], 1.5: [0.5776, 2.136] };
const CASES = process.env.RUBBLE_EDGE_FULL === '1'
  ? FRAME_DEFS.templates.map((t) => t.id).filter((k) => /^template_\d+$/.test(k)).flatMap((tpl) => [[7, 9], [9, 12]].flatMap(([W, H]) =>
    [0.75, 1, 1.25, 1.5].flatMap((L) => ['single_soldier', 'three_band'].map((p) => [tpl, W, H, L, p, null]))))
  : FAST;
const segDist = (p, a, b) => { const ex = b.x - a.x, ey = b.y - a.y, l = ex * ex + ey * ey || 1e-12, t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l)); return Math.hypot(a.x + t * ex - p.x, a.y + t * ey - p.y); };

describe('coursed rubble runs to its region\'s edge: no strip, no overlap, nothing off the board', () => {
  it.each(CASES)('%s %sx%s at %s in, %s', (tpl, W, H, L, preset, today) => {
    const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: W, heightIn: H } }, 0, 0);
    if (!sil || !sil.primitives) return;
    const prims = buildRibbonPrimitives(sil.primitives), C = tess(prims), scale = L / STONE.brickLengthIn, J = scaledSet(STONE, scale).grout.widthIn;
    const r = generateBricks({ boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], set: STONE, scale, seed: 1, suppression: 0, clumping: 0,
      frame: { primitives: prims, bands: FRAME_PRESETS[preset], set: STONE } });
    const P = [...r.bricks, ...r.frameBricks].map((b) => b.polygon), tag = `${tpl} ${W}x${H} ${L} in ${preset}`;
    const over = [];
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) { const o = Math.abs(signedArea(polygonIntersection(P[i], P[j])) || 0); if (o > 1e-3) over.push(+o.toFixed(4)); }
    expect(over, `${tag}: overlapping pieces`).toEqual([]);
    expect(P.filter((Q) => Q.some((p) => !pointInPolygon(p.x, p.y, C) && Math.min(...C.map((a, i) => segDist(p, a, C[(i + 1) % C.length]))) > J)).length, `${tag}: pieces off the outline`).toBe(0);
    const bare = bareGround(C, [...r.bricks, ...r.frameBricks], J, { W, H }), cap = RUBBLE_CAPS[L];
    expect(bare.sqIn, `${tag}: bare sq in`).toBeLessThanOrEqual((today ?? cap[1]) * 1.05 + 0.01);
    expect(bare.largestSqIn, `${tag}: largest bare patch`).toBeLessThanOrEqual(cap[0] + 0.01);
  });
});

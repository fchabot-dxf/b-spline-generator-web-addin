/**
 * Stones at life size (seat E, 2026-10-08): a White rocks (fieldstone) wall inside a White rocks / Grey stone ring, single
 * soldier, every template x 7x9 / 9x12 at the big presets 3 / 4 / 8 in. MEASURED on main (228 lays; the two ring sets lay
 * identically -- both ring with fieldstone, contour-bands.js setBandPattern):
 *  - no two pieces overlap and no piece lies more than a joint outside the outline, in every lay -- pinned at 0;
 *  - bare ground (tests/bare-ground.js) is listed and CAPPED per size at today's worst lay (may only fall): 3 in largest
 *    patch 0.79 sq in (T12 9x12), 4 in 1.40 (T7 7x9), 8 in 8.82 (T19 7x9: an 8 in stone is wider than half the board).
 *  - cuts (brush X, a grout cut across the wall / the ring, T1 / T10 / T18): at 3 in a grout cut leaves one fragment under
 *    the fieldstone floor (0.12 - 0.18 sq in, the floor 0.14); at 4 in the 0.29 in joint round a 4 in stroke brick reads
 *    as 2 - 3.6 sq in in a 0.75-joint window, a seam, no stone missing (shots/seatE/stones/x4_cut_4.png). Not pinned here
 *    (tests/bricks-stone-cuts.test.js pins the cut rules).
 * Default run: FAST; STONE_LIFE_FULL=1 runs every lay (one ring set: the other is identical).
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

const ROCK = BRICK_SETS.find((s) => s.layout === 'fieldstone');
/** size (in) -> [largest bare patch sq in, bare sq in] at today's worst lay (measured, 228 lays) -- a cap, not a goal */
const STONE_CAPS = { 3: [0.79, 2.07], 4: [1.4, 3.04], 8: [8.82, 11.78] };
const FAST = [['template_12', 9, 12, 3], ['template_7', 7, 9, 4], ['template_19', 7, 9, 8]];
const CASES = process.env.STONE_LIFE_FULL === '1'
  ? FRAME_DEFS.templates.map((t) => t.id).filter((k) => /^template_\d+$/.test(k)).flatMap((tpl) => [[7, 9], [9, 12]].flatMap(([W, H]) => [3, 4, 8].map((L) => [tpl, W, H, L])))
  : FAST;

const segDist = (p, a, b) => { const ex = b.x - a.x, ey = b.y - a.y, l = ex * ex + ey * ey || 1e-12, t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l)); return Math.hypot(a.x + t * ex - p.x, a.y + t * ey - p.y); };
const area = (p) => (p && p.length >= 3 ? Math.abs(signedArea(p)) : 0);

describe('stones at life size: no overlap, nothing off the board, bare capped per size', () => {
  it.each(CASES)('%s %sx%s at %s in', (tpl, W, H, L) => {
    const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: W, heightIn: H } }, 0, 0);
    if (!sil || !sil.primitives) return;
    const prims = buildRibbonPrimitives(sil.primitives), contour = tess(prims), scale = L / ROCK.brickLengthIn, J = scaledSet(ROCK, scale).grout.widthIn;
    const r = generateBricks({ boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], set: ROCK, scale, seed: 1, suppression: 0, clumping: 0,
      frame: { primitives: prims, bands: FRAME_PRESETS.single_soldier, set: ROCK } });
    const P = [...r.bricks, ...r.frameBricks].map((b) => b.polygon), tag = `${tpl} ${W}x${H} ${L} in`;
    const over = [];
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) { const o = area(polygonIntersection(P[i], P[j])); if (o > 1e-3) over.push(+o.toFixed(4)); }
    expect(over, `${tag}: overlapping pieces (sq in)`).toEqual([]);
    const outside = P.filter((Q) => Q.some((p) => !pointInPolygon(p.x, p.y, contour) && Math.min(...contour.map((a, i) => segDist(p, a, contour[(i + 1) % contour.length]))) > J)).length;
    expect(outside, `${tag}: pieces outside the outline`).toBe(0);
    const bare = bareGround(contour, [...r.bricks, ...r.frameBricks], J, { W, H }), cap = STONE_CAPS[L];
    expect(bare.largestSqIn, `${tag}: largest bare patch (cap ${cap[0]})`).toBeLessThanOrEqual(cap[0] + 0.01);
    expect(bare.sqIn, `${tag}: bare sq in (cap ${cap[1]})`).toBeLessThanOrEqual(cap[1] * 1.05 + 0.01);
  });
});

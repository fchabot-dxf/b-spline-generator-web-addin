/**
 * The GAP sweep (seat E, 2026-10-08), the overlap sweep's twin: bare board inside a brick frame + wall (tests/bare-ground.js,
 * the largest connected patch as a share of one brick face) where no other test pins it -- every frame preset x template x
 * 7x9 / 9x12 at 1.25 and 1.5 in (bricks-tip-fill-fans pins 0.75 / 1 in; bricks-wall-coverage-matrix the single soldier 7x9),
 * and the single soldier at 2 / 3 / 4 / 8 in (the three-band preset measured identical there: the fit rule leaves one band).
 *  - Fred's sizes (<= 1.5 in): every lay <= PATCH_MAX_FACE (bare-ground.js PATCH_KNOWN: T16 7x9 1.5 in); no wall or frame
 *    piece more than a joint outside the outline. MEASURED on main b6fc072: 608 lays, only T16 7x9 1.5 over (0.072).
 *  - 2 - 8 in: listed and CAPPED at today's measure (GAP_CAPS: [largest patch face share, bare sq in, wall pieces laid more
 *    than a joint outside the outline]) -- may only fall. Worst: T18 9x12 3 in, one 4.3 sq in patch (1.8 faces). Wall
 *    pieces outside the outline: 18 lays when measured (T14 7x9 3 in: 10), 0 since wall-outside (the wall region and the
 *    wall pieces clipped to the board: primitive-ribbon.js wallRegionAtDepth, engine.js + contour-bands.js clipPiecesToBoard).
 * Default run: FAST (6 lays); GAP_SWEEP_FULL=1 runs all 760 (85 s).
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { pointInPolygon } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { BRICK_SETS, FRAME_PRESETS, scaledSet } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { tess, bareGround, PATCH_MAX_FACE, PATCH_KNOWN } from './bare-ground.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });

const SET = BRICK_SETS[0];
const FRED_SIZES = [1.25, 1.5], BIG_SIZES = [2, 3, 4, 8], BOARDS = [[7, 9], [9, 12]];
/** 2 - 8 in, single soldier: template -> board -> size: [largest patch face share, bare sq in, wall pieces outside] (measured
 *  on main b6fc072; a lay not listed is <= PATCH_MAX_FACE with no piece outside) -- a cap, not a goal */
const GAP_CAPS = {
  template_1: {'7x9':{8:[0.136,4.6304,0]},'9x12':{8:[0.25,8.5296,0]}},
  template_4: {'9x12':{8:[0.163,5.6704,0]}},
  template_5: {'7x9':{3:[0.152,0.696,0],4:[0.221,2.3296,0],8:[0.952,17.5936,0]},'9x12':{3:[0.154,0.664,0],4:[0.132,1.0976,0],8:[0.445,15.2592,0]}},
  template_6: {'9x12':{8:[0,0,0]}},
  template_7: {'7x9':{3:[0.432,1.5456,0],8:[0.339,5.7936,0]},'9x12':{4:[0.091,0.7968,0],8:[0.427,7.2896,0]}},
  template_8: {'7x9':{3:[0.153,0.5072,0],4:[0.156,0.888,0],8:[0.435,14.4848,0]},'9x12':{8:[0.192,6.152,0]}},
  template_10: {'7x9':{8:[0.079,1.344,0]},'9x12':{8:[0.247,4.2208,0]}},
  template_11: {'7x9':{2:[0.141,0.1776,0],3:[0.281,0.704,0],4:[0.412,2.608,0],8:[0.136,3.8336,0]},'9x12':{3:[0.113,0.4944,0],4:[0.328,2.624,0],8:[0.344,6.4304,0]}},
  template_12: {'7x9':{8:[0.079,1.3552,0]},'9x12':{8:[0.25,4.2608,0]}},
  template_14: {'7x9':{2:[0,0,0],3:[0.213,1.4144,0],4:[0.117,1.8592,0]},'9x12':{3:[0,0,0],8:[0.144,4.9248,0]}},
  // 9x12 8 in: 9.46 -> 11.30 sq in when the shared-side fan split removed 32.6 sq in of stacked slices (fan-stacking)
  // RAISED by the arc narrowing (gap-3in, a band >= 3 in deep narrows where a long arc dies; advisor's yes): 7x9 3 in bare 3.37 ->
  // 2.47 sq in but the largest patch 0.897 -> 0.944 faces; 7x9 4 in 2.20 -> 2.74 sq in (0.286 -> 0.538); 9x12 4 in 1.55 -> 2.11
  // sq in (0.162 -> 0.236) -- 4 in nets -47 % bare over the 17 lays it changes
  template_16: {'7x9':{3:[0.944,2.4736,0],4:[0.538,2.7424,0]},'9x12':{2:[0.086,0.0912,0],3:[0.003,0.0112,0],4:[0.236,2.1104,0],8:[0.378,11.296,0]}},
  // 9x12 8 in: largest patch 1.13 -> 1.27 faces, bare 19.28 -> 22.50 sq in when the shared-side fan split removed 27.7 sq in of
  // stacked slices (fan-stacking)
  template_17: {'7x9':{3:[0.12,0.496,0],4:[0.477,4.5456,0],8:[0.237,5.7568,0]},'9x12':{3:[0,0,0],4:[0.218,1.2272,0],8:[1.274,22.4976,0]}},
  // 4 in, the arc narrowing (gap-3in): bare falls (7x9 8.85 -> 7.56, 9x12 13.64 -> 7.57 sq in) but the largest patch RISES
  // (7x9 0.594 -> 0.731, 9x12 1.257 -> 1.267 faces) -- advisor's yes
  template_18: {'7x9':{2:[0.369,0.4784,0],3:[1.25,4.6784,0],4:[0.731,7.5632,0],8:[0.444,16.3808,0]},'9x12':{4:[1.267,7.568,0],8:[0.53,24.9024,0]}},
  template_19: {'7x9':{2:[0.181,0.4544,0],3:[0.449,1.0784,0],4:[0.522,7.3424,0],8:[0.276,15.0192,0]},'9x12':{4:[0.098,0.8384,0],8:[0.401,15.84,0]}},
};
const FAST = [
  ['template_16', 7, 9, 1.5, 'single_soldier'], ['template_10', 9, 12, 1.25, 'butt_frame'], ['template_1', 9, 12, 1.5, 'mixed_bands'],
  ['template_18', 9, 12, 3, 'single_soldier'], ['template_14', 7, 9, 3, 'single_soldier'], ['template_5', 7, 9, 8, 'single_soldier'],
];
const TEMPLATES = FRAME_DEFS.templates.map((t) => t.id).filter((k) => /^template_\d+$/.test(k));
const CASES = process.env.GAP_SWEEP_FULL === '1'
  ? TEMPLATES.flatMap((tpl) => BOARDS.flatMap(([W, H]) => [
    ...Object.keys(FRAME_PRESETS).filter((p) => p !== 'none').flatMap((p) => FRED_SIZES.map((L) => [tpl, W, H, L, p])),
    ...BIG_SIZES.map((L) => [tpl, W, H, L, 'single_soldier'])]))
  : FAST;

const segDist = (p, a, b) => { const ex = b.x - a.x, ey = b.y - a.y, l = ex * ex + ey * ey || 1e-12, t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l)); return Math.hypot(a.x + t * ex - p.x, a.y + t * ey - p.y); };

describe('the gap sweep: no bare patch over a brick face share; 2 - 8 in capped at today', () => {
  it.each(CASES)('%s %sx%s at %s in, %s', (tpl, W, H, L, preset) => {
    const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: W, heightIn: H } }, 0, 0);
    if (!sil || !sil.primitives) return;
    const prims = buildRibbonPrimitives(sil.primitives), contour = tess(prims);
    const r = generateBricks({ boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], set: SET, seed: 1, scale: L / SET.brickLengthIn,
      suppression: 0, clumping: 0, frame: { primitives: prims, bands: FRAME_PRESETS[preset] } });
    const s = scaledSet(SET, L / SET.brickLengthIn), J = s.grout.widthIn;
    const bare = bareGround(contour, [...r.frameBricks, ...r.bricks], J, { W, H });
    const face = bare.largestSqIn / (s.brickLengthIn * s.brickHeightIn);
    const outside = (b) => b.polygon.some((p) => !pointInPolygon(p.x, p.y, contour) && Math.min(...contour.map((a, i) => segDist(p, a, contour[(i + 1) % contour.length]))) > J);
    const tag = `${tpl} ${W}x${H} ${L}`;
    expect(r.frameBricks.filter(outside).length, `${tag}: frame pieces outside the outline`).toBe(0);
    const cap = L >= 2 ? (((GAP_CAPS[tpl] || {})[`${W}x${H}`] || {})[L]) : null;
    if (!cap) {
      expect(face, `${tag}: largest bare patch, share of one brick face`).toBeLessThanOrEqual(PATCH_KNOWN[tag] ?? PATCH_MAX_FACE);
      expect(r.bricks.filter(outside).length, `${tag}: wall pieces outside the outline`).toBe(0);
      return;
    }
    expect(face, `${tag}: largest bare patch (cap ${cap[0]})`).toBeLessThanOrEqual(Math.max(cap[0], PATCH_MAX_FACE) + 0.005);
    expect(bare.sqIn, `${tag}: bare sq in (cap ${cap[1]})`).toBeLessThanOrEqual(cap[1] * 1.05 + 0.01);
    expect(r.bricks.filter(outside).length, `${tag}: wall pieces outside the outline (cap ${cap[2]})`).toBeLessThanOrEqual(cap[2]);
  });
});

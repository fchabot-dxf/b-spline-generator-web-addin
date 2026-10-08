/**
 * The PATTERN gap sweep (seat E, 2026-10-08): every wall pattern (the course patterns and every tile2d one) x every template
 * x 7x9 / 9x12 at Fred's sizes 0.75 - 1.5 in, single soldier, Red brick -- the gap / overlap sweeps lay only the default bond.
 *  - no wall piece overlaps another piece (wall or frame), and none lies off the outline -- pinned at 0. MEASURED on main:
 *    35 lays overlapped (tile patterns only) -- a cell clipped to a BRIDGED wall region (two lobes joined by a zero-width
 *    corridor, primitive-ribbon.js bridgeLobes) came back across the corridor; the tile2d layouts now clip lobe by lobe
 *    (geometry.js clipPolygonToRegion); the bond keeps clipPolygonToBoard, its tips are the band's (item 16f) -- byte-identical;
 *  - the largest bare patch (tests/bare-ground.js) is at most PATCH_MAX_FACE of a brick face, except the lays capped in
 *    PATTERN_CAPS at today's measure (may only fall). MEASURED: 214 lays over on main -> 95 (the bond patterns' unchanged)
 *    (T18 7x9 1 in hexagon / square_diamond / basketweave: 1.2 / 1.2 / 0.67 faces -> 0.012, the tip tile the corridor cut
 *    away); 29.29 sq in of bare removed, 1.23 added (26 small lays, mostly T14: a cell across its slit keeps one lobe's piece).
 * Default run: FAST; PATTERN_SWEEP_FULL=1 runs all 2,736 lays.
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { BRICK_PATTERNS, FRAME_PRESETS, scaledSet } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { pointInPolygon, polygonIntersection, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { buildRibbonPrimitives, resolvedSetFor, scaleFor } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { tess, bareGround, PATCH_MAX_FACE } from './bare-ground.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });

const PATTERNS = Object.entries(BRICK_PATTERNS).filter(([k, v]) => v.kind !== 'none' && k !== 'fieldstone' && k !== 'coursed_rubble').map(([k]) => k);
/** '<template> <W>x<H> <size> <pattern>' -> [largest patch face share, bare sq in] (measured with the lobe clip) -- a cap */
const PATTERN_CAPS = {
  'template_1 7x9 1.5 stacked_variation': [0.096, 0.0688],
  'template_10 7x9 1.5 stacked_variation': [0.096, 0.064],
  'template_11 7x9 1.5 soldier': [0.395, 0.2448],
  'template_12 7x9 1.5 stacked_variation': [0.096, 0.0688],
  'template_13 7x9 1.5 stacked_variation': [0.096, 0.0592],
  'template_14 7x9 0.75 basketweave': [0.192, 0.0288],
  'template_14 7x9 0.75 basketweave_stacked': [0.053, 0.008],
  'template_14 7x9 0.75 basketweave_variation': [0.107, 0.0288],
  'template_14 7x9 0.75 framed_square': [0.064, 0.0144],
  'template_14 7x9 0.75 lozenge': [0.064, 0.0128],
  'template_14 7x9 0.75 soldier': [0.48, 0.12],
  'template_14 7x9 0.75 square_diamond': [0.053, 0.016],
  'template_14 7x9 0.75 stacked_horizontal': [0.48, 0.12],
  'template_14 7x9 0.75 stacked_variation': [0.48, 0.0736],
  'template_14 7x9 1 framed_square': [0.072, 0.0192],
  'template_14 7x9 1 lozenge': [0.066, 0.0192],
  'template_14 7x9 1 octagon_square': [0.384, 0.1024],
  'template_14 7x9 1 square_diamond': [0.078, 0.0208],
  'template_14 7x9 1 stacked_horizontal': [0.144, 0.0384],
  'template_14 7x9 1 stacked_variation': [0.102, 0.0272],
  'template_14 7x9 1.25 soldier': [0.753, 0.3136],
  'template_14 7x9 1.5 soldier': [0.544, 0.3264],
  'template_14 7x9 1.5 stack': [0.104, 0.0624],
  'template_14 7x9 1.5 stacked_variation': [0.085, 0.0512],
  'template_14 9x12 0.75 basketweave': [0.181, 0.0352],
  'template_14 9x12 0.75 soldier': [0.256, 0.0672],
  'template_14 9x12 1 basketweave': [0.072, 0.0192],
  'template_14 9x12 1 basketweave_stacked': [0.198, 0.0528],
  'template_14 9x12 1 chevron': [0.096, 0.0256],
  'template_14 9x12 1 lozenge': [0.306, 0.0848],
  'template_14 9x12 1 soldier': [0.372, 0.184],
  'template_14 9x12 1 square_diamond': [0.054, 0.0288],
  'template_14 9x12 1 stacked_horizontal': [0.18, 0.0864],
  'template_14 9x12 1 stacked_variation': [0.108, 0.0288],
  'template_14 9x12 1.25 basketweave': [0.211, 0.088],
  'template_14 9x12 1.25 hexagon': [0.353, 0.1472],
  'template_14 9x12 1.25 octagon_square': [0.568, 0.2368],
  'template_14 9x12 1.25 soldier': [0.119, 0.0704],
  'template_14 9x12 1.25 square_diamond': [0.399, 0.1664],
  'template_14 9x12 1.25 square_grid': [0.361, 0.1504],
  'template_14 9x12 1.5 soldier': [0.771, 0.4624],
  'template_15 9x12 1.25 lozenge': [0.073, 0.032],
  'template_16 7x9 0.75 soldier': [0.064, 0.0128],
  'template_16 7x9 1 chevron': [0.108, 0.0352],
  'template_16 7x9 1 lozenge': [0.594, 0.1584],
  'template_16 7x9 1 square_diamond': [0.138, 0.0368],
  'template_16 7x9 1.25 soldier': [0.188, 0.0784],
  'template_16 7x9 1.5 flemish': [0.072, 0.0432],
  'template_16 7x9 1.5 header': [0.064, 0.0384],
  'template_16 7x9 1.5 soldier': [0.136, 0.0816],
  'template_16 7x9 1.5 stack': [0.072, 0.0432],
  'template_16 7x9 1.5 stacked_variation': [0.08, 0.048],
  'template_16 7x9 1.5 stretcher': [0.072, 0.0432],
  'template_16 9x12 1 basketweave': [0.108, 0.0288],
  'template_16 9x12 1 soldier': [0.09, 0.048],
  'template_16 9x12 1.25 basketweave_variation': [0.104, 0.0448],
  'template_16 9x12 1.25 chevron': [0.077, 0.0336],
  'template_16 9x12 1.25 framed_square': [0.154, 0.064],
  'template_16 9x12 1.25 lozenge': [0.061, 0.0272],
  'template_16 9x12 1.25 soldier': [0.084, 0.0352],
  'template_16 9x12 1.25 stacked_horizontal': [0.154, 0.064],
  'template_16 9x12 1.5 lozenge': [0.051, 0.0304],
  'template_17 7x9 1.25 herringbone': [0.061, 0.0272],
  'template_17 7x9 1.5 stacked_variation': [0.08, 0.048],
  'template_17 9x12 1.5 soldier': [0.411, 0.2464],
  'template_18 7x9 1 basketweave_variation': [0.06, 0.0272],
  'template_18 7x9 1.25 soldier': [0.303, 0.1456],
  'template_18 9x12 1 soldier': [0.186, 0.0496],
  'template_19 7x9 1 basketweave_variation': [0.06, 0.024],
  'template_19 7x9 1.25 soldier': [0.276, 0.1296],
  'template_19 9x12 1 soldier': [0.186, 0.0496],
  'template_2 7x9 1.5 stacked_variation': [0.096, 0.0592],
  'template_3 7x9 1.5 stacked_variation': [0.096, 0.0704],
  'template_4 7x9 1.5 stacked_variation': [0.096, 0.0672],
  'template_6 7x9 0.75 lozenge': [0.203, 0.0304],
  'template_6 7x9 1 lozenge': [0.09, 0.024],
  'template_6 7x9 1.25 herringbone': [0.207, 0.0864],
  'template_6 7x9 1.5 chevron': [0.056, 0.0336],
  'template_6 7x9 1.5 stacked_variation': [0.096, 0.0576],
  'template_6 9x12 0.75 herringbone': [0.128, 0.0192],
  'template_6 9x12 1 lozenge': [0.126, 0.0336],
  'template_6 9x12 1.5 herringbone': [0.243, 0.1472],
  'template_6 9x12 1.5 lozenge': [0.224, 0.1344],
  'template_8 7x9 1.5 stacked_variation': [0.096, 0.0672],
  'template_9 7x9 0.75 lozenge': [0.053, 0.016],
  'template_9 7x9 1.25 chevron': [0.108, 0.0848],
  'template_9 7x9 1.25 herringbone': [0.227, 0.0976],
  'template_9 7x9 1.25 lozenge': [0.296, 0.2528],
  'template_9 9x12 0.75 chevron': [0.309, 0.048],
  'template_9 9x12 0.75 herringbone': [0.096, 0.0144],
  'template_9 9x12 0.75 lozenge': [0.213, 0.0336],
  'template_9 9x12 1 lozenge': [0.126, 0.0688],
  'template_9 9x12 1.25 chevron': [0.081, 0.0336],
  'template_9 9x12 1.25 lozenge': [0.092, 0.0384],
  'template_9 9x12 1.5 herringbone': [0.096, 0.064],
};
const FAST = [['template_18', 7, 9, 1, 'hexagon'], ['template_18', 7, 9, 1, 'square_diamond'], ['template_18', 7, 9, 1, 'basketweave'], ['template_19', 7, 9, 1.25, 'stretcher']];
const CASES = process.env.PATTERN_SWEEP_FULL === '1'
  ? FRAME_DEFS.templates.map((t) => t.id).filter((k) => /^template_\d+$/.test(k)).flatMap((tpl) => [[7, 9], [9, 12]].flatMap(([W, H]) =>
    [0.75, 1, 1.25, 1.5].flatMap((L) => PATTERNS.map((p) => [tpl, W, H, L, p]))))
  : FAST;
const segDist = (p, a, b) => { const ex = b.x - a.x, ey = b.y - a.y, l = ex * ex + ey * ey || 1e-12, t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l)); return Math.hypot(a.x + t * ex - p.x, a.y + t * ey - p.y); };

describe('every wall pattern at Fred\'s sizes: no overlap, nothing off the board, bare patches capped', () => {
  it.each(CASES)('%s %sx%s at %s in, %s', (tpl, W, H, L, pattern) => {
    const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: W, heightIn: H } }, 0, 0);
    if (!sil || !sil.primitives) return;
    const prims = buildRibbonPrimitives(sil.primitives), C = tess(prims);
    const settings = { setId: 1, pattern, brickLengthIn: L }, set = resolvedSetFor(settings), scale = scaleFor(settings), s = scaledSet(set, scale), J = s.grout.widthIn;
    const input = { boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], set, scale, seed: 1, suppression: 0, clumping: 0, frame: { primitives: prims, bands: FRAME_PRESETS.single_soldier } };
    if (BRICK_PATTERNS[pattern].kind === 'tile2d') input.set = { ...set, layout: pattern }; else input.zones = [{ pattern }];
    const r = generateBricks(input), Wb = r.bricks.map((b) => b.polygon), P = [...Wb, ...r.frameBricks.map((b) => b.polygon)], tag = `${tpl} ${W}x${H} ${L} ${pattern}`;
    const over = [];
    for (let i = 0; i < Wb.length; i++) for (let j = i + 1; j < P.length; j++) { const o = Math.abs(signedArea(polygonIntersection(Wb[i], P[j])) || 0); if (o > 1e-3) over.push(+o.toFixed(4)); }
    expect(over, `${tag}: wall pieces overlapping (sq in)`).toEqual([]);
    expect(Wb.filter((Q) => Q.some((p) => !pointInPolygon(p.x, p.y, C) && Math.min(...C.map((a, i) => segDist(p, a, C[(i + 1) % C.length]))) > J)).length, `${tag}: wall pieces off the outline`).toBe(0);
    const bare = bareGround(C, [...r.bricks, ...r.frameBricks], J, { W, H }), face = bare.largestSqIn / (s.brickLengthIn * s.brickHeightIn), cap = PATTERN_CAPS[tag];
    expect(face, `${tag}: largest bare patch, share of a face (cap ${cap ? cap[0] : PATCH_MAX_FACE})`).toBeLessThanOrEqual((cap ? Math.max(cap[0], PATCH_MAX_FACE) : PATCH_MAX_FACE) + 0.005);
    if (cap) expect(bare.sqIn, `${tag}: bare sq in (cap ${cap[1]})`).toBeLessThanOrEqual(cap[1] * 1.05 + 0.01);
  });
});

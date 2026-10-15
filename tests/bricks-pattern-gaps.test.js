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
 * Fred 2026-10-14 (pick A, core/bricks/cell-parts.js): a cell the region cuts in two lays every part -- re-measured, 83 of the 95
 * caps fell under PATCH_MAX_FACE (dropped), 4 fell (set to the new measure), 8 unchanged.
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

// the stone patterns lay their own set (fieldstone, coursed_rubble, coursed_ashlar: each has its own coverage test --
// tests/bricks-coursed-ashlar.test.js for the ashlar), not Red brick
const PATTERNS = Object.entries(BRICK_PATTERNS).filter(([k, v]) => v.kind !== 'none' && k !== 'fieldstone' && k !== 'coursed_rubble' && k !== 'coursed_ashlar').map(([k]) => k);
/** '<template> <W>x<H> <size> <pattern>' -> [largest patch face share, bare sq in] (measured with the lobe clip) -- a cap */
const PATTERN_CAPS = {
  'template_1 7x9 1.5 stacked_variation': [0.096, 0.064],
  'template_10 7x9 1.5 stacked_variation': [0.096, 0.0624],
  'template_12 7x9 1.5 stacked_variation': [0.096, 0.064],
  'template_13 7x9 1.5 stacked_variation': [0.096, 0.0592],
  'template_14 7x9 1.5 stacked_variation': [0.085, 0.0512],
  'template_16 7x9 1.5 stacked_variation': [0.08, 0.048],
  'template_17 7x9 1.5 stacked_variation': [0.08, 0.048],
  'template_2 7x9 1.5 stacked_variation': [0.096, 0.0592],
  'template_3 7x9 1.5 stacked_variation': [0.096, 0.0608],
  'template_4 7x9 1.5 stacked_variation': [0.096, 0.0672],
  'template_6 7x9 1.5 stacked_variation': [0.096, 0.0576],
  'template_8 7x9 1.5 stacked_variation': [0.096, 0.0672],
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
    // pairs whose boxes are apart cannot overlap: skipped (their intersection is empty -- the same list)
    const over = [], bx = P.map((Q) => [Math.min(...Q.map((p) => p.x)), Math.min(...Q.map((p) => p.y)), Math.max(...Q.map((p) => p.x)), Math.max(...Q.map((p) => p.y))]);
    for (let i = 0; i < Wb.length; i++) for (let j = i + 1; j < P.length; j++) {
      const a = bx[i], b = bx[j];
      if (a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]) continue;
      const o = Math.abs(signedArea(polygonIntersection(Wb[i], P[j])) || 0); if (o > 1e-3) over.push(+o.toFixed(4));
    }
    expect(over, `${tag}: wall pieces overlapping (sq in)`).toEqual([]);
    expect(Wb.filter((Q) => Q.some((p) => !pointInPolygon(p.x, p.y, C) && Math.min(...C.map((a, i) => segDist(p, a, C[(i + 1) % C.length]))) > J)).length, `${tag}: wall pieces off the outline`).toBe(0);
    const bare = bareGround(C, [...r.bricks, ...r.frameBricks], J, { W, H }), face = bare.largestSqIn / (s.brickLengthIn * s.brickHeightIn), cap = PATTERN_CAPS[tag];
    expect(face, `${tag}: largest bare patch, share of a face (cap ${cap ? cap[0] : PATCH_MAX_FACE})`).toBeLessThanOrEqual((cap ? Math.max(cap[0], PATCH_MAX_FACE) : PATCH_MAX_FACE) + 0.005);
    if (cap) expect(bare.sqIn, `${tag}: bare sq in (cap ${cap[1]})`).toBeLessThanOrEqual(cap[1] * 1.05 + 0.01);
  });
});

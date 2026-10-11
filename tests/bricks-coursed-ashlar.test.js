/**
 * Rough ashlar (Fred picked mock E, 2026-10-10; layouts/coursed-ashlar.js): a broken-course grey-block Wall pattern that
 * picks Set 6 (Grey ashlar) the way Coursed rubble picks Grey stone. Pinned here:
 *  - declared: a Wall pattern in the Fieldstone family, not band-capable, its set implied by the pattern;
 *  - seeded: the same seed lays the same wall, another seed another wall;
 *  - on a rectangle, template_1 and template_18 (single soldier band) at 0.75 / 1 / 1.5 in: no piece overlaps another, no
 *    piece under the layout's floor, nothing off the region, and the wall COVERS the region except its joints -- measured
 *    on the lay without the rough step (bare ground more than one joint from every block, tests/bare-ground.js), and the
 *    rough lay keeps at least ROUGH_KEEP of that area (its corners and edges only move in);
 *  - a concave notch that cuts a course through splits the course into separate spans (no block across the notch).
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { BRICK_PATTERNS, BRICK_SETS, FRAME_PRESETS, scaledSet, MIN_PIECE_FRACTION } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { pointInPolygon, polygonIntersection, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { layAshlar, spansOf, COURSED_ASHLAR } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/layouts/coursed-ashlar.js';
import { buildRibbonPrimitives, patternSetId, elementSetId, wallLayoutFor, BRICK_SET_IDS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { bandCanLay } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { bareGround, PATCH_MAX_FACE } from './bare-ground.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });

const ASHLAR = BRICK_SETS.find((s) => s.layout === 'coursed_ashlar');
/** the rough lay keeps at least this share of the smooth lay's area */
const ROUGH_KEEP = 0.85;
const area = (p) => Math.abs(signedArea(p));
const segDist = (p, a, b) => { const ex = b.x - a.x, ey = b.y - a.y, l = ex * ex + ey * ey || 1e-12, t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l)); return Math.hypot(a.x + t * ex - p.x, a.y + t * ey - p.y); };
const offOutline = (P, C, tol) => P.filter((Q) => Q.some((p) => !pointInPolygon(p.x, p.y, C) && Math.min(...C.map((a, i) => segDist(p, a, C[(i + 1) % C.length]))) > tol)).length;
const overlaps = (P) => {
  const out = [];
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) { const q = polygonIntersection(P[i], P[j]); if (q.length >= 3 && area(q) > 1e-4) out.push([i, j]); }
  return out;
};
const W = 7, H = 10;
const BOARD = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
function lay(tpl, L, seed = 1) {
  const scale = L / ASHLAR.brickLengthIn;
  let frame = null;
  if (tpl !== 'rect') {
    const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: W, heightIn: H } }, 0, 0);
    frame = { primitives: buildRibbonPrimitives(sil.primitives), bands: FRAME_PRESETS.single_soldier, set: BRICK_SETS[0] };
  }
  return { r: generateBricks({ boardOutline: BOARD, set: ASHLAR, scale, seed, suppression: 0, clumping: 0, frame }), set: scaledSet(ASHLAR, scale) };
}

describe('Rough ashlar wall pattern: declared', () => {
  it('a Wall pattern in the Fieldstone family, not band-capable, its set (Grey ashlar) implied by the pattern', () => {
    expect(BRICK_PATTERNS.coursed_ashlar).toEqual({ kind: 'tile2d', family: 'fieldstone' });
    expect(bandCanLay(BRICK_PATTERNS.coursed_ashlar)).toBe(false);
    expect(BRICK_SET_IDS).not.toContain(ASHLAR.id);
    expect(patternSetId('coursed_ashlar')).toBe(ASHLAR.id);
    expect(elementSetId({ pattern: 'coursed_ashlar', setIds: { wall: 1 } }, 'wall')).toBe(ASHLAR.id);
    expect(wallLayoutFor({ pattern: 'coursed_ashlar' })).toBe('coursed_ashlar');
    expect(ASHLAR.grout.widthIn).toBe(0.05);
  });
});

describe('Rough ashlar: seeded', () => {
  it('the same seed lays the same wall; another seed another', () => {
    const a = lay('template_1', 1, 3).r.bricks, b = lay('template_1', 1, 3).r.bricks, c = lay('template_1', 1, 4).r.bricks;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(JSON.stringify(c)).not.toBe(JSON.stringify(a));
  });
});

describe('Rough ashlar: no overlap, nothing under the floor or off the region, the region covered but for its joints', () => {
  const CASES = ['rect', 'template_1', 'template_18'].flatMap((t) => [0.75, 1, 1.5].map((L) => [t, L]));
  it.each(CASES)('%s 7x10 at %s in', (tpl, L) => {
    const { r, set } = lay(tpl, L);
    const C = r.interiorOutline, J = set.grout.widthIn, tag = `${tpl} ${L} in`;
    const P = r.bricks.map((b) => b.polygon);
    expect(P.length, `${tag}: pieces`).toBeGreaterThan(0);
    expect(overlaps(P), `${tag}: overlapping pieces`).toEqual([]);
    const floor = MIN_PIECE_FRACTION * set.brickLengthIn * set.brickHeightIn;
    expect(P.filter((p) => area(p) < floor - 1e-9).length, `${tag}: pieces under the floor`).toBe(0);
    expect(offOutline(P, C, 1e-6), `${tag}: pieces off the region`).toBe(0);
    // coverage, on the lay without its rough step: bare ground (more than one joint from every block)
    const smooth = layAshlar(C, set, 1, { ...COURSED_ASHLAR, rough: null }).cells;
    expect(overlaps(smooth.map((c) => c.polygon)), `${tag}: smooth overlaps`).toEqual([]);
    const bare = bareGround(C, smooth, J, { W, H });
    const face = set.brickLengthIn * set.brickHeightIn;
    expect(bare.largestSqIn, `${tag}: largest bare patch`).toBeLessThanOrEqual(PATCH_MAX_FACE * face);
    const aSmooth = smooth.reduce((s, c) => s + area(c.polygon), 0), aRough = P.reduce((s, p) => s + area(p), 0);
    expect(aRough / aSmooth, `${tag}: rough keeps`).toBeGreaterThanOrEqual(ROUGH_KEEP);
    expect(aRough / aSmooth, `${tag}: rough only moves in`).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe('Rough ashlar: a concave notch splits a course into spans', () => {
  // a U: a notch 1 in wide from the top down to y = 4 (H = 1 in courses cross it)
  const U = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 0 }, { x: 7, y: 0 }, { x: 7, y: 8 }, { x: 0, y: 8 }];
  it('spansOf reads two spans across the notch, one below it', () => {
    expect(spansOf(U, 1, 2, 9)).toEqual([[0, 3], [4, 7]]);
    expect(spansOf(U, 5, 6, 9)).toEqual([[0, 7]]);
  });
  it('no block crosses the notch; the U is covered but for its joints', () => {
    const set = ASHLAR, J = set.grout.widthIn;
    const cells = layAshlar(U, set, 1, { ...COURSED_ASHLAR, rough: null }).cells;
    const notch = [{ x: 3, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 3, y: 4 }];
    expect(cells.filter((c) => area(polygonIntersection(c.polygon, notch)) > 1e-6).length).toBe(0);
    expect(overlaps(cells.map((c) => c.polygon))).toEqual([]);
    expect(bareGround(U, cells, J, { W: 7, H: 8 }).largestSqIn).toBeLessThanOrEqual(PATCH_MAX_FACE);
  });
});

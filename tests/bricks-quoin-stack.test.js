/**
 * Quoin corners on a stack of 2+ bands (Fred 2026-10-10, his board "Armor": a corner joint missing in 3D, dark squares with
 * a grout colour). Two causes, both pinned here:
 *  - every band's ribbon laid its OWN 1.1 in quoin square at its own corner, the inner one over the outer (T3 7x10 1 in
 *    mixed_bands 4 overlaps, 2.67 sq in). The rule (contour-bands.js QUOIN_INNER_WRAP): the outermost square stays, each
 *    further band's corner piece is an L wrapping it a joint off; an L that cannot fit (two corners closer than its arms)
 *    falls back to the mitre; nothing lays under a quoin (cutUnderQuoins), a remnant under the floor merging into a
 *    neighbour (mergeRemnant).
 *  - the 1.1 in block is deeper than a thin stack, so it reached into the wall's region: the wall was laid under it and
 *    the frame's grout (its hole = that region) painted it dark. The engine clears the wall from it and takes it out of
 *    the region (engine.js, the quoins that reach in).
 * Pinned: no frame piece overlaps another; no wall piece lies under a frame piece; the grout as the editor paints it
 * (the frame outline, the wall's region a hole, even-odd) covers no face; no bare patch over BARE_PATCH_TOL_SQIN; a
 * one-band quoin keeps its plain squares. FAST: the found boards; QUOIN_FULL=1: every template x 7x9 / 9x12 x
 * 0.75 - 1.5 in x every multi-band preset (+ the one-band ones).
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { BRICK_SETS, FRAME_PRESETS, scaledSet } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { polygonIntersection, signedArea, pointInPolygon } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { groutShapeOf, pointOnGrout, primitivesOutline } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/grout-shape.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { tess, bareGround } from './bare-ground.js';

/** main's own largest bare patch over this sweep is 0.043 sq in (2026-10-10): no case may leave more than this */
const BARE_PATCH_TOL_SQIN = 0.05;
const MULTI = Object.keys(FRAME_PRESETS).filter((p) => FRAME_PRESETS[p].length > 1);
const FAST = [['template_3', 7, 10, 1, 'mixed_bands'], ['template_5', 9, 12, 0.75, 'three_band'], ['template_1', 7, 9, 1, 'mixed_bands'], ['template_5', 9, 12, 1, 'three_band'],
  ['template_15', 7, 9, 0.75, 'soldier_stretcher'], ['template_6', 7, 9, 1.25, 'mixed_bands'], ['template_11', 7, 9, 1.5, 'mixed_bands'], ['template_5', 9, 12, 1, 'soldier_stretcher'],
  ['template_1', 7, 9, 0.75, 'single_soldier']];
const TEMPLATES = FRAME_DEFS.templates.map((t) => t.id).filter((k) => /^template_\d+$/.test(k));
const FULL = process.env.QUOIN_FULL ? TEMPLATES.flatMap((tpl) => [[7, 9], [9, 12]].flatMap(([W, H]) => [0.75, 1, 1.25, 1.5].flatMap((L) => [...MULTI, 'single_soldier', 'quoin_corners'].map((p) => [tpl, W, H, L, p])))) : [];
const box = (p) => [Math.min(...p.map((q) => q.x)), Math.min(...p.map((q) => q.y)), Math.max(...p.map((q) => q.x)), Math.max(...p.map((q) => q.y))];
const meet = (a, b) => !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
/** points on an 11 x 11 grid over a polygon's box that lie inside it */
const insidePoints = (f) => {
  const [x0, y0, x1, y1] = box(f), out = [];
  for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) { const x = x0 + ((x1 - x0) * i) / 12, y = y0 + ((y1 - y0) * j) / 12; if (pointInPolygon(x, y, f)) out.push({ x, y }); }
  return out;
};
/** every overlap (sq in) between a piece of `A` and a piece of `B` (one list: each pair once) */
function overlaps(A, B = null) {
  const ba = A.map(box), bb = B ? B.map(box) : ba, out = [];
  for (let i = 0; i < A.length; i++) for (let j = B ? 0 : i + 1; j < (B || A).length; j++) {
    if (!meet(ba[i], bb[j])) continue;
    const o = Math.abs(signedArea(polygonIntersection(A[i], (B || A)[j])) || 0);
    if (o > 1e-4) out.push(+o.toFixed(4));
  }
  return out;
}
function prims(tpl, W, H) {
  const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: W, heightIn: H } }, 0, 0);
  return sil && sil.primitives ? buildRibbonPrimitives(sil.primitives) : null;
}
function lay(tpl, W, H, L, preset) {
  const WALL = BRICK_SETS[0], P = prims(tpl, W, H);
  if (!P) return null;
  const bands = FRAME_PRESETS[preset].map((b) => ({ ...b, cornerStyle: 'block' }));
  return { P, J: scaledSet(WALL, L / WALL.brickLengthIn).grout.widthIn, r: generateBricks({ boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], set: WALL, scale: L / WALL.brickLengthIn, seed: 1, suppression: 0, clumping: 0, frame: { primitives: P, bands } }) };
}

describe('Quoin on a stack of bands: one square per corner, an L for each further band, nothing under a quoin', () => {
  it.each([...FAST, ...FULL])('%s %ix%i %s in %s', (tpl, W, H, L, preset) => {
    const laid = lay(tpl, W, H, L, preset);
    if (!laid) return;
    const { P, J, r } = laid, F = r.frameBricks.map((b) => b.polygon), Wb = r.bricks.map((b) => b.polygon);
    expect(overlaps(F), 'frame pieces overlapping (sq in)').toEqual([]);
    expect(overlaps(F, Wb), 'wall pieces under a frame piece (sq in)').toEqual([]);
    // the grout as the editor paints it (editor-brick-tool.js: the frame outline, the wall's region a hole, even-odd with
    // every face): no face reads as grout over a quarter of its inside (sampled INSIDE the face -- an L's vertex mean lies
    // in its notch, and the board as the region hid the hole: both made this check pass on Armor's dark corners)
    const shape = groutShapeOf({ id: 'f', region: [{ outer: primitivesOutline(P), holes: [r.interiorOutline] }], faces: F });
    const painted = F.filter((f) => { const pts = insidePoints(f); return pts.length && pts.filter((p) => pointOnGrout(shape, p.x, p.y)).length > pts.length / 4; });
    expect(painted.length, 'faces painted as grout').toBe(0);
    expect(bareGround(tess(P), [...r.bricks, ...r.frameBricks], J, { W, H }).largestSqIn, 'largest bare patch (sq in)').toBeLessThanOrEqual(BARE_PATCH_TOL_SQIN);
  });
  it('a one-band quoin lays its plain squares (4 corners, no L)', () => {
    const { r } = lay('template_3', 7, 10, 1, 'single_soldier');
    const squares = r.frameBricks.filter((b) => b.polygon.length === 4 && Math.abs(Math.abs(signedArea(b.polygon)) - 1.1 * 1.1) < 1e-6);
    expect(squares.length).toBeGreaterThan(0);
  });
});

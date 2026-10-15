/**
 * Fred 2026-10-15 (MID-COURSE BLOCKS; mockup shots/seatE/midblocks, his answers): `frame.blocks = [{ id, x, y }]` places a
 * quoin-unit block along the frame's run (core/bricks/frame-blocks.js, laid as a quoin by contour-bands.js):
 *  1. it SNAPS TO JOINTS -- it replaces whole pieces of the outer band, so every piece left in that band is one of today's;
 *  2. it is the FULL quoin unit deep (or the row's own depth if deeper), reaching past a thin stack, the wall cleared off it;
 *  3. on an arc it is a RADIAL WEDGE (arc face on the run, the inner face the arc's offset).
 * No block = the lay exactly as before.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { signedArea, polygonIntersection, isSimplePolygon } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

const A = (p) => Math.abs(signedArea(p) || 0);
const key = (p) => JSON.stringify(p.map((q) => [+q.x.toFixed(6), +q.y.toFixed(6)]));
const sha = (x) => createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 16);
const QUOIN_IN = 1.1; // the quoin unit (BRICK_SETS id 3's length, primitive-ribbon.js QUOIN_BLOCK_IN)
// T1 7x10 (the hourglass): the middle of the top, low on the right side, the left waist arc
const BLOCKS = [{ id: 'b1', x: 3.5, y: 0.3 }, { id: 'b2', x: 6.7, y: 8.1 }, { id: 'b3', x: 1.45, y: 5.0 }];
const W = 7, H = 10, SET = BRICK_SETS[0];
const prims = buildRibbonPrimitives(frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: 'template_1' }), board: { widthIn: W, heightIn: H } }, 0, 0).primitives);
const lay = (preset, L, blocks) => generateBricks({ boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], set: SET, scale: L / SET.brickLengthIn,
  seed: 1, suppression: 0, clumping: 0, frame: { primitives: prims, bands: FRAME_PRESETS[preset], ...(blocks !== undefined ? { blocks } : {}) } });
const digest = (r) => sha([r.frameBricks.map((b) => key(b.polygon)), r.bricks.map((b) => key(b.polygon))]);

describe('mid-course blocks (frame-blocks.js)', () => {
  it('no block (absent or []) lays exactly as before', () => {
    expect(digest(lay('single_soldier', 1.25, []))).toBe(digest(lay('single_soldier', 1.25)));
  });
  it.each([['single_soldier', 1.25], ['mixed_bands', 1.25], ['soldier_stretcher', 1]])('%s at %s in: three blocks -- whole pieces only, the full unit, the wedge, nothing under them', (preset, L) => {
    const today = lay(preset, L), r = lay(preset, L, BLOCKS);
    const blocks = r.frameBricks.filter((b) => b.frameBlock);
    expect(blocks.map((b) => b.frameBlock).sort()).toEqual(['b1', 'b2', 'b3']);
    expect(blocks.map((b) => b.id).sort()).toEqual(['block-b1', 'block-b2', 'block-b3']); // stable ids: the record's
    // 1. snap to joints: no outer-band piece is cut to a sliver -- each is one of today's, or (another run's mitred end a deep
    // block reaches: the quoin rule trims it a joint clear, MEASURED T1 1.25 single_soldier frame-33 0.402 -> 0.389) keeps 90 %
    const todays = new Map(today.frameBricks.filter((b) => b.bandIndex === 0 && (b.rowIndex || 0) === 0).map((b) => [b.id, b]));
    const outer = r.frameBricks.filter((b) => !b.frameBlock && b.bandIndex === 0 && (b.rowIndex || 0) === 0);
    const cut = outer.filter((b) => !todays.has(b.id) || key(todays.get(b.id).polygon) !== key(b.polygon));
    for (const b of cut) expect(todays.has(b.id) && A(b.polygon) >= 0.9 * A(todays.get(b.id).polygon), b.id).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(2);
    // 2. the full unit: each block at least the quoin unit deep (its area over its face at least the unit)
    for (const b of blocks) expect(A(b.polygon)).toBeGreaterThan(0.8 * QUOIN_IN * QUOIN_IN);
    // 3. the waist block is a wedge: more than 4 vertices (its arc faces)
    expect(blocks.find((b) => b.frameBlock === 'b3').polygon.length).toBeGreaterThan(4);
    // nothing under a block: no piece (band or wall) overlaps one; every piece simple
    const all = [...r.frameBricks, ...r.bricks];
    for (const b of blocks) for (const o of all) if (o !== b) expect(A(polygonIntersection(b.polygon, o.polygon)), `${b.id} vs ${o.id}`).toBeLessThan(1e-3);
    expect(all.filter((b) => !isSimplePolygon(b.polygon)).length).toBe(0);
  });
  it('a block survives a re-lay: another seed places it on the same run, under the same id', () => {
    const r = generateBricks({ boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], set: SET, scale: 1.25 / SET.brickLengthIn,
      seed: 7, suppression: 0, clumping: 0, frame: { primitives: prims, bands: FRAME_PRESETS.single_soldier, blocks: BLOCKS } });
    expect(r.frameBricks.filter((b) => b.frameBlock).map((b) => b.id).sort()).toEqual(['block-b1', 'block-b2', 'block-b3']);
  });
});

import { brickLayInput } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { MIGRATIONS } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';
describe('the settings reach the lay (P.brickSettings.frameBlocks)', () => {
  const editor = { _mW: W, _mH: H, _sketchLayer: { node: { querySelectorAll: () => [], querySelector: () => null } }, _layers: [] };
  const geom = { primitives: prims, bands: FRAME_PRESETS.single_soldier };
  const base = { frameBandPreset: 'single_soldier', brickLengthIn: 1.25, seed: 1, suppression: 0, clumping: 0, pattern: 'stretcher' };
  it('blocks are sent with the Frame; none (absent / []) sends nothing; no Frame element sends nothing', () => {
    expect(brickLayInput(editor, { ...base, frameBlocks: BLOCKS }, geom).frame.blocks).toEqual(BLOCKS);
    expect('blocks' in brickLayInput(editor, { ...base, frameBlocks: [] }, geom).frame).toBe(false);
    expect('blocks' in brickLayInput(editor, base, geom).frame).toBe(false);
    expect('blocks' in brickLayInput(editor, { ...base, frameBlocks: BLOCKS }, { ...geom, noFrameElement: true }).frame).toBe(false);
  });
  it("migration 'frame-blocks': a board saved before gets [] (it lays as before); one with blocks keeps them", () => {
    const m = MIGRATIONS.find((x) => x.id === 'frame-blocks'), old = { brickSettings: {} };
    expect(m.when(old)).toBe(true);
    m.apply(old);
    expect(old.brickSettings.frameBlocks).toEqual([]);
    expect(m.when({ brickSettings: { frameBlocks: BLOCKS } })).toBe(false);
  });
});

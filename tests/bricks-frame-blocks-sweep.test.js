/**
 * The mid-course block SWEEP (core/bricks/frame-blocks.js): a block at the middle of EVERY primitive of a template's contour
 * (every straight run, every arc), on every frame preset kind -- no piece overlaps another, every piece simple, and no bare
 * patch larger than the same lay without blocks has (a block may only take ground the band and the wall gave up to it).
 * Default run: FAST; BLOCK_SWEEP_FULL=1 runs every template x 7x9 / 9x12 x 0.75 - 1.5 in x three presets.
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { BRICK_SETS, FRAME_PRESETS, scaledSet } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { signedArea, polygonIntersection, isSimplePolygon } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { tess, bareGround } from './bare-ground.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });

const SET = BRICK_SETS[0], PRESETS = ['single_soldier', 'mixed_bands', 'soldier_stretcher'];
const TEMPLATES = FRAME_DEFS.templates.map((t) => t.id).filter((k) => /^template_\d+$/.test(k));
const FAST = [['template_1', 7, 10, 1.25], ['template_10', 7, 9, 1], ['template_5', 7, 9, 1.25]];
const CASES = process.env.BLOCK_SWEEP_FULL === '1' ? TEMPLATES.flatMap((t) => [[7, 9], [9, 12]].flatMap(([W, H]) => [0.75, 1, 1.25, 1.5].map((L) => [t, W, H, L]))) : FAST;
const A = (p) => Math.abs(signedArea(p) || 0);
const box = (p) => [Math.min(...p.map((q) => q.x)), Math.min(...p.map((q) => q.y)), Math.max(...p.map((q) => q.x)), Math.max(...p.map((q) => q.y))];
/** the middle of a primitive (a line's midpoint, an arc's mid-angle point) */
const midOf = (p) => (p.type === 'line' ? { x: (p.p0.x + p.p1.x) / 2, y: (p.p0.y + p.p1.y) / 2 }
  : { x: p.cx + p.r * Math.cos((p.theta1 + p.theta2) / 2), y: p.cy + p.r * Math.sin((p.theta1 + p.theta2) / 2) });

describe(`a block at the middle of every run lays cleanly (${process.env.BLOCK_SWEEP_FULL === '1' ? 'full sweep' : 'fast set'})`, () => {
  it.each(CASES)('%s %ix%i at %s in', (tpl, W, H, L) => {
    const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: W, heightIn: H } }, 0, 0);
    if (!sil || !sil.primitives) return;
    const prims = buildRibbonPrimitives(sil.primitives), C = tess(prims), J = scaledSet(SET, L / SET.brickLengthIn).grout.widthIn;
    const blocks = prims.map((p, i) => ({ id: `m${i}`, ...midOf(p) }));
    for (const preset of PRESETS) {
      const lay = (b) => generateBricks({ boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], set: SET, scale: L / SET.brickLengthIn, seed: 1,
        suppression: 0, clumping: 0, frame: { primitives: prims, bands: FRAME_PRESETS[preset], ...(b ? { blocks: b } : {}) } });
      const base = lay(null), r = lay(blocks), tag = `${tpl} ${W}x${H} ${L} ${preset}`;
      const all = [...r.frameBricks, ...r.bricks].map((b) => b.polygon), bx = all.map(box);
      const over = [];
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
        const a = bx[i], b = bx[j];
        if (a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]) continue;
        const o = A(polygonIntersection(all[i], all[j])); if (o > 1e-3) over.push(+o.toFixed(4));
      }
      expect(over, `${tag}: overlapping pieces (sq in)`).toEqual([]);
      expect(all.filter((p) => !isSimplePolygon(p)).length, `${tag}: pieces crossing themselves`).toBe(0);
      const bare = bareGround(C, [...r.bricks, ...r.frameBricks], J, { W, H }).largestSqIn, was = bareGround(C, [...base.bricks, ...base.frameBricks], J, { W, H }).largestSqIn;
      expect(bare, `${tag}: largest bare patch with blocks vs without`).toBeLessThanOrEqual(was + 0.01);
    }
  });
});

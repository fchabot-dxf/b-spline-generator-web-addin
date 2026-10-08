/**
 * T86 item 16f follow-up (seat D, 2026-10-08): the tip fill must not give up ground a corner's fan already held.
 * MEASURED on main 6322962: a wall tip is judged bare against the WALL only; on T11 butt_frame / double_course at 0.75 and
 * 1 in the corner fan already covered it, fillTips lengthened the side run into it, the fan slices yielded to that
 * extension at the medial split, and the split trimmed the extension back -- 0.17 sq in bare (1.1 brick faces). Fix:
 * contour-bands fillTips treats the frame's own fan slices as blockers, like the wall's.
 * Every lay: the largest bare patch <= PATCH_MAX_FACE of one brick face, and no two frame pieces overlap.
 * Default = FAST (the T11 cases + the lays where a fan sits next to a tip, ~10 s); the whole 0.75 / 1 in sweep over every
 * preset x template, 7x9 and 9x12 (608 lays): TIP_FAN_SWEEP_FULL=1 npx vitest run tests/bricks-tip-fill-fans.test.js
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { polygonIntersection, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { BRICK_SETS, FRAME_PRESETS, scaledSet } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { tess, bareGround, PATCH_MAX_FACE } from './bare-ground.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });

const SET = BRICK_SETS[0];
const OVERLAP_MAX_SQIN = 1e-3;
// [template, board w, h, brick length in, preset]: T11's two holes, then lays whose tip extension now stays a joint off a fan
const FAST = [
  ['template_11', 7, 9, 0.75, 'butt_frame'], ['template_11', 7, 9, 1, 'double_course'],
  ['template_1', 7, 9, 0.75, 'single_soldier'], ['template_3', 9, 12, 1, 'single_soldier'], ['template_10', 9, 12, 1.5, 'butt_frame'],
];
const FULL = process.env.TIP_FAN_SWEEP_FULL === '1';
const CASES = FULL
  ? FRAME_DEFS.templates.map((t) => t.id).filter((k) => /^template_\d+$/.test(k)).flatMap((tpl) => [[7, 9], [9, 12]].flatMap(([W, H]) =>
    Object.keys(FRAME_PRESETS).filter((p) => p !== 'none').flatMap((p) => [0.75, 1].map((L) => [tpl, W, H, L, p]))))
  : FAST;

const area = (p) => (p && p.length >= 3 ? Math.abs(signedArea(p)) : 0);
const boxOf = (p) => { const xs = p.map((q) => q.x), ys = p.map((q) => q.y); return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]; };

describe(`tip fill keeps the corner fan's ground (${FULL ? 'full sweep' : 'fast set'})`, () => {
  it.each(CASES)('%s %sx%s at %s in, %s', (tpl, W, H, L, preset) => {
    const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: W, heightIn: H } }, 0, 0);
    const prims = buildRibbonPrimitives(sil.primitives);
    const r = generateBricks({ boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], set: SET, seed: 1, scale: L / SET.brickLengthIn,
      suppression: 0, clumping: 0, frame: { primitives: prims, bands: FRAME_PRESETS[preset] } });
    const s = scaledSet(SET, L / SET.brickLengthIn);
    const bare = bareGround(tess(prims), [...r.frameBricks, ...r.bricks], s.grout.widthIn, { W, H });
    expect(bare.largestSqIn / (s.brickLengthIn * s.brickHeightIn), 'largest bare patch, share of one brick face').toBeLessThanOrEqual(PATCH_MAX_FACE);
    const fb = r.frameBricks, bx = fb.map((b) => boxOf(b.polygon)), bad = [];
    for (let i = 0; i < fb.length; i++) for (let j = i + 1; j < fb.length; j++) {
      const a = bx[i], b = bx[j];
      if (a[1] < b[0] || b[1] < a[0] || a[3] < b[2] || b[3] < a[2]) continue;
      const o = area(polygonIntersection(fb[i].polygon, fb[j].polygon));
      if (o > OVERLAP_MAX_SQIN) bad.push(`${fb[i].id}/${fb[j].id} ${o.toFixed(4)}`);
    }
    expect(bad, 'frame pieces overlapping').toEqual([]);
  });
});

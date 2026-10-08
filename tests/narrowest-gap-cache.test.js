/**
 * narrowestGap, remembered per exact board (core/bricks/contour-bands.js narrowestGapCached). MEASURED 2026-10-08
 * (phone, 4x CPU): the O(n^2) gap was 300 ms of a 470-620 ms Brick-tap lay and 81-90 ms of the panel's corner / fan
 * checks, recomputed for the same board every time. A cache keyed by the board's content returns the same number.
 */
import { describe, it, expect } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { bricksContourBands, narrowestGap, narrowestGapCached, gapMemoSize, clearGapMemo, GAP_MEMO_MAX } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

const prims = (tpl, W = 7, H = 9) => buildRibbonPrimitives(frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: W, heightIn: H } }, 0, 0).primitives);
const lay = (p, preset = 'three_band') => JSON.stringify(bricksContourBands(p, FRAME_PRESETS[preset], { set: BRICK_SETS[0], seed: 1, scale: 0.75 / BRICK_SETS[0].brickLengthIn }));

describe('narrowestGapCached', () => {
  it('the same number as narrowestGap, on its first and its remembered call', () => {
    const boards = [
      [{ x: 0, y: 0 }, { x: 7, y: 0 }, { x: 7, y: 9 }, { x: 0, y: 9 }],
      [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 8 }, { x: 0, y: 8 }],
    ];
    clearGapMemo();
    for (const b of boards) {
      const direct = narrowestGap(b);
      expect(narrowestGapCached(b)).toBe(direct);
      expect(narrowestGapCached(b.map((p) => ({ ...p })))).toBe(direct); // a new array, the same content
    }
    expect(gapMemoSize()).toBe(2);
  });
  it('bounded: never more than GAP_MEMO_MAX boards', () => {
    clearGapMemo();
    for (let k = 0; k < GAP_MEMO_MAX + 5; k++) narrowestGapCached([{ x: 0, y: 0 }, { x: 5 + k, y: 0 }, { x: 5 + k, y: 9 }, { x: 0, y: 9 }]);
    expect(gapMemoSize()).toBe(GAP_MEMO_MAX);
  });
  it('a lay on a warm cache is byte-identical to one on a cold cache; one entry per board', () => {
    for (const tpl of ['template_1', 'template_10', 'template_14']) {
      const p = prims(tpl);
      clearGapMemo();
      const cold = lay(p);
      expect(gapMemoSize()).toBe(1); // the lay read the gap through the cache
      const warm = lay(p);
      expect(gapMemoSize()).toBe(1);
      expect(warm).toBe(cold);
    }
  }, HEAVY_TEST_MS);
});

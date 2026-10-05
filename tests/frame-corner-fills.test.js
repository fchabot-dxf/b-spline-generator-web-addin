/**
 * Item 33, the quoin texture bug: every corner style's pieces carry a fill that resolves from the Frame element's
 * OWN set (the quoin block used to take a White-rocks sample, which the element's set cannot resolve -> flat colour).
 */
import { describe, it, expect } from 'vitest';
import {
  FRAME_CORNERS, frameBandsOf, buildRibbonPrimitives, resolvedSetFor, scaleFor, BRICK_SET_IDS,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { brickSetById } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js';
import { rectToPrimitives } from '../bspline-frame-builder/b-spline-gen/html/core/inset-window.js';

describe('item 33: every corner style’s pieces take their fill from the element’s own set', () => {
  const w = 6;
  for (const setId of BRICK_SET_IDS) {
    for (const corner of FRAME_CORNERS) {
      it(`set ${setId}, ${corner.id}: every piece’s sample resolves in that set`, () => {
        const s = { setId, brickLengthIn: 0.75, grout: { widthIn: 0.05 }, seed: 5, frameBandPreset: 'double_course', frameCorner: corner.id };
        const { frameBricks } = generateBricks({
          boardOutline: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: w }, { x: 0, y: w }],
          set: resolvedSetFor(s), scale: scaleFor(s), suppression: 0, clumping: 0, seed: s.seed, skipWallFill: true,
          frame: { primitives: buildRibbonPrimitives(rectToPrimitives({ x1: 0, y1: 0, x2: w, y2: w })), bands: frameBandsOf(s) },
        });
        const ids = new Set(brickSetById(setId).samples.map((x) => x.id));
        expect(frameBricks.length).toBeGreaterThan(0);
        expect(frameBricks.filter((b) => !ids.has(b.sampleId)).map((b) => b.sampleId)).toEqual([]);
      });
    }
  }
});

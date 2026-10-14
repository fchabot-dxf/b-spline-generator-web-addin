/**
 * Test new brick frame presets across a wide spectrum of frame shapes/templates:
 * - Rectangle (rect)
 * - Hourglass concave waist (template_1)
 * - Round arch top (template_2)
 * - Gothic pointed arch (template_3)
 * - Rounded rectangle (template_4)
 * - Oval / ellipse (template_5)
 * - Scalloped / multi-foil (template_6)
 * - Octagonal / chamfered (template_7)
 * - Tabbed stepped corners (template_8)
 * - Pediment / crowned top (template_9)
 * - Complex waist contour (template_12)
 * - Baroque / curved contour (template_18)
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { rectToPrimitives } from '../bspline-frame-builder/b-spline-gen/html/core/inset-window.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });

const NEW_PRESETS = [
  'craftsman_apron',
  'double_soldier',
  'english_frame',
  'stepped_fret',
  'craftsman_apron_quoin',
  'double_soldier_quoin',
];

const TEMPLATES = [
  'rect',
  'template_1',
  'template_2',
  'template_3',
  'template_4',
  'template_5',
  'template_6',
  'template_7',
  'template_8',
  'template_9',
  'template_12',
  'template_18',
];

const W = 8, H = 10;
const SET = BRICK_SETS[0];

function primitivesOf(board) {
  if (board === 'rect') return buildRibbonPrimitives(rectToPrimitives({ x1: 0, y1: 0, x2: W, y2: H }));
  const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: board }), board: { widthIn: W, heightIn: H } }, 0, 0);
  return buildRibbonPrimitives(sil.primitives);
}

describe('New brick frame presets laid across frame shapes', () => {
  it.each(TEMPLATES)('lays all new presets cleanly on shape %s', (shape) => {
    const prims = primitivesOf(shape);
    expect(prims.length).toBeGreaterThan(0);

    for (const presetId of NEW_PRESETS) {
      const bands = FRAME_PRESETS[presetId];
      expect(bands, `preset ${presetId} should be defined`).toBeDefined();

      const res = generateBricks({
        boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }],
        set: SET,
        seed: 1,
        scale: 1,
        suppression: 0,
        clumping: 0,
        frame: { primitives: prims, bands },
      });

      expect(res.frameBricks.length, `${shape} with ${presetId} should produce frame bricks`).toBeGreaterThan(0);

      // Verify every frame piece has valid geometry
      for (const b of res.frameBricks) {
        expect(b.polygon.length, 'polygon should have >= 3 vertices').toBeGreaterThanOrEqual(3);
        for (const pt of b.polygon) {
          expect(Number.isFinite(pt.x), 'pt.x is finite').toBe(true);
          expect(Number.isFinite(pt.y), 'pt.y is finite').toBe(true);
        }
      }

      // Verify interior wall bricks exist and are cleanly bounded
      expect(res.bricks.length, `${shape} with ${presetId} should produce interior wall bricks`).toBeGreaterThan(0);
      for (const b of res.bricks) {
        expect(b.polygon.length, 'wall brick polygon >= 3 vertices').toBeGreaterThanOrEqual(3);
        for (const pt of b.polygon) {
          expect(Number.isFinite(pt.x)).toBe(true);
          expect(Number.isFinite(pt.y)).toBe(true);
        }
      }
    }
  });
});

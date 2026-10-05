/**
 * F35 item 33 (seat 37): quoin corner blocks took their sample from the White rocks set while the app looks every
 * piece's sampleId up in the ELEMENT's set -- so on a red frame every quoin drew a flat colour. The block keeps
 * QUOIN_SET's size (geometry) and now takes its texture from the band's own set.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { FRAME_PRESETS, BRICK_SETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

describe('quoin blocks wear their frame set texture (F35 item 33)', () => {
  for (const set of BRICK_SETS.filter((s) => s.layout === 'bond' && s.samples && s.samples.length)) {
    it(`${set.name}: every piece of a quoin_corners frame on T1 has a sample from ${set.name}`, () => {
      const record = normalizeFrameRecord({ templateId: 'template_1' });
      const sil = frameContourSilhouette({ defs: FRAME_DEFS, record, board: { widthIn: 7, heightIn: 9 } }, 0, 0);
      const { bricks } = bricksContourBands(buildRibbonPrimitives(sil.primitives), FRAME_PRESETS.quoin_corners, { set, seed: 1 });
      const own = new Set(set.samples.map((s) => s.id));
      const foreign = bricks.filter((b) => b.sampleId && !own.has(b.sampleId)).map((b) => `${b.id}:${b.sampleId}`);
      expect(bricks.length).toBeGreaterThan(0);
      expect(foreign).toEqual([]);
    });
  }
});

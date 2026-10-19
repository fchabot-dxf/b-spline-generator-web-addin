/**
 * Fred 2026-10-18 (mid-course blocks UI): blocksRefusal(editor, settings, frameGeom, blocks) asks the REAL engine whether a
 * declared block would be laid -- one dry pass, nothing drawn -- so the panel can refuse a spot BEFORE it writes a block.
 * Real frame geometry (T1 7 x 10, the hourglass), the engine's own reasons (core/bricks/frame-blocks.js), the editor reduced to
 * what the lay reads (board size, no strokes). No block / absent = the same lay as before.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { blocksRefusal, buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

const W = 7, H = 10;
const prims = buildRibbonPrimitives(frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: 'template_1' }), board: { widthIn: W, heightIn: H } }, 0, 0).primitives);
const editor = { _mW: W, _mH: H, _sketchLayer: { children: () => ({ toArray: () => [] }), node: { querySelector: () => null, querySelectorAll: () => [] } } };
const frameGeom = { primitives: prims, bands: FRAME_PRESETS.single_soldier };
const settings = { ...P.brickSettings, brickLengthIn: 1.25, frameBandPreset: 'single_soldier', suppression: 0, clumping: 0, seed: 1, frameBlocks: [] };
const ask = (blocks) => blocksRefusal(editor, settings, frameGeom, blocks);

describe('blocksRefusal: the engine decides, on real frame geometry', () => {
  it('a spot on the top run is accepted (nothing skipped)', () => {
    expect(ask([{ id: 'b1', x: 3.5, y: 0.3 }])).toEqual([]);
  });
  it('a spot at the top-left corner is refused: too near a corner (MEASURED, T1 7 x 10 at 1.25 in)', () => {
    expect(ask([{ id: 'b1', x: 0.2, y: 0.3 }])).toEqual([{ id: 'b1', why: 'too near a corner' }]);
    expect(ask([{ id: 'b1', x: 6.5, y: 9.7 }])).toEqual([{ id: 'b1', why: 'too near a corner' }]);
  });
  it('a spot on the left side where the frame has no run of the outer band is refused: no run here', () => {
    expect(ask([{ id: 'b1', x: 0.2, y: 5 }])).toEqual([{ id: 'b1', why: 'no run here' }]);
  });
  it('the accepted block of a pair is not reported: only the refused one is', () => {
    expect(ask([{ id: 'b1', x: 3.5, y: 0.3 }, { id: 'b2', x: 0.2, y: 0.3 }])).toEqual([{ id: 'b2', why: 'too near a corner' }]);
  });
  it('no frame element (a Wall-only board): nothing to ask, nothing refused', () => {
    expect(blocksRefusal(editor, settings, { ...frameGeom, noFrameElement: true }, [{ id: 'b1', x: 3.5, y: 5 }])).toEqual([]);
    expect(blocksRefusal(editor, settings, null, [{ id: 'b1', x: 3.5, y: 5 }])).toEqual([]);
  });
});

/**
 * SE3a — regression guard: a layer with no content must lose its mask.
 *
 * Before this fix, updateStampMasks (main/stamp-mask-manager.js) built a
 * work list of layers that HAVE content and returned early when the list
 * was empty, leaving any layer that had just lost its content (Clear, or
 * an edit that emptied it) with a stale `_mask` / `P.stampLayers[i].mask`
 * forever — the reported symptom (Clear -> Apply still shows the old carve).
 *
 * Two things are exercised here:
 *  1. `clearEmptyLayerMasks` directly — the invariant factored out as its
 *     own pure-ish function specifically so it's testable without mocking
 *     rasterizeSvg / scheduleRebuild / getLayerSvg.
 *  2. `updateStampMasks` end to end, for the ALL-LAYERS-EMPTY scenario
 *     (the exact Clear -> Apply regression) — this is the one scenario
 *     `updateStampMasks` can be exercised for real here: any layer WITH
 *     content would hit the real rasterizer (core/stamp/index.js), which
 *     creates a canvas and calls `.getContext('2d', {willReadFrequently})`.
 *     Checked empirically: this test environment's canvas.getContext('2d')
 *     returns null (no 2D context backend installed), so a mixed
 *     one-content/one-empty case can't be driven through updateStampMasks
 *     itself without crashing on that null context — exactly the
 *     "un-mockable, test the extracted invariant function instead" case
 *     the dispatch anticipated. (1) covers that mixed case at the pure-
 *     invariant level instead.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  clearEmptyLayerMasks,
  updateStampMasks,
} from '../bspline-frame-builder/b-spline-gen/html/main/stamp-mask-manager.js';

describe('clearEmptyLayerMasks', () => {
  beforeEach(() => {
    P.stampLayers = [];
  });

  it('clears both the editor layer\'s _mask and its P.stampLayers mirror for an emptied layer, and leaves a layer WITH content untouched', () => {
    const editorLayers = [
      { id: '0', _mask: { body: new Float32Array(4) } },   // has content — not in emptyIdxs
      { id: '1', _mask: { body: new Float32Array(4) } },   // just lost its content — stale mask
    ];
    P.stampLayers = [
      { svg: '<svg/>', mask: { body: new Float32Array(4) }, enabled: true },
      { svg: null, mask: { body: new Float32Array(4) }, enabled: false }, // stale mirror mask
    ];

    clearEmptyLayerMasks(editorLayers, [1]);

    expect(editorLayers[0]._mask).not.toBeNull();       // untouched — it still has content
    expect(editorLayers[1]._mask).toBeNull();            // SE3a: the invariant
    expect(P.stampLayers[0].mask).not.toBeNull();
    expect(P.stampLayers[1].mask).toBeNull();            // the mirror the compositor's `||` fallback reads
  });

  it('is a no-op when emptyIdxs is empty', () => {
    const editorLayers = [{ id: '0', _mask: 'x' }];
    P.stampLayers = [{ svg: '<svg/>', mask: 'x', enabled: true }];

    clearEmptyLayerMasks(editorLayers, []);

    expect(editorLayers[0]._mask).toBe('x');
    expect(P.stampLayers[0].mask).toBe('x');
  });

  it('tolerates an index with no P.stampLayers mirror at that position', () => {
    const editorLayers = [{ id: '0', _mask: 'stale' }];
    P.stampLayers = []; // no mirror at all

    expect(() => clearEmptyLayerMasks(editorLayers, [0])).not.toThrow();
    expect(editorLayers[0]._mask).toBeNull();
  });
});

describe('updateStampMasks: the Clear -> Apply regression (all layers empty)', () => {
  beforeEach(() => {
    P.stampLayers = [];
    if (typeof window !== 'undefined') window.svgEditor = null;
  });

  it('clears a stale mask on a visible editor layer that now has no content', async () => {
    const editor = {
      _draw: {},
      _sketchLayer: { node: { innerHTML: '' } }, // empty sketch — no data-layer children anywhere
      _mW: 7,
      _mH: 9,
      _layers: [
        { id: '0', visible: true, _mask: { body: new Float32Array(4) } }, // stale — the bug
      ],
      _activeLayer: '0',
    };
    window.svgEditor = editor;
    P.stampLayers = [
      { svg: null, mask: { body: new Float32Array(4) }, enabled: false }, // stale mirror too
    ];

    const isLatest = await updateStampMasks(4, 4);

    expect(isLatest).toBe(true);
    expect(editor._layers[0]._mask).toBeNull();
    expect(P.stampLayers[0].mask).toBeNull();
  });

  it('does not touch a HIDDEN layer\'s mask even though it\'s also absent from the work list', async () => {
    const editor = {
      _draw: {},
      _sketchLayer: { node: { innerHTML: '' } },
      _mW: 7,
      _mH: 9,
      _layers: [
        { id: '0', visible: false, _mask: { body: new Float32Array(4) } }, // hidden, not empty — keep its mask
      ],
      _activeLayer: '0',
    };
    window.svgEditor = editor;
    P.stampLayers = [];

    await updateStampMasks(4, 4);

    expect(editor._layers[0]._mask).not.toBeNull();
  });
});

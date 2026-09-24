/**
 * SE3a — regression guard: a layer with no content must lose its mask.
 *
 * Before this fix, updateStampMasks (main/stamp-mask-manager.js) built a
 * work list of layers that HAVE content and returned early when the list
 * was empty, leaving any layer that had just lost its content (Clear, or
 * an edit that emptied it) with a stale `_mask` forever — the reported
 * symptom (Clear -> Apply still shows the old carve).
 *
 * SE4b: clearEmptyLayerMasks no longer touches a P.stampLayers mirror —
 * that content mirror is retired (SE4-MIRROR-RETIREMENT-DESIGN.md slice
 * b). These assertions were simplified to the single (editor) store.
 *
 * SE10 AMEND: the HIDDEN-layer case below changed — updateStampMasks'
 * own gate moved from `visible` to `carve` (a layer can carve while
 * hidden now), so a hidden-but-carving EMPTY layer is no longer exempt
 * from this same stale-mask-clearing invariant; a carve:false layer is
 * the new "exempt from this loop entirely" case instead.
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

  it('clears the editor layer\'s _mask for an emptied layer, and leaves a layer WITH content untouched', () => {
    const editorLayers = [
      { id: '0', _mask: { body: new Float32Array(4) } },   // has content — not in emptyIdxs
      { id: '1', _mask: { body: new Float32Array(4) } },   // just lost its content — stale mask
    ];

    clearEmptyLayerMasks(editorLayers, [1]);

    expect(editorLayers[0]._mask).not.toBeNull();       // untouched — it still has content
    expect(editorLayers[1]._mask).toBeNull();            // SE3a: the invariant
  });

  it('is a no-op when emptyIdxs is empty', () => {
    const editorLayers = [{ id: '0', _mask: 'x' }];

    clearEmptyLayerMasks(editorLayers, []);

    expect(editorLayers[0]._mask).toBe('x');
  });

  it('tolerates an emptyIdxs entry with no matching editorLayers slot', () => {
    const editorLayers = [{ id: '0', _mask: 'stale' }];

    expect(() => clearEmptyLayerMasks(editorLayers, [0, 5])).not.toThrow();
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

    const isLatest = await updateStampMasks(4, 4);

    expect(isLatest).toBe(true);
    expect(editor._layers[0]._mask).toBeNull();
  });

  // SE10 AMEND: CARVE, not SHOW, gates this loop now — a hidden layer
  // carves by default (carve undefined -> true), so it's no longer
  // exempt from the SAME "empty -> stale mask cleared" invariant every
  // other layer gets. Being hidden was never the REAL reason the old
  // gate spared a layer's mask; it was just how "visible === false"
  // happened to short-circuit before this layer's emptiness was ever
  // checked. Replaces the old (now-incorrect) expectation that a hidden
  // layer's mask survives regardless of content.
  it('SE10: a HIDDEN layer that also has NO content still gets its stale mask cleared (carve, not visible, gates emptiness now)', async () => {
    const editor = {
      _draw: {},
      _sketchLayer: { node: { innerHTML: '' } },
      _mW: 7,
      _mH: 9,
      _layers: [
        { id: '0', visible: false, _mask: { body: new Float32Array(4) } }, // hidden AND empty — carve defaults true, so it's checked
      ],
      _activeLayer: '0',
    };
    window.svgEditor = editor;
    P.stampLayers = [];

    await updateStampMasks(4, 4);

    expect(editor._layers[0]._mask).toBeNull();
  });

  it('SE10: a carve:false layer is exempt from this loop entirely — its mask survives even though it has no content', async () => {
    const editor = {
      _draw: {},
      _sketchLayer: { node: { innerHTML: '' } },
      _mW: 7,
      _mH: 9,
      _layers: [
        { id: '0', visible: true, carve: false, _mask: { body: new Float32Array(4) } }, // not carved — gate skips it before emptiness is even checked
      ],
      _activeLayer: '0',
    };
    window.svgEditor = editor;
    P.stampLayers = [];

    await updateStampMasks(4, 4);

    expect(editor._layers[0]._mask).not.toBeNull();
  });
});

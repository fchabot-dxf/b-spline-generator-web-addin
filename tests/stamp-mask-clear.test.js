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
 * T27 FINAL: updateStampMasks' gate reads isCarved(layer) — visible is
 * the master, so a HIDDEN layer is exempt from this loop entirely again
 * (its mask is never touched, built or cleared), same as before SE10's
 * independent-axes design. A carve:false-but-visible layer is the other
 * "exempt, gate skips it before emptiness is even checked" case.
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

  // T27 FINAL: visible is the MASTER — isCarved(layer) is false for any
  // hidden layer regardless of its own carve flag, so the gate skips it
  // before its emptiness is ever checked. A hidden layer's mask is never
  // touched (built or cleared) by this loop, same as pre-SE10.
  it('T27: a HIDDEN layer is exempt from this loop entirely, even with no content — its stale mask survives (visible is the master, gates before emptiness is checked)', async () => {
    const editor = {
      _draw: {},
      _sketchLayer: { node: { innerHTML: '' } },
      _mW: 7,
      _mH: 9,
      _layers: [
        { id: '0', visible: false, _mask: { body: new Float32Array(4) } }, // hidden AND empty — isCarved false regardless of carve
      ],
      _activeLayer: '0',
    };
    window.svgEditor = editor;
    P.stampLayers = [];

    await updateStampMasks(4, 4);

    expect(editor._layers[0]._mask).not.toBeNull();
  });

  it('T27: a visible carve:false layer is exempt from this loop entirely — its mask survives even though it has no content', async () => {
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

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
  clearStampMaskInWindow,
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

/**
 * T82 item 2 (INSET-WINDOW-DESIGN.md): a stamp cannot carve material that isn't there -- the frame's inset
 * window is a literal hole through the panel, so the rasterized mask must read zero inside it. Tested at
 * the pure `clearStampMaskInWindow` level (same constraint as the describe block above: this test
 * environment's canvas.getContext('2d') returns null, so a real rasterizeSvg pass can't run here).
 */
describe('clearStampMaskInWindow', () => {
  const fresh = (n) => ({ body: new Float32Array(n).fill(1), fillet: new Float32Array(n).fill(1), isStamped: new Uint8Array(n).fill(1) });

  it('is a no-op when there is no window (hole is null)', () => {
    const result = fresh(25);
    const out = clearStampMaskInWindow(result, null, 5, 5, 4, 4);
    expect(out).toBe(result);
    expect(Array.from(result.body)).toEqual(new Array(25).fill(1));
  });

  // MEASURED, not assumed: rasterizeSvg's own grid row is Y-FLIPPED relative to board inches (row 0 = board
  // BOTTOM, row nz-1 = board TOP -- core/coords.js's gridRowToRasterY/rasterYToGridRow, the same convention
  // core/render-topview.js's own top view already reads back by). A hole over the TOP half of the board
  // (y in [0,2] of a 4in-tall board) must therefore clear the HIGH-numbered rows, not row 0 -- getting this
  // backwards would clear the wrong physical half of the panel.
  it('row mapping is Y-FLIPPED: a hole over the board\'s TOP half (y in [0,2] of 4in) clears grid rows 2-4, not 0-1', () => {
    const nx = 5, nz = 5, widthIn = 4, heightIn = 4;
    const hole = { x1: 0, y1: 0, x2: 4, y2: 2 };
    const result = fresh(nx * nz);
    clearStampMaskInWindow(result, hole, nx, nz, widthIn, heightIn);
    for (let j = 0; j < nz; j++) {
      const expectCleared = j >= 2; // y(j) = 4*(1 - j/4): j=0->y=4 (bottom), j=4->y=0 (top)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        expect(result.body[k]).toBe(expectCleared ? 0 : 1);
        expect(result.fillet[k]).toBe(expectCleared ? 0 : 1);
        expect(result.isStamped[k]).toBe(expectCleared ? 0 : 1);
      }
    }
  });

  // Column mapping is a DIRECT, un-flipped x/widthIn (rasterizeSvg's own `fx` formula) -- a hole over the
  // board's LEFT half (x in [0,2] of 4in) clears the LOW-numbered columns, the mirror check to the row test
  // above so a flip bug in either axis alone would be caught.
  it('column mapping is direct (no flip): a hole over the board\'s LEFT half (x in [0,2] of 4in) clears columns 0-2, not 3-4', () => {
    const nx = 5, nz = 5, widthIn = 4, heightIn = 4;
    const hole = { x1: 0, y1: 0, x2: 2, y2: 4 };
    const result = fresh(nx * nz);
    clearStampMaskInWindow(result, hole, nx, nz, widthIn, heightIn);
    for (let i = 0; i < nx; i++) {
      const expectCleared = i <= 2; // x(i) = i/4*4 = i
      for (let j = 0; j < nz; j++) {
        expect(result.body[j * nx + i]).toBe(expectCleared ? 0 : 1);
      }
    }
  });
});

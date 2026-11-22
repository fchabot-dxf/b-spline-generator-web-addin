/**
 * HEIGHT-PAINTER slice 3: the MOVE tool (Photoshop semantics; Fred 2026-11-22 "even if height map is pixel we can still have
 * a select or move tool"). core/height/move.js is the pixel work (lift / place / shift a mask); main/height-panel.js runs it
 * as the HEIGHT_TOOLS 'move' gesture:
 *  - with a selection a drag LIFTS the selected pixels (the mask's soft edge included) into a floating piece; it stays
 *    floating after the release; Enter / a tool switch / another action DROPS it (normal blend over what is there, the hole
 *    = 0, transparent); Esc cancels; the selection moves with the piece; arrows nudge 1 px (Shift: 10 px);
 *  - with no selection the drag moves the whole active layer (pixels pushed off the patch are lost on the drop);
 *  - Alt+drag moves the marquee only;
 *  - each drop = ONE undo step.
 * Raster frame (core/height/layer.js): pixel (c, r), row 0 = the patch's BOTTOM edge; editor y is down.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { liftPiece, placePiece, shiftMask } from '../bspline-frame-builder/b-spline-gen/html/core/height/move.js';
import { rectMask } from '../bspline-frame-builder/b-spline-gen/html/core/height/selection.js';
import { f16Round, decodedRaster } from '../bspline-frame-builder/b-spline-gen/html/core/height/raster.js';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  initHeightPanel, newHeightPatch, activeHeightLayer, _resetHeightPanelForTests, setHeightTool, selectHeightRect, fillHeight,
  heightSelection, paintHeightStroke, HEIGHT_TOOLS, heightMoveState,
} from '../bspline-frame-builder/b-spline-gen/html/main/height-panel.js';
import { heightBrushHandler } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-height-tool.js';
import { setEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';

describe('core/height/move.js', () => {
  it('liftPiece: the hole is the layer x (1 - mask) (a hard mask leaves 0); the piece keeps the values; its box', () => {
    const cols = 6, rows = 4, d = new Float32Array(cols * rows).fill(0.5);
    const m = rectMask(cols, rows, 1, 1, 2, 2);
    m[0] = 0.25; // a soft pixel
    const f = liftPiece(d, cols, rows, m);
    expect(f.hole[1 * cols + 1]).toBe(0);
    expect(f.hole[0]).toBe(Math.fround(0.5 * 0.75));
    expect(f.hole[3 * cols + 5]).toBe(0.5);
    expect(f.piece[1 * cols + 1]).toBe(0.5);
    expect(f.box).toEqual({ c0: 0, r0: 0, c1: 2, r1: 2 });
    expect(d[1 * cols + 1]).toBe(0.5); // the input is untouched
  });
  it('placePiece: normal blend over the hole at the offset; a 0 pixel of the piece is transparent; off the grid = lost', () => {
    const cols = 6, rows = 4, d = new Float32Array(cols * rows);
    d[1 * cols + 1] = 0.4; d[1 * cols + 2] = 0;   // the piece: one raised pixel and one transparent one
    d[1 * cols + 3] = 0.1;                         // something already there, under where the soft pixel lands
    d[1 * cols + 4] = 0.9;                         // and under where the transparent pixel lands
    const m = rectMask(cols, rows, 1, 1, 2, 1);
    m[1 * cols + 1] = 0.5;                         // a soft edge: half
    const f = liftPiece(d, cols, rows, m);
    const out = new Float32Array(cols * rows);
    placePiece(f, 2, 0, out);
    expect(out[1 * cols + 3]).toBe(Math.fround(Math.fround(0.1) * 0.5 + Math.fround(0.4) * 0.5)); // normal: under (1 - a) + v a
    expect(out[1 * cols + 4]).toBe(Math.fround(0.9));                                  // a transparent pixel never covers
    expect(out[1 * cols + 1]).toBe(Math.fround(0.2));                                  // the hole: 0.4 x (1 - 0.5)
    placePiece(f, 10, 0, out);                                                          // all off the grid
    expect(out[1 * cols + 1]).toBe(Math.fround(0.2));
    expect(out.filter((v) => v !== 0).length).toBe(3); // the hole's soft pixel + the 0.1 + the 0.9
  });
  it('shiftMask: moved by whole pixels; what leaves the grid is lost, what comes in is 0', () => {
    const m = rectMask(5, 3, 0, 0, 1, 0);
    const s = shiftMask(m, 5, 3, 3, 1);
    expect(s[1 * 5 + 3]).toBe(1); expect(s[1 * 5 + 4]).toBe(1); expect(s[0]).toBe(0);
    expect(shiftMask(m, 5, 3, 4, 0).reduce((a, v) => a + v, 0)).toBe(1); // one pixel pushed off
  });
});

describe('the Move tool in the panel', () => {
  const saved = {};
  const at = (d, c, r) => d[r * 200 + c];
  const key = (k, extra = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
  let ed;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    Object.assign(saved, { hl: P.heightLayers, w: P.widthIn, h: P.heightIn });
    P.widthIn = 2; P.heightIn = 2; P.heightLayers = DEFAULT.heightLayers;
    document.body.innerHTML = '<div id="svgEditorModal" style="display:flex"><div id="editorCanvasContainer"></div><button id="editorApply"></button><button id="editorCancel"></button></div><div id="heightPanelBody"></div><div id="editorToolbarHeight"></div>';
    _resetHeightPanelForTests();
    ed = window.svgEditor = { _undoStack: [], _currentMode: 'select', setMode(m) { this._currentMode = m; }, pushState() { this._undoStack.push({}); }, _notifyChange() {} };
    initHeightPanel({});
    setEditorTab('height');
  });
  afterEach(() => { P.heightLayers = saved.hl; P.widthIn = saved.w; P.heightIn = saved.h; delete window.svgEditor; setEditorTab('artwork'); vi.useRealTimers(); });

  /** a 0.2 in block at c 50..99, r 50..99 (board X -0.5..0, Y -0.5..0), left selected */
  async function block() {
    await newHeightPatch(); // 200 x 200 over the 2 x 2 in board
    selectHeightRect([-0.5, -0.5], [0, 0]);
    await fillHeight({ heightIn: 0.2 });
  }
  async function drag(p0, p1, e = {}) {
    heightBrushHandler.start(ed, p0, e);
    heightBrushHandler.update(ed, p1, e);
    return heightBrushHandler.finish(ed);
  }

  it('is a declared tool with its rail button', () => {
    expect(HEIGHT_TOOLS.map((t) => t.id)).toContain('move');
    expect(document.querySelector('#editorToolbarHeight [data-height-tool="move"]')).toBeTruthy();
  });

  it('a drag lifts the selection; it floats after the release (nothing stored); Enter drops it: ONE step, the selection follows', async () => {
    await block();
    const h0 = activeHeightLayer().raster.h, steps = ed._undoStack.length;
    setHeightTool('move');
    await drag({ x: 0.75, y: 1.25 }, { x: 1.05, y: 1.45 }); // +0.3 in right, 0.2 in down the screen: dc +30, dr -20
    expect(heightMoveState()).toMatchObject({ floating: true, dc: 30, dr: -20 });
    expect(activeHeightLayer().raster.h).toBe(h0);
    expect(ed._undoStack.length).toBe(steps);
    expect(document.getElementById('heightMoveBar').hidden).toBe(false); // Drop / Cancel while floating
    key('Enter');
    await vi.waitFor(() => expect(activeHeightLayer().raster.h).not.toBe(h0));
    expect(ed._undoStack.length).toBe(steps + 1);
    expect(heightMoveState().floating).toBe(false);
    const d = decodedRaster(activeHeightLayer().raster);
    expect(at(d, 100, 40)).toBe(f16Round(0.2)); expect(at(d, 129, 30)).toBe(f16Round(0.2)); // the new place: c 80..129, r 30..79
    expect(at(d, 60, 90)).toBe(0); expect(at(d, 90, 85)).toBe(0);                              // the hole left behind
    expect(at(d, 130, 40)).toBe(0); expect(at(d, 100, 29)).toBe(0);
    const sel = heightSelection().mask;
    expect(at(sel, 100, 40)).toBe(1); expect(at(sel, 60, 90)).toBe(0);
    expect(document.getElementById('heightMoveBar').hidden).toBe(true);
  });

  it('Esc cancels: everything back, no step; arrows nudge 1 px, Shift 10 px; a tool switch drops', async () => {
    await block();
    const h0 = activeHeightLayer().raster.h, steps = ed._undoStack.length;
    setHeightTool('move');
    await drag({ x: 0.75, y: 1.25 }, { x: 1.05, y: 1.25 });
    key('Escape');
    expect(heightMoveState().floating).toBe(false);
    expect(heightMoveState().tool).toBe('move'); // Esc cancels the move, it does not leave the tool
    expect(activeHeightLayer().raster.h).toBe(h0);
    expect(ed._undoStack.length).toBe(steps);
    expect(at(heightSelection().mask, 50, 50)).toBe(1);
    key('ArrowRight'); key('ArrowUp', { shiftKey: true });
    expect(heightMoveState()).toMatchObject({ floating: true, dc: 1, dr: 10 });
    setHeightTool('brush');
    await vi.waitFor(() => expect(activeHeightLayer().raster.h).not.toBe(h0));
    expect(ed._undoStack.length).toBe(steps + 1);
    const d = decodedRaster(activeHeightLayer().raster);
    expect(at(d, 100, 109)).toBe(f16Round(0.2)); expect(at(d, 50, 55)).toBe(0); expect(at(d, 51, 60)).toBe(f16Round(0.2));
  });

  it('no selection: the drag moves the whole layer; pixels pushed off the patch are lost on the drop', async () => {
    await newHeightPatch();
    await fillHeight({ heightIn: 0.1 }); // the whole layer
    setHeightTool('move');
    await drag({ x: 1, y: 1 }, { x: 1.5, y: 1 }); // +50 px
    key('Enter');
    await vi.waitFor(() => expect(heightMoveState().pending).toBe(0));
    await drag({ x: 1.5, y: 1 }, { x: 1, y: 1 }); // back -50 px
    key('Enter');
    await vi.waitFor(() => expect(heightMoveState().pending).toBe(0));
    const d = decodedRaster(activeHeightLayer().raster);
    expect(at(d, 10, 100)).toBe(f16Round(0.1)); expect(at(d, 149, 100)).toBe(f16Round(0.1));
    expect(at(d, 150, 100)).toBe(0); expect(at(d, 199, 3)).toBe(0); // the strip pushed off the right edge is gone
  });

  it('Alt+drag on a selection moves the marquee only: no pixel changes, no step', async () => {
    await block();
    const h0 = activeHeightLayer().raster.h, steps = ed._undoStack.length;
    setHeightTool('move');
    await drag({ x: 0.75, y: 1.25 }, { x: 1.25, y: 1.25 }, { altKey: true }); // +50 px
    expect(heightMoveState().floating).toBe(false);
    expect(activeHeightLayer().raster.h).toBe(h0);
    expect(ed._undoStack.length).toBe(steps);
    const m = heightSelection().mask;
    expect(at(m, 100, 60)).toBe(1); expect(at(m, 60, 60)).toBe(0);
  });

  it('the Drop / Cancel buttons (touch): Cancel puts it back, Drop stores it; each at least 28 px tall', async () => {
    await block();
    const h0 = activeHeightLayer().raster.h;
    setHeightTool('move');
    await drag({ x: 0.75, y: 1.25 }, { x: 1.05, y: 1.25 }, { pointerType: 'touch' });
    const drop = document.getElementById('heightMoveDrop'), cancel = document.getElementById('heightMoveCancel');
    for (const b of [drop, cancel]) expect(parseFloat(b.style.minHeight)).toBeGreaterThanOrEqual(28);
    cancel.click();
    expect(heightMoveState().floating).toBe(false);
    expect(activeHeightLayer().raster.h).toBe(h0);
    await drag({ x: 0.75, y: 1.25 }, { x: 1.05, y: 1.25 }, { pointerType: 'touch' });
    drop.click();
    await vi.waitFor(() => expect(activeHeightLayer().raster.h).not.toBe(h0));
  });

  it('the editor\'s Apply drops a floating piece (it is stored), its Cancel throws it away', async () => {
    await block();
    const h0 = activeHeightLayer().raster.h;
    setHeightTool('move');
    await drag({ x: 0.75, y: 1.25 }, { x: 1.05, y: 1.25 });
    document.getElementById('editorCancel').dispatchEvent(new Event('pointerdown'));
    expect(heightMoveState().floating).toBe(false);
    expect(activeHeightLayer().raster.h).toBe(h0);
    await drag({ x: 0.75, y: 1.25 }, { x: 1.05, y: 1.25 });
    document.getElementById('editorApply').dispatchEvent(new Event('pointerdown'));
    await vi.waitFor(() => expect(activeHeightLayer().raster.h).not.toBe(h0));
    expect(at(decodedRaster(activeHeightLayer().raster), 120, 60)).toBe(f16Round(0.2));
  });

  it('a drop is undone by ONE editor undo step (the raster before the lift comes back)', async () => {
    const { takeUndoParts, restoreUndoParts } = await import('../bspline-frame-builder/b-spline-gen/html/editor/undo-parts.js');
    ed.pushState = function () { this._undoStack.push(takeUndoParts()); };
    await block();
    const h0 = activeHeightLayer().raster.h, before = ed._undoStack.length;
    setHeightTool('move');
    await drag({ x: 0.75, y: 1.25 }, { x: 1.05, y: 1.25 });
    key('Enter');
    await vi.waitFor(() => expect(ed._undoStack.length).toBe(before + 1));
    restoreUndoParts(ed._undoStack[before - 1]);
    expect(activeHeightLayer().raster.h).toBe(h0);
  });

  it('a brush stroke while floating is impossible without leaving the tool: switching to the brush drops first', async () => {
    await block();
    setHeightTool('move');
    await drag({ x: 0.75, y: 1.25 }, { x: 1.05, y: 1.25 });
    setHeightTool('brush');
    await paintHeightStroke([[0.8, 0.8], [0.85, 0.8]], { sizeIn: 0.05 });
    const d = decodedRaster(activeHeightLayer().raster);
    expect(at(d, 100, 60)).toBe(f16Round(0.2)); // the dropped piece is in the stored raster under the new stroke
  });
});

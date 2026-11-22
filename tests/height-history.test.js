/**
 * HEIGHT-PAINTER slice 1: undo of a stroke restores the EXACT raster (same hash, same object). Two stacks hold it:
 *  - the global history (core/history.js): each stored raster is kept ONCE in the undo store under its content hash and a
 *    snapshot holds `{ ref: h }` in its place (the STL mesh store, extended by its declared table);
 *  - the editor's own undo (the Height tab lives in the editor): the 'heightLayers' undo part (editor/undo-parts.js) rides
 *    in each editor entry -- the copy-on-write list itself, so an entry costs a reference.
 * Saved files / sessions (persistableP) always carry the encoded raster, never a ref.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { P, DEFAULT, persistableP } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  takeSnapshot, unifiedUndo, unifiedRedo, ensureUndoBaseline, startHistoryAt, globalHistoryLog, globalRedoLog, historyBlobStoreSize, historyMeshStoreSize,
} from '../bspline-frame-builder/b-spline-gen/html/core/history.js';
import { encodeRaster } from '../bspline-frame-builder/b-spline-gen/html/core/height/raster.js';
import { takeUndoParts, restoreUndoParts } from '../bspline-frame-builder/b-spline-gen/html/editor/undo-parts.js';
import {
  newHeightPatch, paintHeightStroke, activeHeightLayer, _resetHeightPanelForTests, initHeightPanel,
} from '../bspline-frame-builder/b-spline-gen/html/main/height-panel.js';

const applySnapshot = (snap) => { for (const k of Object.keys(snap.P)) if (k !== 'editorSvg' && k !== 'frame') P[k] = snap.P[k]; };
/** the real editor's entry shape (editor.js _snapshotState: { svg, layers, activeLayer, parts }) and push / restore */
function fakeEditor() {
  return {
    _undoStack: [], _redoStack: [],
    _snapshotState() { return { svg: '', layers: [], activeLayer: null, parts: takeUndoParts() }; },
    pushState() { this._undoStack.push(this._snapshotState()); },
    _notifyChange() {},
    undo() { if (this._undoStack.length < 2) return; this._redoStack.push(this._undoStack.pop()); restoreUndoParts(this._undoStack[this._undoStack.length - 1].parts); },
  };
}
const saved = {};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  Object.assign(saved, { hl: P.heightLayers, w: P.widthIn, h: P.heightIn });
  P.widthIn = 2; P.heightIn = 3; P.heightLayers = DEFAULT.heightLayers;
  document.body.innerHTML = '<div id="heightPanelBody"></div><div id="editorToolbarHeight"></div>';
  _resetHeightPanelForTests();
  window.svgEditor = fakeEditor();
  initHeightPanel({});
  globalHistoryLog.length = 0; globalRedoLog.length = 0;
});
afterEach(() => {
  P.heightLayers = saved.hl; P.widthIn = saved.w; P.heightIn = saved.h;
  globalHistoryLog.length = 0; globalRedoLog.length = 0;
  delete window.svgEditor;
  vi.useRealTimers();
});

const STROKE = [[0, 0], [0.4, 0.3]]; // board inches from the centre
const BRUSH = { mode: 'raise', sizeIn: 0.3, hardness: 0.5, opacity: 1, flow: 1, amountIn: 0.1 };

describe('global undo / redo: the raster store', () => {
  it('a stroke, then Undo: the SAME raster object (same h) is back; Redo: the stroke\'s; snapshots hold a ref', async () => {
    const rec = await newHeightPatch();
    expect(rec.sizeIn).toEqual({ w: 2, h: 3 }); // default: the whole board
    expect(rec.raster.cols).toBe(200);
    expect(rec.raster.rows).toBe(300);
    const before = activeHeightLayer().raster;
    takeSnapshot('patch');
    await paintHeightStroke(STROKE, BRUSH);
    const after = activeHeightLayer().raster;
    expect(after.h).not.toBe(before.h);
    takeSnapshot('stroke');
    expect(globalHistoryLog[1].P.heightLayers[0].raster).toEqual({ ref: after.h });
    expect(historyBlobStoreSize('heightLayers')).toBe(2);
    expect(historyMeshStoreSize()).toBe(0); // the STL store is its own
    unifiedUndo(applySnapshot);
    expect(activeHeightLayer().raster).toBe(before);
    expect(activeHeightLayer().raster.h).toBe(before.h);
    unifiedRedo(applySnapshot);
    expect(activeHeightLayer().raster).toBe(after);
  });
  it('ensureUndoBaseline compares a raster by its h (a JSON copy of the board records no new baseline)', async () => {
    await newHeightPatch();
    takeSnapshot('patch');
    P.heightLayers = JSON.parse(JSON.stringify(P.heightLayers));
    expect(ensureUndoBaseline('x')).toBe(false);
    await paintHeightStroke(STROKE, BRUSH);
    expect(ensureUndoBaseline('x')).toBe(true);
  });
  it('rasters no snapshot references are dropped when the history starts over', async () => {
    await newHeightPatch();
    takeSnapshot('patch');
    for (let i = 0; i < 3; i++) { await paintHeightStroke([[i * 0.1, 0], [i * 0.1, 0.5]], BRUSH); takeSnapshot(`s${i}`); }
    expect(historyBlobStoreSize('heightLayers')).toBe(4);
    startHistoryAt('Loaded project');
    expect(historyBlobStoreSize('heightLayers')).toBe(1);
  });
  it('persistableP and the session carry the encoded raster after an undo, never a ref', async () => {
    const rec = await newHeightPatch();
    takeSnapshot('patch');
    await paintHeightStroke(STROKE, BRUSH);
    takeSnapshot('stroke');
    unifiedUndo(applySnapshot);
    const json = JSON.stringify(persistableP());
    expect(json).not.toMatch(/"ref"/);
    expect(persistableP().heightLayers[0].raster.data).toBe(rec.raster.data);
    expect(persistableP().heightLayers[0].raster.enc).toBe('f16-deflate-b64');
  });
});

describe('the editor undo (the Height tab is in the editor)', () => {
  it('each stroke is ONE editor undo step; the editor Undo restores the exact raster before it', async () => {
    const ed = window.svgEditor;
    await newHeightPatch();
    const h0 = activeHeightLayer().raster.h;
    const steps = ed._undoStack.length;
    await paintHeightStroke(STROKE, BRUSH);
    expect(ed._undoStack.length).toBe(steps + 1);
    const h1 = activeHeightLayer().raster.h;
    expect(h1).not.toBe(h0);
    ed.undo();
    expect(activeHeightLayer().raster.h).toBe(h0);
  });
});

it('encodeRaster is the stored shape the store recognises', async () => {
  const r = await encodeRaster(new Float32Array(4), 2, 2);
  expect(Object.keys(r).sort()).toEqual(['cols', 'data', 'enc', 'h', 'rows']);
});

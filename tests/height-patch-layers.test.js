/**
 * HEIGHT-PAINTER slice 2, step 1: LAYERS per patch (core/height/compose.js). A patch holds an ordered list of layers (bottom
 * first), each { id, name, kind, visible, opacity, blend, raster }; the patch's composite (the pass + the shaded view) is
 * the layers bottom-up with their blend + opacity. A slice-1 record (one `raster`) reads as ONE paint layer, normal,
 * opacity 1, WITHOUT being rewritten (AGENTS.md rule 3), and its composite is byte-identical to its raster (pinned to the
 * goldens measured on main @ 18af1d97 before this change).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { encodeRaster, decodedRaster, _resetRasterCacheForTests } from '../bspline-frame-builder/b-spline-gen/html/core/height/raster.js';
import { normaliseHeightLayer, heightPass, heightRastersReady, decodeHeightLayers, _resetHeightCachesForTests } from '../bspline-frame-builder/b-spline-gen/html/core/height/layer.js';
import {
  compositeLayers, patchComposite, patchLayers, patchGrid, compositeKey, PATCH_LAYER_BLENDS, _resetCompositeCacheForTests,
} from '../bspline-frame-builder/b-spline-gen/html/core/height/compose.js';
import { takeSnapshot, unifiedUndo, globalHistoryLog, globalRedoLog, historyBlobStoreSize } from '../bspline-frame-builder/b-spline-gen/html/core/history.js';
import { takeUndoParts, restoreUndoParts } from '../bspline-frame-builder/b-spline-gen/html/editor/undo-parts.js';
import {
  initHeightPanel, newHeightPatch, activeHeightLayer, paintHeightStroke, syncHeightTab, _resetHeightPanelForTests,
  addPaintLayer, removePatchLayer, movePatchLayer, selectPatchLayer, activePatchLayer, setPatchLayerField, setHeightField,
} from '../bspline-frame-builder/b-spline-gen/html/main/height-panel.js';

const sha = (a) => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex').slice(0, 16);
const F = (a) => Array.from(a);

/** The slice-1 golden record: a 2 x 1 in patch, a sloped disc (measured on main @ 18af1d97: h 14ie5wjnld2). */
async function slice1Record() {
  const cols = 200, rows = 100, data = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const u = -1 + (c + 0.5) / 100, v = -0.5 + (r + 0.5) / 100;
    if (Math.hypot(u - 0.5, v) <= 0.1) data[r * cols + c] = 0.2 + 0.001 * c - 0.0005 * r;
  }
  return { ...normaliseHeightLayer({}), id: 'hp1', sizeIn: { w: 2, h: 1 }, position: { x: 1, y: -1 }, rotation: 20, raster: await encodeRaster(data, cols, rows) };
}
const GRID = { nx: 41, nz: 41, widthIn: 4, heightIn: 4 };

beforeEach(() => { _resetRasterCacheForTests(); _resetHeightCachesForTests(); _resetCompositeCacheForTests(); });

describe('compositing: exact values on known rasters', () => {
  // dyadic values: every result is exact in Float32
  const base = Float32Array.from([0, 0.5, 0.5, 0.75]);
  const top = Float32Array.from([0.25, 0, 1, 0.5]);
  const two = (o) => F(compositeLayers([{ heights: base, visible: true, opacity: 1, blend: 'normal' }, { heights: top, visible: true, ...o }], 4));
  it('the declared blends', () => expect(PATCH_LAYER_BLENDS).toEqual(['normal', 'add', 'max', 'min', 'subtract']));
  it('normal: opacity 1 covers, 0.5 mixes; a 0 pixel of the top layer is transparent (the base shows)', () => {
    expect(two({ blend: 'normal', opacity: 1 })).toEqual([0.25, 0.5, 1, 0.5]);
    expect(two({ blend: 'normal', opacity: 0.5 })).toEqual([0.125, 0.5, 0.75, 0.625]);
  });
  it('add / subtract at 0.5, max / min at 1', () => {
    expect(two({ blend: 'add', opacity: 0.5 })).toEqual([0.125, 0.5, 1, 1]);
    expect(two({ blend: 'subtract', opacity: 1 })).toEqual([-0.25, 0.5, -0.5, 0.25]);
    expect(two({ blend: 'max', opacity: 1 })).toEqual([0.25, 0.5, 1, 0.75]);
    expect(two({ blend: 'min', opacity: 1 })).toEqual([0, 0.5, 0.5, 0.5]);
    expect(two({ blend: 'max', opacity: 0.5 })).toEqual([0.125, 0.5, 0.75, 0.75]);
  });
  it('a hidden layer adds nothing', () => {
    expect(two({ blend: 'normal', opacity: 1, visible: false })).toEqual(F(base));
  });
});

describe('a slice-1 record (one raster, no layers): pinned, never rewritten', () => {
  it('reads as ONE paint layer, normal, opacity 1, holding its raster', async () => {
    const rec = await slice1Record();
    const ls = patchLayers(rec);
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({ kind: 'paint', visible: true, opacity: 1, blend: 'normal' });
    expect(ls[0].raster).toBe(rec.raster);
    expect(patchGrid(rec)).toEqual({ cols: 200, rows: 100 });
    expect(compositeKey(rec)).toBe(rec.raster.h); // the slice-1 cache keys stay as they were
  });
  it('its composite IS its decoded raster, byte for byte (golden measured on main @ 18af1d97)', async () => {
    const rec = await slice1Record();
    expect(rec.raster.h).toBe('14ie5wjnld2');
    expect(sha(decodedRaster(rec.raster))).toBe('3492ef1f64ccf34c');
    expect(patchComposite(rec)).toBe(decodedRaster(rec.raster));
    expect(sha(patchComposite(rec))).toBe('3492ef1f64ccf34c');
  });
  it('its stamp pass is unchanged (golden measured on main @ 18af1d97)', async () => {
    const p = heightPass(await slice1Record(), GRID);
    expect(sha(p.mask.body)).toBe('53f34cf095f48f75');
    expect(sha(p.mask.isStamped)).toBe('17881a5897766a7a');
  });
  it('a layered record of that one raster (normal, opacity 1) stamps the same pass', async () => {
    const rec = await slice1Record();
    const { raster, ...rest } = rec;
    const layered = { ...rest, layers: [{ id: 'base', name: 'Paint 1', kind: 'paint', visible: true, opacity: 1, blend: 'normal', raster }] };
    const p = heightPass(layered, GRID);
    expect(sha(p.mask.body)).toBe('53f34cf095f48f75');
  });
  it('loading it (normalise, pass, readiness, decode, the panel) never rewrites the record', async () => {
    const rec = await slice1Record();
    const json = JSON.stringify(rec);
    P.heightLayers = [rec];
    const list = P.heightLayers;
    _resetRasterCacheForTests();
    expect(heightRastersReady(list)).toBe(false);
    await decodeHeightLayers(list);
    expect(heightRastersReady(list)).toBe(true);
    heightPass(rec, GRID);
    document.body.innerHTML = '<div id="heightPanelBody"></div><div id="editorToolbarHeight"></div>';
    _resetHeightPanelForTests();
    initHeightPanel({});
    syncHeightTab();
    expect(P.heightLayers).toBe(list);
    expect(P.heightLayers[0]).toBe(rec);
    expect(JSON.stringify(rec)).toBe(json);
    expect('layers' in rec).toBe(false);
    P.heightLayers = DEFAULT.heightLayers;
  });
});

describe('a layered patch: the composite, readiness and decode', () => {
  it('two paint layers composite with the top one\'s blend + opacity; a mapping-free key follows each layer', async () => {
    const a = await encodeRaster(Float32Array.from([0, 0.5, 0.5, 0.75]), 2, 2);
    const b = await encodeRaster(Float32Array.from([0.25, 0, 1, 0.5]), 2, 2);
    const rec = { id: 'p', sizeIn: { w: 1, h: 1 }, layers: [
      { id: 'l1', name: 'A', kind: 'paint', visible: true, opacity: 1, blend: 'normal', raster: a },
      { id: 'l2', name: 'B', kind: 'paint', visible: true, opacity: 0.5, blend: 'add', raster: b }] };
    expect(F(patchComposite(rec))).toEqual([0.125, 0.5, 1, 1]);
    const k = compositeKey(rec);
    expect(compositeKey({ ...rec, layers: [rec.layers[0], { ...rec.layers[1], opacity: 1 }] })).not.toBe(k);
    expect(F(patchComposite({ ...rec, layers: [rec.layers[0], { ...rec.layers[1], blend: 'max', opacity: 1 }] }))).toEqual([0.25, 0.5, 1, 0.75]);
    // not decoded yet -> not ready; the rebuild's decode makes it ready
    const cold = JSON.parse(JSON.stringify(rec));
    _resetRasterCacheForTests(); _resetCompositeCacheForTests();
    expect(heightRastersReady([cold])).toBe(false);
    await decodeHeightLayers([cold]);
    expect(heightRastersReady([cold])).toBe(true);
    expect(F(patchComposite(cold))).toEqual([0.125, 0.5, 1, 1]);
  });
});

// ── the panel: add / delete / reorder / visible / opacity / blend / select; the brush edits the selected layer ─────────
const applySnapshot = (snap) => { for (const k of Object.keys(snap.P)) if (k !== 'editorSvg' && k !== 'frame') P[k] = snap.P[k]; };
function fakeEditor() {
  return {
    _undoStack: [], _redoStack: [],
    _snapshotState() { return { svg: '', layers: [], activeLayer: null, parts: takeUndoParts() }; },
    pushState() { this._undoStack.push(this._snapshotState()); },
    _notifyChange() {},
    undo() { if (this._undoStack.length < 2) return; this._redoStack.push(this._undoStack.pop()); restoreUndoParts(this._undoStack[this._undoStack.length - 1].parts); },
  };
}
const BRUSH = { mode: 'raise', sizeIn: 0.3, hardness: 0.5, opacity: 1, flow: 1, amountIn: 0.1 };
describe('the Height panel layer list', () => {
  const saved = {};
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    Object.assign(saved, { hl: P.heightLayers, w: P.widthIn, h: P.heightIn });
    P.widthIn = 2; P.heightIn = 2; P.heightLayers = DEFAULT.heightLayers;
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

  it('a new patch stays slice-1 shaped; Add paint layer makes it layered (base kept), above the active one, active, ONE step', async () => {
    await newHeightPatch();
    expect('layers' in activeHeightLayer()).toBe(false);
    const base = activeHeightLayer().raster;
    const steps = window.svgEditor._undoStack.length;
    await addPaintLayer();
    const rec = activeHeightLayer();
    expect('raster' in rec).toBe(false);
    expect(rec.layers.map((l) => l.id)[0]).toBe('base');
    expect(rec.layers[0].raster).toBe(base);
    expect(rec.layers).toHaveLength(2);
    expect(rec.layers[1]).toMatchObject({ kind: 'paint', visible: true, opacity: 1, blend: 'normal' });
    expect(rec.layers[1].raster.cols).toBe(base.cols);
    expect(activePatchLayer().id).toBe(rec.layers[1].id);
    expect(window.svgEditor._undoStack.length).toBe(steps + 1);
    // the layers are listed by the editor layer stack now (its height row's sub-rows, tests/editor-layer-stack.test.js);
    // the Height panel's own layer rows retired (Fred 2026-11-24)
    expect(document.querySelector('[data-patch-layer-pick]')).toBeNull();
  });
  it('the brush paints ONLY the selected layer', async () => {
    await newHeightPatch();
    await addPaintLayer();
    const [b0, b1] = activeHeightLayer().layers.map((l) => l.raster);
    await paintHeightStroke([[0, 0], [0.3, 0]], BRUSH);
    let ls = activeHeightLayer().layers;
    expect(ls[0].raster).toBe(b0);
    expect(ls[1].raster.h).not.toBe(b1.h);
    selectPatchLayer('base');
    await paintHeightStroke([[0, 0.5], [0.3, 0.5]], BRUSH);
    ls = activeHeightLayer().layers;
    expect(ls[0].raster.h).not.toBe(b0.h);
    // the composite sums the two strokes (normal over 0 = the top layer where it is painted, else the base)
    const comp = patchComposite(activeHeightLayer());
    expect(Math.max(...comp)).toBeGreaterThan(0.09);
  });
  it('reorder up / down, hide, opacity, blend, delete; each ONE step; the composite follows', async () => {
    await newHeightPatch();
    await paintHeightStroke([[0, 0], [0.2, 0]], BRUSH);
    await addPaintLayer();
    const top = activePatchLayer().id;
    const steps = () => window.svgEditor._undoStack.length;
    let n = steps();
    movePatchLayer(top, -1);
    expect(activeHeightLayer().layers.map((l) => l.id)).toEqual([top, 'base']);
    expect(steps()).toBe(n + 1);
    movePatchLayer(top, +1);
    expect(activeHeightLayer().layers.map((l) => l.id)).toEqual(['base', top]);
    n = steps();
    setPatchLayerField('base', 'visible', false);
    expect(activeHeightLayer().layers[0].visible).toBe(false);
    expect(Math.max(...patchComposite(activeHeightLayer()))).toBe(0); // only the empty top layer shows
    setPatchLayerField('base', 'visible', true);
    selectPatchLayer('base');
    expect(setHeightField('layerOpacity', 0.5)).toBe(true);
    expect(activeHeightLayer().layers[0].opacity).toBe(0.5);
    expect(setHeightField('layerBlend', 'max')).toBe(true);
    expect(activeHeightLayer().layers[0].blend).toBe('max');
    expect(steps()).toBe(n + 4);
    removePatchLayer(top);
    expect(activeHeightLayer().layers.map((l) => l.id)).toEqual(['base']);
    expect(activePatchLayer().id).toBe('base');
  });
  it('undo of a layer edit restores the layer\'s raster (same hash, same object); snapshots hold each layer raster ONCE by ref', async () => {
    await newHeightPatch();
    await paintHeightStroke([[0, -0.5], [0.4, -0.5]], BRUSH); // the base differs from an unpainted layer
    await addPaintLayer();
    const before = activePatchLayer().raster;
    takeSnapshot('layer');
    await paintHeightStroke([[0, 0], [0.4, 0.3]], BRUSH);
    const after = activePatchLayer().raster;
    expect(after.h).not.toBe(before.h);
    takeSnapshot('stroke');
    const snapLayers = globalHistoryLog[1].P.heightLayers[0].layers;
    expect(snapLayers[1].raster).toEqual({ ref: after.h });
    expect(snapLayers[0].raster).toEqual({ ref: activeHeightLayer().layers[0].raster.h });
    expect(historyBlobStoreSize('heightLayers')).toBe(3); // the base, the unpainted layer, the stroke
    unifiedUndo(applySnapshot);
    expect(activeHeightLayer().layers[1].raster).toBe(before);
    expect(activeHeightLayer().layers[1].raster.h).toBe(before.h);
  });
  it('the editor undo (the Height tab is in the editor) restores a layer stroke exactly', async () => {
    const ed = window.svgEditor;
    await newHeightPatch();
    await addPaintLayer();
    const before = activePatchLayer().raster;
    await paintHeightStroke([[0, 0], [0.4, 0.3]], BRUSH);
    expect(activePatchLayer().raster.h).not.toBe(before.h);
    ed.undo();
    expect(activeHeightLayer().layers[1].raster).toBe(before);
  });
});

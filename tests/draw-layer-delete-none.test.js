/**
 * "draw cant be deleted? its there by default and empty, can we open with none?" (Fred 2026-11-27)
 * - the editor layer stack's Delete is offered for a Draw layer even when it is the ONLY editor layer (a Height patch / STL
 *   is not an editor layer, so a board whose only editor layer was an empty Draw could never lose it);
 * - deleting the last layer leaves the editor with NO layer, and nothing re-creates one (a render, a tab switch);
 * - the editor starts with no layer (initLayerControls used to pre-create an empty "Draw 1" -- the one on every fresh start);
 * - the first real drawing action still gets its layer (ensureActiveLayer).
 * Real shapes: the real layer-stack module and the real layers.js, an editor roster as the app keeps it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/history.js', async (orig) => ({ ...(await orig()), scheduleUndoSnapshot: vi.fn() }));
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  initLayerStack, rowMenuItems, rowSubject, stackItems, refreshEditorStack, refreshLayerStack, _resetLayerStackForTests,
} from '../bspline-frame-builder/b-spline-gen/html/main/layer-stack.js';
import { setEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';
import {
  addLayer, removeLayer, setLayerLocked, initLayerControls, ensureActiveLayer, getActiveLayer,
} from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';
import '../bspline-frame-builder/b-spline-gen/html/editor/editor-context-menu.js';

const $ = (id) => document.getElementById(id);
const DOM = '<div id="svgEditorModal" style="display:none"></div><div id="layerStackAddGrid"></div><div id="layerStackList"></div><span id="layerStackSummary"></span>'
  + '<div id="editorMobileDrawer"><div id="editorDrawerContent"><div id="editorLayerStack" class="ed-stack"><div class="ed-stack-head"><span id="editorLayerStackCount"></span>'
  + '<div id="editorLayerStackAddGrid"></div><button id="editorLayerStackFold"></button></div><div id="editorLayerStackList"></div></div><div id="editorDrawerBody"></div></div></div>';
const KEYS = ['stlLayers', 'heightLayers', 'layerOrder'];
const saved = {};
const item = (key) => stackItems().find((i) => i.key === key);
const settle = () => new Promise((r) => setTimeout(r, 0));
const mkEditor = (layers) => ({ _layers: layers, _activeLayer: layers.length ? layers[0].id : null, _sketchLayer: null, pushState: vi.fn(), _notifyChange: vi.fn(), _onChange: vi.fn() });
function mount(layers) {
  window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  document.body.innerHTML = DOM;
  window.svgEditor = mkEditor(layers);
  P.stlLayers = [];
  P.layerOrder = null;
  initLayerStack();
}
beforeEach(() => { for (const k of KEYS) saved[k] = P[k]; P.heightLayers = []; });
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete P[k]; else P[k] = saved[k]; }
  window.svgEditor = null;
  _resetLayerStackForTests();
  document.body.innerHTML = '';
});

describe('the only Draw layer can be deleted', () => {
  it('Delete is in the menu of a lone Draw layer (a Height patch is not an editor layer)', () => {
    P.heightLayers = [{ id: 'h', name: 'Height 1', layers: [{ id: 'a', name: 'Paint 1', kind: 'paint', raster: { cols: 1, rows: 1 } }] }];
    mount([{ id: '0', name: 'ew', visible: true, carve: true, depth: 0.25, profile: 'vbit', angle: 90 }]);
    expect(rowMenuItems(rowSubject(item('layer:0'))).map((m) => m.id)).toEqual(['rename', 'stamp', 'colour', 'lock', 'delete']);
  });

  it('a locked lone layer still has no Delete', () => {
    mount([{ id: '0', name: 'Draw 1', visible: true, carve: true, depth: 0.25, profile: 'vbit', angle: 90 }]);
    setLayerLocked(window.svgEditor, '0', true);
    expect(rowMenuItems(rowSubject(item('layer:0'))).map((m) => m.id)).not.toContain('delete');
  });

  it('deleting it leaves zero layers, and a render / tab switch does not re-create one', async () => {
    mount([{ id: '0', name: 'Draw 1', visible: true, carve: true, depth: 0.25, profile: 'vbit', angle: 90 }]);
    const del = rowMenuItems(rowSubject(item('layer:0'))).find((m) => m.id === 'delete');
    await del.run({ kind: 'layer', id: '0' });
    await settle();
    expect(window.svgEditor._layers).toEqual([]);
    expect(window.svgEditor._activeLayer).toBeNull();
    refreshEditorStack(); refreshLayerStack();
    for (const t of ['brick', 'artwork', 'height']) { try { setEditorTab(t); } catch { /* a tab the bare DOM cannot show */ } }
    refreshEditorStack();
    await settle();
    expect(window.svgEditor._layers).toEqual([]);
    expect(stackItems().some((i) => i.type === 'draw')).toBe(false);
  });
});

describe('the editor opens with no layer', () => {
  it('initLayerControls (the editor constructor) pre-creates no Draw layer', () => {
    document.body.innerHTML = '<div id="editorLayerList"></div>';
    const ed = { _layers: undefined, _activeLayer: undefined, pushState: vi.fn() };
    initLayerControls(ed);
    expect(ed._layers).toEqual([]);
    expect(ed._activeLayer ?? null).toBeNull();
  });

  it('a saved board that already holds an empty Draw layer keeps it (initLayerControls never rewrites a roster)', () => {
    document.body.innerHTML = '<div id="editorLayerList"></div>';
    const ed = { _layers: [{ id: '0', name: 'ew', visible: true }], _activeLayer: '0', pushState: vi.fn() };
    initLayerControls(ed);
    expect(ed._layers.map((l) => l.name)).toEqual(['ew']);
  });
});

describe('a drawing action with no layer creates one', () => {
  it('ensureActiveLayer (what a rect / line / text / paste calls first) makes "Draw 1" and activates it', () => {
    const ed = mkEditor([]);
    const id = ensureActiveLayer(ed);
    expect(ed._layers.map((l) => l.id)).toEqual([id]);
    expect(getActiveLayer(ed)).toBe(id);
    expect(ed._layers[0].name).toMatch(/^(Draw|Layer) 1$/);
  });

  it('after the last layer is deleted, the next drawing action creates a fresh one', () => {
    const ed = mkEditor([]);
    const first = addLayer(ed, { skipUndo: true });
    ed._activeLayer = first.id;
    removeLayer(ed, first.id);
    expect(ed._layers).toEqual([]);
    const id = ensureActiveLayer(ed);
    expect(ed._layers).toHaveLength(1);
    expect(getActiveLayer(ed)).toBe(id);
  });
});

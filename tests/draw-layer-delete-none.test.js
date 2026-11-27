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

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  const sq = (x, id) => ({ id, polygon: [{ x, y: 0 }, { x: x + 1, y: 0 }, { x: x + 1, y: 0.3 }, { x, y: 0.3 }] });
  return { ...actual, generateBricks: vi.fn(() => ({ bricks: [sq(1, 'w1'), sq(3, 'w2')], frameBricks: [sq(5, 'f1')] })) };
});
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
import { clearArtworkLayers } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-clear.js';
import { runBricks } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

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

/** An SVG.js-shaped sketch layer over a real DOM node (as brick-element-records.test.js). */
function brickEditor() {
  const node = document.createElement('div');
  const wrap = (el) => {
    const api = {
      node: el, type: el.tagName.toLowerCase(), fill: () => api, stroke: () => api,
      attr: (k, v) => { if (v === undefined) return el.getAttribute(k); el.setAttribute(k, String(v)); return api; },
      addClass: (c) => { el.classList.add(c); return api; }, removeClass: (c) => { el.classList.remove(c); return api; },
      hasClass: (c) => el.classList.contains(c), remove: () => { el.remove(); return api; },
    };
    return api;
  };
  const make = (tag) => () => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); node.appendChild(el); return wrap(el); };
  return {
    _draw: {}, _mW: 7, _mH: 9, _activeLayer: null, _layers: [], pushState: vi.fn(), _notifyChange: vi.fn(), _onChange: vi.fn(),
    _sketchLayer: {
      node,
      polygon: (pts) => { const w = make('polygon')(); w.node.setAttribute('points', pts); return w; },
      path: (d) => { const w = make('path')(); w.node.setAttribute('d', d); return w; },
      group: make('g'),
      children: () => { const arr = [...node.children].map(wrap); return { toArray: () => arr, forEach: (f) => arr.forEach(f), map: (f) => arr.map(f) }; },
    },
  };
}

describe('the Bricks row and a Brick part can be deleted (Fred 2026-11-27: bricks cant be deleted)', () => {
  const mountBricks = () => {
    window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
    document.body.innerHTML = DOM;
    const ed = brickEditor();
    window.svgEditor = ed;
    P.stlLayers = []; P.layerOrder = null;
    runBricks(ed, P.brickSettings, null); // a Wall + a Frame, each on its own brick layer
    initLayerStack();
    return ed;
  };
  it('the Bricks row has a menu with Delete; deleting removes every brick, record and brick layer in ONE undo step', async () => {
    const ed = mountBricks();
    const sub = rowSubject(item('bricks'));
    expect(sub.kind).toBe('bricks');
    expect(sub.ids.length).toBe(2);
    expect(ed._sketchLayer.node.querySelectorAll('[data-brick]').length).toBeGreaterThan(0);
    const items = rowMenuItems(sub);
    expect(items.map((m) => m.id)).toEqual(['delete']);
    const steps = ed.pushState.mock.calls.length;
    await items[0].run(sub);
    expect(ed._layers.filter((l) => l.brickKind)).toEqual([]);
    expect(ed._sketchLayer.node.querySelectorAll('[data-brick], [data-brick-record]').length).toBe(0);
    expect(ed.pushState.mock.calls.length - steps).toBe(1); // one snapshot: one Ctrl+Z restores it all
  });
  it('one Brick part (Wall) can be deleted: its layer and bricks go, the Frame part stays', async () => {
    const ed = mountBricks();
    const wall = ed._layers.find((l) => l.brickKind === 'wall');
    const sub = rowSubject(item('bricks'), wall.id);
    const del = rowMenuItems(sub).find((m) => m.id === 'delete');
    expect(del).toBeTruthy();
    await del.run(sub);
    expect(ed._layers.some((l) => l.brickKind === 'wall')).toBe(false);
    expect(ed._sketchLayer.node.querySelectorAll('[data-brick="wall"]').length).toBe(0);
    expect(ed._layers.some((l) => l.brickKind === 'frame')).toBe(true);
    expect(ed._sketchLayer.node.querySelectorAll('[data-brick="frame"]').length).toBeGreaterThan(0);
    // the last Brick part too (it was never the only layer)
    const frame = ed._layers.find((l) => l.brickKind === 'frame');
    const fsub = rowSubject(item('bricks'), frame.id);
    await rowMenuItems(fsub).find((m) => m.id === 'delete').run(fsub);
    expect(ed._layers).toEqual([]);
    expect(ed._sketchLayer.node.querySelectorAll('[data-brick]').length).toBe(0);
  });
});
describe('Clear > Artwork leaves no empty layer (a new file has no layers)', () => {
  it('with no layer kept, clearArtworkLayers makes none and no active layer', () => {
    const ed = brickEditor();
    const L = addLayer(ed, { skipUndo: true }); ed._activeLayer = L.id;
    ed._sketchLayer.rect = undefined;
    clearArtworkLayers(ed);
    expect(ed._layers).toEqual([]);
    expect(ed._activeLayer).toBeNull();
  });
});

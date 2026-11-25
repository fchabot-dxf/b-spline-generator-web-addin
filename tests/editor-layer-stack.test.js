/**
 * EDITOR LAYER STACK, phase 1 prototype (Fred 2026-11-23): the 2D editor's layer tabs become the SAME vertical stack as the
 * sidebar's LAYERS (main/layer-stack.js STACK_VIEWS.editor) -- one data (stackItems), one card look, one drag:
 *  - a fixed, locked Frame row first; then the layers in stamp order, split by the Thicken line; sub-layers (Brick parts,
 *    Height paint layers) as indented rows;
 *  - selecting a row = its type's own pick (the active layer / patch) + the editor shows its type's tab;
 *  - '+ Add layer' in the editor = the same mountIconGrid picker (ADD_PICKERS, inEditor);
 *  - per breakpoint (EDITOR_STACK_LAYOUTS): the phone folds the list to the selected row;
 *  - a NEW layer is named by its type ('Draw 1', ...: a first drawing on a board with a Wall and a Frame part was 'Layer 3').
 * Real shapes: the real palette markup for the placement, an editor roster as the app keeps it (brickKind layers, a
 * generated lattice), the real setEditorTab registry.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/history.js', async (orig) => ({ ...(await orig()), scheduleUndoSnapshot: vi.fn() }));
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  initLayerStack, stackSequence, STACK_VIEWS, EDITOR_FIXED_ROWS, EDITOR_STACK_LAYOUTS, ADD_PICKERS, LAYER_ADD_TYPES, LAYER_TYPES,
  selectEditorRow, editorSelection, refreshEditorStack, edRowId, THICKEN_LINE_KEY, _resetLayerStackForTests,
  EDITOR_ROW_MENU, EDITOR_ROW_EYE, rowSubject, rowMenuItems, openRowMenu, stackItems,
} from '../bspline-frame-builder/b-spline-gen/html/main/layer-stack.js';
import { EDITOR_TABS, getEditorTab, setEditorTab, SHARED_PEEK_ESSENTIALS } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';
import { typedLayerName, addLayer, isUserLocked } from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';
// the ⋯ menu's popover module, loaded up front (the stack imports it on the first tap)
import '../bspline-frame-builder/b-spline-gen/html/editor/editor-context-menu.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const $ = (id) => document.getElementById(id);
const DOM = '<div id="svgEditorModal" style="display:none"></div><div id="layerStackAddGrid"></div><div id="layerStackList"></div><span id="layerStackSummary"></span>'
  + '<div id="editorMobileDrawer"><div id="editorDrawerContent"><div id="editorLayerStack" class="ed-stack"><div class="ed-stack-head"><span id="editorLayerStackCount"></span>'
  + '<div id="editorLayerStackAddGrid"></div><button id="editorLayerStackFold"></button></div><div id="editorLayerStackList"></div></div><div id="editorDrawerBody"></div></div></div>';
const KEYS = ['stlLayers', 'heightLayers', 'layerOrder'];
const saved = {};
function mkEditor() {
  const layers = [
    { id: '0', name: 'Lines', visible: true, carve: true, depth: 0.25, profile: 'vbit', angle: 90 },
    { id: '1', name: 'Rails', visible: true, carve: true, depth: 0.15, profile: 'vbit', angle: 90, pattern: { id: 'lat1', layers: { rails: '1' } } },
    { id: '3', name: 'Wall', visible: true, carve: true, depth: 0.125, brickKind: 'wall' },
    { id: '4', name: 'Brick frame', visible: true, carve: true, depth: 0.125, brickKind: 'frame' },
  ];
  return { _layers: layers, _activeLayer: '0', _sketchLayer: null, pushState: vi.fn(), _notifyChange: vi.fn() };
}
function mount(matches = () => false) {
  window.matchMedia = (q) => ({ matches: matches(q), media: q, addEventListener() {}, removeEventListener() {} });
  document.body.innerHTML = DOM;
  window.svgEditor = mkEditor();
  P.stlLayers = [{ id: 's1', name: 'Lion', placement: 'withSurface' }];
  P.heightLayers = [];
  P.layerOrder = null;
  initLayerStack();
}
const rows = () => [...$('editorLayerStackList').children];
const settle = () => new Promise((r) => setTimeout(r, 0));
beforeEach(() => { for (const k of KEYS) saved[k] = P[k]; });
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete P[k]; else P[k] = saved[k]; }
  window.svgEditor = null;
  _resetLayerStackForTests();
  setEditorTab('artwork');
});

describe('the palette: the stack above the selected layer\'s settings; the tab strip kept for its ids', () => {
  it('#editorLayerStack heads the drawer content, before the settings body (its own scroll); the tab buttons still exist', () => {
    // the drawer's markup (no stylesheet links: nothing to fetch)
    const box = document.createElement('div');
    box.innerHTML = HTML.slice(HTML.indexOf('<div id="editorMobileDrawer">'), HTML.indexOf('<!-- Symbol Keyboard (Docked) -->'));
    document.body.replaceChildren(box);
    const doc = document;
    const content = doc.getElementById('editorDrawerContent');
    const stack = doc.getElementById('editorLayerStack');
    expect(stack.parentElement).toBe(content);
    expect(stack.nextElementSibling.id).toBe('editorDrawerBody');
    expect(stack.querySelector('#editorLayerStackList')).toBeTruthy();
    for (const id of ['editorTabFrame', 'editorTabArtwork', 'editorTabLattice', 'editorTabBrick', 'editorTabHeight']) expect(HTML.includes(`id="${id}"`), id).toBe(true);
    // an STL row's panel: a declared tab with no button
    expect(EDITOR_TABS.find((t) => t.id === 'stl')).toMatchObject({ panelId: 'editorStlPanel', buttonId: null });
    expect(doc.getElementById('editorStlPanel')).toBeTruthy();
    expect(SHARED_PEEK_ESSENTIALS).toEqual(['#editorLayerStack']); // at peek the (folded) stack shows in full
  });
});

describe('the editor view: one data with the sidebar, a locked Frame row first', () => {
  it('the same keys in the same order as the sidebar\'s cards, the Frame row first (never draggable, no stack key)', () => {
    mount();
    expect(STACK_VIEWS.editor.list).toBe('editorLayerStackList');
    expect(stackSequence($('editorLayerStackList'))).toEqual(stackSequence($('layerStackList')));
    expect(stackSequence($('editorLayerStackList'))).toEqual(['layer:0', 'layer:1', 'bricks', 'stl:s1', THICKEN_LINE_KEY]);
    const first = rows()[0];
    expect(first.dataset.stackFixed).toBe(EDITOR_FIXED_ROWS[0].key);
    expect(first.dataset.stackKey).toBeUndefined();
    expect(first.querySelector('.ed-stack-lock')).toBeTruthy();
    expect(first.querySelector('.layer-card-handle').textContent).not.toBe('≡');
    // a sidebar card's id is never reused (the brick matrix opens a card by its id)
    expect(document.querySelectorAll('[id^="layerCardName_"]').length).toBe(rows().length - 1);
    expect($(edRowId('layer:0'))).toBeTruthy();
  });
  it('Brick parts are indented sub-rows of the ONE Bricks row (top first)', () => {
    mount();
    const bricks = rows().find((r) => r.dataset.stackKey === 'bricks');
    expect([...bricks.querySelectorAll('.ed-stack-sub .ed-stack-sub-name')].map((b) => b.textContent)).toEqual(['Brick frame', 'Wall']);
    expect(LAYER_TYPES.height.subRows({ ref: { id: 'h', raster: { cols: 1, rows: 1 } } }).map((s) => s.name)).toEqual(['Paint 1']);
  });
});

describe('selecting a row switches the editor to that layer\'s tools', () => {
  it('Draw -> its layer active + Draw tab; Lattice -> Lattice tab; Frame -> Frame tab; a Brick part -> its layer + Brick tab', async () => {
    mount();
    await selectEditorRow('layer:1');
    expect(window.svgEditor._activeLayer).toBe('1');
    expect(getEditorTab()).toBe('lattice');
    await selectEditorRow('frame');
    expect(getEditorTab()).toBe('frame');
    expect(editorSelection().key).toBe('frame');
    await selectEditorRow('bricks', '3');
    expect(window.svgEditor._activeLayer).toBe('3');
    expect(getEditorTab()).toBe('brick');
    expect(editorSelection()).toEqual({ key: 'bricks', sub: '3' });
    expect($(edRowId('bricks', '3')).closest('.ed-stack-sub').classList.contains('is-selected')).toBe(true);
    // a tap on a row is the same path
    $(edRowId('layer:0')).click();
    await settle(); await settle();
    expect(window.svgEditor._activeLayer).toBe('0');
    expect(getEditorTab()).toBe('artwork');
    expect(rows().find((r) => r.dataset.stackKey === 'layer:0').classList.contains('is-selected')).toBe(true);
  });
  it('an STL row selects the STL panel (no 2D view yet)', async () => {
    mount();
    await selectEditorRow('stl:s1');
    expect(getEditorTab()).toBe('stl');
    expect(editorSelection().key).toBe('stl:s1');
  });
});

describe('per breakpoint: the phone folds the list to the selected row', () => {
  it('phone: folded after a pick, a tap unfolds it; desktop: never folded', async () => {
    // Fred 2026-11-24: the drawer (and the fold) only below 768 px; a tablet / a narrow window gets the desktop column
    expect(EDITOR_STACK_LAYOUTS.map((L) => [L.id, L.fold])).toEqual([['phone', true], ['desktop', false]]);
    expect(EDITOR_STACK_LAYOUTS[0].query).toContain('(max-width: 767px)');
    mount((q) => q.includes('max-width: 767px'));
    await selectEditorRow('layer:0');
    expect($('editorLayerStack').classList.contains('is-folded')).toBe(true);
    expect($('editorLayerStack').dataset.layout).toBe('phone');
    $(edRowId('layer:0')).click();
    expect($('editorLayerStack').classList.contains('is-folded')).toBe(false);
    _resetLayerStackForTests();
    mount();
    await selectEditorRow('layer:0');
    refreshEditorStack();
    expect($('editorLayerStack').classList.contains('is-folded')).toBe(false);
    expect($('editorLayerStack').style.getPropertyValue('--ed-stack-max-rows')).toBe('6');
  });
});

describe('+ Add layer in the editor: the same picker', () => {
  it('an inEditor ADD_PICKERS entry: the same LAYER_ADD_TYPES tiles through mountIconGrid', () => {
    mount();
    const p = ADD_PICKERS.find((x) => x.inEditor);
    expect(p.grid).toBe('editorLayerStackAddGrid');
    expect($('editorLayerStackAdd').classList.contains('icon-grid-picker')).toBe(true);
    expect([...$('editorLayerStackAddGrid').querySelectorAll('.layer-add-option')].map((b) => b.id)).toEqual(LAYER_ADD_TYPES.map((t) => `editorLayerStackAdd_${t}`));
  });
});

describe('a NEW layer is named by its type', () => {
  it('Draw N one past the last on screen; a board with only brick parts starts at Draw 1 (was "Layer 3")', () => {
    expect(typedLayerName([])).toBe('Draw 1');
    expect(typedLayerName([{ name: 'Wall' }, { name: 'Brick frame' }])).toBe('Draw 1');
    expect(typedLayerName([{ name: 'Draw 1' }, { name: 'Draw 4' }, { name: 'Lines' }])).toBe('Draw 5');
    expect(typedLayerName([{ name: 'Lattice 2' }], 'Lattice')).toBe('Lattice 3');
    const ed = { _layers: [{ id: '3', name: 'Wall', brickKind: 'wall' }, { id: '4', name: 'Brick frame', brickKind: 'frame' }], _activeLayer: null, _nextLayerId: 5 };
    expect(addLayer(ed, { skipUndo: true }).name).toBe('Draw 1');
    // a name given is kept (a saved layer, a brick kind, a lattice)
    expect(addLayer(ed, { name: 'Rails', skipUndo: true }).name).toBe('Rails');
  });
});

describe('phase 2: every row keeps its EYE; the old Layers row\'s other controls live in ONE ⋯ menu', () => {
  const item = (key) => stackItems().find((i) => i.key === key);
  it('the eye on a Draw row, on the Bricks row and on each Brick part; it hides / shows the layer (no Stamp box on a row)', async () => {
    mount();
    expect(document.querySelector('#editorLayerStackList .layer-card-enable')).toBeNull();
    for (const id of ['edStackEye_layer_0', 'edStackEye_bricks', 'edStackEye_bricks__3', 'edStackEye_bricks__4']) expect($(id), id).toBeTruthy();
    $('edStackEye_layer_0').click();
    await settle();
    expect(window.svgEditor._layers[0].visible).toBe(false);
    expect($('edStackEye_layer_0').getAttribute('aria-pressed')).toBe('false');
    $('edStackEye_bricks').click(); // all the parts
    await settle();
    expect(window.svgEditor._layers.filter((l) => l.brickKind).map((l) => l.visible)).toEqual([false, false]);
  });
  it('a layer\'s menu: rename, stamp (carve), own colours, lock, delete -- the old row\'s carve / colour / lock / rename / delete', () => {
    mount();
    expect(rowMenuItems(rowSubject(item('layer:0'))).map((m) => m.id)).toEqual(['rename', 'stamp', 'colour', 'lock', 'delete']);
    expect(rowMenuItems(rowSubject(item('bricks'), '3')).map((m) => m.id)).toEqual(['rename', 'stamp', 'colour', 'lock', 'delete']);
    expect(rowMenuItems(rowSubject(item('stl:s1'))).map((m) => m.id)).toEqual(['stamp', 'delete']);
    expect(Object.keys(EDITOR_ROW_EYE)).toEqual(['layer', 'bricks', 'paint']);
    // a height patch's paint layers: up / down / delete as the Height panel's retired rows had them
    const rec = { id: 'h', name: 'Height 1', layers: [{ id: 'a', name: 'Paint 1', kind: 'paint', raster: { cols: 1, rows: 1 } }, { id: 'b', name: 'Paint 2', kind: 'paint', raster: { cols: 1, rows: 1 } }] };
    P.heightLayers = [rec];
    expect(rowMenuItems({ kind: 'paint', patch: 'h', id: 'b' }).map((m) => m.id)).toEqual(['rename', 'down', 'delete']);
    expect(rowMenuItems({ kind: 'patch', id: 'h' }).map((m) => m.id)).toEqual(['rename', 'stamp', 'delete']);
    expect(EDITOR_ROW_MENU.map((m) => m.id)).toEqual(['rename', 'stamp', 'colour', 'lock', 'up', 'down', 'delete']);
  });
  it('the ⋯ button opens the editor\'s own context-menu popover; a pick runs the app\'s mutator (lock, carve)', async () => {
    mount();
    window.svgEditor._onChange = vi.fn();
    const pick = async (label) => {
      $('edStackMenu_layer_0').click();
      for (let i = 0; i < 100 && !document.querySelector('.context-menu-popover'); i++) await new Promise((r) => setTimeout(r, 30));
      const row = [...document.querySelectorAll('.context-menu-popover .context-menu-row')].find((r) => r.textContent.includes(label));
      expect(row, label).toBeTruthy();
      row.click();
      await settle();
    };
    await pick('Lock');
    expect(isUserLocked(window.svgEditor._layers[0])).toBe(true);
    expect(rowMenuItems(rowSubject(item('layer:0'))).map((m) => m.id)).not.toContain('delete'); // a locked layer is never deleted
    await pick('Stamp into the surface');
    expect(window.svgEditor._layers[0].carve).toBe(false);
    expect(document.querySelector('.context-menu-popover')).toBeNull(); // a pick closes it
    expect(await openRowMenu('frame')).toBeNull(); // the Frame row has no menu
  });
  it('⋯ > Rename: the row\'s name becomes a box; Enter writes it (renameLayer), Esc puts it back', async () => {
    mount();
    window.svgEditor._onChange = vi.fn();
    const rename = async () => {
      $('edStackMenu_layer_0').click();
      for (let i = 0; i < 100 && !document.querySelector('.context-menu-popover'); i++) await new Promise((r) => setTimeout(r, 30));
      [...document.querySelectorAll('.context-menu-popover .context-menu-row')].find((r) => r.textContent.includes('Rename')).click();
      await settle();
      return document.querySelector('#editorLayerStackList .ed-stack-rename');
    };
    let box = await rename();
    expect(box.value).toBe('Lines');
    box.value = 'Outline';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    expect(window.svgEditor._layers[0].name).toBe('Outline');
    expect($(edRowId('layer:0')).textContent).toBe('Outline');
    box = await rename();
    box.value = 'Nope';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(window.svgEditor._layers[0].name).toBe('Outline');
  });
  it('the old Layers list is gone from the palette (its controls all have a home above)', () => {
    for (const id of ['editorLayersList', 'editorLayersHeader', 'editorAddLayer', 'drawLayersBody']) expect(HTML.includes(`id="${id}"`), id).toBe(false);
    expect(HTML.includes('id="brickStartHint"')).toBe(true); // the Brick start hint stays (its own slot)
  });
});

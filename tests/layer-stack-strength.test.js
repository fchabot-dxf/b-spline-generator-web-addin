/**
 * LAYER STRENGTH in the layer stack (Fred 2026-11-27: "if i open them can some show at least a general strength override,
 * 0-100%?"): main/layer-stack.js LAYER_CARD_ROWS + each LAYER_TYPES type's `strength` { get, set }, ONE row component in the
 * open card (for STL the card the STL panel hosts its settings in), shown only while the layer carves 3D (Bricks always).
 * Setting 40 stores 0.4 on the type's own record through its own commit path; 100 removes the field.
 * The real stack, the real STL panel (its cards' host), the real height panel's write; the brick commit is a spy (its
 * re-mask needs the whole brick panel: tests/layer-stack-brick-card.test.js covers that host).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/history.js', async (orig) => ({ ...(await orig()), scheduleUndoSnapshot: vi.fn() }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js', async (orig) => ({ ...(await orig()), commitBrickSetting: vi.fn() }));
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { commitBrickSetting } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import {
  LAYER_TYPES, LAYER_CARD_ROWS, initLayerStack, openLayerStackItem, refreshLayerStack, cardRowId, _resetLayerStackForTests,
} from '../bspline-frame-builder/b-spline-gen/html/main/layer-stack.js';
import { renderStlPanel, bindStlPanel, _resetStlPanelForTests } from '../bspline-frame-builder/b-spline-gen/html/main/stl-panel.js';

const $ = (id) => document.getElementById(id);
const DOM = '<div id="svgEditorModal" style="display:none"></div><div id="layerStackAddRow"><div id="layerStackAddGrid"></div></div><div id="layerStackList"></div>'
  + '<span id="layerStackSummary"></span><div id="layerStackPark" hidden></div><div id="thickenSettingsPark" hidden><div id="thickenSettings"></div></div>'
  + '<div id="stlLayerBody"></div>';
const KEYS = ['stlLayers', 'heightLayers', 'brickSettings', 'layerOrder', 'widthIn', 'heightIn'];
const saved = {};
let editor;
beforeEach(() => {
  for (const k of KEYS) saved[k] = P[k];
  document.body.innerHTML = DOM;
  editor = { _layers: [
    { id: '0', name: 'Lines', visible: true, carve: true, depth: 0.25, profile: 'vbit', angle: 90 },
    { id: '1', name: 'Rails', visible: true, carve: true, depth: 0.15, profile: 'vbit', angle: 90, pattern: { id: 'lat1', layers: { rails: '1' } } },
    { id: '2', name: 'Colour lattice', visible: true, carve: false, depth: 0.08, profile: 'vbit', angle: 90, pattern: { id: 'lat2', layers: { rails: '2' } } },
    { id: '3', name: 'Wall', visible: true, carve: true, depth: 0.125, brickKind: 'wall' },
  ], _activeLayer: '0', _sketchLayer: null, pushState: vi.fn(), _notifyChange: vi.fn() };
  window.svgEditor = editor;
  Object.assign(P, { widthIn: 7, heightIn: 9, layerOrder: null });
  P.stlLayers = [{ id: 's1', name: 'Lion' }, { id: 's2', name: 'Off', enabled: false }];
  P.heightLayers = [{ id: 'h1', name: 'Height 1' }, { id: 'h2', name: 'Off patch', enabled: false }];
  P.brickSettings = { ...(saved.brickSettings || {}) };
  delete P.brickSettings.strength;
  _resetStlPanelForTests();
  _resetLayerStackForTests();
  renderStlPanel($('stlLayerBody'));
  bindStlPanel();
  initLayerStack();
  commitBrickSetting.mockClear();
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete P[k]; else P[k] = saved[k]; }
  window.svgEditor = null;
  _resetLayerStackForTests();
});

const card = (key) => document.querySelector(`#layerStackList [data-stack-key="${key}"]`);
const slider = (key) => $(cardRowId('strength', key));
const numberBox = (key) => $(cardRowId('strength', key, 'number'));
/** a slider released at `v` (its 'change'), as a drag ends */
async function release(key, v) {
  const s = slider(key);
  s.value = String(v);
  s.dispatchEvent(new Event('input', { bubbles: true }));
  s.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); // a lazy-loaded panel's write
}

describe('the declared row', () => {
  it('one Strength row, 0..100 %; every one of the five types declares its get / set', () => {
    expect(LAYER_CARD_ROWS.map((r) => [r.id, r.min, r.max, r.unit])).toEqual([['strength', 0, 100, '%']]);
    for (const t of ['brick', 'draw', 'lattice', 'height', 'stl']) {
      expect(typeof LAYER_TYPES[t].strength.get, t).toBe('function');
      expect(typeof LAYER_TYPES[t].strength.set, t).toBe('function');
    }
  });
});

describe('each type\'s open card shows the slider; 40 stores 0.4 on its own record, 100 removes the field', () => {
  it('Draw: the layer\'s own strength (one editor commit each time)', async () => {
    openLayerStackItem('layer:0');
    expect(slider('layer:0').value).toBe('100');
    expect(numberBox('layer:0').value).toBe('100');
    await release('layer:0', 40);
    expect(editor._layers[0].strength).toBe(0.4);
    expect(editor.pushState).toHaveBeenCalledTimes(1); // ONE undo step for the release
    expect(slider('layer:0').value).toBe('40');
    await release('layer:0', 100);
    expect(editor._layers[0]).not.toHaveProperty('strength');
  });
  it('a drag only moves the number; the release writes', () => {
    openLayerStackItem('layer:0');
    const s = slider('layer:0');
    s.value = '55';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    expect(numberBox('layer:0').value).toBe('55');
    expect(editor._layers[0]).not.toHaveProperty('strength');
    expect(editor.pushState).not.toHaveBeenCalled();
  });
  it('the number box writes on its own change', async () => {
    openLayerStackItem('layer:0');
    const n = numberBox('layer:0');
    n.value = '25';
    n.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(editor._layers[0].strength).toBe(0.25);
  });
  it('Lattice: the layer\'s own strength', async () => {
    openLayerStackItem('layer:1');
    expect(card('layer:1').dataset.stackType).toBe('lattice');
    await release('layer:1', 40);
    expect(editor._layers[1].strength).toBe(0.4);
    await release('layer:1', 100);
    expect(editor._layers[1]).not.toHaveProperty('strength');
  });
  it('Height patch: the record\'s strength (copy-on-write), 100 removes it', async () => {
    openLayerStackItem('height:h1');
    expect(slider('height:h1')).not.toBeNull();
    const before = P.heightLayers;
    await release('height:h1', 40);
    await vi.waitFor(() => expect(P.heightLayers).not.toBe(before)); // the height panel loads on use
    expect(P.heightLayers.find((r) => r.id === 'h1').strength).toBe(0.4);
    await release('height:h1', 100);
    await vi.waitFor(() => expect(P.heightLayers.find((r) => r.id === 'h1')).not.toHaveProperty('strength'));
  });
  it('STL relief: the row sits in the open STL card with the STL panel\'s settings; the record\'s strength', async () => {
    openLayerStackItem('stl:s1');
    const c = card('stl:s1');
    expect(c.contains(slider('stl:s1'))).toBe(true);
    expect(c.contains($('stlActive'))).toBe(true); // the STL panel's own settings, after the row
    expect(c.querySelectorAll('[data-card-row="strength"][type="range"]')).toHaveLength(1);
    await release('stl:s1', 40);
    expect(P.stlLayers.find((r) => r.id === 's1').strength).toBe(0.4);
    await release('stl:s1', 100);
    expect(P.stlLayers.find((r) => r.id === 's1')).not.toHaveProperty('strength');
  });
  it('Bricks: P.brickSettings.strength through the brick commit (a 3D-only setting: \'surface\')', async () => {
    openLayerStackItem('bricks');
    expect(slider('bricks').value).toBe('100');
    await release('bricks', 40);
    expect(P.brickSettings.strength).toBe(0.4);
    expect(commitBrickSetting).toHaveBeenLastCalledWith('surface');
    await release('bricks', 100);
    expect(P.brickSettings).not.toHaveProperty('strength');
  });
});

describe('shown only while the layer carves 3D', () => {
  it('a colour-only lattice, a disabled STL and a disabled patch: no slider', () => {
    for (const key of ['layer:2', 'stl:s2', 'height:h2']) {
      openLayerStackItem(key);
      expect(card(key).classList.contains('collapsed'), key).toBe(false);
      expect(card(key).querySelector('[data-card-row]'), key).toBeNull();
    }
  });
  it('turning a layer\'s Stamp box off removes its slider; on brings it back', () => {
    openLayerStackItem('layer:0');
    expect(slider('layer:0')).not.toBeNull();
    editor._layers[0].carve = false;
    refreshLayerStack();
    expect(slider('layer:0')).toBeNull();
    editor._layers[0].carve = true;
    refreshLayerStack();
    expect(slider('layer:0')).not.toBeNull();
  });
  it('an undo (the record changed elsewhere) puts the open slider back to the stored value', () => {
    openLayerStackItem('layer:0');
    editor._layers[0].strength = 0.3;
    refreshLayerStack();
    expect(slider('layer:0').value).toBe('30');
    expect(numberBox('layer:0').value).toBe('30');
  });
});

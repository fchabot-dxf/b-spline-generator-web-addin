/**
 * The unified LAYER STACK, step 1 (Fred 2026-11-23; memory project_layer_stack_design, mockup mock-layer-stack.html):
 *  - core/stamp/order.js: the ONE stamp-order rule (stack keys, today's default order, P.layerOrder) the engine and the
 *    stack read; absent order = the passes untouched (a saved board stamps byte-identically);
 *  - main/layer-stack.js: every layer a sidebar panel card in stamp order, the Thicken line splitting body / top-only,
 *    drag by the handle (a crossing writes the type's own placement field), '+ Add layer' through mountIconGrid;
 *  - the palette: the LAYERS section after Surface (SIDEBAR_TABS), the Thicken panel retired into the line, the old
 *    per-type lists gone; the job timeline's Back opens the line; a new drawing has no layer.
 * Real shapes: the real rebuild on the real P with an editor roster carrying real mask arrays (as
 * main/stamp-mask-manager.js sets them), a real STL record (core/stl/layer.js createStlLayer), the real palette markup.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/history.js', async (orig) => ({ ...(await orig()), scheduleUndoSnapshot: vi.fn() }));
import { scheduleUndoSnapshot } from '../bspline-frame-builder/b-spline-gen/html/core/history.js';
import { P, DEFAULT, lastResult } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { rebuild, _forgetHeights, _collectStampPasses } from '../bspline-frame-builder/b-spline-gen/html/core/engine/rebuild.js';
import { resolveGrid } from '../bspline-frame-builder/b-spline-gen/html/core/terrain.js';
import { createStlLayer } from '../bspline-frame-builder/b-spline-gen/html/core/stl/layer.js';
import { defaultStackKeys, effectiveOrder, orderPasses, editorLayerKey, STACK_BRICKS_KEY } from '../bspline-frame-builder/b-spline-gen/html/core/stamp/order.js';
import {
  LAYER_TYPES, LAYER_ADD_TYPES, THICKEN_LINE_KEY, stackItems, applyStackDrop, initLayerStack, refreshLayerStack, openLayerStackItem,
  addStackLayer, stackSequence, _resetLayerStackForTests,
} from '../bspline-frame-builder/b-spline-gen/html/main/layer-stack.js';
import { SIDEBAR_TABS, branchSections } from '../bspline-frame-builder/b-spline-gen/html/main/sidebar-tabs.js';
import { SECTION_THEMES, SECTION_ICONS } from '../bspline-frame-builder/b-spline-gen/html/main/section-themes.js';
import { JOB_STEP_KINDS } from '../bspline-frame-builder/b-spline-gen/html/core/job-timeline.js';
import { _reconcileLayersFromSvg } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-io.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const $ = (id) => document.getElementById(id);

// ── the real engine: today's order is untouched; an explicit order is followed ────────────────────────────────────
const W = 5, H = 6, SP = 0.1;
function disc(nx, nz, cx, cy, r) {
  return Float32Array.from({ length: nx * nz }, (_, k) => {
    const x = -W / 2 + (k % nx) * W / (nx - 1), y = -H / 2 + Math.floor(k / nx) * H / (nz - 1);
    const d = Math.hypot(x - cx, y - cy);
    return d <= r ? 1 : d <= r + 0.15 ? 1 - (d - r) / 0.15 : 0;
  });
}
const tri = (a, b, c) => [...a, ...b, ...c];
function pyramid() {
  const A = [-5, -5, 0], B = [5, -5, 0], C = [5, 5, 0], D = [-5, 5, 0], T = [0, 0, 4];
  return Float32Array.from([tri(A, B, T), tri(B, C, T), tri(C, D, T), tri(D, A, T), tri(A, C, B), tri(A, D, C)].flat());
}
const art = (nx, nz, id, extra = {}) => ({ id, name: `Art ${id}`, visible: true, carve: true, depth: 0.3, profile: 'flat', angle: 90,
  blur: 0, smoothing: 15, suppression: 0.15, edgeFilletRadius: 0, filletPower: 2.2, _mask: disc(nx, nz, 0.3, -0.2, 1.1), ...extra });
const wall = (nx, nz) => {
  const body = disc(nx, nz, -0.4, 0.5, 1.2);
  return { id: '9', name: 'Wall', brickKind: 'wall', visible: true, carve: true, depth: 0.25, profile: 'vbit', suppression: 0, smoothing: 0,
    filletPower: 2.2, _brickMask: { body, fillet: null, isStamped: Uint8Array.from(body, (v) => (v > 0 ? 1 : 0)) }, _brickDepth: 0.15 };
};
const fnv = (a) => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let h = 0x811c9dc5; for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };

const KEYS = ['widthIn', 'heightIn', 'spacing', 'thickenEnabled', 'jobTimeline', 'stlLayers', 'heightLayers', 'brickSettings', 'layerOrder', 'thickness', 'terrainFit'];
const saved = {};
beforeEach(() => {
  for (const k of KEYS) saved[k] = P[k];
  // terrainFit 'legacy': the pins below were measured before the terrain fit (a saved board reads 'legacy', tests/terrain-fit.test.js)
  Object.assign(P, { widthIn: W, heightIn: H, spacing: SP, thickenEnabled: true, jobTimeline: null, stlLayers: [], heightLayers: [], layerOrder: null, terrainFit: 'legacy' });
  P.brickSettings = { ...(saved.brickSettings || {}) };
  delete P.brickSettings.placement;
  scheduleUndoSnapshot.mockClear();
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete P[k]; else P[k] = saved[k]; }
  window.svgEditor = null;
  _forgetHeights();
  _resetLayerStackForTests();
});
async function build(layers) {
  window.svgEditor = { _layers: layers };
  _forgetHeights();
  await rebuild({ update() {}, setStlGhosts() {} }, () => {}, () => {});
  return { heights: fnv(lastResult.heights), back: fnv(lastResult.thickenData.offsetPts) };
}
const stlRec = () => createStlLayer({ soup: pyramid(), name: 'Pyramid', board: { widthIn: W, heightIn: H } }).record;

describe('core/stamp/order.js: the one stamp-order rule', () => {
  it('keys: an editor layer layer:<id>, every brick layer the ONE bricks item, STL stl:<id>, height height:<id>', () => {
    expect(editorLayerKey({ id: '4' })).toBe('layer:4');
    expect(editorLayerKey({ id: '4', brickKind: 'frame' })).toBe(STACK_BRICKS_KEY);
    expect(editorLayerKey({ id: '4', holdsBricks: true })).toBe(STACK_BRICKS_KEY);
  });
  it('the default is today\'s pass order: the roster (bricks after the first layer holding them), then STLs, then patches', () => {
    const layers = [{ id: '0' }, { id: '1', _brickMask: {} }, { id: '2', brickKind: 'wall' }, { id: '3' }];
    expect(defaultStackKeys(layers, [{ id: 'a' }], [{ id: 'h' }], (l) => !!l._brickMask))
      .toEqual(['layer:0', 'layer:1', 'bricks', 'layer:3', 'stl:a', 'height:h']);
  });
  it('an explicit order: its existing keys first, then any key it does not list in default order', () => {
    expect(effectiveOrder(['a', 'b', 'c', 'd'], null)).toEqual(['a', 'b', 'c', 'd']);
    expect(effectiveOrder(['a', 'b', 'c', 'd'], ['c', 'gone', 'a'])).toEqual(['c', 'a', 'b', 'd']);
  });
  it('orderPasses: no order = the SAME array (no sort); an order = a stable sort by the item\'s rank', () => {
    const ps = [{ k: 'a' }, { k: 'b' }, { k: 'a' }, { k: 'c' }];
    expect(orderPasses(ps, null, (p) => p.k)).toBe(ps);
    expect(orderPasses(ps, ['c', 'a'], (p) => p.k)).toEqual([ps[3], ps[0], ps[2], ps[1]]);
  });
  it('P.layerOrder: a declared default of null (absent on a saved board reads null: today\'s order)', () => {
    expect(DEFAULT).toHaveProperty('layerOrder', null);
  });
});

describe('the engine follows the stack order only once one is written', () => {
  // AGENTS.md rule 3 pin: these digests were MEASURED on the code before the stack (layer-stack HEAD 5ce166a2, the same board
  // built by the same rebuild) -- a board with no stack order stamps exactly as it did then
  it('pin: a board with art, Wall bricks and an STL and no order builds the pre-stack heights + back, byte for byte', async () => {
    const { nx, nz } = resolveGrid(W, H, SP);
    P.stlLayers = [stlRec()];
    expect(P.layerOrder).toBeNull();
    expect(await build([art(nx, nz, '0'), wall(nx, nz)])).toEqual({ heights: 'fc9ae4e5', back: 'fc123219' });
  }, 60000);
  it('no order: the passes in roster order; an order: the passes follow it (each pass at its item\'s rank)', () => {
    const { nx, nz } = resolveGrid(W, H, SP);
    window.svgEditor = { _layers: [art(nx, nz, '0'), art(nx, nz, '1'), wall(nx, nz)] };
    expect(_collectStampPasses(nx, nz).map((p) => p.id)).toEqual(['0', '1', '9#bricks']);
    P.layerOrder = ['bricks', 'layer:1', 'layer:0'];
    expect(_collectStampPasses(nx, nz).map((p) => p.id)).toEqual(['9#bricks', '1', '0']);
  });
  it('an order equal to today\'s default stamps byte-identically (heights + back); another order really changes the top', async () => {
    const { nx, nz } = resolveGrid(W, H, SP);
    P.stlLayers = [stlRec()];
    const layers = () => [art(nx, nz, '0'), wall(nx, nz)];
    const none = await build(layers());
    P.layerOrder = ['layer:0', 'bricks', `stl:${P.stlLayers[0].id}`];
    const same = await build(layers());
    expect(same).toEqual(none);
    P.layerOrder = [`stl:${P.stlLayers[0].id}`, 'layer:0', 'bricks']; // the STL (Max) first, the carving added on top of it
    const moved = await build(layers());
    expect(moved.heights).not.toBe(none.heights);
  }, 60000);
});

// ── the stack in the panel ────────────────────────────────────────────────────────────────────────────────────────
const STACK_DOM = '<div id="svgEditorModal" style="display:none"></div><div id="layerStackAddRow"><div id="layerStackAddGrid"></div></div><div id="layerStackList"></div>'
  + '<span id="layerStackSummary"></span><div id="thickenSettingsPark" hidden><div id="thickenSettings" data-job-lock="back"><input type="checkbox" id="thickenEnabled"></div></div>';
function mkEditor() {
  const layers = [
    { id: '0', name: 'Lines', visible: true, carve: true, depth: 0.25, profile: 'vbit', angle: 90 },
    { id: '1', name: 'Rails', visible: true, carve: true, depth: 0.15, profile: 'vbit', angle: 90, pattern: { id: 'lat1', layers: { rails: '1', ties: '2' } } }, // generated (an id)
    { id: '2', name: 'Ties', visible: true, carve: false, depth: 0.08, profile: 'vbit', angle: 90 },
    { id: '3', name: 'Wall', visible: true, carve: true, depth: 0.125, brickKind: 'wall' },
    // a pattern the Lattice panel attached lazily, never generated (no id): still a drawing layer
    { id: '5', name: 'Sketch', visible: true, carve: true, depth: 0.1, profile: 'flat', angle: 90, pattern: { spacing: 0.25 } },
  ];
  return { _layers: layers, _activeLayer: '0', _sketchLayer: null, pushState: vi.fn(), _notifyChange: vi.fn() };
}
const cards = () => [...$('layerStackList').children];
function mount() {
  document.body.innerHTML = STACK_DOM;
  window.svgEditor = mkEditor();
  P.stlLayers = [{ id: 's1', name: 'Lion', placement: 'withSurface' }, { id: 's2', name: 'Rose', placement: 'afterBack' }];
  P.heightLayers = [{ id: 'h1', name: 'Height 1' }];
  const onChange = vi.fn();
  initLayerStack({ onChange });
  return onChange;
}
const card = (key) => cards().find((c) => c.dataset.stackKey === key);

describe('the stack: every layer a card in stamp order, split by the Thicken line', () => {
  it('a saved board\'s default order (no field) with each layer on its side; types, theme colours and icons declared', () => {
    mount();
    expect(stackSequence()).toEqual(['layer:0', 'layer:1', 'layer:2', 'bricks', 'layer:5', 'stl:s1', 'height:h1', THICKEN_LINE_KEY, 'stl:s2']);
    expect(P.layerOrder).toBeNull(); // nothing written by showing it
    // the display reads like the piece (STACK_DISPLAY, Fred 2026-11-25): the stamp order reversed, top-only detail on top
    expect(cards().map((c) => c.dataset.stackType || 'line')).toEqual(['stl', 'line', 'height', 'stl', 'draw', 'brick', 'lattice', 'lattice', 'draw']);
    for (const [type, T] of Object.entries(LAYER_TYPES)) {
      expect(SECTION_THEMES[T.theme], type).toBeTruthy();
      expect(T.icon, type).toBeTruthy();
    }
    for (const c of cards()) {
      expect(c.classList.contains('panel'), c.dataset.stackKey).toBe(true); // the sidebar's own panel card
      expect(c.classList.contains('section-themed'), c.dataset.stackKey).toBe(true);
      expect(c.querySelector(':scope > .panel-header .layer-card-handle').textContent).toBe('≡');
    }
    expect(card('stl:s2').classList.contains('layer-card-after')).toBe(true);
    expect(card('bricks').querySelector('.layer-card-title').textContent).toBe('Bricks');
    expect($('layerStackSummary').textContent).toBe('8 layers');
  });
  it('a card opens inline (one at a time): a Draw card shows its stamp summary + its editor door and makes its layer active', () => {
    mount();
    card('layer:2').querySelector('.layer-card-name').click();
    expect(card('layer:2').classList.contains('collapsed')).toBe(false);
    expect(window.svgEditor._activeLayer).toBe('2');
    expect(card('layer:2').querySelector('.layer-card-door').textContent).toBe('Open in the Lattice tab ›');
    card('layer:0').querySelector('.layer-card-name').click();
    expect(card('layer:2').classList.contains('collapsed')).toBe(true);
    expect(card('layer:0').querySelector('.layer-card-summary').textContent).toBe('Raised 0.25 in · V-bit 90°');
    expect(card('layer:0').querySelector('.layer-card-door').textContent).toBe('Open in the Draw tab ›');
  });
  it('the Thicken line opens the retired Thicken panel\'s settings (moved, never copied); the job timeline\'s Back opens it', () => {
    mount();
    expect(JOB_STEP_KINDS.back.opens).toEqual({ sidebar: 'panel-layers', stack: 'thicken' });
    openLayerStackItem(THICKEN_LINE_KEY);
    expect(card(THICKEN_LINE_KEY).contains($('thickenSettings'))).toBe(true);
    expect(document.querySelectorAll('[id="thickenSettings"]')).toHaveLength(1);
    card(THICKEN_LINE_KEY).querySelector('.layer-card-name').click(); // close: parked again
    expect($('thickenSettingsPark').contains($('thickenSettings'))).toBe(true);
  });
  it('a new drawing\'s stack: only the Thicken line', () => {
    document.body.innerHTML = STACK_DOM;
    window.svgEditor = { _layers: [], _activeLayer: null };
    initLayerStack();
    expect(stackSequence()).toEqual([THICKEN_LINE_KEY]);
  });
});

describe('reorder by the handle; the Thicken line splits body / top only', () => {
  const pe = (el, type, clientY, pointerType = 'touch') => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType, button: 0, clientX: 5, clientY }));
  const layout = () => cards().forEach((c, i) => { c.getBoundingClientRect = () => ({ top: i * 40, bottom: i * 40 + 40, height: 40, left: 0, right: 300, width: 300 }); });
  it('a touch drag of a Draw card ABOVE the line (handle only; STACK_DISPLAY: above = top only) writes its placement; a pure crossing writes no order', async () => {
    mount();
    layout();
    const h = card('layer:0').querySelector('.layer-card-handle'); // the bottom row (STACK_DISPLAY: stamped first)
    pe(h, 'pointerdown', 8 * 40 + 10);
    pe(h, 'pointermove', 1 * 40 + 10); // just ABOVE the Thicken line (row 1), under Rose: top-only
    pe(h, 'pointerup', 1 * 40 + 10);
    await new Promise((r) => setTimeout(r, 0));
    expect(window.svgEditor._layers[0].placement).toBe('afterBack');
    expect(P.layerOrder).toBeNull(); // Lines stays first among the top-only layers: no order to write
    expect(stackSequence().slice(-3)).toEqual([THICKEN_LINE_KEY, 'layer:0', 'stl:s2']);
    expect(card('layer:0').classList.contains('layer-card-after')).toBe(true);
    expect(scheduleUndoSnapshot).toHaveBeenCalledWith('layerStack', 'Layers');
  });
  it('a press on the card body never starts a drag (the panel still scrolls)', () => {
    mount();
    layout();
    const before = stackSequence();
    const name = card('layer:0').querySelector('.layer-card-name');
    pe(name, 'pointerdown', 10); pe(name, 'pointermove', 300); pe(name, 'pointerup', 300);
    expect(stackSequence()).toEqual(before);
    expect(window.svgEditor._layers[0]).not.toHaveProperty('placement');
  });
  it('a real reorder writes the order; brick / STL / height crossings write their own engine field', async () => {
    const onChange = mount();
    const seq = ['height:h1', 'layer:0', 'layer:1', 'layer:2', 'layer:5', THICKEN_LINE_KEY, 'stl:s2', 'bricks', 'stl:s1'];
    const r = await applyStackDrop(seq);
    expect(r.order).toBe(true);
    expect(P.layerOrder).toEqual(seq.filter((k) => k !== THICKEN_LINE_KEY));
    expect(onChange).toHaveBeenCalled();
    expect(P.brickSettings.placement).toBe('afterBack'); // the bricks' one field (core/stamp/placement.js)
    expect(P.stlLayers.find((s) => s.id === 's1').placement).toBe('afterBack');
    expect(stackSequence()).toEqual(seq);
    // back above: the brick field is removed again (absent = Before thicken), not written 'withSurface'
    await applyStackDrop(['height:h1', 'layer:0', 'layer:1', 'layer:2', 'layer:5', 'bricks', THICKEN_LINE_KEY, 'stl:s2', 'stl:s1']);
    expect(P.brickSettings).not.toHaveProperty('placement');
  });
  it('the Thicken line itself drags: every layer it passes changes side', async () => {
    mount();
    await applyStackDrop(['layer:0', 'layer:1', THICKEN_LINE_KEY, 'layer:2', 'bricks', 'layer:5', 'stl:s1', 'height:h1', 'stl:s2']);
    // (by id: a new stack order also reorders the roster -- the drawing order, Fred 2026-11-25)
    const layer = (id) => window.svgEditor._layers.find((l) => l.id === id);
    expect(layer('2').placement).toBe('afterBack');
    expect(P.brickSettings.placement).toBe('afterBack');
    expect(P.stlLayers.map((s) => s.placement)).toEqual(['afterBack', 'afterBack']);
    expect(layer('0')).not.toHaveProperty('placement');
  });
});

describe('+ Add layer: the declared icon-grid picker', () => {
  it('Brick, Draw, Lattice, Height patch, STL (no Photo) as tiles of mountIconGrid\'s picker', () => {
    mount();
    expect(LAYER_ADD_TYPES).toEqual(['brick', 'draw', 'lattice', 'height', 'stl']);
    expect($('layerStackAdd').classList.contains('icon-grid-picker')).toBe(true);
    expect($('layerStackAddBtn').textContent).toContain('Add layer');
    expect([...$('layerStackAddGrid').querySelectorAll('.layer-add-option')].map((b) => b.id)).toEqual(LAYER_ADD_TYPES.map((t) => `layerStackAdd_${t}`));
  });
  it('Draw: a new editor layer through the app\'s own addLayer, landed just above the line (behind the patch), open', async () => {
    mount();
    window.svgEditor._onChange = vi.fn();
    const key = await addStackLayer('draw');
    const made = window.svgEditor._layers[window.svgEditor._layers.length - 1];
    expect(key).toBe(`layer:${made.id}`);
    const seq = stackSequence();
    expect(seq[seq.indexOf(THICKEN_LINE_KEY) - 1]).toBe(key);
    expect(P.layerOrder.filter((k) => k !== 'stl:s2').slice(-2)).toEqual(['height:h1', key]); // the last one above the line
    expect(card(key).classList.contains('collapsed')).toBe(false);
  });
});

describe('a new file has no layers, also once its drawing is reopened (a reload, a project load, an editor Cancel)', () => {
  // the reopen path of a drawing with no persisted roster: editor-io.js _reconcileLayersFromSvg over the sketch's children
  const child = (dataLayer, type = 'path') => { let layer = dataLayer; return { type, attr: (n, v) => { if (n !== 'data-layer') return null; if (v !== undefined) { layer = v; return undefined; } return layer; }, node: { tagName: type.toUpperCase(), getAttribute: () => '' } }; };
  const reopen = (children) => { const ed = { _sketchLayer: { children: () => ({ toArray: () => children }) } }; const anchor = _reconcileLayersFromSvg(ed); return { ed, anchor }; };
  it('an SVG with nothing in it (a saved, never-drawn new project) reopens with NO layer (was an empty "Layer 1")', () => {
    const { ed, anchor } = reopen([]);
    expect(ed._layers).toEqual([]);
    expect(anchor).toBeNull();
  });
  it('pin: a legacy saved drawing WITH children keeps exactly its layers (ids, names) and its orphans\' anchor', () => {
    const { ed } = reopen([child('3'), child('5'), child('3'), child(null)]);
    expect(ed._layers.map((l) => [l.id, l.name])).toEqual([['3', 'Layer 1'], ['5', 'Layer 2']]);
  });
});

describe('the palette: the LAYERS section, the retired Thicken panel and the moved lists', () => {
  it('LAYERS is a branch after Surface: the stack (with the Thicken settings) then Sculpt bottom', () => {
    const ids = SIDEBAR_TABS.map((t) => t.id);
    expect(ids.indexOf('layers')).toBe(ids.indexOf('surface') + 1);
    expect(branchSections(SIDEBAR_TABS.find((t) => t.id === 'layers'))).toEqual(['panel-layers', 'panel-sculpt-bot']);
    document.body.innerHTML = HTML.slice(HTML.indexOf('<aside class="cad-sidebar">'), HTML.indexOf('</aside>') + 8);
    const layersPanel = document.querySelector('.panel.panel-layers');
    for (const id of ['layerStackList', 'layerStackAddGrid', 'thickenSettings', 'thickenEnabled', 'thickenOffset']) expect(layersPanel.contains($(id)), id).toBe(true);
    expect($('thickenSettings').getAttribute('data-job-lock')).toBe('back');
    expect(document.querySelector('.panel-thicken')).toBeNull();
    for (const id of ['mainLayersList', 'mainAddLayer', 'stampLayersList', 'stampAddLayer', 'stlList']) expect($(id), id).toBeNull();
    // Fred 2026-11-23: the cards ARE the branch's panels -- the stack's section has no header (no second 'LAYERS' title), its
    // slim action row comes first; 'Open Editor' retired (the 2D / 3D toggle opens the editor)
    expect(layersPanel.querySelector(':scope > .panel-header')).toBeNull();
    expect([...layersPanel.children].map((c) => c.id).slice(0, 2)).toEqual(['layerStackActions', 'layerStackList']);
    expect($('layerStackActions').contains($('layerStackAddGrid'))).toBe(true);
    expect($('btnMainLayersOpenEditor')).toBeNull();
    expect(document.querySelector('.panel.panel-brick')).toBeNull(); // its body is the Brick card's (#brickPanelBody, parked)
    expect($('layerStackPark').contains($('brickPanelBody')) && $('layerStackPark').contains($('stampBlueprint'))).toBe(true);
    expect(SECTION_ICONS.height && SECTION_ICONS.lattice).toBeTruthy();
  });
});

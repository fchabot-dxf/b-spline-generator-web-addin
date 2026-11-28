/**
 * One control per field in an open layer card (advisor 2026-11-27; Fred rejects duplicated controls): the card's rows
 * (main/layer-stack.js LAYER_CARD_ROWS) declare which hosted controls they supersede, and syncSuperseded hides those while
 * they sit in an open card that shows the row -- the Draw / Lattice card's #stampLayerSettings (Relief, Smooth the terrain,
 * Edge fillet), the Brick card's Relief, the STL card's Relief / Z / Edge softness. Parked, or in the 2D editor's Draw tab
 * (no card rows there), they show as before. The REAL palette markup, the REAL stack and STL panel.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/history.js', async (orig) => ({ ...(await orig()), scheduleUndoSnapshot: vi.fn() }));
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { LAYER_CARD_ROWS, initLayerStack, openLayerStackItem, refreshLayerStack, _resetLayerStackForTests } from '../bspline-frame-builder/b-spline-gen/html/main/layer-stack.js';
import { renderStlPanel, bindStlPanel, _resetStlPanelForTests } from '../bspline-frame-builder/b-spline-gen/html/main/stl-panel.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.lastIndexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/^<body[^>]*>/, '').replace(/<\/body>$/, '');
const $ = (id) => document.getElementById(id);
/** shown = no hidden element from it up to the document (what the page shows; the CSS rule makes the attribute stick) */
const shown = (e) => { for (let n = e; n; n = n.parentElement) if (n.hidden) return false; return true; };
const block = (id) => { const e = $(id); const r = e.closest('.relief-toggle, .cad-slider-row') || e; return r; };
const card = (key) => document.querySelector(`#layerStackList [data-stack-key="${key}"]`);

const KEYS = ['stlLayers', 'heightLayers', 'brickSettings', 'layerOrder', 'widthIn', 'heightIn'];
const saved = {};
let editor;
beforeEach(() => {
  for (const k of KEYS) saved[k] = P[k];
  document.body.innerHTML = BODY;
  $('svgEditorModal').style.display = 'none';
  editor = { _layers: [
    { id: '0', name: 'Lines', visible: true, carve: true, depth: 0.25, profile: 'flat', angle: 90, suppression: 0.15, edgeFilletRadius: 0 },
    { id: '3', name: 'Wall', visible: true, carve: true, depth: 0.125, brickKind: 'wall', suppression: 0.15 },
  ], _activeLayer: '0', _sketchLayer: null, pushState: vi.fn(), _notifyChange: vi.fn() };
  window.svgEditor = editor;
  Object.assign(P, { widthIn: 7, heightIn: 9, layerOrder: null });
  P.stlLayers = [{ id: 's1', name: 'Lion' }];
  P.heightLayers = [];
  _resetStlPanelForTests(); _resetLayerStackForTests();
  renderStlPanel($('stlLayerBody')); bindStlPanel(); initLayerStack();
});
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete P[k]; else P[k] = saved[k]; } window.svgEditor = null; _resetLayerStackForTests(); });

const SUPERSEDED = {
  'layer:0': ['stampReliefToggle', 'stampTextureSuppression', 'stampEdgeFilletRadius'],
  bricks: ['brickReliefToggle'],
  'stl:s1': ['stl_raiseField', 'stl_posZField', 'stl_softnessField'],
};

describe('an open card shows ONE control per field', () => {
  it('declared on the rows: Relief, Z offset, Soften edges and Ground name what they supersede per type', () => {
    const named = Object.fromEntries(LAYER_CARD_ROWS.map((r) => [r.id, Object.fromEntries(Object.entries(r.supersedes || {}).map(([t, s]) => [t, s.map((x) => x.id)]))]));
    expect(named).toEqual({
      relief: { draw: ['stampReliefToggle'], lattice: ['stampReliefToggle'], brick: ['brickReliefToggle'], stl: ['stl_raiseField'] },
      strength: {},
      zOffset: { stl: ['stl_posZField'] },
      soften: { draw: ['stampEdgeFilletRadius'], lattice: ['stampEdgeFilletRadius'], stl: ['stl_softnessField'] },
      ground: { draw: ['stampTextureSuppression'], lattice: ['stampTextureSuppression'] },
    });
  });
  for (const [key, ids] of Object.entries(SUPERSEDED)) {
    it(`${key}: the hosted controls for the same fields are hidden in the open card (their labels too); the others still show`, () => {
      openLayerStackItem(key);
      const c = card(key);
      expect(c.querySelectorAll('[data-card-row-wrap]').length).toBe(5);
      for (const id of ids) {
        expect(c.contains($(id)), `${id} hosted in the card`).toBe(true);
        expect(shown($(id)), `${id} hidden`).toBe(false);
        const lab = block(id).previousElementSibling;
        if (lab && lab.matches('label.cad-label')) expect(shown(lab), `${id}'s label hidden`).toBe(false);
      }
      if (key === 'layer:0') expect(shown($('stampHeight'))).toBe(true); // the Height magnitude has no row: it stays
      if (key === 'stl:s1') expect(shown($('stl_posX'))).toBe(true);
    });
  }
  it('a layer whose Stamp box is off shows no rows -- and its hosted controls show again', () => {
    openLayerStackItem('layer:0');
    expect(shown($('stampReliefToggle'))).toBe(false);
    editor._layers[0].carve = false;
    refreshLayerStack();
    expect(card('layer:0').querySelector('[data-card-row-wrap]')).toBeNull();
    expect(shown($('stampReliefToggle'))).toBe(true);
  });
  it('parked, or in the 2D editor\'s Draw tab (no card rows), the Draw stamp controls show as before', () => {
    openLayerStackItem('layer:0');
    expect(shown($('stampEdgeFilletRadius'))).toBe(false);
    $('svgEditorModal').style.display = 'block'; // the editor up: #stampLayerSettings goes home to the Draw tab
    document.dispatchEvent(new CustomEvent('editorModeChanged'));
    expect($('drawStampBody').contains($('stampLayerSettings'))).toBe(true);
    for (const id of SUPERSEDED['layer:0']) expect(block(id).hasAttribute('data-card-superseded'), id).toBe(false);
    expect(block('stampEdgeFilletRadius').hidden).toBe(false);
  });
});

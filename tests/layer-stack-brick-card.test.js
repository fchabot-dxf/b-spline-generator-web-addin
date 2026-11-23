/**
 * Fred 2026-11-23 ("are layers expandable into their full previous panel fields?"): the layer stack's Brick card, opened,
 * holds the old BRICK panel's whole body (#brickPanelBody: Brick editor, the quick settings, the lay notes, Relief, Brick
 * top, Surface, Wear, Max height) -- MOVED from its park, never copied -- and those fields still write the brick settings.
 * The REAL palette markup, the REAL brick panel (initBrickPanel; the lay itself stubbed), the REAL stack.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runBricks: vi.fn(() => ({ wallCount: 3, frameCount: 0 })), runBricksPreview: vi.fn(), runBricksOutlinePreview: vi.fn(), buildRibbonPrimitives: vi.fn(() => []) };
});
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js', async (importOriginal) => ({ ...(await importOriginal()), frameContext: vi.fn(() => ({})) }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js', async (importOriginal) => ({ ...(await importOriginal()), frameContourSilhouette: vi.fn(() => ({ primitives: [] })) }));

import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { initBrickPanel } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { initLayerStack, openLayerStackItem, _resetLayerStackForTests } from '../bspline-frame-builder/b-spline-gen/html/main/layer-stack.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.lastIndexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/^<body[^>]*>/, '').replace(/<\/body>$/, '');
const $ = (id) => document.getElementById(id);
const FIELDS = ['brickQuickSettings', 'brickLayWarnings', 'brickBtnReliefRaised', 'brickBtnReliefCarved', 'brickBtnTopOrganic',
  'brickBtnTopFlat', 'brickSurfaceStyleToggle', 'brickSurfaceWear', 'brickReliefHeight', 'brickReliefHeightSlider'];
const card = () => document.querySelector('#layerStackList [data-stack-key="bricks"]');
let saved;

beforeAll(() => {
  saved = JSON.parse(JSON.stringify(P.brickSettings));
  document.body.innerHTML = BODY;
  // a board WITH laid bricks (the sidebar brick fields act on laid bricks: brick-control-requires.js 'bricksLaid')
  const sketch = document.createElement('div');
  sketch.innerHTML = '<svg><polygon data-brick-gen="1" data-brick="wall" data-layer="3" points="0,0 1,0 1,0.5 0,0.5"></polygon></svg>';
  window.svgEditor = { setMode: () => {}, _layers: [{ id: '3', name: 'Wall', brickKind: 'wall', visible: true, carve: true, depth: 0.125 }],
    _activeLayer: '3', _sketchLayer: { node: sketch.firstChild, children: () => Object.assign([], { toArray: () => [] }) }, _undoStack: [], pushState: vi.fn(), _notifyChange: vi.fn() };
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  initBrickPanel();
  _resetLayerStackForTests();
  initLayerStack();
});
afterAll(() => { P.brickSettings = saved; window.svgEditor = null; vi.unstubAllGlobals(); });

describe('the Brick card holds the old Brick panel\'s fields', () => {
  it('closed: the fields are parked out of sight; the Brick panel is gone from the sidebar', () => {
    expect(document.querySelector('.panel.panel-brick')).toBeNull();
    expect($('layerStackPark').contains($('brickPanelBody'))).toBe(true);
  });
  it('open: the summary, the editor door, then every field, each id once', () => {
    openLayerStackItem('bricks');
    expect(card().querySelector('.layer-card-summary')).not.toBeNull();
    expect(card().querySelectorAll('.layer-card-door')).toHaveLength(1); // ONE button opens the Brick tab (Brick editor retired)
    expect($('layerCardDoor_bricks').textContent).toBe('Open in the Brick tab ›');
    expect($('btnEditBricks')).toBeNull();
    for (const id of FIELDS) {
      expect(document.querySelectorAll(`[id="${id}"]`), id).toHaveLength(1);
      expect(card().contains($(id)), `${id} in the Brick card`).toBe(true);
    }
  });
  it('the fields still write the brick settings: Carved, Raised, Flat top', () => {
    openLayerStackItem('bricks');
    $('brickBtnReliefCarved').click();
    expect(P.brickSettings.invert).toBe(true);
    expect(card().querySelector('.layer-card-summary').textContent).toMatch(/^Wall — Carved /);
    $('brickBtnReliefRaised').click();
    expect(P.brickSettings.invert).toBe(false);
    $('brickBtnTopFlat').click();
    expect(P.brickSettings.brickTopMode).toBe('flat');
  });
});

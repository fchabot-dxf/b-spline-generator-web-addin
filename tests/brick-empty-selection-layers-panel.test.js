/**
 * F35 item 40 (Fred, phone: "We don't see layers still"; supersedes item 16's swap that this file used to pin):
 * the Brick tab shows its OWN panel always -- with a tool or without -- and HOSTS the one shared Layers component
 * (header + start hint + list; main/editor-tabs.js EDITOR_TABS brick.panelHosts) under its pinned Generate. Measured
 * before (headless, desktop + 900 px, a two-layer board): with a tool picked the layers were hidden; with none the
 * panel swapped to Layers, which hid Generate on a restored board (item 39 (c)). Bricks land on the ACTIVE layer
 * (item 22 slice 3), so picking a row here picks where the next lay goes. Every other tab gets the list back home.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runBricks: vi.fn(), runBricksPreview: vi.fn(), runBricksOutlinePreview: vi.fn() };
});

import { initBrickPanel, deselectTool } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { setEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';
import { renderLayersPanel } from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';

const FIXTURE = `
  <button id="editorTabFrame"></button><div id="editorFramePanel"></div><div id="editorToolbarFrame"></div>
  <button id="editorTabArtwork"></button><div id="editorToolbarArtwork"></div>
  <button id="editorTabPhoto"></button><div id="editorPhotoPanel"></div><div id="editorToolbarPhoto"></div>
  <button id="editorTabBrick"></button><div id="editorToolbarBrick"></div>
  <div id="editorToolbarTop"></div>
  <div id="editorStrokeGroup"></div><div id="editorColorGroup"></div><div id="editorGridGroup"></div>
  <div id="editorFillModeGroup"></div><div id="editorFontGroup"></div><div id="editorExpandGroup"></div>

  <div id="editorBrickPanel" style="display:none;">
    <div class="sticky-actions"><button id="brickGenerate">Generate</button></div>
    <div id="brickLayersSlot"></div>
    <div id="brickToolHint"></div>
    <div id="brickBrushSection" style="display:none;"></div>
    <div id="brickWallSection"><div id="brickPatternList"></div></div>
    <div id="brickFrameSection"><div id="brickFramePresetList"></div><div id="brickFrameBandPatternList"></div></div>
    <button id="brickSetRed"></button><button id="brickSetWhite"></button>
    <div id="brickSizePresetList"></div>
    <input id="brickSizeSlider" type="range" min="0" max="1000"><input id="brickSize" type="number">
    <input id="brickGroutWidth"><input id="brickGroutDepth">
    <button id="brickBtnGroutRecessed"></button><button id="brickBtnGroutFlush"></button>
    <button id="brickBtnReliefRaised"></button><button id="brickBtnReliefCarved"></button>
    <input id="brickReliefHeightSlider" type="range"><input id="brickReliefHeight">
    <input id="brickSuppressionSlider" type="range"><input id="brickSuppression">
    <input id="brickClumpingSlider" type="range"><input id="brickClumping">
    <input id="brickSeed"><button id="brickBtnRandomSeed"></button>
  </div>
  <div id="editorLayersPanel">
    <div class="layers-header" id="editorLayersHeader"><span>Layers</span><button id="editorAddLayer">+</button></div>
    <div id="brickStartHint" style="display:none;"></div>
    <div class="layers-list" id="editorLayersList"></div>
  </div>
`;

const $ = (id) => document.getElementById(id);
const shown = (id) => $(id).style.display !== 'none';
const inBrick = (id) => $('brickLayersSlot').contains($(id));
const rows = () => [...$('editorLayersList').querySelectorAll('[data-layer-id]')];

function twoLayerEditor() {
  const children = []; children.toArray = () => children;
  return {
    setMode: () => {},
    _sketchLayer: { node: document.createElement('div'), children: () => children },
    _layers: [{ id: 'L1', name: 'Layer 1', visible: true }, { id: 'L2', name: 'Layer 2', visible: true }],
    _activeLayer: 'L1',
  };
}

let root;
beforeEach(() => {
  root = document.createElement('div');
  root.innerHTML = FIXTURE;
  document.body.appendChild(root);
  window.svgEditor = twoLayerEditor();
  initBrickPanel();
});
afterEach(() => { setEditorTab('artwork'); root.remove(); window.svgEditor = null; });

describe('item 40: the Brick tab shows its own panel AND the shared Layers', () => {
  it('no tool picked: the Brick panel (with Generate) shows, hosting the layers header + list with every layer row', () => {
    setEditorTab('brick');
    renderLayersPanel(window.svgEditor);
    expect(shown('editorBrickPanel')).toBe(true);
    expect(shown('editorLayersPanel')).toBe(false);
    expect(['editorLayersHeader', 'brickStartHint', 'editorLayersList'].map(inBrick)).toEqual([true, true, true]);
    expect(rows().map((r) => r.getAttribute('data-layer-id')).sort()).toEqual(['L1', 'L2']);
  });

  it('a tool picked, and Escape: the panel and the layers stay (no swap either way)', () => {
    setEditorTab('brick');
    $('brickTool_wall').click();
    expect(shown('editorBrickPanel')).toBe(true);
    expect(inBrick('editorLayersList')).toBe(true);
    deselectTool();
    expect(shown('editorBrickPanel')).toBe(true);
    expect(inBrick('editorLayersList')).toBe(true);
  });

  it('picking a layer row in the Brick tab makes it the ACTIVE layer (where the next lay goes)', () => {
    setEditorTab('brick');
    renderLayersPanel(window.svgEditor);
    rows().find((r) => r.getAttribute('data-layer-id') === 'L2').click();
    expect(window.svgEditor._activeLayer).toBe('L2');
  });

  it('every other tab gets the ONE list back home, in its own order (Artwork shows it as before)', () => {
    setEditorTab('brick');
    setEditorTab('artwork');
    expect(shown('editorLayersPanel')).toBe(true);
    expect([...$('editorLayersPanel').children].map((c) => c.id)).toEqual(['editorLayersHeader', 'brickStartHint', 'editorLayersList']);
    setEditorTab('frame');
    expect(inBrick('editorLayersList')).toBe(false);
    expect(document.querySelectorAll('#editorLayersList').length).toBe(1); // one list, never a copy
  });
});

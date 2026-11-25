/**
 * F35 item 40 (Fred, phone: "We don't see layers still"; supersedes item 16's swap): the Brick tab shows its OWN panel
 * always -- with a tool or without -- under its pinned Generate. Its hosted Layers list retired with the editor layer
 * stack (Fred 2026-11-24): the stack above every tab's panel lists the layers and picks the active one
 * (tests/editor-layer-stack.test.js); the slot keeps the Brick start hint only, on every tab.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runBricks: vi.fn(), runBricksPreview: vi.fn(), runBricksOutlinePreview: vi.fn() };
});

import { initBrickPanel, deselectTool } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { setEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';

const FIXTURE = `
  <button id="editorTabFrame"></button><div id="editorFramePanel"></div><div id="editorToolbarFrame"></div>
  <button id="editorTabArtwork"></button><div id="editorToolbarArtwork"></div>
  <button id="editorTabBrick"></button><div id="editorToolbarBrick"></div>
  <div id="editorToolbarTop"></div>
  <div id="editorStrokeGroup"></div><div id="editorColorGroup"></div><div id="editorGridGroup"></div>
  <div id="editorFillModeGroup"></div><div id="editorFontGroup"></div><div id="editorExpandGroup"></div>

  <div id="editorBrickPanel" style="display:none;">
    <div class="sticky-actions"><button id="brickGenerate">Generate</button></div>
    <div id="brickLayersSlot"><div id="brickStartHint" style="display:none;"></div></div>
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
  <div id="editorLayersPanel"></div>
`;

const $ = (id) => document.getElementById(id);
const shown = (id) => $(id).style.display !== 'none';
const inBrick = (id) => $('brickLayersSlot').contains($(id));

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


describe('item 40, after the editor layer stack: the Brick tab shows its own panel; no Layers list is hosted', () => {
  it('no tool picked: the Brick panel (with Generate) shows; its slot holds the start hint only', () => {
    setEditorTab('brick');
    expect(shown('editorBrickPanel')).toBe(true);
    expect(shown('editorLayersPanel')).toBe(false);
    expect([...$('brickLayersSlot').children].map((c) => c.id)).toEqual(['brickStartHint']);
  });

  it('a tool picked, and Escape: the panel stays (no swap either way), nothing moves into its slot', () => {
    setEditorTab('brick');
    $('brickTool_wall').click();
    expect(shown('editorBrickPanel')).toBe(true);
    deselectTool();
    expect(shown('editorBrickPanel')).toBe(true);
    expect([...$('brickLayersSlot').children].map((c) => c.id)).toEqual(['brickStartHint']);
  });

  it('every other tab: the start hint stays in the Brick slot (no tab moves it any more)', () => {
    for (const t of ['artwork', 'frame', 'brick']) { setEditorTab(t); expect($('brickLayersSlot').contains($('brickStartHint')), t).toBe(true); }
  });
});

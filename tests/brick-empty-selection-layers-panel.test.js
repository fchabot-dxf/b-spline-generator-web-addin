/**
 * F35 item 16 follow-up (Fred, live use: "don't see the layers"): entering the Brick tab with no
 * tool picked yet has nothing of its own to show (every BRICK_TOOLS settingsSection is hidden) --
 * show the shared editor Layers panel (#editorLayersPanel) instead of a near-empty Brick panel,
 * same as the rest of the app already treats "nothing selected." Picking a tool switches back to
 * Brick's own panel; Escape (deselectTool) clears the tool and switches back to Layers.
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
  <button id="editorTabPhoto"></button><div id="editorPhotoPanel"></div><div id="editorToolbarPhoto"></div>
  <button id="editorTabBrick"></button><div id="editorToolbarBrick"></div>
  <div id="editorToolbarTop"></div>
  <div id="editorStrokeGroup"></div><div id="editorColorGroup"></div><div id="editorGridGroup"></div>
  <div id="editorFillModeGroup"></div><div id="editorFontGroup"></div><div id="editorExpandGroup"></div>

  <div id="editorBrickPanel" style="display:none;">
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

let root;
beforeEach(() => {
  root = document.createElement('div');
  root.innerHTML = FIXTURE;
  document.body.appendChild(root);
  window.svgEditor = { setMode: () => {} };
  initBrickPanel();
});
afterEach(() => { root.remove(); window.svgEditor = null; });

describe('Brick tab: shared Layers panel shows when nothing is selected', () => {
  it('switching to the Brick tab with no tool yet picked shows Layers, not the Brick panel', () => {
    setEditorTab('brick');
    expect(shown('editorLayersPanel')).toBe(true);
    expect(shown('editorBrickPanel')).toBe(false);
  });

  it('picking a tool switches to the Brick panel and hides Layers', () => {
    setEditorTab('brick');
    $('brickTool_wall').click();
    expect(shown('editorBrickPanel')).toBe(true);
    expect(shown('editorLayersPanel')).toBe(false);
  });

  it('deselectTool (Escape) clears the active tool and switches back to Layers', () => {
    setEditorTab('brick');
    $('brickTool_wall').click();
    expect(shown('editorBrickPanel')).toBe(true);
    deselectTool();
    expect(shown('editorLayersPanel')).toBe(true);
    expect(shown('editorBrickPanel')).toBe(false);
  });

  it('never touches either panel while a DIFFERENT tab is active (Artwork\'s own empty-canvas state is not this bug)', () => {
    setEditorTab('artwork');
    expect(shown('editorLayersPanel')).toBe(true); // editor-tabs.js's own per-tab toggle, untouched
    $('editorTabFrame').click(); // Frame tab has no brick tool buttons to click -- just switch tabs
    setEditorTab('frame');
    expect(shown('editorLayersPanel')).toBe(false); // Frame's own panel convention, not this fix's concern
  });
});

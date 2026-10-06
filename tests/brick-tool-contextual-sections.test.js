/**
 * F35 item 16 follow-up (Fred, live use: "it shows every section at once [Set, Wall pattern, Frame
 * band preset...], so you can't tell what applies"). main/brick-panel.js's own declared BRICK_TOOLS
 * now names each tool's own `settingsSection` DOM id (generalizing the single-consumer Brush-only
 * check this field was reserved for but never generalized until Wall/Frame needed the same thing
 * too -- the 3rd consumer that justifies the table). `syncToolSections()` shows ONLY the active
 * tool's own section, hiding the rest; Scissors/Stripe have none (null), so selecting either hides
 * Brush/Wall/Frame's sections with nothing of their own to show.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runBricks: vi.fn(), runBricksPreview: vi.fn(), runBricksOutlinePreview: vi.fn() };
});

import { initBrickPanel } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';

const FIXTURE = `
  <div id="editorToolbarBrick"></div>
  <div id="brickToolHint"></div>
  <div id="brickBrushSection" style="display:none;">
    <div id="brickSubTools_brush"></div>
    <div id="brickBrushProfileToggle"><button id="brickBtnProfileStripped" class="active"></button><button id="brickBtnProfileContinuous"></button></div>
    <div id="brickBrushOrientationToggle"><button id="brickBtnOrientationStretcher" class="active"></button><button id="brickBtnOrientationSoldier"></button></div>
  </div>
  <div id="brickWallSection"><div id="brickPatternList"></div></div>
  <div id="brickFrameSection"><div id="brickFramePresetList"></div><div id="brickFrameBandPatternList"></div></div>
  <div id="brickFramePresetList"></div>
  <div id="brickPatternList"></div>
  <div id="brickFrameBandPatternList"></div>
  <button id="brickSetRed"></button>
  <button id="brickSetWhite"></button>
  <div id="brickSizePresetList"></div>
  <input id="brickSizeSlider" type="range" min="0" max="1000"><input id="brickSize" type="number">
  <input id="brickGroutWidth"><input id="brickGroutDepth">
  <button id="brickBtnGroutRecessed"></button><button id="brickBtnGroutFlush"></button>
  <button id="brickBtnReliefRaised"></button><button id="brickBtnReliefCarved"></button>
  <input id="brickReliefHeightSlider" type="range"><input id="brickReliefHeight">
  <input id="brickSuppressionSlider" type="range"><input id="brickSuppression">
  <input id="brickClumpingSlider" type="range"><input id="brickClumping">
  <input id="brickSeed"><button id="brickBtnRandomSeed"></button>
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

describe('Brick tab: tool sections are contextual, one visible at a time', () => {
  it('Wall tool: shows ONLY brickWallSection', () => {
    $('brickTool_wall').click();
    expect(shown('brickWallSection')).toBe(true);
    expect(shown('brickFrameSection')).toBe(false);
    expect(shown('brickBrushSection')).toBe(false);
  });

  it('Frame tool: shows ONLY brickFrameSection', () => {
    $('brickTool_frame').click();
    expect(shown('brickFrameSection')).toBe(true);
    expect(shown('brickWallSection')).toBe(false);
    expect(shown('brickBrushSection')).toBe(false);
  });

  it('Brush tool: shows ONLY brickBrushSection', () => {
    $('brickTool_brush').click();
    expect(shown('brickBrushSection')).toBe(true);
    expect(shown('brickWallSection')).toBe(false);
    expect(shown('brickFrameSection')).toBe(false);
  });

  it('Scissors/Stripe: hide ALL three sections -- neither tool has settings of its own', () => {
    const pick = { scissors: () => $('brickTool_scissors').click(), // item 43: Stripe = Brush > Stripe (no tab of its own)
      stripe: () => { $('brickTool_brush').click(); $('brickSubTool_brush_stripe').click(); } };
    for (const id of ['scissors', 'stripe']) {
      $('brickTool_wall').click(); // start from a section showing, to prove this ACTUALLY hides it
      pick[id]();
      expect(shown('brickWallSection')).toBe(false);
      expect(shown('brickFrameSection')).toBe(false);
      expect(shown('brickBrushSection')).toBe(false);
    }
  });

  it('switching tools back and forth never leaves two sections visible at once', () => {
    for (const id of ['brickTool_wall', 'brickTool_frame', 'brickTool_brush', 'brickTool_wall']) {
      $(id).click();
      const visibleCount = ['brickWallSection', 'brickFrameSection', 'brickBrushSection'].filter(shown).length;
      expect(visibleCount).toBe(1);
    }
  });
});

/**
 * Fred (2026-10-04): "changing the Wall pattern buttons ... and the Frame band preset buttons does
 * NOT change the layout on the canvas" -- then the ruling: in the EDITOR's Brick tab a setting change
 * only saves and marks the layout PENDING; the sticky Generate button (#brickGenerate) re-lays it.
 * In the MAIN SIDEBAR the same setters run with commit 'auto' and re-lay straight away.
 * Declared per binding in main/brick-panel.js (BRICK_COMMIT), not per call site.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runBricks: vi.fn(), runBricksPreview: vi.fn(), runBricksOutlinePreview: vi.fn(), buildRibbonPrimitives: vi.fn(() => []) };
});
// A usable frame for the Frame tool (resolveFrameGeom needs a frame context + a valid silhouette).
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, frameContext: vi.fn(() => ({})) };
});
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, frameContourSilhouette: vi.fn(() => ({ primitives: [] })) };
});

import {
  initBrickPanel, setWallPattern, setFrameBandPreset, selectSet, setBrickSize, setInvert, setSeed, generateBricks,
  setBrickTopMode,
} from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { runBricks, runBricksPreview } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

const FIXTURE = `
  <button id="brickGenerate">Generate</button>
  <div id="editorToolbarBrick"></div>
  <div id="brickToolHint"></div>
  <div id="brickBrushSection" style="display:none;">
    <div id="brickBrushProfileToggle"><button id="brickBtnProfileStripped" class="active"></button><button id="brickBtnProfileContinuous"></button></div>
    <div id="brickBrushOrientationToggle"><button id="brickBtnOrientationStretcher" class="active"></button><button id="brickBtnOrientationSoldier"></button></div>
  </div>
  <div id="brickFramePresetList"></div>
  <div id="brickBrushPresetList"></div>
  <div id="brickPatternList"></div>
  <div id="brickFrameBandPatternList"></div>
  <button id="brickSetRed"></button>
  <button id="brickSetWhite"></button>
  <div id="brickSizePresetList"></div>
  <input id="brickSizeSlider" type="range" min="0" max="1000" step="1" value="226"><input id="brickSize" type="number" value="0.75">
  <input id="brickGroutWidth"><input id="brickGroutDepth">
  <button id="brickBtnGroutRecessed"></button><button id="brickBtnGroutFlush"></button>
  <button id="brickBtnReliefRaised"></button><button id="brickBtnReliefCarved"></button>
  <button id="brickBtnTopOrganic" class="active"></button><button id="brickBtnTopFlat"></button>
  <input id="brickReliefHeightSlider" type="range" min="0" max="1" step="0.001"><input id="brickReliefHeight">
  <input id="brickSuppressionSlider" type="range"><input id="brickSuppression">
  <input id="brickClumpingSlider" type="range"><input id="brickClumping">
  <input id="brickSeed"><button id="brickBtnRandomSeed"></button>
`;

const $ = (id) => document.getElementById(id);
const fire = (id, value, type) => { $(id).value = String(value); $(id).dispatchEvent(new Event(type)); };
const firstInactive = (sel) => [...document.querySelectorAll(sel)].find((b) => !b.disabled && !b.classList.contains('active'));
const pending = () => $('brickGenerate').classList.contains('pending');

let root;
function setup(tool) {
  root = document.createElement('div');
  root.innerHTML = FIXTURE;
  document.body.appendChild(root);
  window.svgEditor = { setMode: () => {} };
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  P.brickSettings.pattern = 'stretcher';
  P.brickSettings.frameBandPreset = 'single_soldier';
  P.brickSettings.frameBandPatterns = [];
  P.brickSettings.setId = 1;
  P.brickSettings.invert = false;
  initBrickPanel();
  $(`brickTool_${tool}`).click(); // selecting the tool lays the bricks once and records what was laid
  vi.clearAllMocks();
}
afterEach(() => { root.remove(); window.svgEditor = null; vi.unstubAllGlobals(); });

/** Each editor control: changing it never re-lays and marks Generate pending; Generate then re-lays
 *  once with the new settings and clears pending. */
function expectPendingThenGenerate(check) {
  expect(runBricks).not.toHaveBeenCalled();
  expect(runBricksPreview).not.toHaveBeenCalled();
  expect(pending()).toBe(true);
  expect($('brickGenerate').textContent).toContain('•');
  $('brickGenerate').click();
  expect(runBricks).toHaveBeenCalledTimes(1);
  if (check) check(runBricks.mock.calls[0]);
  expect(pending()).toBe(false);
  expect($('brickGenerate').textContent).toBe('Generate');
}

describe('Editor Brick tab (Wall tool): a setting change marks pending; only Generate re-lays', () => {
  beforeEach(() => setup('wall'));
  it('not pending right after the tool laid the bricks', () => { expect(pending()).toBe(false); });
  it('a Wall pattern button', () => {
    $('brickPattern_herringbone').click();
    expect(P.brickSettings.pattern).toBe('herringbone');
    expectPendingThenGenerate((call) => expect(call[1].pattern).toBe('herringbone'));
  });
  it('the set picker', () => { $('brickSetWhite').click(); expectPendingThenGenerate((c) => expect(c[1].setId).toBe(3)); });
  it('a brick-size preset button', () => { firstInactive('[id^=brickSizePreset_]').click(); expectPendingThenGenerate(); });
  it('the brick-size stepper, drag and release', () => {
    fire('brickSize', 1.5, 'input'); fire('brickSize', 1.5, 'change');
    expectPendingThenGenerate((c) => expect(c[1].brickLengthIn).toBe(1.5));
  });
  it('a 3D slider (relief height), drag and release', () => {
    fire('brickReliefHeightSlider', 0.2, 'input'); fire('brickReliefHeightSlider', 0.2, 'change');
    expectPendingThenGenerate((c) => expect(c[1].reliefIn).toBe(0.2));
  });
  it('the Raised/Carved relief toggle', () => { $('brickBtnReliefCarved').click(); expectPendingThenGenerate((c) => expect(c[1].invert).toBe(true)); });
  it('the grout profile toggle', () => {
    const other = P.brickSettings.grout.profile === 'flush' ? 'brickBtnGroutRecessed' : 'brickBtnGroutFlush';
    $(other).click();
    expectPendingThenGenerate();
  });
  it('a grout width field', () => { fire('brickGroutWidth', 0.09, 'input'); expectPendingThenGenerate((c) => expect(c[1].grout.widthIn).toBe(0.09)); });
  it('the seed field', () => { fire('brickSeed', 42, 'input'); expectPendingThenGenerate((c) => expect(c[1].seed).toBe(42)); });
  it('the random-seed button', () => { $('brickBtnRandomSeed').click(); expectPendingThenGenerate(); });
  it('changing a setting and changing it back is not pending', () => {
    $('brickPattern_herringbone').click();
    expect(pending()).toBe(true);
    $('brickPattern_stretcher').click();
    expect(pending()).toBe(false);
  });
  it('a Brush-only setting never makes the Wall/Frame layout pending', () => {
    $('brickBtnProfileContinuous').click();
    $('brickBtnOrientationSoldier').click();
    const brushPreset = firstInactive('[id^=brickBrushPreset_]');
    if (brushPreset) brushPreset.click();
    expect(pending()).toBe(false);
    expect(runBricks).not.toHaveBeenCalled();
  });
});

describe('Editor Brick tab (Frame tool)', () => {
  beforeEach(() => setup('frame'));
  it('a Frame band preset button', () => {
    $('brickFramePreset_soldier_stretcher').click();
    expectPendingThenGenerate((c) => expect(c[2].bands.length).toBe(2));
  });
  it('a per-band pattern button', () => { firstInactive('#brickFrameBandPatternList button').click(); expectPendingThenGenerate(); });
});

describe('Generate with nothing to re-lay', () => {
  beforeEach(() => setup('brush'));
  it('Brush tool active and no Wall/Frame bricks on the canvas: Generate lays nothing', () => {
    expect(generateBricks()).toBe(false);
    expect(runBricks).not.toHaveBeenCalled();
  });
});

describe("Main sidebar ('auto'): the same setters re-lay straight away", () => {
  beforeEach(() => setup('wall'));
  it.each([
    ['wall pattern', () => setWallPattern('flemish', 'auto')],
    ['frame band preset', () => setFrameBandPreset('three_band', 'auto')],
    ['set', () => selectSet(3, 'auto')],
    ['brick size', () => setBrickSize(1.5, 'auto')],
    ['relief', () => setInvert(true, 'auto')],
    ['seed', () => setSeed(7, 'auto')],
  ])('%s', (_name, change) => {
    change();
    expect(runBricks).toHaveBeenCalledTimes(1);
    expect(pending()).toBe(false);
  });
});

describe("F35 item 18: brick top Flat | Organic is a 3D-only ('surface') setting", () => {
  let notify;
  beforeEach(() => {
    P.brickSettings.brickTopMode = 'organic';
    setup('wall');
    notify = vi.fn();
    window.svgEditor._notifyChange = notify;
  });
  it('the Flat button: saved, toggles, re-masks at once, never re-lays, never pending', () => {
    $('brickBtnTopFlat').click();
    expect(P.brickSettings.brickTopMode).toBe('flat');
    expect($('brickBtnTopFlat').classList.contains('active')).toBe(true);
    expect($('brickBtnTopOrganic').classList.contains('active')).toBe(false);
    expect(notify).toHaveBeenCalledWith('commit');
    expect(runBricks).not.toHaveBeenCalled();
    expect(pending()).toBe(false);
    $('brickBtnTopOrganic').click();
    expect(P.brickSettings.brickTopMode).toBe('organic');
    expect(notify).toHaveBeenCalledTimes(2);
    expect(pending()).toBe(false);
  });
  it('a pending layout change stays pending (and only that) across a Flat toggle', () => {
    $('brickPattern_herringbone').click();
    $('brickBtnTopFlat').click();
    expectPendingThenGenerate((c) => expect(c[1].pattern).toBe('herringbone'));
  });
  it('the sidebar entry point (default commit) behaves the same', () => {
    setBrickTopMode('flat');
    expect(P.brickSettings.brickTopMode).toBe('flat');
    expect(notify).toHaveBeenCalledWith('commit');
    expect(runBricks).not.toHaveBeenCalled();
  });
});

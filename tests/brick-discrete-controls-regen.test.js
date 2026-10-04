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
  setBrickTopMode, setSurfaceStyle,
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
  <div id="brickSurfaceStyleToggle"></div>
  <div id="brickQuickSettings"></div>
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
  // F35 item 18 turn 181: the grout PROFILE and DEPTH only drive the joint recess in the height mask --
  // 3D-only ('surface'): re-mask at once, never re-lay, never pending. Grout WIDTH stays a layout setting.
  it('the grout profile toggle and the grout depth field are 3D-only', () => {
    const notify = vi.fn();
    window.svgEditor._notifyChange = notify;
    const other = P.brickSettings.grout.profile === 'flush' ? 'brickBtnGroutRecessed' : 'brickBtnGroutFlush';
    $(other).click();
    fire('brickGroutDepth', 0.07, 'input');
    expect(P.brickSettings.grout.depthIn).toBe(0.07);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(runBricks).not.toHaveBeenCalled();
    expect(pending()).toBe(false);
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

describe("F35 item 18 (2): the Surface style (Clean | Weathered) is a 3D-only ('surface') setting", () => {
  let notify;
  beforeEach(() => {
    P.brickSettings.surfaceStyle = 'clean';
    setup('wall');
    notify = vi.fn();
    window.svgEditor._notifyChange = notify;
  });
  it('one button per declared style, Clean active by default', () => {
    expect($('brickSurfaceStyle_clean')).not.toBeNull();
    expect($('brickSurfaceStyle_weathered')).not.toBeNull();
    expect($('brickSurfaceStyle_clean').classList.contains('active')).toBe(true);
  });
  it('Weathered: saved, toggles, re-masks at once, never re-lays, never pending', () => {
    $('brickSurfaceStyle_weathered').click();
    expect(P.brickSettings.surfaceStyle).toBe('weathered');
    expect($('brickSurfaceStyle_weathered').classList.contains('active')).toBe(true);
    expect($('brickSurfaceStyle_clean').classList.contains('active')).toBe(false);
    expect(notify).toHaveBeenCalledWith('commit');
    expect(runBricks).not.toHaveBeenCalled();
    expect(pending()).toBe(false);
  });
  it('an unknown id falls back to Clean (the sidebar entry point)', () => {
    setSurfaceStyle('weathered');
    setSurfaceStyle('bogus');
    expect(P.brickSettings.surfaceStyle).toBe('clean');
    expect(runBricks).not.toHaveBeenCalled();
  });
});

describe('turn 183: Weathered switches the grout to Recessed; Clean restores what it replaced', () => {
  let notify;
  beforeEach(() => {
    P.brickSettings.surfaceStyle = 'clean';
    P.brickSettings.grout.profile = 'flush';
    delete P.brickSettings.groutProfileBeforeStyle;
    setup('wall');
    notify = vi.fn();
    window.svgEditor._notifyChange = notify;
  });
  it('Weathered -> Recessed (button shows it); Clean -> back to Flush; one re-mask each, never pending', () => {
    $('brickSurfaceStyle_weathered').click();
    expect(P.brickSettings.grout.profile).toBe('recessed');
    expect($('brickBtnGroutRecessed').classList.contains('active')).toBe(true);
    $('brickSurfaceStyle_clean').click();
    expect(P.brickSettings.grout.profile).toBe('flush');
    expect($('brickBtnGroutFlush').classList.contains('active')).toBe(true);
    expect(P.brickSettings.groutProfileBeforeStyle).toBeUndefined();
    expect(notify).toHaveBeenCalledTimes(2);
    expect(pending()).toBe(false);
  });
  it("the user's own grout pick after Weathered wins: Clean does not undo it", () => {
    $('brickSurfaceStyle_weathered').click();
    $('brickBtnGroutFlush').click();
    $('brickBtnGroutRecessed').click();
    $('brickSurfaceStyle_clean').click();
    expect(P.brickSettings.grout.profile).toBe('recessed');
  });
  it('already Recessed: Weathered changes nothing to restore, Clean leaves Recessed', () => {
    P.brickSettings.grout.profile = 'recessed';
    setSurfaceStyle('weathered');
    expect(P.brickSettings.groutProfileBeforeStyle).toBeUndefined();
    setSurfaceStyle('clean');
    expect(P.brickSettings.grout.profile).toBe('recessed');
  });
});

describe('F35 item 18 (3): the main sidebar 🧱 BRICK section -- 3D controls + quick settings, applied at once', () => {
  beforeEach(() => setup('wall'));
  it('Max Height (moved to the sidebar): drag previews, release re-lays once, never pending', () => {
    fire('brickReliefHeightSlider', 0.2, 'input');
    expect(runBricks).not.toHaveBeenCalled();
    fire('brickReliefHeightSlider', 0.2, 'change');
    expect(runBricks).toHaveBeenCalledTimes(1);
    expect(runBricks.mock.calls[0][1].reliefIn).toBe(0.2);
    expect(pending()).toBe(false);
  });
  it('the Raised/Carved relief toggle (moved to the sidebar) re-lays at once', () => {
    $('brickBtnReliefCarved').click();
    expect(runBricks).toHaveBeenCalledTimes(1);
    expect(runBricks.mock.calls[0][1].invert).toBe(true);
    expect(pending()).toBe(false);
  });
  it('one quick row per declared setting, a button per choice, the current one active', () => {
    const rows = [...$('brickQuickSettings').querySelectorAll('label')].map((l) => l.textContent);
    expect(rows).toEqual(['Set', 'Brick size', 'Wall pattern', 'Frame bands']);
    expect($('brickQuick_set_1').classList.contains('active')).toBe(true);
    expect($('brickQuick_pattern_stretcher').classList.contains('active')).toBe(true);
    expect($('brickQuick_frameBands_single_soldier').classList.contains('active')).toBe(true);
  });
  it.each([
    ['set', 'brickQuick_set_3', (c) => expect(c[1].setId).toBe(3), 'brickSetWhite'],
    ['pattern', 'brickQuick_pattern_herringbone', (c) => expect(c[1].pattern).toBe('herringbone'), 'brickPattern_herringbone'],
    ['frame bands', 'brickQuick_frameBands_three_band', null, 'brickFramePreset_three_band'],
  ])("quick %s: re-lays once, never pending, and the editor's own button follows", (_n, quickId, check, editorId) => {
    $(quickId).click();
    expect(runBricks).toHaveBeenCalledTimes(1);
    if (check) check(runBricks.mock.calls[0]);
    expect(pending()).toBe(false);
    expect($(quickId).classList.contains('active')).toBe(true);
    expect($(editorId).classList.contains('active')).toBe(true);
  });
  it("an editor change (pending) is mirrored by the quick row, which is not itself a re-lay", () => {
    $('brickPattern_flemish').click();
    expect($('brickQuick_pattern_flemish').classList.contains('active')).toBe(true);
    expect(runBricks).not.toHaveBeenCalled();
  });
  it('quick brick size re-lays at once', () => {
    $('brickQuick_size_three').click();
    expect(P.brickSettings.brickLengthIn).toBe(3);
    expect(runBricks).toHaveBeenCalledTimes(1);
    expect($('brickQuick_size_three').classList.contains('active')).toBe(true);
  });
});

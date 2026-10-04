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
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/toast.js', () => ({ showToast: vi.fn() }));
// Audit C6: a Stripe style pick re-commits through commitEdit (the editor's real commit pipeline is not
// under test here).
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-commit.js', () => ({ commitEdit: vi.fn() }));
// turn 199: the engine's honoured-option list, mutable so a test can stand in for "T86 item 17 landed"
const engineOpts = vi.hoisted(() => ({ extra: [] }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, get ENGINE_OPTIONS() { return [...actual.ENGINE_OPTIONS, ...engineOpts.extra]; } };
});
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
  setBrickTopMode, setSurfaceStyle, setStripeStyle, setRaisedMode,
} from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { runBricks, runBricksPreview, buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { frameContext } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { FRAME_NEEDS_A_FRAME } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { showToast } from '../bspline-frame-builder/b-spline-gen/html/core/toast.js';
import { deselectTool } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { setEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';

const FIXTURE = `
  <div class="sticky-actions"><button id="brickGenerate">Generate</button></div>
  <button id="editorTabBrick">Brick</button><button id="editorDrawerTab-layers">Brick</button>
  <div id="editorToolbarBrick"></div>
  <div id="brickToolHint"></div>
  <div id="brickBrushSection" style="display:none;">
    <div id="brickBrushProfileToggle"><button id="brickBtnProfileStripped" class="active"></button><button id="brickBtnProfileContinuous"></button></div>
    <div id="brickBrushOrientationToggle"><button id="brickBtnOrientationStretcher" class="active"></button><button id="brickBtnOrientationSoldier"></button></div>
  </div>
  <div id="brickFramePresetList"></div>
  <div id="brickBrushPresetList"></div>
  <div id="brickPatternList"></div>
  <label id="brickFrameBandPatternLabel">Band patterns</label><div id="brickFrameBandPatternList"></div>
  <button id="brickSetRed"></button>
  <button id="brickSetWhite"></button>
  <div id="brickSizePresetList"></div>
  <input id="brickSizeSlider" type="range" min="0" max="1000" step="1" value="226"><input id="brickSize" type="number" value="0.75">
  <input id="brickGroutWidth"><input id="brickGroutDepth">
  <button id="brickBtnGroutRecessed"></button><button id="brickBtnGroutFlush"></button>
  <button id="brickBtnReliefRaised"></button><button id="brickBtnReliefCarved"></button>
  <button id="brickBtnTopOrganic" class="active"></button><button id="brickBtnTopFlat"></button>
  <div id="brickSurfaceStyleToggle"></div>
  <div id="brickSurfaceWearRow" style="display:none;"><input type="range" id="brickSurfaceWearSlider" min="0" max="1" step="0.05"><input id="brickSurfaceWear"></div>
  <div id="brickQuickSettings"></div>
  <div id="brickRaisedSection"><div id="brickRaisedModeToggle"></div><input id="brickRaisedLevel"></div>
  <div id="brickSharedSet"></div><div id="brickSharedLayout"></div>
  <div id="brickLargeStonesRow" style="display:none;"><input type="range" id="brickLargeStonesSlider" min="0" max="1" step="0.05"><input id="brickLargeStones"></div>
  <span id="stripeColoursLabel">Colours</span><input type="checkbox" id="stripeThree"><button id="stripeColorsReset"></button>
  <div id="stripeColorPresets"></div><div id="stripeColorSwatches"></div><div id="stripeBrickStyles" style="display:none;"></div>
  <div id="stripeTargetHint">Tap a rail, a contour segment or a line.</div>
  <input type="checkbox" id="brickFrameOffsetOn" checked><input id="brickFrameOffsetDistance" value="0">
  <input id="brickLevel_wall" value="0"><input id="brickLevel_frame" value="0">
  <div id="brickSidebarNoBricks" style="display:none;"></div><div id="brickStartHint" style="display:none;"></div>
  <div id="brickAccentList"></div><button id="brickAccentClick">Click bricks</button>
  <div id="brickAccentLevelRow" style="display:none;"><input id="brickAccentLevel" value="0.0625"></div>
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
  // A Bricks layer + a runBricks mock honouring the real contract: the laid key is stamped on it.
  window.svgEditor = { setMode: () => {}, _layers: [{ id: 'b', name: 'Bricks' }], _sketchLayer: { node: document.createElement('div') } };
  // ...and, like the real one, it leaves the laid kinds' bricks on the canvas (audit v2 N4/N5 read them)
  runBricks.mockImplementation((ed, _s, _fg, opts) => {
    if (opts?.laidKey != null) ed._layers[0].brickLaidKey = opts.laidKey;
    const node = ed._sketchLayer?.node;
    for (const kind of opts?.kinds || []) {
      if (!node?.appendChild || node.querySelector(`[data-brick="${kind}"]`)) continue;
      const el = document.createElement('polygon');
      el.setAttribute('data-brick-gen', '1'); el.setAttribute('data-brick', kind);
      node.appendChild(el);
    }
  });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  P.brickSettings.pattern = 'stretcher';
  P.brickSettings.frameBandPreset = 'single_soldier';
  P.brickSettings.frameBandPatterns = [];
  P.brickSettings.setId = 1;
  P.brickSettings.invert = false;
  initBrickPanel();
  $(`brickTool_${tool}`).click(); // audit C2: selecting the tool only shows its settings...
  if (tool === 'wall' || tool === 'frame') $('brickGenerate').click(); // ...Generate lays it and records what was laid
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
    fire('brickGroutDepth', 0.07, 'input'); // typing: saved, no re-mask yet (turn 189)
    expect(P.brickSettings.grout.depthIn).toBe(0.07);
    expect(notify).toHaveBeenCalledTimes(1);
    fire('brickGroutDepth', 0.07, 'change'); // settled: re-mask
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

// Audit B1-B3: pending is derived from the key stamped on the Bricks layer, which undo/redo, Cancel and
// reload all carry -- not from module memory that none of them touch.
describe('pending follows the Bricks layer key through undo, reload and Cancel', () => {
  beforeEach(() => setup('wall'));
  const layer = () => window.svgEditor._layers[0];
  const layersChanged = () => document.dispatchEvent(new CustomEvent('editorLayersChanged'));

  it('Generate stamps the current settings key on the layer', () => {
    const before = layer().brickLaidKey;
    $('brickPattern_herringbone').click();
    $('brickGenerate').click();
    expect(layer().brickLaidKey).not.toBe(before);
    expect(layer().brickLaidKey).toContain('herringbone');
  });

  it('undo restoring the older layer key shows pending; redo clears it', () => {
    const stretcherKey = layer().brickLaidKey;
    $('brickPattern_herringbone').click();
    $('brickGenerate').click();
    const herringboneKey = layer().brickLaidKey;
    layer().brickLaidKey = stretcherKey; layersChanged(); // what editor.undo() restores
    expect(pending()).toBe(true);
    layer().brickLaidKey = herringboneKey; layersChanged(); // redo
    expect(pending()).toBe(false);
  });

  it('a reopened/reloaded document whose layer key differs from the settings shows pending at once', () => {
    layer().brickLaidKey = layer().brickLaidKey.replace('stretcher', 'stack');
    layersChanged();
    expect(pending()).toBe(true);
  });

  it('Cancel restoring the entry settings (brickSettingsRestored) re-syncs the panel and the pending state', () => {
    const entry = JSON.parse(JSON.stringify(P.brickSettings));
    $('brickPattern_basketweave').click();
    expect(pending()).toBe(true);
    Object.assign(P.brickSettings, entry);
    document.dispatchEvent(new CustomEvent('brickSettingsRestored'));
    expect($('brickPattern_stretcher').classList.contains('active')).toBe(true);
    expect($('brickPattern_basketweave').classList.contains('active')).toBe(false);
    expect(pending()).toBe(false);
  });

  it('bricks with no key yet (saved before this field) are not pending until a setting changes', () => {
    delete layer().brickLaidKey; layersChanged();
    expect(pending()).toBe(false);
    $('brickPattern_flemish').click();
    expect(pending()).toBe(true);
    $('brickGenerate').click();
    expect(pending()).toBe(false);
  });
});

// Audit C3/C9/C8/C11.
describe('Generate visibility, the pending badge and a hidden Bricks layer', () => {
  const slotShown = () => $('brickGenerate').closest('.sticky-actions').style.display !== 'none';
  const badged = (id) => $(id).hasAttribute('data-brick-pending');

  it('C9: Generate shows for Wall and Frame, hides for Brush, Scissors and Stripe', () => {
    setup('wall');
    expect(slotShown()).toBe(true);
    for (const t of ['brush', 'scissors', 'stripe']) { $(`brickTool_${t}`).click(); expect(slotShown(), t).toBe(false); }
    $('brickTool_frame').click();
    expect(slotShown()).toBe(true);
  });

  it('C3: the Brick tab button carries the pending dot, also once the tool is put away', () => {
    setup('wall');
    expect(badged('editorTabBrick')).toBe(false);
    $('brickPattern_herringbone').click();
    expect(badged('editorTabBrick')).toBe(true);
    deselectTool(); // Esc's path: the Brick panel (and its Generate) gives way to Layers; the badge stays
    expect(badged('editorTabBrick')).toBe(true);
    window.svgEditor._sketchLayer = { node: { querySelector: () => ({}) } }; // Wall/Frame bricks are on the canvas
    $('brickGenerate').click(); // with no tool, Generate re-lays the bricks already there
    expect(badged('editorTabBrick')).toBe(false);
  });

  it('C11: the drawer tab label carries the dot only while it names the Brick tab', () => {
    setup('wall');
    setEditorTab('brick');
    $('brickPattern_herringbone').click();
    expect(badged('editorDrawerTab-layers')).toBe(true);
    setEditorTab('artwork'); // the drawer label now names Artwork's panel
    expect(badged('editorDrawerTab-layers')).toBe(false);
    expect(badged('editorTabBrick')).toBe(true); // the Brick tab button keeps it
    setEditorTab('brick');
    expect(badged('editorDrawerTab-layers')).toBe(true);
  });

  it('C8: laying bricks onto a hidden Bricks layer warns, and leaves the layer hidden', () => {
    setup('wall');
    window.svgEditor._layers[0].visible = false;
    $('brickPattern_flemish').click();
    $('brickGenerate').click();
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0][1]).toBe('warn');
    expect(window.svgEditor._layers[0].visible).toBe(false);
  });

  it('C8: a visible Bricks layer lays without a warning', () => {
    setup('wall');
    $('brickPattern_flemish').click();
    $('brickGenerate').click();
    expect(showToast).not.toHaveBeenCalled();
  });
});

describe('audit K2: the Band patterns heading follows the preset', () => {
  beforeEach(() => setup('frame'));
  it('hidden for the None preset (no bands), shown again for a preset with bands', () => {
    $('brickFramePreset_none').click();
    expect($('brickFrameBandPatternLabel').style.display).toBe('none');
    expect($('brickFrameBandPatternList').children.length).toBe(0);
    $('brickFramePreset_three_band').click();
    expect($('brickFrameBandPatternLabel').style.display).toBe('');
  });
});

describe('audit C1/C2 (F35 item 16): Wall and Frame are their own tools', () => {
  const kindsOfCall = (i = 0) => runBricks.mock.calls[i][3].kinds;
  const putOnCanvas = (kind) => {
    const node = document.createElement('div');
    const el = document.createElement('polygon');
    el.setAttribute('data-brick-gen', '1');
    el.setAttribute('data-brick', kind);
    node.appendChild(el);
    window.svgEditor._sketchLayer = { node };
  };
  beforeEach(() => setup('brush'));

  it('C2: picking Wall or Frame only shows its settings -- nothing is laid', () => {
    $('brickTool_wall').click();
    $('brickTool_frame').click();
    expect(runBricks).not.toHaveBeenCalled();
  });
  it('C1: Wall + Generate on an empty board lays the wall only', () => {
    $('brickTool_wall').click();
    $('brickGenerate').click();
    expect(kindsOfCall()).toEqual(['wall']);
  });
  it('C1: Frame + Generate lays the frame bands only', () => {
    $('brickTool_frame').click();
    $('brickGenerate').click();
    expect(kindsOfCall()).toEqual(['frame']);
  });
  it('Generate re-lays what is already on the canvas plus the active tool\'s own kind', () => {
    putOnCanvas('frame');
    $('brickTool_wall').click();
    $('brickGenerate').click();
    expect(kindsOfCall()).toEqual(['wall', 'frame']);
  });
  it('the Wall hint no longer claims the whole board', () => {
    $('brickTool_wall').click();
    expect($('brickToolHint').textContent).toMatch(/frame's interior/);
    expect($('brickToolHint').textContent).not.toMatch(/^Fills the whole board/);
  });
});

describe('F35 item 16: the Frame tool\'s offset from frame, and per-element Level', () => {
  let notify;
  beforeEach(() => {
    P.brickSettings.frameOffset = { on: true, distance: 0 };
    P.brickSettings.elementLevelIn = { wall: 0, frame: 0 };
    setup('frame');
    notify = vi.fn();
    window.svgEditor._notifyChange = notify;
    window.svgEditor._mW = 7; window.svgEditor._mH = 9;
  });
  it('defaults: ON at distance 0, the frame contour at 0 is what the bands follow', () => {
    expect($('brickFrameOffsetOn').checked).toBe(true);
    $('brickGenerate').click();
    expect(frameContourSilhouette.mock.calls.at(-1)[1]).toBe(0);
  });
  it('a distance is a LAYOUT change: pending, then Generate lays the bands at that distance', () => {
    fire('brickFrameOffsetDistance', 0.3, 'change');
    expect(P.brickSettings.frameOffset).toEqual({ on: true, distance: 0.3 });
    expectPendingThenGenerate();
    expect(frameContourSilhouette.mock.calls.at(-1)[1]).toBe(0.3);
  });
  it('OFF = free placement: the bands follow the board outline, the distance field is disabled', () => {
    $('brickFrameOffsetOn').checked = false;
    $('brickFrameOffsetOn').dispatchEvent(new Event('change'));
    expect(P.brickSettings.frameOffset.on).toBe(false);
    expect($('brickFrameOffsetDistance').disabled).toBe(true);
    buildRibbonPrimitives.mockClear();
    $('brickGenerate').click();
    const contour = buildRibbonPrimitives.mock.calls.at(-1)[0];
    expect(contour.map((p) => [p.p0.x, p.p0.y])).toEqual([[0, 0], [7, 0], [7, 9], [0, 9]]);
  });
  it('audit v2 N6: Level, saved per element kind, shows the Generate dot (it showed nothing before); Generate clears it', () => {
    fire('brickLevel_frame', 0.0625, 'change');
    fire('brickLevel_wall', -0.03125, 'change');
    expect(P.brickSettings.elementLevelIn).toEqual({ wall: -0.03125, frame: 0.0625 });
    expectPendingThenGenerate((c) => expect(c[1].elementLevelIn).toEqual({ wall: -0.03125, frame: 0.0625 }));
  });
});

describe("turn 189 (Fred): the Wear slider shows only for Weathered, saves on drag, re-masks on release", () => {
  let notify;
  beforeEach(() => {
    P.brickSettings.surfaceStyle = 'clean';
    P.brickSettings.surfaceWear = 0.5;
    setup('wall');
    notify = vi.fn();
    window.svgEditor._notifyChange = notify;
  });
  it('hidden for Clean, shown (at the saved value) for Weathered, hidden again for Clean', () => {
    expect($('brickSurfaceWearRow').style.display).toBe('none');
    $('brickSurfaceStyle_weathered').click();
    expect($('brickSurfaceWearRow').style.display).toBe('');
    expect($('brickSurfaceWear').value).toBe('0.5');
    $('brickSurfaceStyle_clean').click();
    expect($('brickSurfaceWearRow').style.display).toBe('none');
  });
  it('drag ticks only save; release re-masks once; never re-lays, never pending', () => {
    $('brickSurfaceStyle_weathered').click();
    notify.mockClear();
    fire('brickSurfaceWearSlider', 0.8, 'input');
    fire('brickSurfaceWearSlider', 0.9, 'input');
    expect(P.brickSettings.surfaceWear).toBe(0.9);
    expect(notify).not.toHaveBeenCalled();
    fire('brickSurfaceWearSlider', 0.9, 'change');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(runBricks).not.toHaveBeenCalled();
    expect(pending()).toBe(false);
  });
});

describe('audit C6: the Brick tab Stripe picks a brick STYLE per run (A/B/C thumbnails)', () => {
  let commit;
  beforeEach(async () => {
    P.brickSettings.stripeStyles = ['red_bricks', 'white_continuous', 'red_continuous'];
    setup('brush');
    commit = (await import('../bspline-frame-builder/b-spline-gen/html/editor/editor-commit.js')).commitEdit;
    commit.mockClear();
  });
  const visible = (id) => $(id).style.display !== 'none';

  it('in the Brick tab, Stripe shows brick-style slots (A, B; C with Use C) instead of colour swatches', async () => {
    const { setEditorTab } = await import('../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js');
    setEditorTab('brick');
    $('brickTool_stripe').click();
    expect(visible('stripeBrickStyles')).toBe(true);
    expect(visible('stripeColorSwatches')).toBe(false);
    expect(visible('stripeColorPresets')).toBe(false);
    expect($('stripeColoursLabel').textContent).toBe('Brick styles');
    expect($('stripeTargetHint').textContent).toMatch(/brush stroke/);
    expect(visible('stripeBrickSlot_A')).toBe(true);
    expect(visible('stripeBrickSlot_C')).toBe(false);
    $('stripeThree').checked = true;
    $('stripeThree').dispatchEvent(new Event('change'));
    expect(visible('stripeBrickSlot_C')).toBe(true);
    expect($('stripeBrickStyle_A_red_bricks').classList.contains('active')).toBe(true);
    expect($('stripeBrickStyle_B_white_continuous').classList.contains('active')).toBe(true);
  });
  it('back in Artwork, the panel is the colour panel again (its own hint restored)', async () => {
    const { setEditorTab } = await import('../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js');
    setEditorTab('brick');
    $('brickTool_stripe').click();
    setEditorTab('artwork');
    expect(visible('stripeBrickStyles')).toBe(false);
    expect(visible('stripeColorSwatches')).toBe(true);
    expect($('stripeColoursLabel').textContent).toBe('Colours');
    expect($('stripeTargetHint').textContent).toBe('Tap a rail, a contour segment or a line.');
  });
  it('a pick is saved, re-commits once (every striped run follows), never re-lays or pends the Wall', () => {
    $('stripeBrickStyle_B_white_bricks').click();
    expect(P.brickSettings.stripeStyles).toEqual(['red_bricks', 'white_bricks', 'red_continuous']);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(window.svgEditor._brickSettings).toBe(P.brickSettings);
    expect(runBricks).not.toHaveBeenCalled();
    expect(pending()).toBe(false);
    setStripeStyle(0, 'nope');
    expect(P.brickSettings.stripeStyles[0]).toBe('red_bricks');
  });
});

describe('turn 195: Generate failure, and item 20 (a brush stroke change makes the Wall pending)', () => {
  beforeEach(() => setup('wall'));
  it('an engine throw: error toast, Generate reports failure, the layout stays pending', () => {
    $('brickPattern_herringbone').click();
    runBricks.mockImplementationOnce(() => { throw new Error('engine boom'); });
    $('brickGenerate').click();
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0][1]).toBe('error');
    expect(showToast.mock.calls[0][0]).toMatch(/previous bricks are kept/);
    expect(pending()).toBe(true);
  });
  it('with a Wall laid, adding a brush stroke (an editor commit) marks it pending; Generate clears it', () => {
    const node = document.createElement('div');
    const wall = document.createElement('polygon');
    wall.setAttribute('data-brick-gen', '1'); wall.setAttribute('data-brick', 'wall');
    node.appendChild(wall);
    window.svgEditor._sketchLayer = { node, children: () => ({ toArray: () => [] }) };
    $('brickGenerate').click(); // lays with the wall present: its key now covers the (empty) brush set
    expect(pending()).toBe(false);
    const stroke = document.createElement('polygon');
    stroke.setAttribute('data-brick-gen', '1'); stroke.setAttribute('data-brick', 'brush'); stroke.setAttribute('points', '1,1 2,1 2,1.3 1,1.3');
    node.appendChild(stroke);
    document.dispatchEvent(new CustomEvent('editorCommit', { detail: { editor: window.svgEditor } }));
    expect(pending()).toBe(true);
    $('brickGenerate').click();
    expect(pending()).toBe(false);
    stroke.remove(); // deleting the stroke: pending again
    document.dispatchEvent(new CustomEvent('editorCommit', { detail: { editor: window.svgEditor } }));
    expect(pending()).toBe(true);
  });
});

describe('turn 197: Stripe hides the shared rows; F35 item 21 Large stones (fieldstone walls only)', () => {
  const shown = (id) => $(id).style.display !== 'none';
  beforeEach(() => {
    P.brickSettings.largeStones = 0.5;
    setup('wall');
  });
  it('Stripe declares sharedRows: false -> Set and Brick size..Seed hide; back on Wall they show', () => {
    expect(shown('brickSharedSet')).toBe(true);
    $('brickTool_stripe').click();
    expect(shown('brickSharedSet')).toBe(false);
    expect(shown('brickSharedLayout')).toBe(false);
    $('brickTool_wall').click();
    expect(shown('brickSharedSet')).toBe(true);
    expect(shown('brickSharedLayout')).toBe(true);
  });
  it('turn 199: hidden while the engine does not honour largeStones, even for a fieldstone wall', () => {
    engineOpts.extra = [];
    $('brickSetWhite').click();
    expect(shown('brickLargeStonesRow')).toBe(false);
  });
  it('the Large stones row shows only for a fieldstone wall (White Rocks, or the Fieldstone pattern)', () => {
    engineOpts.extra = ['largeStones']; // the engine honours it (T86 item 17)
    $('brickSetRed').click();
    expect(shown('brickLargeStonesRow')).toBe(false); // red brick, stretcher
    $('brickSetWhite').click();
    expect(shown('brickLargeStonesRow')).toBe(true);
    $('brickSetRed').click();
    expect(shown('brickLargeStonesRow')).toBe(false);
    $('brickPattern_fieldstone').click();
    expect(shown('brickLargeStonesRow')).toBe(true);
    engineOpts.extra = [];
  });
  it('a layout setting: the slider marks pending, Generate lays with it', () => {
    $('brickPattern_fieldstone').click();
    $('brickGenerate').click();
    runBricks.mockClear();
    fire('brickLargeStonesSlider', 0.8, 'input');
    fire('brickLargeStonesSlider', 0.8, 'change');
    expect(P.brickSettings.largeStones).toBe(0.8);
    expectPendingThenGenerate((c) => expect(c[1].largeStones).toBe(0.8));
  });
});

describe("audit (88's matrix): controls grey out while their declared requirement is unmet", () => {
  beforeEach(() => {
    P.brickSettings.suppression = 0;
    P.brickSettings.grout.profile = 'flush';
    setup('wall');
  });
  it('Clumping (both inputs) is disabled at Suppression 0, with the reason; Suppression > 0 enables it', () => {
    expect($('brickClumpingSlider').disabled).toBe(true);
    expect($('brickClumping').disabled).toBe(true);
    expect($('brickClumping').title).toMatch(/Suppression/);
    fire('brickSuppressionSlider', 0.3, 'input');
    fire('brickSuppressionSlider', 0.3, 'change');
    expect($('brickClumpingSlider').disabled).toBe(false);
    expect($('brickClumping').title).toBe('');
  });
  it('Grout depth is disabled while Flush; Recessed enables it', () => {
    window.svgEditor._notifyChange = vi.fn();
    expect($('brickGroutDepth').disabled).toBe(true);
    $('brickBtnGroutRecessed').click();
    expect($('brickGroutDepth').disabled).toBe(false);
    $('brickBtnGroutFlush').click();
    expect($('brickGroutDepth').disabled).toBe(true);
  });
});

describe('turn 197 (88): a number box applies while typing, once the typing pauses', () => {
  afterEach(() => vi.useRealTimers());
  it('Grout depth (3D-only): each keystroke saves; ONE re-mask 400 ms after the last one', () => {
    setup('wall');
    vi.useFakeTimers();
    const notify = vi.fn();
    window.svgEditor._notifyChange = notify;
    P.brickSettings.grout.profile = 'recessed';
    fire('brickGroutDepth', 0.06, 'input');
    vi.advanceTimersByTime(200);
    fire('brickGroutDepth', 0.07, 'input');
    expect(P.brickSettings.grout.depthIn).toBe(0.07);
    expect(notify).not.toHaveBeenCalled();
    vi.advanceTimersByTime(399);
    expect(notify).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(runBricks).not.toHaveBeenCalled();
  });
});

describe('turn 201: the Raised brush (a Brush variant; Level + modes in its own section)', () => {
  beforeEach(() => {
    P.brickSettings.raisedLevelIn = 0.0625;
    P.brickSettings.raisedMode = 'bricks';
    engineOpts.extra = [];
    setup('wall');
    window.svgEditor.setMode = vi.fn();
  });
  it('its own tool button; picking it arms the brush mode with live stroke overrides (Level + mode)', () => {
    $('brickTool_raisedBrush').click();
    expect(window.svgEditor.setMode).toHaveBeenCalledWith('brickBrush');
    expect(window.svgEditor._brickSettings).toBe(P.brickSettings);
    expect(window.svgEditor._brickStrokeOverrides()).toEqual({ levelIn: 0.0625, strokeMode: 'bricks' });
    fire('brickRaisedLevel', 0.125, 'input'); // changed AFTER picking the tool: the next stroke still gets it
    expect(window.svgEditor._brickStrokeOverrides().levelIn).toBe(0.125);
    expect($('brickRaisedSection').style.display).not.toBe('none');
  });
  it('the plain Brush clears the overrides', () => {
    $('brickTool_raisedBrush').click();
    $('brickTool_brush').click();
    expect(window.svgEditor._brickStrokeOverrides).toBe(null);
  });
  it('Grout mode is hidden until the engine lists groutCut, then pickable', () => {
    $('brickTool_raisedBrush').click();
    expect($('brickRaisedMode_grout').style.display).toBe('none');
    setRaisedMode('grout');
    expect(P.brickSettings.raisedMode).toBe('bricks'); // refused while hidden
    engineOpts.extra = ['groutCut'];
    $('brickTool_wall').click(); $('brickTool_raisedBrush').click();
    setRaisedMode('grout');
    expect(P.brickSettings.raisedMode).toBe('grout');
    engineOpts.extra = [];
  });
  it('Raised brush settings never make the Wall pending', () => {
    $('brickTool_raisedBrush').click();
    fire('brickRaisedLevel', 0.1, 'input');
    expect(pending()).toBe(false);
    expect(runBricks).not.toHaveBeenCalled();
  });
});

describe('F35 item 13: the Wall pattern picker is an engine-drawn icon grid, grouped into families', () => {
  beforeEach(() => setup('wall'));
  it('every pattern appears once, in a family row, icon only with the name as tooltip', async () => {
    const { BRICK_PATTERNS } = await import('../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js');
    const families = [...$('brickPatternList').querySelectorAll('.brick-pattern-family')].map((r) => r.dataset.family);
    expect(families).toEqual(['bonds', 'herringbone', 'basketweave', 'fieldstone']);
    const btns = [...$('brickPatternList').querySelectorAll('button')];
    expect(btns.map((b) => b.id.replace('brickPattern_', '')).sort()).toEqual(Object.keys(BRICK_PATTERNS).sort());
    const hb = $('brickPattern_herringbone');
    expect(hb.title).toBe('Herringbone');
    expect(hb.querySelector('svg')).not.toBeNull();
    expect(hb.textContent.trim()).toBe('');
  });
  it('the sidebar quick Wall pattern row shows the same icons (name as tooltip); the Set row stays text', () => {
    expect($('brickQuick_pattern_flemish').querySelector('svg')).not.toBeNull();
    expect($('brickQuick_pattern_flemish').title).toBe('Flemish');
    expect($('brickQuick_set_1').textContent).toBe('Red Brick');
  });
});

describe('F35 item 15: raised accents -- a preset icon grid + Click bricks, 3D-only (never pending)', () => {
  beforeEach(() => { P.brickSettings.accent = { preset: 'none', levelIn: 0.0625, clicks: [] }; setup('wall'); });
  it('None + the 10 presets, icon only with the name as tooltip; the level row hidden for None', async () => {
    const { ACCENT_PRESETS } = await import('../bspline-frame-builder/b-spline-gen/html/editor/brick-accents.js');
    const btns = [...$('brickAccentList').querySelectorAll('button')];
    expect(btns.map((b) => b.id)).toEqual(['brickAccent_none', ...ACCENT_PRESETS.map((p) => `brickAccent_${p.id}`)]);
    expect($('brickAccent_pyramid').title).toBe('Pyramid');
    expect($('brickAccent_pyramid').querySelector('svg')).not.toBeNull();
    expect($('brickAccent_pyramid').textContent.trim()).toBe('');
    expect($('brickAccent_none').classList.contains('active')).toBe(true);
    expect($('brickAccentLevelRow').style.display).toBe('none');
  });
  it('a preset pick and the level are 3D-only: saved, re-masked, never re-laid or pending', () => {
    const notify = vi.fn();
    window.svgEditor._notifyChange = notify;
    $('brickAccent_zigzag').click();
    expect(P.brickSettings.accent.preset).toBe('zigzag');
    expect($('brickAccent_zigzag').classList.contains('active')).toBe(true);
    expect($('brickAccentLevelRow').style.display).toBe('');
    fire('brickAccentLevel', -0.03125, 'change');
    expect(P.brickSettings.accent.levelIn).toBe(-0.03125);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(runBricks).not.toHaveBeenCalled();
    expect(pending()).toBe(false);
  });
  it('Click bricks arms the canvas mode as Custom; a tool pick or a preset disarms it', () => {
    const modes = [];
    window.svgEditor.setMode = (m) => { window.svgEditor._currentMode = m; modes.push(m); };
    $('brickAccentClick').click();
    expect(P.brickSettings.accent.preset).toBe('custom');
    expect(window.svgEditor._currentMode).toBe('brickAccentClick');
    expect($('brickAccentClick').classList.contains('active')).toBe(true);
    $('brickAccent_checker').click();
    expect(window.svgEditor._currentMode).toBe('select');
    expect($('brickAccentClick').classList.contains('active')).toBe(false);
    $('brickAccentClick').click();
    $('brickTool_frame').click();
    expect(modes).toContain('select');
    expect($('brickAccentClick').classList.contains('active')).toBe(false);
  });
});

describe('audit v2 (AUDIT-BRICK-TAB-v2.md): N2 N3 N4 N5 N7 N9 N11', () => {
  const shown = (id) => $(id).style.display !== 'none';
  beforeEach(() => { P.editorSvg = null; });

  it("N2: P.brickSettings REPLACED (reload / project load) -> the panel shows the board's values, editor + sidebar", () => {
    setup('brush');
    const before = P.brickSettings;
    P.brickSettings = { ...JSON.parse(JSON.stringify(before)), setId: 3, pattern: 'herringbone', brickLengthIn: 1.5, surfaceStyle: 'weathered' };
    window.svgEditor._brickSettings = before; // an armed Brush still holds the old object
    document.dispatchEvent(new CustomEvent('brickSettingsRestored'));
    expect($('brickSetWhite').classList.contains('active')).toBe(true);
    expect($('brickPattern_herringbone').classList.contains('active')).toBe(true);
    expect($('brickQuick_pattern_herringbone').classList.contains('active')).toBe(true);
    expect($('brickSize').value).toBe('1.5');
    expect(window.svgEditor._brickSettings).toBe(P.brickSettings);
    P.brickSettings = before;
  });

  it('N4: a brush-only board never shows a Generate dot (nothing for Generate to re-lay)', () => {
    setup('brush');
    firstInactive('[id^=brickSizePreset_]').click();
    $('brickSetWhite').click();
    expect(pending()).toBe(false);
    expect($('editorTabBrick').hasAttribute('data-brick-pending')).toBe(false);
  });

  it('N3: White Rocks greys the course bonds (editor + quick row) with the reason, hides the band patterns; Red restores', () => {
    setup('wall');
    $('brickSetWhite').click();
    for (const id of ['brickPattern_stretcher', 'brickPattern_flemish', 'brickQuick_pattern_stack']) {
      expect($(id).disabled, id).toBe(true);
      expect($(id).title, id).toMatch(/White Rocks/);
    }
    for (const id of ['brickPattern_herringbone', 'brickPattern_basketweave', 'brickPattern_fieldstone', 'brickPattern_none']) expect($(id).disabled, id).toBe(false);
    expect(shown('brickFrameBandPatternList')).toBe(false);
    $('brickSetRed').click();
    expect($('brickPattern_stretcher').disabled).toBe(false);
    expect($('brickPattern_stretcher').title).toBe('Stretcher'); // its own tooltip is back
    expect(shown('brickFrameBandPatternList')).toBe(true);
  });

  it('N5: no Wall/Frame bricks -> the sidebar BRICK controls are greyed with a visible reason; a Generate enables them', () => {
    setup('brush');
    expect($('brickBtnReliefCarved').disabled).toBe(true);
    expect($('brickQuick_pattern_herringbone').disabled).toBe(true);
    expect($('brickBtnReliefCarved').title).toMatch(/No Wall or Frame bricks/);
    expect(shown('brickSidebarNoBricks')).toBe(true);
    $('brickTool_wall').click();
    $('brickGenerate').click();
    expect($('brickBtnReliefCarved').disabled).toBe(false);
    expect($('brickQuick_pattern_herringbone').disabled).toBe(false);
    expect(shown('brickSidebarNoBricks')).toBe(false);
  });

  it('N5: a reloaded board whose saved drawing has wall bricks counts as laid before the editor loads it', () => {
    P.editorSvg = '<svg><polygon data-brick-gen="1" data-brick="wall" points="0,0 1,0 1,1"/></svg>';
    setup('brush');
    expect($('brickBtnReliefCarved').disabled).toBe(false);
  });

  it("N7: Scissors hides the shared rows too (a cut keeps each piece's draw-time settings)", () => {
    setup('wall');
    $('brickTool_scissors').click();
    expect(shown('brickSharedSet')).toBe(false);
    expect(shown('brickSharedLayout')).toBe(false);
  });

  it('N9: Generate with the Frame tool and no frame says so in a toast (not only the console)', () => {
    setup('frame');
    frameContext.mockImplementation(() => null);
    try {
      $('brickGenerate').click();
      expect(showToast).toHaveBeenCalledWith(FRAME_NEEDS_A_FRAME, 'warn');
    } finally {
      frameContext.mockImplementation(() => ({}));
    }
  });

  it('N11: the Brick tab with no tool on a board with no bricks shows the start hint, naming the tools', () => {
    setup('brush');
    setEditorTab('brick');
    deselectTool();
    expect(shown('brickStartHint')).toBe(true);
    expect($('brickStartHint').textContent).toMatch(/Wall/);
    expect($('brickStartHint').textContent).toMatch(/Frame/);
    expect($('brickStartHint').textContent).toMatch(/Brush/);
    $('brickTool_wall').click();
    expect(shown('brickStartHint')).toBe(false);
    setEditorTab('artwork');
    expect(shown('brickStartHint')).toBe(false);
  });
});

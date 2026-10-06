/**
 * Fred (2026-10-04): "changing the Wall pattern buttons ... and the Frame band preset buttons does
 * NOT change the layout on the canvas" -- then the ruling: in the EDITOR's Brick tab a setting change
 * only saves and marks the layout PENDING; the sticky Generate button (#brickGenerate) re-lays it.
 * In the MAIN SIDEBAR the same setters run with commit 'auto' and re-lay straight away.
 * Declared per binding in main/brick-panel.js (BRICK_COMMIT), not per call site.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
// N2 ("P.brickSettings REPLACED") re-renders every panel; MEASURED timing out at 5 s under the fleet's shared CPU (8.1 s alone
// on a loaded machine, 0.3 s on a quiet one) -- the declared heavy-test timeout, not a known failure (advisor)
vi.setConfig({ testTimeout: HEAVY_TEST_MS });
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
  // a FRAMED context, as the app's provider gives with a template picked (item 66: no templateId = the board rectangle)
  return { ...actual, frameContext: vi.fn(() => ({ defs: { templates: [] }, record: { templateId: 'template_1' } })) };
});
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, frameContourSilhouette: vi.fn(() => ({ primitives: [] })) };
});

import {
  initBrickPanel, setWallPattern, setFrameBandPreset, selectSet, setBrickSize, setInvert, setSeed, generateBricks,
  setBrickTopMode, setSurfaceStyle, setStripeStyle, setRaisedMode,
} from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { runBricks, runBricksPreview, buildRibbonPrimitives, elementSetId } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { frameContext } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { FRAME_NEEDS_A_FRAME } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { setFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
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
  <div id="brickSetRow"></div>
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
  window.svgEditor = { setMode: () => {}, _layers: [{ id: 'b', name: 'Bricks', holdsBricks: true }], _sketchLayer: { node: document.createElement('div') } };
  // ...and, like the real one, it leaves the laid kinds' bricks on the canvas (audit v2 N4/N5 read them)
  runBricks.mockImplementation((ed, _s, _fg, opts) => {
    // the real contract (item 22): each laid element's RECORD carries the key
    for (const kind of opts?.kinds || []) {
      const node = ed._sketchLayer?.node;
      if (!node?.querySelector) continue;
      const rk = kind === 'wall' ? 'wall-full' : kind;
      let rec = node.querySelector(`[data-brick-record="${rk}"]`);
      if (!rec) { rec = document.createElement('g'); rec.setAttribute('data-brick-record', rk); node.appendChild(rec); }
      if (opts.laidKey != null) rec.setAttribute('data-brick-laid', opts.laidKey);
    }
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
  P.brickSettings.setIds = { wall: 1, frame: 1, brush: 1, raisedBrush: 1 }; // item 23: per element
  P.brickSettings.invert = false;
  initBrickPanel();
  $(`brickTool_${tool}`).click(); // audit C2: selecting the tool only shows its settings...
  if (tool === 'wall' || tool === 'frame') $('brickGenerate').click(); // ...Generate lays it and records what was laid
  vi.clearAllMocks();
}
afterEach(() => { root.remove(); window.svgEditor = null; vi.unstubAllGlobals(); });

/** F35 item 27 (Fred, reversing the morning's "the editor waits for Generate"): an editor control re-lays at
 *  once, exactly once, with the new settings -- and nothing is ever pending (no dot, no tab badge). */
function expectReLaidAtOnce(check) {
  expect(runBricks).toHaveBeenCalledTimes(1);
  if (check) check(runBricks.mock.calls[0]);
  expect(pending()).toBe(false);
  expect($('brickGenerate').textContent).toBe('Generate');
  expect($('editorTabBrick').hasAttribute('data-brick-pending')).toBe(false);
}

describe('Editor Brick tab (Wall tool): item 27 -- a setting change re-lays at once, never pending', () => {
  beforeEach(() => setup('wall'));
  afterEach(() => vi.useRealTimers());
  it('not pending right after the tool laid the bricks', () => { expect(pending()).toBe(false); });
  it('a Wall pattern button', () => {
    $('brickPattern_herringbone').click();
    expect(P.brickSettings.pattern).toBe('herringbone');
    expectReLaidAtOnce((call) => expect(call[1].pattern).toBe('herringbone'));
  });
  it('the set picker (item 23: the Wall element\'s set)', () => { $('brickSet_1').click(); expectReLaidAtOnce((c) => expect(c[1].setIds.wall).toBe(1)); });
  it('a brick-size preset button', () => { firstInactive('[id^=brickSizePreset_]').click(); expectReLaidAtOnce(); });
  it('the brick-size stepper, drag and release', () => {
    fire('brickSize', 1.5, 'input'); fire('brickSize', 1.5, 'change');
    expectReLaidAtOnce((c) => expect(c[1].brickLengthIn).toBe(1.5));
  });
  it('Generate is "re-lay now": the same settings, one more lay', () => {
    $('brickGenerate').click();
    expectReLaidAtOnce((c) => expect(c[1].pattern).toBe(P.brickSettings.pattern));
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
  it('a grout width field: re-lays once the typing pauses (400 ms)', () => {
    vi.useFakeTimers();
    fire('brickGroutWidth', 0.09, 'input');
    expect(runBricks).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expectReLaidAtOnce((c) => expect(c[1].groutByElement.wall).toBe(0.09)); // the ACTIVE element's joint (Wall)
  });
  it('the seed field: re-lays once the typing pauses (400 ms)', () => {
    vi.useFakeTimers();
    fire('brickSeed', 4, 'input'); fire('brickSeed', 42, 'input');
    expect(runBricks).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expectReLaidAtOnce((c) => expect(c[1].seed).toBe(42));
  });
  it('the random-seed button re-rolls and re-lays', () => { $('brickBtnRandomSeed').click(); expectReLaidAtOnce(); });
  it('changing a setting and changing it back re-lays each time, never pending', () => {
    $('brickPattern_herringbone').click();
    $('brickPattern_stretcher').click();
    expect(runBricks).toHaveBeenCalledTimes(2);
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
    expectReLaidAtOnce((c) => expect(c[2].bands.length).toBe(2));
  });
  it('a per-band pattern button', () => { firstInactive('#brickFrameBandPatternList button').click(); expectReLaidAtOnce(); });
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
    ['set', () => selectSet(1, 'auto')],
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
  it('a layout change re-lays once; a Flat toggle after it only re-masks (no second lay)', () => {
    $('brickPattern_herringbone').click();
    $('brickBtnTopFlat').click();
    expectReLaidAtOnce((c) => expect(c[1].pattern).toBe('herringbone'));
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

describe('turn 207: Recessed is the new-board start -- Weathered keeps it, Clean leaves it Recessed', () => {
  beforeEach(() => {
    P.brickSettings.surfaceStyle = 'clean';
    P.brickSettings.grout.profile = 'recessed';
    delete P.brickSettings.groutProfileBeforeStyle;
    setup('wall');
  });
  it('nothing to restore: Weathered stores no "before", Clean keeps Recessed', () => {
    $('brickSurfaceStyle_weathered').click();
    expect(P.brickSettings.grout.profile).toBe('recessed');
    expect(P.brickSettings.groutProfileBeforeStyle).toBeUndefined();
    $('brickSurfaceStyle_clean').click();
    expect(P.brickSettings.grout.profile).toBe('recessed');
    expect($('brickBtnGroutRecessed').classList.contains('active')).toBe(true);
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
    expect(rows).toEqual(['Set', 'Brick size', 'Wall pattern', 'Frame bands', 'Grout colour']); // + F35 item 55
    expect($('brickQuick_set_1').classList.contains('active')).toBe(true);
    expect($('brickQuick_pattern_stretcher').classList.contains('active')).toBe(true);
    expect($('brickQuick_frameBands_single_soldier').classList.contains('active')).toBe(true);
  });
  it.each([
    ['set', 'brickQuick_set_1', (c) => expect(c[1].setIds).toEqual({ wall: 1, frame: 1, brush: 1, raisedBrush: 1 }), 'brickSet_1'],
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
  it('an editor change (re-laid at once, item 27) is mirrored by the quick row, which adds no second lay', () => {
    $('brickPattern_flemish').click();
    expect($('brickQuick_pattern_flemish').classList.contains('active')).toBe(true);
    expect(runBricks).toHaveBeenCalledTimes(1);
  });
  it('quick brick size re-lays at once', () => {
    $('brickQuick_size_three').click();
    expect(P.brickSettings.brickLengthIn).toBe(3);
    expect(runBricks).toHaveBeenCalledTimes(1);
    expect($('brickQuick_size_three').classList.contains('active')).toBe(true);
  });
});

// Audit B1-B3 + item 22: the key stamped on each element's RECORD records what is on the canvas; undo/redo,
// Cancel and reload all carry it. Item 27: nothing is pending, whatever the key says.
describe('the laid key through undo, reload and Cancel (item 27: never pending)', () => {
  beforeEach(() => setup('wall'));
  const wallRecord = () => window.svgEditor._sketchLayer.node.querySelector('[data-brick-record="wall-full"]');
  const wallKey = () => wallRecord()?.getAttribute('data-brick-laid');
  const layersChanged = () => document.dispatchEvent(new CustomEvent('editorLayersChanged'));

  it('Generate stamps the current settings key on the wall element', () => {
    const before = wallKey();
    $('brickPattern_herringbone').click();
    $('brickGenerate').click();
    expect(wallKey()).not.toBe(before);
    expect(wallKey()).toContain('herringbone');
  });

  it('undo restoring an older layer key, a reloaded document with a different key, a key-less old board: never pending, never re-laid', () => {
    const stretcherKey = wallKey();
    wallRecord().setAttribute('data-brick-laid', stretcherKey.replace('stretcher', 'stack')); layersChanged(); // what undo / a reopen restores
    expect(pending()).toBe(false);
    wallRecord().removeAttribute('data-brick-laid'); layersChanged(); // bricks saved before the key existed
    expect(pending()).toBe(false);
    expect(runBricks).not.toHaveBeenCalled();
  });

  it('Cancel restoring the entry settings (brickSettingsRestored) re-syncs the panel', () => {
    const entry = JSON.parse(JSON.stringify(P.brickSettings));
    $('brickPattern_basketweave').click();
    Object.assign(P.brickSettings, entry);
    document.dispatchEvent(new CustomEvent('brickSettingsRestored'));
    expect($('brickPattern_stretcher').classList.contains('active')).toBe(true);
    expect($('brickPattern_basketweave').classList.contains('active')).toBe(false);
    expect(pending()).toBe(false);
  });
});

// Audit C9/C8 (C3/C11's pending badge retired by item 27).
describe('Generate visibility, no pending badge, and a hidden Bricks layer', () => {
  const slotShown = () => $('brickGenerate').closest('.sticky-actions').style.display !== 'none';
  const badged = (id) => $(id).hasAttribute('data-brick-pending');

  it('C9: Generate shows for Wall and Frame, hides for Brush, Scissors and Stripe', () => {
    setup('wall');
    expect(slotShown()).toBe(true);
    for (const t of ['brush', 'scissors', 'stripe']) { $(`brickTool_${t}`).click(); expect(slotShown(), t).toBe(false); }
    $('brickTool_frame').click();
    expect(slotShown()).toBe(true);
  });

  it('item 27: no pending badge anywhere -- the Brick tab button, the drawer label -- after a change, with or without a tool', () => {
    setup('wall');
    setEditorTab('brick');
    $('brickPattern_herringbone').click();
    deselectTool();
    for (const id of ['editorTabBrick', 'editorDrawerTab-layers']) expect(badged(id), id).toBe(false);
  });

  it('C8: laying bricks onto a hidden Bricks layer warns, and leaves the layer hidden', () => {
    setup('wall');
    window.svgEditor._layers[0].visible = false;
    // item 22 slice 3: the warning reads the laid ELEMENT's layer (its record's) -- the wall lives on that hidden layer
    const node = window.svgEditor._sketchLayer.node;
    let rec = node.querySelector('[data-brick-record="wall-full"]');
    if (!rec) { rec = document.createElementNS('http://www.w3.org/2000/svg', 'g'); rec.setAttribute('data-brick-record', 'wall-full'); node.appendChild(rec); }
    rec.setAttribute('data-layer', window.svgEditor._layers[0].id);
    $('brickPattern_flemish').click(); // item 27: this change re-lays (and warns) at once
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

describe('F35 item 16 + 66: the band contour (the retired Offset-from-frame is a LEGACY read), and per-element Level', () => {
  let notify;
  beforeEach(() => {
    delete P.brickSettings.frameOffset; // item 66: a new board never writes it
    P.brickSettings.elementLevelIn = { wall: 0, frame: 0 };
    setup('frame');
    notify = vi.fn();
    window.svgEditor._notifyChange = notify;
    window.svgEditor._mW = 7; window.svgEditor._mH = 9;
  });
  it('item 66: no Offset-from-frame control; the bands follow the frame\'s OUTER edge (distance 0); nothing is written', () => {
    expect(document.getElementById('brickFrameOffsetOn')).toBeNull();
    expect(document.getElementById('brickFrameOffsetDistance')).toBeNull();
    $('brickGenerate').click();
    expect(frameContourSilhouette.mock.calls.at(-1)[1]).toBe(0);
    expect(P.brickSettings).not.toHaveProperty('frameOffset');
    const html = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf-8');
    expect(html).not.toMatch(/id="brickFrameOffset(On|Distance)"/);
  });
  it('legacy read: a board saved with a distance keeps laying at it (byte-identical to before item 66)', () => {
    P.brickSettings.frameOffset = { on: true, distance: 0.3 };
    $('brickGenerate').click();
    expect(frameContourSilhouette.mock.calls.at(-1)[1]).toBe(0.3);
  });
  it('legacy read: a board saved with OFF keeps following the board outline', () => {
    P.brickSettings.frameOffset = { on: false, distance: 0 };
    buildRibbonPrimitives.mockClear();
    $('brickGenerate').click();
    const contour = buildRibbonPrimitives.mock.calls.at(-1)[0];
    expect(contour.map((p) => [p.p0.x, p.p0.y])).toEqual([[0, 0], [7, 0], [7, 9], [0, 9]]);
  });
  it('audit v2 N6 (closed by item 27): Level, saved per element kind, re-lays at once like every setting', () => {
    fire('brickLevel_frame', 0.0625, 'change');
    fire('brickLevel_wall', -0.03125, 'change');
    expect(P.brickSettings.elementLevelIn).toEqual({ wall: -0.03125, frame: 0.0625 });
    expect(runBricks).toHaveBeenCalledTimes(2);
    expect(runBricks.mock.calls[1][1].elementLevelIn).toEqual({ wall: -0.03125, frame: 0.0625 });
    expect(pending()).toBe(false);
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

describe('turn 195: Generate failure, and items 20 + 27 (a brush stroke change re-lays the Wall at once)', () => {
  beforeEach(() => setup('wall'));
  it('an engine throw: error toast, the change reports failure, the previous bricks are kept', () => {
    runBricks.mockImplementationOnce(() => { throw new Error('engine boom'); });
    $('brickPattern_herringbone').click();
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0][1]).toBe('error');
    expect(showToast.mock.calls[0][0]).toMatch(/previous bricks are kept/);
    expect(pending()).toBe(false);
  });
  it('with a Wall laid, adding or deleting a brush stroke (an editor commit) re-lays the Wall once; an unrelated commit does not', () => {
    const node = window.svgEditor._sketchLayer.node; // setup laid the wall onto it
    window.svgEditor._sketchLayer.children = () => ({ toArray: () => [] });
    const commit = () => document.dispatchEvent(new CustomEvent('editorCommit', { detail: { editor: window.svgEditor } }));
    commit(); // nothing changed: no re-lay
    expect(runBricks).not.toHaveBeenCalled();
    const stroke = document.createElement('polygon');
    stroke.setAttribute('data-brick-gen', '1'); stroke.setAttribute('data-brick', 'brush'); stroke.setAttribute('points', '1,1 2,1 2,1.3 1,1.3');
    node.appendChild(stroke);
    commit();
    expect(runBricks).toHaveBeenCalledTimes(1);
    expect(runBricks.mock.calls[0][3].kinds).toContain('wall');
    commit(); // laid around it now: no second re-lay
    expect(runBricks).toHaveBeenCalledTimes(1);
    stroke.remove();
    commit();
    expect(runBricks).toHaveBeenCalledTimes(2);
    expect(pending()).toBe(false);
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
  it('the Large stones row shows only for a fieldstone wall (item 23: the Fieldstone pattern = the rock set)', () => {
    expect(shown('brickLargeStonesRow')).toBe(false); // red brick, stretcher
    $('brickPattern_fieldstone').click();
    expect(shown('brickLargeStonesRow')).toBe(true);
    $('brickSet_1').click(); // a brick set for the rock wall: bricks again
    expect(P.brickSettings.pattern).toBe('stretcher');
    expect(shown('brickLargeStonesRow')).toBe(false);
    engineOpts.extra = [];
  });
  it('a layout setting: the slider previews while dragged, re-lays with it on release', () => {
    $('brickPattern_fieldstone').click();
    runBricks.mockClear();
    fire('brickLargeStonesSlider', 0.8, 'input');
    expect(runBricks).not.toHaveBeenCalled();
    fire('brickLargeStonesSlider', 0.8, 'change');
    expect(P.brickSettings.largeStones).toBe(0.8);
    expectReLaidAtOnce((c) => expect(c[1].largeStones).toBe(0.8));
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
  // A2 (3D-panel audit, measured: under Flush the field was greyed but its + still moved 0.05 -> 0.055): a number
  // field's -/+ stepper (ui-bindings.js attachNumberSteppers' wrapper, buttons without ids) follows the field's rule
  it('a greyed number field greys its -/+ stepper too, with the same reason', () => {
    window.svgEditor._notifyChange = vi.fn();
    const input = $('brickGroutDepth');
    const wrap = document.createElement('div'); wrap.className = 'cad-stepper';
    input.parentNode.insertBefore(wrap, input);
    const minus = document.createElement('button'), plus = document.createElement('button');
    wrap.append(minus, input, plus);
    $('brickBtnGroutRecessed').click();
    $('brickBtnGroutFlush').click();
    expect([minus.disabled, plus.disabled]).toEqual([true, true]);
    expect(plus.title).toMatch(/Flush/);
    $('brickBtnGroutRecessed').click();
    expect([minus.disabled, plus.disabled]).toEqual([false, false]);
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
    expect(window.svgEditor._brickStrokeOverrides()).toMatchObject({ setId: 1, rustic: 0, levelIn: 0.0625, strokeMode: 'bricks' }); // item 23: + its set; item 29: + Rustic
    expect(window.svgEditor._brickStrokeOverrides().grout.widthIn).toBe(0.034); // + its own joint (grout per element)
    fire('brickRaisedLevel', 0.125, 'input'); // changed AFTER picking the tool: the next stroke still gets it
    expect(window.svgEditor._brickStrokeOverrides().levelIn).toBe(0.125);
    expect($('brickRaisedSection').style.display).not.toBe('none');
  });
  it('the plain Brush clears the Raised brush\'s overrides (item 23: only its own set is frozen in)', () => {
    $('brickTool_raisedBrush').click();
    $('brickTool_brush').click();
    expect(window.svgEditor._brickStrokeOverrides()).toEqual({ setId: 1, rustic: 0, grout: expect.objectContaining({ widthIn: 0.034 }) }); // item 29: + Rustic; + its joint
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

describe('F35 item 13: the Wall pattern picker is an engine-drawn icon grid (flattened: one grid, family order)', () => {
  beforeEach(() => setup('wall'));
  it('every pattern appears once, in ONE grid with no family headings, in the declared family order; icon only, name as tooltip', async () => {
    const { BRICK_PATTERNS } = await import('../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js');
    expect($('brickPatternList').querySelectorAll('.brick-pattern-family, .brick-pattern-family-label')).toHaveLength(0);
    const order = [...$('brickPatternList').children].map((b) => b.id.replace('brickPattern_', ''));
    expect(order.slice(0, 6)).toEqual(['none', 'stretcher', 'stack', 'soldier', 'header', 'flemish']); // Bonds first
    expect(order.indexOf('herringbone')).toBeLessThan(order.indexOf('fieldstone'));
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
    P.brickSettings = { ...JSON.parse(JSON.stringify(before)), pattern: 'fieldstone', brickLengthIn: 1.5, surfaceStyle: 'weathered' };
    window.svgEditor._brickSettings = before; // an armed Brush still holds the old object
    document.dispatchEvent(new CustomEvent('brickSettingsRestored'));
    expect($('brickPattern_fieldstone').classList.contains('active')).toBe(true);
    P.brickSettings.pattern = 'herringbone';
    document.dispatchEvent(new CustomEvent('brickSettingsRestored'));
    expect($('brickPattern_herringbone').classList.contains('active')).toBe(true);
    expect($('brickQuick_pattern_herringbone').classList.contains('active')).toBe(true);
    expect($('brickSize').value).toBe('1.5');
    expect(window.svgEditor._brickSettings).toBe(P.brickSettings);
    P.brickSettings = before;
  });

  it('N4: a brush-only board never shows a Generate dot (nothing for Generate to re-lay)', () => {
    setup('brush');
    firstInactive('[id^=brickSizePreset_]').click();
    $('brickSet_1').click();
    expect(pending()).toBe(false);
    expect($('editorTabBrick').hasAttribute('data-brick-pending')).toBe(false);
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

  // item 66 inverts N9's "no template -> a toast": no template = the bands follow the board rectangle; the toast stays
  // for a template whose outline cannot carry a contour
  it('item 66: the Frame tool with NO template lays its bands along the board rectangle (no toast)', () => {
    setup('frame');
    window.svgEditor._mW = 7; window.svgEditor._mH = 9;
    frameContext.mockImplementation(() => null);
    try {
      buildRibbonPrimitives.mockClear();
      $('brickGenerate').click();
      expect(showToast).not.toHaveBeenCalledWith(FRAME_NEEDS_A_FRAME, 'warn');
      expect(buildRibbonPrimitives.mock.calls.at(-1)[0].map((p) => [p.p0.x, p.p0.y])).toEqual([[0, 0], [7, 0], [7, 9], [0, 9]]);
    } finally {
      frameContext.mockImplementation(() => ({ defs: { templates: [] }, record: { templateId: 'template_1' } }));
    }
  });
  it('N9: a template whose outline cannot carry a contour says so in a toast (not only the console)', () => {
    setup('frame');
    frameContourSilhouette.mockImplementationOnce(() => ({ error: 'degenerate' }));
    $('brickGenerate').click();
    expect(showToast).toHaveBeenCalledWith(FRAME_NEEDS_A_FRAME, 'warn');
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

describe('turn 207 (Fred / 88): the Frame element (and the Wall in it) follows the frame record', () => {
  let modal;
  const openEditor = (open) => {
    modal = modal || Object.assign(document.createElement('div'), { id: 'svgEditorModal' });
    if (!modal.isConnected) document.body.appendChild(modal);
    modal.style.display = open ? '' : 'none';
  };
  afterEach(() => { modal?.remove(); modal = null; P.frame = null; });

  afterEach(() => vi.useRealTimers());
  it.each([['editor open', true], ['editor closed (sidebar)', false]])('%s: a template change re-lays the laid kinds once it settles (350 ms), never pending (item 27)', (_n, open) => {
    vi.useFakeTimers();
    setup('wall');
    openEditor(open);
    setFrameRecord({ templateId: 'template_3', params: {} });
    expect(runBricks).not.toHaveBeenCalled(); // settling
    vi.advanceTimersByTime(350);
    expect(runBricks).toHaveBeenCalledTimes(1);
    expect(runBricks.mock.calls[0][3].kinds).toEqual(['wall']);
    expect(pending()).toBe(false);
  });

  it('a handle DRAG re-lays once, after the release settles -- not per drag tick', () => {
    vi.useFakeTimers();
    setup('wall');
    openEditor(true);
    window.svgEditor._frameHandleDrag = 'h1';
    for (let k = 1; k <= 5; k++) { setFrameRecord({ templateId: 'template_3', params: { k } }); vi.advanceTimersByTime(100); }
    vi.advanceTimersByTime(1000);
    expect(runBricks).not.toHaveBeenCalled(); // still dragging
    window.svgEditor._frameHandleDrag = null; // released
    vi.advanceTimersByTime(350);
    expect(runBricks).toHaveBeenCalledTimes(1);
  });

  it('a frame write that leaves the frame as laid re-lays nothing; a tab switch never re-lays', () => {
    vi.useFakeTimers();
    setFrameRecord({ templateId: 'template_3', params: {} }); // a real record, then the bricks laid on it
    setup('wall');
    vi.advanceTimersByTime(350); // that write's own settle: laid on it already -> nothing
    setFrameRecord({}); // a write that changes nothing
    vi.advanceTimersByTime(350);
    setEditorTab('frame'); setEditorTab('brick');
    vi.advanceTimersByTime(1000);
    expect(runBricks).not.toHaveBeenCalled();
  });

  it('no laid bricks: a frame change re-lays nothing', () => {
    setup('brush');
    openEditor(false);
    setFrameRecord({ templateId: 'template_3', params: {} });
    expect(runBricks).not.toHaveBeenCalled();
  });

  // item 66 changes turn 207's "template None clears the Frame": with no template the bands follow the board rectangle,
  // so the Frame element re-lays there; a template whose outline cannot carry a contour still clears it (no geometry)
  it('Frame bricks on the canvas, template switched to None: Generate re-lays the Frame along the board rectangle', () => {
    setup('frame');
    frameContext.mockImplementation(() => null);
    try {
      $('brickGenerate').click();
      const call = runBricks.mock.calls.at(-1);
      expect(call[3].kinds).toContain('frame');
      expect(call[2]).toBeTruthy();
    } finally {
      frameContext.mockImplementation(() => ({ defs: { templates: [] }, record: { templateId: 'template_1' } }));
    }
  });
  it('Frame bricks on the canvas, a template whose outline cannot carry a contour: the Frame kind re-lays with no frame = clears it', () => {
    setup('frame');
    frameContourSilhouette.mockImplementation(() => ({ error: 'degenerate' }));
    try {
      $('brickGenerate').click();
      const call = runBricks.mock.calls.at(-1);
      expect(call[3].kinds).toContain('frame');
      expect(call[2]).toBeFalsy();
    } finally {
      frameContourSilhouette.mockImplementation(() => ({ primitives: [] }));
    }
  });
});

describe('F35 item 23: per-element Set, Fieldstone = the rock set', () => {
  const bandIds = () => [...document.querySelectorAll('#brickFrameBandPatternList button[id^=brickFrameBandPattern_]')].map((b) => b.id);
  beforeEach(() => { P.brickSettings.frameBandPatterns = []; });

  it('the Set row lists the BRICK sets from their declarations -- no White Rocks', () => {
    setup('wall');
    // T86 item 24 (seat B): Grey brick (set 4, a bond set) joins by its own declaration; Grey stone (set 5, coursed
    // rubble) is not a bond set, so like White Rocks it is not listed here
    expect([...document.querySelectorAll('#brickSetRow button')].map((b) => [b.id, b.textContent])).toEqual([['brickSet_1', 'Red Brick'], ['brickSet_4', 'Grey brick']]);
    expect([...document.querySelectorAll('#brickQuickSettings [id^=brickQuick_set_]')].map((b) => b.id)).toEqual(['brickQuick_set_1', 'brickQuick_set_4']);
  });

  it('Wall + Fieldstone: the wall is rock (no brick set shown active), laid with the Fieldstone pattern', () => {
    setup('wall');
    $('brickPattern_fieldstone').click();
    expect($('brickSet_1').classList.contains('active')).toBe(false);
    expect(runBricks.mock.calls.at(-1)[1].pattern).toBe('fieldstone');
    $('brickSet_1').click(); // a brick set for it: bricks again
    expect(P.brickSettings.pattern).toBe('stretcher');
    expect($('brickSet_1').classList.contains('active')).toBe(true);
  });

  // F35 item 46 (Fred: "these can't be changed back after clicking") inverts item 23's "then only Fieldstone is offered":
  // a band row always lists every band pattern, so a rock frame can go back to bricks
  it('Frame: Fieldstone is offered (bandCapable); picking it on one band makes EVERY band fieldstone, and every row STILL lists every band pattern', () => {
    setup('frame');
    $('brickFramePreset_three_band').click(); // setup() resets to the 1-band preset
    expect($('brickFrameBandPattern_0_fieldstone').disabled).toBe(false);
    expect(bandIds()).toContain('brickFrameBandPattern_0_soldier');
    const full = bandIds().length;
    $('brickFrameBandPattern_1_fieldstone').click();
    expect(P.brickSettings.frameBandPatterns).toEqual(FRAME_PRESETS.three_band.map(() => 'fieldstone'));
    expect(bandIds()).toHaveLength(full);
    for (let i = 0; i < FRAME_PRESETS.three_band.length; i++) expect(bandIds()).toContain(`brickFrameBandPattern_${i}_soldier`);
    expect(runBricks).toHaveBeenCalled();
  });

  it('item 46: Fieldstone, then Soldier on band 1 -> band 1 soldier, the frame is bricks again (its own set), rows still full', () => {
    setup('frame');
    $('brickFramePreset_three_band').click();
    const full = bandIds().length;
    $('brickFrameBandPattern_0_fieldstone').click();
    expect(elementSetId(P.brickSettings, 'frame')).not.toBe(elementSetId({ ...P.brickSettings, frameBandPatterns: [] }, 'frame')); // rock: the derived rock set
    runBricks.mockClear();
    $('brickFrameBandPattern_0_soldier').click();
    expect(P.brickSettings.frameBandPatterns[0]).toBe('soldier');
    expect(P.brickSettings.frameBandPatterns.slice(1).every((p) => p !== 'fieldstone')).toBe(true);
    expect(elementSetId(P.brickSettings, 'frame')).toBe(1); // Red Brick, the frame's own brick set
    expect(bandIds()).toHaveLength(full);
    expect(runBricks).toHaveBeenCalledTimes(1);
  });

  it('a rock frame stays rock across a preset change (every band of the new preset fieldstone)', () => {
    setup('frame');
    $('brickFramePreset_three_band').click();
    $('brickFrameBandPattern_0_fieldstone').click();
    $('brickFramePreset_single_soldier').click();
    expect(P.brickSettings.frameBandPatterns).toEqual(FRAME_PRESETS.single_soldier.map(() => 'fieldstone'));
  });

  it('per element: the Set row with the Frame tool turns ONLY the frame back to bricks; the rock wall stays rock', () => {
    setup('wall');
    $('brickPattern_fieldstone').click();
    $('brickTool_frame').click();
    $('brickFrameBandPattern_0_fieldstone').click();
    $('brickSet_1').click(); // with the Frame tool active
    expect(P.brickSettings.frameBandPatterns).toEqual([]);
    expect(P.brickSettings.pattern).toBe('fieldstone'); // the wall untouched
  });

  it('the sidebar quick Set applies to ALL elements (rock ones back to bricks)', () => {
    setup('wall');
    $('brickPattern_fieldstone').click();
    $('brickTool_frame').click();
    $('brickFrameBandPattern_0_fieldstone').click();
    $('brickQuick_set_1').click();
    expect(P.brickSettings.pattern).toBe('stretcher');
    expect(P.brickSettings.frameBandPatterns).toEqual([]);
    expect(P.brickSettings.setIds).toEqual({ wall: 1, frame: 1, brush: 1, raisedBrush: 1 });
    expect($('brickQuick_set_1').classList.contains('active')).toBe(true);
  });

  it('(c) a wall can carry a raised preset while the frame has none: accents are the Wall\'s alone', () => {
    setup('wall');
    $('brickAccent_sparseDots').click();
    expect(P.brickSettings.accent.preset).toBe('sparseDots');
    expect(runBricks.mock.calls.every((c) => !c[3].kinds.includes('frame') || c[3].kinds.includes('wall'))).toBe(true);
  });
});

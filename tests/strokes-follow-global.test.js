/**
 * Audit A6 (seat E, on seat D's draft): the drawn Brush / Raised strokes follow the GLOBAL brick size (Fred: single size),
 * and the sidebar's quick Set ("apply to all") -- never an element's own Set row (a stroke keeps its own set). Its own file
 * (the mocks / fixture / setup of brick-discrete-controls-regen.test.js, which runs out of heap).
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



import { strokesFollowGlobals, STROKE_FOLLOWS_GLOBAL, STROKE_FOLLOWS_QUICK_SET } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { commitEdit } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-commit.js';

const spineIn = (node, id, snap) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  Object.entries({ x1: 1, y1: 1, x2: 3, y2: 1, 'data-brick': 'brush-spine', 'data-brick-element': id, 'data-layer': 'b', 'data-brick-settings': JSON.stringify(snap) })
    .forEach(([k, v]) => el.setAttribute(k, String(v)));
  node.appendChild(el);
  return el;
};
const snapOf = (el) => JSON.parse(el.getAttribute('data-brick-settings'));

describe('A6: the strokes follow the global size, and the quick Set', () => {
  it('declared: size is global; the quick Set adds the set', () => {
    setup('brush');
    expect(STROKE_FOLLOWS_GLOBAL).toEqual(['brickLengthIn']);
    expect(STROKE_FOLLOWS_QUICK_SET).toEqual(['setId']);
  });
  it('strokesFollowGlobals writes only the given keys into every stroke, once', () => {
    setup('brush');
    const node = window.svgEditor._sketchLayer.node;
    const a = spineIn(node, 's1', { setId: 1, brickLengthIn: 1.25, seed: 3 }), b = spineIn(node, 's2', { setId: 4, brickLengthIn: 1.25 });
    expect(strokesFollowGlobals(window.svgEditor, { brickLengthIn: 0.75, setId: 1 })).toBe(2);
    expect(snapOf(a)).toEqual({ setId: 1, brickLengthIn: 0.75, seed: 3 });
    expect(snapOf(b).setId).toBe(4); // its own set kept
    expect(strokesFollowGlobals(window.svgEditor, { brickLengthIn: 0.75 })).toBe(0);
    expect(strokesFollowGlobals(window.svgEditor, { setId: 4 }, ['setId'])).toBe(1);
  });
  it('a Brick size change re-lays a stroke-only board\'s strokes (their own commit: nothing else to re-lay)', () => {
    setup('brush');
    const s = spineIn(window.svgEditor._sketchLayer.node, 's1', { setId: 1, brickLengthIn: 1.25 });
    setBrickSize(0.75, 'auto');
    expect(snapOf(s).brickLengthIn).toBe(0.75);
    expect(commitEdit).toHaveBeenCalledTimes(1);
  });
  it('the quick Set (apply to all) reaches the strokes; the Brush tool\'s own Set row does not', () => {
    setup('wall'); // a Wall on the board: the quick rows are live (on main they grey on a stroke-only board until brush-grout)
    const s = spineIn(window.svgEditor._sketchLayer.node, 's1', { setId: 1, brickLengthIn: P.brickSettings.brickLengthIn });
    $('brickTool_brush').click();
    $('brickSet_4').click(); // the Brush element's own set: the NEXT strokes
    expect(P.brickSettings.setIds.brush).toBe(4);
    expect(snapOf(s).setId).toBe(1);
    $('brickQuick_set_4').click(); // every element
    expect(snapOf(s).setId).toBe(4);
  });
});

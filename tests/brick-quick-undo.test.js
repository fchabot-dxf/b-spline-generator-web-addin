/**
 * Item 71 (seat E, measured live on main 3a6c2a7): a sidebar Brick quick pick (pattern / size / frame bands / grout
 * colour) took NO global undo step -- the main screen's Undo then undid the older Apply step: pre-lay brick settings
 * came back while the laid bricks and the 3D stayed as picked. Now each pick is ONE global step through
 * core/history.js recordBoardStep: its settings in P, its drawing as the step's own restore. Live: Undo -> settings,
 * brick geometry, 3D and the quick row all back; Redo -> the pick again (pattern, size, frame bands, grout colour).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { globalHistoryLog, globalRedoLog, takeSnapshot, recordBoardStep, unifiedUndo, unifiedRedo } from '../bspline-frame-builder/b-spline-gen/html/core/history.js';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js', async (importOriginal) => {
  const actual = await importOriginal();
  const red = actual.BRICK_SETS.find((s) => s.id === 1);
  const sets = Object.freeze([...actual.BRICK_SETS, { ...red, id: 7, name: 'Grey Brick' }]);
  return { ...actual, BRICK_SETS: sets, brickSetById: (id) => sets.find((s) => s.id === id) || null };
});

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runBricks: vi.fn(() => ({ wallCount: 3, frameCount: 0 })), runBricksPreview: vi.fn(), runBricksOutlinePreview: vi.fn(), buildRibbonPrimitives: vi.fn(() => []) };
});
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/toast.js', () => ({ showToast: vi.fn() }));
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

import { initBrickPanel } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';

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
  <div id="brickPatternList"></div><div id="brickRusticRow_wall" style="display:none;"><input type="range" id="brickRusticSlider_wall"><input id="brickRustic_wall"></div><div id="brickRusticRow_brush" style="display:none;"><input type="range" id="brickRusticSlider_brush"><input id="brickRustic_brush"></div>
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
let root;
function setup(tool = 'wall') {
  root = document.createElement('div');
  root.innerHTML = FIXTURE;
  document.body.appendChild(root);
  window.svgEditor = { setMode: () => {}, _layers: [{ id: 'b', name: 'Bricks', holdsBricks: true }], _sketchLayer: { node: document.createElement('div') }, _undoStack: [] };
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  P.brickSettings.pattern = 'stretcher';
  P.brickSettings.rusticByElement = { wall: 0, brush: 0 };
  P.brickSettings.frameBandPatterns = [];
  initBrickPanel();
  $(`brickTool_${tool}`).click();
  vi.clearAllMocks();
}
afterEach(() => { root?.remove(); window.svgEditor = null; vi.unstubAllGlobals(); engineOpts.extra = []; });

const resetHistory = () => { globalHistoryLog.length = 0; globalRedoLog.length = 0; takeSnapshot('Initial'); };

describe('item 71: recordBoardStep -- a sidebar board change is one global step that restores its drawing', () => {
  afterEach(() => { document.getElementById('svgEditorModal')?.remove(); });

  it('the step keeps the drawing before it; Undo restores that drawing (and the P before), Redo the drawing after', () => {
    resetHistory();
    P.editorSvg = '<svg>before</svg>';
    const out = recordBoardStep('Bricks: test', () => { P.brickSettings.pattern = 'herringbone'; return 42; });
    expect(out).toBe(42);
    const step = globalHistoryLog[globalHistoryLog.length - 1];
    expect(step.label).toBe('Bricks: test');
    expect(step.restore).toEqual({ editorSvg: { before: '<svg>before</svg>' } });
    P.editorSvg = '<svg>after</svg>'; // the re-lay's own serialize lands later
    const seen = [];
    unifiedUndo((snap, restore) => seen.push(['undo', snap.label, restore]));
    unifiedRedo((snap, restore) => seen.push(['redo', snap.label, restore]));
    expect(seen).toEqual([['undo', 'Before Bricks: test', { editorSvg: '<svg>before</svg>' }], ['redo', 'Bricks: test', { editorSvg: '<svg>after</svg>' }]]);
  });

  it('records the current board first when the newest snapshot no longer matches it', () => {
    resetHistory();
    P.brickSettings.seed = (P.brickSettings.seed || 0) + 1; // a change that took no step
    recordBoardStep('Bricks: test', () => {});
    expect(globalHistoryLog.map((s) => s.label)).toEqual(['Initial', 'Before Bricks: test', 'Bricks: test']);
  });

  it('inside the editor no global step is taken (the editor owns its undo)', () => {
    resetHistory();
    const modal = document.createElement('div'); modal.id = 'svgEditorModal'; modal.style.display = 'block'; document.body.appendChild(modal);
    let ran = false;
    recordBoardStep('Bricks: test', () => { ran = true; });
    expect(ran).toBe(true);
    expect(globalHistoryLog.map((s) => s.label)).toEqual(['Initial']);
  });
});

describe('item 71: every sidebar quick Brick pick is one global step', () => {
  afterEach(() => { root?.remove(); window.svgEditor = null; vi.unstubAllGlobals(); });

  it('a quick pattern pick: one step named after its row, keeping the drawing before it', () => {
    setup();
    resetHistory();
    P.editorSvg = '<svg>laid</svg>';
    $('brickQuick_pattern_herringbone').disabled = false; // the fixture board has no laid bricks (BRICK_CONTROL_REQUIRES greys it); the gating is not under test
    $('brickQuick_pattern_herringbone').click();
    expect(P.brickSettings.pattern).toBe('herringbone');
    const step = globalHistoryLog[globalHistoryLog.length - 1];
    expect(step.label).toBe('Bricks: Wall pattern');
    expect(step.restore.editorSvg.before).toBe('<svg>laid</svg>');
  });
});

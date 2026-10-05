/**
 * F35 item 13: the Wall pattern's ROTATION chips (0 / 45 / 90, WALL_ROTATIONS) under the Wall pattern grid --
 * hidden until the engine lists rotationDeg (seat B, T86 item 29), a pick re-lays at once and persists in
 * P.brickSettings.wallRotationDeg (the neutral matrix set carries it too).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

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

import { initBrickPanel, setWallRotation, WALL_ROTATIONS } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { runBricks } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { MIGRATION } from '../tools/brick-matrix/controls.mjs';

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
  <div id="brickPatternList"></div><div id="brickWallRotationRow"></div><div id="brickRusticRow_wall" style="display:none;"><input type="range" id="brickRusticSlider_wall"><input id="brickRustic_wall"></div><div id="brickRusticRow_brush" style="display:none;"><input type="range" id="brickRusticSlider_brush"><input id="brickRustic_brush"></div>
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
  P.brickSettings.wallRotationDeg = 0;
  P.brickSettings.frameBandPatterns = [];
  initBrickPanel();
  $(`brickTool_${tool}`).click();
  vi.clearAllMocks();
}
afterEach(() => { root?.remove(); window.svgEditor = null; vi.unstubAllGlobals(); engineOpts.extra = []; });

const shown = (id) => $(id).style.display !== 'none';
const chips = () => [...$('brickWallRotationRow').querySelectorAll('button')];

describe('F35 item 13: Wall rotation chips', () => {
  it('declared 0 / 45 / 90; state defaults to 0', () => {
    expect([...WALL_ROTATIONS]).toEqual([0, 45, 90]);
    expect(P.brickSettings.wallRotationDeg).toBe(0);
  });
  it('hidden until the engine lists rotationDeg, then one chip per declared angle, 0 active', () => {
    setup();
    expect(shown('brickWallRotationRow')).toBe(false);
    root.remove(); engineOpts.extra = ['rotationDeg'];
    setup();
    expect(shown('brickWallRotationRow')).toBe(true);
    expect(chips().map((b) => b.id)).toEqual(['brickWallRotation_0', 'brickWallRotation_45', 'brickWallRotation_90']);
    expect(chips().filter((b) => b.classList.contains('active')).map((b) => b.id)).toEqual(['brickWallRotation_0']);
  });
  it('a chip click persists the angle, marks it active and re-lays at once; an undeclared angle is ignored', () => {
    engineOpts.extra = ['rotationDeg'];
    setup();
    $('brickWallRotation_45').click();
    expect(P.brickSettings.wallRotationDeg).toBe(45);
    expect($('brickWallRotation_45').classList.contains('active')).toBe(true);
    expect(runBricks).toHaveBeenCalledTimes(1);
    runBricks.mockClear();
    setWallRotation(30);
    expect(P.brickSettings.wallRotationDeg).toBe(45);
    expect(runBricks).not.toHaveBeenCalled();
  });
  it('the matrix neutral set pins it to 0', () => {
    expect(MIGRATION.neutralNewFields.wallRotationDeg).toBe(0);
  });
});

/**
 * F35 item 29 (a) + (b): the RUSTIC slider (Wall + Brush; hidden until the engine lists 'rustic', seat B T86-22;
 * the Wall's only for a running bond) and WEAR on rock walls (the existing Weathered Wear slider must show for a
 * fieldstone wall too: the engine side is seat B's T86-23).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runBricks: vi.fn(() => ({ wallCount: 3, frameCount: 0 })), runBricksPreview: vi.fn(), runBricksOutlinePreview: vi.fn(), buildRibbonPrimitives: vi.fn(() => []) };
});
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/toast.js', () => ({ showToast: vi.fn() }));
const engineOpts = vi.hoisted(() => ({ extra: [], without: ['rustic'] })); // T86 item 22 lists rustic: test both states
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, get ENGINE_OPTIONS() { return [...actual.ENGINE_OPTIONS.filter((o) => !engineOpts.without.includes(o)), ...engineOpts.extra]; } };
});
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, frameContext: vi.fn(() => ({})) };
});
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, frameContourSilhouette: vi.fn(() => ({ primitives: [] })) };
});

import { initBrickPanel, setRustic, setWallPattern, setSurfaceStyle } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { runBricks, isRunningBond } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

const FIXTURE = `
  <div class="sticky-actions"><button id="brickGenerate">Generate</button></div>
  <button id="editorTabBrick">Brick</button>
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

const shown = (id) => $(id).style.display !== 'none';

describe('item 29 (a): Rustic', () => {
  it('a running bond = a coursed pattern whose courses stagger (from BRICK_PATTERNS, not a name list)', () => {
    expect(isRunningBond('stretcher')).toBe(true);
    expect(isRunningBond('header')).toBe(true);
    for (const p of ['stack', 'soldier', 'flemish', 'herringbone', 'fieldstone', 'none']) expect(isRunningBond(p), p).toBe(false);
  });
  it('hidden until the engine lists rustic -- then the Wall row only for a running bond, the Brush row always', () => {
    setup();
    expect(shown('brickRusticRow_wall')).toBe(false);
    expect(shown('brickRusticRow_brush')).toBe(false);
    root.remove(); engineOpts.extra = ['rustic'];
    setup();
    expect(shown('brickRusticRow_wall')).toBe(true);
    expect(shown('brickRusticRow_brush')).toBe(true);
    setWallPattern('stack');
    expect(shown('brickRusticRow_wall')).toBe(false);
    setWallPattern('stretcher');
    expect(shown('brickRusticRow_wall')).toBe(true);
  });
  it('per element: the Wall value re-lays the wall; a Brush value only saves (each new stroke freezes it)', () => {
    engineOpts.extra = ['rustic'];
    setup();
    setRustic('wall', 0.4);
    expect(P.brickSettings.rusticByElement).toEqual({ wall: 0.4, brush: 0 });
    expect(runBricks).toHaveBeenCalledTimes(1);
    runBricks.mockClear();
    setRustic('brush', 1.7); // clamped to 0..1
    expect(P.brickSettings.rusticByElement.brush).toBe(1);
    expect(runBricks).not.toHaveBeenCalled();
    $('brickTool_brush').click();
    expect(window.svgEditor._brickStrokeOverrides().rustic).toBe(1);
  });
});

describe('item 29 (b): Wear on rocks', () => {
  it('the Weathered Wear slider shows for a rock (fieldstone) wall exactly as for bricks -- it follows the style only', () => {
    setup();
    setSurfaceStyle('weathered');
    expect(shown('brickSurfaceWearRow')).toBe(true);
    setWallPattern('fieldstone');
    setSurfaceStyle('weathered');
    expect(shown('brickSurfaceWearRow')).toBe(true);
    setSurfaceStyle('clean');
    expect(shown('brickSurfaceWearRow')).toBe(false);
  });
});

/**
 * Item 33: the Frame element's CORNERS row (panel side): an engine-drawn mini corner per FRAME_CORNERS entry, the
 * preset's own corner active by default, a pick re-lays at once, the old corner-variant presets no longer listed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
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

import { initBrickPanel, setFrameRock } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { runBricks, FRAME_CORNERS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
vi.setConfig({ testTimeout: HEAVY_TEST_MS }); // the declared heavy-test timeout: timed out at 5 s under the fleet's load (turns 261-265)

const FIXTURE = `
  <div class="sticky-actions"><button id="brickGenerate">Generate</button></div>
  <button id="editorTabBrick">Brick</button><button id="editorDrawerTab-layers">Brick</button>
  <div id="editorToolbarBrick"></div>
  <div id="brickToolHint"></div>
  <div id="brickBrushSection" style="display:none;">
    <div id="brickBrushProfileToggle"><button id="brickBtnProfileStripped" class="active"></button><button id="brickBtnProfileContinuous"></button></div>
    <div id="brickBrushOrientationToggle"><button id="brickBtnOrientationStretcher" class="active"></button><button id="brickBtnOrientationSoldier"></button></div>
  </div>
  <div id="brickFramePresetList"></div><label id="brickFrameCornerLabel">Corners</label><div id="brickFrameCornerList"></div>
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



const activeCorner = () => [...document.querySelectorAll('[id^=brickFrameCorner_]')].filter((b) => b.classList.contains('active')).map((b) => b.id);

describe('item 33: the Corners row in the Frame section', () => {
  beforeEach(() => { P.brickSettings.frameBandPreset = 'single_soldier'; P.brickSettings.frameCorner = null; P.brickSettings.frameBandPatterns = []; });
  it('one button per corner style, each with its tooltip; plain Soldier shows Mitre active', () => {
    setup('frame');
    for (const c of FRAME_CORNERS) expect($(`brickFrameCorner_${c.id}`).title, c.id).toBe(c.title);
    expect(activeCorner()).toEqual(['brickFrameCorner_mitre']);
    expect(shown('brickFrameCornerList')).toBe(true);
  });
  it('the folded variants are gone from the preset list; Soldier x2 stays (its own corner: lapped)', () => {
    setup('frame');
    expect($('brickFramePreset_butt_frame')).toBeNull();
    expect($('brickFramePreset_quoin_corners')).toBeNull();
    expect($('brickFramePreset_double_course').title).toBe('Soldier x2');
    $('brickFramePreset_double_course').click();
    expect(activeCorner()).toEqual(['brickFrameCorner_lapped']);
  });
  it('a pick sets the element\u2019s corner and re-lays at once; a new preset starts on its own corner again', () => {
    setup('frame');
    runBricks.mockClear();
    $('brickFrameCorner_block').click();
    expect(P.brickSettings.frameCorner).toBe('block');
    expect(activeCorner()).toEqual(['brickFrameCorner_block']);
    expect(runBricks).toHaveBeenCalled();
    $('brickFramePreset_three_band').click();
    expect(P.brickSettings.frameCorner).toBeNull();
    expect(activeCorner()).toEqual(['brickFrameCorner_mitre']);
  });
  it('hidden for no bands (None) and for a rock frame', () => {
    setup('frame');
    $('brickFramePreset_none').click();
    expect(shown('brickFrameCornerList')).toBe(false);
    $('brickFramePreset_single_soldier').click();
    expect(shown('brickFrameCornerList')).toBe(true);
    setFrameRock(true);
    expect(shown('brickFrameCornerList')).toBe(false);
    setFrameRock(false);
  });
  it('audit N10: the preset buttons and every band’s pattern buttons carry their name as the tooltip', () => {
    setup('frame');
    $('brickFramePreset_three_band').click();
    expect($('brickFramePreset_three_band').title).toBe('Soldier / Stretcher / Soldier');
    for (const i of [0, 1, 2]) expect($(`brickFrameBandPattern_${i}_header`).title, `band ${i}`).toBe('Header');
    // turn 261: a band row lists only what a band can lay -- the Wall-only patterns are absent, not greyed
    for (const id of ['herringbone', 'basketweave', 'chevron', 'square_grid', 'none']) expect($(`brickFrameBandPattern_0_${id}`), id).toBeNull();
    expect($('brickFrameBandPattern_0_fieldstone')).toBeTruthy(); // band-capable
  });
});

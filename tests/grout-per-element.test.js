/**
 * Grout PER ELEMENT (advisor; Fred: rubble gets wider joints; a rock frame + a brick wall need two joints):
 * groutByElement {wall, frame, brush}; null = the element's set's declared joint; the Grout box edits the ACTIVE
 * element's; a set change (incl. a Fieldstone pick making it rock) falls back to the new set's joint.
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

import { initBrickPanel, setWallPattern, selectSet } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { runBricks, elementGroutWidth, ROCK_SET_ID } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { brickSetById as setForId } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { MIGRATIONS } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';

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
  P.brickSettings.frameBandPatterns = [];
  initBrickPanel();
  $(`brickTool_${tool}`).click();
  vi.clearAllMocks();
}
afterEach(() => { root?.remove(); window.svgEditor = null; vi.unstubAllGlobals(); engineOpts.extra = []; });

const shown = (id) => $(id).style.display !== 'none';

const box = () => $('brickGroutWidth');
const type = (v) => { box().value = String(v); box().dispatchEvent(new Event('change')); };

describe('grout per element', () => {
  it('the box edits the ACTIVE element’s joint; the other keeps its own; switching tools shows each', () => {
    setup('frame');
    P.brickSettings.groutByElement = { wall: null, frame: null, brush: null };
    type(0.06);
    expect(P.brickSettings.groutByElement.frame).toBe(0.06);
    expect(elementGroutWidth(P.brickSettings, 'wall')).toBe(setForId(1).grout.widthIn);
    $('brickTool_wall').click();
    expect(Number(box().value)).toBe(setForId(1).grout.widthIn);
    $('brickTool_frame').click();
    expect(Number(box().value)).toBe(0.06);
  });
  it('a Fieldstone pick makes the wall rock: its joint falls back to the ROCK set’s declared one, and the box reads it', () => {
    setup('wall');
    P.brickSettings.groutByElement = { wall: 0.05, frame: null, brush: null };
    setWallPattern('fieldstone');
    const rockJoint = setForId(ROCK_SET_ID).grout.widthIn;
    expect(P.brickSettings.groutByElement.wall).toBeNull();
    expect(elementGroutWidth(P.brickSettings, 'wall')).toBe(rockJoint);
    expect(Number(box().value)).toBe(rockJoint);
    expect(rockJoint).toBeGreaterThan(setForId(1).grout.widthIn); // rubble: wider joints
    expect(runBricks).toHaveBeenCalled(); // and the stones re-lay with it
  });
  it('a set change from the Set picker resets that element only', () => {
    setup('wall');
    P.brickSettings.groutByElement = { wall: 0.05, frame: 0.07, brush: null };
    selectSet(1, 'auto', ['wall']); // same set: nothing changes
    expect(P.brickSettings.groutByElement).toEqual({ wall: 0.05, frame: 0.07, brush: null });
  });
});

describe("migration 'grout-per-element'", () => {
  const m = () => MIGRATIONS.find((x) => x.id === 'grout-per-element');
  it('runs after brick-set-per-element; a saved board keeps its exact width on every element', () => {
    const ids = MIGRATIONS.map((x) => x.id);
    expect(ids.indexOf('grout-per-element')).toBeGreaterThan(ids.indexOf('brick-set-per-element'));
    const p = { brickSettings: { setIds: { wall: 1 }, grout: { widthIn: 0.05, depthIn: 0.04, profile: 'flush' } } };
    expect(m().when(p)).toBe(true);
    m().apply(p);
    expect(p.brickSettings.groutByElement).toEqual({ wall: 0.05, frame: 0.05, brush: 0.05 });
    expect(p.brickSettings.grout).toEqual({ depthIn: 0.04, profile: 'flush' });
    expect(m().when(p)).toBe(false); // once
  });
});

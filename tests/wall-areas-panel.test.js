/**
 * F35 item 22 slice 2: the Wall's AREA sub-tool (panel side) -- hidden until the engine lists wallRegion; armed it
 * paints (editor mode brickWallArea), shows the width chips + Clear areas; a stroke goes into the selected area or
 * starts a new one (selected, laid at once); Select on an area brings its own settings into the section.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
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
  // the base drops wallRegion (the engine lists it now) so both states are tested
  return { ...actual, get ENGINE_OPTIONS() { return [...actual.ENGINE_OPTIONS.filter((o) => o !== 'wallRegion'), ...engineOpts.extra]; } };
});
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, frameContext: vi.fn(() => ({})) };
});
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, frameContourSilhouette: vi.fn(() => ({ primitives: [] })) };
});

import { initBrickPanel, paintWallArea, clearAllWallAreas, selectBrickElement, setWallAreaWidth, setWallPattern, WALL_AREA_WIDTHS } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { runBricks, wallAreaRecords } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { MIGRATION } from '../tools/brick-matrix/controls.mjs';
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
  <div id="brickFramePresetList"></div>
  <div id="brickBrushPresetList"></div>
  <div id="brickSubTools_wall"></div><div id="brickElementLabel_wall"></div><div id="brickWallAreaRow" style="display:none;"></div><div id="brickPatternList"></div><div id="brickRusticRow_wall" style="display:none;"><input type="range" id="brickRusticSlider_wall"><input id="brickRustic_wall"></div><div id="brickRusticRow_brush" style="display:none;"><input type="range" id="brickRusticSlider_brush"><input id="brickRustic_brush"></div>
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
  const node = document.createElement('div');
  const wrap = (el) => { const api = { node: el, attr: (k, v) => { if (v === undefined) return el.getAttribute(k); el.setAttribute(k, String(v)); return api; },
    addClass: (c) => { el.classList.add(c); return api; }, removeClass: (c) => { el.classList.remove(c); return api; }, hasClass: (c) => el.classList.contains(c) }; return api; };
  window.svgEditor = { setMode: vi.fn(), _activeLayer: 'b', _layers: [{ id: 'b', name: 'Layer 1', visible: true }], _undoStack: [],
    _sketchLayer: { node, children: () => Object.assign([], { toArray: () => [] }) /* svg.js: an array (item 64: a kind layer runs addLayer) */, group: () => { const el = document.createElementNS('http://www.w3.org/2000/svg', 'g'); node.appendChild(el); return wrap(el); } } };
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  P.brickSettings.pattern = 'stretcher';
  P.brickSettings.rusticByElement = { wall: 0, brush: 0 };
  P.brickSettings.wallAreaWidthIn = 1;
  P.brickSettings.frameBandPatterns = [];
  initBrickPanel();
  $(`brickTool_${tool}`).click();
  vi.clearAllMocks();
}
afterEach(() => { root?.remove(); window.svgEditor = null; vi.unstubAllGlobals(); engineOpts.extra = []; });

const shown = (id) => $(id) && $(id).style.display !== 'none';
const ed = () => window.svgEditor;
const pts = (x) => [{ x, y: 2 }, { x: x + 1, y: 2 }];

describe('slice 2: the Area sub-tool', () => {
  it('hidden until the engine lists wallRegion', () => {
    setup();
    expect(shown('brickSubTool_wall_area')).toBe(false);
    root.remove(); engineOpts.extra = ['wallRegion'];
    setup();
    expect(shown('brickSubTool_wall_area')).toBe(true);
  });
  it('armed: the paint mode, the width chips + Clear areas row; a width chip sets the width of the next strokes', async () => {
    engineOpts.extra = ['wallRegion'];
    setup();
    $('brickSubTool_wall_area').click();
    expect(ed().setMode).toHaveBeenLastCalledWith('brickWallArea');
    expect(shown('brickWallAreaRow')).toBe(true);
    expect([...$('brickWallAreaRow').querySelectorAll('button')].map((b) => b.id))
      .toEqual(['brickWallAreaWidth_0_5', 'brickWallAreaWidth_1', 'brickWallAreaWidth_2', 'brickWallAreasClear']);
    setWallAreaWidth(2);
    expect(P.brickSettings.wallAreaWidthIn).toBe(2);
    expect(ed()._brickAreaWidthIn).toBe(2);
    expect([...WALL_AREA_WIDTHS]).toEqual([0.5, 1, 2]);
    $('brickSubTool_wall_select').click();
    expect(shown('brickWallAreaRow')).toBe(false);
  });
  it('a stroke starts a new area (selected, laid at once); the next stroke goes into it; deselected, a new one', () => {
    engineOpts.extra = ['wallRegion'];
    setup();
    $('brickSubTool_wall_area').click();
    const a = ed()._brickWallArea(pts(1));
    expect(runBricks).toHaveBeenCalledTimes(1);
    expect(ed()._brickWallAreaId).toBe(a);
    paintWallArea(pts(3));
    expect(wallAreaRecords(ed()).map((r) => r.strokes.length)).toEqual([2]);
    selectBrickElement(null);
    expect(ed()._brickWallAreaId).toBe(null);
    const b = paintWallArea(pts(5));
    expect(b).not.toBe(a);
    expect(wallAreaRecords(ed()).map((r) => r.id)).toEqual([a, b]);
    expect(wallAreaRecords(ed())[0].strokes[0].widthIn).toBe(1);
  });
  it('Select on an area brings ITS settings into the section', () => {
    engineOpts.extra = ['wallRegion'];
    setup();
    const a = paintWallArea(pts(1)); // laid with stretcher
    selectBrickElement(null);
    setWallPattern('herringbone');
    paintWallArea(pts(3));
    selectBrickElement({ id: a, kind: 'wall' });
    expect(P.brickSettings.pattern).toBe('stretcher');
    expect(ed()._brickWallAreaId).toBe(a);
  });
  it('Clear areas removes every area and re-lays the full wall', () => {
    engineOpts.extra = ['wallRegion'];
    setup();
    paintWallArea(pts(1));
    runBricks.mockClear();
    expect(clearAllWallAreas()).toBe(true);
    expect(wallAreaRecords(ed())).toEqual([]);
    expect(runBricks).toHaveBeenCalledTimes(1);
  });
  it('the width persists with the settings; the matrix neutral set pins it', () => {
    expect(P.brickSettings.wallAreaWidthIn).toBe(1);
    expect(MIGRATION.neutralNewFields.wallAreaWidthIn).toBe(1);
  });
});

/**
 * F35 item 35: the Frame's band-fit note. When the engine reduces a frame stack to fit the board (generateBricks
 * `bandsReduced`, T86 item 28), the Frame section says so in plain words in place of the empty-wall warning (which
 * stays only when the reduced stack still does not fit), and the bands it dropped grey out with why.
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

import { initBrickPanel, bandsReducedText } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { runBricks } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { BRICK_CONTROL_REQUIRES } from '../bspline-frame-builder/b-spline-gen/html/main/brick-control-requires.js';
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
  <div id="brickPatternList"></div><div id="brickRusticRow_wall" style="display:none;"><input type="range" id="brickRusticSlider_wall"><input id="brickRustic_wall"></div><div id="brickRusticRow_brush" style="display:none;"><input type="range" id="brickRusticSlider_brush"><input id="brickRustic_brush"></div>
  <div id="brickFrameBandsNoteRow"><div id="brickFrameBandsNote" data-brick-lay-notes="frame" style="display:none;"></div></div><div id="brickLayWarnings" data-brick-lay-warnings style="display:none;"></div><label id="brickFrameBandPatternLabel">Band patterns</label><div id="brickFrameBandPatternList"></div>
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


const NOTE_DROP = { requested: 3, kept: 2, steps: [{ band: 2, step: 'row' }, { band: 2, step: 'drop' }], gapIn: 0.1, limitIn: 2, requestedDepthIn: 3, depthIn: 1.9, fits: true };
// a real change each time (re-picking the same preset re-lays nothing): away, then back to 3 bands
const lay = (counts) => { runBricks.mockReturnValue(counts); $('brickFramePreset_soldier_stretcher').click(); $('brickFramePreset_three_band').click(); };

describe('F35 item 35: the bands-reduced note', () => {
  beforeEach(() => { runBricks.mockReset(); });
  it('in plain words: how many of the bands were laid, and which were narrowed', () => {
    expect(bandsReducedText(NOTE_DROP)).toBe('Bands reduced to fit the board: 2 of 3 laid.');
    expect(bandsReducedText({ ...NOTE_DROP, kept: 3, steps: [{ band: 2, step: 'row' }] })).toBe('Bands reduced to fit the board: 3 of 3 laid; band 3 narrowed.');
    expect(bandsReducedText(null)).toBe('');
  });
  it('a reduced stack that FITS: the Frame note line, no empty-wall warning; band 3 greyed with why', () => {
    setup('frame');
    lay({ wallCount: 12, frameCount: 200, bandsReduced: NOTE_DROP });
    expect(shown('brickFrameBandsNote')).toBe(true);
    expect($('brickFrameBandsNote').textContent).toBe('Bands reduced to fit the board: 2 of 3 laid.');
    expect(shown('brickLayWarnings')).toBe(false);
    const b3 = $('brickFrameBandPattern_2_header');
    expect(b3.disabled).toBe(true);
    expect(b3.title).toMatch(/dropped to fit the board/);
    expect($('brickFrameBandPattern_1_header').disabled).toBe(false);
  });
  it('even with an empty wall, a stack that FITS says the note, not the warning; one that still does NOT fit keeps the warning', () => {
    setup('frame');
    // a Wall element on the board (its record), so a frame change re-lays the wall too
    const rec = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    rec.setAttribute('data-brick-record', 'wall-full'); rec.setAttribute('data-layer', 'b');
    window.svgEditor._sketchLayer.node.appendChild(rec);
    lay({ wallCount: 0, frameCount: 300, bandsReduced: NOTE_DROP });
    expect(shown('brickLayWarnings')).toBe(false);
    lay({ wallCount: 0, frameCount: 300, bandsReduced: { ...NOTE_DROP, kept: 1, fits: false } });
    expect(shown('brickLayWarnings')).toBe(true);
    expect(shown('brickFrameBandsNote')).toBe(true);
  });
  it('a stack laid as requested: no note, nothing greyed', () => {
    setup('frame');
    lay({ wallCount: 40, frameCount: 120 });
    expect(shown('brickFrameBandsNote')).toBe(false);
    expect($('brickFrameBandPattern_2_header').disabled).toBe(false);
  });
  it('the note row is gated on the engine\u2019s bandFit option (declared like every hidden control)', () => {
    const entry = BRICK_CONTROL_REQUIRES.find((r) => r.controls.includes('brickFrameBandsNoteRow'));
    expect(entry && entry.requires).toEqual({ engineOption: 'bandFit' });
    expect(entry.hides).toBe(true);
  });
});

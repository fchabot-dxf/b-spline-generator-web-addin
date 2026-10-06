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

import { setPaintScheduler } from '../bspline-frame-builder/b-spline-gen/html/core/loading-signal.js';
import { WALL_AREA_HINT } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { initBrickPanel, setFrameRock } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { runBricks, FRAME_CORNERS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { frameContext } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { FRAME_NEEDS_A_FRAME } from '../bspline-frame-builder/b-spline-gen/html/main/brick-control-requires.js';
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
  // F35 item 58 follow-up (advisor, item 33's precedent): band accents are stored by band NUMBER, so a new preset
  // drops them (levels included); a pattern change on one band keeps that band's accent
  it('a band accent survives its band’s pattern change and is dropped by a new preset', () => {
    P.brickSettings.frameBandAccents = [];
    setup('frame');
    $('brickAccent_band0_checker').click();
    $('brickAccentLevel_band0').value = '0.015625';
    $('brickAccentLevel_band0').dispatchEvent(new Event('change'));
    expect(P.brickSettings.frameBandAccents[0]).toMatchObject({ preset: 'checker', levelIn: 0.015625 });
    $('brickFrameBandPattern_0_header').click();
    expect(P.brickSettings.frameBandAccents[0]).toMatchObject({ preset: 'checker', levelIn: 0.015625 });
    $('brickFramePreset_three_band').click();
    expect(P.brickSettings.frameBandAccents).toEqual([]);
    expect($('brickAccent_band0_none').classList.contains('active')).toBe(true);
    expect($('brickAccentLevel_band0')).toBeNull();
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

// F35 item 63 (Fred: the main sidebar's Frame bands pick did nothing on T18 with a wall laid and no Frame element --
// measured: frame 0 bricks, 3D unchanged): the pick LAYS the frame (or re-lays it); greyed with no frame contour
describe('item 63: the sidebar Frame bands pick lays the frame', () => {
  const addWall = () => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    n.setAttribute('data-brick-gen', '1'); n.setAttribute('data-brick', 'wall'); n.setAttribute('points', '1,1 2,1 2,2 1,2');
    window.svgEditor._sketchLayer.node.appendChild(n);
    document.dispatchEvent(new Event('editorCommit')); // the lay's own commit: the sidebar controls apply now
  };
  const kindsOfLastLay = () => runBricks.mock.calls.at(-1)?.[3]?.kinds;
  beforeEach(() => { P.brickSettings.frameBandPreset = 'single_soldier'; P.brickSettings.frameCorner = null; P.brickSettings.frameBandPatterns = []; });
  it('a wall but no Frame element: the pick lays the frame too; the next re-lay does not add it by itself', () => {
    setup('wall');
    addWall();
    runBricks.mockClear();
    $('brickQuick_frameBands_three_band').click();
    expect(P.brickSettings.frameBandPreset).toBe('three_band');
    expect(kindsOfLastLay()).toEqual(expect.arrayContaining(['wall', 'frame']));
    $('brickQuick_frameBands_single_soldier').click(); // the already-chosen preset lays it too
    expect(kindsOfLastLay()).toEqual(expect.arrayContaining(['wall', 'frame']));
    $('brickQuick_pattern_herringbone').click(); // any other re-lay: only what is on the canvas (the mock lays nothing)
    expect(kindsOfLastLay()).toEqual(['wall']);
  });
  // item 66: no template = the board rectangle -- MEASURED live, the frame provider still returns a context there
  // ({defs, record} with no templateId), so the bands follow the board edge and the row stays live
  it('template None (a context with no template): the row stays live and the pick lays the bands', () => {
    frameContext.mockReturnValue({ defs: { templates: [] }, record: { templateId: null } });
    frameContourSilhouette.mockReturnValue({ error: 'noFrame' });
    setup('wall');
    addWall();
    expect($('brickQuick_frameBands_single_soldier').disabled).toBe(false);
    runBricks.mockClear();
    $('brickQuick_frameBands_single_soldier').click();
    expect(kindsOfLastLay()).toEqual(expect.arrayContaining(['wall', 'frame']));
    frameContext.mockReturnValue({});
    frameContourSilhouette.mockReturnValue({ primitives: [] });
  });
  it('a frame whose outline can’t carry bands: the row is greyed with FRAME_NEEDS_A_FRAME', () => {
    frameContext.mockReturnValue({ defs: { templates: [] }, record: { templateId: 'template_x' } });
    frameContourSilhouette.mockReturnValue({ error: 'frameInvalid' });
    setup('wall');
    addWall();
    const btn = $('brickQuick_frameBands_single_soldier');
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe(FRAME_NEEDS_A_FRAME);
    frameContourSilhouette.mockReturnValue({ primitives: [] });
    document.dispatchEvent(new Event('editorCommit'));
    expect($('brickQuick_frameBands_single_soldier').disabled).toBe(false);
    frameContext.mockReturnValue({});
  });
});

// item 68 (measured: one Brick size change on a board with a brush stroke pushed TWO undo entries -- the strokes' new
// footprints re-lay the wall from inside the first lay's commit): the brush-change re-lay corrects the step its
// gesture pushed (commitEdit `amend`) instead of pushing a second one
describe('item 68: a wall re-lay caused by the brush strokes folds into the gesture’s undo step', () => {
  it('the re-lay carries `amend` = the step the triggering commit pushed', async () => {
    setPaintScheduler((cb) => cb());
    setup('wall');
    const node = window.svgEditor._sketchLayer.node;
    const rec = document.createElement('g'); rec.setAttribute('data-brick-record', 'wall-full'); rec.setAttribute('data-brick-laid', 'k#frame:x'); // laid with no strokes
    const stroke = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    stroke.setAttribute('data-brick-gen', '1'); stroke.setAttribute('data-brick', 'brush'); stroke.setAttribute('points', '1,1 2,1 2,1.3 1,1.3');
    node.append(rec, stroke);
    const gestureStep = { svg: 'the gesture' };
    window.svgEditor._lastPushedState = gestureStep;
    runBricks.mockClear();
    document.dispatchEvent(new Event('editorCommit'));
    expect(runBricks).not.toHaveBeenCalled(); // not from inside the commit: the gesture's step is not on top yet
    await Promise.resolve(); await Promise.resolve();
    expect(runBricks).toHaveBeenCalled();
    expect(runBricks.mock.calls.at(-1)[3].amend).toBe(gestureStep);
    setPaintScheduler(null);
  });
});

// item 68 (the editor audit): with painted areas and none selected, a Wall pick changes no area -- said in the section
describe('item 68: the Wall section says when a pick changes no painted area', () => {
  it('shown while areas exist and none is selected; hidden with no areas or with one selected', () => {
    setup('wall');
    const hint = document.createElement('div'); hint.id = 'brickWallAreaHint'; hint.style.display = 'none'; root.appendChild(hint);
    const shown = () => hint.style.display !== 'none';
    document.dispatchEvent(new Event('editorCommit'));
    expect(shown()).toBe(false); // no areas
    const area = document.createElement('g');
    area.setAttribute('data-brick-record', 'wall-area'); area.setAttribute('data-brick-element', 'area-1');
    window.svgEditor._sketchLayer.node.appendChild(area);
    document.dispatchEvent(new Event('editorCommit'));
    expect(shown()).toBe(true);
    expect(hint.textContent).toBe(WALL_AREA_HINT);
    window.svgEditor._brickWallAreaId = 'area-1'; // an area selected: the section edits it
    document.dispatchEvent(new Event('editorCommit'));
    expect(shown()).toBe(false);
  });
});


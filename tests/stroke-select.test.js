/**
 * F35 item 36: SELECT a Brush / Raised stroke like a wall or an area. A stroke's bricks (owned per chain,
 * `<id>:<chain>`) select its spine's element; its brush's section shows ITS settings (STROKE_FIELDS); an edit writes
 * them back onto every segment of its spine (one undo step, the bricks regenerate); Draw goes back to drawing.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runBricks: vi.fn(), runBricksPreview: vi.fn(), runBricksOutlinePreview: vi.fn(), buildRibbonPrimitives: vi.fn(() => []) };
});
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-commit.js', () => ({ commitEdit: vi.fn() }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/toast.js', () => ({ showToast: vi.fn() }));
const engineOpts = vi.hoisted(() => ({ extra: [], without: ['wallRegion'] })); // T86 item 18 lists wallRegion: test both states
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

import {
  initBrickPanel, selectBrickElement, selectedBrickElement, restyleSelectedStroke, setRustic, STROKE_FIELDS, STROKE_RESTYLE_SETTLE_MS,
} from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { brickElementAt, showElementSelection, brushStrokeSettings, strokeKindOf } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { commitEdit } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-commit.js';
vi.setConfig({ testTimeout: HEAVY_TEST_MS }); // the declared heavy-test timeout: timed out at 5 s under the fleet's load (turns 261-265)

const FIXTURE = `
  <div class="sticky-actions"><button id="brickGenerate">Generate</button></div>
  <button id="editorTabBrick">Brick</button><button id="editorDrawerTab-layers">Brick</button>
  <div id="editorToolbarBrick"></div>
  <div id="brickToolHint"></div>
  <div id="brickBrushSection" style="display:none;"><div id="brickSubTools_brush"></div><div id="brickElementLabel_brush"></div><div id="brickRusticRow_brush" style="display:none;"><input type="range" id="brickRusticSlider_brush"><input id="brickRustic_brush"></div>
    <div id="brickBrushProfileToggle"><button id="brickBtnProfileStripped" class="active"></button><button id="brickBtnProfileContinuous"></button></div>
    <div id="brickBrushOrientationToggle"><button id="brickBtnOrientationStretcher" class="active"></button><button id="brickBtnOrientationSoldier"></button></div>
  </div>
  <div id="brickFrameSection"><div id="brickSubTools_frame"></div><div id="brickElementLabel_frame"></div></div><div id="brickFramePresetList"></div>
  <div id="brickBrushPresetList"></div>
  <div id="brickWallSection"><div id="brickSubTools_wall"></div><div id="brickElementLabel_wall"></div></div><div id="brickPatternList"></div>
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
  <div id="brickRaisedSection"><div id="brickSubTools_raisedBrush"></div><div id="brickElementLabel_raisedBrush"></div><div id="brickRaisedModeToggle"></div><input id="brickRaisedLevel"></div>
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
function highlightLayer() {
  const added = [];
  return { added, polygon: (pts) => { const el = { pts, removed: false, fill: () => el, stroke: () => el, attr: () => el, remove: () => { el.removed = true; } }; added.push(el); return el; } };
}
const BRUSH = { ...P.brickSettings, setId: 1, rustic: 0, grout: { widthIn: 0.034 }, brushBandPreset: 'stretcher_1', profile: 'bricks', orientation: 'stretcher', brushAccent: { preset: 'none', levelIn: 0.0625, clicks: [] } };
const RAISED = { ...BRUSH, levelIn: 0.1, strokeMode: 'bricks', setId: 4 };
function stroke(node, id, settings, chains, x0) {
  const spine = document.createElement('line');
  spine.setAttribute('data-brick', 'brush-spine'); spine.setAttribute('data-brick-element', id); spine.setAttribute('data-brick-settings', JSON.stringify(settings));
  node.appendChild(spine);
  for (let c = 0; c < chains; c++) {
    const b = document.createElement('polygon');
    b.setAttribute('data-brick-gen', '1'); b.setAttribute('data-brick', 'brush'); b.setAttribute('data-brick-owner', id + ':' + c);
    b.setAttribute('points', [[x0 + c, 0], [x0 + c + 0.8, 0], [x0 + c + 0.8, 0.3], [x0 + c, 0.3]].map((p) => p.join(',')).join(' '));
    node.appendChild(b);
  }
}
function setup() {
  root = document.createElement('div');
  root.innerHTML = FIXTURE;
  document.body.appendChild(root);
  const modes = [];
  const node = document.createElement('div');
  window.svgEditor = { setMode: (m) => modes.push(m), modes, _layers: [{ id: 'b', name: 'Layer 1' }],
    _sketchLayer: { node }, _highlightLayer: highlightLayer(), _undoStack: [] };
  stroke(node, 'beS1', BRUSH, 2, 1);
  stroke(node, 'beR1', RAISED, 1, 5);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  P.brickSettings.raisedLevelIn = 0.0625;
  P.brickSettings.setIds = { ...(P.brickSettings.setIds || {}), raisedBrush: 1 };
  initBrickPanel();
  vi.clearAllMocks();
}
afterEach(() => { root?.remove(); window.svgEditor = null; vi.unstubAllGlobals(); vi.useRealTimers(); });
const spine = (id) => JSON.parse(window.svgEditor._sketchLayer.node.querySelector('[data-brick-element="' + id + '"]').getAttribute('data-brick-settings'));

describe('item 36: the hit + the outline (editor side)', () => {
  it('a brush brick selects its STROKE; a Raised stroke is known by its snapshot', () => {
    setup();
    expect(brickElementAt(window.svgEditor, { x: 2.4, y: 0.1 })).toEqual({ id: 'beS1', kind: 'brush' }); // chain 1
    expect(brickElementAt(window.svgEditor, { x: 5.4, y: 0.1 })).toEqual({ id: 'beR1', kind: 'raisedBrush' });
    expect(strokeKindOf(brushStrokeSettings(window.svgEditor, 'beS1'))).toBe('brush');
  });
  it('the outline covers every chain of the stroke', () => {
    setup();
    expect(showElementSelection(window.svgEditor, 'beS1')).toBe(2);
  });
});

describe('item 36: Select a stroke in the panel', () => {
  it('a brush opens on Draw (its drawing mode); Select arms the pick; Draw again drops the selection', () => {
    setup();
    $('brickTool_brush').click();
    expect(window.svgEditor.modes.at(-1)).toBe('brickBrush');
    expect($('brickSubTool_brush_draw').classList.contains('active')).toBe(true);
    $('brickSubTool_brush_select').click();
    expect(window.svgEditor.modes.at(-1)).toBe('brickElementSelect');
    selectBrickElement({ id: 'beS1', kind: 'brush' });
    $('brickSubTool_brush_draw').click();
    expect(selectedBrickElement()).toBe(null);
    expect(window.svgEditor.modes.at(-1)).toBe('brickBrush');
  });
  it('selecting a Raised stroke: its tool + ITS level and set come into the section', () => {
    setup();
    selectBrickElement({ id: 'beR1', kind: 'raisedBrush' });
    expect($('brickTool_raisedBrush').classList.contains('active')).toBe(true);
    expect(P.brickSettings.raisedLevelIn).toBe(0.1);
    expect(P.brickSettings.setIds.raisedBrush).toBe(4);
    expect($('brickElementLabel_raisedBrush').textContent).toBe('Editing: this raised stroke');
    expect(window.svgEditor.modes.at(-1)).toBe('brickElementSelect');
    expect(STROKE_FIELDS.map(([f]) => f)).toContain('raisedLevelIn');
  });
  it('an edit writes the stroke back (one commit, its bricks regenerate there); unchanged = nothing', () => {
    setup();
    selectBrickElement({ id: 'beR1', kind: 'raisedBrush' });
    P.brickSettings.raisedLevelIn = 0.2;
    expect(restyleSelectedStroke()).toBe(true);
    expect([spine('beR1').levelIn, spine('beR1').strokeMode]).toEqual([0.2, 'bricks']); // its Raised overrides kept
    expect(commitEdit).toHaveBeenCalledTimes(1);
    expect(restyleSelectedStroke()).toBe(false);
    expect(spine('beS1').levelIn).toBeUndefined(); // the other stroke untouched
  });
  it('any setting change restyles the selected stroke once it settles (a drag = one step)', () => {
    vi.useFakeTimers();
    setup();
    selectBrickElement({ id: 'beS1', kind: 'brush' });
    setRustic('brush', 0.3, 'onDrag');
    setRustic('brush', 0.5, 'onRelease');
    expect(commitEdit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(STROKE_RESTYLE_SETTLE_MS + 10);
    expect(spine('beS1').rustic).toBe(0.5);
    expect(commitEdit).toHaveBeenCalledTimes(1);
  });
});

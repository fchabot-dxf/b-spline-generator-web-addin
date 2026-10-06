/**
 * F35 item 22 slice 1 step 4: SELECT for Wall and Frame. Click a brick -> its element (record) is selected, its
 * bricks outlined in the highlight overlay (never in the drawing), its tool's section shows and edits only it;
 * nothing selected = the section shows the next element's settings; Esc deselects (then, as before, the tool).
 * The Wall's Area sub-tool is declared but hidden until the engine lists 'wallRegion' (seat B, T86 item 18).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runBricks: vi.fn(), runBricksPreview: vi.fn(), runBricksOutlinePreview: vi.fn(), buildRibbonPrimitives: vi.fn(() => []) };
});
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
  initBrickPanel, deselectTool, selectedBrickElement, BRICK_SUB_TOOLS,
} from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import {
  runBricks, brickElementAt, showElementSelection, BRICK_RECORD_KINDS, ELEMENT_SELECT_OUTLINE,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

const FIXTURE = `
  <div class="sticky-actions"><button id="brickGenerate">Generate</button></div>
  <button id="editorTabBrick">Brick</button>
  <div id="editorToolbarBrick"></div>
  <div id="brickToolHint"></div>
  <div id="brickBrushSection" style="display:none;">
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
const IDS = { wall: 'beWALL', frame: 'beFRAME' };
// wall bricks at x 1..2, frame bricks at x 5..6 (board inches)
const SQ = { wall: '1,0 2,0 2,0.3 1,0.3', frame: '5,0 6,0 6,0.3 5,0.3' };
function highlightLayer() {
  const added = [];
  return { added, polygon: (pts) => { const el = { pts, removed: false, fill: () => el, stroke: () => el, attr: () => el, remove: () => { el.removed = true; } }; added.push(el); return el; } };
}
function setup() {
  root = document.createElement('div');
  root.innerHTML = FIXTURE;
  document.body.appendChild(root);
  const modes = [];
  window.svgEditor = { setMode: (m) => modes.push(m), modes, _layers: [{ id: 'b', name: 'Bricks', holdsBricks: true }],
    _sketchLayer: { node: document.createElement('div') }, _highlightLayer: highlightLayer(), _undoStack: [] };
  // the real contract: a record per laid element; its bricks carry its id as owner
  runBricks.mockImplementation((ed, _s, _fg, opts) => {
    const node = ed._sketchLayer.node;
    for (const kind of opts?.kinds || []) {
      if (!node.querySelector(`[data-brick-record="${BRICK_RECORD_KINDS[kind]}"]`)) {
        const rec = document.createElement('g'); rec.setAttribute('data-brick-record', BRICK_RECORD_KINDS[kind]); rec.setAttribute('data-brick-element', IDS[kind]); node.appendChild(rec);
      }
      node.querySelectorAll(`[data-brick="${kind}"]`).forEach((n) => n.remove());
      const el = document.createElement('polygon');
      el.setAttribute('data-brick-gen', '1'); el.setAttribute('data-brick', kind); el.setAttribute('data-brick-owner', IDS[kind]); el.setAttribute('points', SQ[kind]);
      node.appendChild(el);
    }
    return { wallCount: 1, frameCount: 1 };
  });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  P.brickSettings.pattern = 'stretcher';
  P.brickSettings.frameBandPreset = 'single_soldier';
  P.brickSettings.frameBandPatterns = [];
  initBrickPanel();
  $('brickTool_wall').click(); $('brickGenerate').click();
  $('brickTool_frame').click(); $('brickGenerate').click();
  $('brickTool_wall').click();
}
afterEach(() => { root?.remove(); window.svgEditor = null; vi.unstubAllGlobals(); engineOpts.extra = []; });

describe('item 22 step 4: the hit + the outline (editor side)', () => {
  it('brickElementAt: the element whose brick is under the point; none elsewhere', () => {
    setup();
    expect(brickElementAt(window.svgEditor, { x: 1.5, y: 0.1 })).toEqual({ id: IDS.wall, kind: 'wall' });
    expect(brickElementAt(window.svgEditor, { x: 5.5, y: 0.1 })).toEqual({ id: IDS.frame, kind: 'frame' });
    expect(brickElementAt(window.svgEditor, { x: 3.5, y: 0.1 })).toBeNull();
  });
  it('the outline lives in the HIGHLIGHT layer (one per owned brick), never in the drawing; null clears it', () => {
    setup();
    const ed = window.svgEditor;
    const drawing = ed._sketchLayer.node.innerHTML;
    expect(showElementSelection(ed, IDS.wall)).toBe(1);
    expect(ed._highlightLayer.added.map((e) => e.pts)).toEqual([SQ.wall]);
    expect(ed._sketchLayer.node.innerHTML).toBe(drawing);
    expect(showElementSelection(ed, null)).toBe(0);
    expect(ed._highlightLayer.added.every((e) => e.removed)).toBe(true);
    expect(ELEMENT_SELECT_OUTLINE.color).toMatch(/^#/);
  });
});

describe('item 22 step 4: Select in the panel', () => {
  it('Wall opens on Select (the editor mode is armed); Area is declared but hidden until the engine lists wallRegion', () => {
    setup();
    expect(window.svgEditor.modes.at(-1)).toBe('brickElementSelect');
    expect($('brickSubTool_wall_select').classList.contains('active')).toBe(true);
    expect($('brickSubTool_wall_area').style.display).toBe('none');
    expect($('brickSubTool_frame_select')).toBeTruthy();
    expect($('brickSubTool_frame_area')).toBeNull(); // Frame = Select only
    expect(Object.keys(BRICK_SUB_TOOLS)).toEqual(['draw', 'select', 'stripe', 'area']); // F35 item 36: + the brushes' Draw; item 43: + Stripe (Brush's)
    root.remove(); engineOpts.extra = ['wallRegion'];
    setup();
    expect($('brickSubTool_wall_area').style.display).toBe('');
  });

  it('clicking a FRAME brick with the Wall tool: the frame element is selected, the Frame section shows, outlined', () => {
    setup();
    expect($('brickElementLabel_wall').textContent).toMatch(/next wall/);
    window.svgEditor._brickElementSelect({ x: 5.5, y: 0.1 });
    expect(selectedBrickElement()).toEqual({ id: IDS.frame, kind: 'frame' });
    expect($('brickTool_frame').classList.contains('active')).toBe(true);
    expect($('brickElementLabel_frame').textContent).toBe('Editing: this Frame');
    expect(window.svgEditor._highlightLayer.added.filter((e) => !e.removed).map((e) => e.pts)).toEqual([SQ.frame]);
  });

  it('Esc drops the selection first (the tool stays), then the tool; an empty click deselects too', () => {
    setup();
    window.svgEditor._brickElementSelect({ x: 1.5, y: 0.1 });
    expect(selectedBrickElement().kind).toBe('wall');
    deselectTool();
    expect(selectedBrickElement()).toBeNull();
    expect($('brickTool_wall').classList.contains('active')).toBe(true);
    deselectTool();
    expect($('brickTool_wall').classList.contains('active')).toBe(false);
    $('brickTool_wall').click();
    window.svgEditor._brickElementSelect({ x: 1.5, y: 0.1 });
    window.svgEditor._brickElementSelect({ x: 3.5, y: 0.1 });
    expect(selectedBrickElement()).toBeNull();
  });

  it('a re-lay keeps the selected element outlined (its new bricks)', () => {
    setup();
    window.svgEditor._brickElementSelect({ x: 1.5, y: 0.1 });
    $('brickGenerate').click();
    expect(window.svgEditor._highlightLayer.added.filter((e) => !e.removed).map((e) => e.pts)).toEqual([SQ.wall]);
  });
});

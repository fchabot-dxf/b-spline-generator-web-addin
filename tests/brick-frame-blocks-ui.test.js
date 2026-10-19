/**
 * Fred 2026-10-18 (mid-course blocks UI, mockup 1245, approved): Frame > Blocks, a sub-tool beside Select (and Heights). Tap the
 * Frame's run: a block is placed (P.brickSettings.frameBlocks gains { id, x, y }, the Frame re-lays through the usual commit);
 * tap a laid block: it goes; "n blocks, clear all"; a spot the engine refuses writes nothing and says why; a locked Frame layer
 * refuses with the layer lock's toast. The engine's own rules live in bricks-frame-blocks*.test.js; the real-geometry refusal in
 * brick-frame-blocks-refusal.test.js. Here: the panel, over the same mocks as brick-element-select.test.js.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runBricks: vi.fn(), runBricksPreview: vi.fn(), runBricksOutlinePreview: vi.fn(), buildRibbonPrimitives: vi.fn(() => []), blocksRefusal: vi.fn(() => []) };
});
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, frameContext: vi.fn(() => ({})) };
});
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, frameContourSilhouette: vi.fn(() => ({ primitives: [] })) };
});

import { initBrickPanel, BRICK_SUB_TOOLS, blocksState, BLOCK_SKIP_REASONS, blocksSkippedText } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { runBricks, blocksRefusal, BRICK_RECORD_KINDS, frameBlockAt } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { showToast } from '../bspline-frame-builder/b-spline-gen/html/core/toast.js';

const FIXTURE = `
  <div class="sticky-actions"><button id="brickGenerate">Generate</button></div>
  <button id="editorTabBrick">Brick</button>
  <div id="editorToolbarBrick"></div>
  <input id="brickReliefHeightSlider" type="range" min="0" max="1" step="0.001"><input id="brickReliefHeight">
  <input id="brickSuppressionSlider" type="range"><input id="brickSuppression">
  <input id="brickClumpingSlider" type="range"><input id="brickClumping">
  <input id="brickSeed"><button id="brickBtnRandomSeed"></button>
  <div id="brickFrameSection"><div id="brickSubTools_frame"></div><div id="brickHeightPickRow_frame" style="display:none;"></div><div id="brickBlocksRow_frame" style="display:none;"></div><div id="brickElementLabel_frame"></div></div><div id="brickFramePresetList"></div>
  <div id="brickWallSection"><div id="brickSubTools_wall"></div><div id="brickElementLabel_wall"></div></div><div id="brickPatternList"></div>
  <div data-brick-lay-notes="frame"></div>
`;

const $ = (id) => document.getElementById(id);
let root;
const IDS = { wall: 'beWALL', frame: 'beFRAME' };
const FRAME_BRICK = '0,0 7,0 7,1.1 0,1.1'; // the frame's run along the top: a tap on it is a tap on the frame
const BLOCK_AT = { x: 3.5, y: 0.3 }; // where the laid block sits (the mock lays it 3..4 x 0..1.1)
const BLOCK_PTS = '3,0 4,0 4,1.1 3,1.1';
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  root = document.createElement('div');
  root.innerHTML = FIXTURE;
  document.body.appendChild(root);
  const modes = [];
  window.svgEditor = {
    setMode: (m) => modes.push(m), modes, _layers: [{ id: 'b', name: 'Frame', holdsBricks: true, visible: true }],
    _sketchLayer: { node: document.createElement('div') }, _highlightLayer: null, _undoStack: [],
  };
  // the real contract: a record per laid element on its layer; its bricks carry its id; a declared block is laid as the Frame piece 'block-<id>'
  runBricks.mockImplementation((ed, settings, _fg, opts) => {
    const node = ed._sketchLayer.node;
    for (const kind of opts?.kinds || []) {
      if (!node.querySelector(`[data-brick-record="${BRICK_RECORD_KINDS[kind]}"]`)) {
        const rec = document.createElement('g'); rec.setAttribute('data-brick-record', BRICK_RECORD_KINDS[kind]); rec.setAttribute('data-brick-element', IDS[kind]); rec.setAttribute('data-layer', 'b'); node.appendChild(rec);
      }
      node.querySelectorAll(`[data-brick="${kind}"]`).forEach((n) => n.remove());
      const mk = (id, pts) => {
        const el = document.createElement('polygon');
        el.setAttribute('data-brick-gen', '1'); el.setAttribute('data-brick', kind); el.setAttribute('data-brick-owner', IDS[kind]); el.setAttribute('data-brick-id', id); el.setAttribute('points', pts); el.setAttribute('data-layer', 'b');
        node.appendChild(el);
      };
      mk('frame-1', FRAME_BRICK);
      if (kind === 'frame') for (const b of settings.frameBlocks || []) mk(`block-${b.id}`, BLOCK_PTS);
    }
    return { wallCount: 1, frameCount: 1 };
  });
  blocksRefusal.mockReturnValue([]);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  P.brickSettings.pattern = 'stretcher';
  P.brickSettings.frameBandPreset = 'single_soldier';
  P.brickSettings.frameBandPatterns = [];
  P.brickSettings.frameBlocks = [];
  initBrickPanel();
  $('brickTool_wall').click(); $('brickGenerate').click();
  $('brickTool_frame').click(); $('brickGenerate').click();
  runBricks.mockClear(); showToast.mockClear(); blocksRefusal.mockClear();
}
afterEach(() => { root?.remove(); window.svgEditor = null; vi.unstubAllGlobals(); P.brickSettings.frameBlocks = []; });

describe('Frame > Blocks: the one declared sub-tool, beside Select', () => {
  it('is declared once (a mode, a label), on the Frame only, after Select and Heights', () => {
    setup();
    expect(BRICK_SUB_TOOLS.blocks).toMatchObject({ label: 'Blocks', mode: 'brickBlocks' });
    const frameButtons = [...$('brickSubTools_frame').querySelectorAll('button')].map((b) => b.textContent);
    expect(frameButtons).toEqual(['Select', 'Heights', 'Blocks']);
    expect($('brickSubTools_wall').querySelector('#brickSubTool_wall_blocks')).toBeNull();
  });
  it('picking it arms the tap mode and shows the row with the hint; picking Select takes the row away', () => {
    setup();
    $('brickSubTool_frame_blocks').click();
    expect(window.svgEditor.modes.at(-1)).toBe('brickBlocks');
    expect($('brickBlocksRow_frame').style.display).not.toBe('none');
    expect($('brickBlocksHint').textContent).toMatch(/1\.1 in square/);
    $('brickSubTool_frame_select').click();
    expect($('brickBlocksRow_frame').style.display).toBe('none');
  });
});

describe('tap places, tap again removes, clear all empties', () => {
  it('a tap on the run writes { id, x, y } and re-lays the Frame; the row counts it', async () => {
    setup();
    $('brickSubTool_frame_blocks').click();
    window.svgEditor._brickBlockTap({ x: 5.5, y: 0.31234567 });
    await tick();
    expect(P.brickSettings.frameBlocks).toEqual([{ id: 'b1', x: 5.5, y: 0.3123 }]); // a stable id, the point to 4 decimals
    expect(runBricks).toHaveBeenCalledTimes(1);
    expect(runBricks.mock.calls[0][3].kinds).toContain('frame');
    expect($('brickBlocksCount').textContent).toBe('1 block');
    expect(blocksState().note).toBeNull();
  });

  it('a second block takes the next id; a block laid under the tap is removed by a tap on it', async () => {
    setup();
    $('brickSubTool_frame_blocks').click();
    window.svgEditor._brickBlockTap({ x: 3.5, y: 0.3 });
    await tick();
    window.svgEditor._brickBlockTap({ x: 6.2, y: 0.3 }); // on the frame, away from any laid block
    await tick();
    expect(P.brickSettings.frameBlocks.map((b) => b.id)).toEqual(['b1', 'b2']);
    expect($('brickBlocksCount').textContent).toBe('2 blocks');
    expect(frameBlockAt(window.svgEditor, BLOCK_AT)).toBe('b1'); // the laid piece 'block-b1' is under the point
    runBricks.mockClear();
    window.svgEditor._brickBlockTap(BLOCK_AT); // tap the laid block
    await tick();
    expect(P.brickSettings.frameBlocks.map((b) => b.id)).toEqual(['b2']);
    expect(runBricks).toHaveBeenCalledTimes(1); // re-laid without it
  });

  it('clear all empties the list and re-lays; the row goes back to the hint', async () => {
    setup();
    P.brickSettings.frameBlocks = [{ id: 'b1', x: 3.5, y: 0.3 }, { id: 'b4', x: 1, y: 1 }];
    $('brickSubTool_frame_blocks').click();
    expect($('brickBlocksCount').textContent).toBe('2 blocks');
    $('brickBlocksClearAll').click();
    await tick();
    expect(P.brickSettings.frameBlocks).toEqual([]);
    expect(runBricks).toHaveBeenCalled();
    expect($('brickBlocksHint')).toBeTruthy();
    expect($('brickBlocksCount')).toBeNull();
  });

  it('ids keep counting from the highest stored one (a saved board with b7 gets b8, never a clash)', async () => {
    setup();
    P.brickSettings.frameBlocks = [{ id: 'b7', x: 6.5, y: 0.3 }];
    $('brickSubTool_frame_blocks').click();
    window.svgEditor._brickBlockTap({ x: 1, y: 0.8 });
    await tick();
    expect(P.brickSettings.frameBlocks.map((b) => b.id)).toEqual(['b7', 'b8']);
  });
});

describe('a tap off the frame is not a block', () => {
  it('a tap on the wall (no frame piece under it) places nothing and says where to tap; the engine is not asked', async () => {
    setup();
    $('brickSubTool_frame_blocks').click();
    window.svgEditor._brickBlockTap({ x: 3.5, y: 5 });
    await tick();
    expect(P.brickSettings.frameBlocks).toEqual([]);
    expect(blocksRefusal).not.toHaveBeenCalled();
    expect(runBricks).not.toHaveBeenCalled();
    expect($('brickBlocksNote').textContent).toMatch(/Tap one of the frame/);
  });
});

describe('a spot the engine refuses: nothing written, the reason said', () => {
  it('writes no block, lays nothing, and names the engine\'s reason in one line', async () => {
    setup();
    blocksRefusal.mockReturnValue([{ id: 'b1', why: 'too near a corner' }]);
    $('brickSubTool_frame_blocks').click();
    window.svgEditor._brickBlockTap({ x: 0.2, y: 0.3 });
    await tick();
    expect(blocksRefusal).toHaveBeenCalledTimes(1);
    expect(blocksRefusal.mock.calls[0][3]).toEqual([{ id: 'b1', x: 0.2, y: 0.3 }]); // asked about the candidate list
    expect(P.brickSettings.frameBlocks).toEqual([]);
    expect(runBricks).not.toHaveBeenCalled();
    expect($('brickBlocksNote').textContent).toBe('Not placed: that spot is too near a corner.');
    // the next accepted tap clears the note
    blocksRefusal.mockReturnValue([]);
    window.svgEditor._brickBlockTap({ x: 3.5, y: 0.3 });
    await tick();
    expect($('brickBlocksNote')).toBeNull();
  });

  it('every reason the engine can give has words (frame-blocks.js: no run here / run too short / arc too tight / too near a corner / meets another block)', () => {
    expect(Object.keys(BLOCK_SKIP_REASONS).sort()).toEqual(['arc too tight', 'meets another block', 'no run here', 'run too short', 'too near a corner']);
    expect(blocksSkippedText([{ id: 'b1', why: 'no run here' }, { id: 'b2', why: 'no run here' }])).toBe('2 blocks placed nothing (there is no frame run under that spot).');
  });
});

describe('layer lock: a locked Frame layer refuses', () => {
  it('a tap places nothing and shows the lock toast; clear all refuses too', async () => {
    setup();
    P.brickSettings.frameBlocks = [{ id: 'b1', x: 3.5, y: 0.3 }];
    $('brickSubTool_frame_blocks').click();
    window.svgEditor._layers[0].userLocked = true;
    window.svgEditor._brickBlockTap({ x: 6.2, y: 0.3 });
    await tick();
    expect(P.brickSettings.frameBlocks).toEqual([{ id: 'b1', x: 3.5, y: 0.3 }]);
    expect(blocksRefusal).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('"Frame" is locked — unlock it in Layers to change it', 'warn');
    $('brickBlocksClearAll').click();
    await tick();
    expect(P.brickSettings.frameBlocks).toHaveLength(1);
    expect(runBricks).not.toHaveBeenCalled();
  });
});

/**
 * F35 item 22 slice 1 step 3: the laid key PER ELEMENT. Each Wall / Frame record carries the key its bricks were
 * laid with (data-brick-laid); the panel's item-27 re-lays read the element's own key -- the frame re-lay runs
 * when ANY element on the board was laid on another frame, the brush re-lay reads the WALL's key. A board saved
 * before item 22 (no records) still reads the old shared layer key (covered by the existing panel tests).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runBricks: vi.fn(), runBricksPreview: vi.fn(), runBricksOutlinePreview: vi.fn(), buildRibbonPrimitives: vi.fn(() => []) };
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

import { initBrickPanel } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { runBricks, BRICK_RECORD_KINDS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { setFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { openRebuildHold, isRebuildHeld } from '../bspline-frame-builder/b-spline-gen/html/core/engine/scheduler.js';
vi.setConfig({ testTimeout: HEAVY_TEST_MS }); // the declared heavy-test timeout: timed out at 5 s under the fleet's load (turns 261-265)

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
  <div id="brickPatternList"></div>
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
const canvas = () => window.svgEditor._sketchLayer.node;
const record = (kind) => canvas().querySelector(`[data-brick-record="${BRICK_RECORD_KINDS[kind]}"]`);
function setup() {
  root = document.createElement('div');
  root.innerHTML = FIXTURE;
  document.body.appendChild(root);
  window.svgEditor = { setMode: () => {}, _layers: [{ id: 'b', name: 'Bricks', holdsBricks: true }], _sketchLayer: { node: document.createElement('div') }, _undoStack: [] };
  // the real contract since item 22: each laid element's RECORD carries the key (no shared layer key)
  runBricks.mockImplementation((ed, _s, _fg, opts) => {
    const node = ed._sketchLayer.node;
    for (const kind of opts?.kinds || []) {
      let rec = node.querySelector(`[data-brick-record="${BRICK_RECORD_KINDS[kind]}"]`);
      if (!rec) { rec = document.createElement('g'); rec.setAttribute('data-brick-record', BRICK_RECORD_KINDS[kind]); node.appendChild(rec); }
      if (opts.laidKey != null) rec.setAttribute('data-brick-laid', opts.laidKey);
      if (!node.querySelector(`[data-brick="${kind}"]`)) {
        const el = document.createElement('polygon'); el.setAttribute('data-brick-gen', '1'); el.setAttribute('data-brick', kind); node.appendChild(el);
      }
    }
    return { wallCount: 5, frameCount: 5 };
  });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  P.brickSettings.pattern = 'stretcher';
  P.brickSettings.frameBandPreset = 'single_soldier';
  P.brickSettings.frameBandPatterns = [];
  initBrickPanel();
  $('brickTool_wall').click(); $('brickGenerate').click();
  $('brickTool_frame').click(); $('brickGenerate').click();
  vi.clearAllMocks();
}
afterEach(() => { root?.remove(); window.svgEditor = null; vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('item 22 step 3: the panel reads each ELEMENT\'s own laid key', () => {
  it('both records carry the key; a frame change re-lays once, and the same frame again lays nothing', () => {
    setup();
    expect(record('wall').getAttribute('data-brick-laid')).toContain('#frame:');
    expect(record('frame').getAttribute('data-brick-laid')).toContain('#frame:');
    vi.useFakeTimers();
    setFrameRecord({ frameBottomZ: -0.31 });
    vi.advanceTimersByTime(400);
    expect(runBricks).toHaveBeenCalledTimes(1);
    runBricks.mockClear();
    setFrameRecord({ frameBottomZ: -0.31 }); // nothing new: every element is laid on this frame
    vi.advanceTimersByTime(400);
    expect(runBricks).not.toHaveBeenCalled();
  });

  it('ONE element laid on another frame is enough to re-lay (the shared key could not tell)', () => {
    setup();
    vi.useFakeTimers();
    setFrameRecord({ frameBottomZ: -0.42 });
    vi.advanceTimersByTime(400);
    runBricks.mockClear();
    // the wall's own key still names an older frame; the frame's is current
    record('wall').setAttribute('data-brick-laid', record('wall').getAttribute('data-brick-laid').replace(/#frame:.*/, '#frame:OLD'));
    setFrameRecord({ frameBottomZ: -0.42 });
    vi.advanceTimersByTime(400);
    expect(runBricks).toHaveBeenCalledTimes(1);
  });

  it('a new board re-lays once the editor has it (editorBoardResized, 2026-10-07); the same board again lays nothing', () => {
    setup();
    vi.useFakeTimers();
    const [w, h] = [P.widthIn, P.heightIn];
    try {
      P.widthIn = 9; P.heightIn = 12; // the board size is part of the laid key (_frameKey)
      document.dispatchEvent(new CustomEvent('editorBoardResized'));
      vi.advanceTimersByTime(400);
      expect(runBricks).toHaveBeenCalledTimes(1);
      runBricks.mockClear();
      document.dispatchEvent(new CustomEvent('editorBoardResized'));
      vi.advanceTimersByTime(400);
      expect(runBricks).not.toHaveBeenCalled();
    } finally {
      P.widthIn = w; P.heightIn = h;
    }
  });

  it('a board-size change\'s rebuild hold (2026-10-10): the re-lay stage closes after its lay -- or at once when nothing needs one', () => {
    setup();
    vi.useFakeTimers();
    const [w, h] = [P.widthIn, P.heightIn];
    try {
      P.widthIn = 9; P.heightIn = 12;
      openRebuildHold(['brick-relay']);
      document.dispatchEvent(new CustomEvent('editorBoardResized'));
      expect(isRebuildHeld()).toBe(true);
      vi.advanceTimersByTime(400);
      expect(runBricks).toHaveBeenCalledTimes(1);
      expect(isRebuildHeld()).toBe(false); // the lay committed: its stage closed (the backstop is 3 s away)
      runBricks.mockClear();
      openRebuildHold(['brick-relay']);
      document.dispatchEvent(new CustomEvent('editorBoardResized')); // the same board: no lay
      vi.advanceTimersByTime(400);
      expect(runBricks).not.toHaveBeenCalled();
      expect(isRebuildHeld()).toBe(false);
    } finally {
      P.widthIn = w; P.heightIn = h;
    }
  });
});

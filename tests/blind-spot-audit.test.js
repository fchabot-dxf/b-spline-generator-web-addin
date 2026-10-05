/**
 * Blind-spot audit 2026-10-04 (~/.bspline-status/shots/advisor/BLIND-SPOTS-2026-10-04.md), seat C's items:
 *  B1 a frame band set that leaves ZERO wall bricks says so (declared BRICK_LAY_WARNINGS: a toast + the sidebar note);
 *  B7 no stale "Press Generate" hints;
 *  B8 a re-lay measured over the declared budget shows the loading stage FIRST;
 *  B9 a Frame-tab undo's brick re-lay corrects the current editor step (no new one), and Cancel restores the frame.
 * (B6, hidden = display only, lives with the layer truth table: editor-layer-list / export-flow / stamp-mask-clear.)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runBricks: vi.fn(), runBricksPreview: vi.fn(), runBricksOutlinePreview: vi.fn(), buildRibbonPrimitives: vi.fn(() => []) };
});
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/fusion-bridge.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, setFusionStatus: vi.fn() };
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
  initBrickPanel, generateBricks, setWallPattern, BRICK_LAY_WARNINGS, LAY_STATUS_BUDGET_MS, predictedLayMs,
} from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { runBricks } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { commitEdit } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-commit.js';
import { showToast } from '../bspline-frame-builder/b-spline-gen/html/core/toast.js';
import { setFusionStatus } from '../bspline-frame-builder/b-spline-gen/html/core/fusion-bridge.js';
import { setFrameRecord, getFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { SvgEditorSnapshot, restoreEditorSnapshotState } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';

const PALETTE = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf-8');

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
  <div id="brickQuickSettings"></div><div id="brickLayWarnings" data-brick-lay-warnings style="display:none;"></div><div id="brickEditorLayWarnings" data-brick-lay-warnings style="display:none;"></div>
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
let counts;
function setup(tool) {
  root = document.createElement('div');
  root.innerHTML = FIXTURE;
  document.body.appendChild(root);
  const top = { svg: 'top' };
  window.svgEditor = { setMode: () => {}, _layers: [{ id: 'b', name: 'Bricks', holdsBricks: true }], _sketchLayer: { node: document.createElement('div') }, _undoStack: [{ svg: 'a' }, top] };
  counts = { wallCount: 40, frameCount: 30 };
  runBricks.mockImplementation((ed, _s, _fg, opts) => {
    // the real contract: the laid key AND the kinds it was laid for (audit B1) go on the Bricks layer
    if (opts?.laidKey != null) { ed._layers[0].brickLaidKey = opts.laidKey; ed._layers[0].brickLaidKinds = [...(opts.kinds || [])]; }
    const node = ed._sketchLayer?.node;
    for (const kind of opts?.kinds || []) {
      node?.querySelectorAll?.(`[data-brick="${kind}"]`).forEach((n) => n.remove());
      if (!node?.appendChild || counts[`${kind}Count`] === 0) continue; // a kind that laid nothing leaves nothing
      const el = document.createElement('polygon');
      el.setAttribute('data-brick-gen', '1'); el.setAttribute('data-brick', kind);
      node.appendChild(el);
    }
    return { ...counts };
  });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  P.brickSettings.pattern = 'stretcher';
  P.brickSettings.frameBandPreset = 'single_soldier';
  P.brickSettings.frameBandPatterns = [];
  P.brickSettings.setIds = { wall: 1, frame: 1, brush: 1, raisedBrush: 1 };
  initBrickPanel();
  $(`brickTool_${tool}`).click();
  if (tool === 'wall' || tool === 'frame') $('brickGenerate').click();
  vi.clearAllMocks();
}
afterEach(() => { root?.remove(); window.svgEditor = null; vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('B1: a lay that leaves ZERO wall bricks says so', () => {
  beforeEach(() => setup('wall'));
  const WALL_EMPTY = () => BRICK_LAY_WARNINGS.find((w) => w.id === 'wallEmpty');

  it('declared once: the frame bands covered the whole board (wall laid, frame laid, 0 wall bricks)', () => {
    const w = WALL_EMPTY();
    expect(w.text).toMatch(/fewer bands or smaller bricks/);
    const s = { pattern: 'stretcher' };
    expect(w.when({ wallCount: 0, frameCount: 9 }, ['wall', 'frame'], s)).toBe(true);
    expect(w.when({ wallCount: 3, frameCount: 9 }, ['wall', 'frame'], s)).toBe(false);
    expect(w.when({ wallCount: 0, frameCount: 9 }, ['frame'], s)).toBe(false); // no wall asked for: nothing missing
    expect(w.when({ wallCount: 0, frameCount: 0 }, ['wall'], s)).toBe(false); // no frame: not the bands' doing
    expect(w.when({ wallCount: 0, frameCount: 9 }, ['wall', 'frame'], { pattern: 'none' })).toBe(false); // no wall wanted
  });

  it('a toast when it happens + the sidebar note while it lasts; gone once the wall is back', () => {
    counts = { wallCount: 0, frameCount: 30 };
    generateBricks();
    expect(showToast).toHaveBeenCalledWith(WALL_EMPTY().text, 'warn');
    expect($('brickLayWarnings').style.display).toBe('');
    expect($('brickLayWarnings').textContent).toBe(WALL_EMPTY().text);
    expect($('brickEditorLayWarnings').textContent).toBe(WALL_EMPTY().text); // the editor's Brick tab says it too
    showToast.mockClear();
    generateBricks(); // still empty: the note stays, no second toast
    expect(showToast).not.toHaveBeenCalledWith(WALL_EMPTY().text, 'warn');
    counts = { wallCount: 12, frameCount: 30 };
    generateBricks();
    expect($('brickLayWarnings').style.display).toBe('none');
    expect($('brickEditorLayWarnings').style.display).toBe('none');
  });

  it('the squeezed-out wall is still the board wall: the next lay brings it back (fewer bands -> bricks again)', () => {
    $('brickTool_frame').click(); generateBricks(); // a wall AND a frame on the board
    counts = { wallCount: 0, frameCount: 30 };
    generateBricks(); // the 3-band moment: nothing of the wall left on the canvas
    const canvas = window.svgEditor._sketchLayer.node;
    expect(canvas.querySelector('[data-brick="frame"]')).not.toBeNull();
    expect(canvas.querySelector('[data-brick="wall"]')).toBeNull();
    counts = { wallCount: 25, frameCount: 20 };
    generateBricks(); // e.g. back to one band
    expect(runBricks.mock.calls.at(-1)[3].kinds).toContain('wall');
    expect(canvas.querySelector('[data-brick="wall"]')).not.toBeNull();
  });

  it('a "none" wall pattern laid nothing on purpose -- no warning', () => {
    P.brickSettings.pattern = 'none';
    counts = { wallCount: 0, frameCount: 30 };
    generateBricks();
    expect(showToast).not.toHaveBeenCalledWith(WALL_EMPTY().text, 'warn');
    P.brickSettings.pattern = 'stretcher';
  });

  it('the sidebar QUICK buttons show it too (same lay, same declaration)', () => {
    counts = { wallCount: 0, frameCount: 30 };
    const quick = [...document.querySelectorAll('#brickQuickSettings button')].find((b) => !b.classList.contains('active') && !b.disabled);
    expect(quick).toBeTruthy();
    quick.click();
    expect(runBricks).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(WALL_EMPTY().text, 'warn');
    expect($('brickLayWarnings').textContent).toBe(WALL_EMPTY().text);
  });
});

describe('B7: no stale "Press Generate" wording (item 27 lays at once)', () => {
  it('the Wall / Frame hints say a change lays it and Generate re-lays', () => {
    setup('wall');
    expect($('brickToolHint').textContent).toMatch(/Change a setting to lay it; Generate re-lays/);
    $('brickTool_frame').click();
    expect($('brickToolHint').textContent).toMatch(/Change a setting to lay them; Generate re-lays/);
    expect($('brickToolHint').textContent).not.toMatch(/Press Generate/);
  });
  it('the sidebar no longer opens with "Applied at once." (both entry points apply at once now)', () => {
    expect(PALETTE).not.toMatch(/>Applied at once\./);
    expect(PALETTE).not.toMatch(/the editor waits for Generate/);
  });
});

describe('B8: a re-lay over the declared budget shows the loading stage FIRST', () => {
  beforeEach(() => setup('wall'));
  function measuredLay(ms) {
    let t = 1000;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => { const v = t; t += ms; return v; });
    generateBricks();
    now.mockRestore();
  }

  it('under the budget: a release re-lays at once (no status, no wait)', () => {
    measuredLay(20);
    expect(predictedLayMs()).toBeLessThan(LAY_STATUS_BUDGET_MS);
    runBricks.mockClear();
    setWallPattern('soldier', 'auto');
    expect(runBricks).toHaveBeenCalledTimes(1);
    expect(setFusionStatus).not.toHaveBeenCalledWith('Laying bricks…', 'busy');
  });

  it('at/over the budget (a rock set: 276-457 ms): the status paints, THEN the lay runs, then it clears', () => {
    expect(LAY_STATUS_BUDGET_MS).toBe(300);
    measuredLay(450);
    expect(predictedLayMs()).toBeGreaterThanOrEqual(LAY_STATUS_BUDGET_MS);
    const frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb) => { frames.push(cb); return frames.length; });
    runBricks.mockClear(); setFusionStatus.mockClear();
    setWallPattern('soldier', 'auto');
    expect(setFusionStatus).toHaveBeenCalledWith('Laying bricks…', 'busy');
    expect(runBricks).not.toHaveBeenCalled(); // not yet: the status gets its paint first
    setWallPattern('stretcher', 'auto'); // a second release while queued: still ONE lay, with the latest settings
    frames.shift()(); frames.shift()();
    expect(runBricks).toHaveBeenCalledTimes(1);
    expect(runBricks.mock.calls[0][1].pattern).toBe('stretcher');
    expect(setFusionStatus).toHaveBeenLastCalledWith('', 'busy');
  });
});

describe('B9: undo and Cancel keep the bricks with their frame', () => {
  it('commitEdit({amend}) corrects the step still on top in place; anything else is a normal new step', () => {
    const top = { svg: 'top' };
    const editor = { _undoStack: [{ svg: 'a' }, top], _snapshotState: () => ({ svg: 'relaid' }), pushState: vi.fn(function () { this._undoStack.push({ svg: 'pushed' }); }) };
    commitEdit(editor, { amend: top });
    expect(editor._undoStack.map((s) => s.svg)).toEqual(['a', 'relaid']);
    expect(editor.pushState).not.toHaveBeenCalled();
    commitEdit(editor, { amend: top }); // `top` is no longer on top: never fold into a later step
    expect(editor.pushState).toHaveBeenCalledTimes(1);
  });

  it("a FRAME UNDO's re-lay amends the step that was on top (no new editor step); a plain frame edit's pushes one", () => {
    setup('wall');
    vi.useFakeTimers();
    const top = window.svgEditor._undoStack.at(-1);
    setFrameRecord({ frameBottomZ: -0.5 }, { restored: true }); // what frame-panel's undoFrame now writes
    vi.advanceTimersByTime(400);
    expect(runBricks).toHaveBeenCalledTimes(1);
    expect(runBricks.mock.calls[0][3].amend).toBe(top);
    runBricks.mockClear();
    setFrameRecord({ frameBottomZ: -0.6 }); // a real edit
    vi.advanceTimersByTime(400);
    expect(runBricks).toHaveBeenCalledTimes(1);
    expect(runBricks.mock.calls[0][3].amend).toBeNull();
  });

  it('Cancel puts the FRAME back with the drawing and the brick settings', () => {
    setup('wall');
    const before = JSON.parse(JSON.stringify(getFrameRecord()));
    SvgEditorSnapshot.active = true;
    SvgEditorSnapshot.editorSvg = '<svg/>';
    SvgEditorSnapshot.brickSettings = JSON.parse(JSON.stringify(P.brickSettings));
    SvgEditorSnapshot.frame = before;
    setFrameRecord({ frameBottomZ: (before.frameBottomZ || 0) - 0.4 }); // the session changed the frame
    restoreEditorSnapshotState();
    expect(getFrameRecord().frameBottomZ).not.toBe(undefined);
    expect(JSON.parse(JSON.stringify(getFrameRecord()))).toEqual(before);
    expect(P.editorSvg).toBe('<svg/>');
    SvgEditorSnapshot.active = false;
  });

  it('frame-panel.undoFrame writes its record as a RESTORE (the event says so)', () => {
    const src = readFileSync('bspline-frame-builder/b-spline-gen/html/main/frame-panel.js', 'utf-8');
    expect(src).toMatch(/setFrameRecord\(prev, \{ restored: true \}\)/);
    const seen = [];
    const on = (e) => seen.push(e.detail);
    document.addEventListener('frameRecordChanged', on);
    setFrameRecord({ frameBottomZ: -0.7 }, { restored: true });
    setFrameRecord({ frameBottomZ: -0.75 });
    document.removeEventListener('frameRecordChanged', on);
    expect(seen.map((d) => d.restored)).toEqual([true, false]);
  });
});

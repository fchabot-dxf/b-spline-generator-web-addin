/**
 * UX refine (Fred, 2026-10-10): a Frame preset's optional declared `bestSize` (core/bricks/library.js FRAME_PRESETS)
 * is a SUGGESTION -- a "best" mark on that Size chip in both places the chips appear (the Brick editor and the sidebar
 * quick settings) and a "Reads best at ..." hint with [Use it] under each frame picker. Only [Use it] changes the size,
 * as one undo step. The band lists themselves -- and so every lay -- are byte-identical.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { globalHistoryLog, globalRedoLog, takeSnapshot } from '../bspline-frame-builder/b-spline-gen/html/core/history.js';
import { FRAME_PRESETS, BRICK_SETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runBricks: vi.fn(() => ({ wallCount: 3, frameCount: 0 })), runBricksPreview: vi.fn(), runBricksOutlinePreview: vi.fn(), buildRibbonPrimitives: vi.fn(() => []) };
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

import { initBrickPanel, setFrameBandPreset, setBrickSize, suggestedBrickSize, BEST_SIZE_HINT, bestSizeHintId } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { frameBandsOf } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

const FIXTURE = `
  <div class="sticky-actions"><button id="brickGenerate">Generate</button></div>
  <button id="editorTabBrick">Brick</button><button id="editorDrawerTab-layers">Brick</button>
  <div id="editorToolbarBrick"></div>
  <div id="brickToolHint"></div>
  <div id="brickBrushSection" style="display:none;"></div>
  <div id="brickFramePresetRow"><div id="brickFramePresetList"></div></div>
  <div id="brickBrushPresetList"></div>
  <div id="brickPatternList"></div>
  <label id="brickFrameBandPatternLabel">Band patterns</label><div id="brickFrameBandPatternList"></div>
  <div id="brickSetRow"></div>
  <div id="brickSizePresetList"></div>
  <input id="brickSizeSlider" type="range" min="0" max="1000" step="1" value="226"><input id="brickSize" type="number" value="0.75">
  <input id="brickGroutWidth"><input id="brickGroutDepth">
  <div id="brickQuickSettings"></div>
  <div id="brickSidebarNoBricks" style="display:none;"></div><div id="brickStartHint" style="display:none;"></div>
  <input id="brickSeed"><button id="brickBtnRandomSeed"></button>
`;
const $ = (id) => document.getElementById(id);
let root;
function setup({ preset = 'single_soldier', size = 1.25 } = {}) {
  root = document.createElement('div');
  root.innerHTML = FIXTURE;
  document.body.appendChild(root);
  window.svgEditor = { setMode: () => {}, _layers: [{ id: 'b', name: 'Bricks', holdsBricks: true }], _sketchLayer: { node: document.createElement('div') }, _undoStack: [] };
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  P.brickSettings.frameBandPreset = preset;
  P.brickSettings.frameBandPatterns = [];
  P.brickSettings.brickLengthIn = size;
  initBrickPanel();
  vi.clearAllMocks();
}
afterEach(() => { root?.remove(); window.svgEditor = null; vi.unstubAllGlobals(); });

const marked = () => [...document.querySelectorAll('.best-size')].map((b) => b.id).sort();
const hintShown = (host) => $(bestSizeHintId(host))?.style.display === 'flex';
const declared = Object.entries(FRAME_PRESETS).filter(([, b]) => b.bestSize != null);

describe('the declared bestSize field', () => {
  it('every declared bestSize is one of the Size chips', () => {
    expect(declared.length).toBeGreaterThan(0);
    for (const [id, bands] of declared) expect([0.375, 0.75, 1, 1.25, 1.5, 3, 8], id).toContain(bands.bestSize);
  });
  it('the band lists are unchanged: same keys, same JSON, the field never reaches frameBandsOf or a lay', () => {
    for (const [id, bands] of declared) {
      expect(Object.keys(bands), id).toEqual(bands.map((_, i) => String(i)));
      const plain = bands.map((b) => ({ ...b }));
      expect(JSON.stringify(bands), id).toBe(JSON.stringify(plain));
      expect(frameBandsOf({ frameBandPreset: id })).toEqual(plain);
      const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
      const prims = square.map((p, i) => ({ type: 'line', p0: p, p1: square[(i + 1) % 4] }));
      const a = bricksContourBands(prims, bands, { set: BRICK_SETS[0], seed: 3 });
      const b = bricksContourBands(prims, plain, { set: BRICK_SETS[0], seed: 3 });
      expect(JSON.stringify(a), id).toBe(JSON.stringify(b));
    }
  });
});

describe('the best-size mark and hint', () => {
  const [bestId, bestBands] = declared[0];
  const otherSize = bestBands.bestSize === 1.25 ? 1 : 1.25;

  it('a preset without bestSize shows nothing new', () => {
    setup({ preset: 'single_soldier' });
    expect(FRAME_PRESETS.single_soldier.bestSize).toBeUndefined();
    expect(marked()).toEqual([]);
    expect(hintShown('editor')).toBe(false);
    expect(hintShown('quick')).toBe(false);
  });

  it('picking a preset with bestSize marks that chip in BOTH places and shows both hints; the size is untouched', () => {
    setup({ preset: 'single_soldier', size: otherSize });
    setFrameBandPreset(bestId);
    expect(P.brickSettings.brickLengthIn).toBe(otherSize); // nothing changes on its own
    const chip = suggestedBrickSize(P.brickSettings);
    expect(chip.lengthIn).toBe(bestBands.bestSize);
    expect(marked()).toEqual([`brickQuick_size_${chip.id}`, `brickSizePreset_${chip.id}`].sort());
    expect($(`brickSizePreset_${chip.id}`).dataset.best).toBe(BEST_SIZE_HINT.mark);
    for (const host of ['editor', 'quick']) {
      expect(hintShown(host), host).toBe(true);
      expect($(bestSizeHintId(host)).textContent).toBe(BEST_SIZE_HINT.text.replace('{size}', chip.label) + BEST_SIZE_HINT.button);
    }
    // the editor's hint sits right under its frame picker; the sidebar's under its Frame bands row
    expect($(bestSizeHintId('editor')).previousElementSibling.id).toBe('brickFramePresetList');
    expect($(bestSizeHintId('quick')).previousElementSibling.id).toBe('brickQuickRow_frameBands');
  });

  it('no mark when the size already is the best one', () => {
    setup({ preset: bestId, size: bestBands.bestSize });
    expect(marked()).toEqual([]);
    expect(hintShown('quick')).toBe(false);
    setBrickSize(otherSize);
    expect(marked().length).toBe(2);
    setFrameBandPreset('single_soldier');
    expect(marked()).toEqual([]);
    expect(hintShown('editor')).toBe(false);
  });

  it('[Use it] (sidebar) sets the size as exactly one undo step, and the mark goes', () => {
    setup({ preset: bestId, size: otherSize });
    globalHistoryLog.length = 0; globalRedoLog.length = 0; takeSnapshot('Initial');
    const btn = $('brickBestSizeUse_quick');
    btn.disabled = false; // the fixture board has no laid bricks (the quick settings grey); the gating is not under test
    btn.click();
    expect(P.brickSettings.brickLengthIn).toBe(bestBands.bestSize);
    expect(globalHistoryLog.map((s) => s.label)).toEqual(['Initial', BEST_SIZE_HINT.undoLabel]);
    expect(marked()).toEqual([]);
    expect(hintShown('quick')).toBe(false);
  });

  it('[Use it] (editor) sets the size the way the editor Size chip does', () => {
    setup({ preset: bestId, size: otherSize });
    const chip = suggestedBrickSize(P.brickSettings);
    $('brickBestSizeUse_editor').click();
    expect(P.brickSettings.brickLengthIn).toBe(bestBands.bestSize);
    expect($(`brickSizePreset_${chip.id}`).classList.contains('active')).toBe(true);
    expect(hintShown('editor')).toBe(false);
  });
});

/**
 * F35 item 31 step 2 (+ 31b/31c/31d, + item 32): the PATTERN BUILDER wired. The Accent row lives in the Wall pattern
 * section; "Custom..." opens the builder (base pattern, unit, a courses x bricks tile, start from a preset, save); the
 * wall accent IS the builder tile while open; a saved pattern (bond + tile + unit + level) is a pattern of its own in
 * the Wall grid; the accent level is signed (sunk bricks).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runBricks: vi.fn(() => ({ wallCount: 3, frameCount: 0 })), runBricksPreview: vi.fn(), runBricksOutlinePreview: vi.fn(), buildRibbonPrimitives: vi.fn(() => []) };
});
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/toast.js', () => ({ showToast: vi.fn() }));
const engineOpts = vi.hoisted(() => ({ extra: [], without: ['accentCuts'] })); // T86 item 26 lists accentCuts: test both states
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
  initBrickPanel, openPatternBuilder, closePatternBuilder, builderToggleCell, builderResize, builderSetBase, builderStartFrom,
  builderSave, applyUserPattern, setWallPattern, setAccentPreset, setAccentLevel, patternBuilderState, builderSetUnit,
} from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { runBricks } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { ACCENT_LEVEL_RANGE, tileOf, ACCENT_PRESETS, accentedBrickIndices } from '../bspline-frame-builder/b-spline-gen/html/editor/brick-accents.js';
import { readFileSync } from 'node:fs';

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
  <div id="brickPatternList"></div><div id="brickAccentList"></div><button id="brickAccentCustomOpen"></button><div id="brickPatternBuilder" style="display:none;"></div><div id="brickRusticRow_wall" style="display:none;"><input type="range" id="brickRusticSlider_wall"><input id="brickRustic_wall"></div><div id="brickRusticRow_brush" style="display:none;"><input type="range" id="brickRusticSlider_brush"><input id="brickRustic_brush"></div>
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
  <button id="brickAccentClick">Click bricks</button>
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


const acc = () => P.brickSettings.accent;
const cellsOf = (t) => t.cells.map((r) => r.map((x) => (x ? 1 : 0)).join('')).join('/');
const resetAccent = () => { P.brickSettings.accent = { preset: 'none', levelIn: 0.0625, clicks: [] }; };

describe('item 31d: the Accent row lives in the Wall pattern section', () => {
  it('in the palette: Wall pattern grid, THEN the Accent row (+ Custom... + Click bricks), the builder sub-panel closed', () => {
    const html = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf-8');
    const at = (s) => html.indexOf(s);
    expect(at('id="brickPatternList"')).toBeLessThan(at('id="brickAccentList"'));
    expect(at('id="brickAccentList"')).toBeLessThan(at('id="brickAccentCustomOpen"'));
    expect(at('id="brickAccentCustomOpen"')).toBeLessThan(at('id="brickPatternBuilder"'));
    expect(html).not.toMatch(/>Raised accents</);
    expect(html).toMatch(/id="brickPatternBuilder" style="display:none;/);
  });
});

describe('item 31 step 2: the builder', () => {
  beforeEach(() => { try { localStorage.clear(); } catch { /* */ } P.brickSettings.userPatterns = []; resetAccent(); setup('wall'); });

  it('opens on the wall bond with the default 4 x 6 tile; the 1/2 + 1/4 units hidden until the engine lists accentCuts', () => {
    openPatternBuilder();
    expect(shown('brickPatternBuilder')).toBe(true);
    const s = patternBuilderState();
    expect([s.tile.rows, s.tile.cols, s.tile.base, s.tile.unit]).toEqual([4, 6, 'stretcher', 1]);
    expect(document.querySelectorAll('[id^=brickBuilderCell_]')).toHaveLength(24);
    expect(shown('brickBuilderUnit_whole')).toBe(true);
    expect(shown('brickBuilderUnit_half')).toBe(false);
    expect(shown('brickBuilderUnit_quarter')).toBe(false);
    closePatternBuilder(); root.remove(); engineOpts.extra = ['accentCuts']; resetAccent(); setup('wall'); openPatternBuilder();
    expect(shown('brickBuilderUnit_half')).toBe(true);
  });

  it('a tapped cell raises it: the WALL accent is the builder tile (live preview)', () => {
    openPatternBuilder();
    builderToggleCell(0, 2); builderToggleCell(1, 1);
    expect(acc().preset).toBe('tile');
    expect(cellsOf(acc().tile)).toBe('001000/010000/000000/000000');
    builderToggleCell(0, 2);
    expect(cellsOf(acc().tile)).toBe('000000/010000/000000/000000');
  });

  it('resize keeps the cells (2..8 each); a base change re-lays the wall on that bond (31c)', () => {
    openPatternBuilder();
    builderToggleCell(1, 1);
    builderResize(2, 12);
    expect([acc().tile.rows, acc().tile.cols]).toEqual([2, 8]);
    expect(acc().tile.cells[1][1]).toBe(true);
    runBricks.mockClear();
    builderSetBase('header');
    expect(P.brickSettings.pattern).toBe('header');
    expect(acc().tile.base).toBe('header');
    expect(runBricks).toHaveBeenCalled();
  });

  it('Start from a preset copies ITS tile (tileOf); the preset itself stays', () => {
    openPatternBuilder();
    builderStartFrom('checker');
    expect(cellsOf(acc().tile)).toBe(cellsOf(tileOf(ACCENT_PRESETS.find((p) => p.id === 'checker'))));
    expect(ACCENT_PRESETS.some((p) => p.id === 'checker')).toBe(true);
  });

  it('Save: a pattern of its own -- with the project AND in this browser, in the Wall grid; picking it sets bond + accent', () => {
    openPatternBuilder();
    builderToggleCell(0, 0);
    builderSetBase('header');
    const u = builderSave('My Diamond');
    expect(u).toMatchObject({ id: 'user:my-diamond', label: 'My Diamond', bond: { builtin: 'header' }, unit: 1, level: 0.0625 });
    expect(P.brickSettings.userPatterns.map((x) => x.id)).toEqual(['user:my-diamond']);
    expect(JSON.parse(localStorage.getItem('bspline.brick.userPatterns')).map((x) => x.id)).toEqual(['user:my-diamond']);
    expect($('brickUserPattern_my-diamond')).toBeTruthy();
    expect(shown('brickPatternBuilder')).toBe(false);
    setWallPattern('stack'); // another bond: the tile marks go (they belong to its own bond)
    expect(acc().preset).toBe('none');
    applyUserPattern('user:my-diamond');
    expect(P.brickSettings.pattern).toBe('header');
    expect(acc()).toMatchObject({ preset: 'tile', tile: { userId: 'user:my-diamond', base: 'header' } });
  });

  it('the board copy wins over the browser one (same id)', () => {
    localStorage.setItem('bspline.brick.userPatterns', JSON.stringify([{ id: 'user:x', label: 'Browser', bond: { builtin: 'stack' }, accent: { tile: { rows: 2, cols: 2, cells: [[true, false], [false, false]] } }, unit: 1, level: 0.06 }]));
    P.brickSettings.userPatterns = [{ id: 'user:x', label: 'Board', bond: { builtin: 'stretcher' }, accent: { tile: { rows: 2, cols: 2, cells: [[false, true], [false, false]] } }, unit: 1, level: 0.06 }];
    root.remove(); setup('wall');
    expect($('brickUserPattern_x').title).toBe('Board');
  });
});

describe('item 31: pattern and accent never conflict (Fred)', () => {
  beforeEach(() => { resetAccent(); setup('wall'); });
  it('a periodic preset is RE-APPLIED on a new bond (it stays); a custom tile never moves to another bond', () => {
    setAccentPreset('checker');
    setWallPattern('stack');
    expect(acc().preset).toBe('checker');
    openPatternBuilder(); builderToggleCell(0, 0);
    setWallPattern('soldier');
    expect(acc().preset).toBe('none');
    expect(acc().tile).toBeUndefined();
    expect(shown('brickPatternBuilder')).toBe(false);
  });
});

describe('item 32: the signed accent level', () => {
  beforeEach(() => { P.brickSettings.accent = { preset: 'checker', levelIn: 0.0625, clicks: [] }; setup('wall'); });
  it('clamped to the declared range; a negative level redraws the preset icons SUNK', () => {
    expect([ACCENT_LEVEL_RANGE.min, ACCENT_LEVEL_RANGE.max]).toEqual([-0.125, 0.125]);
    setAccentLevel(-0.5);
    expect(acc().levelIn).toBe(-0.125);
    expect($('brickAccent_checker').innerHTML).toMatch(/#5a2416/);
    setAccentLevel(0.0625);
    expect($('brickAccent_checker').innerHTML).not.toMatch(/#5a2416/);
  });
  it('the tile accent marks the same bricks raised or sunk (the level carries the sign, the marks do not)', () => {
    const wall = [];
    for (let c = 0; c < 6; c++) for (let i = 0; i < 8; i++) { const x = i + (c % 2) * 0.5, y = (5 - c) * 0.4; wall.push({ polygon: [{ x, y }, { x: x + 0.95, y }, { x: x + 0.95, y: y + 0.36 }, { x, y: y + 0.36 }] }); }
    const tile = { rows: 2, cols: 2, cells: [[true, false], [false, true]] };
    const up = accentedBrickIndices(wall, { preset: 'tile', tile, levelIn: 0.06 });
    const down = accentedBrickIndices(wall, { preset: 'tile', tile, levelIn: -0.06 });
    expect([...down]).toEqual([...up]);
    expect(up.size).toBeGreaterThan(0);
  });
});

describe('item 31b: the tile at 1/2 and 1/4 brick', () => {
  beforeEach(() => { resetAccent(); engineOpts.extra = ['accentCuts']; setup('wall'); });
  const cellWidth = (id) => parseFloat($(id).style.width);

  it('a unit change re-lays the wall at once (the engine cuts the bricks), and so does a cell tap at 1/2; at 1 a tap only re-masks', () => {
    openPatternBuilder();
    runBricks.mockClear();
    builderToggleCell(0, 0);
    expect(runBricks).not.toHaveBeenCalled(); // unit 1: the marks only (3D), the bricks are unchanged
    builderSetUnit(0.5);
    expect(acc().tile.unit).toBe(0.5);
    expect(runBricks).toHaveBeenCalledTimes(1);
    runBricks.mockClear();
    builderToggleCell(0, 1);
    expect(runBricks).toHaveBeenCalledTimes(1); // the cut moves
    runBricks.mockClear();
    setAccentLevel(-0.0625);
    expect(runBricks).not.toHaveBeenCalled(); // a level never cuts
  });

  it('leaving a cut tile for a preset re-lays (whole bricks again)', () => {
    openPatternBuilder();
    builderSetUnit(0.25);
    builderToggleCell(0, 0);
    runBricks.mockClear();
    setAccentPreset('checker');
    expect(runBricks).toHaveBeenCalledTimes(1);
  });

  it('the builder draws a cell as that fraction of a brick, on the unstaggered grid, counted as Cells', () => {
    openPatternBuilder();
    const whole = cellWidth('brickBuilderCell_0_0');
    expect($('brickBuilderCell_1_0').style.left).not.toBe($('brickBuilderCell_0_0').style.left); // unit 1: the bond's stagger
    builderSetUnit(0.5);
    expect(cellWidth('brickBuilderCell_0_0')).toBeLessThan(whole);
    expect($('brickBuilderCell_1_0').style.left).toBe($('brickBuilderCell_0_0').style.left);
    expect($('brickPatternBuilder').textContent).toMatch(/Cells/);
    expect($('brickBuilderCell_0_0').title).toBe('course 1, cell 1');
  });

  it('a saved pattern keeps its unit and lays cut when picked', () => {
    openPatternBuilder();
    builderSetUnit(0.5);
    builderToggleCell(0, 1);
    builderSave('Half');
    resetAccent();
    runBricks.mockClear();
    applyUserPattern('user:half');
    expect(acc().tile.unit).toBe(0.5);
    expect(runBricks).toHaveBeenCalledTimes(1);
  });
});

/**
 * Per-element ACCENTS (advisor): Frame bands and Brush strokes get the Accent row (periodic presets + Click bricks, no
 * Custom: the builder is Wall-only) and the height mask applies each element's own accent + signed level, on the run's
 * OWN grid (course = row, brick = piece along the run; the engine stamps band / row / piece on every brick).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runBricks: vi.fn(() => ({ wallCount: 3, frameCount: 0 })), runBricksPreview: vi.fn(), runBricksOutlinePreview: vi.fn(), buildRibbonPrimitives: vi.fn(() => []) };
});
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-surface.js', () => ({ preloadSetDetail: vi.fn(async () => {}), sampleDetailAtFor: vi.fn(() => undefined), brickFillPaint: vi.fn(() => null) }));
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

import { initBrickPanel, setElementAccent } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { BRICK_GEN_ATTR } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { accentedRunIndices } from '../bspline-frame-builder/b-spline-gen/html/editor/brick-accents.js';
import { rasterizeBrickHeightMask } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-height-mask.js';

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
  <div id="brickPatternList"></div><div id="brickBrushAccentRow"></div><div id="brickRusticRow_wall" style="display:none;"><input type="range" id="brickRusticSlider_wall"><input id="brickRustic_wall"></div><div id="brickRusticRow_brush" style="display:none;"><input type="range" id="brickRusticSlider_brush"><input id="brickRustic_brush"></div>
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


describe('per-element accents: the rule on a RUN (a Frame band, a Brush stroke)', () => {
  const run = (n, rows = 1) => { const out = []; for (let r = 0; r < rows; r++) for (let i = 0; i < n; i++) out.push({ polygon: [{ x: i, y: r }, { x: i + 0.9, y: r }, { x: i + 0.9, y: r + 0.9 }, { x: i, y: r + 0.9 }], row: r, piece: i }); return out; };
  it('a periodic preset reads the run\u2019s own (row, piece) grid -- checker alternates along the run', () => {
    expect([...accentedRunIndices(run(6), { preset: 'checker' })]).toEqual([0, 2, 4]);
    expect([...accentedRunIndices(run(4, 2), { preset: 'checker' })]).toEqual([0, 2, 5, 7]); // row 1 shifts by one
  });
  it('Click bricks = points on the run\u2019s bricks; none / an unknown preset = nothing', () => {
    expect([...accentedRunIndices(run(6), { preset: 'custom', clicks: [{ x: 3.4, y: 0.4 }] })]).toEqual([3]);
    expect(accentedRunIndices(run(6), { preset: 'none' }).size).toBe(0);
    expect(accentedRunIndices(run(6), { preset: 'tile', tile: { rows: 1, cols: 1, cells: [[true]] } }).size).toBe(0); // the builder is Wall-only
  });
});

describe('per-element accents: the height mask applies each band\u2019s / the Brush\u2019s own accent + signed level', () => {
  const MW = 8, MH = 4, NX = 81, NZ = 41;
  const K = (x, y) => Math.round((1 - y / MH) * (NZ - 1)) * NX + Math.round((x / MW) * (NX - 1));
  async function mask(opts) {
    const root = document.createElement('div');
    const add = (kind, pts, extra) => { const p = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      for (const [k, v] of [['points', pts], ['data-layer', 'L'], [BRICK_GEN_ATTR, '1'], ['data-brick-set', '1'], ['data-brick-seed', '1'], ['data-brick-relief', '0.125'], ['data-brick', kind], ...extra]) p.setAttribute(k, v);
      root.appendChild(p); };
    // band 0: two frame bricks along y 0.2-0.8; band 1: two along y 1.2-1.8; one brush stroke (2 bricks) along y 2.6-3.4
    for (const [band, y0] of [[0, 0.2], [1, 1.2]]) for (const i of [0, 1]) add('frame', `${0.5 + i * 2},${y0} ${2.3 + i * 2},${y0} ${2.3 + i * 2},${y0 + 0.6} ${0.5 + i * 2},${y0 + 0.6}`, [['data-brick-band', band], ['data-brick-row', 0], ['data-brick-piece', i], ['data-brick-id', `f${band}${i}`]]);
    for (const i of [0, 1]) add('brush', `${0.5 + i * 2},2.6 ${2.3 + i * 2},2.6 ${2.3 + i * 2},3.4 ${0.5 + i * 2},3.4`, [['data-brick-row', 0], ['data-brick-piece', i], ['data-brick-owner', 'be1:0'], ['data-brick-id', `b${i}`]]);
    document.body.appendChild(root);
    return rasterizeBrickHeightMask({ _sketchLayer: { node: root } }, { id: 'L', depth: 0.125 }, NX, NZ, MW, MH, opts);
  }
  it('band 0 checker +1/16 lifts ONLY band 0\u2019s piece 0; the Brush sunk -1/16 lowers ONLY its piece 0', async () => {
    const flat = await mask({});
    const m = await mask({ frameBandAccents: [{ preset: 'checker', levelIn: 0.0625 }], brushAccent: { preset: 'checker', levelIn: -0.0625 } });
    expect(m.body[K(1.4, 0.5)]).toBeGreaterThan(flat.body[K(1.4, 0.5)]); // band 0, piece 0: raised
    expect(m.body[K(3.4, 0.5)]).toBeCloseTo(flat.body[K(3.4, 0.5)], 6); // band 0, piece 1: unchanged
    expect(m.body[K(1.4, 1.5)]).toBeCloseTo(flat.body[K(1.4, 1.5)], 6); // band 1: no accent
    expect(m.body[K(1.4, 3.0)]).toBeLessThan(flat.body[K(1.4, 3.0)]); // brush piece 0: sunk
    expect(m.body[K(3.4, 3.0)]).toBeCloseTo(flat.body[K(3.4, 3.0)], 6);
  });
});

describe('per-element accents: the rows in the panel', () => {
  beforeEach(() => { P.brickSettings.frameBandAccents = []; P.brickSettings.brushAccent = { preset: 'none', levelIn: 0.0625, clicks: [] }; });
  it('every Frame band gets its own Accent row (presets + Click, no Custom); picking one sets THAT band only', () => {
    setup('frame');
    $('brickFramePreset_three_band').click();
    for (const i of [0, 1, 2]) expect($(`brickAccent_band${i}_checker`), `band ${i}`).toBeTruthy();
    expect(document.querySelectorAll('[id^=brickAccent_band0_][id$=custom]')).toHaveLength(0);
    $('brickAccent_band1_staircase').click();
    expect(P.brickSettings.frameBandAccents[1]).toMatchObject({ preset: 'staircase' });
    expect(P.brickSettings.frameBandAccents[0]).toBeUndefined();
    setElementAccent({ kind: 'frameBand', band: 1 }, { levelIn: -0.5 });
    expect(P.brickSettings.frameBandAccents[1].levelIn).toBe(-0.125); // the declared signed range
  });
  it('the Brush section has its Accent row; Click arms the click mode for brush bricks', () => {
    setup('brush');
    expect($('brickAccent_brush_checker')).toBeTruthy();
    $('brickAccent_brush_checker').click();
    expect(P.brickSettings.brushAccent.preset).toBe('checker');
    $('brickAccentClick_brush').click();
    expect(P.brickSettings.brushAccent.preset).toBe('custom');
    expect(typeof window.svgEditor._brickAccentClick).toBe('function');
  });
});

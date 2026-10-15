/**
 * Per-pattern defaults (Fred 2026-10-11: "patterns aren't all bricks"): every pattern declares its default size and joint
 * (core/bricks/library.js patternDefaultsOf; a frame preset's `bestSize` IS its default size) and each element (Wall /
 * Brick frame / Brush) lays at its pattern's defaults unless the user overrides a value in its Size & joint section. The
 * default chip carries a dot; a ↺ (Reset to pattern default) shows only while the element overrides. Replaces the
 * 2026-10-10 Best-size hint + [Use it]. The band lists themselves -- and so every lay -- are byte-identical.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { FRAME_PRESETS, BRICK_SETS, BRICK_PATTERN_DEFAULTS, patternDefaultsOf } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runBricks: vi.fn(() => ({ wallCount: 3, frameCount: 0 })), runBricksPreview: vi.fn(), runBricksOutlinePreview: vi.fn(), buildRibbonPrimitives: vi.fn(() => []) };
});
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/toast.js', () => ({ showToast: vi.fn() }));
// the mask's brick textures (saved-board-keeps-settings.test.js does the same): no image load in a test
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-surface.js', () => ({ preloadSetDetail: vi.fn(async () => {}), sampleDetailAtFor: vi.fn(() => undefined) }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, frameContext: vi.fn(() => ({})) };
});
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, frameContourSilhouette: vi.fn(() => ({ primitives: [] })) };
});

import { initBrickPanel, setFrameBandPreset, setBrickSize, PATTERN_DEFAULT_MARK, ELEMENT_LOOK_RESETS, LOOK_RESET_TITLE } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { frameBandsOf, elementSize, elementGroutDepth, elementGroutProfile } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { rasterizeBrickHeightMask } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-height-mask.js';

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
  <div id="brickSizeBlock"><label id="brickSizeLabel">Brick size (in)</label>
  <input id="brickSizeSlider" type="range" min="0" max="1000" step="1" value="226"><input id="brickSize" type="number" value="0.75">
  <div id="brickSizePresetList"></div></div>
  <div id="brickGroutWidthRow"><label id="brickGroutWidthLabel">Joint width (in)</label><input id="brickGroutWidth"></div>
  <div id="brickGroutDepthRow"><button id="brickBtnGroutRecessed"></button><button id="brickBtnGroutFlush"></button>
  <label id="brickGroutDepthLabel">Joint depth (in)</label><input id="brickGroutDepth"></div>
  <div id="brickQuickSettings"></div>
  <div id="brickSidebarNoBricks" style="display:none;"></div><div id="brickStartHint" style="display:none;"></div>
  <input id="brickSeed"><button id="brickBtnRandomSeed"></button>
`;
const $ = (id) => document.getElementById(id);
let root;
function setup({ preset = 'single_soldier', sizes = { wall: null, frame: null, brush: null } } = {}) {
  root = document.createElement('div');
  root.innerHTML = FIXTURE;
  document.body.appendChild(root);
  window.svgEditor = { setMode: () => {}, _layers: [{ id: 'b', name: 'Bricks', holdsBricks: true }], _sketchLayer: { node: document.createElement('div') }, _undoStack: [] };
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  P.brickSettings.frameBandPreset = preset;
  P.brickSettings.frameBandPatterns = [];
  P.brickSettings.pattern = 'stretcher';
  P.brickSettings.sizeByElement = { ...sizes };
  P.brickSettings.groutByElement = { wall: null, frame: null, brush: null };
  P.brickSettings.groutDepthByElement = { wall: null, frame: null, brush: null };
  P.brickSettings.groutProfileByElement = { wall: null, frame: null, brush: null };
  initBrickPanel();
  vi.clearAllMocks();
}
afterEach(() => { root?.remove(); window.svgEditor = null; vi.unstubAllGlobals(); });

const pickSize = (selId, id) => { const s = document.getElementById(selId); s.value = id; s.dispatchEvent(new Event('change')); };
const marked = () => [...document.querySelectorAll(`.${PATTERN_DEFAULT_MARK.cls}`)].map((b) => b.id).sort();
const resetShown = (id) => !!$(id) && $(id).style.display !== 'none';
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

describe('patternDefaultsOf: the fallback, a frame preset\u2019s bestSize, then its own row', () => {
  it('a pattern with nothing declared reads the fallback (1 1/4 in, Recessed, the set\u2019s joint)', () => {
    expect(BRICK_PATTERN_DEFAULTS).toMatchObject({ sizeIn: 1.25, groutWidthIn: null, groutProfile: 'recessed' });
    expect(patternDefaultsOf('wall', 'stretcher')).toEqual(BRICK_PATTERN_DEFAULTS);
    expect(patternDefaultsOf('brush', 'stretcher_1')).toEqual(BRICK_PATTERN_DEFAULTS);
    expect(patternDefaultsOf('frame', 'single_soldier')).toEqual(BRICK_PATTERN_DEFAULTS);
  });
  it('every frame preset with a bestSize lays at it by default (Fred: OK for new boards)', () => {
    for (const [id, bands] of declared) expect(patternDefaultsOf('frame', id).sizeIn, id).toBe(bands.bestSize);
  });
});

describe('Size & joint: each element on its pattern\u2019s defaults unless overridden', () => {
  const [bestId, bestBands] = declared[0];

  it('a new board: every element at its pattern\u2019s default; both size dropdowns say and mark it; no ↺', () => {
    setup();
    expect(elementSize(P.brickSettings, 'wall')).toBe(1.25);
    expect($('brickSizeSelect').value).toBe('one_quarter1');
    expect($('brickSizeSelect').selectedOptions[0].textContent).toBe('1¼″' + PATTERN_DEFAULT_MARK.suffix);
    expect(marked()).toEqual(['brickQuickSelect_size', 'brickSizeSelect']); // editor (Wall) + sidebar (Wall)
    for (const r of ELEMENT_LOOK_RESETS) {
      expect($(r.id).className, r.id).toBe('tweak-reset'); // the tweak rows' own ↺ icon, its tooltip
      expect($(r.id).title).toBe(LOOK_RESET_TITLE);
      expect(resetShown(r.id), r.id).toBe(false);
    }
  });

  it('a size pick is the active element\u2019s override: its ↺ shows; the ↺ puts it back on the pattern default', () => {
    setup();
    pickSize('brickSizeSelect', 'three');
    expect(P.brickSettings.sizeByElement).toEqual({ wall: 3, frame: null, brush: null }); // the Wall only
    expect(resetShown('brickLookReset_size')).toBe(true);
    expect(marked()).toEqual([]); // the current size is not the default
    expect($('brickSizeSelect').querySelector('option[value=one_quarter1]').textContent).toBe('1¼″' + PATTERN_DEFAULT_MARK.suffix); // the list still says it
    $('brickLookReset_size').click();
    expect(P.brickSettings.sizeByElement.wall).toBeNull();
    expect(elementSize(P.brickSettings, 'wall')).toBe(1.25);
    expect(resetShown('brickLookReset_size')).toBe(false);
  });

  it('picking another frame preset: no override -> the new preset\u2019s default; an override stays (Fred\u2019s rule)', () => {
    setup();
    setFrameBandPreset(bestId);
    expect(elementSize(P.brickSettings, 'frame')).toBe(bestBands.bestSize);
    setBrickSize(8, 'generate', 'frame');
    setFrameBandPreset('single_soldier');
    expect(elementSize(P.brickSettings, 'frame')).toBe(8);
    expect(elementSize(P.brickSettings, 'wall')).toBe(1.25); // the Wall never moved
  });

  it('the joint depth and Recessed / Flush are per element: the Wall\u2019s edit leaves the Frame on its default', () => {
    setup();
    $('brickBtnGroutFlush').click();
    $('brickGroutDepth').value = '0.08';
    $('brickGroutDepth').dispatchEvent(new Event('change'));
    expect(elementGroutProfile(P.brickSettings, 'wall')).toBe('flush');
    expect(elementGroutDepth(P.brickSettings, 'wall')).toBe(0.08);
    expect(elementGroutProfile(P.brickSettings, 'frame')).toBe('recessed');
    expect(elementGroutDepth(P.brickSettings, 'frame')).toBe(BRICK_PATTERN_DEFAULTS.groutDepthIn);
    expect(resetShown('brickLookReset_groutDepth')).toBe(true);
    $('brickLookReset_groutDepth').click(); // one ↺ for the depth and its profile
    expect(elementGroutProfile(P.brickSettings, 'wall')).toBe('recessed');
    expect(elementGroutDepth(P.brickSettings, 'wall')).toBe(BRICK_PATTERN_DEFAULTS.groutDepthIn);
  });

  it('the sidebar quick Size row sets the WALL\u2019s size (Fred 2026-10-11)', () => {
    setup();
    pickSize('brickQuickSelect_size', 'half1');
    expect(P.brickSettings.sizeByElement).toEqual({ wall: 1.5, frame: null, brush: null });
  });

  it('a TYPED size equal to the default is marked too; any other typed size is not (Fred 2026-10-14)', () => {
    setup();
    const type = (v) => { $('brickQuickSize').value = String(v); $('brickQuickSize').dispatchEvent(new Event('change')); };
    type(1.3);
    expect(P.brickSettings.sizeByElement.wall).toBe(1.3);
    expect(marked()).toEqual([]);
    expect($('brickQuickSelect_size').value).toBe('custom');
    type(1.25);
    expect(marked()).toEqual(['brickQuickSelect_size', 'brickSizeSelect']);
  });

  it('the retired Best-size hint and [Use it] are gone', () => {
    setup({ preset: bestId });
    expect(document.querySelector('[id^="brickBestSizeHint_"], [id^="brickBestSizeUse_"], .best-size')).toBeNull();
  });
});

describe('the 3D joints per element (editor-brick-height-mask.js groutByKind)', () => {
  // a wall brick and a frame brick, one joint apart
  function board() {
    const root = document.createElement('div');
    const add = (pts, kind, id) => {
      const b = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      for (const [k, v] of [['points', pts], ['data-layer', 'L'], ['data-brick-gen', '1'], ['data-brick-set', '1'], ['data-brick-seed', '1'],
        ['data-brick-relief', '0.125'], ['data-brick', kind], ['data-brick-id', id]]) b.setAttribute(k, v);
      root.appendChild(b);
    };
    add('0.5,1 1.9,1 1.9,2 0.5,2', 'wall', 'w1');
    add('2.1,1 3.5,1 3.5,2 2.1,2', 'frame', 'f1');
    document.body.appendChild(root);
    return { _sketchLayer: { node: root } };
  }
  const mask = (opts) => rasterizeBrickHeightMask(board(), { id: 'L', depth: 0.125 }, 81, 61, 4, 3, { groutWidthIn: 0.1, ...opts });
  const same = (look) => Object.fromEntries(['wall', 'frame', 'brush'].map((k) => [k, look]));

  it('one look for every element = exactly the old one-profile mask (any board saved before: byte-identical)', async () => {
    for (const [profile, depthIn] of [['recessed', 0.05], ['flush', 0.05], ['recessed', 0]]) {
      const old = await mask({ groutProfile: profile, groutDepthIn: depthIn });
      const now = await mask({ groutByKind: same({ profile, depthIn }) });
      expect(Array.from(now.body), `${profile} ${depthIn}`).toEqual(Array.from(old.body));
      expect(now.jointIn, `${profile} ${depthIn}`).toBe(old.jointIn);
    }
  });

  it('a Recessed wall beside a Flush frame: the wall\u2019s joints sink, the frame\u2019s fill flush', async () => {
    const m = await mask({ groutByKind: { wall: { profile: 'recessed', depthIn: 0.05 }, frame: { profile: 'flush', depthIn: 0.05 }, brush: { profile: 'recessed', depthIn: 0.05 } } });
    const at = (x, y) => m.body[Math.round((1 - y / 3) * 60) * 81 + Math.round((x / 4) * 80)];
    expect(at(0.45, 1.5)).toBeLessThan(0); // beside the wall brick only: recessed
    expect(at(3.55, 1.5)).toBeGreaterThan(0); // beside the frame brick only: flush, up to its face
  });
});

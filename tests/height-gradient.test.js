/**
 * HEIGHT-PAINTER slice 2, step 3: the GRADIENT tool (core/height/gradient.js). Linear / radial; two stops with EXACT heights
 * (inches, typed); a drag sets the start / end points; the curve between them is a brush falloff profile (BRUSH_FALLOFFS) or
 * the custom curve, t = 0 at the start stop, 1 at the end (height = end + (start - end) x curve(t)); opacity; mode normal /
 * add / max; applied ONCE on release (one undo step), inside the selection only.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyGradient, gradientValue, GRADIENT_DEFAULTS, GRADIENT_TYPES, GRADIENT_MODES } from '../bspline-frame-builder/b-spline-gen/html/core/height/gradient.js';
import { rectMask } from '../bspline-frame-builder/b-spline-gen/html/core/height/selection.js';
import { f16Round, decodedRaster } from '../bspline-frame-builder/b-spline-gen/html/core/height/raster.js';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  initHeightPanel, newHeightPatch, activeHeightLayer, _resetHeightPanelForTests, setHeightField, setHeightTool, selectHeightRect,
  applyHeightGradient, HEIGHT_TOOLS, heightToolSettings,
} from '../bspline-frame-builder/b-spline-gen/html/main/height-panel.js';
import { heightBrushHandler } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-height-tool.js';
import { setEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';

const f = Math.fround;
const COLS = 101, ROWS = 11;
const grid = (fill = 0) => new Float32Array(COLS * ROWS).fill(fill);
const at = (d, c, r) => d[r * COLS + c];
const G = (o) => ({ ...GRADIENT_DEFAULTS, falloff: 'linear', startIn: 0.5, endIn: 0.1, opacity: 1, mode: 'normal', ...o });
const run = (d, o, start = [10, 5], end = [90, 5], mask = null) => applyGradient(d, COLS, ROWS, G(o), { start, end, pxPerInX: 100, pxPerInY: 100, mask });

describe('the declared tool', () => {
  it('types, modes and defaults', () => {
    expect(GRADIENT_TYPES).toEqual(['linear', 'radial']);
    expect(GRADIENT_MODES).toEqual(['normal', 'add', 'max']);
    expect(GRADIENT_DEFAULTS).toMatchObject({ type: 'linear', opacity: 1, mode: 'normal' });
  });
});

describe('linear: exact heights at both stops, the profile between', () => {
  it('linear profile: start, end and the middle exactly; past the ends the stops hold', () => {
    const d = grid();
    run(d, {});
    expect(at(d, 10, 5)).toBe(f(0.5));
    expect(at(d, 90, 5)).toBe(f(0.1));
    expect(at(d, 50, 5)).toBe(f(0.1 + 0.4 * 0.5));
    expect(at(d, 50, 0)).toBe(f(0.1 + 0.4 * 0.5)); // a linear gradient is constant across its direction
    expect(at(d, 0, 5)).toBe(f(0.5));
    expect(at(d, 100, 5)).toBe(f(0.1));
  });
  it('a profile (dome) and the custom curve set the middle: end + (start - end) x curve(0.5)', () => {
    const dome = grid();
    run(dome, { falloff: 'dome' });
    expect(at(dome, 50, 5)).toBe(f(0.1 + 0.4 * Math.sqrt(0.75)));
    expect(at(dome, 10, 5)).toBe(f(0.5));
    expect(at(dome, 90, 5)).toBe(f(0.1));
    const custom = grid();
    run(custom, { falloff: 'custom', customCurve: [[0, 1], [0.5, 0.2], [1, 0]] });
    expect(at(custom, 50, 5)).toBeCloseTo(0.1 + 0.4 * 0.2, 6);
    expect(gradientValue(0.5, G({ falloff: 'custom', customCurve: [[0, 1], [0.5, 0.2], [1, 0]] }))).toBeCloseTo(0.18, 12);
  });
});

describe('radial', () => {
  it('the start stop at the centre, the end stop at the drag distance; t = distance / radius', () => {
    const d = grid();
    run(d, { type: 'radial' }, [50, 5], [60, 5]);
    expect(at(d, 50, 5)).toBe(f(0.5));
    expect(at(d, 60, 5)).toBe(f(0.1));
    expect(at(d, 40, 5)).toBe(f(0.1)); // every direction
    expect(at(d, 50, 0)).toBe(f(0.1 + 0.4 * 0.5)); // 5 px up = half the radius
    expect(at(d, 80, 5)).toBe(f(0.1));
  });
});

describe('opacity, modes, the selection', () => {
  it('normal at opacity 0.5 mixes with what is there; add adds; max keeps the higher', () => {
    const n = grid(0.2); run(n, { opacity: 0.5 });
    expect(at(n, 10, 5)).toBe(f(f(0.2) * 0.5 + 0.5 * 0.5));
    const a = grid(0.2); run(a, { mode: 'add' });
    expect(at(a, 10, 5)).toBe(f(f(0.2) + 0.5));
    const m = grid(0.2); run(m, { mode: 'max' });
    expect(at(m, 10, 5)).toBe(f(0.5));
    expect(at(m, 90, 5)).toBe(f(0.2)); // 0.1 < 0.2: kept
  });
  it('inside the selection only: outside it nothing changes', () => {
    const d = grid(0.05);
    run(d, {}, [10, 5], [90, 5], rectMask(COLS, ROWS, 0, 0, 49, 10));
    expect(at(d, 10, 5)).toBe(f(0.5));
    for (let r = 0; r < ROWS; r++) for (let c = 50; c < COLS; c++) expect(at(d, c, r)).toBe(f(0.05));
  });
});

describe('the panel: drag sets the points, typed stops, ONE step on release', () => {
  const saved = {};
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    Object.assign(saved, { hl: P.heightLayers, w: P.widthIn, h: P.heightIn });
    P.widthIn = 2; P.heightIn = 1; P.heightLayers = DEFAULT.heightLayers;
    document.body.innerHTML = '<div id="heightPanelBody"></div><div id="editorToolbarHeight"></div>';
    _resetHeightPanelForTests();
    window.svgEditor = { _undoStack: [], _currentMode: 'select', setMode(m) { this._currentMode = m; }, pushState() { this._undoStack.push({}); }, _notifyChange() {} };
    initHeightPanel({});
  });
  afterEach(() => { P.heightLayers = saved.hl; P.widthIn = saved.w; P.heightIn = saved.h; delete window.svgEditor; setEditorTab('artwork'); vi.useRealTimers(); });

  it('is a declared tool; its stops are typed exactly (no clamp past the slider travel)', () => {
    expect(HEIGHT_TOOLS.map((t) => t.id)).toContain('gradient');
    expect(setHeightField('gradStartIn', '0.3')).toBe(true);
    expect(setHeightField('gradEndIn', '-2.5')).toBe(true);
    expect(heightToolSettings('gradient')).toMatchObject({ startIn: 0.3, endIn: -2.5 });
  });
  it('a canvas drag (the gesture) applies once on release: one undo step, exact stored stops inside a rectangle selection', async () => {
    await newHeightPatch(); // 200 x 100 px over the 2 x 1 in board
    setHeightField('gradStartIn', 0.4); setHeightField('gradEndIn', 0.2); setHeightField('gradFalloff', 'linear');
    selectHeightRect([-1, -0.5], [0.5, 0.5]); // pixels c 0..149
    setEditorTab('height');
    setHeightTool('gradient');
    const ed = window.svgEditor;
    const steps = ed._undoStack.length;
    // editor coordinates (inches, y down): board X = x - 1
    heightBrushHandler.start(ed, { x: 0.105, y: 0.5 }, {}); // pixel c 10
    heightBrushHandler.update(ed, { x: 0.6, y: 0.5 }, {});
    heightBrushHandler.update(ed, { x: 1.305, y: 0.5 }, {}); // pixel c 130
    expect(ed._undoStack.length).toBe(steps); // nothing stored while dragging
    await heightBrushHandler.finish(ed);
    expect(ed._undoStack.length).toBe(steps + 1);
    const d = decodedRaster(activeHeightLayer().raster);
    const px = (c, r) => d[r * 200 + c];
    expect(px(10, 50)).toBe(f16Round(0.4));
    expect(px(130, 50)).toBe(f16Round(0.2));
    expect(px(70, 50)).toBe(f16Round(0.3));
    expect(px(160, 50)).toBe(0); // outside the selection
  });
  it('applyHeightGradient (board inches) is the same path', async () => {
    await newHeightPatch();
    await applyHeightGradient([-0.895, 0], [0.895, 0], { startIn: 0.1, endIn: 0.3, falloff: 'linear', type: 'linear' });
    const d = decodedRaster(activeHeightLayer().raster);
    expect(d[50 * 200 + 10]).toBe(f16Round(0.1));
    expect(d[50 * 200 + 189]).toBe(f16Round(0.3));
  });
});

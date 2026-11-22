/**
 * HEIGHT-PAINTER slice 3: BRUSH TIP SHAPES (Fred 2026-11-22: "a brush shape tool too, square, circle, bevel brush, angle
 * adjustment"). core/height/brush.js BRUSH_TIPS: 'round' (the slice-1 dab), 'square', 'chisel' (a flat blade); `roundness`
 * squashes the tip along its own short axis, `angle` turns it (degrees, counter-clockwise on the board), `followStroke`
 * turns it with the drag direction. The falloff / hardness run on the TIP's own distance: round = radial (an ellipse when
 * squashed), square = Chebyshev in the tip frame (square + linear = a chamfer, square + plateau = a flat-topped square),
 * chisel = across the blade only (square ends). The round byte-identity pin is tests/height-brush-tip-pin.test.js.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStroke, BRUSH_DEFAULTS, BRUSH_TIPS, BRUSH_QUICK_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/height/brush.js';
import { f16Round, decodedRaster } from '../bspline-frame-builder/b-spline-gen/html/core/height/raster.js';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  initHeightPanel, newHeightPatch, activeHeightLayer, _resetHeightPanelForTests, setHeightField, heightBrush, paintHeightStroke,
  HEIGHT_CONTROLS, HEIGHT_TOOL_CONTROLS,
} from '../bspline-frame-builder/b-spline-gen/html/main/height-panel.js';
import { heightBrushHandler } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-height-tool.js';
import { setEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';

const N = 101, C = 50; // a 101 x 101 raster at 100 px / in; the dab at the centre pixel
const SET = { ...BRUSH_DEFAULTS, mode: 'set', targetIn: 1, opacity: 1, flow: 1, sizeIn: 0.6 }; // R = 0.3 in = 30 px
function dab(brush, opts = {}) {
  const raster = { cols: N, rows: N, data: new Float32Array(N * N) };
  const s = createStroke(raster, brush, { pxPerInX: 100, pxPerInY: 100, ...opts });
  s.addPoint(C, C, 1);
  if (s.finish) s.finish();
  return { v: (dc, dr) => raster.data[(C + dr) * N + C + dc], s, data: raster.data };
}

describe('the declared tips', () => {
  it('BRUSH_TIPS: round, square, chisel; the defaults are the slice-1 round brush', () => {
    expect(Object.keys(BRUSH_TIPS)).toEqual(['round', 'square', 'chisel']);
    for (const t of Object.values(BRUSH_TIPS)) expect(typeof t.label).toBe('string');
    expect(BRUSH_DEFAULTS).toMatchObject({ tip: 'round', roundness: 1, angle: 0, followStroke: false });
  });
});

describe('square: Chebyshev in the tip frame', () => {
  it('square + linear = a crisp chamfer: the same height along an axis and along the diagonal at the same Chebyshev distance', () => {
    const { v } = dab({ ...SET, tip: 'square', falloff: 'linear', hardness: 0.3 });
    const expected = Math.fround(1 - (0.2 - 0.09) / (0.3 - 0.09)); // 20 px out, core 0.09 in, rim 0.3 in
    expect(v(20, 0)).toBeCloseTo(expected, 6);
    expect(v(20, 20)).toBeCloseTo(expected, 6);
    expect(v(-20, 13)).toBeCloseTo(expected, 6);
    expect(v(28, 28)).toBeGreaterThan(0); // a square's corner: past the round rim (0.396 in) yet painted
    expect(v(5, 5)).toBe(1);              // the flat top inside the hard core
    const round = dab({ ...SET, falloff: 'linear', hardness: 0.3 }).v;
    expect(round(28, 28)).toBe(0);
    expect(round(20, 20)).toBeLessThan(v(20, 20) - 0.2);
  });
  it('square + plateau = a flat-topped square', () => {
    const { v } = dab({ ...SET, tip: 'square', falloff: 'plateau', hardness: 0 });
    expect(v(15, 15)).toBeCloseTo(1 - 1 / 64, 6);
    expect(v(15, -4)).toBeCloseTo(1 - 1 / 64, 6);
  });
  it('angle 45: a diamond (the square turned)', () => {
    const turned = dab({ ...SET, tip: 'square', falloff: 'linear', hardness: 1, angle: 45 }).v;
    const plain = dab({ ...SET, tip: 'square', falloff: 'linear', hardness: 1 }).v;
    expect(plain(23, 23)).toBe(1); expect(turned(23, 23)).toBe(0);   // a corner of the upright square; past the diamond
    expect(plain(0, 0)).toBe(1); expect(turned(40, 0)).toBe(1);      // the diamond's tip reaches 0.3 x sqrt 2 = 42 px along X
    expect(plain(40, 0)).toBe(0);
  });
  it('the touched box holds the turned corners', () => {
    const { s } = dab({ ...SET, tip: 'square', hardness: 1, angle: 45 });
    expect(s.bbox.c1 - C).toBeGreaterThanOrEqual(42);
  });
});

describe('roundness and angle', () => {
  it('roundness 0.5: an ellipse squashed along the tip\'s short axis (Y at angle 0, X at angle 90)', () => {
    const flat = dab({ ...SET, hardness: 1, roundness: 0.5 }).v;
    expect(flat(25, 0)).toBe(1); expect(flat(0, 25)).toBe(0); expect(flat(0, 14)).toBe(1);
    const up = dab({ ...SET, hardness: 1, roundness: 0.5, angle: 90 }).v;
    expect(up(25, 0)).toBe(0); expect(up(0, 25)).toBe(1);
  });
  it('the angle is on the board: on a patch turned 90 degrees the raster sees the tip turned back', () => {
    const v = dab({ ...SET, hardness: 1, roundness: 0.5 }, { rotationDeg: 90 }).v;
    expect(v(25, 0)).toBe(0); expect(v(0, 25)).toBe(1);
  });
});

describe('chisel: a flat blade, the falloff across it only', () => {
  it('full height all along the blade up to its square end; the falloff across its thickness (roundness x R)', () => {
    const { v } = dab({ ...SET, tip: 'chisel', roundness: 0.25, falloff: 'linear', hardness: 0 });
    expect(v(25, 0)).toBe(1); expect(v(-29, 0)).toBe(1);
    expect(v(31, 0)).toBe(0);                                  // past the blade's end
    expect(v(10, 3)).toBeCloseTo(Math.fround(1 - 0.12 / 0.3), 6); // 0.03 in across = 0.12 of the 0.075 in half-thickness
    expect(v(25, 3)).toBeCloseTo(v(0, 3), 6);                   // the same across-profile anywhere along it
    expect(v(0, 8)).toBe(0);
  });
  it('followStroke: the blade turns with the drag (a vertical stroke paints a thin vertical line; no stray first dab)', () => {
    const brush = { ...SET, tip: 'chisel', roundness: 0.2, hardness: 1, followStroke: true };
    const raster = { cols: N, rows: N, data: new Float32Array(N * N) };
    const s = createStroke(raster, brush, { pxPerInX: 100, pxPerInY: 100 });
    s.addPoint(C, 20); s.addPoint(C, 80); s.finish();
    const v = (c, r) => raster.data[r * N + c];
    expect(v(C, 50)).toBe(1); expect(v(C + 4, 50)).toBe(1);
    expect(v(C + 10, 50)).toBe(0);
    expect(v(C + 10, 20)).toBe(0); // the first dab is laid along the stroke too
    const fixed = dab({ ...brush, followStroke: false }).v; // no follow: the blade lies along X
    expect(fixed(10, 0)).toBe(1);
  });
  it('a tap with followStroke still lays its one dab (at the set angle)', () => {
    const { v, s } = dab({ ...SET, tip: 'chisel', roundness: 0.2, hardness: 1, followStroke: true });
    expect(s.dabs).toBe(1);
    expect(v(20, 0)).toBe(1);
    expect(v(0, 8)).toBe(0); // the blade's thickness (0.06 in), not a round dab
  });
});

describe('the panel', () => {
  const saved = {};
  let ed;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    Object.assign(saved, { hl: P.heightLayers, w: P.widthIn, h: P.heightIn });
    P.widthIn = 2; P.heightIn = 2; P.heightLayers = DEFAULT.heightLayers;
    document.body.innerHTML = '<div id="heightPanelBody"></div><div id="editorToolbarHeight"></div>';
    _resetHeightPanelForTests();
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg'), sketch = document.createElementNS(NS, 'g');
    svg.appendChild(sketch); document.body.appendChild(svg);
    ed = window.svgEditor = { _sketchLayer: { node: sketch }, _undoStack: [], _currentMode: 'select', setMode(m) { this._currentMode = m; }, pushState() { this._undoStack.push({}); }, _notifyChange() {} };
    initHeightPanel({});
  });
  afterEach(() => { P.heightLayers = saved.hl; P.widthIn = saved.w; P.heightIn = saved.h; delete window.svgEditor; setEditorTab('artwork'); vi.useRealTimers(); });

  it('the tip controls are declared (brush target, in the slice-2 tool table) and render', () => {
    const ids = HEIGHT_TOOL_CONTROLS.filter((c) => c.target === 'brush').map((c) => c.id);
    expect(ids).toEqual(['tip', 'roundness', 'angle', 'followStroke']);
    expect(HEIGHT_CONTROLS.some((c) => c.id === 'tip')).toBe(false); // the pinned slice-1 table is unchanged
    for (const id of ['roundness', 'angle', 'followStroke']) expect(document.getElementById(`height_${id}`), id).toBeTruthy();
    expect(document.querySelectorAll('[data-height-choice^="tip:"]').length).toBe(3);
    setHeightField('tip', 'square'); setHeightField('roundness', 0.4); setHeightField('angle', 30); setHeightField('followStroke', true);
    expect(heightBrush()).toMatchObject({ tip: 'square', roundness: 0.4, angle: 30, followStroke: true });
  });
  it('the Bevel quick preset: square tip, linear falloff, hardness 0.3; a dab of it is a chamfer in the stored raster', async () => {
    expect(BRUSH_QUICK_PRESETS.bevel.brush).toEqual({ tip: 'square', falloff: 'linear', hardness: 0.3 });
    document.getElementById('heightBrushPreset_bevel').click();
    expect(heightBrush()).toMatchObject({ tip: 'square', falloff: 'linear', hardness: 0.3 });
    await newHeightPatch(); // 200 x 200
    await paintHeightStroke([[0, 0]], { mode: 'set', targetIn: 0.2, sizeIn: 0.6 }); // the dab at pixel (99.5, 99.5)
    const d = decodedRaster(activeHeightLayer().raster);
    const px = (c, r) => d[r * 200 + c];
    expect(px(99, 99)).toBe(f16Round(0.2));
    expect(px(120, 99)).toBe(px(120, 120)); // the same Chebyshev ring (20.5 px out) along X and the diagonal: a chamfer
    expect(px(120, 99)).toBeGreaterThan(0.05); expect(px(120, 99)).toBeLessThan(0.15);
  });
  it('the on-canvas cursor is the tip\'s footprint, turned by its angle', async () => {
    await newHeightPatch();
    setEditorTab('height');
    setHeightField('tip', 'square'); setHeightField('angle', 30); setHeightField('sizeIn', 0.6);
    heightBrushHandler.hover(ed, { x: 1, y: 1 });
    const ring = document.getElementById('heightBrushRing');
    expect(ring.getAttribute('transform')).toBe('translate(1 1) rotate(-30)');
    expect(ring.getAttribute('d')).toBe('M-0.3 -0.3H0.3V0.3H-0.3Z');
    setHeightField('tip', 'round'); setHeightField('roundness', 0.5);
    heightBrushHandler.hover(ed, { x: 1, y: 1 });
    expect(ring.getAttribute('d')).toBe('M-0.3 0A0.3 0.15 0 1 0 0.3 0A0.3 0.15 0 1 0 -0.3 0Z');
  });
});

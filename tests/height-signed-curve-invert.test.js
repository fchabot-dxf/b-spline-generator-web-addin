/**
 * HEIGHT-PAINTER slice 5 additions (Fred, 2026-11-23, approved):
 *  - the brush's CUSTOM falloff curve may go -1..1 (it was kept 0..1): Raise / Lower add curve(t) x amount, so its part
 *    below zero does the opposite (a raise dab with a negative rim carves a moat); Set paints curve(t) x T (the negative part
 *    toward -k T), blended as Set does. Build up off keeps, per pixel, the dab with the largest ABSOLUTE contribution. The
 *    feather / STL crop fades read the curve clamped to 0..1 at that use (core/falloff.js edgeFade). An existing curve (all
 *    points in 0..1) paints byte for byte as before (tests/height-brush-tip-pin.test.js 'custom ring').
 *  - INVERT (a toggle at the top of the Brush section): the brush paints the opposite -- Raise <-> Lower, Set T paints -T
 *    (the palette marks the mirrored grey); Smooth is unaffected; Alt while painting flips it once more for that stroke.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStroke, BRUSH_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/core/height/brush.js';
import { edgeFade, curveFromPoints } from '../bspline-frame-builder/b-spline-gen/html/core/falloff.js';
import { decodedRaster, f16Round } from '../bspline-frame-builder/b-spline-gen/html/core/height/raster.js';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  initHeightPanel, newHeightPatch, activeHeightLayer, _resetHeightPanelForTests, setHeightField, setHeightTool, heightBrush, HEIGHT_CONTROLS,
  whenHeightIdle,
} from '../bspline-frame-builder/b-spline-gen/html/main/height-panel.js';
import { heightBrushHandler } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-height-tool.js';
import { setEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';

const MOAT = [[0, 1], [0.6, 0], [0.8, -0.5], [1, 0]];
const N = 101, C = 50;
function dab(over, at = []) {
  const raster = { cols: N, rows: N, data: new Float32Array(N * N) };
  const s = createStroke(raster, { ...BRUSH_DEFAULTS, falloff: 'custom', customCurve: MOAT, hardness: 0, sizeIn: 0.6, amountIn: 0.1, ...over }, { pxPerInX: 100, pxPerInY: 100 });
  s.addPoint(C, C);
  return (dc) => raster.data[C * N + C + dc];
}

describe('a signed custom curve', () => {
  it('Raise with a bump-and-moat curve: a raised centre and a carved ring', () => {
    const v = dab({ mode: 'raise' });
    expect(v(0)).toBeCloseTo(0.1, 6);                                     // t 0: curve 1
    expect(v(24)).toBeCloseTo(0.1 * curveFromPoints(MOAT)(0.8), 6);       // t 0.8: the moat, -0.05
    expect(v(24)).toBeLessThan(-0.04);
    expect(v(18)).toBeCloseTo(0, 6);                                      // t 0.6: the zero crossing
  });
  it('Lower: the negative lips rise; Set T: the moat goes to -k T; Build up off keeps the largest |contribution|', () => {
    expect(dab({ mode: 'lower' })(24)).toBeGreaterThan(0.04);
    expect(dab({ mode: 'set', targetIn: 0.2 })(24)).toBeCloseTo(-0.1, 6);  // -0.5 x 0.2
    expect(dab({ mode: 'set', targetIn: 0.2 })(0)).toBeCloseTo(0.2, 6);
    expect(dab({ mode: 'raise', buildUp: false })(24)).toBeCloseTo(-0.05, 6);
  });
  it('the fades (feather / STL crop edge) read the curve clamped to 0..1', () => {
    const fn = curveFromPoints(MOAT);
    expect(fn(0.8)).toBeLessThan(0);
    expect(edgeFade(0.02, 0.1, 'custom', fn)).toBe(0); // t 0.8 -> curve(0.8) < 0 would be a negative mask: 0
  });
  it('the brush curve widget runs -1..1 (a zero line); the gradient and feather curves stay 0..1', async () => {
    const { HEIGHT_TOOL_CONTROLS } = await import('../bspline-frame-builder/b-spline-gen/html/main/height-panel.js');
    expect(HEIGHT_CONTROLS.find((c) => c.id === 'customCurve').valueRange).toEqual([-1, 1]);
    expect(HEIGHT_TOOL_CONTROLS.find((c) => c.id === 'gradCurve').valueRange).toBeUndefined();
    expect(HEIGHT_TOOL_CONTROLS.find((c) => c.id === 'featherCurve').valueRange).toBeUndefined();
  });
});

describe('Invert', () => {
  const saved = {};
  let ed;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    Object.assign(saved, { hl: P.heightLayers, w: P.widthIn, h: P.heightIn });
    P.widthIn = 2; P.heightIn = 2; P.heightLayers = DEFAULT.heightLayers;
    document.body.innerHTML = '<div id="heightPanelBody"></div><div id="editorToolbarHeight"></div>';
    _resetHeightPanelForTests();
    ed = window.svgEditor = { _undoStack: [], _currentMode: 'select', setMode(m) { this._currentMode = m; }, pushState() { this._undoStack.push({}); }, _notifyChange() {} };
    initHeightPanel({});
    setEditorTab('height');
  });
  afterEach(() => { P.heightLayers = saved.hl; P.widthIn = saved.w; P.heightIn = saved.h; delete window.svgEditor; setEditorTab('artwork'); vi.useRealTimers(); });
  const at = (c, r) => decodedRaster(activeHeightLayer().raster)[r * 200 + c];
  const stroke = async (Y, e = {}) => {
    heightBrushHandler.start(ed, { x: 0.5, y: 1 - Y }, e);
    heightBrushHandler.update(ed, { x: 1.5, y: 1 - Y }, e);
    await heightBrushHandler.finish(ed);
    await whenHeightIdle();
  };
  it('a declared toggle at the top of the Brush section (on / off shown), off by default', () => {
    expect(HEIGHT_CONTROLS[0].id).toBe('invert');
    expect(heightBrush().invert).toBe(false);
    const ctl = document.querySelector('#heightGroup_brush [data-height-control]');
    expect(ctl.getAttribute('data-height-control')).toBe('invert');
    setHeightField('invert', true);
    expect(heightBrush().invert).toBe(true);
  });
  it('Invert + Raise lowers; Invert + Set at +0.2 paints -0.2; Invert + Alt = normal', async () => {
    await newHeightPatch();
    setHeightTool('brush');
    setHeightField('hardness', 1); setHeightField('sizeIn', 0.2); setHeightField('amountIn', 0.1);
    setHeightField('invert', true);
    setHeightField('mode', 'raise');
    await stroke(0.5);
    expect(at(100, 149)).toBeCloseTo(-0.1, 3);
    setHeightField('mode', 'set'); setHeightField('targetIn', 0.2);
    await stroke(0);
    expect(at(100, 99)).toBe(f16Round(-0.2));
    await stroke(-0.5, { altKey: true });
    expect(at(100, 49)).toBe(f16Round(0.2));
    expect(heightBrush()).toMatchObject({ mode: 'set', targetIn: 0.2, invert: true }); // the settings are not rewritten
  });
  it('Smooth is unaffected; the palette marks the mirrored grey while inverted', async () => {
    await newHeightPatch();
    setHeightField('mode', 'set'); setHeightField('targetIn', 0.125); // 75 % grey (Range 0.25)
    expect(document.querySelector('[data-height-grey="70"]').classList.contains('active')).toBe(false);
    setHeightField('invert', true);
    expect(document.querySelector('[data-height-grey="30"]')).toBeTruthy();
    setHeightField('targetIn', 0.1); // 70 % -> inverted paints -0.1 = 30 %
    expect(document.querySelector('[data-height-grey="30"]').classList.contains('active')).toBe(true);
    expect(document.querySelector('[data-height-grey="70"]').classList.contains('active')).toBe(false);
  });
});

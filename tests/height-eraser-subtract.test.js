/**
 * Fred 2026-11-23 ("soft eraser edges but an ACCURATE erase"): the Height Eraser SUBTRACTS. A pixel moves toward 0 by
 * a x max(Q, |v|) -- a = the eraser's coverage (the brush's own dab profile: size / hardness / falloff / opacity / flow /
 * spacing), v = the pixel's height at the erase stroke's start, Q = what the brush paints at full coverage in its current
 * mode (Raise / Lower: its Amount, Set: |its target|) -- and never past 0.
 * Measured before (the multiply v (1 - a)): the same soft brush over the same path left a rim a (1 - a) x Amount, up to
 * 0.0125 in on a 0.05 in stroke. Now the stroke is gone to within half a Float16 step (the layer's storage,
 * core/height/raster.js), a 0.2 in Fill still clears in one hard pass, a half-overlapping soft pass fades with no sign
 * crossing; the same in both grey systems and on the selected layer of two. Saved boards keep baked rasters only (no
 * stroke is replayed): a stored raster decodes and hashes as before.
 * Every stroke runs the editor's own gesture path (editor/editor-height-tool.js -> main/height-panel.js GESTURES).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { decodedRaster, decodeRaster, encodeRaster, f16Round } from '../bspline-frame-builder/b-spline-gen/html/core/height/raster.js';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  initHeightPanel, newHeightPatch, activeHeightLayer, activePatchLayer, _resetHeightPanelForTests, setHeightField, setHeightTool, fillHeight,
  whenHeightIdle, pickHeightGrey, addPaintLayer, heightBrush, syncHeightPanel, ERASE_SCALE,
} from '../bspline-frame-builder/b-spline-gen/html/main/height-panel.js';
import { heightBrushHandler } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-height-tool.js';
import { setEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';

const saved = {};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  Object.assign(saved, { hl: P.heightLayers, w: P.widthIn, h: P.heightIn });
  P.widthIn = 2; P.heightIn = 2; P.heightLayers = DEFAULT.heightLayers;
  document.body.innerHTML = '<div id="heightPanelBody"></div><div id="editorToolbarHeight"></div>';
  _resetHeightPanelForTests();
  window.svgEditor = { _undoStack: [], _currentMode: 'select', setMode(m) { this._currentMode = m; }, pushState() { this._undoStack.push({}); }, _notifyChange() {} };
  initHeightPanel({});
  setEditorTab('height');
});
afterEach(() => { P.heightLayers = saved.hl; P.widthIn = saved.w; P.heightIn = saved.h; delete window.svgEditor; setEditorTab('artwork'); vi.useRealTimers(); });

const N = 200; // a 2 x 2 in patch at 100 px/in
const layer = () => decodedRaster(activePatchLayer().raster);
/** One drag of `tool` along editor y = `y` (board Y = 1 - y), x 0.5 -> 1.5, through the editor's gesture handler. */
async function drag(tool, y = 1) {
  setHeightTool(tool);
  const ed = window.svgEditor;
  heightBrushHandler.start(ed, { x: 0.5, y }, { pointerType: 'mouse' });
  for (let i = 1; i <= 20; i++) heightBrushHandler.update(ed, { x: 0.5 + i * 0.05, y }, { pointerType: 'mouse' });
  await heightBrushHandler.finish(ed);
  await whenHeightIdle();
  return Float32Array.from(layer());
}
/** Half a Float16 step at |v| (the storage's rounding of a painted value), with a hair for the residue's own rounding. */
const halfStep = (v) => Math.abs(v) * 2 ** -11 * 1.01 + 1e-12;
/** Every pixel of `after` is within half a Float16 step of `want`, measured at what was painted (`painted`). */
function expectRemoved(after, want, painted, label) {
  let worst = 0, at = -1;
  for (let k = 0; k < after.length; k++) {
    const over = Math.abs(after[k] - want[k]) - halfStep(painted[k] - want[k]);
    if (over > worst) { worst = over; at = k; }
  }
  expect(worst, `${label}: pixel ${at} off by ${at >= 0 ? Math.abs(after[at] - want[at]) : 0}`).toBe(0);
}

describe('the same brush over the same path removes its stroke (no rim)', () => {
  for (const mode of ['raise', 'lower']) {
    it(`${mode} 0.05 with the default soft brush, then the Eraser: back to 0 within half a Float16 step`, async () => {
      await newHeightPatch();
      setHeightField('mode', mode); setHeightField('amountIn', 0.05);
      const zero = Float32Array.from(layer());
      const painted = await drag('brush');
      expect(Math.max(...painted.map(Math.abs))).toBeCloseTo(0.05, 3);
      const after = await drag('eraser');
      expectRemoved(after, zero, painted, mode);
    });
  }
  for (const [zero, g] of [['mid', 0.7], ['black', 0.4]]) {
    it(`a Set stroke from 0 (the palette's +0.10 in, ${zero === 'mid' ? 'Mid-grey' : 'Black'} = 0), then the Eraser: back to 0`, async () => {
      await newHeightPatch();
      setHeightField('greyZero', zero); await whenHeightIdle();
      expect(activeHeightLayer().greyZero === 'black' ? 'black' : 'mid').toBe(zero);
      expect(pickHeightGrey(g)).toBeCloseTo(0.1, 6);
      expect(heightBrush().mode).toBe('set');
      const base = Float32Array.from(layer());
      const painted = await drag('brush');
      const after = await drag('eraser');
      expectRemoved(after, base, painted, `set ${zero}`);
    });
  }
  it('two paint layers: the Eraser removes the stroke from the selected layer and leaves the other as it was', async () => {
    await newHeightPatch();
    await fillHeight({ heightIn: 0.03 });              // the base layer
    const baseH = activeHeightLayer().raster ? activeHeightLayer().raster.h : null;
    await addPaintLayer();
    const lowerLayer = activeHeightLayer().layers[0];
    const lowerH = lowerLayer.raster.h;
    setHeightField('mode', 'raise'); setHeightField('amountIn', 0.05);
    const zero = Float32Array.from(layer());
    const painted = await drag('brush');
    const after = await drag('eraser');
    expectRemoved(after, zero, painted, 'top layer');
    expect(activeHeightLayer().layers[0].raster.h).toBe(lowerH);
    expect(baseH === null || baseH === lowerH).toBe(true);
  });
});

describe('heights the brush did not paint, and partial passes', () => {
  it('a 0.2 in Fill clears in ONE hard pass (a x |v| above Q): the centre line is exactly 0', async () => {
    await newHeightPatch();
    await fillHeight({ heightIn: 0.2 });
    setHeightField('hardness', 1);
    const after = await drag('eraser');
    for (const c of [60, 100, 140]) expect(after[99 * N + c], `col ${c}`).toBe(0);
    expect(after[10 * N + 100]).toBe(f16Round(0.2)); // far from the drag: untouched
  });
  it('a half-overlapping soft pass fades the stroke smoothly: never below 0, never above what was there, no step', async () => {
    await newHeightPatch();
    setHeightField('mode', 'raise'); setHeightField('amountIn', 0.05);
    const painted = await drag('brush', 1);
    const after = await drag('eraser', 1.25); // half the brush (0.5 in) off the stroke's line
    let maxStepPainted = 0, maxStepAfter = 0;
    for (let k = 0; k < after.length; k++) {
      expect(after[k]).toBeGreaterThanOrEqual(0);
      expect(after[k]).toBeLessThanOrEqual(painted[k]);
    }
    for (let r = 1; r < N; r++) {
      maxStepPainted = Math.max(maxStepPainted, Math.abs(painted[r * N + 100] - painted[(r - 1) * N + 100]));
      maxStepAfter = Math.max(maxStepAfter, Math.abs(after[r * N + 100] - after[(r - 1) * N + 100]));
    }
    expect(maxStepAfter).toBeLessThanOrEqual(2 * maxStepPainted); // a fade, no cliff
    expect(after[99 * N + 100]).toBeGreaterThan(0.005);          // the stroke's own line: partly kept ...
    expect(after[99 * N + 100]).toBeLessThan(painted[99 * N + 100]); // ... and partly erased
    expect(painted[115 * N + 100]).toBeGreaterThan(0.001);
    expect(after[115 * N + 100]).toBe(painted[115 * N + 100]);    // the stroke's far side (beyond the eraser's reach): untouched
  });
  it('a Lower stroke under a half-overlapping pass stays at or below 0 (the eraser never crosses the sign)', async () => {
    await newHeightPatch();
    setHeightField('mode', 'lower'); setHeightField('amountIn', 0.05);
    const painted = await drag('brush', 1);
    const after = await drag('eraser', 1.25);
    for (let k = 0; k < after.length; k++) { expect(after[k]).toBeLessThanOrEqual(0); expect(after[k]).toBeGreaterThanOrEqual(painted[k]); }
  });
  it('ERASE_SCALE: Raise / Lower read the Amount, Set reads |target|, Smooth has none (the multiply)', () => {
    expect(Object.keys(ERASE_SCALE)).toEqual(['raise', 'lower', 'set']);
    expect(ERASE_SCALE.set({ targetIn: -0.08 })).toBe(0.08);
    expect(ERASE_SCALE.raise({ amountIn: 0.07 })).toBe(0.07);
  });
});

describe('saved boards keep their baked rasters (no stroke is replayed)', () => {
  it('a stored raster (painted, then erased by the old multiply) loads, decodes and hashes exactly as before', async () => {
    const cols = 40, rows = 20, d = new Float32Array(cols * rows);
    for (let k = 0; k < d.length; k++) d[k] = 0.05 * Math.sin(k / 7) * (k % 3 ? 1 : 0.25); // a rim-like pattern
    const raster = await encodeRaster(d, cols, rows);
    expect(raster.h).toBe('x9yjdt54pn');           // the pin: what a saved board carries
    const rec = { id: 'hpSaved', name: 'Saved', sizeIn: { w: 0.4, h: 0.2 }, raster };
    P.heightLayers = [rec];
    syncHeightPanel(); await whenHeightIdle();
    expect(P.heightLayers[0]).toBe(rec);             // opening the Height tab rewrites nothing
    const back = await decodeRaster(P.heightLayers[0].raster);
    expect(Array.from(back)).toEqual(Array.from(d, f16Round));
  });
});

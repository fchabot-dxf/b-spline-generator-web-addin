/**
 * HEIGHT-PAINTER slice 2, step 2: SELECTIONS (core/height/selection.js). A per-patch mask (Float32 0..1, session UI state,
 * never saved): rectangle, ellipse, lasso (a pointer path), FROM AN SVG SHAPE (the Draw tab's layer rasterised into the
 * patch's pixel frame through the app's own SVG renderer, core/stamp/render-svg.js), feather (a blur), invert, clear.
 * Every tool multiplies its effect by the mask: a brush stroke outside it changes nothing.
 * Raster frame (core/height/layer.js): pixel (c, r), row 0 = the patch's BOTTOM edge.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  rectMask, ellipseMask, lassoMask, featherMask, invertMask, maskFromSvg, patchPixelMatrix, maskOutline,
} from '../bspline-frame-builder/b-spline-gen/html/core/height/selection.js';
import { createStroke, BRUSH_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/core/height/brush.js';
import { P, DEFAULT, persistableP } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { decodedRaster } from '../bspline-frame-builder/b-spline-gen/html/core/height/raster.js';
import {
  initHeightPanel, newHeightPatch, activeHeightLayer, paintHeightStroke, _resetHeightPanelForTests,
  selectHeightRect, selectHeightEllipse, selectHeightLasso, invertHeightSelection, clearHeightSelection, featherHeightSelection,
  heightSelection, selectHeightFromSvg,
} from '../bspline-frame-builder/b-spline-gen/html/main/height-panel.js';

const at = (m, cols, c, r) => m[r * cols + c];
const count = (m) => m.reduce((s, v) => s + (v > 0.5 ? 1 : 0), 0);

describe('rectangle, ellipse, lasso: known pixels (pixel centres)', () => {
  it('a rectangle between two corner pixels, inclusive, in either order', () => {
    const m = rectMask(10, 8, 5, 3, 2, 1);
    expect(count(m)).toBe(12);
    expect(at(m, 10, 2, 1)).toBe(1); expect(at(m, 10, 5, 3)).toBe(1);
    expect(at(m, 10, 1, 1)).toBe(0); expect(at(m, 10, 6, 3)).toBe(0); expect(at(m, 10, 3, 4)).toBe(0);
  });
  it('an ellipse in a box: the centre and the axis ends in, the box corners out', () => {
    const m = ellipseMask(9, 9, 0, 0, 8, 8); // centre (4, 4), radius 4
    expect(at(m, 9, 4, 4)).toBe(1); expect(at(m, 9, 4, 0)).toBe(1); expect(at(m, 9, 0, 4)).toBe(1);
    expect(at(m, 9, 0, 0)).toBe(0); expect(at(m, 9, 1, 1)).toBe(0); // (3/4)^2 * 2 > 1
    expect(at(m, 9, 2, 1)).toBe(1); // (2/4)^2 + (3/4)^2 < 1
  });
  it('a lasso (a closed pointer path): a triangle', () => {
    const m = lassoMask(9, 9, [[0, 0], [8, 0], [0, 8]]);
    expect(at(m, 9, 1, 1)).toBe(1); expect(at(m, 9, 3, 4)).toBe(1);
    expect(at(m, 9, 5, 4)).toBe(0); expect(at(m, 9, 7, 7)).toBe(0);
  });
});

describe('feather and invert', () => {
  it('feather softens the edge: the middle stays 1, far outside 0, the edge in between; the area is kept', () => {
    const cols = 40, rows = 40, hard = rectMask(cols, rows, 10, 10, 29, 29);
    const soft = featherMask(hard, cols, rows, 4);
    expect(at(soft, cols, 20, 20)).toBeCloseTo(1, 6);
    expect(at(soft, cols, 0, 0)).toBeCloseTo(0, 6);
    const edge = at(soft, cols, 10, 20);
    expect(edge).toBeGreaterThan(0.2); expect(edge).toBeLessThan(0.8);
    expect(at(soft, cols, 8, 20)).toBeGreaterThan(0); // spills out
    const sum = (m) => m.reduce((s, v) => s + v, 0);
    expect(Math.abs(sum(soft) - sum(hard)) / sum(hard)).toBeLessThan(0.01);
    expect(at(hard, cols, 10, 20)).toBe(1); // the input is untouched
  });
  it('invert: 1 - m', () => {
    const m = Float32Array.from([0, 0.25, 1]);
    expect(Array.from(invertMask(m))).toEqual([1, 0.75, 0]);
  });
  it('the outline (marching squares at 0.5) runs around a rectangle', () => {
    const segs = maskOutline(rectMask(6, 5, 1, 1, 3, 2), 6, 5);
    expect(segs.length).toBeGreaterThan(0);
    const xs = segs.flatMap((s) => [s[0], s[2]]), ys = segs.flatMap((s) => [s[1], s[3]]);
    // image pixel coordinates (row 0 = the top): pixels 1..3 across, rows 1..2 up from the bottom = image rows 2..3
    expect(Math.min(...xs)).toBeCloseTo(1, 9); expect(Math.max(...xs)).toBeCloseTo(4, 9);
    expect(Math.min(...ys)).toBeCloseTo(2, 9); expect(Math.max(...ys)).toBeCloseTo(4, 9);
  });
});

/** A stand-in for the browser's SVG renderer that reads the SAME prepared SVG the real one gets: each <rect> through the
 *  matrix of its <g> ancestors, filled at the image pixel centres (x + 0.5, y + 0.5). */
function rectRenderer(svg, w, h) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const out = new Uint8ClampedArray(w * h * 4);
  const parse = (t) => { const m = /matrix\(([^)]+)\)/.exec(t || ''); return m ? m[1].trim().split(/[\s,]+/).map(Number) : [1, 0, 0, 1, 0, 0]; };
  const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
  for (const r of doc.querySelectorAll('rect')) {
    let M = [1, 0, 0, 1, 0, 0];
    for (let n = r.parentNode; n && n.getAttribute; n = n.parentNode) M = mul(parse(n.getAttribute('transform')), M);
    const x = +r.getAttribute('x'), y = +r.getAttribute('y'), rw = +r.getAttribute('width'), rh = +r.getAttribute('height');
    const P2 = [[x, y], [x + rw, y], [x + rw, y + rh], [x, y + rh]].map(([a, b]) => [M[0] * a + M[2] * b + M[4], M[1] * a + M[3] * b + M[5]]);
    const m = lassoMask(w, h, P2.map(([a, b]) => [a - 0.5, h - 1 - (b - 0.5)])); // lasso takes raster (row-up) pixel centres
    for (let rr = 0; rr < h; rr++) for (let c = 0; c < w; c++) if (m[rr * w + c]) out[((h - 1 - rr) * w + c) * 4 + 3] = 255;
  }
  return out;
}
describe('from an SVG shape: rasterised into the patch\'s pixel frame', () => {
  const board = { widthIn: 4, heightIn: 4 };
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect x="1.5" y="1.75" width="0.5" height="0.25" fill="none" stroke="#000"/></svg>';
  const rec = (rot) => ({ id: 'p', position: { x: 0, y: 0 }, rotation: rot, sizeIn: { w: 2, h: 1 }, raster: { cols: 200, rows: 100, h: 'x' } });
  it('a known rect (board X -0.5..0, Y 0..0.25) masks pixels c 50..99, r 50..74 of an unturned 2 x 1 in patch', async () => {
    const m = await maskFromSvg(svg, rec(0), board, { render: rectRenderer });
    expect(count(m)).toBe(50 * 25);
    expect(at(m, 200, 50, 50)).toBe(1); expect(at(m, 200, 99, 74)).toBe(1);
    expect(at(m, 200, 49, 60)).toBe(0); expect(at(m, 200, 100, 60)).toBe(0); expect(at(m, 200, 70, 75)).toBe(0); expect(at(m, 200, 70, 49)).toBe(0);
  });
  it('turned 90 degrees: the same rect lands at c 100..124, r 50..99', async () => {
    const m = await maskFromSvg(svg, rec(90), board, { render: rectRenderer });
    expect(count(m)).toBe(25 * 50);
    expect(at(m, 200, 100, 50)).toBe(1); expect(at(m, 200, 124, 99)).toBe(1);
    expect(at(m, 200, 99, 70)).toBe(0); expect(at(m, 200, 125, 70)).toBe(0); expect(at(m, 200, 110, 49)).toBe(0);
  });
  it('the matrix maps an editor point onto the image pixel the patch frame says', () => {
    const M = patchPixelMatrix(rec(0), board); // editor (2, 2) = the board centre = the patch centre
    expect(M[0] * 2 + M[2] * 2 + M[4]).toBeCloseTo(100, 9);
    expect(M[1] * 2 + M[3] * 2 + M[5]).toBeCloseTo(50, 9);
  });
});

describe('the tools multiply by the mask', () => {
  it('a brush dab: outside the mask nothing changes (exactly), inside it paints as before', () => {
    const cols = 60, rows = 20, mask = rectMask(cols, rows, 0, 0, 29, 19);
    const a = { cols, rows, data: new Float32Array(cols * rows) }, b = { cols, rows, data: new Float32Array(cols * rows) };
    const brush = { ...BRUSH_DEFAULTS, sizeIn: 0.4, hardness: 1, amountIn: 0.1 };
    for (const [r, m] of [[a, mask], [b, null]]) { const s = createStroke(r, brush, { pxPerInX: 100, pxPerInY: 100, mask: m }); s.addPoint(30, 10); }
    for (let k = 0; k < cols * rows; k++) {
      if (mask[k]) expect(a.data[k]).toBe(b.data[k]); else expect(a.data[k]).toBe(0);
    }
    expect(b.data[10 * cols + 35]).toBeGreaterThan(0);
  });
});

describe('the panel: selection state per patch (not saved), the brush inside it', () => {
  const saved = {};
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    Object.assign(saved, { hl: P.heightLayers, w: P.widthIn, h: P.heightIn });
    P.widthIn = 2; P.heightIn = 2; P.heightLayers = DEFAULT.heightLayers;
    document.body.innerHTML = '<div id="heightPanelBody"></div><div id="editorToolbarHeight"></div>';
    _resetHeightPanelForTests();
    window.svgEditor = { _undoStack: [], pushState() { this._undoStack.push({}); }, _notifyChange() {} };
    initHeightPanel({});
  });
  afterEach(() => { P.heightLayers = saved.hl; P.widthIn = saved.w; P.heightIn = saved.h; delete window.svgEditor; vi.useRealTimers(); });

  it('a rectangle selection (board inches), then a stroke across it: only inside changes; the record never holds it', async () => {
    await newHeightPatch(); // 200 x 200 px over the 2 x 2 in board
    selectHeightRect([-1, -1], [0, 1]); // the left half
    const sel = heightSelection();
    expect(sel.cols).toBe(200);
    expect(count(sel.mask)).toBe(100 * 200);
    await paintHeightStroke([[-0.5, 0], [0.5, 0]], { mode: 'raise', sizeIn: 0.3, hardness: 1, amountIn: 0.1 });
    const d = decodedRaster(activeHeightLayer().raster);
    expect(at(d, 200, 50, 100)).toBeGreaterThan(0.09);
    expect(at(d, 200, 150, 100)).toBe(0);
    for (let r = 0; r < 200; r++) for (let c = 100; c < 200; c++) if (d[r * 200 + c] !== 0) throw new Error(`painted outside at ${c},${r}`);
    expect(JSON.stringify(P.heightLayers)).not.toMatch(/mask|selection/);
    expect(JSON.stringify(persistableP().heightLayers)).not.toMatch(/mask|selection/);
  });
  it('ellipse, lasso, invert, feather, clear', async () => {
    await newHeightPatch();
    selectHeightEllipse([-1, -1], [1, 1]);
    expect(at(heightSelection().mask, 200, 100, 100)).toBe(1);
    expect(at(heightSelection().mask, 200, 1, 1)).toBe(0);
    invertHeightSelection();
    expect(at(heightSelection().mask, 200, 100, 100)).toBe(0);
    expect(at(heightSelection().mask, 200, 1, 1)).toBe(1);
    selectHeightLasso([[-1, -1], [1, -1], [-1, 1]]);
    expect(at(heightSelection().mask, 200, 20, 20)).toBe(1);
    expect(at(heightSelection().mask, 200, 180, 180)).toBe(0);
    featherHeightSelection(0.05);
    const m = heightSelection().mask;
    expect(m.some((v) => v > 0.05 && v < 0.95)).toBe(true);
    clearHeightSelection();
    expect(heightSelection()).toBeNull();
  });
  it('from an SVG shape of the Draw tab, via the panel', async () => {
    await newHeightPatch();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect x="0.5" y="0.5" width="0.5" height="0.5"/></svg>';
    await selectHeightFromSvg(svg, { render: rectRenderer });
    const m = heightSelection().mask;
    expect(count(m)).toBe(50 * 50);
    expect(at(m, 200, 50, 100)).toBe(1); // board X -0.5, Y 0 .. 0.5 -> c 50..99, r 100..149
    expect(at(m, 200, 50, 99)).toBe(0);
  });
});

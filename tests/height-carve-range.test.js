/**
 * HEIGHT-PAINTER slice 5 (Fred 2026-11-23: "with carving we need a warning about the surface thickness"): DETECTION ONLY.
 * ONE overshoot function, core/stock.js stockOvershoot (the STL stock check's, moved to a neutral module; core/stl/stock.js
 * re-exports it under its old names, so the STL card is unchanged): over the points a mask covers (null = every point), how
 * many leave the stock 0..carveZ and the worst over / under, plus the lowest and highest heights. rebuild.js reports, after
 * each heights build, each HEIGHT PATCH (its footprint) and the WHOLE BOARD (every point); the Height panel shows them in one
 * line (#heightCarveRange) in stlStockMessage's wording.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { stockOvershoot, stockMessage, stockReport, setHeightStockReport } from '../bspline-frame-builder/b-spline-gen/html/core/stock.js';
import { stlStockOvershoot, stlStockMessage } from '../bspline-frame-builder/b-spline-gen/html/core/stl/stock.js';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { initHeightPanel, newHeightPatch, activeHeightLayer, _resetHeightPanelForTests } from '../bspline-frame-builder/b-spline-gen/html/main/height-panel.js';

describe('core/stock.js: the one overshoot function', () => {
  it('the STL names are the same functions (the STL card unchanged)', () => {
    expect(stlStockOvershoot).toBe(stockOvershoot);
    expect(stlStockMessage({ count: 2, maxOver: 0.1, maxUnder: 0, carveZ: 1.5 })).toBe('⚠ This STL rises 0.10 in above the stock top (Carve Depth 1.50 in) at 2 points.');
  });
  it('covered null = the whole board; the lowest and highest heights come with it', () => {
    const o = stockOvershoot(Float32Array.from([-0.04, 0.7, 1.2]), null, 1.5);
    expect(o).toMatchObject({ count: 1, maxOver: 0, min: Math.fround(-0.04), max: Math.fround(1.2) });
    expect(o.maxUnder).toBeCloseTo(0.04, 6);
    expect(stockMessage({ ...o, carveZ: 1.5 }, 'The board')).toBe('⚠ The board cuts 0.04 in below the stock bottom (Carve Depth 1.50 in) at 1 point.');
  });
  it('stockReport: one entry per pass of a kind, keyed by its record id (the height patches: kind height)', () => {
    const passes = [{ kind: 'height', id: 'height:p1', mask: { isStamped: Uint8Array.from([0, 1, 1]) } }, { kind: 'stl', id: 'stl:s1', mask: { isStamped: Uint8Array.from([1, 0, 0]) } }];
    const rep = stockReport(passes, Float32Array.from([-0.5, 1.6, 0.4]), 1.5, 'height');
    expect(Object.keys(rep)).toEqual(['p1']);
    expect(rep.p1).toMatchObject({ count: 1, carveZ: 1.5, min: Math.fround(0.4), max: Math.fround(1.6) });
  });
});

describe('the Height panel: the board and the active patch, one line, after every build', () => {
  const saved = {};
  beforeEach(() => {
    Object.assign(saved, { hl: P.heightLayers, cz: P.carveZ });
    P.heightLayers = DEFAULT.heightLayers; P.carveZ = 1.5;
    document.body.innerHTML = '<div id="heightPanelBody"></div><div id="editorToolbarHeight"></div>';
    _resetHeightPanelForTests();
    window.svgEditor = { _undoStack: [], pushState() {}, _notifyChange() {} };
    setHeightStockReport(null);
    initHeightPanel({});
  });
  afterEach(() => { P.heightLayers = saved.hl; P.carveZ = saved.cz; setHeightStockReport(null); delete window.svgEditor; });
  const el = () => document.getElementById('heightCarveRange');
  it('inside: the plain readout; the board below the floor: the warning; a patch over the top: its warning too', async () => {
    expect(el().hidden).toBe(true); // no build yet
    const board = (min, max, count = 0, maxOver = 0, maxUnder = 0) => ({ count, maxOver, maxUnder, min, max, carveZ: 1.5 });
    setHeightStockReport({ board: board(0.06, 1.38), patches: {} });
    expect(el().hidden).toBe(false);
    expect(el().textContent).toBe('Deepest point 0.06 in above the carve floor / highest 0.12 in under the stock top');
    expect(el().classList.contains('stl-error')).toBe(false);
    setHeightStockReport({ board: board(-0.04, 1.2, 3, 0, 0.04), patches: {} });
    expect(el().textContent).toBe('⚠ The board cuts 0.04 in below the stock bottom (Carve Depth 1.50 in) at 3 points.');
    expect(el().classList.contains('stl-error')).toBe(true);
    await newHeightPatch();
    const id = activeHeightLayer().id;
    setHeightStockReport({ board: board(0.06, 1.38), patches: { [id]: board(0.3, 1.53, 7, 0.03, 0) } });
    expect(el().textContent).toBe('Deepest point 0.06 in above the carve floor / highest 0.12 in under the stock top. ⚠ This patch rises 0.03 in above the stock top (Carve Depth 1.50 in) at 7 points.');
    expect(el().classList.contains('stl-error')).toBe(true);
  });
});

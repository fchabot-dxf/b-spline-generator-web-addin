/**
 * STL-RELIEF, Fred 2026-11-22: (1) a WARNING when an STL takes the surface past the stock (detection only: nothing is changed,
 * blocked or clamped) and a 'Fit to carve depth' button; (2) fitting at insert is an OPTION (P.stlFitOnInsert), default off.
 *
 * The stock's bounds are the sculpt check's own (core/sculpt.js checkPreBounds): a height z is OVER when z > P.carveZ (the stock
 * top, Board > Carve Depth) and UNDER when z < 0 (the stock bottom). Real meshes (createStlLayer), the real pass (stlPass), the
 * real applyStampLayers and the real rebuild.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { P, DEFAULT, setLastResult, lastResult } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { createStlLayer, stlPass, _resetStlCachesForTests } from '../bspline-frame-builder/b-spline-gen/html/core/stl/layer.js';
import { applyStampLayers } from '../bspline-frame-builder/b-spline-gen/html/core/engine/apply-stamp-layers.js';
import { rebuild, _forgetHeights, REBUILD_INERT_KEYS } from '../bspline-frame-builder/b-spline-gen/html/core/engine/rebuild.js';
import { resolveGrid } from '../bspline-frame-builder/b-spline-gen/html/core/terrain.js';
import { checkPreBounds } from '../bspline-frame-builder/b-spline-gen/html/core/sculpt.js';
import { sampleGridAt } from '../bspline-frame-builder/b-spline-gen/html/core/stl/ghost.js';
import {
  stlStockOvershoot, stlStockReport, getStlStockReport, stlStockMessage, fitStlDepth, solveStlDepth,
} from '../bspline-frame-builder/b-spline-gen/html/core/stl/stock.js';
import { globalHistoryLog, globalRedoLog } from '../bspline-frame-builder/b-spline-gen/html/core/history.js';
import {
  renderStlPanel, bindStlPanel, addStlFromSoup, activeStlLayer, setStlField, fitStlToCarveDepth, _resetStlPanelForTests,
} from '../bspline-frame-builder/b-spline-gen/html/main/stl-panel.js';

const tri = (a, b, c) => [...a, ...b, ...c];
/** A closed square pyramid over [-5,5]^2 at z = 0, apex (0, 0, 4). */
function pyramid() {
  const A = [-5, -5, 0], B = [5, -5, 0], C = [5, 5, 0], D = [-5, 5, 0], T = [0, 0, 4];
  return Float32Array.from([tri(A, B, T), tri(B, C, T), tri(C, D, T), tri(D, A, T), tri(A, C, B), tri(A, D, C)].flat());
}
// a 7 x 9 in board at 0.1 in: the board centre (0, 0) is grid point (35, 45)
const GRID = { nx: 71, nz: 91, widthIn: 7, heightIn: 9 };
const N = GRID.nx * GRID.nz;
const FLAT = (z) => new Float32Array(N).fill(z);
/** A gentle slope: z = 0.3 + 0.004 i + 0.002 j (0.3 .. 0.76 in). */
const SLOPE = () => Float32Array.from({ length: N }, (_, k) => 0.3 + 0.004 * (k % GRID.nx) + 0.002 * Math.floor(k / GRID.nx));
/** unitIn 0.2: the pyramid is 2 in wide and 0.8 in tall at Depth 1 (its apex is ON the centre grid point: body 1 there). */
function record(extra = {}) {
  const { record: r } = createStlLayer({ soup: pyramid(), name: 'pyr', board: { widthIn: 7, heightIn: 9 } });
  return { ...r, id: 'pyr', unitIn: 0.2, ...extra };
}
const stamp = (rec, clean) => applyStampLayers(clean, [stlPass(rec, GRID)], GRID.nx, GRID.nz);
/** The stamped surface's highest / lowest value over the points the STL covers. */
function coveredExtremes(rec, clean) {
  const h = stamp(rec, clean), cov = stlPass(rec, GRID).mask.isStamped;
  let hi = -Infinity, lo = Infinity;
  for (let k = 0; k < N; k++) if (cov[k]) { hi = Math.max(hi, h[k]); lo = Math.min(lo, h[k]); }
  return { hi, lo };
}
const CARVE = 1.5;

beforeEach(() => _resetStlCachesForTests());
afterEach(() => _resetStlCachesForTests());

describe('the over-stock numbers (detection only), the sculpt check\'s bounds', () => {
  it('a raised pyramid 1.6 in tall on a 0.5 in flat terrain, Carve Depth 1.5: 49 points, 0.60 in above the top', () => {
    const rec = record({ zScale: 2 }); // 1.6 in: over where 0.5 + 1.6 (1 - r) > 1.5, r < 0.375 in -> a 7 x 7 block of points
    const pass = stlPass(rec, GRID);
    const h = applyStampLayers(FLAT(0.5), [pass], GRID.nx, GRID.nz);
    const o = stlStockOvershoot(h, pass.mask.isStamped, CARVE);
    expect(o.count).toBe(49);
    expect(o.maxOver).toBeCloseTo(0.6, 4); // the stored mesh is quantised (core/stl/mesh.js encodeMesh)
    expect(o.maxUnder).toBe(0);
    const rep = stlStockReport([pass], h, CARVE);
    expect(Object.keys(rep)).toEqual(['pyr']);
    expect(rep.pyr).toMatchObject({ count: 49, maxUnder: 0, carveZ: CARVE });
    expect(stlStockMessage(rep.pyr)).toBe('⚠ This STL rises 0.60 in above the stock top (Carve Depth 1.50 in) at 49 points.');
  });
  it('a carved pyramid 0.8 in deep on a 0.5 in flat terrain: 49 points, 0.30 in below the bottom', () => {
    const pass = stlPass(record({ raise: false }), GRID);
    const h = applyStampLayers(FLAT(0.5), [pass], GRID.nx, GRID.nz);
    const rep = stlStockReport([pass], h, CARVE);
    expect(rep.pyr.count).toBe(49);
    expect(rep.pyr.maxUnder).toBeCloseTo(0.3, 4);
    expect(rep.pyr.maxOver).toBe(0);
    expect(stlStockMessage(rep.pyr)).toBe('⚠ This STL cuts 0.30 in below the stock bottom (Carve Depth 1.50 in) at 49 points.');
  });
  it('inside the stock: no point, no message', () => {
    const pass = stlPass(record({ zScale: 0.5 }), GRID); // 0.5 + 0.4 = 0.9 < 1.5
    const rep = stlStockReport([pass], applyStampLayers(FLAT(0.5), [pass], GRID.nx, GRID.nz), CARVE);
    expect(rep.pyr).toMatchObject({ count: 0, maxOver: 0, maxUnder: 0 });
    expect(stlStockMessage(rep.pyr)).toBe('');
  });
  it('only the points the STL covers count (the terrain past the stock elsewhere is not this STL\'s)', () => {
    const clean = FLAT(0.5); clean[0] = 3; // a far corner above the stock top
    const pass = stlPass(record({ zScale: 0.5 }), GRID);
    expect(pass.mask.isStamped[0]).toBe(0);
    expect(stlStockReport([pass], applyStampLayers(clean, [pass], GRID.nx, GRID.nz), CARVE).pyr.count).toBe(0);
  });
});

describe('the real rebuild computes the report from its own heights + passes (no second rebuild)', () => {
  const saved = {};
  const setP = (k, v) => { if (!(k in saved)) saved[k] = P[k]; P[k] = v; };
  afterEach(() => { for (const [k, v] of Object.entries(saved)) P[k] = v; for (const k of Object.keys(saved)) delete saved[k]; _forgetHeights(); });
  it('a tall STL on the real terrain: the count and overshoot equal checkPreBounds over its covered points of lastResult.heights', async () => {
    setP('widthIn', 7); setP('heightIn', 9); setP('spacing', 0.1); setP('carveZ', 1.5);
    setP('stlLayers', [record({ zScale: 4 })]); // 3.2 in tall: past the top
    _forgetHeights();
    await rebuild(null, () => {}, () => {});
    const { nx, nz } = resolveGrid(7, 9, 0.1);
    const cov = stlPass(P.stlLayers[0], { nx, nz, widthIn: 7, heightIn: 9 }).mask.isStamped;
    const sub = [], zero = [];
    for (let k = 0; k < nx * nz; k++) if (cov[k]) { sub.push(lastResult.heights[k]); zero.push(0); }
    const ref = checkPreBounds(Float32Array.from(sub), Float32Array.from(zero), sub.length, 1, 1.5);
    const rep = getStlStockReport().pyr;
    expect(ref.count).toBeGreaterThan(0);
    expect(rep.count).toBe(ref.count);
    expect(rep.maxOver).toBeCloseTo(ref.maxOver, 9);
    expect(rep.maxUnder).toBeCloseTo(ref.maxUnder, 9);
  }, 60000);
});

describe('fitStlDepth: the one rule (Depth so the stamp fits inside the stock)', () => {
  const fit = (rec, clean) => fitStlDepth(stlPass(rec, GRID), clean, GRID.nx, GRID.nz, CARVE, Math.abs(stlPass(rec, GRID).depth));
  it('Raised, follow, flat 0.5: Depth 1.25 (0.5 + 0.8 x 1.25 = 1.5); with Z 0.2: Depth 1.0', () => {
    expect(fit(record(), FLAT(0.5)).zScale).toBeCloseTo(1.25, 4);
    expect(fit(record({ position: { x: 0, y: 0, z: 0.2 } }), FLAT(0.5)).zScale).toBeCloseTo(1.0, 4);
  });
  for (const blend of ['max', 'add']) {
    it(`Raised, follow, slope (${blend}): after the fit the stamp peaks exactly at the stock top`, () => {
      const rec = record({ blend, position: { x: 0.7, y: -1.1, z: 0.05 } });
      const f = fit(rec, SLOPE());
      expect(f.zScale).toBeGreaterThan(0);
      expect(coveredExtremes({ ...rec, zScale: f.zScale }, SLOPE()).hi).toBeCloseTo(CARVE, 4);
      const pass = stlPass({ ...rec, zScale: f.zScale }, GRID); // and the warning (exact bounds) does not fire on rounding
      expect(stlStockOvershoot(stamp({ ...rec, zScale: f.zScale }, SLOPE()), pass.mask.isStamped, CARVE).count).toBe(0);
    });
    it(`Carved, follow, slope (${blend}): its deepest cut reaches exactly the stock bottom`, () => {
      const rec = record({ blend, raise: false, position: { x: -0.4, y: 2, z: 0 } });
      const f = fit(rec, SLOPE());
      expect(coveredExtremes({ ...rec, zScale: f.zScale }, SLOPE()).lo).toBeCloseTo(0, 4);
      const pass = stlPass({ ...rec, zScale: f.zScale }, GRID);
      expect(stlStockOvershoot(stamp({ ...rec, zScale: f.zScale }, SLOPE()), pass.mask.isStamped, CARVE).count).toBe(0);
    });
  }
  it('Carved, follow, flat 0.5: Depth 0.625', () => {
    expect(fit(record({ raise: false }), FLAT(0.5)).zScale).toBeCloseTo(0.625, 4);
  });
  it('Level (Raised): the level base (the terrain under its centre) + Z + its height = the top', () => {
    const rec = record({ surface: 'level', blend: 'add', position: { x: 0.7, y: -1.1, z: 0.1 } });
    const pass = stlPass(rec, GRID);
    const B = sampleGridAt(SLOPE(), GRID.nx, GRID.nz, pass.pivot[0], pass.pivot[1]);
    const f = fit(rec, SLOPE());
    expect(f.zScale).toBeCloseTo((CARVE - B - 0.1) / 0.8, 4); // body 1 at the apex: on a grid point here (x 0.7, y -1.1)
    expect(coveredExtremes({ ...rec, zScale: f.zScale }, SLOPE()).hi).toBeCloseTo(CARVE, 4);
  });
  it('Level (Carved): the level base - Z - its depth = the bottom', () => {
    const rec = record({ surface: 'level', blend: 'add', raise: false, position: { x: 0.7, y: -1.1, z: 0.1 } });
    const pass = stlPass(rec, GRID);
    const B = sampleGridAt(SLOPE(), GRID.nx, GRID.nz, pass.pivot[0], pass.pivot[1]);
    const f = fit(rec, SLOPE());
    expect(f.zScale).toBeCloseTo((B - 0.1) / 0.8, 4);
    expect(coveredExtremes({ ...rec, zScale: f.zScale }, SLOPE()).lo).toBeCloseTo(0, 4);
  });
  it('no room: the terrain under it already reaches the bound, or the Z offset alone does', () => {
    expect(fit(record(), FLAT(1.6))).toEqual({ reason: 'terrain' });
    expect(fit(record({ position: { x: 0, y: 0, z: 1.2 } }), FLAT(0.5))).toEqual({ reason: 'zOffset' });
    expect(fit(record({ raise: false }), FLAT(0))).toEqual({ reason: 'terrain' });
    expect(fit(record({ raise: false, position: { x: 0, y: 0, z: 0.6 } }), FLAT(0.5))).toEqual({ reason: 'zOffset' });
  });
});

// ── the panel: the warning line, the button, the option ───────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const saved = {};
const setP = (k, v) => { if (!(k in saved)) saved[k] = P[k]; P[k] = v; };
let savedResult;
function panelBoard() {
  setP('widthIn', 7); setP('heightIn', 9); setP('spacing', 0.1); setP('carveZ', 1.5);
  setP('stlLayers', DEFAULT.stlLayers);
  document.body.innerHTML = '<div id="stlLayerBody"></div>';
  _resetStlPanelForTests();
  renderStlPanel($('stlLayerBody'));
  bindStlPanel({ onChange: () => {}, refreshGhosts: () => {} });
  const { nx, nz } = resolveGrid(7, 9, 0.1);
  setLastResult({ cleanHeights: FLAT(0.5), heights: FLAT(0.5), nx, nz }); // the built surface the fit reads
  return { nx, nz };
}
beforeEach(() => { savedResult = lastResult; globalHistoryLog.length = 0; globalRedoLog.length = 0; });
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) P[k] = v; for (const k of Object.keys(saved)) delete saved[k];
  setLastResult(savedResult);
  DEFAULT.stlLayers.length = 0;
  globalHistoryLog.length = 0; globalRedoLog.length = 0;
  vi.useRealTimers();
});
const peakAfter = (rec) => {
  const { nx, nz } = resolveGrid(7, 9, 0.1);
  const g = { nx, nz, widthIn: 7, heightIn: 9 };
  const h = applyStampLayers(FLAT(0.5), [stlPass(rec, g)], nx, nz), cov = stlPass(rec, g).mask.isStamped;
  let hi = -Infinity; for (let k = 0; k < h.length; k++) if (cov[k]) hi = Math.max(hi, h[k]);
  return hi;
};

describe('the Fit to carve depth button', () => {
  it('writes ONLY zScale into a NEW record (copy-on-write, DEFAULT untouched), one undo step; the stamp then peaks at the top', () => {
    vi.useFakeTimers();
    panelBoard();
    const defaultsBefore = JSON.stringify(DEFAULT);
    addStlFromSoup(pyramid(), 'pyr');
    vi.advanceTimersByTime(500);
    const before = activeStlLayer(), list = P.stlLayers, nSnaps = globalHistoryLog.length;
    expect($('stlFit')).toBeTruthy();
    $('stlFit').click();
    vi.advanceTimersByTime(500);
    const after = activeStlLayer();
    expect(after).not.toBe(before);
    expect(P.stlLayers).not.toBe(list);
    expect(before.zScale).toBe(1); // the old record is untouched
    const { zScale, ...rest } = after, { zScale: z0, ...restBefore } = before;
    expect(rest).toEqual(restBefore);
    expect(zScale).not.toBe(1);
    expect(peakAfter(after)).toBeCloseTo(1.5, 4);
    expect(globalHistoryLog.length).toBe(nSnaps + 1);
    expect(JSON.stringify(DEFAULT)).toBe(defaultsBefore);
  });
  it('no room: nothing changes and the status line says why', () => {
    panelBoard();
    addStlFromSoup(pyramid(), 'pyr');
    setStlField('posZ', 1.2); // 0.5 + 1.2 already past 1.5
    const before = activeStlLayer();
    expect(fitStlToCarveDepth()).toBe(false);
    expect(activeStlLayer()).toBe(before);
    expect($('stlStatus').hidden).toBe(false);
    expect($('stlStatus').textContent).toMatch(/Z offset/);
  });
  it('the warning line shows the active STL\'s numbers after a real rebuild, and goes once it fits', async () => {
    panelBoard();
    _forgetHeights();
    addStlFromSoup(pyramid(), 'pyr');
    setStlField('zScale', 4);
    await rebuild(null, () => {}, () => {});
    expect($('stlStock').hidden).toBe(false);
    expect($('stlStock').textContent).toMatch(/^⚠ This STL rises \d+\.\d\d in above the stock top \(Carve Depth 1\.50 in\) at \d+ points\.$/);
    $('stlFit').click(); // fitted to the real terrain the build just made
    await rebuild(null, () => {}, () => {});
    expect($('stlStock').hidden).toBe(true);
    expect($('stlStock').textContent).toBe('');
    _forgetHeights();
  }, 60000);
});

// FIX-X 2026-11-22: after a crop with the crop-edge falloff on, the Fit overshot several times (SMK KAS1996 cropped, falloff
// 0.6 in: Depth 26 = a 3.7 in wall on a 0.9 in stock). The falloff's 'bottom' edge fades by the height in INCHES, so the stamp is
// not linear in the Depth; the one-step fit read the crushed body at Depth 1.
describe('Fit to carve depth after a crop with the crop-edge falloff (the stamp is not linear in the Depth)', () => {
  const lowPeak = (rec) => { // the stamped surface's lowest point over the covered points (Carved)
    const { nx, nz } = resolveGrid(7, 9, 0.1);
    const g = { nx, nz, widthIn: 7, heightIn: 9 };
    const h = applyStampLayers(FLAT(0.5), [stlPass(rec, g)], nx, nz), cov = stlPass(rec, g).mask.isStamped;
    let lo = Infinity; for (let k = 0; k < h.length; k++) if (cov[k]) lo = Math.min(lo, h[k]);
    return lo;
  };
  /** The pyramid inserted CROPPED by the real insert path (cropMesh: x from 30 %, z from 25 % = a capped two-plane cut), made a
   *  0.21 in relief at Depth 1 (inside the 0.6 in fade), then the falloff on through the panel's own controls. */
  function croppedLowRelief(raise) {
    panelBoard();
    const rec = addStlFromSoup(pyramid(), 'pyr', { crop: { x: [0.3, 1], z: [0.25, 1] } });
    expect(rec.crop && rec.crop.capped).toBeGreaterThan(0);
    expect(setStlField('scale', 0.15)).toBe(true);
    if (!raise) expect(setStlField('raise', false)).toBe(true);
    expect(setStlField('cropFalloffWidth', 0.6)).toBe(true);
    return activeStlLayer();
  }
  it('Raised: after the Fit the cropped, faded relief peaks AT the stock top (it overshot to 6.1 in before)', () => {
    const before = croppedLowRelief(true);
    expect(before.cropFalloff.widthIn).toBe(0.6);
    expect(fitStlToCarveDepth()).toBe(true);
    const after = activeStlLayer();
    expect(peakAfter(after)).toBeCloseTo(1.5, 4);
    const { nx, nz } = resolveGrid(7, 9, 0.1), g = { nx, nz, widthIn: 7, heightIn: 9 };
    const pass = stlPass(after, g);
    expect(stlStockOvershoot(applyStampLayers(FLAT(0.5), [pass], nx, nz), pass.mask.isStamped, 1.5).count).toBe(0);
  });
  it('Carved: the deepest cut of the cropped, faded relief reaches the stock bottom exactly', () => {
    const before = croppedLowRelief(false);
    expect(before.raise).toBe(false);
    expect(fitStlToCarveDepth()).toBe(true);
    expect(lowPeak(activeStlLayer())).toBeCloseTo(0, 4);
  });
  it('a linear stamp (no falloff): the solve returns the one-step fit unchanged (no behaviour change there)', () => {
    const rec = record({ blend: 'max', position: { x: 0.7, y: -1.1, z: 0.05 } });
    const one = fitStlDepth(stlPass(rec, GRID), SLOPE(), GRID.nx, GRID.nz, CARVE, Math.abs(stlPass(rec, GRID).depth));
    const solved = solveStlDepth((s) => stlPass({ ...rec, zScale: s }, GRID), 1, SLOPE(), GRID.nx, GRID.nz, CARVE);
    expect(solved.zScale).toBe(one.zScale);
  });
});

describe('the option: Fit new Meshes to the carve depth (P.stlFitOnInsert)', () => {
  it('is declared false in DEFAULT (absent on a saved board = off), never read by a build', () => {
    expect(DEFAULT.stlFitOnInsert).toBe(false);
    expect(REBUILD_INERT_KEYS.has('stlFitOnInsert')).toBe(true);
  });
  it('the panel shows it as a checkbox with the P key as its id (the generic P-key binding, main/ui-bindings.js bindControls)', () => {
    panelBoard();
    const box = $('stlFitOnInsert');
    expect(box && box.type).toBe('checkbox');
    expect(box.closest('label').textContent).toBe('Fit new Meshes to the carve depth');
  });
  it('off: a new STL is added as it is (Depth 1)', () => {
    panelBoard();
    setP('stlFitOnInsert', false);
    expect(addStlFromSoup(pyramid(), 'pyr').zScale).toBe(1);
  });
  it('on: a new STL is fitted once (its peak at the stock top), in the same single undo step as the add', () => {
    vi.useFakeTimers();
    panelBoard();
    setP('stlFitOnInsert', true);
    const rec = addStlFromSoup(pyramid(), 'pyr');
    vi.advanceTimersByTime(500);
    expect(rec.zScale).not.toBe(1);
    expect(activeStlLayer()).toBe(rec);
    expect(peakAfter(rec)).toBeCloseTo(1.5, 4);
    expect(globalHistoryLog.length).toBe(1);
  });
});

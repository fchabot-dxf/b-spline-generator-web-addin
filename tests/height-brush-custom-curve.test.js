/**
 * HEIGHT-PAINTER (Fred 2026-11-22: "a small widget can allow to design custom falloff"): the 'custom' falloff profile is a
 * curve through the user's control points (t = 0 at the hardness edge .. 1 at the rim, value = the falloff there), drawn as a
 * monotone cubic Hermite (no overshoot between points). It MAY rise across points (a ring / crater). The panel's 'customCurve'
 * control (declared kind 'curve') edits the points: drag, tap to add, double-click / long-press to remove.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  brushFalloff, BRUSH_FALLOFFS, BRUSH_DEFAULTS, createStroke, curveFromPoints, curvePointsFromProfile,
} from '../bspline-frame-builder/b-spline-gen/html/core/height/brush.js';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  HEIGHT_CONTROLS, initHeightPanel, heightBrush, setHeightField, syncHeightPanel, _resetHeightPanelForTests,
} from '../bspline-frame-builder/b-spline-gen/html/main/height-panel.js';

const RING = [[0, 0.2], [0.6, 1], [1, 0]];

// advisor 2026-11-22 (worker N's finding): inside the hard core the brush holds the CURVE's starting value, so a ring
// (low in the middle) stays a ring at any hardness -- no step at the core edge. Built-ins all start at 1: unchanged.
describe('the hard core holds the curve\'s starting value', () => {
  it('a custom ring: inside the core = curve(0) = 0.2, continuous at the core edge', () => {
    const f = curveFromPoints(RING);
    expect(brushFalloff(0, 1, 0.5, 'custom', f)).toBeCloseTo(0.2, 12);
    expect(brushFalloff(0.49999, 1, 0.5, 'custom', f)).toBeCloseTo(0.2, 12);
    expect(brushFalloff(0.50001, 1, 0.5, 'custom', f)).toBeCloseTo(0.2, 3);
  });
  it('every built-in profile still reads 1 inside the core', () => {
    for (const k of Object.keys(BRUSH_FALLOFFS).filter((k) => k !== 'custom')) expect(brushFalloff(0.1, 1, 0.5, k), k).toBe(1);
  });
});

describe('curveFromPoints', () => {
  it('passes exactly through every point', () => {
    const pts = [[0, 1], [0.3, 0.8], [0.7, 0.2], [1, 0]];
    const f = curveFromPoints(pts);
    for (const [t, v] of pts) expect(f(t)).toBeCloseTo(v, 12);
  });
  it('sorts its points by t', () => {
    expect(curveFromPoints([[1, 0], [0, 1], [0.5, 0.5]])(0.5)).toBeCloseTo(0.5, 12);
  });
  it('stays within [min, max] of the two points around it (no overshoot), also across a sharp bend', () => {
    const pts = [[0, 1], [0.1, 0.1], [0.5, 0.15], [0.9, 0.9], [1, 0.8]];
    const f = curveFromPoints(pts);
    for (let i = 0; i < pts.length - 1; i++) {
      const lo = Math.min(pts[i][1], pts[i + 1][1]) - 1e-9, hi = Math.max(pts[i][1], pts[i + 1][1]) + 1e-9;
      for (let k = 0; k <= 40; k++) {
        const t = pts[i][0] + ((pts[i + 1][0] - pts[i][0]) * k) / 40;
        expect(f(t), `seg ${i} k ${k}`).toBeGreaterThanOrEqual(lo);
        expect(f(t), `seg ${i} k ${k}`).toBeLessThanOrEqual(hi);
      }
    }
  });
  it('a rising middle point (a ring) is reproduced: the peak is higher than the start', () => {
    const f = curveFromPoints(RING);
    expect(f(0.6)).toBeCloseTo(1, 12);
    expect(f(0.6)).toBeGreaterThan(f(0));
    expect(f(0.3)).toBeGreaterThan(f(0));
  });
  it('outside 0..1 the end values hold', () => {
    const f = curveFromPoints(RING);
    expect(f(-3)).toBe(0.2);
    expect(f(7)).toBe(0);
  });
});

describe("BRUSH_FALLOFFS.custom and brushFalloff('custom')", () => {
  it('is declared (labelled, flagged custom) and the default curve is the straight line [[0,1],[1,0]]', () => {
    expect(BRUSH_FALLOFFS.custom).toMatchObject({ label: 'Custom', custom: true });
    expect(BRUSH_DEFAULTS.customCurve).toEqual([[0, 1], [1, 0]]);
  });
  it('equals curveFromPoints at the same t (hard core 0.2 R)', () => {
    const f = curveFromPoints(RING);
    // (t = 0 is the core's edge: inside the core the falloff is 1 whatever the curve says, as for every profile)
    for (const t of [0.1, 0.35, 0.6, 0.8, 1]) {
      expect(brushFalloff(0.2 + t * 0.8, 1, 0.2, 'custom', f)).toBeCloseTo(f(t), 12);
    }
  });
  it('with no custom curve it falls back to the default points', () => {
    const d = curveFromPoints(BRUSH_DEFAULTS.customCurve);
    expect(brushFalloff(0.6, 1, 0.2, 'custom')).toBeCloseTo(d(0.5), 12);
  });
  it('the built-in profiles do not move (the extra argument is ignored by them)', () => {
    const f = curveFromPoints(RING);
    for (const p of ['smooth', 'linear', 'dome', 'soft', 'spike', 'plateau']) {
      expect(brushFalloff(0.6, 1, 0.2, p, f), p).toBe(brushFalloff(0.6, 1, 0.2, p));
    }
    expect(brushFalloff(0.6, 1, 0.2, 'smooth')).toBeCloseTo(BRUSH_FALLOFFS.smooth.curve(0.5), 15);
  });
});

describe('curvePointsFromProfile', () => {
  it('samples the profile at n evenly spaced t, exactly', () => {
    const pts = curvePointsFromProfile('dome', 6);
    expect(pts).toHaveLength(6);
    pts.forEach(([t, v], i) => { expect(t).toBeCloseTo(i / 5, 12); expect(v).toBeCloseTo(BRUSH_FALLOFFS.dome.curve(i / 5), 12); });
  });
});

describe('a stroke with the custom ring curve', () => {
  it('paints a ring: a pixel at the ring peak is higher than the centre (hardness 0)', () => {
    const cols = 101, rows = 101, ppi = 100;
    const raster = { cols, rows, data: new Float32Array(cols * rows) };
    const b = { ...BRUSH_DEFAULTS, sizeIn: 0.8, hardness: 0, falloff: 'custom', customCurve: [[0, 0], [0.6, 1], [1, 0]], spacing: 0.5 };
    const s = createStroke(raster, b, { pxPerInX: ppi, pxPerInY: ppi });
    s.addPoint(50, 50, 1);
    // (the exact centre pixel is r = 0 <= core 0, which brushFalloff has always read as 1; one pixel beside it is the curve)
    const centre = raster.data[50 * cols + 52];
    const peak = raster.data[50 * cols + 50 + Math.round(0.6 * 0.4 * ppi)]; // t 0.6 of the 0.4 in radius
    expect(centre).toBeLessThan(0.01);
    expect(peak).toBeGreaterThan(0.045); // amountIn 0.05 x ~1
  });
});

// ── the panel control ──────────────────────────────────────────────────────────────────────────────────────────────
const NS = 'http://www.w3.org/2000/svg';
const ev = (type, x, y, extra = {}) => new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, ...extra });
const ptr = (type, x, y, extra = {}) => { const e = ev(type, x, y, extra); Object.defineProperty(e, 'pointerType', { value: extra.pointerType || 'mouse' }); Object.defineProperty(e, 'pointerId', { value: 1 }); return e; };
const svg = () => document.querySelector('#height_customCurve svg');
const handles = () => [...document.querySelectorAll('#height_customCurve [data-curve-handle]')];
const at = (h) => { const c = h.querySelector('circle:not([data-curve-hit])') || h.querySelector('circle'); return [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))]; };
function mountPanel() {
  document.body.innerHTML = '<div id="editorCanvasContainer"></div><div id="heightPanelBody"></div><div id="editorToolbarHeight"></div>';
  _resetHeightPanelForTests();
  initHeightPanel({});
  const s = svg();
  if (s) s.getBoundingClientRect = () => ({ left: 0, top: 0, width: 160, height: 100, right: 160, bottom: 100 });
  return s;
}
const saved = {};
beforeEach(() => { saved.hl = P.heightLayers; P.heightLayers = DEFAULT.heightLayers; });

describe("the panel's 'customCurve' control", () => {
  it('is declared right after falloff, kind curve, shown only when the falloff is custom', () => {
    const ids = HEIGHT_CONTROLS.map((c) => c.id);
    expect(ids[ids.indexOf('falloff') + 1]).toBe('customCurve');
    const c = HEIGHT_CONTROLS.find((x) => x.id === 'customCurve');
    expect(c).toMatchObject({ group: 'brush', target: 'brush', kind: 'curve', path: ['customCurve'] });
    expect(c.showWhen({ falloff: 'smooth' })).toBe(false);
    expect(c.showWhen({ falloff: 'custom' })).toBe(true);
  });
  it('is hidden until Custom is chosen, then draws one handle per point', () => {
    mountPanel();
    const box = document.querySelector('[data-height-control="customCurve"]');
    expect(box.hidden).toBe(true);
    setHeightField('falloff', 'custom');
    syncHeightPanel(); // what a click runs after the write
    expect(document.querySelector('[data-height-control="customCurve"]').hidden).toBe(false);
    expect(handles()).toHaveLength(heightBrush().customCurve.length);
    expect(svg().namespaceURI).toBe(NS);
  });
  function openCustom(points) {
    mountPanel();
    setHeightField('falloff', 'custom');
    setHeightField('customCurve', points);
    syncHeightPanel();
    return svg();
  }
  // Fred 2026-11-22 (asked: "Stop at the box (0 to 1)"): a drag far above the box stops at full strength. Fred 2026-11-23 (slice 5)
  // replaced the bottom: the brush's curve runs -1..1 (below 0 the brush paints the opposite), so far below stops at -1
  it('a drag past the top of the box stops at 1, past the bottom at -1', () => {
    const s = openCustom([[0, 1], [0.5, 0.5], [1, 0]]);
    let [x, y] = at(handles()[1]);
    handles()[1].dispatchEvent(ptr('pointerdown', x, y));
    s.dispatchEvent(ptr('pointermove', x, y - 500));
    s.dispatchEvent(ptr('pointerup', x, y - 500));
    expect(heightBrush().customCurve[1][1]).toBe(1);
    [x, y] = at(handles()[1]);
    handles()[1].dispatchEvent(ptr('pointerdown', x, y));
    s.dispatchEvent(ptr('pointermove', x, y + 500));
    s.dispatchEvent(ptr('pointerup', x, y + 500));
    expect(heightBrush().customCurve[1][1]).toBe(-1);
  });
  it('dragging the middle handle writes the curve once, on pointerup', () => {
    const s = openCustom([[0, 1], [0.5, 0.5], [1, 0]]);
    const mid = handles()[1];
    const [x, y] = at(mid);
    const before = heightBrush().customCurve;
    mid.dispatchEvent(ptr('pointerdown', x, y));
    s.dispatchEvent(ptr('pointermove', x + 10, y - 20));
    s.dispatchEvent(ptr('pointermove', x + 20, y - 30));
    expect(heightBrush().customCurve).toBe(before); // no write per tick
    expect(at(handles()[1])[1]).toBeLessThan(y);     // but the picture follows
    s.dispatchEvent(ptr('pointerup', x + 20, y - 30));
    const after = heightBrush().customCurve;
    expect(after).not.toBe(before);
    expect(after).toHaveLength(3);
    expect(after[1][1]).toBeGreaterThan(0.5);
    expect(after[1][0]).toBeGreaterThan(0.5);
    expect(after[0]).toEqual([0, 1]);
    expect(after[2]).toEqual([1, 0]);
  });
  it('an end handle moves vertically only (t stays 0 / 1)', () => {
    const s = openCustom([[0, 1], [0.5, 0.5], [1, 0]]);
    const end = handles()[2];
    const [x, y] = at(end);
    end.dispatchEvent(ptr('pointerdown', x, y));
    s.dispatchEvent(ptr('pointermove', x - 60, y - 30));
    s.dispatchEvent(ptr('pointerup', x - 60, y - 30));
    const c = heightBrush().customCurve;
    expect(c[2][0]).toBe(1);
    expect(c[2][1]).toBeGreaterThan(0);
  });
  it('a tap on empty area adds a point at that t', () => {
    const s = openCustom([[0, 1], [1, 0]]);
    const [x0] = at(handles()[0]), [x1] = at(handles()[1]);
    const x = x0 + (x1 - x0) * 0.5, y = 20;
    s.dispatchEvent(ptr('pointerdown', x, y));
    s.dispatchEvent(ptr('pointerup', x, y));
    const c = heightBrush().customCurve;
    expect(c).toHaveLength(3);
    expect(c[1][0]).toBeCloseTo(0.5, 2);
    expect(handles()).toHaveLength(3);
  });
  it('a double-click removes an interior point, never an end point', () => {
    openCustom([[0, 1], [0.5, 0.5], [1, 0]]);
    handles()[0].dispatchEvent(ev('dblclick', 0, 0));
    expect(heightBrush().customCurve).toHaveLength(3);
    handles()[2].dispatchEvent(ev('dblclick', 0, 0));
    expect(heightBrush().customCurve).toHaveLength(3);
    handles()[1].dispatchEvent(ev('dblclick', 0, 0));
    expect(heightBrush().customCurve).toEqual([[0, 1], [1, 0]]);
  });
  it('switching Falloff smooth -> custom (curve still the default) seeds it from smooth', () => {
    mountPanel();
    setHeightField('falloff', 'smooth');
    setHeightField('falloff', 'custom');
    expect(heightBrush().customCurve).toEqual(curvePointsFromProfile('smooth', 6));
    // an edited curve is never overwritten by a later switch
    setHeightField('customCurve', [[0, 1], [0.4, 0.9], [1, 0]]);
    setHeightField('falloff', 'linear');
    setHeightField('falloff', 'custom');
    expect(heightBrush().customCurve).toEqual([[0, 1], [0.4, 0.9], [1, 0]]);
  });
});

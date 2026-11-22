/**
 * HEIGHT-PAINTER slice 1: the dab engine (core/height/brush.js). Photoshop semantics (Fred 2026-11-22, the advisor's
 * amendment: "opacity 50% and value % are similar until they cross over each other"):
 *  - a dab's falloff: 1 inside hardness * R, a smoothstep roll-off to 0 at R;
 *  - a STROKE builds a stroke-level coverage buffer (flow * falloff per dab) that never exceeds the opacity, so scrubbing
 *    back and forth inside ONE stroke never goes past opacity x the effect;
 *  - a SECOND stroke starts from what is there: set moves toward the value by the opacity again, raise / lower stack;
 *  - 0 is transparent: erase goes to 0.
 * Pixel (c, r) has its centre at (c, r); sizes are inches (px per inch given per axis).
 */
import { describe, it, expect } from 'vitest';
import { brushFalloff, createStroke, BRUSH_DEFAULTS, BRUSH_MODES } from '../bspline-frame-builder/b-spline-gen/html/core/height/brush.js';

const PPI = 100;
const raster = (cols = 200, rows = 120, fill = 0) => ({ cols, rows, data: new Float32Array(cols * rows).fill(fill) });
const at = (r, c, row) => r.data[row * r.cols + c];
const brush = (o) => ({ ...BRUSH_DEFAULTS, ...o });
/** one stroke along the points [[x, y, pressure?], ...] */
function stroke(r, b, pts) {
  const s = createStroke(r, brush(b), { pxPerInX: PPI, pxPerInY: PPI });
  for (const [x, y, p] of pts) s.addPoint(x, y, p ?? 1);
  return s;
}

describe('the falloff across a dab', () => {
  it('hardness 1: a hard edge -- 1 at r = 0 and at r = R (= hardness * R), 0 just past R', () => {
    expect(brushFalloff(0, 1, 1)).toBe(1);
    expect(brushFalloff(1, 1, 1)).toBe(1);
    expect(brushFalloff(1.0001, 1, 1)).toBe(0);
  });
  it('hardness 0: all soft -- 1 at the centre, 0.5 at R / 2 (smoothstep), 0 at R', () => {
    expect(brushFalloff(0, 1, 0)).toBe(1);
    expect(brushFalloff(0.5, 1, 0)).toBe(0.5);
    expect(brushFalloff(0.25, 1, 0)).toBeCloseTo(1 - (0.25 * 0.25 * (3 - 2 * 0.25)), 12);
    expect(brushFalloff(1, 1, 0)).toBe(0);
  });
  it('hardness 0.5: 1 out to r = 0.5 R, then 0.5 half way to the rim, 0 at R', () => {
    expect(brushFalloff(0.5, 2, 0.5)).toBe(1);
    expect(brushFalloff(1, 2, 0.5)).toBe(1);
    expect(brushFalloff(1.5, 2, 0.5)).toBe(0.5);
    expect(brushFalloff(2, 2, 0.5)).toBe(0);
  });
  it('the profile laid by ONE raise dab (opacity 1, flow 1) is amount x falloff, exactly', () => {
    for (const hardness of [0, 1, 0.5]) {
      const r = raster();
      stroke(r, { mode: 'raise', sizeIn: 0.4, hardness, opacity: 1, flow: 1, amountIn: 0.25 }, [[100, 60]]);
      for (const dc of [0, 5, 10, 15, 19, 20, 21]) {
        expect(at(r, 100 + dc, 60), `h${hardness} dc${dc}`).toBe(Math.fround(0.25 * brushFalloff(dc / PPI, 0.2, hardness)));
      }
    }
  });
});

describe('the stroke-level opacity cap', () => {
  it('20 overlapping dabs at flow 0.3, opacity 0.6: the coverage climbs and never passes 0.6 (raise 0.1 -> at most 0.06)', () => {
    const r = raster();
    const s = createStroke(r, brush({ mode: 'raise', sizeIn: 0.3, hardness: 1, opacity: 0.6, flow: 0.3, amountIn: 0.1 }), { pxPerInX: PPI, pxPerInY: PPI });
    let last = 0;
    for (let i = 0; i < 20; i++) {
      s.addPoint(i % 2 ? 101 : 99, 60, 1); // scrubbing back and forth over the same spot
      const v = at(r, 100, 60);
      expect(v).toBeGreaterThanOrEqual(last);
      expect(v).toBeLessThanOrEqual(Math.fround(0.06) + 1e-9);
      last = v;
    }
    expect(last).toBeGreaterThan(0.055); // it does build up toward the cap
  });
  it('set, value 1.0 @ opacity 0.5: one stroke on 0 reaches 0.5; scrubbing inside it stays 0.5; a crossing second stroke -> 0.75', () => {
    const r = raster();
    const b = { mode: 'set', sizeIn: 0.2, hardness: 1, opacity: 0.5, flow: 1, targetIn: 1, spacing: 0.1 };
    stroke(r, b, [[40, 60], [160, 60], [40, 60], [160, 60]]); // across and back twice, one stroke
    expect(at(r, 100, 60)).toBe(0.5);
    expect(at(r, 60, 60)).toBe(0.5);
    stroke(r, b, [[100, 10], [100, 110]]); // a second stroke crossing it
    expect(at(r, 100, 60)).toBe(0.75);
    expect(at(r, 60, 60)).toBe(0.5);   // only the first stroke
    expect(at(r, 100, 20)).toBe(0.5);  // only the second stroke
  });
  it('set, value 0.5 @ opacity 1.0: 0.5 after one stroke and STILL 0.5 where two strokes cross', () => {
    const r = raster();
    const b = { mode: 'set', sizeIn: 0.2, hardness: 1, opacity: 1, flow: 1, targetIn: 0.5 };
    stroke(r, b, [[40, 60], [160, 60]]);
    expect(at(r, 100, 60)).toBe(0.5);
    stroke(r, b, [[100, 10], [100, 110]]);
    expect(at(r, 100, 60)).toBe(0.5);
  });
  it('set reaches EXACTLY the target at opacity 1 and flow 1, from any height under it', () => {
    const r = raster(200, 120, 0.3);
    stroke(r, { mode: 'set', sizeIn: 0.3, hardness: 1, opacity: 1, flow: 1, targetIn: 0.2 }, [[100, 60], [120, 60]]);
    expect(at(r, 100, 60)).toBe(Math.fround(0.2));
    expect(at(r, 110, 61)).toBe(Math.fround(0.2));
    expect(at(r, 10, 10)).toBe(Math.fround(0.3)); // untouched
  });
  it('raise / lower: one stroke adds at most opacity x amount; a crossing second stroke adds again (stacks)', () => {
    const r = raster();
    const b = { mode: 'raise', sizeIn: 0.2, hardness: 1, opacity: 0.5, flow: 1, amountIn: 0.2 };
    stroke(r, b, [[40, 60], [160, 60], [40, 60]]);
    expect(at(r, 100, 60)).toBe(Math.fround(0.1));
    stroke(r, b, [[100, 10], [100, 110]]);
    expect(at(r, 100, 60)).toBe(Math.fround(0.2));
    stroke(r, { ...b, mode: 'lower' }, [[100, 10], [100, 110]]);
    expect(at(r, 100, 60)).toBeCloseTo(0.1, 6);
    expect(at(r, 100, 20)).toBeCloseTo(0, 6); // raised once, lowered once
  });
});

describe('erase and smooth', () => {
  it('erase (opacity 1, flow 1) returns painted pixels to exactly 0 (transparent); opacity 0.5 halves them', () => {
    const r = raster();
    stroke(r, { mode: 'raise', sizeIn: 0.6, hardness: 1, amountIn: 0.3 }, [[100, 60]]);
    expect(at(r, 100, 60)).toBe(Math.fround(0.3));
    stroke(r, { mode: 'erase', sizeIn: 0.2, hardness: 1, opacity: 0.5, flow: 1 }, [[90, 60]]);
    expect(at(r, 90, 60)).toBe(Math.fround(0.15));
    stroke(r, { mode: 'erase', sizeIn: 1, hardness: 1, opacity: 1, flow: 1 }, [[100, 60]]);
    expect(at(r, 100, 60)).toBe(0);
    expect(at(r, 90, 60)).toBe(0);
  });
  it('smooth pulls a spike toward its neighbourhood and leaves a flat area flat', () => {
    const r = raster(200, 120, 0.1);
    r.data[60 * 200 + 100] = 1;
    stroke(r, { mode: 'smooth', sizeIn: 0.2, hardness: 1, opacity: 1, flow: 1 }, [[100, 60]]);
    expect(at(r, 100, 60)).toBeLessThan(0.5);
    expect(at(r, 100, 60)).toBeGreaterThan(0.1);
    expect(at(r, 92, 60)).toBeCloseTo(0.1, 6);
  });
});

describe('dabs along the path, pressure, and the touched box', () => {
  it('spacing: dabs every spacing x size along the path, the first at the first point (25 px at 2.5 px -> 11 dabs)', () => {
    const r = raster();
    const s = stroke(r, { mode: 'raise', sizeIn: 0.1, spacing: 0.25 }, [[50, 60], [60, 60], [75, 60]]);
    expect(s.dabs).toBe(11);
    const t = stroke(raster(), { mode: 'raise', sizeIn: 0.2, spacing: 0.5 }, [[50, 60], [50, 100]]); // 40 px at 10 px
    expect(t.dabs).toBe(5);
  });
  it('pressure -> size shrinks the dab; pressure -> opacity lowers the cap (both off: pressure ignored)', () => {
    const b = { mode: 'raise', sizeIn: 0.4, hardness: 1, opacity: 1, flow: 1, amountIn: 0.2 };
    const off = raster(); stroke(off, b, [[100, 60, 0.5]]);
    expect(at(off, 118, 60)).toBe(Math.fround(0.2));
    const size = raster(); stroke(size, { ...b, pressureSize: true }, [[100, 60, 0.5]]);
    expect(at(size, 118, 60)).toBe(0); // R 0.2 in -> 0.1 in
    expect(at(size, 100, 60)).toBe(Math.fround(0.2));
    const op = raster(); stroke(op, { ...b, pressureOpacity: true }, [[100, 60, 0.5]]);
    expect(at(op, 100, 60)).toBe(Math.fround(0.1));
  });
  it('only the touched bounding box changes, and the stroke reports it', () => {
    const r = raster(200, 120, 0.05);
    const before = Float32Array.from(r.data);
    const s = stroke(r, { mode: 'raise', sizeIn: 0.2, hardness: 1 }, [[50, 50], [70, 50]]);
    expect(s.bbox).toEqual({ c0: 40, r0: 40, c1: 80, r1: 60 });
    for (let row = 0; row < 120; row++) for (let c = 0; c < 200; c++) {
      if (c >= 40 && c <= 80 && row >= 40 && row <= 60) continue;
      expect(r.data[row * 200 + c]).toBe(before[row * 200 + c]);
    }
  });
  it('cancel() puts the stroke\'s pixels back', () => {
    const r = raster(200, 120, 0.05);
    const before = Float32Array.from(r.data);
    const s = stroke(r, { mode: 'set', sizeIn: 0.5, targetIn: 0.4 }, [[50, 50], [120, 70]]);
    s.cancel();
    expect(r.data).toEqual(before);
  });
  it('the declared modes', () => {
    expect(BRUSH_MODES).toEqual(['raise', 'lower', 'set', 'smooth', 'erase']);
  });
});

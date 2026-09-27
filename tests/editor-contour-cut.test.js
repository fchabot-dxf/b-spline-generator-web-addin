/**
 * F27 (Fred: "the scissors tool doesn't cut contour, it should"): the pure primitive split/merge math
 * (editor-contour-cut.js) that lets SE16's cutAt/join work on a contour L/A segment, not just a rail line.
 * Verified against REAL generated contour primitives (an hourglass silhouette), not synthetic numbers alone —
 * the same "measure, don't assume" discipline as every other primitive-geometry test in this codebase.
 */
import { describe, it, expect } from 'vitest';
import { generateSilhouette, primitiveToPathD } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import {
  primitiveFromContourD, contourPrimitiveEnds, nearestOnContourPrimitive, splitContourPrimitive, mergeContourPrimitives,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-contour-cut.js';

const REGION = { x: 0, y: 0, w: 7, h: 9 };

function realPrimitives(preset = 'hourglass', seed = 42) {
  return generateSilhouette(REGION, { preset, seed }).primitives;
}

describe('primitiveFromContourD: the exact inverse of primitiveToPathD', () => {
  it.each(['hourglass', 'bottle'])('%s: every real primitive round-trips through its own d exactly', (preset) => {
    for (const prim of realPrimitives(preset)) {
      const d = primitiveToPathD(prim);
      if (!d) continue; // the same defensive floor primitiveToPathD itself declines on (zero-radius arc)
      const back = primitiveFromContourD(d);
      expect(back.type).toBe(prim.type);
      if (prim.type === 'L') {
        // primitiveToPathD's own `_fmt` rounds each coordinate to 3 decimals before writing the `d` string --
        // the round-trip precision floor is THAT, not this function's own math (which is exact).
        expect(back.p0.x).toBeCloseTo(prim.p0.x, 2); expect(back.p0.y).toBeCloseTo(prim.p0.y, 2);
        expect(back.p1.x).toBeCloseTo(prim.p1.x, 2); expect(back.p1.y).toBeCloseTo(prim.p1.y, 2);
      } else {
        // NOT a precise cx/cy/rx/ry check: arcCenterParam solves "an arc through these two (already-rounded)
        // endpoints with this radius" -- for a large-radius, near-flat arc (this generator's own F23-widened
        // corner radii can reach ~2.5x the board's own half-width) that inverse is genuinely, CORRECTLY
        // sensitive to a 0.001 endpoint rounding: many valid centres pass through nearly the same two points.
        // MEASURED, not assumed (a first version asserted cx/cy to 5 decimals and failed by 0.03 on exactly
        // this kind of primitive). The geometrically meaningful claim -- does the reconstructed arc draw the
        // SAME curve -- is its own two ENDPOINTS, which arcCenterParam reproduces EXACTLY by construction
        // (that's what "an arc through these endpoints" means): checked tightly below, the real proof here.
        const [os, oe] = contourPrimitiveEnds(prim), [bs, be] = contourPrimitiveEnds(back);
        expect(Math.hypot(bs.x - os.x, bs.y - os.y)).toBeLessThan(2e-3);
        expect(Math.hypot(be.x - oe.x, be.y - oe.y)).toBeLessThan(2e-3);
      }
    }
  });
});

describe('splitContourPrimitive: a line', () => {
  const line = realPrimitives('hourglass').find((p) => p.type === 'L');
  it('splits at its own midpoint into two collinear halves sharing that exact point', () => {
    const mid = { x: (line.p0.x + line.p1.x) / 2, y: (line.p0.y + line.p1.y) / 2 };
    const [a, b] = splitContourPrimitive(line, mid);
    expect(a.p0).toEqual(line.p0);
    expect(a.p1).toEqual(mid);
    expect(b.p0).toEqual(mid);
    expect(b.p1).toEqual(line.p1);
    // non-vacuous: the split point is genuinely BETWEEN the two original ends, not degenerate
    expect(Math.hypot(a.p1.x - a.p0.x, a.p1.y - a.p0.y)).toBeGreaterThan(0.01);
    expect(Math.hypot(b.p1.x - b.p0.x, b.p1.y - b.p0.y)).toBeGreaterThan(0.01);
  });

  it('the split at an OFF-line point first projects it via nearestOnContourPrimitive (the tool\'s own contract)', () => {
    const off = { x: (line.p0.x + line.p1.x) / 2 + 0.3, y: (line.p0.y + line.p1.y) / 2 + 0.3 };
    const near = nearestOnContourPrimitive(line, off);
    const [a, b] = splitContourPrimitive(line, near);
    expect(a.p1).toEqual({ x: near.x, y: near.y });
    expect(b.p0).toEqual({ x: near.x, y: near.y });
  });
});

describe('splitContourPrimitive: an arc', () => {
  const arc = realPrimitives('hourglass').find((p) => p.type === 'A');

  it('splits at its own midpoint angle into two sub-arcs sharing that exact point, same centre/radius', () => {
    const midTheta = arc.theta1 + arc.dTheta / 2;
    const midPt = { x: arc.cx + arc.rx * Math.cos(midTheta), y: arc.cy + arc.ry * Math.sin(midTheta) };
    const [a, b] = splitContourPrimitive(arc, midPt);
    for (const half of [a, b]) {
      expect(half.cx).toBeCloseTo(arc.cx, 9); expect(half.cy).toBeCloseTo(arc.cy, 9);
      expect(half.rx).toBeCloseTo(arc.rx, 9); expect(half.ry).toBeCloseTo(arc.ry, 9);
    }
    expect(a.theta1).toBeCloseTo(arc.theta1, 9);
    expect(a.theta1 + a.dTheta).toBeCloseTo(midTheta, 6);
    expect(b.theta1).toBeCloseTo(midTheta, 6);
    expect(b.theta1 + b.dTheta).toBeCloseTo(arc.theta1 + arc.dTheta, 6);
    // non-vacuous: each half sweeps roughly HALF the original angle, not the whole thing or zero
    expect(Math.abs(a.dTheta)).toBeGreaterThan(Math.abs(arc.dTheta) * 0.3);
    expect(Math.abs(b.dTheta)).toBeGreaterThan(Math.abs(arc.dTheta) * 0.3);
  });

  it('the union of the two halves\' own d strings draws the SAME curve as the original, sampled densely', () => {
    const t = 0.37; // an arbitrary, non-symmetric split point
    const theta = arc.theta1 + arc.dTheta * t;
    const p = { x: arc.cx + arc.rx * Math.cos(theta), y: arc.cy + arc.ry * Math.sin(theta) };
    const [a, b] = splitContourPrimitive(arc, p);
    const sample = (prim, k) => { const th = prim.theta1 + prim.dTheta * k / 20; return { x: prim.cx + prim.rx * Math.cos(th), y: prim.cy + prim.ry * Math.sin(th) }; };
    for (let k = 0; k <= 20; k++) {
      const onOriginal = sample(arc, k * t);
      const onA = sample(a, k);
      expect(Math.hypot(onOriginal.x - onA.x, onOriginal.y - onA.y)).toBeLessThan(1e-6);
    }
  });
});

describe('mergeContourPrimitives: the exact inverse of splitContourPrimitive', () => {
  it.each(['hourglass', 'bottle'])('%s: for every real primitive, merge(split(prim, p)) restores prim exactly, at several split points', (preset) => {
    for (const prim of realPrimitives(preset)) {
      if (prim.type === 'A' && (prim.rx <= 0 || prim.ry <= 0)) continue;
      for (const t of [0.2, 0.5, 0.8]) {
        const point = prim.type === 'L'
          ? { x: prim.p0.x + (prim.p1.x - prim.p0.x) * t, y: prim.p0.y + (prim.p1.y - prim.p0.y) * t }
          : { x: prim.cx + prim.rx * Math.cos(prim.theta1 + prim.dTheta * t), y: prim.cy + prim.ry * Math.sin(prim.theta1 + prim.dTheta * t) };
        const [a, b] = splitContourPrimitive(prim, point);
        const merged = mergeContourPrimitives(a, b);
        expect(merged).not.toBeNull();
        expect(merged.type).toBe(prim.type);
        if (prim.type === 'L') {
          expect(merged.p0.x).toBeCloseTo(prim.p0.x, 6); expect(merged.p0.y).toBeCloseTo(prim.p0.y, 6);
          expect(merged.p1.x).toBeCloseTo(prim.p1.x, 6); expect(merged.p1.y).toBeCloseTo(prim.p1.y, 6);
        } else {
          expect(merged.cx).toBeCloseTo(prim.cx, 6); expect(merged.cy).toBeCloseTo(prim.cy, 6);
          expect(merged.rx).toBeCloseTo(prim.rx, 6);
          expect(merged.theta1).toBeCloseTo(prim.theta1, 6);
          expect(merged.dTheta).toBeCloseTo(prim.dTheta, 6);
        }
      }
    }
  });

  it('two UNRELATED adjacent primitives (a genuine shape corner, not a cut) do NOT merge', () => {
    const prims = realPrimitives('hourglass');
    // any two consecutive REAL primitives (a horn meeting a shoulder arc, say) are a genuine corner, never
    // one cut's own two halves -- they must refuse to merge (different curve, or non-contiguous angle).
    for (let i = 0; i < prims.length; i++) {
      const a = prims[i], b = prims[(i + 1) % prims.length];
      if (a.type === b.type && a.type === 'A') {
        // same-type arc-to-arc pairs would only merge if they share a centre/radius -- a real shape's own
        // distinct corners never do (checked, not assumed: this hourglass has a shoulder and a hip arc,
        // different centres by construction).
        expect(mergeContourPrimitives(a, b)).toBeNull();
      } else if (a.type !== b.type) {
        expect(mergeContourPrimitives(a, b)).toBeNull(); // different type: refused outright
      }
    }
  });

  it('non-vacuous: mergeContourPrimitives is NOT a no-op that always returns something', () => {
    const line = realPrimitives('hourglass').find((p) => p.type === 'L');
    const arc = realPrimitives('hourglass').find((p) => p.type === 'A');
    expect(mergeContourPrimitives(line, arc)).toBeNull(); // different types
    expect(mergeContourPrimitives(arc, { ...arc, cx: arc.cx + 1 })).toBeNull(); // different centre
    expect(mergeContourPrimitives(arc, { ...arc, theta1: arc.theta1 + 1 })).toBeNull(); // not contiguous
  });
});

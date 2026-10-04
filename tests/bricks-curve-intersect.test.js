/**
 * H23 item 76 -- direct unit coverage for curve-intersect.js, hand-verified against known ground
 * truth (not just internal self-consistency) before any caller is built on top of it.
 */
import { describe, it, expect } from 'vitest';
import {
  lineLineIntersection, lineCircleIntersections, circleCircleIntersections, curveIntersection,
} from '../bspline-frame-builder/b-spline-gen/html/core/bricks/curve-intersect.js';

describe('lineLineIntersection', () => {
  it('two perpendicular lines meet at the expected point', () => {
    const p = lineLineIntersection({ x: 0, y: 5 }, { x: 1, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 1 });
    expect(p.x).toBeCloseTo(5, 9);
    expect(p.y).toBeCloseTo(5, 9);
  });

  it('parallel lines return null', () => {
    expect(lineLineIntersection({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 5 }, { x: 1, y: 0 })).toBeNull();
  });
});

describe('lineCircleIntersections', () => {
  it('the x-axis through a circle centred (5,0) r=3 hits (2,0) and (8,0)', () => {
    const pts = lineCircleIntersections({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 5, y: 0 }, 3);
    expect(pts.length).toBe(2);
    const xs = pts.map((p) => p.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(2, 9);
    expect(xs[1]).toBeCloseTo(8, 9);
    for (const p of pts) expect(p.y).toBeCloseTo(0, 9);
  });

  it('a tangent line (distance == radius) returns exactly one point', () => {
    const pts = lineCircleIntersections({ x: 0, y: 3 }, { x: 1, y: 0 }, { x: 0, y: 0 }, 3);
    expect(pts.length).toBe(1);
    expect(pts[0].x).toBeCloseTo(0, 6);
    expect(pts[0].y).toBeCloseTo(3, 6);
  });

  it('a line that misses the circle entirely returns no points', () => {
    expect(lineCircleIntersections({ x: 0, y: 10 }, { x: 1, y: 0 }, { x: 0, y: 0 }, 3)).toEqual([]);
  });

  it('T86 item 4: a GENUINELY tangent line whose own disc computes as a tiny NEGATIVE float (not an exact 0) still returns the single tangent point', () => {
    // HAND-VERIFIED real numbers (template_2's own neck-to-body transition, a line tangent to its own
    // neighbouring arc): `b`/`cc` are computed from DIFFERENT floating-point paths that need not
    // agree to the last bit even for an exact mathematical tangent -- MEASURED: disc = -6.661e-16
    // here, not the clean disc=0 the test above already covers (that one starts from values chosen
    // to divide evenly). Before this fix, the old strict `disc < 0` rejected this outright (returned
    // `[]`), which a real caller (`jointPointAt`) then silently read as "no corner here at all" (a
    // free end, never clipped) -- see primitive-ribbon.js's own header for the live consequence this
    // had (a neighbouring row's own piece ran unbounded, 7.7x nominal area).
    const pts = lineCircleIntersections(
      { x: 5.5091304999999995, y: 0.25 }, { x: 0, y: 1 },
      { x: 6.196111, y: 1.6127732499999996 }, 0.6869805000000003,
    );
    expect(pts.length).toBe(1);
    expect(pts[0].x).toBeCloseTo(5.50913, 4);
    expect(pts[0].y).toBeCloseTo(1.61277, 4);
  });

  it('a GENUINE non-intersection just past tangent (disc meaningfully negative, not float noise) still returns no points', () => {
    // the new tolerance (`disc < -1e-9`) must not swallow real misses -- a line moved a visible
    // 0.01 beyond the tangent distance is nowhere close to the 1e-9-scale noise band.
    expect(lineCircleIntersections({ x: 0, y: 3.01 }, { x: 1, y: 0 }, { x: 0, y: 0 }, 3)).toEqual([]);
  });
});

describe('circleCircleIntersections', () => {
  it('two radius-5 circles 8 apart meet at (4,3) and (4,-3)', () => {
    const pts = circleCircleIntersections({ x: 0, y: 0 }, 5, { x: 8, y: 0 }, 5);
    expect(pts.length).toBe(2);
    for (const p of pts) {
      expect(p.x).toBeCloseTo(4, 9);
      // each point is equidistant (5) from BOTH centres -- the real geometric invariant, checked
      // directly rather than assuming which of the two y-roots came out first.
      expect(Math.hypot(p.x - 0, p.y - 0)).toBeCloseTo(5, 9);
      expect(Math.hypot(p.x - 8, p.y - 0)).toBeCloseTo(5, 9);
    }
    const ys = pts.map((p) => p.y).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(-3, 9);
    expect(ys[1]).toBeCloseTo(3, 9);
  });

  it('two tangent circles (distance == r1+r2) return a single touching point', () => {
    const pts = circleCircleIntersections({ x: 0, y: 0 }, 3, { x: 10, y: 0 }, 7);
    expect(pts.length).toBe(1);
    expect(pts[0].x).toBeCloseTo(3, 6);
    expect(pts[0].y).toBeCloseTo(0, 6);
  });
});

describe('curveIntersection (nearest-root selection)', () => {
  it('picks the circle-circle root nearest the given reference point', () => {
    const a = { type: 'circle', c: { x: 0, y: 0 }, r: 5 };
    const b = { type: 'circle', c: { x: 8, y: 0 }, r: 5 };
    expect(curveIntersection(a, b, { x: 4, y: 10 })).toEqual({ x: 4, y: 3 });
    expect(curveIntersection(a, b, { x: 4, y: -10 })).toEqual({ x: 4, y: -3 });
  });

  it('picks the line-circle root nearest the reference point, either order', () => {
    const line = { type: 'line', p0: { x: 0, y: 0 }, dir: { x: 1, y: 0 } };
    const circle = { type: 'circle', c: { x: 5, y: 0 }, r: 3 };
    const near8 = curveIntersection(line, circle, { x: 10, y: 10 });
    expect(near8.x).toBeCloseTo(8, 9);
    const near2 = curveIntersection(circle, line, { x: -5, y: -5 });
    expect(near2.x).toBeCloseTo(2, 9);
  });

  it('MUTATION CHECK: picking the FARTHEST root instead of nearest gives a different, wrong point -- proving nearest-selection is not vacuous', () => {
    const a = { type: 'circle', c: { x: 0, y: 0 }, r: 5 };
    const b = { type: 'circle', c: { x: 8, y: 0 }, r: 5 };
    const correct = curveIntersection(a, b, { x: 4, y: 10 });
    const pts = circleCircleIntersections(a.c, a.r, b.c, b.r);
    const farthest = pts.reduce((best, p) => ((p.y - 10) ** 2 < (best.y - 10) ** 2 ? best : p), pts[0]);
    expect(farthest).not.toEqual(correct);
  });
});

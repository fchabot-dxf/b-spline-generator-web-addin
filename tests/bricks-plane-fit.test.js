/**
 * F35 item 16 follow-up (Fred's target look, Flat brick-top mode): core/bricks/plane-fit.js's
 * `fitPlane` -- a plain least-squares plane through a handful of 3D points. Each test constructs a
 * case with a KNOWN ground-truth plane (or a known degenerate/noisy case) and reads back real
 * numbers, rather than re-deriving the math a second time by eye.
 */
import { describe, it, expect } from 'vitest';
import { fitPlane } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/plane-fit.js';

describe('fitPlane', () => {
  it('recovers an EXACT known plane (z = 2x - 3y + 5) from points sampled exactly on it', () => {
    const plane = (x, y) => 2 * x - 3 * y + 5;
    const points = [
      { x: 0, y: 0, z: plane(0, 0) },
      { x: 4, y: 0, z: plane(4, 0) },
      { x: 4, y: 2, z: plane(4, 2) },
      { x: 0, y: 2, z: plane(0, 2) },
      { x: 2, y: 1, z: plane(2, 1) },
    ];
    const fit = fitPlane(points);
    expect(fit.a).toBeCloseTo(2, 6);
    expect(fit.b).toBeCloseTo(-3, 6);
    expect(fit.c).toBeCloseTo(5, 6);
    // .eval must agree with the closed-form a*x+b*y+c at an arbitrary point too.
    expect(fit.eval(7, -3)).toBeCloseTo(plane(7, -3), 5);
  });

  it('a perfectly FLAT (level) terrain fits a=0, b=0, c=that level', () => {
    const z = 0.42;
    const points = [{ x: -1, y: -1, z }, { x: 1, y: -1, z }, { x: 1, y: 1, z }, { x: -1, y: 1, z }, { x: 0, y: 0, z }];
    const fit = fitPlane(points);
    expect(fit.a).toBeCloseTo(0, 9);
    expect(fit.b).toBeCloseTo(0, 9);
    expect(fit.c).toBeCloseTo(z, 9);
  });

  it('MINIMIZES squared error for noisy samples around a known plane -- a real least-squares check, not just an exact-fit echo', () => {
    // Same plane as above, but with symmetric +/- noise added to two opposite points. A least
    // squares fit through a symmetric perturbation should recover the UNDERLYING plane almost
        // exactly (the noise cancels in the normal equations), unlike e.g. a naive 3-point fit that
    // would just pick up whichever 3 points happened to be used.
    const plane = (x, y) => 1 * x + 1 * y + 2;
    const points = [
      { x: 0, y: 0, z: plane(0, 0) + 0.1 },
      { x: 4, y: 0, z: plane(4, 0) - 0.1 },
      { x: 4, y: 4, z: plane(4, 4) + 0.1 },
      { x: 0, y: 4, z: plane(0, 4) - 0.1 },
    ];
    const fit = fitPlane(points);
    expect(fit.a).toBeCloseTo(1, 1);
    expect(fit.b).toBeCloseTo(1, 1);
    expect(fit.c).toBeCloseTo(2, 1);
  });

  it('a degenerate input (all points at the SAME location) falls back to a level plane at that height, never NaN', () => {
    const points = [{ x: 3, y: 3, z: 0.2 }, { x: 3, y: 3, z: 0.2 }, { x: 3, y: 3, z: 0.2 }];
    const fit = fitPlane(points);
    expect(fit.a).toBe(0);
    expect(fit.b).toBe(0);
    expect(fit.c).toBeCloseTo(0.2, 9);
    expect(Number.isNaN(fit.eval(10, 10))).toBe(false);
  });

  it('a single collinear line of points (no y variation -- an under-determined plane) still returns finite numbers', () => {
    const points = [{ x: 0, y: 5, z: 1 }, { x: 1, y: 5, z: 2 }, { x: 2, y: 5, z: 3 }];
    const fit = fitPlane(points);
    expect(Number.isFinite(fit.a)).toBe(true);
    expect(Number.isFinite(fit.b)).toBe(true);
    expect(Number.isFinite(fit.c)).toBe(true);
    expect(Number.isNaN(fit.eval(0, 5))).toBe(false);
  });
});

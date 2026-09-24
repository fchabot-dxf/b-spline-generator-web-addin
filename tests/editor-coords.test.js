/**
 * SE8b / SA-COORD-3,4 — toLocal, the declared inverse of worldPoint.
 *
 * editor-coords.js's own header lists 4 prior bugs from the READ
 * direction (baking el.matrix() for rendering/hit-highlighting) before it
 * was hardened into worldPoint/worldBbox. The WRITE direction (mapping a
 * world-space pointer back into an element's local space) never had that
 * pass — SE7n's dragNode inlined `el.matrix().inverse()` + transformPoint
 * ad hoc. toLocal is that inline made a named, reusable declaration.
 */
import { describe, it, expect } from 'vitest';
import { worldPoint, toLocal, transformPoint } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-coords.js';

function mockElWithMatrix(matrix) {
  return { matrix: () => matrix };
}

describe('toLocal', () => {
  it('is the exact inverse of worldPoint for a translate matrix', () => {
    const m = { a: 1, b: 0, c: 0, d: 1, e: 5, f: -3 };
    const withInverse = { ...m, inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: -5, f: 3 }) };
    const el = mockElWithMatrix(withInverse);
    const local = { x: 2, y: 4 };
    const world = worldPoint(el, local);
    expect(world).toEqual({ x: 7, y: 1 });
    expect(toLocal(el, world)).toEqual(local);
  });

  it('round-trips through a rotation matrix (world -> local -> world)', () => {
    const deg = 40, rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const m = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
    // A pure rotation's inverse is its transpose.
    const inverse = { a: cos, b: -sin, c: sin, d: cos, e: 0, f: 0 };
    const el = mockElWithMatrix({ ...m, inverse: () => inverse });
    const local = { x: 3, y: -2 };
    const world = transformPoint(m, local);
    const backToLocal = toLocal(el, world);
    expect(backToLocal.x).toBeCloseTo(local.x, 10);
    expect(backToLocal.y).toBeCloseTo(local.y, 10);
  });

  it('identity when the element has no matrix method', () => {
    expect(toLocal({}, { x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
    expect(toLocal(null, { x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
  });

  it('identity when matrix() returns null or has no inverse()', () => {
    expect(toLocal(mockElWithMatrix(null), { x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
    expect(toLocal(mockElWithMatrix({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }), { x: 1, y: 2 }))
      .toEqual({ x: 1, y: 2 }); // no .inverse() on this plain matrix object
  });

  it('does not throw if matrix() itself throws', () => {
    const el = { matrix: () => { throw new Error('boom'); } };
    expect(() => toLocal(el, { x: 1, y: 2 })).not.toThrow();
    expect(toLocal(el, { x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
  });
});

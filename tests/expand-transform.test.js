/**
 * EX1 — expanded vectors came through at MICRO scale.
 *
 * Root cause (reproduced in headless Chromium by stubbing out SVG.Point):
 * the expand strategies baked the element's transform into the path `d`
 * with `new SVG.Point(x,y).transform(m)` — but SVG.js's Point.transform is
 * "historically unreliable" (the code's own words) and SVG.Point is absent
 * in some host builds. expand-shape even guarded it behind `&& SVG.Point`
 * and SILENTLY skipped the transform when missing, so a scaled shape's
 * offset ring was built in LOCAL space → commit drops the transform →
 * ~1/scale (micro). Measured: scaled x3 stroke expanded at ratio 0.359
 * with SVG.Point absent, 1.026 with it present.
 *
 * Fix: bake via editor-coords.transformPoint — a pure manual affine with no
 * SVG.js dependency (the same math worldPoint/transform-handles already
 * used). This test pins that helper. The full expand pipeline needs real
 * SVG geometry (getPointAtLength) so it's proven end-to-end via Playwright
 * (see WORK-LOG); here we lock the math the fix depends on. Run: `npm test`.
 */
import { describe, it, expect } from 'vitest';
import { transformPoint } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-coords.js';

describe('EX1: transformPoint bakes an affine matrix (no SVG.Point dependency)', () => {
  it('applies scale + translate', () => {
    // matrix(3,0,0,3,1,1): local (2,2) -> world (7,7); (0,0) -> (1,1)
    const m = { a: 3, b: 0, c: 0, d: 3, e: 1, f: 1 };
    expect(transformPoint(m, { x: 2, y: 2 })).toEqual({ x: 7, y: 7 });
    expect(transformPoint(m, { x: 0, y: 0 })).toEqual({ x: 1, y: 1 });
  });

  it('reproduces the EX1 scale — a 3x source lands 3x out, not 1x (micro)', () => {
    // The micro bug shipped the LOCAL coord (0.3) instead of the world coord.
    const m = { a: 3, b: 0, c: 0, d: 3, e: 0.5, f: 0.5 };
    const p = transformPoint(m, { x: 0.3, y: 0.3 });
    expect(p.x).toBeCloseTo(1.4, 6);   // world, not the micro 0.3
    expect(p.y).toBeCloseTo(1.4, 6);
  });

  it('honors rotation / shear terms (b, c)', () => {
    // 90° rotation: (1,0) -> (0,1)
    const m = { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 };
    expect(transformPoint(m, { x: 1, y: 0 })).toEqual({ x: 0, y: 1 });
  });

  it('identity is a no-op; a null matrix passes the point through', () => {
    expect(transformPoint({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, { x: 2, y: 3 })).toEqual({ x: 2, y: 3 });
    expect(transformPoint(null, { x: 2, y: 3 })).toEqual({ x: 2, y: 3 });
  });

  it('needs no SVG.js global — pure math even when SVG is undefined', () => {
    const savedSVG = globalThis.SVG;
    try {
      globalThis.SVG = undefined; // the failing environment that caused micro
      const m = { a: 3, b: 0, c: 0, d: 3, e: 0, f: 0 };
      expect(transformPoint(m, { x: 2, y: 2 })).toEqual({ x: 6, y: 6 });
    } finally {
      globalThis.SVG = savedSVG;
    }
  });
});

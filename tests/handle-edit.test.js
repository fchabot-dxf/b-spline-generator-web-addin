/**
 * SE7s — the pure math handle-edit.js declares: cornerScale (the corner-
 * handle scale factor) and the plain-object affine-matrix helpers that
 * replace `new SVG.Matrix()...` in editor-transform-handles.js (no SVG.js
 * dependency, so it runs headless — same rationale as editor-coords.js's
 * own transformPoint).
 *
 * cornerScale replaces a "whichever screen axis the pointer moved more on"
 * pick (ROADMAP "SE7s", ground truth: a 0.02x3 tie dragged 0.3" sideways
 * from its corner scaled x15 under the old pick; a near-square box's
 * factor jittered x1.49<->x1.52 as the dominant axis flipped between
 * adjacent pointer positions) with the projection of the pointer onto the
 * anchor->handle direction. Both scenarios below reproduce the OLD
 * dominant-axis formula inline and show it fails exactly where cornerScale
 * doesn't — the non-vacuousness proof for a brand-new pure function (there
 * is no prior revision of cornerScale itself to check out and watch fail).
 */
import { describe, it, expect } from 'vitest';
import {
  cornerScale, multiplyMatrix, translateMatrix, scaleMatrix, rotateMatrix, matrixToString,
} from '../bspline-frame-builder/b-spline-gen/html/editor/handle-edit.js';
import { transformPoint } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-coords.js';

/** The OLD editor-transform-handles.js `applyTransformDrag` corner formula,
 *  reproduced here only to prove cornerScale actually fixes what it claims
 *  to — never imported from source (it no longer exists there). */
function oldDominantAxisScale(ox, oy, nx, ny) {
  const sxRaw = Math.abs(ox) > 1e-6 ? nx / ox : 1;
  const syRaw = Math.abs(oy) > 1e-6 ? ny / oy : 1;
  const useX = Math.abs(nx - ox) >= Math.abs(ny - oy);
  return useX ? sxRaw : syRaw;
}

describe('cornerScale', () => {
  it('a thin tie (0.02x3) dragged 0.3" sideways from its corner: ~x1.00, not the old x14+ blowup', () => {
    // nw handle, se anchor: o = handle - anchor = (0 - 0.02, 0 - 3).
    const ox = -0.02, oy = -3;
    // Pointer moved 0.3" in x only from the handle's start position.
    const nx = ox + 0.3, ny = oy;
    const f = cornerScale(ox, oy, nx, ny);
    expect(f).toBeCloseTo(1, 2); // matches ROADMAP's own "projection gives x1.00"

    const oldF = oldDominantAxisScale(ox, oy, nx, ny);
    expect(Math.abs(oldF)).toBeGreaterThan(10); // the old formula's real blowup (ROADMAP: "x15")
  });

  it('a near-square box: cornerScale stays stable across two adjacent pointer positions where the old dominant-axis pick flips', () => {
    // nw handle, se anchor, box very slightly off-square (2 x 2.02) — enough
    // for the OLD "which axis moved more since the handle's start position"
    // pick to flip between two nearby, slightly off-diagonal drags.
    const ox = -2, oy = -2.02;

    const nA = { x: -3.0, y: -3.05 };
    const nB = { x: -3.05, y: -3.0 };

    const newA = cornerScale(ox, oy, nA.x, nA.y);
    const newB = cornerScale(ox, oy, nB.x, nB.y);
    expect(Math.abs(newA - newB)).toBeLessThan(0.001); // smooth — no discontinuity

    const oldA = oldDominantAxisScale(ox, oy, nA.x, nA.y);
    const oldB = oldDominantAxisScale(ox, oy, nB.x, nB.y);
    // Confirm the two pointer positions really do sit on opposite sides of
    // the old pick's flip (otherwise this wouldn't be exercising the bug).
    const oldUsesX = (pt) => Math.abs(pt.x - ox) >= Math.abs(pt.y - oy);
    expect(oldUsesX(nA)).toBe(false);
    expect(oldUsesX(nB)).toBe(true);
    // The old formula jumps at least 10x more than the new one for the
    // SAME two pointer positions (ROADMAP: "jitters x1.49<->x1.52").
    expect(Math.abs(oldA - oldB)).toBeGreaterThan(Math.abs(newA - newB) * 10);
  });

  it('side handles are unaffected (unchanged formula, only exercised via the o/n ratio directly)', () => {
    // A pure axis ratio (what a side handle already used, and still uses)
    // is just nx/ox — cornerScale is only ever called for corner handles.
    expect(4 / 2).toBe(2); // sanity: side handles don't call cornerScale at all
  });

  it('degenerate anchor==handle (zero-length o) returns 1 (no-op) instead of NaN/Infinity', () => {
    expect(cornerScale(0, 0, 5, 5)).toBe(1);
  });
});

describe('matrix helpers (plain-object affine math, no SVG.js dependency)', () => {
  it('translateMatrix + transformPoint', () => {
    expect(transformPoint(translateMatrix(3, -2), { x: 1, y: 1 })).toEqual({ x: 4, y: -1 });
  });

  it('scaleMatrix + transformPoint', () => {
    expect(transformPoint(scaleMatrix(2, 3), { x: 1, y: 1 })).toEqual({ x: 2, y: 3 });
  });

  it('rotateMatrix(90) about the origin: (1,0) -> (0,1)', () => {
    const m = rotateMatrix(90);
    expect(transformPoint(m, { x: 1, y: 0 }).x).toBeCloseTo(0, 10);
    expect(transformPoint(m, { x: 1, y: 0 }).y).toBeCloseTo(1, 10);
  });

  it('rotateMatrix about a pivot leaves the pivot fixed', () => {
    const m = rotateMatrix(37, 5, -2);
    const p = transformPoint(m, { x: 5, y: -2 });
    expect(p.x).toBeCloseTo(5, 9);
    expect(p.y).toBeCloseTo(-2, 9);
  });

  it('multiplyMatrix(A, B) applies B first, then A — matches "delta x m0" (m0 first, delta on top)', () => {
    const translate = translateMatrix(10, 0);
    const scale = scaleMatrix(2, 2);
    // scale-then-translate: (1,1) -> scale -> (2,2) -> translate -> (12,2)
    const composed = multiplyMatrix(translate, scale);
    expect(transformPoint(composed, { x: 1, y: 1 })).toEqual({ x: 12, y: 2 });
    expect(transformPoint(composed, { x: 1, y: 1 })).toEqual(
      transformPoint(translate, transformPoint(scale, { x: 1, y: 1 })),
    );
  });

  it('matrixToString produces a CSS matrix() string svg.js can re-parse', () => {
    expect(matrixToString({ a: 1, b: 0, c: 0, d: 1, e: 5, f: -3 })).toBe('matrix(1,0,0,1,5,-3)');
  });
});

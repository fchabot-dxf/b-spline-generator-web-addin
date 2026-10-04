/**
 * F35 item 5 -- editor-brick-surface.js's own brickLocalUV: the pure geometry
 * half of the real-photo-surface mapping (the canvas/image-decode half is
 * deliberately NOT unit-tested here, same precedent as core/photo/codec.js's
 * own header -- it's the one canvas-touching function in that feature,
 * verified live instead).
 */
import { describe, it, expect } from 'vitest';
import { brickLocalUV } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-surface.js';

// A 4x1 axis-aligned rectangle (length along x, like a 'stretcher' brick).
const rect = [{ x: -2, y: -0.5 }, { x: 2, y: -0.5 }, { x: 2, y: 0.5 }, { x: -2, y: 0.5 }];

describe('brickLocalUV', () => {
  it('maps the centroid to (0.5, 0.5)', () => {
    const { u, v } = brickLocalUV(rect, 0, 0, false);
    expect(u).toBeCloseTo(0.5, 9);
    expect(v).toBeCloseTo(0.5, 9);
  });

  it('picks the LONGEST edge as the u-axis regardless of x/y orientation', () => {
    // The 4-long edge runs along x here; u should track x, not y.
    const nearLeft = brickLocalUV(rect, -1.9, 0, false);
    const nearRight = brickLocalUV(rect, 1.9, 0, false);
    expect(nearLeft.u).toBeLessThan(0.1);
    expect(nearRight.u).toBeGreaterThan(0.9);
    // v should stay near 0.5 across the length (it only reflects the y offset here).
    expect(nearLeft.v).toBeCloseTo(0.5, 6);
  });

  it('is robust to the polygon being rotated 90deg (u-axis follows the LONGEST edge, not a fixed x/y assumption)', () => {
    // Same 4x1 rectangle, rotated so its length now runs along y.
    const rotated = [{ x: -0.5, y: -2 }, { x: -0.5, y: 2 }, { x: 0.5, y: 2 }, { x: 0.5, y: -2 }];
    const nearTop = brickLocalUV(rotated, 0, -1.9, false);
    const nearBottom = brickLocalUV(rotated, 0, 1.9, false);
    // One end should be near u=0 and the other near u=1 -- which end is which
    // depends on edge-walk direction, so just check they're near opposite extremes.
    expect(Math.abs(nearTop.u - nearBottom.u)).toBeGreaterThan(0.8);
  });

  it('flip mirrors u around 0.5, leaves v unchanged', () => {
    const noFlip = brickLocalUV(rect, 1, 0.2, false);
    const flipped = brickLocalUV(rect, 1, 0.2, true);
    expect(flipped.u).toBeCloseTo(1 - noFlip.u, 9);
    expect(flipped.v).toBeCloseTo(noFlip.v, 9);
  });

  it('clamps points outside the polygon into [0,1] rather than returning out-of-range values', () => {
    const { u, v } = brickLocalUV(rect, 100, 100, false);
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThanOrEqual(1);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });

  it('handles a mitred triangle (3-point polygon) without throwing, staying in [0,1]', () => {
    const triangle = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }];
    const { u, v } = brickLocalUV(triangle, 0.5, 0.3, false);
    expect(Number.isFinite(u)).toBe(true);
    expect(Number.isFinite(v)).toBe(true);
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThanOrEqual(1);
  });
});

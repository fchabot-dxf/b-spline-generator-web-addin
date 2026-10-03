import { describe, it, expect } from 'vitest';
import { computeMirrorDimRects } from '../bspline-frame-builder/b-spline-gen/html/core/photo/mirror-dim.js';

describe('computeMirrorDimRects', () => {
  it('symmetry none: nothing dimmed', () => {
    expect(computeMirrorDimRects('none')).toEqual([]);
  });

  it("symmetry 'x': the left half (u < 0.5 by default) is dimmed, full height", () => {
    expect(computeMirrorDimRects('x')).toEqual([{ x: 0, y: 0, w: 0.5, h: 1 }]);
  });

  it("symmetry 'y': the top half (v < 0.5 by default) is dimmed, full width", () => {
    expect(computeMirrorDimRects('y')).toEqual([{ x: 0, y: 0, w: 1, h: 0.5 }]);
  });

  it("symmetry 'radial': both halves dimmed (3 quadrants covered, bottom-right left clear)", () => {
    expect(computeMirrorDimRects('radial')).toEqual([
      { x: 0, y: 0, w: 0.5, h: 1 },
      { x: 0, y: 0, w: 1, h: 0.5 },
    ]);
  });

  it('a shifted mirror axis (symOffsetX/Y) moves the dim boundary with it', () => {
    expect(computeMirrorDimRects('x', 0.2)).toEqual([{ x: 0, y: 0, w: 0.7, h: 1 }]);
    expect(computeMirrorDimRects('y', 0, -0.3)).toEqual([{ x: 0, y: 0, w: 1, h: 0.2 }]);
  });

  it('clamps an extreme offset so the dim rectangle never exceeds the image bounds', () => {
    expect(computeMirrorDimRects('x', 10)).toEqual([{ x: 0, y: 0, w: 1, h: 1 }]);
    expect(computeMirrorDimRects('x', -10)).toEqual([{ x: 0, y: 0, w: 0, h: 1 }]);
  });
});

import { describe, it, expect } from 'vitest';
import { stepToGrid, STROKE_STEP_IN } from '../bspline-frame-builder/b-spline-gen/html/editor/properties-shape.js';

describe('stepToGrid (Fred: ± lands on 0.05, 0.1, 0.15…)', () => {
  it('snaps an off-grid value UP to the next multiple', () => {
    expect(stepToGrid(0.07, STROKE_STEP_IN, +1)).toBe(0.1);
    expect(stepToGrid(0.055, STROKE_STEP_IN, +1)).toBe(0.1);
  });
  it('snaps an off-grid value DOWN to the previous multiple', () => {
    expect(stepToGrid(0.07, STROKE_STEP_IN, -1)).toBe(0.05);
    expect(stepToGrid(0.12, STROKE_STEP_IN, -1)).toBe(0.1);
  });
  it('moves an on-grid value one full step, without float drift', () => {
    expect(stepToGrid(0.1, STROKE_STEP_IN, +1)).toBe(0.15);
    expect(stepToGrid(0.15, STROKE_STEP_IN, +1)).toBe(0.2);
    expect(stepToGrid(0.3, STROKE_STEP_IN, -1)).toBe(0.25);
  });
});

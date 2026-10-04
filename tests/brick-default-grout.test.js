/**
 * Audit C4 (Fred's Brick tab): the default grout repeated Set 1's declaration with a different width
 * (0.06 vs the set's 0.034, its 17% joint:height rule), so clicking White Rocks then Red Brick changed
 * the joints and the layout. The state default is now derived from Set 1 (library.js).
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { brickSetById } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

describe('the default brick grout is Set 1 (Red Brick)\'s own', () => {
  const set1 = brickSetById(1);
  it('width and depth match the set (re-picking Red Brick changes nothing)', () => {
    expect(DEFAULT.brickSettings.setId).toBe(1);
    expect(DEFAULT.brickSettings.grout.widthIn).toBe(set1.grout.widthIn);
    expect(DEFAULT.brickSettings.grout.depthIn).toBe(set1.grout.depthIn);
  });
  it('is a copy: editing the settings never writes into the frozen set', () => {
    expect(DEFAULT.brickSettings.grout).not.toBe(set1.grout);
  });
  it('brick length also matches the set', () => {
    expect(DEFAULT.brickSettings.brickLengthIn).toBe(set1.brickLengthIn);
  });
});

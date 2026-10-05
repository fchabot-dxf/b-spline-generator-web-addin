/**
 * Audit C4 (Fred's Brick tab): the default grout repeated Set 1's declaration with a different width
 * (0.06 vs the set's 0.034, its 17% joint:height rule), so clicking White Rocks then Red Brick changed
 * the joints and the layout. The state default is now derived from Set 1 (library.js).
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { elementGroutWidth } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { brickSetById } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

describe('the default brick grout is Set 1 (Red Brick)\'s own', () => {
  const set1 = brickSetById(1);
  it('width and depth match the set (re-picking Red Brick changes nothing)', () => {
    expect(DEFAULT.brickSettings.setIds).toEqual({ wall: 1, frame: 1, brush: 1, raisedBrush: 1 }); // item 23: per element
    // grout per element: a new board has no own joints -- each element lays with its set's (Red = set 1)
    expect(DEFAULT.brickSettings.groutByElement).toEqual({ wall: null, frame: null, brush: null });
    expect(elementGroutWidth(DEFAULT.brickSettings, 'wall')).toBe(set1.grout.widthIn);
    expect(DEFAULT.brickSettings.grout.depthIn).toBe(set1.grout.depthIn);
  });
  it('is a copy: editing the settings never writes into the frozen set', () => {
    expect(DEFAULT.brickSettings.grout).not.toBe(set1.grout);
  });
  it("Fred (2026-10-05): a new board starts at 1 1/4 in (was 1 in since turn 207), not the set's own 0.75", () => {
    expect(DEFAULT.brickSettings.brickLengthIn).toBe(1.25);
    expect(set1.brickLengthIn).toBe(0.75); // the set's own declaration is unchanged
  });
  it("Fred (turn 207): a new board starts with RECESSED joints (Set 1's 0.05 in) and FLAT brick tops", () => {
    expect(DEFAULT.brickSettings.grout.profile).toBe('recessed');
    expect(DEFAULT.brickSettings.grout.depthIn).toBe(0.05);
    expect(DEFAULT.brickSettings.brickTopMode).toBe('flat');
  });
});

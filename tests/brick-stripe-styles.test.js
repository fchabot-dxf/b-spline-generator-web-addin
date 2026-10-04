/**
 * Audit C6 (F35 item 16): the brick Stripe's style cycle is the user's A/B (/C) picks, resolved against
 * the declared BRICK_STRIPE_STYLES (editor/editor-brick-tool.js). The default picks are the old fixed
 * 2-style cycle, so a board striped before this looks the same.
 */
import { describe, it, expect } from 'vitest';
import { BRICK_STRIPE_STYLES, DEFAULT_STRIPE_STYLE_PICKS, stripeCycleFor } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

const short = (cycle) => cycle.map((s) => [s.setId, s.profile]);

describe('stripeCycleFor', () => {
  it('default = the old cycle: red bricks, then white rocks as one band', () => {
    expect(short(stripeCycleFor())).toEqual([[1, 'bricks'], [3, 'continuous']]);
    expect(short(stripeCycleFor(DEFAULT_STRIPE_STYLE_PICKS))).toEqual([[1, 'bricks'], [3, 'continuous']]);
  });
  it('Use C = 3 slots; the picks decide each slot', () => {
    expect(stripeCycleFor(['white_bricks', 'red_continuous', 'red_bricks'], true).map((s) => s.id))
      .toEqual(['white_bricks', 'red_continuous', 'red_bricks']);
  });
  it('an unknown or missing pick falls back to that slot\'s default', () => {
    expect(stripeCycleFor(['bogus'], true).map((s) => s.id)).toEqual(DEFAULT_STRIPE_STYLE_PICKS);
  });
  it('every declared style is a real set + profile', () => {
    for (const s of BRICK_STRIPE_STYLES) {
      expect([1, 3]).toContain(s.setId);
      expect(['bricks', 'continuous']).toContain(s.profile);
    }
  });
});

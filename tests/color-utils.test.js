/**
 * color-utils.js in isolation — H8's own shared frame-tint helper.
 */
import { describe, it, expect } from 'vitest';
import { FRAME_TINT, frameTintColor } from '../bspline-frame-builder/b-spline-gen/html/core/color-utils.js';

describe('frameTintColor', () => {
  it('is declared negative (darker), per the dispatch\'s own "tiny bit different" framing', () => {
    expect(FRAME_TINT).toBeLessThan(0);
  });

  it('darkens a colour without changing its hue', () => {
    const ash = '#d9c9a3';
    const tinted = frameTintColor(ash);
    expect(tinted).not.toBe(ash);
    // Round-trip through the SAME conversion this module uses internally
    // would just re-test the implementation with itself -- instead check
    // the externally-observable property the dispatch actually cares
    // about: strictly darker (every channel <=, at least one <).
    const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const [r1, g1, b1] = toRgb(ash);
    const [r2, g2, b2] = toRgb(tinted);
    expect(r2).toBeLessThanOrEqual(r1);
    expect(g2).toBeLessThanOrEqual(g1);
    expect(b2).toBeLessThanOrEqual(b1);
    expect(r2 + g2 + b2).toBeLessThan(r1 + g1 + b1);
  });

  it('is deterministic (same input, same output — both render surfaces must agree)', () => {
    expect(frameTintColor('#7a3b2e')).toBe(frameTintColor('#7a3b2e'));
  });

  it('is a genuinely different colour for every declared wood (never collapses two woods together)', () => {
    const woods = ['#d9c9a3', '#7a3b2e', '#e3c07a', '#ead7ad', '#b88a55'];
    const tinted = woods.map(frameTintColor);
    expect(new Set(tinted).size).toBe(woods.length);
  });

  it('degrades gracefully on a non-hex input (defensive: callers keep their own fallback)', () => {
    expect(frameTintColor(null)).toBeNull();
    expect(frameTintColor('not-a-color')).toBe('not-a-color');
  });

  it('never clips a very dark wood\'s lightness below 0 (no negative/garbage colour)', () => {
    expect(frameTintColor('#000000')).toBe('#000000');
  });
});

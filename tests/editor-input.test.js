/**
 * SE7m — editor-input.js: INPUT_PROFILE lookup, pinch math, and the
 * second-pointer-cancels-draw decision. Pure module, no DOM — directly
 * unit-testable, unlike the pointer-event WIRING in editor-interaction.js
 * that calls these (no full pointer-event pipeline mock exists in this
 * suite — same disclosed gap as prior turns' handleEnd/open() wiring).
 */
import { describe, it, expect } from 'vitest';
import {
  INPUT_PROFILE, inputProfileFor, computePinchUpdate,
  shouldCancelDrawOnPointerDown, isPinching,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-input.js';

describe('INPUT_PROFILE / inputProfileFor', () => {
  it("mouse's slopPx/grabPx match the pre-SE7m hardcoded defaults exactly (10, 15) — SE7m widens touch, doesn't change mouse", () => {
    expect(INPUT_PROFILE.mouse.slopPx).toBe(10);
    expect(INPUT_PROFILE.mouse.grabPx).toBe(15);
  });

  it('touch and pen both size larger than mouse for every field (fingers/pens need more slop than a precise cursor)', () => {
    for (const field of ['slopPx', 'grabPx', 'handlePx']) {
      expect(INPUT_PROFILE.touch[field]).toBeGreaterThan(INPUT_PROFILE.mouse[field]);
    }
  });

  it('inputProfileFor resolves each known pointerType to its own row', () => {
    expect(inputProfileFor('mouse')).toBe(INPUT_PROFILE.mouse);
    expect(inputProfileFor('touch')).toBe(INPUT_PROFILE.touch);
    expect(inputProfileFor('pen')).toBe(INPUT_PROFILE.pen);
  });

  it('inputProfileFor defaults to mouse for unknown/empty pointerType (never a regression for a non-conforming UA)', () => {
    expect(inputProfileFor('')).toBe(INPUT_PROFILE.mouse);
    expect(inputProfileFor(undefined)).toBe(INPUT_PROFILE.mouse);
    expect(inputProfileFor('bluetooth-stylus-typo')).toBe(INPUT_PROFILE.mouse);
  });
});

describe('computePinchUpdate: pinch geometry', () => {
  it('factor 1 (no zoom) when the finger distance is unchanged', () => {
    const prev = { p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 } };
    const next = { p1: { x: 10, y: 0 }, p2: { x: 110, y: 0 } }; // slid right together, same spread
    const { factor } = computePinchUpdate(prev, next);
    expect(factor).toBeCloseTo(1, 10);
  });

  it('factor > 1 (zoom in) when fingers spread apart', () => {
    const prev = { p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 } };
    const next = { p1: { x: -50, y: 0 }, p2: { x: 150, y: 0 } }; // distance 100 -> 200
    const { factor } = computePinchUpdate(prev, next);
    expect(factor).toBeCloseTo(2, 10);
  });

  it('factor < 1 (zoom out) when fingers pinch together', () => {
    const prev = { p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 } };
    const next = { p1: { x: 25, y: 0 }, p2: { x: 75, y: 0 } }; // distance 100 -> 50
    const { factor } = computePinchUpdate(prev, next);
    expect(factor).toBeCloseTo(0.5, 10);
  });

  it('midpoint is the CURRENT (next) frame\'s midpoint, not the previous one', () => {
    const prev = { p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 } };
    const next = { p1: { x: 40, y: 20 }, p2: { x: 160, y: 60 } };
    const { midpoint } = computePinchUpdate(prev, next);
    expect(midpoint).toEqual({ x: 100, y: 40 });
  });

  it('degenerate previous distance (both fingers on the same point) returns factor 1, not NaN/Infinity', () => {
    const prev = { p1: { x: 50, y: 50 }, p2: { x: 50, y: 50 } };
    const next = { p1: { x: 40, y: 40 }, p2: { x: 60, y: 60 } };
    const { factor } = computePinchUpdate(prev, next);
    expect(factor).toBe(1);
    expect(Number.isFinite(factor)).toBe(true);
  });

  it('two consecutive incremental updates compose multiplicatively (frame-over-frame, not pinch-start-relative)', () => {
    // distance 100 -> 150 (factor 1.5), then 150 -> 300 (factor 2) —
    // overall the fingers went from 100 apart to 300 apart (factor 3
    // total), which is exactly 1.5 * 2. This is the property that lets
    // the caller apply zoomAbout() once per frame instead of tracking a
    // pinch-start snapshot forever.
    const f0 = { p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 } };
    const f1 = { p1: { x: -25, y: 0 }, p2: { x: 125, y: 0 } }; // 150 apart
    const f2 = { p1: { x: -100, y: 0 }, p2: { x: 200, y: 0 } }; // 300 apart
    const step1 = computePinchUpdate(f0, f1);
    const step2 = computePinchUpdate(f1, f2);
    expect(step1.factor * step2.factor).toBeCloseTo(3, 10);
  });
});

describe('shouldCancelDrawOnPointerDown: the SA-MOBILE-14/15 decision', () => {
  it('true exactly when the second pointer lands WHILE a draw is in progress', () => {
    expect(shouldCancelDrawOnPointerDown(2, true)).toBe(true);
  });

  it('false when the second pointer lands but nothing is being drawn (e.g. Select mode)', () => {
    expect(shouldCancelDrawOnPointerDown(2, false)).toBe(false);
  });

  it('false for the FIRST pointer, drawing or not (nothing to cancel yet, and shouldn\'t cancel itself)', () => {
    expect(shouldCancelDrawOnPointerDown(1, true)).toBe(false);
    expect(shouldCancelDrawOnPointerDown(1, false)).toBe(false);
  });

  it('false for a third+ pointer — already handled when the second one landed, not re-triggered', () => {
    expect(shouldCancelDrawOnPointerDown(3, true)).toBe(false);
    expect(shouldCancelDrawOnPointerDown(4, true)).toBe(false);
  });
});

describe('isPinching', () => {
  it('true only at exactly 2 active pointers', () => {
    expect(isPinching(2)).toBe(true);
  });
  it('false at 0, 1, or 3+ pointers', () => {
    expect(isPinching(0)).toBe(false);
    expect(isPinching(1)).toBe(false);
    expect(isPinching(3)).toBe(false);
  });
});

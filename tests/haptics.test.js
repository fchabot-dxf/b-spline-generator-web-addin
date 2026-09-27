/**
 * core/haptics.js in isolation — H13's declared {event -> pattern} table +
 * haptic(event), the Settings toggle, and the snap-engagement rate limit.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  HAPTIC_PATTERNS, haptic, isHapticEnabled, setHapticEnabled, hapticSnap, resetHapticSnap,
} from '../bspline-frame-builder/b-spline-gen/html/core/haptics.js';
import { setIsFusionMode } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

describe('HAPTIC_PATTERNS', () => {
  it('declares a pattern for every H13 event', () => {
    expect(HAPTIC_PATTERNS).toEqual({
      snap: 5,
      limit: 15,
      multiselect: [10, 30, 10],
      contextMenu: 8,
      cutJoin: 8,
    });
  });
});

describe('haptic(event)', () => {
  let vibrate;

  beforeEach(() => {
    setHapticEnabled(true);
    setIsFusionMode(false);
    vibrate = vi.fn();
    navigator.vibrate = vibrate;
  });

  afterEach(() => {
    delete navigator.vibrate;
  });

  it('calls navigator.vibrate with the declared pattern, for each event', () => {
    for (const [event, pattern] of Object.entries(HAPTIC_PATTERNS)) {
      vibrate.mockClear();
      haptic(event);
      expect(vibrate).toHaveBeenCalledWith(pattern);
    }
  });

  it('does nothing for an unknown event (no throw, no vibrate call)', () => {
    expect(() => haptic('notARealEvent')).not.toThrow();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('does nothing when the toggle is off', () => {
    setHapticEnabled(false);
    haptic('limit');
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('does nothing inside Fusion, even with the toggle on', () => {
    setIsFusionMode(true);
    haptic('limit');
    expect(vibrate).not.toHaveBeenCalled();
    setIsFusionMode(false); // restore for later tests
  });

  it('reflects isHapticEnabled() after setHapticEnabled()', () => {
    setHapticEnabled(false);
    expect(isHapticEnabled()).toBe(false);
    setHapticEnabled(true);
    expect(isHapticEnabled()).toBe(true);
  });

  it('persists the toggle to localStorage', () => {
    setHapticEnabled(false);
    expect(localStorage.getItem('bspline.editor.hapticEnabled')).toBe('0');
    setHapticEnabled(true);
    expect(localStorage.getItem('bspline.editor.hapticEnabled')).toBe('1');
  });
});

describe('haptic(event) without navigator.vibrate (iOS Safari has none)', () => {
  beforeEach(() => {
    setHapticEnabled(true);
    setIsFusionMode(false);
    delete navigator.vibrate;
  });

  it('does not throw when there is no vibrate support', () => {
    expect(() => haptic('contextMenu')).not.toThrow();
  });

  it('falls through to a real .click() on a hidden switch checkbox', () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click');
    haptic('contextMenu');
    expect(clickSpy).toHaveBeenCalled();
    const el = clickSpy.mock.instances[0];
    expect(el.type).toBe('checkbox');
    expect(el.getAttribute('switch')).toBe('');
    expect(document.body.contains(el)).toBe(true);
    clickSpy.mockRestore();
  });

  it('reuses the same hidden checkbox across calls (no DOM churn)', () => {
    haptic('snap');
    const count1 = document.querySelectorAll('input[switch]').length;
    haptic('snap');
    const count2 = document.querySelectorAll('input[switch]').length;
    expect(count1).toBe(1);
    expect(count2).toBe(1);
  });
});

describe('hapticSnap (the rate limit)', () => {
  let vibrate;

  beforeEach(() => {
    setHapticEnabled(true);
    setIsFusionMode(false);
    resetHapticSnap();
    vibrate = vi.fn();
    navigator.vibrate = vibrate;
  });

  afterEach(() => {
    delete navigator.vibrate;
  });

  it('fires once on entering a snap (false -> true)', () => {
    hapticSnap(false);
    expect(vibrate).not.toHaveBeenCalled();
    hapticSnap(true);
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(HAPTIC_PATTERNS.snap);
  });

  it('does NOT fire again while remaining snapped (no continuous buzz)', () => {
    hapticSnap(true);
    hapticSnap(true);
    hapticSnap(true);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('fires again after disengaging and re-engaging', () => {
    hapticSnap(true);
    hapticSnap(false);
    hapticSnap(true);
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it('resetHapticSnap() makes the next engaged call fire again, even if it was already engaged', () => {
    hapticSnap(true);
    resetHapticSnap();
    hapticSnap(true);
    expect(vibrate).toHaveBeenCalledTimes(2);
  });
});

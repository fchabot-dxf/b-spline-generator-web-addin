/**
 * MOB6 (Fred, phone: "I can't scroll without changing params
 * inadvertently") — main/slider-scroll-guard.js's DOM-level backstop:
 * a touch gesture on a range input that resolves as a vertical scroll
 * (moved mostly vertically) must restore the value it started at; one
 * that resolves as a horizontal drag must not be touched. Desktop mouse
 * pointerType is untouched entirely.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { attachSliderScrollGuard } from '../bspline-frame-builder/b-spline-gen/html/main/slider-scroll-guard.js';

function fire(type, target, { pointerType = 'touch', clientX = 0, clientY = 0 } = {}) {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerType, clientX, clientY });
  target.dispatchEvent(event);
  return event;
}

describe('attachSliderScrollGuard', () => {
  let slider, inputEvents;

  beforeEach(() => {
    attachSliderScrollGuard();
    slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.value = '50';
    document.body.appendChild(slider);
    inputEvents = [];
    slider.addEventListener('input', () => inputEvents.push(slider.value));
  });

  afterEach(() => {
    slider.remove();
  });

  it('a touch that moves mostly VERTICALLY restores the value it started at (a scroll, not a drag)', () => {
    fire('pointerdown', slider, { clientX: 100, clientY: 100 });
    // The browser's own native touch handling may have already jumped
    // the value to the touch position before our listener runs — same
    // as Chrome Android's own documented quirk this guard defends
    // against. Simulate that jump explicitly.
    slider.value = '80';

    fire('pointermove', slider, { clientX: 101, clientY: 130 }); // dy=30, dx=1 -> scroll
    fire('pointerup', slider, { clientX: 101, clientY: 130 });

    expect(slider.value).toBe('50');
    expect(inputEvents).toEqual(['50']); // the restore fired a real input event
  });

  it('a touch that moves mostly HORIZONTALLY leaves the (already-changed) value alone — a real drag', () => {
    fire('pointerdown', slider, { clientX: 100, clientY: 100 });
    slider.value = '80'; // the drag itself changing the value, same as native behavior

    fire('pointermove', slider, { clientX: 140, clientY: 101 }); // dx=40, dy=1 -> drag
    fire('pointerup', slider, { clientX: 140, clientY: 101 });

    expect(slider.value).toBe('80');
    expect(inputEvents).toEqual([]); // no restore — nothing to undo
  });

  it('movement below the 8px threshold in either axis stays unresolved and does not touch the value', () => {
    fire('pointerdown', slider, { clientX: 100, clientY: 100 });
    slider.value = '80';

    fire('pointermove', slider, { clientX: 103, clientY: 105 }); // dx=3, dy=5, both under threshold
    fire('pointerup', slider, { clientX: 103, clientY: 105 });

    expect(slider.value).toBe('80');
    expect(inputEvents).toEqual([]);
  });

  it('a MOUSE drag (pointerType "mouse") is never touched by the guard — desktop unchanged', () => {
    fire('pointerdown', slider, { pointerType: 'mouse', clientX: 100, clientY: 100 });
    slider.value = '80';

    fire('pointermove', slider, { pointerType: 'mouse', clientX: 101, clientY: 130 }); // would be "scroll" shape on touch
    fire('pointerup', slider, { pointerType: 'mouse', clientX: 101, clientY: 130 });

    expect(slider.value).toBe('80');
    expect(inputEvents).toEqual([]);
  });

  it('once a gesture resolves as a scroll, FURTHER vertical movement in the same gesture does not fire a second restore', () => {
    fire('pointerdown', slider, { clientX: 100, clientY: 100 });
    slider.value = '80';
    fire('pointermove', slider, { clientX: 101, clientY: 130 }); // resolves as scroll, restores once
    fire('pointermove', slider, { clientX: 102, clientY: 160 }); // still scrolling
    fire('pointerup', slider, { clientX: 102, clientY: 160 });

    expect(slider.value).toBe('50');
    expect(inputEvents).toEqual(['50']); // exactly one restore, not one per move
  });

  it('a NEW gesture after pointerup is independent — a scroll does not poison a later drag', () => {
    // First gesture: a scroll, restores to 50.
    fire('pointerdown', slider, { clientX: 100, clientY: 100 });
    slider.value = '80';
    fire('pointermove', slider, { clientX: 101, clientY: 130 });
    fire('pointerup', slider, { clientX: 101, clientY: 130 });
    expect(slider.value).toBe('50');

    // Second, separate gesture: a genuine horizontal drag to 65.
    fire('pointerdown', slider, { clientX: 50, clientY: 50 });
    slider.value = '65';
    fire('pointermove', slider, { clientX: 90, clientY: 51 });
    fire('pointerup', slider, { clientX: 90, clientY: 51 });

    expect(slider.value).toBe('65');
  });
});

/**
 * MOB6 + Fred ("Scrolling on forms is changing slider values") -- main/slider-scroll-guard.js: while a touch
 * on a range input is undecided, the slider's input/change events are HELD from the app. A gesture that turns
 * out to be a scroll (vertical first, or the browser cancelling the pointer to pan) puts the value back
 * silently, so the app never sees a change; a horizontal drag or a plain tap releases the value. Mouse is
 * untouched.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { attachSliderScrollGuard } from '../bspline-frame-builder/b-spline-gen/html/main/slider-scroll-guard.js';

function fire(type, target, { pointerType = 'touch', clientX = 0, clientY = 0 } = {}) {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerType, clientX, clientY });
  target.dispatchEvent(event);
  return event;
}

describe('attachSliderScrollGuard', () => {
  let slider, inputEvents, changeEvents;
  // The browser moving the thumb to the touched spot: a value change plus its native input event.
  const nativeJump = (v) => { slider.value = v; slider.dispatchEvent(new Event('input', { bubbles: true })); };

  beforeEach(() => {
    attachSliderScrollGuard();
    attachSliderScrollGuard(); // idempotent: a second call must not add a second guard
    slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.value = '50';
    document.body.appendChild(slider);
    inputEvents = [];
    changeEvents = [];
    slider.addEventListener('input', () => inputEvents.push(slider.value));
    slider.addEventListener('change', () => changeEvents.push(slider.value));
  });

  afterEach(() => {
    slider.remove();
  });

  it('a touch that moves mostly VERTICALLY restores the value and the app never sees the jump', () => {
    fire('pointerdown', slider, { clientX: 100, clientY: 100 });
    nativeJump('80');
    fire('pointermove', slider, { clientX: 101, clientY: 130 }); // dy=30 -> scroll
    fire('pointerup', slider, { clientX: 101, clientY: 130 });

    expect(slider.value).toBe('50');
    expect(inputEvents).toEqual([]);
    expect(changeEvents).toEqual([]);
  });

  it('the browser cancelling the pointer (it took the gesture as a pan) before 8px also restores', () => {
    fire('pointerdown', slider, { clientX: 100, clientY: 100 });
    nativeJump('80');
    fire('pointermove', slider, { clientX: 100, clientY: 104 }); // under the threshold
    fire('pointercancel', slider, { clientX: 100, clientY: 104 });

    expect(slider.value).toBe('50');
    expect(inputEvents).toEqual([]);
  });

  it('a touch that moves mostly HORIZONTALLY releases the held value, then the drag flows normally', () => {
    fire('pointerdown', slider, { clientX: 100, clientY: 100 });
    nativeJump('80');
    expect(inputEvents).toEqual([]); // held while undecided
    fire('pointermove', slider, { clientX: 140, clientY: 101 }); // dx=40 -> drag
    expect(inputEvents).toEqual(['80']);
    nativeJump('90');
    fire('pointerup', slider, { clientX: 140, clientY: 101 });

    expect(slider.value).toBe('90');
    expect(inputEvents).toEqual(['80', '90']);
    expect(changeEvents).toEqual([]); // the browser's own change on release is not ours to send
  });

  it('a plain TOUCH (released below the threshold) changes nothing -- only a sideways drag moves a slider', () => {
    fire('pointerdown', slider, { clientX: 100, clientY: 100 });
    nativeJump('80');
    fire('pointermove', slider, { clientX: 103, clientY: 105 });
    fire('pointerup', slider, { clientX: 103, clientY: 105 });

    expect(slider.value).toBe('50');
    expect(inputEvents).toEqual([]);
    expect(changeEvents).toEqual([]);
  });

  it('a MOUSE drag (pointerType "mouse") is never touched by the guard -- desktop unchanged', () => {
    fire('pointerdown', slider, { pointerType: 'mouse', clientX: 100, clientY: 100 });
    nativeJump('80');
    fire('pointermove', slider, { pointerType: 'mouse', clientX: 101, clientY: 130 });
    fire('pointerup', slider, { pointerType: 'mouse', clientX: 101, clientY: 130 });

    expect(slider.value).toBe('80');
    expect(inputEvents).toEqual(['80']);
  });

  it('native input during a resolved scroll is still held and the value kept put back', () => {
    fire('pointerdown', slider, { clientX: 100, clientY: 100 });
    nativeJump('80');
    fire('pointermove', slider, { clientX: 101, clientY: 130 });
    nativeJump('20');
    fire('pointerup', slider, { clientX: 102, clientY: 160 });

    expect(slider.value).toBe('50');
    expect(inputEvents).toEqual([]);
  });

  it('a NEW gesture after pointerup is independent -- a scroll does not poison a later drag', () => {
    fire('pointerdown', slider, { clientX: 100, clientY: 100 });
    nativeJump('80');
    fire('pointermove', slider, { clientX: 101, clientY: 130 });
    fire('pointerup', slider, { clientX: 101, clientY: 130 });
    expect(slider.value).toBe('50');

    fire('pointerdown', slider, { clientX: 50, clientY: 50 });
    nativeJump('65');
    fire('pointermove', slider, { clientX: 90, clientY: 51 });
    fire('pointerup', slider, { clientX: 90, clientY: 51 });

    expect(slider.value).toBe('65');
    expect(inputEvents).toEqual(['65']);
  });
});

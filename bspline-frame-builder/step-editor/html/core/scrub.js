/**
 * scrub.js — drag-to-scrub on every number input.
 *
 * Hover any <input type="number"> in the palette → cursor switches to ↔
 * → click and drag horizontally to scrub the value up/down. Same pattern
 * Figma, Blender, and most modern parametric tools use.
 *
 * Modifiers:
 *   Shift  — 10× speed (coarse adjust)
 *   Alt    — 0.1× speed (fine adjust)
 *   Ctrl   — snap to whole multiples of step
 *
 * Click without dragging (movement < CLICK_THRESHOLD px) falls through
 * to the input's normal focus/edit behaviour, so typing values stays
 * unchanged.
 *
 * Each scrub fires a synthetic `input` event on every move and a `change`
 * event on release, so existing tool-panel handlers (which listen for
 * `input` already) light up the same way they do for typed edits.
 */

const CLICK_THRESHOLD = 3;    // px — below this we treat the gesture as a click
const PX_PER_STEP_DEFAULT = 4; // px the mouse must travel for 1× the input's step
const ATTACHED = '__scrubAttached';

/**
 * Attach scrub behaviour to a single <input>. Idempotent — repeated
 * calls on the same element are no-ops.
 *
 * @param {HTMLInputElement} input
 */
export function attachScrub(input) {
  if (!input || input.type !== 'number' || input[ATTACHED]) return;
  input[ATTACHED] = true;

  input.style.cursor = 'ew-resize';

  input.addEventListener('mousedown', (downEv) => {
    // Right-click / middle-click — let the browser handle.
    if (downEv.button !== 0) return;
    // If the input is already focused, the user is probably trying to
    // place a caret to type. Don't intercept those clicks.
    if (document.activeElement === input) return;

    downEv.preventDefault();
    const startX     = downEv.clientX;
    const startValue = parseFloat(input.value);
    const step       = parseFloat(input.step) || 1;
    const min        = input.min !== '' ? parseFloat(input.min) : -Infinity;
    const max        = input.max !== '' ? parseFloat(input.max) :  Infinity;
    let moved = false;

    // Lock pointer so the cursor stays in the input area even when the
    // mouse exits horizontally. Falls back gracefully if the browser
    // doesn't support it.
    const supportsPointerLock = typeof input.requestPointerLock === 'function';
    let lockedDx = 0;

    function onMove(ev) {
      const dxAbs = supportsPointerLock
        ? (lockedDx += ev.movementX || 0)
        : ev.clientX - startX;
      if (!moved && Math.abs(dxAbs) > CLICK_THRESHOLD) moved = true;
      if (!moved) return;

      const multiplier =
        ev.shiftKey ? 10 :
        ev.altKey   ? 0.1 :
        1;
      const pxPerStep = PX_PER_STEP_DEFAULT;
      const stepsDragged = (dxAbs / pxPerStep) * multiplier;

      let next = startValue + stepsDragged * step;
      if (ev.ctrlKey || ev.metaKey) {
        // Snap to whole-step multiples.
        next = Math.round(next / step) * step;
      }
      next = Math.min(max, Math.max(min, next));
      // Decimal precision: match the step's decimal count.
      const decimals = (String(step).split('.')[1] || '').length;
      input.value = decimals > 0 ? next.toFixed(decimals) : String(Math.round(next));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (supportsPointerLock && document.pointerLockElement === input) {
        try { document.exitPointerLock(); } catch (_) {}
      }
      if (!moved) {
        // Treat as a plain click: focus + select the value for easy retype.
        input.focus();
        input.select();
        return;
      }
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (supportsPointerLock) {
      try { input.requestPointerLock(); } catch (_) {}
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp, { once: false });
  });
}

/**
 * Walk the DOM and attach scrub behaviour to every number input that
 * doesn't already have it. Safe to call repeatedly — useful after the
 * palette dynamically reveals a tool panel for the first time.
 */
export function attachScrubAll(root = document) {
  for (const input of root.querySelectorAll('input[type="number"]')) {
    attachScrub(input);
  }
}

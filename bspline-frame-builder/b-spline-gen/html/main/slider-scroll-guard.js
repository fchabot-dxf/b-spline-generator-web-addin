/**
 * slider-scroll-guard.js — MOB6 (Fred, phone: "On UI where there is a
 * lot of sliders I can't scroll without changing params inadvertently").
 *
 * ONE delegated, document-level guard rather than per-slider wiring, so
 * it covers every `input[type=range]` app-wide: the main palette's own
 * sliders, the SVG editor's Shape/box Lattice panel sliders (static
 * HTML, present from page load), AND sliders that don't exist yet at
 * bind time — core/noise/tweaks-ui.js's "Edit Filter" sub-panel builds
 * its own `<input type="range">` elements lazily, which a one-time
 * `querySelectorAll` sweep (main/ui-bindings.js's own
 * attachNumberSteppers, a similar per-control enhancement) would
 * silently miss. No dependency on this app's own state/history/param
 * modules — kept a standalone, zero-dependency file so it's testable in
 * isolation, same reasoning splitter.js's own file split already used.
 *
 * `touch-action: pan-y` (styles/base.css, applied to every
 * `input[type="range"]`) is the PRIMARY fix — it tells the browser a
 * vertical swipe over the track is a page scroll, not a drag, so the
 * panel scrolls under the user's finger instead of the thumb jumping to
 * wherever they touched. This guard is the documented backstop for
 * Chrome Android's own quirk: it can commit the slider's value to the
 * touched position on the very first touch contact, before the browser
 * has recognized the gesture as a vertical scroll and started panning —
 * by the time that recognition happens, the value has already jumped.
 * Recording the value on pointerdown and restoring it the moment the
 * gesture resolves as vertical-scroll-dominant (moved > 8px vertically
 * before > 8px horizontally) undoes that premature jump; a horizontal
 * drag resolves the opposite way and is left alone.
 *
 * `pointerType !== 'touch'` is the ONE gate that keeps desktop mouse
 * behavior completely unchanged — a mouse drag never enters this guard
 * at all, matching the dispatch's own "desktop stays unchanged."
 */

const DIRECTION_THRESHOLD_PX = 8;

/*
 * Fred (again, phone: "Scrolling on forms is changing slider values"): restoring the value AFTER the fact
 * wasn't enough. The app had already seen the jumped value (a live regen, a history step), and a scroll the
 * browser claimed before an 8px move ended in `pointercancel`, which used to reset WITHOUT restoring. Now:
 *   - while the gesture is undecided, the slider's own `input`/`change` events are HELD (swallowed in the
 *     capture phase, before any app listener), so nothing reacts to the touched position yet;
 *   - scroll (vertical first, or the browser cancelling the pointer = it took the gesture as a pan):
 *     the value is put back silently, and the app never saw a change;
 *   - a plain touch (released without moving 8px): also put back -- Fred: "It's moving the slider because I
 *     touch them" -- so on touch ONLY a sideways drag moves a slider;
 *   - drag (horizontal first): the held value is released as
 *     an input (the browser's own change follows on release), and the rest of a drag flows normally.
 */
let attached = false;

export function attachSliderScrollGuard() {
  if (attached) return; // one document-level guard; a second copy would hold the first one's released events
  attached = true;
  let target = null;
  let startValue = null;
  let startX = 0;
  let startY = 0;
  let resolved = null; // null while ambiguous, then 'scroll' | 'drag'

  function reset() {
    target = null;
    startValue = null;
    resolved = null;
  }

  function release() {
    const el = target;
    resolved = 'drag';
    // input only: the browser's own `change` still arrives on release (a second one would be a duplicate)
    if (el && el.value !== startValue) el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function restore() {
    resolved = 'scroll';
    if (target && target.value !== startValue) target.value = startValue; // silent: nobody saw the jump
  }

  const hold = (e) => {
    if (!target || e.target !== target) return;
    if (resolved === 'drag') return;
    e.stopImmediatePropagation();
    if (resolved === 'scroll' && target.value !== startValue) target.value = startValue;
  };
  document.addEventListener('input', hold, true);
  document.addEventListener('change', hold, true);

  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || e.target?.type !== 'range') return;
    target = e.target;
    startValue = target.value; // pointerdown comes before the browser moves the value (verified in Chromium)
    startX = e.clientX;
    startY = e.clientY;
    resolved = null;
  }, { passive: true, capture: true });

  document.addEventListener('pointermove', (e) => {
    if (!target || resolved) return;
    const dx = Math.abs(e.clientX - startX);
    const dy = Math.abs(e.clientY - startY);
    if (dy > DIRECTION_THRESHOLD_PX && dy > dx) restore();
    else if (dx > DIRECTION_THRESHOLD_PX && dx >= dy) release();
  }, { passive: true });

  document.addEventListener('pointerup', () => {
    // Fred: "It's moving the slider because I touch them" -- a touch that never became a sideways drag
    // (a tap, a rest, a scroll start) changes nothing; only a horizontal drag moves a slider on touch.
    if (target && !resolved) restore();
    reset();
  }, { passive: true });
  document.addEventListener('pointercancel', () => {
    if (target && resolved !== 'drag') restore(); // the browser took it as a scroll
    reset();
  }, { passive: true });
}

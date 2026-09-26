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

export function attachSliderScrollGuard() {
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

  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || e.target?.type !== 'range') return;
    target = e.target;
    startValue = target.value;
    startX = e.clientX;
    startY = e.clientY;
    resolved = null;
  }, { passive: true });

  document.addEventListener('pointermove', (e) => {
    if (!target || resolved) return;
    const dx = Math.abs(e.clientX - startX);
    const dy = Math.abs(e.clientY - startY);
    if (dy > DIRECTION_THRESHOLD_PX && dy > dx) {
      resolved = 'scroll';
      if (target.value !== startValue) {
        target.value = startValue;
        // Real events (not just a property set) so anything already
        // listening for live updates (bind()/syncPair, core/ui-utils.js)
        // sees the restored value the same way it'd see a real edit.
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else if (dx > DIRECTION_THRESHOLD_PX && dx >= dy) {
      resolved = 'drag';
    }
  }, { passive: true });

  document.addEventListener('pointerup', reset, { passive: true });
  document.addEventListener('pointercancel', reset, { passive: true });
}

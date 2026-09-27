/**
 * H13 HAPTICS (Fred: "all of them"): ONE declared {event -> pattern} table +
 * haptic(event) -- nothing hand-rolled at call sites. Backends:
 *   - Android/Chrome: navigator.vibrate(pattern) -- the full declared
 *     pattern (a number or an on/off array) plays.
 *   - iOS/iPadOS Safari 18+: has no navigator.vibrate at all, so it falls
 *     through to the hidden `<input type="checkbox" switch>` trick -- a
 *     REAL activation (`.click()`, not just setting `.checked`) of a
 *     switch-styled checkbox fires the system's own haptic tap. This can
 *     only ever produce ONE tap per call (there is no pattern control),
 *     so every event feels the same single tick on iOS regardless of its
 *     declared pattern -- a known, accepted degradation, not a bug.
 *     UNVERIFIED ON REAL HARDWARE: this is the documented mechanism, but
 *     it has not been confirmed to actually buzz on Fred's own iPad --
 *     ask him to check the feel (see WORK-LOG for which gestures to try).
 *   - desktop / Fusion palette: no-op (isFusionMode short-circuits it
 *     outright; a plain desktop browser also no-ops naturally, since it
 *     has neither navigator.vibrate nor real haptic hardware behind the
 *     switch trick).
 */
import { isFusionMode } from './state.js';

export const HAPTIC_PATTERNS = {
  // Entering a snap (grid or geometry) during a drag -- tiny tick.
  snap: 5,
  // A clamped drag hits its bound (frame Shoulder/Hip/waist handles, Shape
  // Lattice handles, cut-joint pushes, lip/trim ranges) -- firm bump.
  limit: 15,
  // Multiselect add/remove via double-tap-and-hold -- double tick.
  multiselect: [10, 30, 10],
  // Context menu opens -- tick.
  contextMenu: 8,
  // A cut or a join completes -- tick.
  cutJoin: 8,
};

const ENABLED_KEY = 'bspline.editor.hapticEnabled';

function _defaultEnabled() {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch (_) {
    return false;
  }
}

function _loadEnabled() {
  try {
    const raw = localStorage.getItem(ENABLED_KEY);
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch (_) { /* localStorage unavailable -- fall through to the default */ }
  return _defaultEnabled();
}

let _enabled = _loadEnabled();

export function isHapticEnabled() {
  return _enabled;
}

export function setHapticEnabled(value) {
  _enabled = !!value;
  try {
    localStorage.setItem(ENABLED_KEY, _enabled ? '1' : '0');
  } catch (_) { /* localStorage unavailable -- the in-memory flag still works this session */ }
}

let _iosSwitchEl = null;

function _fireIosSwitch() {
  if (!_iosSwitchEl) {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.setAttribute('switch', '');
    el.setAttribute('aria-hidden', 'true');
    el.tabIndex = -1;
    el.style.cssText = 'position:fixed; left:-9999px; top:-9999px; width:1px; height:1px; opacity:0; pointer-events:none;';
    document.body.appendChild(el);
    _iosSwitchEl = el;
  }
  _iosSwitchEl.click();
}

/** Fire the declared pattern for `event`, respecting the Settings toggle
 *  and skipping entirely inside the Fusion palette. Unknown events and a
 *  disabled toggle both no-op silently -- there is nothing a call site
 *  needs to check before calling this. */
export function haptic(event) {
  if (!_enabled || isFusionMode) return;
  const pattern = HAPTIC_PATTERNS[event];
  if (pattern == null) return;
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(pattern);
    return;
  }
  if (typeof document !== 'undefined') _fireIosSwitch();
}

// H13 item 2 (snap must fire only on ENTERING a snap, not continuously
// while snapped): snapFor() (editor-grid.js) is pure/stateless, so the
// engage/disengage transition has to live somewhere -- here, rather than
// duplicated at each of snapFor's several call sites. A call site just
// reports "is a snap active THIS move" every move; hapticSnap tracks the
// previous state itself and only calls haptic('snap') on false -> true.
let _snapEngaged = false;

export function hapticSnap(isEngaged) {
  if (isEngaged && !_snapEngaged) haptic('snap');
  _snapEngaged = isEngaged;
}

/** Call at the start (and end) of a drag: a drag that BEGINS already
 *  snapped in place must still tick once, which a bare false -> true
 *  transition would miss if the previous drag ended snapped too. */
export function resetHapticSnap() {
  _snapEngaged = false;
}

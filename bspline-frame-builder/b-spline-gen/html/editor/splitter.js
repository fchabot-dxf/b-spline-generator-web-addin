/**
 * splitter.js — MOB3 AMEND (Fred: "another option is a draggable handle on
 * the preview panel window"). ONE reusable free-drag splitter behaviour:
 * the editor's bottom drawer handle (editor-drawer.js) and the main
 * screen's mobile preview/sidebar resizer (main/mobile-resizer.js) both
 * wire through this, rather than two hand-rolled drag loops that would
 * drift apart the next time either one needs a fix.
 *
 * Drag is FREE between min()/max(); on release, soft-snaps to whichever
 * declared snap point is within `snapDistance`px, else keeps the custom
 * size. A tap (no real drag — same click-vs-drag distance test as
 * editor-input.js's clickThresholdPx) cycles snap points in declared
 * order. The settled size persists to sessionStorage under `storageKey`
 * — PER SESSION (Fred's own word), not indefinitely.
 *
 * nearestSnap/nextSnap are pure (no DOM) and unit-tested directly —
 * they generalize editor-drawer.js's former cycleDrawerState/
 * nearestDrawerState (superseded, now that both callers share this file),
 * same pure/DOM split as editor-grid.js's/editor-view.js's own.
 */
import { on } from './dom.js';
import { INPUT_PROFILE, inputProfileFor } from './editor-input.js';

const DEFAULT_SNAP_DISTANCE_PX = 24;

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

/** Pure: the declared snap point closest to `px` ({name, px}, or null for
 *  an empty list). */
export function nearestSnap(px, snaps) {
  let best = null;
  let bestDist = Infinity;
  for (const s of snaps) {
    const d = Math.abs(s.px - px);
    if (d < bestDist) { best = s; bestDist = d; }
  }
  return best;
}

/** Pure: the snap declared AFTER whichever one is nearest to `px`,
 *  wrapping around — tap-to-cycle's own math. An empty list resolves to
 *  null; ties resolve via nearestSnap's own first-declared-wins rule. */
export function nextSnap(px, snaps) {
  if (!snaps.length) return null;
  const near = nearestSnap(px, snaps);
  const idx = near ? snaps.findIndex((s) => s.name === near.name) : -1;
  return snaps[(idx + 1 + snaps.length) % snaps.length];
}

/**
 * @param {HTMLElement} target - the element this splitter's size describes
 *   (read via getBoundingClientRect unless `readSize` overrides it; written
 *   via inline style unless `applySize` overrides it — the main-screen
 *   splitter overrides both, since its "size" is a grid-template-rows
 *   track on a DIFFERENT ancestor, not target's own style.height).
 * @param {object} opts
 * @param {HTMLElement} opts.handle - the drag handle (pointer events attach here).
 * @param {'height'|'width'} [opts.axis='height']
 * @param {(clientCoord: number, drag: {startCoord: number, startSize: number}) => number} opts.computeRawSize
 *   Pointer position -> raw (unclamped) size. Free to ignore `drag`
 *   entirely for an absolute-position mapping (main-screen's own case).
 * @param {() => Array<{name: string, px: number}>} opts.snaps - current
 *   candidate snap points, re-evaluated live (viewport-relative fractions
 *   move with it).
 * @param {() => number} opts.min - hard floor, re-evaluated live.
 * @param {() => number} opts.max - hard ceiling, re-evaluated live.
 * @param {string} [opts.storageKey] - sessionStorage key the last applied size persists under.
 * @param {number} [opts.snapDistance]
 * @param {() => boolean} [opts.enabled] - false suppresses drag entirely
 *   (and the initial/resize auto-apply) — the main-screen splitter's own
 *   "only on phones" gate.
 * @param {string} [opts.initialSnapName] - which named snap a fresh
 *   (no persisted value) session opens at; defaults to `snaps()[0]`.
 * @param {(px: number) => void} [opts.applySize] - default: `target.style[axis] = px+'px'`.
 * @param {() => number} [opts.readSize] - default: `target.getBoundingClientRect()[axis]`.
 * @param {(px: number, snapName: string|null) => void} [opts.onApply] -
 *   called after every applied size (drag-move live, drag-release,
 *   tap-cycle, programmatic setSize/snapTo/reapply).
 * @param {() => void} [opts.onDragStart]
 * @param {() => void} [opts.onDragEnd]
 */
export function makeSplitter(target, {
  handle,
  axis = 'height',
  computeRawSize,
  snaps,
  min,
  max,
  storageKey,
  snapDistance = DEFAULT_SNAP_DISTANCE_PX,
  enabled = () => true,
  initialSnapName,
  applySize,
  readSize,
  onApply,
  onDragStart,
  onDragEnd,
} = {}) {
  const coordProp = axis === 'width' ? 'clientX' : 'clientY';
  const doApplySize = applySize || ((px) => { target.style[axis] = `${px}px`; });
  const doReadSize = readSize || (() => target.getBoundingClientRect()[axis]);

  function persist(px) {
    if (!storageKey) return;
    try { sessionStorage.setItem(storageKey, String(px)); } catch (_) { /* private mode, quota */ }
  }
  function loadPersisted() {
    if (!storageKey) return null;
    try {
      const raw = sessionStorage.getItem(storageKey);
      const n = raw === null ? NaN : Number(raw);
      return Number.isFinite(n) ? n : null;
    } catch (_) {
      return null;
    }
  }

  let lastSnapName = null;
  function apply(px, { persist: doPersist = true } = {}) {
    const clamped = clamp(px, min(), max());
    doApplySize(clamped);
    const near = nearestSnap(clamped, snaps());
    lastSnapName = near && Math.abs(near.px - clamped) < 0.5 ? near.name : null;
    if (doPersist) persist(clamped);
    if (onApply) onApply(clamped, lastSnapName);
    return clamped;
  }

  function initialSize() {
    const persisted = loadPersisted();
    if (persisted != null) return clamp(persisted, min(), max());
    const list = snaps();
    const named = initialSnapName ? list.find((s) => s.name === initialSnapName) : null;
    const first = named || list[0];
    return first ? first.px : min();
  }

  let dragStartCoord = null;
  let dragStartSize = 0;
  let moved = false;

  function onPointerDown(e) {
    if (!enabled()) return;
    dragStartCoord = e[coordProp];
    dragStartSize = doReadSize();
    moved = false;
    if (onDragStart) onDragStart();
    try { handle.setPointerCapture(e.pointerId); } catch (_) { /* defensive: capture can fail on some UAs/synthetic events */ }
  }
  function onPointerMove(e) {
    if (dragStartCoord == null) return;
    const threshold = inputProfileFor(e.pointerType || 'mouse').clickThresholdPx ?? INPUT_PROFILE.mouse.clickThresholdPx;
    if (Math.abs(e[coordProp] - dragStartCoord) > threshold) moved = true;
    const raw = computeRawSize(e[coordProp], { startCoord: dragStartCoord, startSize: dragStartSize });
    apply(raw, { persist: false });
  }
  function onPointerUp() {
    if (dragStartCoord == null) return;
    if (onDragEnd) onDragEnd();
    if (moved) {
      const raw = doReadSize();
      const near = nearestSnap(raw, snaps());
      apply(near && Math.abs(near.px - raw) <= snapDistance ? near.px : raw);
    } else {
      const next = nextSnap(doReadSize(), snaps());
      if (next) apply(next.px);
    }
    dragStartCoord = null;
  }

  on(handle, 'pointerdown', onPointerDown);
  on(window, 'pointermove', onPointerMove);
  on(window, 'pointerup', onPointerUp);
  on(window, 'pointercancel', onPointerUp);

  // Half/full-style snaps (and min/max) are viewport-relative fractions —
  // re-resolve on resize so they don't go stale the instant the viewport
  // does. A size that was AT a named snap stays pinned to that snap's new
  // resolved px (so 'half' stays ~50vh across a rotation); a free custom
  // size just gets re-clamped into the new bounds, never renamed.
  // `e.isTrusted` guards against a caller's own onApply dispatching a
  // SYNTHETIC resize (main/mobile-resizer.js does, to nudge the 3D preview
  // to redraw) — without this, that dispatch re-enters this handler,
  // which calls apply(), whose onApply dispatches another one: infinite
  // recursion (confirmed live: "RangeError: Maximum call stack size
  // exceeded" the first time this shipped without the guard).
  on(window, 'resize', (e) => {
    if (e && e.isTrusted === false) return;
    if (!enabled()) return;
    if (lastSnapName) {
      const s = snaps().find((x) => x.name === lastSnapName);
      if (s) { apply(s.px, { persist: false }); return; }
    }
    apply(doReadSize(), { persist: false });
  });

  if (enabled()) apply(initialSize(), { persist: false });

  return {
    setSize: (px) => apply(px),
    snapTo: (name) => {
      const s = snaps().find((x) => x.name === name);
      if (s) apply(s.px);
    },
    getSize: doReadSize,
    // Re-runs the persisted-or-initial-snap resolution — for a caller
    // whose `enabled()` flips true only after this splitter's own setup
    // (the main-screen splitter's phones-only gate, re-armed when a live
    // resize crosses INTO mobile rather than reloading the page).
    reapply: () => apply(initialSize(), { persist: false }),
  };
}

/**
 * editor-input.js — SE7m: one declared input profile (mouse/touch/pen)
 * plus the pure math the Pointer Events migration in editor-interaction.js
 * needs (pinch geometry, the second-pointer-cancels-draw decision). No
 * svg.js/DOM dependency here — same pure/DOM split as editor-view.js
 * (viewboxFor/zoomAbout/clampZoom) and editor-grid.js (snapToGrid), which
 * this module leans on directly rather than re-deriving pinch-zoom math:
 * `zoomAbout` (editor-view.js) is still the ONE place that turns a
 * pivot+factor into a new view record — this module only supplies that
 * pivot+factor from two tracked pointers.
 */

/** Per-pointer-type sizing, read wherever a hit tolerance, a grab radius,
 * a transform-handle size, or a touch snap-marker offset used to be a
 * bare mouse-tuned constant. Values are screen px (before the
 * model-space conversion each caller already does via viewScale/
 * getDynamicTolerance). mouse's slopPx/grabPx match the pre-SE7m
 * defaults exactly (10, 15) — SE7m widens touch/pen, it doesn't change
 * mouse behavior. */
export const INPUT_PROFILE = {
  mouse: { slopPx: 10, grabPx: 15, handlePx: 8, markerOffsetPx: 0 },
  touch: { slopPx: 22, grabPx: 28, handlePx: 14, markerOffsetPx: 40 },
  pen: { slopPx: 8, grabPx: 12, handlePx: 8, markerOffsetPx: 0 },
};

/** Resolve a pointer type (from PointerEvent.pointerType, which is
 * 'mouse' | 'touch' | 'pen', or occasionally '' on older/non-conforming
 * UAs) to its INPUT_PROFILE row, defaulting to 'mouse' for anything
 * unrecognized — the historical, already-shipped behavior, never a
 * regression for a UA that doesn't set pointerType correctly. */
export function inputProfileFor(pointerType) {
  return INPUT_PROFILE[pointerType] || INPUT_PROFILE.mouse;
}

function _distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function _midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Two-pointer pinch update: given the PREVIOUS frame's two pointer
 * positions and the CURRENT frame's, returns the incremental zoom
 * `factor` (distance ratio since the previous frame, not since pinch
 * start — so repeated calls compose correctly frame over frame) and the
 * CURRENT screen-space `midpoint` (client coords) to use as the zoom
 * pivot. The caller converts `midpoint` to a model-space point (via
 * `editor._draw.point(x,y)`, the same conversion getPointerPos already
 * does) and calls `zoomAbout(view, thatModelPoint, factor)` — recomputing
 * the pivot from the CURRENT midpoint every frame, rather than a pivot
 * fixed at pinch-start, is what makes a two-finger slide-while-pinching
 * pan the view along with the fingers instead of only zooming in place;
 * no separate pan formula needed, `zoomAbout` already does the rest.
 *
 * `prev`/`next` are `{ p1: {x,y}, p2: {x,y} }` in any consistent screen
 * coordinate space (client px). Returns `factor: 1` (no-op zoom) if the
 * previous distance was 0 (degenerate — two fingers landed on the exact
 * same point) rather than dividing by zero.
 */
export function computePinchUpdate(prev, next) {
  const prevDist = _distance(prev.p1, prev.p2);
  const nextDist = _distance(next.p1, next.p2);
  const factor = prevDist > 0 ? nextDist / prevDist : 1;
  return { factor, midpoint: _midpoint(next.p1, next.p2) };
}

/**
 * The one decision SA-MOBILE-14/15 asks for: does a NEW pointer going
 * down (about to become the pointerCountAfter-th active pointer) need to
 * cancel an in-progress single-pointer draw WITHOUT committing it? True
 * exactly when this is the second pointer (pointerCountAfter === 2) and
 * a draw is actually under way — a third+ finger changes nothing further
 * (the draw is already cancelled, and this module doesn't have an
 * opinion on 3-finger gestures), and a second pointer landing while
 * NOTHING is being drawn (e.g. during a two-finger pinch that's already
 * pan/zooming) must not spuriously re-trigger a cancel.
 */
export function shouldCancelDrawOnPointerDown(pointerCountAfter, isDrawing) {
  return pointerCountAfter === 2 && !!isDrawing;
}

/**
 * A pinch is active exactly when 2 (not 1, not 3+) pointers are down —
 * 3+ fingers is out of scope (SE7m's own dispatch only asks for 2-finger
 * pinch+pan); this module treats 3+ the same as "not pinching" so the
 * caller falls back to ignoring extra fingers rather than mis-firing
 * pinch math on a triple.
 */
export function isPinching(pointerCount) {
  return pointerCount === 2;
}

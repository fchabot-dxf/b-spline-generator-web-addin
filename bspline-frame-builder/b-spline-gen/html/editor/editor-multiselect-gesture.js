/**
 * editor-multiselect-gesture.js — H5 MULTI-SELECT (Fred FINAL: "the gesture
 * is DOUBLE-TAP-AND-HOLD on a piece... a plain tap selects only it").
 *
 * Kept as its own small module (not inlined into editor-interaction.js's
 * own selection call sites) so this turn's edits to that shared,
 * concurrently-being-extended file (seat C's own F18 cut tool, on a
 * separate not-yet-merged branch) stay a few one-line hooks rather than a
 * body of new gesture-state logic living inside it.
 *
 * THE CORE PROBLEM this module exists to solve: a plain tap on a piece
 * ALREADY replaces the whole selection with just that piece (existing,
 * unchanged behaviour) — so by the time a SECOND press on the SAME piece
 * (the "and-hold" half of the gesture) could fire, the selection is
 * ALREADY just [that piece] alone; naively toggling it at that point would
 * just as often REMOVE it, never grow a multi-selection. The fix: record
 * the selection that existed BEFORE the FIRST tap of a would-be double-tap
 * ran its own replace, and if the second press turns into a genuine hold,
 * RESTORE that prior selection first, then toggle the held piece into (or
 * out of) it — so double-tap-holding piece B, while A is already selected,
 * produces {A, B}, not {B} alone.
 *
 * Declared timings — H6's own context-menu hold can reuse HOLD_MS (its own
 * dispatch note: "put the H5 timing constants somewhere H6 can share").
 * DOUBLE_TAP_MS matches splitter.js's own MOB4 constant of the same name;
 * HOLD_MS is the ROADMAP's own suggested figure.
 */
import { inputProfileFor } from './editor-input.js';
import { haptic } from '../core/haptics.js';

export const MULTISELECT_DOUBLE_TAP_MS = 350;
export const MULTISELECT_HOLD_MS = 450;

let _lastTap = null; // { editor, el, time, priorSelection } -- the most recent FIRST-tap candidate
let _armed = null;   // { editor, el, clientX, clientY, timer, priorSelection } -- a pending hold

/**
 * Call from each of the three selection sites (selectHandler.start,
 * latticeHandler.start, shapeLatticeHandler.start), in place of the
 * existing `else if (!includes) editor._select(hit)` branch — Shift+click
 * is a SEPARATE, already-correct gesture and is untouched; only a plain,
 * no-modifier press on a piece can be the first or second half of this
 * one. Callers exclude text elements themselves (double-tap already opens
 * text editing there, per the dispatch's own explicit exclusion) — lattice
 * pieces are never text, so only selectHandler's own call site needs that
 * guard.
 *
 * Returns true when this press was recognized as the SECOND half of a
 * double-tap (a hold has been armed) — the caller should skip its own
 * replace-select call for this press, leaving the selection exactly as
 * the first tap left it until the hold resolves (fires, or is cancelled by
 * movement/release — see cancelMultiSelectHoldIfMoved/cancelMultiSelectHold
 * below). Returns false for an ordinary first/fresh press — the caller's
 * own replace-select should run exactly as before.
 */
export function armMultiSelectPress(editor, hit, e) {
  const now = Date.now();
  cancelMultiSelectHold(); // a stray still-armed hold from an unrelated earlier press never survives a new one

  if (_lastTap && _lastTap.editor === editor && _lastTap.el === hit
    && (now - _lastTap.time) <= MULTISELECT_DOUBLE_TAP_MS) {
    const priorSelection = _lastTap.priorSelection;
    _lastTap = null;
    _armed = {
      editor, el: hit, clientX: e.clientX, clientY: e.clientY,
      timer: setTimeout(_fireHold, MULTISELECT_HOLD_MS),
      priorSelection,
    };
    return true;
  }

  _lastTap = { editor, el: hit, time: now, priorSelection: (editor._selectedElements || []).slice() };
  return false;
}

function _fireHold() {
  if (!_armed) return;
  const { editor, el: hit, priorSelection } = _armed;
  _armed = null;
  editor._selectMany(priorSelection); // undo the first tap's own replace-to-[hit] before toggling
  editor._selectAdd(hit); // adds hit back in, or removes it if it was already part of priorSelection
  haptic('multiselect'); // H13: double tick, whichever direction (add or remove)
  // A hold that fires never moved (cancelMultiSelectHoldIfMoved would have
  // cancelled it otherwise) and should never drag — neutralize whatever
  // handleStart's own hit branch already armed alongside the selection
  // call (select-drag, or a lattice piece's _isDrawing/_latticeMove) so
  // lifting the finger afterward does nothing further.
  editor._isDragging = false;
  editor._isDrawing = false;
  editor._latticeMove = null;
}

/**
 * Call from the top of handlePointerMove: cancels a pending hold once the
 * pointer has moved past the SAME click-vs-drag threshold this file's own
 * anchor-tool freehand check already uses elsewhere (editor-input.js's own
 * `clickThresholdPx`) — compared here in raw screen pixels straight off
 * the event, deliberately NOT the snapped model-space point handleMove's
 * own `pt` would give (snapping could mask or exaggerate a small real
 * movement). Falling through to a normal drag once cancelled is the
 * correct outcome — the piece is already selected from the first tap, so
 * the existing drag machinery just works, unchanged.
 */
export function cancelMultiSelectHoldIfMoved(e) {
  if (!_armed) return;
  const threshold = inputProfileFor(_armed.editor._pointerType).clickThresholdPx;
  const dist = Math.hypot(e.clientX - _armed.clientX, e.clientY - _armed.clientY);
  if (dist > threshold) cancelMultiSelectHold();
}

/**
 * Call on pointerdown (a 2nd finger landing invalidates any single-finger
 * hold in progress, same as it already cancels an in-progress draw) and on
 * pointerup/pointercancel (releasing before the hold time elapses is just
 * a quick second tap — a no-op, since the first tap already left the piece
 * selected alone; there is nothing left to restore).
 */
export function cancelMultiSelectHold() {
  if (_armed) { clearTimeout(_armed.timer); _armed = null; }
}

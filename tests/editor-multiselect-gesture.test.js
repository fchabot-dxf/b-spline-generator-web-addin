/**
 * H5 MULTI-SELECT: editor-multiselect-gesture.js in isolation, with fake
 * timers (the hold itself is a real setTimeout) and a small mock editor
 * whose _select/_selectAdd/_selectMany reproduce the REAL toggle/replace
 * semantics (editor-ui.js's own select/selectAdd/selectMany) closely
 * enough to assert on the RESULTING _selectedElements array, not just that
 * a function was called.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  armMultiSelectPress, cancelMultiSelectHoldIfMoved, cancelMultiSelectHold,
  MULTISELECT_DOUBLE_TAP_MS, MULTISELECT_HOLD_MS,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-multiselect-gesture.js';

function makeEditor(pointerType = 'touch') {
  return {
    _pointerType: pointerType,
    _selectedElements: [],
    _isDragging: false,
    _isDrawing: false,
    _latticeMove: { fake: true },
    _select(el) { this._selectedElements = [el]; },
    _selectAdd(el) {
      const cur = this._selectedElements.slice();
      const idx = cur.indexOf(el);
      if (idx >= 0) cur.splice(idx, 1); else cur.push(el);
      this._selectedElements = cur;
    },
    _selectMany(els) { this._selectedElements = els.slice(); },
  };
}

const evt = (x = 0, y = 0) => ({ clientX: x, clientY: y });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cancelMultiSelectHold(); vi.useRealTimers(); });

describe('armMultiSelectPress — recognizing the second half of a double-tap', () => {
  it('a fresh press (no prior tap) is NOT a double-tap candidate', () => {
    const editor = makeEditor();
    const A = { id: 'A' };
    expect(armMultiSelectPress(editor, A, evt())).toBe(false);
  });

  it('a second press on the SAME element within the window IS a candidate', () => {
    const editor = makeEditor();
    const A = { id: 'A' };
    editor._select(A); // tap 1's own normal replace-select, as the real call site does
    expect(armMultiSelectPress(editor, A, evt())).toBe(false); // tap 1 itself: records the pre-tap selection
    vi.advanceTimersByTime(MULTISELECT_DOUBLE_TAP_MS - 50);
    expect(armMultiSelectPress(editor, A, evt())).toBe(true); // tap 2, still inside the window: arms a hold
  });

  it('a second press on a DIFFERENT element is NOT a candidate (fresh press instead)', () => {
    const editor = makeEditor();
    const A = { id: 'A' }; const B = { id: 'B' };
    editor._select(A);
    armMultiSelectPress(editor, A, evt());
    editor._select(B);
    expect(armMultiSelectPress(editor, B, evt())).toBe(false);
  });

  it('a second press AFTER the double-tap window has elapsed is NOT a candidate', () => {
    const editor = makeEditor();
    const A = { id: 'A' };
    editor._select(A);
    armMultiSelectPress(editor, A, evt());
    vi.advanceTimersByTime(MULTISELECT_DOUBLE_TAP_MS + 1);
    expect(armMultiSelectPress(editor, A, evt())).toBe(false);
  });
});

describe('the hold firing — restores the pre-tap-1 selection, then toggles', () => {
  it('holding piece B while A was already selected produces {A, B}, not {B} alone', () => {
    const editor = makeEditor();
    const A = { id: 'A' }; const B = { id: 'B' };
    editor._select(A); // A alone is selected, from an earlier, separate gesture
    expect(editor._selectedElements).toEqual([A]);

    // The double-tap-and-hold sequence, targeting B:
    armMultiSelectPress(editor, B, evt()); // tap 1 of the sequence: records priorSelection = [A]
    editor._select(B); // the call site's own normal replace-select for tap 1 (unaffected -- armMultiSelectPress returned false)
    expect(editor._selectedElements).toEqual([B]); // tap 1 alone would look like "just B", same as any plain tap

    const armed = armMultiSelectPress(editor, B, evt()); // tap 2: same element, still inside the window
    expect(armed).toBe(true);
    vi.advanceTimersByTime(MULTISELECT_HOLD_MS);

    expect(editor._selectedElements).toEqual([A, B]); // restored [A], then B toggled back in
  });

  it('holding an ALREADY-selected piece (part of a multi-selection) REMOVES just it', () => {
    const editor = makeEditor();
    const A = { id: 'A' }; const B = { id: 'B' };
    editor._selectMany([A, B]); // {A, B} already selected, from a prior gesture
    armMultiSelectPress(editor, B, evt());
    editor._select(B); // tap 1 on B (already part of the selection) still runs its own normal replace
    const armed = armMultiSelectPress(editor, B, evt());
    expect(armed).toBe(true);
    vi.advanceTimersByTime(MULTISELECT_HOLD_MS);

    expect(editor._selectedElements).toEqual([A]); // B removed, A untouched
  });

  it('neutralizes an in-progress drag/lattice-move so lifting the finger afterward does nothing further', () => {
    const editor = makeEditor();
    const A = { id: 'A' };
    editor._select(A);
    armMultiSelectPress(editor, A, evt());
    editor._select(A);
    editor._isDragging = true;
    editor._isDrawing = true;
    armMultiSelectPress(editor, A, evt());
    vi.advanceTimersByTime(MULTISELECT_HOLD_MS);

    expect(editor._isDragging).toBe(false);
    expect(editor._isDrawing).toBe(false);
    expect(editor._latticeMove).toBeNull();
  });
});

describe('cancellation — movement or release before the hold time', () => {
  it('movement past the click threshold cancels the hold (falls through to a normal drag)', () => {
    const editor = makeEditor();
    const A = { id: 'A' };
    editor._select(A);
    armMultiSelectPress(editor, A, evt(0, 0));
    editor._select(A);
    armMultiSelectPress(editor, A, evt(0, 0));

    cancelMultiSelectHoldIfMoved(evt(50, 0)); // 50px >> clickThresholdPx (3px for every pointer type)
    vi.advanceTimersByTime(MULTISELECT_HOLD_MS);

    expect(editor._selectedElements).toEqual([A]); // unchanged -- no toggle happened
  });

  it('tiny movement WITHIN the click threshold does NOT cancel the hold', () => {
    const editor = makeEditor();
    const A = { id: 'A' }; const B = { id: 'B' };
    editor._select(A);
    armMultiSelectPress(editor, B, evt(0, 0));
    editor._select(B);
    armMultiSelectPress(editor, B, evt(0, 0));

    cancelMultiSelectHoldIfMoved(evt(1, 0)); // 1px < clickThresholdPx
    vi.advanceTimersByTime(MULTISELECT_HOLD_MS);

    expect(editor._selectedElements).toEqual([A, B]); // the hold still fired
  });

  it('releasing before the hold time cancels it (a quick second tap is a no-op, not a toggle)', () => {
    const editor = makeEditor();
    const A = { id: 'A' };
    editor._select(A);
    armMultiSelectPress(editor, A, evt());
    editor._select(A);
    armMultiSelectPress(editor, A, evt());

    cancelMultiSelectHold(); // pointerup/pointercancel, released early
    vi.advanceTimersByTime(MULTISELECT_HOLD_MS);

    expect(editor._selectedElements).toEqual([A]); // still just A, from tap 1 -- no toggle
  });

  it('a NEW press (e.g. a 2nd finger) cancels a hold pending from a different, earlier press', () => {
    const editor = makeEditor();
    const A = { id: 'A' }; const B = { id: 'B' };
    editor._select(A);
    armMultiSelectPress(editor, A, evt());
    editor._select(A);
    armMultiSelectPress(editor, A, evt()); // hold armed on A

    cancelMultiSelectHold(); // simulates handlePointerDown's own top-of-function cancel for a 2nd finger
    vi.advanceTimersByTime(MULTISELECT_HOLD_MS);

    expect(editor._selectedElements).toEqual([A]); // the armed hold on A never fired
  });
});

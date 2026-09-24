/**
 * T32 — updateHistoryButtons (editor-ui.js): enable/disable #editorUndo/
 * #editorRedo to match whether editor._undoStack/_redoStack actually have
 * anything to undo/redo — the SAME conditions editor.js's own undo()/
 * redo() check (`_undoStack.length < 2` / `!_redoStack.length`), read back
 * here rather than re-derived, so a passing test here is evidence the
 * buttons can't disagree with what clicking them would actually do.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { updateHistoryButtons } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-ui.js';

describe('updateHistoryButtons', () => {
  let undoBtn, redoBtn;

  beforeEach(() => {
    undoBtn = document.createElement('button');
    undoBtn.id = 'editorUndo';
    redoBtn = document.createElement('button');
    redoBtn.id = 'editorRedo';
    document.body.appendChild(undoBtn);
    document.body.appendChild(redoBtn);
  });

  afterEach(() => {
    undoBtn.remove();
    redoBtn.remove();
  });

  it('disables Undo when the undo stack has fewer than 2 entries (matches undo()\'s own noop condition)', () => {
    updateHistoryButtons({ _undoStack: [], _redoStack: [] });
    expect(undoBtn.disabled).toBe(true);
    updateHistoryButtons({ _undoStack: ['only-current-state'], _redoStack: [] });
    expect(undoBtn.disabled).toBe(true);
  });

  it('enables Undo once there are 2+ entries (at least one real edit beyond the initial state)', () => {
    updateHistoryButtons({ _undoStack: ['initial', 'edit-1'], _redoStack: [] });
    expect(undoBtn.disabled).toBe(false);
  });

  it('disables Redo when the redo stack is empty', () => {
    updateHistoryButtons({ _undoStack: [], _redoStack: [] });
    expect(redoBtn.disabled).toBe(true);
  });

  it('enables Redo once something has been undone (redo stack non-empty)', () => {
    updateHistoryButtons({ _undoStack: ['initial'], _redoStack: ['undone-edit'] });
    expect(redoBtn.disabled).toBe(false);
  });

  it('undo and redo enabled state are independent of each other', () => {
    // Lots of undo history, nothing redoable yet (the common "just kept
    // drawing" case).
    updateHistoryButtons({ _undoStack: ['a', 'b', 'c'], _redoStack: [] });
    expect(undoBtn.disabled).toBe(false);
    expect(redoBtn.disabled).toBe(true);
  });

  it('does not throw when the buttons are not in this host\'s DOM', () => {
    undoBtn.remove();
    redoBtn.remove();
    expect(() => updateHistoryButtons({ _undoStack: ['a', 'b'], _redoStack: ['c'] })).not.toThrow();
  });

  it('does not throw when _undoStack/_redoStack are missing (defensive) — reads as "nothing to undo/redo"', () => {
    expect(() => updateHistoryButtons({})).not.toThrow();
    updateHistoryButtons({});
    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(true);
  });
});

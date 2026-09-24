/**
 * SE8a — two audit findings about a gesture not committing correctly:
 *
 * SA-UNDO-2/3: setStrokeWidth had neither pushState() nor _onChange()
 * (permanently un-undoable, carve preview never updated until an
 * unrelated edit); setStrokeColor had pushState() but no _onChange()
 * (undo worked, live preview lagged). Both now route through one shared
 * _commitStyleChange().
 *
 * SA-TEXT-1: the editor modal's Cancel button skipped text-session
 * teardown entirely (Apply calls _commitText() first; Cancel called only
 * _onCommit(null)) — an in-progress text edit left _editingTextEl truthy
 * forever, so the document-level mousedown refocus listener kept firing
 * app-wide. endEditorSession is now the ONE contract both buttons go
 * through.
 */
import { describe, it, expect } from 'vitest';
import { VectorEditor } from '../bspline-frame-builder/b-spline-gen/html/editor/editor.js';
import { endEditorSession } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-text-session.js';

// setStrokeWidth/setStrokeColor/_commitStyleChange are plain prototype
// methods with no constructor dependency — called via .call() against a
// minimal mock `this` rather than instantiating a real VectorEditor
// (which needs a live DOM canvas). Real class, not a reimplementation:
// a revert of the actual fix fails these tests.
function mockStyleEditor(selected) {
  const calls = { pushState: 0, onChange: 0 };
  return {
    editor: {
      _selectedElements: selected,
      _strokeWidth: 0.5,
      _strokeColor: '#000000',
      pushState: () => { calls.pushState++; },
      _onChange: () => { calls.onChange++; },
      _updateSelectionHighlight: () => {},
      // The real _commitStyleChange, not a reimplementation — setStrokeWidth/
      // setStrokeColor call `this._commitStyleChange()`, and `this` here is
      // this mock, so it needs the real method attached to resolve.
      _commitStyleChange: VectorEditor.prototype._commitStyleChange,
    },
    calls,
  };
}

describe('SA-UNDO-2: setStrokeWidth commits exactly once per call', () => {
  it('pushes an undo step and fires onChange when a selection is active', () => {
    const strokeCalls = [];
    const { editor, calls } = mockStyleEditor([{ stroke: (s) => strokeCalls.push(s) }]);
    VectorEditor.prototype.setStrokeWidth.call(editor, 3.0);
    expect(editor._strokeWidth).toBe(3.0);
    expect(strokeCalls).toEqual([{ width: 3.0 }]);
    expect(calls.pushState).toBe(1);
    expect(calls.onChange).toBe(1);
  });

  it('does not commit when nothing is selected (still updates the default width)', () => {
    const { editor, calls } = mockStyleEditor([]);
    VectorEditor.prototype.setStrokeWidth.call(editor, 2.0);
    expect(editor._strokeWidth).toBe(2.0);
    expect(calls.pushState).toBe(0);
    expect(calls.onChange).toBe(0);
  });
});

describe('SA-UNDO-3: setStrokeColor now ALSO fires onChange (pushState already worked)', () => {
  it('pushes an undo step AND fires onChange when a selection is active', () => {
    const { editor, calls } = mockStyleEditor([{ stroke: () => {}, type: 'line' }]);
    VectorEditor.prototype.setStrokeColor.call(editor, '#ff0000');
    expect(editor._strokeColor).toBe('#ff0000');
    expect(calls.pushState).toBe(1);
    expect(calls.onChange).toBe(1); // the half that was missing before this fix
  });

  it('also fills text elements (existing behaviour, unchanged) and still commits once', () => {
    const fillCalls = [];
    const { editor, calls } = mockStyleEditor([{ stroke: () => {}, fill: (c) => fillCalls.push(c), type: 'text' }]);
    VectorEditor.prototype.setStrokeColor.call(editor, '#00ff00');
    expect(fillCalls).toEqual(['#00ff00']);
    expect(calls.pushState).toBe(1);
    expect(calls.onChange).toBe(1);
  });
});

// endEditorSession — SA-TEXT-1. _currentText is kept empty in every mock
// so commitText() takes its "remove the element" branch rather than its
// buildTspans() branch (which needs a much heavier svg.js-shaped mock);
// that branch isn't what this fix touches — the fix is "does teardown
// run AT ALL on Cancel," not which of commitText's own branches runs.
function mockTextEditor(withActiveSession) {
  const editingEl = { remove() { editingEl.removed = true; } };
  const onCommitCalls = [];
  const onChangeCalls = [];
  const editor = {
    _editingTextEl: withActiveSession ? editingEl : null,
    _currentText: '',
    _refocusHandler: withActiveSession ? () => {} : null,
    save: () => 'SAVED_SVG',
    _onCommit: (arg) => onCommitCalls.push(arg),
    _onChange: () => onChangeCalls.push(true),
  };
  return { editor, editingEl, onCommitCalls, onChangeCalls };
}

describe('SA-TEXT-1: endEditorSession is the one contract both Apply and Cancel go through', () => {
  it('Cancel (commit:false) with an active text session: tears it down WITHOUT committing, then onCommit(null)', () => {
    const { editor, editingEl, onCommitCalls } = mockTextEditor(true);
    endEditorSession(editor, { commit: false });
    expect(editor._editingTextEl).toBeNull(); // session torn down — the actual bug this fixes
    expect(editingEl.removed).toBe(true);      // cancelText's path: removed, not committed
    expect(onCommitCalls).toEqual([null]);
  });

  it('Apply (commit:true) with an active text session: commits it, then onCommit(save())', () => {
    const { editor, editingEl, onCommitCalls } = mockTextEditor(true);
    endEditorSession(editor, { commit: true });
    expect(editor._editingTextEl).toBeNull();
    expect(editingEl.removed).toBe(true); // empty _currentText -> commitText's own "remove" branch
    expect(onCommitCalls).toEqual(['SAVED_SVG']);
  });

  it('with no active text session, both are a no-op teardown but still call onCommit correctly', () => {
    const cancelResult = mockTextEditor(false);
    endEditorSession(cancelResult.editor, { commit: false });
    expect(cancelResult.onCommitCalls).toEqual([null]);

    const applyResult = mockTextEditor(false);
    endEditorSession(applyResult.editor, { commit: true });
    expect(applyResult.onCommitCalls).toEqual(['SAVED_SVG']);
  });
});

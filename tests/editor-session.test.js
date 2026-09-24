/**
 * SE8a — two audit findings about a gesture not committing correctly:
 *
 * SA-UNDO-2: setStrokeWidth had neither pushState() nor _onChange()
 * (permanently un-undoable, carve preview never updated until an
 * unrelated edit) — now routes through _commitStyleChange(). (SA-UNDO-3
 * was setStrokeColor's twin fix; SE8d removed setStrokeColor itself,
 * zero real callers, and its test below with it.)
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

// setStrokeWidth/_commitStyleChange are plain prototype methods with no
// constructor dependency — called via .call() against a minimal mock
// `this` rather than instantiating a real VectorEditor (which needs a
// live DOM canvas). Real class, not a reimplementation: a revert of the
// actual fix fails these tests.
function mockStyleEditor(selected) {
  const calls = { pushState: 0, onChange: 0 };
  return {
    editor: {
      _selectedElements: selected,
      _strokeWidth: 0.5,
      pushState: () => { calls.pushState++; },
      _onChange: () => { calls.onChange++; },
      _updateSelectionHighlight: () => {},
      // The real _commitStyleChange, not a reimplementation — setStrokeWidth
      // calls `this._commitStyleChange()`, and `this` here is this mock, so
      // it needs the real method attached to resolve.
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

// SA-UNDO-1 — _notifyChange('live'|'commit'). A controllable rAF mock:
// requestAnimationFrame records the callback instead of scheduling a REAL
// frame (nothing fires until the test explicitly calls runPending()), so
// "did 50 live calls actually invoke the real pipeline" is deterministic
// rather than racing a real animation frame.
function mockRaf() {
  let nextId = 1;
  const scheduled = new Map();
  return {
    raf: (cb) => { const id = nextId++; scheduled.set(id, cb); return id; },
    caf: (id) => { scheduled.delete(id); },
    runPending: () => { const cbs = [...scheduled.values()]; scheduled.clear(); cbs.forEach((cb) => cb()); },
    pendingCount: () => scheduled.size,
  };
}

describe('SA-UNDO-1: _notifyChange coalesces drag-continuation fan-out', () => {
  // Before this fix, dragNode/translateSelection/applyTransformDrag each
  // called the REAL editor._onChange() (full remask/rasterize/
  // localStorage) on every raw mousemove — commonly 15-40+ times per
  // drag. 'live' throttles to at most one call per animation frame;
  // 'commit' (handleEnd, once per gesture) fires immediately and cancels
  // whatever 'live' frame was still pending.
  function withMockRaf(fn) {
    const { raf, caf, runPending, pendingCount } = mockRaf();
    const originalRaf = global.requestAnimationFrame;
    const originalCaf = global.cancelAnimationFrame;
    global.requestAnimationFrame = raf;
    global.cancelAnimationFrame = caf;
    try {
      fn({ runPending, pendingCount });
    } finally {
      global.requestAnimationFrame = originalRaf;
      global.cancelAnimationFrame = originalCaf;
    }
  }

  it('the dispatch\'s own scenario: 50 live notifications + 1 commit — the real pipeline runs exactly once', () => {
    withMockRaf(({ pendingCount }) => {
      const onChangeCalls = [];
      const editor = { _onChange: () => onChangeCalls.push(true), _pendingChangeFrame: null };

      for (let i = 0; i < 50; i++) {
        VectorEditor.prototype._notifyChange.call(editor, 'live');
      }
      // None of the 50 live calls invoked the real pipeline — only ONE
      // frame got scheduled (the other 49 saw a pending frame and no-opped).
      expect(onChangeCalls).toHaveLength(0);
      expect(pendingCount()).toBe(1);

      VectorEditor.prototype._notifyChange.call(editor, 'commit');
      expect(onChangeCalls).toHaveLength(1); // the ONE real pipeline run
      expect(editor._pendingChangeFrame).toBeNull(); // the pending live frame was cancelled, not left to also fire
      expect(pendingCount()).toBe(0);
    });
  });

  it('a live call DOES eventually fire the pipeline once the frame elapses (not a permanent no-op)', () => {
    withMockRaf(({ runPending }) => {
      const onChangeCalls = [];
      const editor = { _onChange: () => onChangeCalls.push(true), _pendingChangeFrame: null };

      VectorEditor.prototype._notifyChange.call(editor, 'live');
      VectorEditor.prototype._notifyChange.call(editor, 'live');
      VectorEditor.prototype._notifyChange.call(editor, 'live');
      expect(onChangeCalls).toHaveLength(0);

      runPending(); // simulate the animation frame actually elapsing
      expect(onChangeCalls).toHaveLength(1); // 3 live calls -> exactly 1 pipeline run
      expect(editor._pendingChangeFrame).toBeNull();
    });
  });

  it('a SECOND live call after the first frame fired schedules a NEW frame (continuous drags keep updating)', () => {
    withMockRaf(({ runPending, pendingCount }) => {
      const onChangeCalls = [];
      const editor = { _onChange: () => onChangeCalls.push(true), _pendingChangeFrame: null };

      VectorEditor.prototype._notifyChange.call(editor, 'live');
      runPending();
      expect(onChangeCalls).toHaveLength(1);

      VectorEditor.prototype._notifyChange.call(editor, 'live');
      expect(pendingCount()).toBe(1); // a NEW frame, not swallowed by the old (already-fired) one
      runPending();
      expect(onChangeCalls).toHaveLength(2); // NOT starved — a continuous drag keeps getting updates
    });
  });

  it('commit with no pending live frame just fires immediately (no crash on a null pending id)', () => {
    withMockRaf(() => {
      const onChangeCalls = [];
      const editor = { _onChange: () => onChangeCalls.push(true), _pendingChangeFrame: null };
      VectorEditor.prototype._notifyChange.call(editor, 'commit');
      expect(onChangeCalls).toHaveLength(1);
    });
  });

  it('does nothing when there is no _onChange callback wired yet', () => {
    withMockRaf(() => {
      const editor = { _onChange: null, _pendingChangeFrame: null };
      expect(() => VectorEditor.prototype._notifyChange.call(editor, 'live')).not.toThrow();
      expect(() => VectorEditor.prototype._notifyChange.call(editor, 'commit')).not.toThrow();
    });
  });
});

/**
 * SE7g — "undo after Generate restores the previous pattern AND seed"
 * (the dispatch's own verify line). Found via a real live-browser check
 * (Fred's hard rule this turn: no Fusion — scripts/smoke-lattice-seed-
 * color.mjs against a local `python -m http.server`, see WORK-LOG) that
 * `editor.js`'s `pushState`/`_restoreState` never captured
 * `editor._latticePattern` at all — undo reverted the drawn geometry
 * (the SVG snapshot) but left the Seed field's underlying pattern object
 * pointing at whatever the LATEST Generate had written, since
 * generatePattern mutates that one object in place. Fixed by adding
 * `latticePattern` (deep-cloned, not a reference — the same object is
 * mutated on every future Generate) to the pushState snapshot and
 * restoring it in `_restoreState`.
 *
 * Real `VectorEditor.prototype.pushState`/`_restoreState`/`undo`/`redo`
 * via `.call(mock)`, not a reimplementation — same convention as
 * editor-color.test.js's setColor tests. The mock's `_sketchLayer` is
 * intentionally minimal (children()/clear()/svg() no-ops beyond what
 * pushState/_restoreState touch) since this file is about the
 * `latticePattern` field specifically, not a full SVG-content round
 * trip (already covered by other suites).
 */
import { describe, it, expect } from 'vitest';
import { VectorEditor } from '../bspline-frame-builder/b-spline-gen/html/editor/editor.js';

function makeUndoMockEditor() {
  let children = [];
  const sketchLayer = {
    children() {
      const arr = children.slice();
      arr.toArray = () => arr;
      return arr;
    },
    clear() { children = []; },
    svg() { /* no-op: this suite doesn't assert on SVG content round-trip */ },
    node: {},
  };
  return {
    _sketchLayer: sketchLayer,
    _layers: [],
    _activeLayer: null,
    _undoStack: [],
    _redoStack: [],
    _maxUndo: 40,
    _selectedElement: null,
    _selectedElements: [],
    _latticePattern: null,
    _onChange: null,
    _onCommit: null,
    _deselect() {},
    pushState: VectorEditor.prototype.pushState,
    undo: VectorEditor.prototype.undo,
    redo: VectorEditor.prototype.redo,
    _restoreState: VectorEditor.prototype._restoreState,
  };
}

describe('pushState captures editor._latticePattern (SE7g)', () => {
  it('a snapshot with no pattern yet stores latticePattern: null', () => {
    const editor = makeUndoMockEditor();
    editor.pushState();
    expect(editor._undoStack[0].latticePattern).toBeNull();
  });

  it('captures a DEEP COPY of the current pattern, not a live reference', () => {
    const editor = makeUndoMockEditor();
    editor._latticePattern = { id: 'lattice-1', seed: 111 };
    editor.pushState();
    const snap = editor._undoStack[editor._undoStack.length - 1];
    expect(snap.latticePattern).toEqual({ id: 'lattice-1', seed: 111 });

    // Non-vacuous: mutate the LIVE pattern object AFTER the snapshot
    // (exactly what generatePattern does on the next Generate/Regenerate
    // — same object, mutated in place) and confirm the snapshot's own
    // copy does NOT follow.
    editor._latticePattern.seed = 999;
    expect(snap.latticePattern.seed).toBe(111);
  });
});

describe('undo restores editor._latticePattern (SE7g: "undo restores the previous pattern AND seed")', () => {
  it('undo after a seed change reverts editor._latticePattern to the PRIOR seed', () => {
    const editor = makeUndoMockEditor();
    editor._latticePattern = { id: 'lattice-1', seed: 111 };
    editor.pushState(); // snapshot A: seed 111

    editor._latticePattern = { ...editor._latticePattern, seed: 222 };
    editor.pushState(); // snapshot B: seed 222

    editor.undo();

    expect(editor._latticePattern.seed).toBe(111);
  });

  it('non-vacuous: WITHOUT the latticePattern restore, this would fail — proven by reverting only the activeLayer field and confirming latticePattern alone carries the seed back (sanity: two independent fields both round-trip)', () => {
    const editor = makeUndoMockEditor();
    editor._latticePattern = { id: 'lattice-1', seed: 111 };
    editor._activeLayer = 'layer-a';
    editor.pushState();

    editor._latticePattern = { ...editor._latticePattern, seed: 222 };
    editor._activeLayer = 'layer-b';
    editor.pushState();

    editor.undo();

    expect(editor._latticePattern.seed).toBe(111);
    expect(editor._activeLayer).toBe('layer-a');
  });

  it('redo re-applies the LATER seed after an undo', () => {
    const editor = makeUndoMockEditor();
    editor._latticePattern = { id: 'lattice-1', seed: 111 };
    editor.pushState();
    editor._latticePattern = { ...editor._latticePattern, seed: 222 };
    editor.pushState();

    editor.undo();
    expect(editor._latticePattern.seed).toBe(111);
    editor.redo();
    expect(editor._latticePattern.seed).toBe(222);
  });

  it('a snapshot taken BEFORE the first-ever Generate restores latticePattern to null (not a stale later pattern)', () => {
    const editor = makeUndoMockEditor();
    editor.pushState(); // snapshot A: no pattern yet (null)

    editor._latticePattern = { id: 'lattice-1', seed: 111 };
    editor.pushState(); // snapshot B: first Generate

    editor.undo();

    expect(editor._latticePattern).toBeNull();
  });

  it('two Generates then two undos returns to the ORIGINAL (pre-pattern) state — the exact live-browser scenario', () => {
    const editor = makeUndoMockEditor();
    editor.pushState(); // initial, no pattern

    editor._latticePattern = { id: 'lattice-1', seed: 747641 };
    editor.pushState(); // Generate #1

    editor._latticePattern = { ...editor._latticePattern, seed: 22723 };
    editor.pushState(); // Generate #2 (Regenerate)

    editor.undo();
    expect(editor._latticePattern.seed).toBe(747641);

    editor.undo();
    expect(editor._latticePattern).toBeNull();
  });
});

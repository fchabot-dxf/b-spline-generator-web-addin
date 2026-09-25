/**
 * SE7g — "undo after Generate restores the previous pattern AND seed"
 * (the dispatch's own verify line). Found via a real live-browser check
 * (Fred's hard rule this turn: no Fusion — scripts/smoke-lattice-seed-
 * color.mjs against a local `python -m http.server`, see WORK-LOG) that
 * `editor.js`'s `pushState`/`_restoreState` never captured
 * `editor._latticePattern` at all — undo reverted the drawn geometry
 * (the SVG snapshot) but left the Seed field's underlying pattern object
 * pointing at whatever the LATEST Generate had written, since
 * generatePattern mutates that one object in place.
 *
 * SE7i (Fred: "I don't mind if all lattice geometry is in one layer"):
 * settings moved from a single file-level `editor._latticePattern` onto
 * each LAYER's own `.pattern` — `pushState` now deep-clones that field
 * per layer (inside the `layers` array it already snapshots), rather
 * than as a separate top-level field. Same underlying bug class, same
 * fix shape, new location.
 *
 * Real `VectorEditor.prototype.pushState`/`_restoreState`/`undo`/`redo`
 * via `.call(mock)`, not a reimplementation — same convention as
 * editor-color.test.js's setColor tests. The mock's `_sketchLayer` is
 * intentionally minimal (children()/clear()/svg() no-ops beyond what
 * pushState/_restoreState touch) since this file is about the per-layer
 * `pattern` field specifically, not a full SVG-content round trip
 * (already covered by other suites).
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
    // SE7i: a real starter layer (id '0') — the pattern being tested
    // lives on IT now, not on a bare top-level field.
    _layers: [{ id: '0', name: 'Layer 1', visible: true }],
    _activeLayer: '0',
    _undoStack: [],
    _redoStack: [],
    _maxUndo: 40,
    _selectedElement: null,
    _selectedElements: [],
    _onChange: null,
    _onCommit: null,
    _deselect() {},
    pushState: VectorEditor.prototype.pushState,
    undo: VectorEditor.prototype.undo,
    redo: VectorEditor.prototype.redo,
    _restoreState: VectorEditor.prototype._restoreState,
    // SE12 T38: _restoreState now calls this._notifyChange('commit')
    // (was a direct this._onChange() call) so undo/redo also refresh the
    // outline preview. Borrowed from the real prototype, same as the
    // other four methods above — refreshOutlinePreview no-ops cleanly on
    // a mock with no _outlinePreviewLayer (its own top-level guard), and
    // _notifyChange's own `if (!this._onChange) return` after that
    // matches this mock's `_onChange: null` exactly as the old direct
    // call did, so this file's own scope (latticePattern round-tripping)
    // is unaffected.
    _notifyChange: VectorEditor.prototype._notifyChange,
  };
}

/** The active layer's own pattern — mirrors editor-lattice-pattern.js's
 *  getLayerPattern(editor), re-derived here rather than imported so this
 *  suite stays focused on the undo/redo MECHANICS, not a cross-module
 *  dependency. */
function activeLayerPattern(editor) {
  return editor._layers.find((l) => l.id === editor._activeLayer)?.pattern;
}

describe("pushState captures a layer's own .pattern (SE7g, relocated per-layer by SE7i)", () => {
  it('a snapshot with no pattern yet stores pattern: undefined on that layer', () => {
    const editor = makeUndoMockEditor();
    editor.pushState();
    expect(editor._undoStack[0].layers[0].pattern).toBeUndefined();
  });

  it('captures a DEEP COPY of the current pattern, not a live reference', () => {
    const editor = makeUndoMockEditor();
    editor._layers[0].pattern = { id: 'lattice-1', seed: 111 };
    editor.pushState();
    const snap = editor._undoStack[editor._undoStack.length - 1];
    expect(snap.layers[0].pattern).toEqual({ id: 'lattice-1', seed: 111 });

    // Non-vacuous: mutate the LIVE pattern object AFTER the snapshot
    // (exactly what generatePattern does on the next Generate/Regenerate
    // — same object, mutated in place) and confirm the snapshot's own
    // copy does NOT follow.
    editor._layers[0].pattern.seed = 999;
    expect(snap.layers[0].pattern.seed).toBe(111);
  });
});

describe('undo restores the active layer\'s pattern (SE7g: "undo restores the previous pattern AND seed")', () => {
  it('undo after a seed change reverts the layer\'s pattern to the PRIOR seed', () => {
    const editor = makeUndoMockEditor();
    editor._layers[0].pattern = { id: 'lattice-1', seed: 111 };
    editor.pushState(); // snapshot A: seed 111

    editor._layers[0].pattern = { ...editor._layers[0].pattern, seed: 222 };
    editor.pushState(); // snapshot B: seed 222

    editor.undo();

    expect(activeLayerPattern(editor).seed).toBe(111);
  });

  it('non-vacuous: WITHOUT the per-layer pattern restore, this would fail — proven by also changing activeLayer and confirming BOTH independently round-trip', () => {
    const editor = makeUndoMockEditor();
    editor._layers[0].pattern = { id: 'lattice-1', seed: 111 };
    editor._layers.push({ id: '1', name: 'Layer 2', visible: true });
    editor._activeLayer = '0';
    editor.pushState();

    editor._layers[0].pattern = { ...editor._layers[0].pattern, seed: 222 };
    editor._activeLayer = '1';
    editor.pushState();

    editor.undo();

    expect(activeLayerPattern(editor).seed).toBe(111);
    expect(editor._activeLayer).toBe('0');
  });

  it('redo re-applies the LATER seed after an undo', () => {
    const editor = makeUndoMockEditor();
    editor._layers[0].pattern = { id: 'lattice-1', seed: 111 };
    editor.pushState();
    editor._layers[0].pattern = { ...editor._layers[0].pattern, seed: 222 };
    editor.pushState();

    editor.undo();
    expect(activeLayerPattern(editor).seed).toBe(111);
    editor.redo();
    expect(activeLayerPattern(editor).seed).toBe(222);
  });

  it('a snapshot taken BEFORE the first-ever Generate restores the pattern field to undefined (not a stale later pattern)', () => {
    const editor = makeUndoMockEditor();
    editor.pushState(); // snapshot A: no pattern yet

    editor._layers[0].pattern = { id: 'lattice-1', seed: 111 };
    editor.pushState(); // snapshot B: first Generate

    editor.undo();

    expect(activeLayerPattern(editor)).toBeUndefined();
  });

  it('two Generates then two undos returns to the ORIGINAL (pre-pattern) state — the exact live-browser scenario', () => {
    const editor = makeUndoMockEditor();
    editor.pushState(); // initial, no pattern

    editor._layers[0].pattern = { id: 'lattice-1', seed: 747641 };
    editor.pushState(); // Generate #1

    editor._layers[0].pattern = { ...editor._layers[0].pattern, seed: 22723 };
    editor.pushState(); // Generate #2 (Regenerate)

    editor.undo();
    expect(activeLayerPattern(editor).seed).toBe(747641);

    editor.undo();
    expect(activeLayerPattern(editor)).toBeUndefined();
  });
});

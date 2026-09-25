/**
 * SE12 T38 item 1 — "refresh the preview on undo/redo, layer switch and
 * document open/restore (not only on edits)". T37 wired refreshOutlinePreview
 * into editor.js's _notifyChange('commit'), which every EDIT already goes
 * through — but undo/redo (_restoreState) and setLayerVisible both called
 * `editor._onChange()` DIRECTLY, bypassing _notifyChange entirely (a
 * widespread pre-existing pattern across this codebase, ~25 occurrences
 * across 10 files — not swept this turn, flagged in WORK-LOG; fixed only
 * at the two spots that actually needed it for this requirement).
 *
 * "document open/restore" has no dedicated test here: editor-io.js's
 * open() needs a much heavier mock than this file's style (several other
 * test files note the same and avoid it — see editor-serialization.test.js's
 * own comment). open() calls editor.setActiveLayer(firstLayerId) as its
 * own last roster-restore step, so the setActiveLayer test below covers
 * it TRANSITIVELY; the live CDP check (WORK-LOG) is the direct, real-app
 * proof for the open/restore path specifically.
 */
import { describe, it, expect } from 'vitest';
import { setActiveLayer } from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';
import { VectorEditor } from '../bspline-frame-builder/b-spline-gen/html/editor/editor.js';

function mockPreviewLayer() {
  const shapes = [];
  return {
    _shapes: shapes,
    clear() { shapes.length = 0; },
    path(d) {
      const shape = { _d: d, fill() { return shape; }, stroke() { return shape; }, addClass() { return shape; }, attr() { return shape; } };
      shapes.push(shape);
      return shape;
    },
  };
}

function mockLineEl(attrs) {
  const state = { ...attrs };
  const el = {
    type: 'line',
    attr: (a) => state[a],
    // T40: OUTLINE_KINDS reads stroke-linecap via el.node.getAttribute,
    // not el.attr (see editor-outline-preview.js's _capOf for why) — the
    // mock's .node needs the same "genuinely absent -> null" contract.
    node: { getAttribute: (a) => (a in state ? state[a] : null) },
    addClass() { return el; },
    removeClass() { return el; },
    svg() { return '<line />'; }, // stand-in: pushState's snapshot text isn't asserted on in this file
  };
  return el;
}

/** Same shape as editor-lattice-undo.test.js's own makeUndoMockEditor
 *  sketchLayer: children() returns a real array (so both .map — pushState
 *  — and .toArray — refreshOutlinePreview/applyLayerState — work) with
 *  .toArray attached. */
function mockSketchLayer(childrenArr) {
  return {
    children: () => {
      const arr = childrenArr.slice();
      arr.toArray = () => arr;
      return arr;
    },
    clear() { childrenArr.length = 0; },
    svg(s) { if (s !== undefined) { /* no-op: not asserted on in this file */ } },
    node: {},
  };
}

const LINE_ATTRS = { x1: 0, y1: 0, x2: 10, y2: 0, 'stroke-width': 2, 'stroke-linecap': 'round', 'data-layer': '1', stroke: '#000', fill: 'none' };
// SE12 T38: every previewed element now draws a halo shape + a line
// shape (the visibility fix), not one — see editor-outline-preview.test.js's
// own HALO_AND_LINE constant for the same reasoning.
const HALO_AND_LINE = 2;

describe('setActiveLayer — refreshes the outline preview (covers "layer switch" AND, transitively, document open/restore via editor-io.js open()\'s own call to it)', () => {
  it('switching the active layer rebuilds the preview from the CURRENT layer state', () => {
    const line = mockLineEl(LINE_ATTRS);
    const editor = {
      _layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }, { id: '2', visible: true, fusionGeometry: 'centerline' }],
      _activeLayer: '2',
      _sketchLayer: mockSketchLayer([line]),
      _outlinePreviewLayer: mockPreviewLayer(),
      _color: '#000',
    };
    setActiveLayer(editor, '1');
    expect(editor._activeLayer).toBe('1');
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(HALO_AND_LINE); // layer '1' is outline, line belongs to it
  });

  it('non-vacuous: the preview is genuinely REBUILT, not just left alone — switching to a state with nothing to preview empties it', () => {
    const line = mockLineEl(LINE_ATTRS); // data-layer '1'
    const editor = {
      _layers: [{ id: '1', visible: true, fusionGeometry: 'outline' }],
      _activeLayer: '1',
      _sketchLayer: mockSketchLayer([line]),
      _outlinePreviewLayer: mockPreviewLayer(),
      _color: '#000',
    };
    setActiveLayer(editor, '1'); // populate it once
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(HALO_AND_LINE);
    editor._layers[0].fusionGeometry = 'centerline'; // simulate an external change between calls
    setActiveLayer(editor, '1'); // same id — still must re-read current state, not cache
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(0);
  });
});

describe('undo/redo (_restoreState) — refreshes the outline preview via _notifyChange (T38 fix: was a direct _onChange() bypass)', () => {
  function makeUndoableEditor(initialShapesLayer) {
    const line = mockLineEl(LINE_ATTRS);
    let sketchChildren = [line];
    // Purpose-built, not the shared mockSketchLayer: _restoreState
    // unconditionally clear()s then re-injects via .svg(markup) — this
    // mock's .svg(s) re-adds the SAME line object on a truthy call,
    // simulating "restore" without needing real SVG markup parsing
    // (this file only asserts on _layers/preview state, never on sketch
    // content itself).
    const sketchLayer = {
      children: () => { const arr = sketchChildren.slice(); arr.toArray = () => arr; return arr; },
      clear() { sketchChildren = []; },
      svg(s) { if (s) sketchChildren = [line]; },
      node: {},
    };
    return {
      _sketchLayer: sketchLayer,
      _outlinePreviewLayer: mockPreviewLayer(),
      _layers: [{ id: '1', visible: true, fusionGeometry: initialShapesLayer }],
      _activeLayer: '1',
      _undoStack: [], _redoStack: [], _maxUndo: 40,
      _selectedElement: null, _selectedElements: [],
      _latticePattern: null, _onChange: null, _onCommit: null,
      _color: '#000',
      _deselect() {},
      _pendingChangeFrame: null,
      pushState: VectorEditor.prototype.pushState,
      undo: VectorEditor.prototype.undo,
      redo: VectorEditor.prototype.redo,
      _restoreState: VectorEditor.prototype._restoreState,
      _notifyChange: VectorEditor.prototype._notifyChange,
    };
  }

  it('undo rebuilds the preview to match the RESTORED layer state', () => {
    const editor = makeUndoableEditor('outline');
    editor.pushState(); // snapshot #1: outline, 1 preview shape once refreshed
    editor._layers[0].fusionGeometry = 'centerline';
    editor.pushState(); // snapshot #2: centerline, 0 preview shapes

    editor.undo(); // back to snapshot #1's layers array (deep-cloned by pushState)
    expect(editor._layers[0].fusionGeometry).toBe('outline');
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(HALO_AND_LINE);
  });

  it('redo re-applies the LATER state and refreshes the preview again', () => {
    const editor = makeUndoableEditor('outline');
    editor.pushState();
    editor._layers[0].fusionGeometry = 'centerline';
    editor.pushState();
    editor.undo();
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(HALO_AND_LINE);

    editor.redo();
    expect(editor._layers[0].fusionGeometry).toBe('centerline');
    expect(editor._outlinePreviewLayer._shapes).toHaveLength(0);
  });
});

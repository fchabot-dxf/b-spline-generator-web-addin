/**
 * H20 item 4 (Fred, screenshot of a 'Delete "Ties" and its 3 elements?'
 * confirm: "dont ask"): the confirm() is removed from the layer-delete
 * button's click handler (editor/layers.js). Deleting a layer now happens
 * immediately; the checklist requires PROVING the undo round-trip exists
 * before trusting the removed safety net.
 *
 * Renders the REAL layer row (renderLayersPanel -> _makeLayerRow) into a
 * real DOM container and clicks the REAL delete button — not a
 * reimplementation of the click handler — then uses the REAL
 * VectorEditor.prototype.pushState/undo/_restoreState via `.call(mock)`,
 * same convention as editor-lattice-undo.test.js and
 * tests/h20-clear-scoped.test.js.
 */
import { describe, it, expect } from 'vitest';
import { VectorEditor } from '../bspline-frame-builder/b-spline-gen/html/editor/editor.js';
import { renderLayersPanel } from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';

function makeChild(id, layerId, onRemove) {
  const attrs = { 'data-layer': layerId, id };
  const classes = new Set();
  return {
    node: {
      getAttribute: (k) => (k === 'class' ? [...classes].join(' ') : (attrs[k] ?? null)),
      setAttribute: (k, v) => { attrs[k] = v; },
      hasAttribute: (k) => k in attrs,
      parentNode: {},
    },
    addClass: (c) => classes.add(c),
    removeClass: (c) => classes.delete(c),
    attr: (k) => attrs[k] ?? null,
    svg: () => `<marker data-id="${id}" data-layer="${layerId}"/>`,
    // layers.js's removeLayer() calls this directly on each doomed child,
    // same as a real svg.js element — splice self out of THIS sketch
    // layer's own current children array (bound via closure, below).
    remove() { onRemove(this); },
  };
}

function makeSketchLayer(initialIds) {
  let children = [];
  const layer = {
    clear() { children = []; },
    children() {
      const arr = children.slice();
      arr.toArray = () => arr;
      arr.forEach = (fn) => children.forEach(fn);
      return arr;
    },
    svg(str) {
      if (str === undefined) return children.map((c) => c.svg()).join('');
      const ids = [...str.matchAll(/data-id="([^"]+)" data-layer="([^"]+)"/g)];
      children = ids.map(([, id, layerId]) => makeChild(id, layerId, (self) => {
        children = children.filter((c) => c !== self);
      }));
    },
    node: {},
  };
  children = initialIds.map(([id, layerId]) => makeChild(id, layerId, (self) => {
    children = children.filter((c) => c !== self);
  }));
  return layer;
}

function makeEditor() {
  const editor = {
    _editorTab: 'artwork',
    _sketchLayer: makeSketchLayer([['rail-1', 'rails'], ['tie-1', 'ties']]),
    _layers: [
      { id: 'rails', name: 'Rails', visible: true },
      { id: 'ties', name: 'Ties', visible: true, pattern: { id: 'lattice-1', seed: 7 }, carve: true, depth: 0.2, showColor: true },
      { id: 'nodes', name: 'Nodes', visible: true },
    ],
    _activeLayer: 'ties',
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
    _notifyChange: VectorEditor.prototype._notifyChange,
  };
  editor.pushState(); // baseline snapshot, matching a real session's post-load push
  return editor;
}

describe('H20 item 4: layer delete has no confirm; undo restores the FULL round trip', () => {
  it('clicking the delete button removes the layer WITHOUT any confirm dialog', () => {
    document.body.innerHTML = '<div id="editorLayersList"></div>';
    window.confirm = () => { throw new Error('confirm() must never be called for layer delete (H20 item 4)'); };
    const editor = makeEditor();
    renderLayersPanel(editor);

    const delBtn = document.querySelector('[data-layer-id="ties"] .layer-delete');
    expect(delBtn, 'delete button for the Ties row').toBeTruthy();
    expect(() => delBtn.click()).not.toThrow();

    expect(editor._layers.map((l) => l.id)).toEqual(['rails', 'nodes']);
    delete window.confirm;
  });

  it('undo restores the deleted layer, its elements, its ORDER, and its per-layer settings, in ONE step', () => {
    document.body.innerHTML = '<div id="editorLayersList"></div>';
    const editor = makeEditor();
    renderLayersPanel(editor);
    const stackDepthBefore = editor._undoStack.length;

    document.querySelector('[data-layer-id="ties"] .layer-delete').click();

    expect(editor._layers.map((l) => l.id)).toEqual(['rails', 'nodes']);
    expect(editor._sketchLayer.children().toArray().map((c) => c.node.getAttribute('id'))).toEqual(['rail-1']);
    // removeLayer() calls pushState() itself -- ONE additional undo step.
    expect(editor._undoStack.length).toBe(stackDepthBefore + 1);

    editor.undo();

    // The layer is back, in its ORIGINAL position (between rails and nodes)...
    expect(editor._layers.map((l) => l.id)).toEqual(['rails', 'ties', 'nodes']);
    // ...with its per-layer settings intact (3D relief/carve, colour, lattice tag)...
    const restored = editor._layers.find((l) => l.id === 'ties');
    expect(restored.pattern).toEqual({ id: 'lattice-1', seed: 7 });
    expect(restored.carve).toBe(true);
    expect(restored.depth).toBe(0.2);
    expect(restored.showColor).toBe(true);
    // ...its element is back...
    expect(editor._sketchLayer.children().toArray().map((c) => c.node.getAttribute('id')).sort())
      .toEqual(['rail-1', 'tie-1']);
    // ...and the layer that was active before the delete is active again.
    expect(editor._activeLayer).toBe('ties');
  });
});

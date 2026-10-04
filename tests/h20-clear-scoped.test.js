/**
 * H20 item 3 (Fred: "Clear all doesn't clear all" -- the layer list,
 * per-layer metadata and Lattice/Shape-Lattice pattern state all survived
 * the old Clear, which only did `editor._sketchLayer.clear()`).
 *
 * Live correction (Fred, relayed): "Clear scoped to the active tab -- the
 * Artwork tab clears only the artwork, the Frame tab only the frame" --
 * this supersedes the ORIGINAL dispatch text ("Does NOT touch the Frame"),
 * which never made it into NEXT-SESSION.md's own checklist wording (still
 * reads the old way at the time of this commit); followed the newer,
 * more specific correction per this session's established precedent for
 * reconciling channels that haven't caught up with each other yet.
 *
 * `resetArtworkToFresh` (editor-io.js) is the SAME function open()'s own
 * empty-session path uses -- declared once, reused by Clear -- so this
 * suite exercises it directly (real function, not a reimplementation),
 * plus the real `VectorEditor.prototype.pushState/undo/_restoreState` via
 * `.call(mock)`, same convention as editor-lattice-undo.test.js.
 */
import { describe, it, expect, vi } from 'vitest';
// Audit K5: Clear asks through the in-app confirmDialog (async), not window.confirm.
const dialog = vi.hoisted(() => ({ answer: true }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/confirm-dialog.js', () => ({ confirmDialog: vi.fn(async () => dialog.answer) }));
const flush = () => new Promise((r) => setTimeout(r, 0));
import { VectorEditor } from '../bspline-frame-builder/b-spline-gen/html/editor/editor.js';
import { resetArtworkToFresh, sync3DBackground } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-io.js';
import { registerActionTools } from '../bspline-frame-builder/b-spline-gen/html/editor/tools/action-tools.js';
import { setFrameClearHandler } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';

/** A minimal SVG.js-like child element: enough for pushState's `.svg()`
 *  read, _restoreState's `.svg(str)` write + reconstruction, and
 *  applyLayerState's addClass/removeClass/getAttribute calls. */
function makeChild(id, layerId) {
  const classes = new Set();
  const attrs = { 'data-layer': layerId, id };
  return {
    node: {
      getAttribute: (k) => (k === 'class' ? [...classes].join(' ') : (attrs[k] ?? null)),
      setAttribute: (k, v) => { attrs[k] = v; },
      hasAttribute: (k) => k in attrs,
      parentNode: {},
    },
    addClass: (c) => classes.add(c),
    removeClass: (c) => classes.delete(c),
    // SVG.js element convention: .attr(key) reads directly off the
    // wrapper, not via .node.getAttribute -- getElementLayer (layers.js)
    // calls it this way.
    attr: (k) => attrs[k] ?? null,
    svg: () => `<marker data-id="${id}" data-layer="${layerId}"/>`,
  };
}

function makeSketchLayer(initialChildren) {
  let children = initialChildren.slice();
  const layerObj = {
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
      children = ids.map(([, id, layerId]) => makeChild(id, layerId));
    },
    node: {},
  };
  return layerObj;
}

function makeEditor() {
  const drawnPath = makeChild('path-1', '1');
  const editor = {
    _editorTab: 'artwork',
    _sketchLayer: makeSketchLayer([drawnPath]),
    _layers: [
      { id: '0', name: 'Layer 1', visible: true },
      // The "extra layer" + a Shape Lattice pattern (3D off) on it.
      { id: '1', name: 'Rails', visible: true, pattern: { id: 'lattice-1', seed: 42, threeDOff: true } },
    ],
    _activeLayer: '1',
    _undoStack: [],
    _redoStack: [],
    _maxUndo: 40,
    _selectedElement: null,
    _selectedElements: [],
    _onChange: null,
    _onCommit: null,
    _deselect: vi.fn(),
    pushState: VectorEditor.prototype.pushState,
    _snapshotState: VectorEditor.prototype._snapshotState,
    undo: VectorEditor.prototype.undo,
    redo: VectorEditor.prototype.redo,
    _restoreState: VectorEditor.prototype._restoreState,
    _notifyChange: VectorEditor.prototype._notifyChange,
  };
  editor.pushState(); // baseline snapshot (matches a real session's "post-load" push)
  return editor;
}

function freshSessionLayers() {
  const fresh = makeEditor();
  fresh._layers = [];
  fresh._activeLayer = null;
  fresh._sketchLayer = makeSketchLayer([]);
  resetArtworkToFresh(fresh);
  return fresh._layers;
}

describe('H20 item 3: resetArtworkToFresh matches a brand-new session\'s artwork exactly', () => {
  it('one default layer, no pattern, matching a fresh open(editor, null, w, h) session', () => {
    const editor = makeEditor();
    resetArtworkToFresh(editor);

    const fresh = freshSessionLayers();
    expect(editor._layers).toEqual(fresh);
    expect(editor._layers).toHaveLength(1);
    expect(editor._layers[0].pattern).toBeUndefined();
    expect(editor._activeLayer).toBe(editor._layers[0].id);
  });

  it('clears the sketch layer content (the drawn path is gone)', () => {
    const editor = makeEditor();
    resetArtworkToFresh(editor);
    expect(editor._sketchLayer.children().toArray()).toHaveLength(0);
  });

  it('deselects', () => {
    const editor = makeEditor();
    resetArtworkToFresh(editor);
    expect(editor._deselect).toHaveBeenCalled();
  });
});

describe('H20 item 3: editorClear is scoped to the active tab', () => {
  function setupDom() {
    document.body.innerHTML = `
      <button id="toolDelete"></button><button id="editorUndo"></button><button id="editorRedo"></button>
      <button id="toolFit"></button><button id="toolResetTransform"></button><button id="toolFlattenTransform"></button>
      <button id="editorClear"></button><button id="editorDownload"></button>
      <button id="editorApply"></button><button id="editorCancel"></button><button id="editorUnexpand"></button>
    `;
  }

  it('Artwork tab: Clear resets the artwork to a fresh session in ONE undo step, and undo brings the original back', async () => {
    setupDom();
    dialog.answer = true;
    const editor = makeEditor();
    editor._editorTab = 'artwork';
    editor.fitView = () => {};
    editor.resetSelectionTransform = () => {};
    editor.flattenSelectionTransform = () => {};
    editor.deleteSelected = () => {};
    registerActionTools(editor);

    const stackDepthBefore = editor._undoStack.length;
    document.getElementById('editorClear').click();
    await flush(); // Clear awaits the in-app confirmDialog

    // Reset happened...
    expect(editor._layers).toHaveLength(1);
    expect(editor._layers[0].pattern).toBeUndefined();
    expect(editor._sketchLayer.children().toArray()).toHaveLength(0);
    // ...as exactly ONE undo step.
    expect(editor._undoStack.length).toBe(stackDepthBefore + 1);

    // Undo restores the ORIGINAL layer roster (with its pattern), the
    // drawn path, and the original active layer -- not just "something".
    editor.undo();
    expect(editor._layers).toHaveLength(2);
    expect(editor._layers.find((l) => l.id === '1').pattern).toEqual({ id: 'lattice-1', seed: 42, threeDOff: true });
    expect(editor._activeLayer).toBe('1');
    expect(editor._sketchLayer.children().toArray().map((c) => c.node.getAttribute('id'))).toEqual(['path-1']);
  });

  it('Frame tab: Clear calls the registered frame-clear handler, NOT resetArtworkToFresh -- the artwork is untouched', async () => {
    setupDom();
    dialog.answer = true;
    const editor = makeEditor();
    editor._editorTab = 'frame';
    editor.fitView = () => {};
    editor.resetSelectionTransform = () => {};
    editor.flattenSelectionTransform = () => {};
    editor.deleteSelected = () => {};
    registerActionTools(editor);

    const frameClear = vi.fn();
    setFrameClearHandler(frameClear);

    const layersBefore = editor._layers;
    const sketchChildrenBefore = editor._sketchLayer.children().toArray().length;
    document.getElementById('editorClear').click();
    await flush(); // Clear awaits the in-app confirmDialog

    expect(frameClear).toHaveBeenCalledTimes(1);
    // Artwork completely untouched -- Clear on the Frame tab never called
    // resetArtworkToFresh (same array reference, same content).
    expect(editor._layers).toBe(layersBefore);
    expect(editor._sketchLayer.children().toArray()).toHaveLength(sketchChildrenBefore);

    setFrameClearHandler(null);
  });

  it('F35 (Fred: "Clear leaves a ghost of the old content"): never snapshots the STALE background ' +
    'synchronously -- #svgEditorTopView has not been repainted yet at the moment Clear runs, so a ' +
    'synchronous sync3DBackground() call there is guaranteed to capture the pre-Clear terrain. The ' +
    'real repaint only happens via the async commitEdit -> onChange -> remask -> rebuild chain, ' +
    'which already calls sync3DBackground itself once the terrain is actually recomputed', async () => {
    setupDom();
    const canvas = document.createElement('canvas');
    canvas.id = 'svgEditorTopView';
    document.body.appendChild(canvas);
    dialog.answer = true;
    const editor = makeEditor();
    editor._editorTab = 'artwork';
    editor._draw = {}; // sync3DBackground's own `editor._draw` truthiness guard
    editor._guideLayer = { clear: () => {} }; // short-circuits refreshGuides' own _draw.group() call -- unrelated to this test
    const chainable = () => ({ fill: () => chainable(), stroke: () => chainable(), size: () => chainable(), attr: () => chainable() });
    editor._bgLayer = { clear: vi.fn(), image: vi.fn(() => chainable()), rect: vi.fn(() => chainable()) };
    editor.fitView = () => {};
    editor.resetSelectionTransform = () => {};
    editor.flattenSelectionTransform = () => {};
    editor.deleteSelected = () => {};
    registerActionTools(editor);

    document.getElementById('editorClear').click();
    await flush(); // Clear awaits the in-app confirmDialog

    // Nothing in editorClear's own path may paint the background -- if it did (the pre-fix bug), this
    // would already show a call. The one tick awaited above only lets the confirm dialog's answer
    // resolve; this fixture has no onChange -> remask chain that could repaint in between.
    expect(editor._bgLayer.image).not.toHaveBeenCalled();
    expect(editor._bgLayer.clear).not.toHaveBeenCalled();

    // Confirms the fixture itself is wired correctly (not vacuously passing because sync3DBackground
    // would no-op anyway): calling it FOR REAL on this same editor does reach _bgLayer.
    sync3DBackground(editor);
    expect(editor._bgLayer.image).toHaveBeenCalledTimes(1);

    canvas.remove();
  });

  it('does nothing when the confirm dialog is declined, on either tab', async () => {
    setupDom();
    dialog.answer = false;
    const editor = makeEditor();
    editor.fitView = () => {}; editor.resetSelectionTransform = () => {};
    editor.flattenSelectionTransform = () => {}; editor.deleteSelected = () => {};
    registerActionTools(editor);
    const frameClear = vi.fn();
    setFrameClearHandler(frameClear);

    const layersBefore = editor._layers;
    document.getElementById('editorClear').click();
    await flush(); // Clear awaits the in-app confirmDialog

    expect(editor._layers).toBe(layersBefore);
    expect(frameClear).not.toHaveBeenCalled();

    setFrameClearHandler(null);
  });
});

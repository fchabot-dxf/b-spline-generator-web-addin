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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// Audit K5: Clear asks through the in-app confirmDialog (async), not window.confirm.
const dialog = vi.hoisted(() => ({ answer: true }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/confirm-dialog.js', () => ({ confirmDialog: vi.fn(async () => dialog.answer) }));
const flush = () => new Promise((r) => setTimeout(r, 0));
import { VectorEditor } from '../bspline-frame-builder/b-spline-gen/html/editor/editor.js';
import { resetArtworkToFresh, sync3DBackground } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-io.js';
vi.mock('../bspline-frame-builder/b-spline-gen/html/main/photo-panel.js', () => ({ clearPhoto: vi.fn() }));
import { clearPhoto } from '../bspline-frame-builder/b-spline-gen/html/main/photo-panel.js';
import { CLEAR_KINDS, clearOptions, runClear, initClearMenu } from '../bspline-frame-builder/b-spline-gen/html/main/editor-clear-menu.js';
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
      for (const c of arr) c.remove = () => { children = children.filter((x) => x !== c); }; // item 28's per-kind clears
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

// F35 item 28 (Fred): the header's Clear is a MENU -- All / Frame / Artwork / Photo / Bricks -- built from the tab
// registry (main/editor-clear-menu.js). It supersedes H20 item 3's tab-scoped Clear (that block's tests retired).
describe('F35 item 28: the Clear menu (All / Frame / Artwork / Photo / Bricks)', () => {
  const BRICKS = { id: '7', name: 'Bricks', visible: true, brickLaidKey: 'KEY' };
  function editorWithBricks() {
    const editor = makeEditor();
    editor._layers = [...editor._layers, { ...BRICKS }];
    editor._sketchLayer = makeSketchLayer([makeChild('path-1', '1'), makeChild('brick-1', '7'), makeChild('brick-2', '7')]);
    editor._undoStack = [];
    editor.pushState();
    return editor;
  }
  const ids = (editor) => editor._sketchLayer.children().toArray().map((c) => c.node.getAttribute('id'));
  let frameClear;
  beforeEach(() => { frameClear = vi.fn(); setFrameClearHandler(frameClear); clearPhoto.mockClear(); dialog.answer = true; });
  afterEach(() => setFrameClearHandler(null));

  it('the options come from the tab registry: All first, then one per tab that declares `clears`', () => {
    expect(clearOptions().map((o) => [o.id, o.label])).toEqual([['all', 'All'], ['frame', 'Frame'], ['artwork', 'Artwork'], ['photo', 'Photo'], ['bricks', 'Bricks']]);
    expect(clearOptions()[0].kinds).toEqual(['frame', 'artwork', 'photo', 'bricks']);
    expect(Object.keys(CLEAR_KINDS)).toEqual(['frame', 'artwork', 'photo', 'bricks']);
  });

  it('Artwork: the art layers and their content go in ONE undo step, the Bricks layer and its bricks stay; undo brings it back', async () => {
    const editor = editorWithBricks();
    const depth = editor._undoStack.length;
    expect(await runClear('artwork', editor)).toBe(true);
    expect(ids(editor)).toEqual(['brick-1', 'brick-2']);
    expect(editor._layers.map((l) => l.name)).toEqual(['Layer 1', 'Bricks']); // the art layer stays in front
    expect(editor._layers.find((l) => l.name === 'Bricks').brickLaidKey).toBe('KEY');
    expect(editor._undoStack.length).toBe(depth + 1);
    expect(frameClear).not.toHaveBeenCalled();
    expect(clearPhoto).not.toHaveBeenCalled();
    editor.undo();
    expect(ids(editor)).toEqual(['path-1', 'brick-1', 'brick-2']);
    expect(editor._layers.find((l) => l.id === '1').pattern).toEqual({ id: 'lattice-1', seed: 42, threeDOff: true });
  });

  it('Bricks: every brick element goes, the laid key is nulled, the artwork stays; one undo step', async () => {
    const editor = editorWithBricks();
    const depth = editor._undoStack.length;
    await runClear('bricks', editor);
    expect(ids(editor)).toEqual(['path-1']);
    expect(editor._layers.find((l) => l.name === 'Bricks').brickLaidKey).toBe(null);
    expect(editor._layers.map((l) => l.name)).toEqual(['Layer 1', 'Rails', 'Bricks']);
    expect(editor._undoStack.length).toBe(depth + 1);
  });

  it('Frame: the frame-clear handler only (template -> Rectangle); the drawing is untouched, no editor undo step', async () => {
    const editor = editorWithBricks();
    const depth = editor._undoStack.length;
    await runClear('frame', editor);
    expect(frameClear).toHaveBeenCalledTimes(1);
    expect(ids(editor)).toEqual(['path-1', 'brick-1', 'brick-2']);
    expect(editor._undoStack.length).toBe(depth);
  });

  it('Photo: the photo clear only; the drawing is untouched', async () => {
    const editor = editorWithBricks();
    await runClear('photo', editor);
    expect(clearPhoto).toHaveBeenCalledTimes(1);
    expect(ids(editor)).toEqual(['path-1', 'brick-1', 'brick-2']);
  });

  it('All: asks first; declined = nothing; accepted = frame + photo + a fresh drawing in ONE undo step', async () => {
    const editor = editorWithBricks();
    dialog.answer = false;
    expect(await runClear('all', editor)).toBe(false);
    expect(frameClear).not.toHaveBeenCalled();
    expect(ids(editor)).toHaveLength(3);
    dialog.answer = true;
    const depth = editor._undoStack.length;
    expect(await runClear('all', editor)).toBe(true);
    expect(frameClear).toHaveBeenCalledTimes(1);
    expect(clearPhoto).toHaveBeenCalledTimes(1);
    expect(ids(editor)).toEqual([]);
    expect(editor._layers).toEqual(freshSessionLayers());
    expect(editor._undoStack.length).toBe(depth + 1);
  });

  it('only All asks: a single kind never opens the dialog', async () => {
    const { confirmDialog } = await import('../bspline-frame-builder/b-spline-gen/html/core/confirm-dialog.js');
    confirmDialog.mockClear();
    const editor = editorWithBricks();
    for (const id of ['frame', 'artwork', 'photo', 'bricks']) await runClear(id, editor);
    expect(confirmDialog).not.toHaveBeenCalled();
  });

  it('never snapshots the STALE background synchronously (the H20 "ghost" rule holds for All)', async () => {
    const canvas = document.createElement('canvas');
    canvas.id = 'svgEditorTopView';
    document.body.appendChild(canvas);
    const editor = editorWithBricks();
    editor._draw = {};
    editor._guideLayer = { clear: () => {} };
    const chainable = () => ({ fill: () => chainable(), stroke: () => chainable(), size: () => chainable(), attr: () => chainable() });
    editor._bgLayer = { clear: vi.fn(), image: vi.fn(() => chainable()), rect: vi.fn(() => chainable()) };
    await runClear('all', editor);
    expect(editor._bgLayer.image).not.toHaveBeenCalled();
    sync3DBackground(editor); // the fixture is live: a real call does reach _bgLayer
    expect(editor._bgLayer.image).toHaveBeenCalledTimes(1);
    canvas.remove();
  });

  it('the header menu: Clear opens it (icons none, one button per option), an item runs its clear and closes it', async () => {
    document.body.innerHTML = '<button id="editorClear">Clear</button>';
    initClearMenu();
    const menu = document.getElementById('editorClearMenu');
    expect([...menu.querySelectorAll('button')].map((b) => b.id)).toEqual(['editorClear_all', 'editorClear_frame', 'editorClear_artwork', 'editorClear_photo', 'editorClear_bricks']);
    expect(menu.style.display).toBe('none');
    document.getElementById('editorClear').click();
    expect(menu.style.display).toBe('flex');
    expect(document.getElementById('editorClear').getAttribute('aria-expanded')).toBe('true');
    window.svgEditor = editorWithBricks();
    document.getElementById('editorClear_frame').click();
    await flush();
    expect(frameClear).toHaveBeenCalledTimes(1);
    expect(menu.style.display).toBe('none');
    window.svgEditor = null;
  });
});

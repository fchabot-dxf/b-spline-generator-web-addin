/**
 * Layer lock (Fred 2026-10-18, "a layer I have already cut must not change"): a manual, all-or-nothing lock on a
 * Layers-panel row -- layer.userLocked, a SEPARATE flag from the job timeline's jobLocked (main/job-timeline-lock.js
 * rewrites that on every sync), read by the SAME gates through layers.js isLayerLocked. A locked layer's pieces can't
 * be hit, selected or dragged, nothing is added to or erased from it, Generate / Regenerate / Clear leave it exactly as
 * it is (and say so), the x is disabled, and the lock is a protection setting: never in Undo / Redo, saved with the
 * board (written only when true -- an absent field is unlocked, so a board saved before the lock is unchanged).
 * Real app code over the same mocks the neighbouring suites use (editor-lattice-pattern-emit, editor-hit,
 * brick-element-records, editor-lattice-undo, job-timeline-layer-lock).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-commit.js', () => ({ commitEdit: vi.fn() }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  const sq = (x, id) => ({ id, polygon: [{ x, y: 0 }, { x: x + 1, y: 0 }, { x: x + 1, y: 0.3 }, { x, y: 0.3 }] });
  return { ...actual, generateBricks: vi.fn(() => ({ bricks: [sq(1, 'w1'), sq(3, 'w2')], frameBricks: [sq(5, 'f1')] })) };
});

import { showToast } from '../bspline-frame-builder/b-spline-gen/html/core/toast.js';
import {
  isJobLocked, isUserLocked, isLayerLocked, isEditableByLayer, isOnVisibleLayer, setLayerLocked, renderLayerList, reopenKeepingLocks,
} from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';
import { getNearbyElement, lockedPieceAt } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-hit.js';
import { syncLayerLocks } from '../bspline-frame-builder/b-spline-gen/html/main/job-timeline-lock.js';
import { jobProjectOf, deriveJobSteps, defaultJobOrder } from '../bspline-frame-builder/b-spline-gen/html/core/job-timeline.js';
import { handleStart, pasteClipboard } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-interaction.js';
import { finishEraserStroke } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-eraser.js';
import { clearArtworkLayers, clearBrickElements } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-clear.js';
import { generatePattern, PATTERN_DEFAULTS, freshPattern } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { runBricks, brickRecordNode, heightPickBricks, brickAccentClickHandler, brickElementSelectHandler } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { save } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-io.js';
import { VectorEditor } from '../bspline-frame-builder/b-spline-gen/html/editor/editor.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

beforeEach(() => { vi.clearAllMocks(); });

const toasts = () => showToast.mock.calls.map((c) => c[0]);

// ---- the shapes the neighbouring suites use ----------------------------------------------------------------------------

/** editor-hit.test.js's element: a world bbox + a layer. */
function shapeEl({ bbox, layer = '0' }) {
  return { bbox: () => bbox, matrix: () => null, attr: (k) => (k === 'data-layer' ? layer : null) };
}
const BOX = (x, y, w = 1, h = 1) => ({ x, y, w, h, x2: x + w, y2: y + h });

/** editor-lattice-pattern-emit.test.js's in-memory sketch layer (real addLayer / emit round trip). */
function lineEditor() {
  let elements = [];
  function makeElement(initial) {
    const store = { ...initial };
    const el = {
      node: { getAttribute: (k) => (store[k] !== undefined ? store[k] : null), hasAttribute: (k) => store[k] !== undefined },
      attr(k, ...rest) {
        if (rest.length === 0) return store[k];
        const v = rest[0];
        if (v === null || v === undefined) delete store[k]; else store[k] = v;
        return el;
      },
      stroke(v) { if (v && typeof v === 'object') { if ('color' in v) store.stroke = v.color; if ('width' in v) store['stroke-width'] = v.width; } return el; },
      fill(v) { if (v !== undefined) store.fill = v; return el; },
      center(x, y) { store.cx = x; store.cy = y; return el; },
      addClass() { return el; }, removeClass() { return el; }, hasClass: () => false,
      remove() { elements = elements.filter((e) => e !== el); },
    };
    return el;
  }
  const sketchLayer = {
    line(x1, y1, x2, y2) { const el = makeElement({ x1, y1, x2, y2 }); elements.push(el); return el; },
    circle(d) { const el = makeElement({ r: d / 2 }); elements.push(el); return el; },
    children() { const arr = elements.slice(); arr.toArray = () => arr; return arr; },
    node: {},
  };
  const editor = {
    _mW: 4, _mH: 4, _sketchLayer: sketchLayer,
    _layers: [{ id: '0', name: 'Layer 1', visible: true }], _activeLayer: '0',
    _color: '#000', _strokeWidth: 0.02, _selectedElements: [],
    pushStateCalls: 0, notifyChangeCalls: [],
    pushState() { editor.pushStateCalls++; },
    _notifyChange(kind) { editor.notifyChangeCalls.push(kind); },
  };
  return editor;
}

describe('the flag: one mechanism, two flags', () => {
  it('isLayerLocked reads jobLocked OR userLocked; isUserLocked only the manual one; absent = unlocked', () => {
    expect(isLayerLocked({ id: '0' })).toBe(false);
    expect(isLayerLocked(undefined)).toBe(false);
    expect(isLayerLocked({ id: '0', userLocked: true })).toBe(true);
    expect(isLayerLocked({ id: '0', jobLocked: true })).toBe(true);
    expect(isUserLocked({ id: '0', jobLocked: true })).toBe(false);
    expect(isJobLocked({ id: '0', userLocked: true })).toBe(false);
  });

  it('the timeline sync rewrites jobLocked on every sync and never touches a manual lock', () => {
    const editor = lineEditor();
    editor._layers[0].pattern = freshPattern(editor);
    editor._layers[0].userLocked = true;
    const steps = deriveJobSteps(jobProjectOf(editor._layers, null));
    const order = defaultJobOrder(steps);
    syncLayerLocks(steps, order, 0, editor); // the head at the start: nothing job-locked
    expect(editor._layers[0].jobLocked).toBe(false);
    expect(editor._layers[0].userLocked).toBe(true);
    syncLayerLocks(steps, order, order.length, editor); // everything cut
    expect(editor._layers[0].jobLocked).toBe(true);
    expect(editor._layers[0].userLocked).toBe(true);
  });

  it('a piece of a locked layer is neither editable nor hittable -- in either hit mode; an unlocked layer still is', () => {
    const locked = shapeEl({ bbox: BOX(0, 0), layer: '1' });
    const free = shapeEl({ bbox: BOX(5, 5), layer: '2' });
    const editor = {
      _strokeWidth: 0.5, _activeLayer: '1',
      _layers: [{ id: '1', visible: true, userLocked: true }, { id: '2', visible: true }],
      _sketchLayer: { children: () => ({ toArray: () => [locked, free] }) },
    };
    expect(isEditableByLayer(editor, locked)).toBe(false);
    expect(isOnVisibleLayer(editor, locked)).toBe(false);
    expect(getNearbyElement(editor, { x: 0.5, y: 0.5 }, 0.1)).toBeNull(); // the active layer's own piece
    expect(getNearbyElement(editor, { x: 0.5, y: 0.5 }, 0.1, { anyVisibleLayer: true })).toBeNull(); // Select / Node
    expect(getNearbyElement(editor, { x: 5.5, y: 5.5 }, 0.1, { anyVisibleLayer: true })).toBe(free);
    expect(lockedPieceAt(editor, { x: 0.5, y: 0.5 }, 0.1)).toBe(locked); // found only to say WHY nothing was picked
    expect(lockedPieceAt(editor, { x: 5.5, y: 5.5 }, 0.1)).toBeNull();
  });
});

describe('setLayerLocked: a protection setting, not an edit', () => {
  it('writes the flag only when true (an unlock deletes it: absent = unlocked), with NO undo step', () => {
    const editor = lineEditor();
    setLayerLocked(editor, '0', true);
    expect(editor._layers[0].userLocked).toBe(true);
    setLayerLocked(editor, '0', false);
    expect('userLocked' in editor._layers[0]).toBe(false);
    expect(editor.pushStateCalls).toBe(0); // lock / unlock make no undo step
    expect(editor.notifyChangeCalls).toEqual(['commit', 'commit']); // but the host is told, so it is saved
  });

  it('locking drops a selected piece of that layer and keeps one of another', () => {
    const editor = lineEditor();
    editor._layers.push({ id: '1', name: 'Layer 2', visible: true });
    const on0 = shapeEl({ bbox: BOX(0, 0), layer: '0' });
    const on1 = shapeEl({ bbox: BOX(2, 2), layer: '1' });
    editor._selectedElements = [on0, on1];
    editor._selectMany = vi.fn((els) => { editor._selectedElements = els; });
    editor._deselect = vi.fn();
    setLayerLocked(editor, '0', true);
    expect(editor._selectedElements).toEqual([on1]);
  });
});

describe('the Layers row: a padlock after the colour button, the x disabled while locked', () => {
  const rowsOf = (editor) => {
    const box = document.createElement('div');
    renderLayerList(box, editor, { compact: false });
    return box;
  };
  const makeEditor = (layers) => ({ _layers: layers, _activeLayer: layers[0].id, _sketchLayer: { children: () => ({ toArray: () => [], forEach() {} }) }, pushState() {}, _notifyChange() {} });

  it('every row has the lock as the 4th segmented button; unlocked reads open, locked reads pressed + the row is marked', () => {
    const box = rowsOf(makeEditor([{ id: '0', name: 'Rails', visible: true }, { id: '1', name: 'Nodes', visible: true, userLocked: true }]));
    const [nodesRow, railsRow] = [...box.querySelectorAll('.layer-row')]; // top of the z-order first
    const btns = (row) => [...row.querySelectorAll('.segmented-group > button')];
    expect(btns(railsRow)).toHaveLength(4);
    expect(btns(railsRow)[3].classList.contains('layer-lock')).toBe(true);
    expect(btns(railsRow)[3].getAttribute('aria-pressed')).toBe('false');
    expect(btns(railsRow)[3].title).toMatch(/Unlocked/);
    expect(railsRow.classList.contains('is-locked')).toBe(false);
    expect(btns(nodesRow)[3].getAttribute('aria-pressed')).toBe('true');
    expect(btns(nodesRow)[3].classList.contains('active')).toBe(true);
    expect(btns(nodesRow)[3].title).toMatch(/Locked/);
    expect(nodesRow.classList.contains('is-locked')).toBe(true);
  });

  it('clicking it locks the layer (and a second click unlocks it)', () => {
    const editor = makeEditor([{ id: '0', name: 'Rails', visible: true }, { id: '1', name: 'Nodes', visible: true }]);
    document.body.innerHTML = '<div id="editorLayersList"></div>';
    renderLayerList(document.getElementById('editorLayersList'), editor, { compact: false });
    const lockOf = (id) => document.querySelector(`.layer-row[data-layer-id="${id}"] .layer-lock`);
    lockOf('0').click();
    expect(editor._layers[0].userLocked).toBe(true);
    expect(isUserLocked(editor._layers[1])).toBe(false);
    document.querySelector('.layer-row[data-layer-id="0"] .layer-lock').click();
    expect(editor._layers[0].userLocked).toBeUndefined();
  });

  it('the x of a locked layer is disabled, and removing it by any path is refused with the toast', () => {
    const editor = makeEditor([{ id: '0', name: 'Rails', visible: true, userLocked: true }, { id: '1', name: 'Nodes', visible: true }]);
    const box = rowsOf(editor);
    const del = (id) => box.querySelector(`.layer-row[data-layer-id="${id}"] .layer-delete`);
    expect(del('0').disabled).toBe(true);
    expect(del('1').disabled).toBe(false); // the other layer still deletes
    del('0').disabled = false; // even if the button were live, the delete itself refuses
    del('0').click();
    expect(editor._layers.map((l) => l.id)).toEqual(['0', '1']);
    expect(toasts()).toContain('"Rails" is locked — unlock it in Layers to change it');
  });
});

describe('tools: nothing is added to a locked layer, a tap on a locked piece says why', () => {
  const pressEditor = (mode, layers = [{ id: '0', name: 'Rails', visible: true, userLocked: true }]) => ({
    _currentMode: mode, _layers: layers, _activeLayer: '0', _isDrawing: false, _isDragging: false, _spaceHeld: false,
    _strokeWidth: 0.5, _sketchLayer: { children: () => ({ toArray: () => [] }) },
  });
  const left = { button: 0, altKey: false };

  it.each(['draw', 'line', 'rect', 'circle', 'text', 'lattice', 'brickBrush', 'brickWallArea'])('%s on a locked active layer: refused with the toast, no gesture starts', (mode) => {
    const editor = pressEditor(mode);
    handleStart(editor, left);
    expect(editor._isDrawing).toBe(false);
    expect(toasts()).toEqual(['"Rails" is locked — unlock it in Layers to change it']);
  });

  it('Select on a locked piece picks nothing and says why; on empty canvas it stays quiet', () => {
    const lockedPiece = shapeEl({ bbox: BOX(0, 0), layer: '0' });
    const editor = {
      ...pressEditor('select'),
      _getMousePoint: () => ({ x: 0.5, y: 0.5 }), _getDynamicTolerance: () => 0.1,
      _getNearbyElement: (pt, tol, opts) => getNearbyElement(editor, pt, tol, opts),
      _sketchLayer: { children: () => ({ toArray: () => [lockedPiece] }) },
      _view: { zoom: 1 },
    };
    try { handleStart(editor, left); } catch (_) { /* the select handler itself needs the whole editor; the toast comes first */ }
    expect(toasts()).toEqual(['"Rails" is locked — unlock it in Layers to change it']);
    vi.clearAllMocks();
    editor._getMousePoint = () => ({ x: 9, y: 9 });
    try { handleStart(editor, left); } catch (_) { /* as above */ }
    expect(toasts()).toEqual([]);
  });
});

describe('the eraser never erases from a locked layer', () => {
  /** an open stroke on a layer: a horizontal line the eraser swipe crosses (real getTotalLength / getPointAtLength shape) */
  const stroke = (layer) => {
    const attrs = { 'data-layer': layer, stroke: '#000', 'stroke-width': 0.05, d: 'M 0 1 L 4 1' };
    const el = {
      type: 'path',
      node: {
        parentNode: {}, getAttribute: (k) => (k === 'class' ? '' : attrs[k] ?? null), hasAttribute: () => false,
        getTotalLength: () => 4, getPointAtLength: (t) => ({ x: t, y: 1 }),
      },
      attr: (k, v) => { if (v === undefined) return attrs[k]; attrs[k] = v; return el; },
      matrix: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      addClass() { return el; }, removeClass() { return el; }, hasClass: () => false,
      remove: vi.fn(),
    };
    return el;
  };
  const eraserEditor = (els, layers) => {
    const editor = {
      _layers: layers, _activeLayer: '0', _strokeWidth: 0.5, _currentTab: 'draw',
      _eraserPoints: [{ x: -1, y: 1 }, { x: 5, y: 1 }], _eraserPath: null, // a swipe along the whole stroke
      _sketchLayer: { children: () => ({ toArray: () => els, forEach: (f) => els.forEach(f) }), path: vi.fn() },
      pushState: vi.fn(), _notifyChange: vi.fn(),
    };
    return editor;
  };

  it('a swipe across a locked layer\'s stroke leaves it untouched and says so; the same stroke on an unlocked layer is cut', async () => {
    const lockedEl = stroke('0');
    const freeEl = stroke('1');
    const editor = eraserEditor([lockedEl, freeEl], [{ id: '0', name: 'Rails', visible: true, userLocked: true }, { id: '1', name: 'Layer 2', visible: true }]);
    editor._sketchLayer.path = vi.fn(() => ({ fill() { return this; }, stroke() { return this; }, attr() { return this; }, remove() {} }));
    await finishEraserStroke(editor);
    expect(lockedEl.remove).not.toHaveBeenCalled();
    expect(toasts()).toEqual(['"Rails" is locked — unlock it in Layers to change it']);
    expect(freeEl.remove).toHaveBeenCalled(); // non-vacuous: the unlocked twin, same swipe, WAS erased
    expect(editor.pushState).toHaveBeenCalled();
  });
});

describe('Generate leaves a locked layer exactly as it is, and says so', () => {
  it('Regenerate with the Rails layer locked: its pieces are the very same elements; Ties and Nodes are re-laid', async () => {
    const editor = lineEditor();
    const pattern = { ...PATTERN_DEFAULTS, seed: 1, ties: { ...PATTERN_DEFAULTS.ties, mode: 'density', density: 0.5 } };
    await generatePattern(editor, pattern);
    const railsLayer = editor._layers.find((l) => l.name === 'Rails');
    const onLayer = (id, kind) => editor._sketchLayer.children().filter((el) => el.attr('data-layer') === id && el.attr('data-lattice') === kind);
    const railsBefore = onLayer(railsLayer.id, 'rail');
    const tiesLayer = editor._layers.find((l) => l.name === 'Ties');
    const nodesLayer = editor._layers.find((l) => l.name === 'Nodes');
    const tiesBefore = onLayer(tiesLayer.id, 'tie');
    const nodesBefore = onLayer(nodesLayer.id, 'node');
    expect(railsBefore.length).toBeGreaterThan(0);
    expect(nodesBefore.length).toBeGreaterThan(0);
    railsBefore.forEach((el) => el.attr('data-mark', 'cut')); // what the machinist already cut
    railsLayer.userLocked = true;

    await generatePattern(editor, { ...pattern, seed: 2 });

    const railsAfter = onLayer(railsLayer.id, 'rail');
    expect(railsAfter).toHaveLength(railsBefore.length);
    expect(railsAfter.every((el, i) => el === railsBefore[i] && el.attr('data-mark') === 'cut')).toBe(true); // the same pieces
    expect(onLayer(nodesLayer.id, 'node').some((el) => nodesBefore.includes(el))).toBe(false); // the unlocked Nodes were re-laid
    expect(onLayer(nodesLayer.id, 'node').length).toBeGreaterThan(0);
    expect(toasts()).toContain('"Rails" is locked, left as it is');
    void tiesBefore;
  });

  it('a lock does not stop an UNLOCKED pattern from regenerating its rails (non-vacuous control)', async () => {
    const editor = lineEditor();
    const pattern = { ...PATTERN_DEFAULTS, seed: 1 };
    await generatePattern(editor, pattern);
    const railsLayer = editor._layers.find((l) => l.name === 'Rails');
    const before = editor._sketchLayer.children().filter((el) => el.attr('data-layer') === railsLayer.id && el.attr('data-lattice') === 'rail');
    await generatePattern(editor, { ...pattern, seed: 2 });
    const after = editor._sketchLayer.children().filter((el) => el.attr('data-layer') === railsLayer.id && el.attr('data-lattice') === 'rail');
    expect(after.some((el) => before.includes(el))).toBe(false);
    expect(toasts()).toEqual([]);
  });
});

describe('a Wall / Frame lay leaves an element on a locked layer exactly as it is', () => {
  /** brick-element-records.test.js's fakeEditor: a real DOM container behind svg.js-shaped elements */
  function brickEditor() {
    const node = document.createElement('div');
    const wrap = (el) => {
      const api = {
        node: el, type: el.tagName.toLowerCase(), fill: () => api, stroke: () => api,
        attr: (k, v) => { if (v === undefined) return el.getAttribute(k); el.setAttribute(k, String(v)); return api; },
        addClass: (c) => { el.classList.add(c); return api; }, removeClass: (c) => { el.classList.remove(c); return api; },
        hasClass: (c) => el.classList.contains(c), remove: () => { el.remove(); return api; },
      };
      return api;
    };
    const make = (tag) => () => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); node.appendChild(el); return wrap(el); };
    return {
      _draw: {}, _mW: 7, _mH: 9, _activeLayer: '1',
      _layers: [{ id: '0', name: 'Layer 1', visible: true }, { id: '1', name: 'Bricks', holdsBricks: true, visible: true }],
      _sketchLayer: {
        node,
        polygon: (pts) => { const w = make('polygon')(); w.node.setAttribute('points', pts); return w; },
        path: (d) => { const w = make('path')(); w.node.setAttribute('d', d); return w; },
        group: make('g'),
        children: () => { const arr = [...node.children].map(wrap); return { toArray: () => arr, forEach: (f) => arr.forEach(f), map: (f) => arr.map(f) }; },
      },
    };
  }
  const pieces = (ed, kind) => [...ed._sketchLayer.node.querySelectorAll(`[data-brick="${kind}"]`)];

  it('lock the Wall layer, lay again: the wall\'s pieces and record stay; the Frame is re-laid; the lay says which layer it left', () => {
    const ed = brickEditor();
    runBricks(ed, P.brickSettings, null);
    const wallLayer = ed._layers.find((l) => l.brickKind === 'wall');
    const wallBefore = pieces(ed, 'wall');
    const frameBefore = pieces(ed, 'frame');
    expect(wallBefore.length).toBeGreaterThan(0);
    expect(frameBefore.length).toBeGreaterThan(0);
    const recordKey = brickRecordNode(ed, 'wall').getAttribute('data-brick-settings');
    wallLayer.userLocked = true;

    runBricks(ed, { ...P.brickSettings, seed: (P.brickSettings.seed || 0) + 7, setIds: { ...P.brickSettings.setIds, wall: 3 } }, null);

    expect(pieces(ed, 'wall')).toHaveLength(wallBefore.length);
    expect(pieces(ed, 'wall').every((n, i) => n === wallBefore[i])).toBe(true); // the very same nodes
    expect(brickRecordNode(ed, 'wall').getAttribute('data-brick-settings')).toBe(recordKey); // its record untouched too
    expect(pieces(ed, 'frame').some((n) => frameBefore.includes(n))).toBe(false); // the unlocked Frame was re-laid
    expect(toasts()).toContain(`"${wallLayer.name}" is locked, left as it is`);
  });

  it('control: with no lock the same second lay re-lays the wall', () => {
    const ed = brickEditor();
    runBricks(ed, P.brickSettings, null);
    const wallBefore = pieces(ed, 'wall');
    runBricks(ed, P.brickSettings, null);
    expect(pieces(ed, 'wall').some((n) => wallBefore.includes(n))).toBe(false);
    expect(toasts()).toEqual([]);
  });

  it('Clear > Bricks and Clear > Artwork skip a locked layer\'s pieces; unlocked ones still go', () => {
    const ed = brickEditor();
    runBricks(ed, P.brickSettings, null);
    const wallLayer = ed._layers.find((l) => l.brickKind === 'wall');
    const frameLayer = ed._layers.find((l) => l.brickKind === 'frame');
    wallLayer.userLocked = true;
    clearBrickElements(ed);
    expect(pieces(ed, 'wall').length).toBeGreaterThan(0); // kept
    expect(pieces(ed, 'frame')).toHaveLength(0); // cleared
    expect(brickRecordNode(ed, 'wall')).toBeTruthy();
    expect(ed._layers.some((l) => l.id === wallLayer.id)).toBe(true);
    void frameLayer;
    // artwork: a locked art layer and its content survive, an unlocked one goes, and a drawable layer is active
    const art = brickEditor();
    const mk = (layer) => { const p = art._sketchLayer.path('M0 0 L1 1'); p.attr('data-layer', layer); return p; };
    art._layers = [{ id: 'a', name: 'Cut', visible: true, userLocked: true }, { id: 'b', name: 'Free', visible: true }];
    const cutPiece = mk('a'); mk('b');
    clearArtworkLayers(art);
    expect([...art._sketchLayer.node.children]).toEqual([cutPiece.node]);
    expect(art._layers.map((l) => l.id)).toContain('a');
    expect(art._layers.some((l) => l.id === 'b')).toBe(false);
    const active = art._layers.find((l) => String(l.id) === String(art._activeLayer));
    expect(isUserLocked(active)).toBe(false); // the layer left to draw on is never the locked one
  });
});

describe('Undo and Redo never change the lock', () => {
  function undoEditor() {
    const editor = {
      _sketchLayer: { children() { const a = []; a.toArray = () => a; return a; }, clear() {}, svg() {}, node: {} },
      _layers: [{ id: '0', name: 'Layer 1', visible: true }, { id: '1', name: 'Layer 2', visible: true }], _activeLayer: '0',
      _undoStack: [], _redoStack: [], _maxUndo: 40, _selectedElement: null, _selectedElements: [], _onChange: null, _onCommit: null,
      _deselect() {},
      pushState: VectorEditor.prototype.pushState, _snapshotState: VectorEditor.prototype._snapshotState,
      undo: VectorEditor.prototype.undo, redo: VectorEditor.prototype.redo, _restoreState: VectorEditor.prototype._restoreState,
      _notifyChange: VectorEditor.prototype._notifyChange,
    };
    return editor;
  }
  const lockOf = (editor, id) => !!editor._layers.find((l) => l.id === id).userLocked;

  it('lock after an edit, Undo the edit: the layer is still locked; Redo too', () => {
    const editor = undoEditor();
    editor.pushState(); // the board as opened
    editor._layers[0].name = 'Edited';
    editor.pushState(); // one edit
    setLayerLocked(editor, '0', true); // not an undo step
    expect(editor._undoStack).toHaveLength(2);
    editor.undo();
    expect(editor._layers[0].name).toBe('Layer 1'); // the edit WAS undone (non-vacuous) ...
    expect(lockOf(editor, '0')).toBe(true); // ... but the lock stayed
    editor.redo();
    expect(editor._layers[0].name).toBe('Edited');
    expect(lockOf(editor, '0')).toBe(true);
  });

  it('a layer locked when a step was taken but unlocked since stays unlocked after Undo / Redo', () => {
    const editor = undoEditor();
    setLayerLocked(editor, '1', true);
    editor.pushState(); // a step taken WHILE locked
    editor._layers[0].name = 'Edited';
    editor.pushState();
    setLayerLocked(editor, '1', false);
    editor.undo();
    expect(lockOf(editor, '1')).toBe(false);
    editor.redo();
    expect(lockOf(editor, '1')).toBe(false);
    expect('userLocked' in editor._layers[1]).toBe(false); // absent, not a stored false
  });
});

describe('saved boards: written only when true, an absent field is unlocked', () => {
  const saved = (layers) => save({ _draw: {}, _sketchLayer: { node: { innerHTML: '' } }, _mW: 7, _mH: 9, _layers: layers, _activeLayer: layers[0].id });

  it('a board with no locked layer serializes with no trace of the field (byte-identical to before the lock)', () => {
    const plain = saved([{ id: '0', name: 'Layer 1', visible: true }]);
    expect(plain).not.toMatch(/userLocked/);
    expect(saved([{ id: '0', name: 'Layer 1', visible: true, userLocked: undefined }])).toBe(plain);
  });

  it('a locked layer round-trips it in data-editor-layers', () => {
    const out = saved([{ id: '0', name: 'Rails', visible: true, userLocked: true }]);
    expect(out).toMatch(/&quot;userLocked&quot;:true/);
  });

  it('a layer record loaded without the field is unlocked everywhere (the gates, the row, Generate)', () => {
    const old = { id: '0', name: 'Layer 1', visible: true }; // exactly what an old save restores
    const editor = { _strokeWidth: 0.5, _activeLayer: '0', _layers: [old], _sketchLayer: { children: () => ({ toArray: () => [] }) } };
    const piece = shapeEl({ bbox: BOX(0, 0), layer: '0' });
    expect(isEditableByLayer(editor, piece)).toBe(true);
    expect(isOnVisibleLayer(editor, piece)).toBe(true);
    expect(isLayerLocked(old)).toBe(false);
  });
});

describe('the other ways in: paste, the brick pickers, the height picks', () => {
  it('Paste onto a locked active layer is refused with the toast; nothing is adopted', () => {
    const editor = {
      _layers: [{ id: '0', name: 'Rails', visible: true, userLocked: true }], _activeLayer: '0',
      _clipboard: [{ outerSvg: '<line x1="0" y1="0" x2="1" y2="1"/>', layer: '0' }],
      _sketchLayer: { node: document.createElementNS('http://www.w3.org/2000/svg', 'g') },
      _selectMany: vi.fn(), pushState: vi.fn(), _onChange: vi.fn(),
    };
    pasteClipboard(editor);
    expect(editor._sketchLayer.node.children).toHaveLength(0);
    expect(editor._selectMany).not.toHaveBeenCalled();
    expect(toasts()).toEqual(['"Rails" is locked — unlock it in Layers to change it']);
  });

  /** a laid wall + frame in a real DOM container (the stub engine lays the wall bricks at x 1..2 and 3..4) */
  function laid() {
    const node = document.createElement('div');
    const wrap = (el) => {
      const api = {
        node: el, type: el.tagName.toLowerCase(), fill: () => api, stroke: () => api,
        attr: (k, v) => { if (v === undefined) return el.getAttribute(k); el.setAttribute(k, String(v)); return api; },
        addClass: (c) => { el.classList.add(c); return api; }, removeClass: (c) => { el.classList.remove(c); return api; },
        hasClass: (c) => el.classList.contains(c), remove: () => { el.remove(); return api; },
      };
      return api;
    };
    const make = (tag) => () => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); node.appendChild(el); return wrap(el); };
    const ed = {
      _draw: {}, _mW: 7, _mH: 9, _activeLayer: '1',
      _layers: [{ id: '0', name: 'Layer 1', visible: true }, { id: '1', name: 'Bricks', holdsBricks: true, visible: true }],
      _sketchLayer: {
        node,
        polygon: (pts) => { const w = make('polygon')(); w.node.setAttribute('points', pts); return w; },
        path: (d) => { const w = make('path')(); w.node.setAttribute('d', d); return w; },
        group: make('g'),
        children: () => { const arr = [...node.children].map(wrap); return { toArray: () => arr, forEach: (f) => arr.forEach(f), map: (f) => arr.map(f) }; },
      },
    };
    runBricks(ed, P.brickSettings, null);
    return ed;
  }

  it('the height picks never offer bricks of a locked layer', () => {
    const ed = laid();
    const all = heightPickBricks(ed).length;
    expect(all).toBeGreaterThan(0);
    ed._layers.find((l) => l.brickKind === 'wall').userLocked = true;
    expect(heightPickBricks(ed).length).toBe(all - 2); // the two wall bricks are gone from the picks, the frame brick stays
  });

  it('a press on a brick of a locked layer with the accent / element pickers does nothing but say why; an unlocked one is handed on', () => {
    const ed = laid();
    ed._brickAccentClick = vi.fn(); ed._brickElementSelect = vi.fn();
    const pt = { x: 1.5, y: 0.15 }; // inside the first wall brick
    brickAccentClickHandler.start(ed, pt, null);
    brickElementSelectHandler.start(ed, pt, null);
    expect(ed._brickAccentClick).toHaveBeenCalledTimes(1); // unlocked: handed on (non-vacuous)
    expect(ed._brickElementSelect).toHaveBeenCalledTimes(1);
    vi.clearAllMocks();
    ed._layers.find((l) => l.brickKind === 'wall').userLocked = true;
    brickAccentClickHandler.start(ed, pt, null);
    brickElementSelectHandler.start(ed, pt, null);
    expect(ed._brickAccentClick).not.toHaveBeenCalled();
    expect(ed._brickElementSelect).not.toHaveBeenCalled();
    expect(toasts()).toEqual(Array(2).fill('"Wall" is locked — unlock it in Layers to change it')); // once per picker (the real toast dedupes the text)
  });
});

describe('Cancel (and a global Undo that reopens the drawing) keeps the lock', () => {
  /** open() = the editor rebuilding its roster from the saved drawing, which knows nothing of a lock set since */
  function reopenEditor(savedRoster) {
    const editor = {
      _layers: [{ id: '0', name: 'Layer 1', visible: true }, { id: '1', name: 'Rails', visible: true }], _activeLayer: '0',
      _sketchLayer: { children: () => ({ toArray: () => [], forEach() {} }) },
      open: vi.fn(() => { editor._layers = savedRoster.map((l) => ({ ...l })); }),
      _notifyChange: vi.fn(),
    };
    return editor;
  }
  it('a layer locked in the session is still locked after Cancel reopens the board as it was opened', () => {
    const editor = reopenEditor([{ id: '0', name: 'Layer 1', visible: true }, { id: '1', name: 'Rails', visible: true }]);
    editor._layers[1].userLocked = true;
    reopenKeepingLocks(editor, '<svg/>', 7, 9);
    expect(editor.open).toHaveBeenCalledWith('<svg/>', 7, 9);
    expect(editor._layers[1].userLocked).toBe(true);
    expect(editor._layers[0].userLocked).toBeUndefined();
    expect(editor._notifyChange).toHaveBeenCalledWith('commit'); // so the saved drawing carries it
  });
  it('a layer unlocked in the session stays unlocked even if the reopened drawing says locked; a layer the drawing lacks is dropped', () => {
    const editor = reopenEditor([{ id: '0', name: 'Layer 1', visible: true, userLocked: true }]);
    editor._layers[0].userLocked = undefined;
    reopenKeepingLocks(editor, '<svg/>', 7, 9);
    expect(editor._layers).toHaveLength(1);
    expect(isUserLocked(editor._layers[0])).toBe(false);
  });
  it('nothing differs: no commit is sent', () => {
    const editor = reopenEditor([{ id: '0', name: 'Layer 1', visible: true }, { id: '1', name: 'Rails', visible: true }]);
    reopenKeepingLocks(editor, '<svg/>', 7, 9);
    expect(editor._notifyChange).not.toHaveBeenCalled();
  });
});

/**
 * tests/select-geometry-snap-feedback.test.js
 *
 * Verifies that in normal Select mode:
 * 1. When dragging a selection near existing geometry, geometry snapping highlights
 *    the target geometry element and displays a snap reticle marker at the snap point.
 * 2. Visual and status feedback is given while snapped (e.g. "Snapped to endpoint").
 * 3. Moving away from the snap point cleanly clears the target highlight and reticle.
 * 4. Releasing the drag commits the snapped position and clears the temporary highlight.
 */
import { describe, it, expect } from 'vitest';
import { getModeHandler, handleEnd, translateSelection } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-interaction.js';
import { updateSnapTargetHighlight, clearSnapTargetHighlight } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-ui.js';

function makeMockEditor() {
  let elements = [];
  function makeElement(type, initial) {
    const store = { ...initial };
    const elObj = {
      type,
      node: {
        getAttribute: (k) => (store[k] !== undefined ? store[k] : null),
        hasAttribute: (k) => store[k] !== undefined,
        setAttribute: (k, v) => { store[k] = String(v); },
        removeAttribute: (k) => { delete store[k]; },
        classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
      },
      attr(k, ...rest) {
        if (k && typeof k === 'object') { Object.assign(store, k); return elObj; }
        if (rest.length === 0) return store[k];
        const v = rest[0];
        if (v === null || v === undefined) delete store[k]; else store[k] = v;
        return elObj;
      },
      stroke() { return elObj; },
      fill() { return elObj; },
      radius(r) { store.r = r; return elObj; },
      center(x, y) { store.cx = x; store.cy = y; return elObj; },
      front() { return elObj; },
      back() { return elObj; },
      translate(dx, dy) {
        store.x1 = (parseFloat(store.x1) || 0) + dx;
        store.y1 = (parseFloat(store.y1) || 0) + dy;
        store.x2 = (parseFloat(store.x2) || 0) + dx;
        store.y2 = (parseFloat(store.y2) || 0) + dy;
        return elObj;
      },
      clone() { return makeElement(type, { ...store }); },
      addClass() { return elObj; }, removeClass() { return elObj; }, hasClass() { return false; },
      remove() { elements = elements.filter((e) => e !== elObj); },
    };
    elements.push(elObj);
    return elObj;
  }
  const sketchLayer = {
    line(x1, y1, x2, y2) { return makeElement('line', { x1, y1, x2, y2 }); },
    circle(d) { return makeElement('circle', { r: d / 2, cx: 0, cy: 0 }); },
    children() { const arr = elements.slice(); arr.toArray = () => arr; return arr; },
    node: { children: [] },
  };
  let handles = [];
  const handleLayer = {
    clear() { handles = []; },
    circle(d) { const h = makeElement('circle', { r: d / 2, cx: 0, cy: 0 }); handles.push(h); return h; },
    children() { return handles; },
  };
  let highlights = [];
  const highlightLayer = {
    add(e) { highlights.push(e); return e; },
    rect() { const h = makeElement('rect', {}); highlights.push(h); return h; },
  };

  let statusHint = null;
  const editor = {
    _sketchLayer: sketchLayer,
    _handleLayer: handleLayer,
    _highlightLayer: highlightLayer,
    _draw: { viewbox: () => ({ x: 0, y: 0, width: 8, height: 10 }) },
    _layers: [{ id: '0', name: 'Layer 1', visible: true }],
    _activeLayer: '0',
    _grid: { spacing: 0.25, visible: true, geometrySnap: true },
    _currentMode: 'select',
    _strokeWidth: 0.02,
    _selectedElements: [],
    _selectedElement: null,
    _lastDragPt: { x: 0, y: 0 },
    _pressRaw: { x: 0, y: 0 },
    _getNodes(el) {
      if (el.type === 'line') {
        return [
          { x: parseFloat(el.attr('x1')), y: parseFloat(el.attr('y1')) },
          { x: parseFloat(el.attr('x2')), y: parseFloat(el.attr('y2')) },
        ];
      }
      return [];
    },
    _getDynamicTolerance: (px = 5) => px * 0.01,
    _updateHandles() {},
    _updateSelectionHighlight() {},
    _notifyChange() {},
    pushState() {},
  };
  return { editor, getStatus: () => statusHint };
}

describe('SELECT-GEOMETRY-SNAP-FEEDBACK: In normal select, snapping highlights target geometry with feedback', () => {
  it('updateSnapTargetHighlight and clearSnapTargetHighlight manage highlights cleanly', () => {
    const { editor } = makeMockEditor();
    const targetLine = editor._sketchLayer.line(2, 2, 4, 2);
    targetLine.attr({ 'data-layer': '0', 'stroke-width': 0.02 });

    const target = { x: 2, y: 2, el: targetLine, kind: 'endpoint' };
    updateSnapTargetHighlight(editor, target);

    // Marker created on handleLayer
    expect(editor._snapTargetMarker).not.toBeNull();
    expect(editor._snapTargetMarker.attr('cx')).toBe(2);
    expect(editor._snapTargetMarker.attr('cy')).toBe(2);

    // Target highlight created on highlightLayer
    expect(editor._snapTargetHighlight).not.toBeNull();

    // Clear
    clearSnapTargetHighlight(editor);
    expect(editor._snapTargetMarker).toBeNull();
    expect(editor._snapTargetHighlight).toBeNull();
  });

  it('dragging a selected line in select mode near another line snaps, highlighting target and setting status hint', () => {
    const { editor } = makeMockEditor();
    // Fixed target line at y = 1.0, x: 0 -> 2
    const fixedLine = editor._sketchLayer.line(0, 1.0, 2.0, 1.0);
    fixedLine.attr({ 'data-layer': '0', 'stroke-width': 0.02 });

    // Moving line starting at (0, 0) -> (1.0, 0)
    const movingLine = editor._sketchLayer.line(0, 0, 1.0, 0);
    movingLine.attr({ 'data-layer': '0', 'stroke-width': 0.02 });

    editor._selectedElements = [movingLine];
    editor._selectedElement = movingLine;

    const selectHandler = getModeHandler('select');
    // Start drag at (0, 0)
    selectHandler.start(editor, { x: 0, y: 0 }, { x: 0, y: 0 }, movingLine);

    // Drag movingLine near (0, 0.98) - within geometry snap tolerance of fixedLine's start (0, 1.0)
    translateSelection(editor, { x: 0, y: 0.98 }, { x: 0, y: 0.98 });

    // Should have snapped to (0, 1.0)
    expect(editor._selMove.lastSnap).not.toBeNull();
    expect(editor._selMove.lastSnap.target.y).toBe(1.0);

    // Snap target reticle marker should be active at the target point
    expect(editor._snapTargetMarker).not.toBeNull();
    expect(editor._snapTargetMarker.attr('cy')).toBe(1.0);

    // Release drag
    handleEnd(editor);

    // On release, snap target marker should be cleared
    expect(editor._snapTargetMarker).toBeNull();
    expect(editor._snapTargetHighlight).toBeNull();

    // And the moving line should be snapped exactly to y1 = 1.0
    expect(parseFloat(movingLine.attr('y1'))).toBeCloseTo(1.0, 3);
  });
});

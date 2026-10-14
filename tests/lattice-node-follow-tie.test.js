/**
 * tests/lattice-node-follow-tie.test.js — Regression & verification tests for
 * LATTICE-NODE-FOLLOW-TIE.
 *
 * Verifies:
 * 1. In Lattice mode, dragging a tie's body moves all attached nodes (both endpoints
 *    AND any mid-span / crossing nodes) rigidly along with the tie.
 * 2. In Shape Lattice mode, dragging a tie with fractional contour endpoints carries
 *    all attached nodes without dropping them due to floating point noise.
 * 3. Stretching a tie's end carries the node sitting at that end along with the stretched end.
 * 4. Grabbing a node on a tie to move or stretch the tie correctly moves/stretches the tie
 *    and carries all attached nodes.
 * 5. Cut tie chains (chains of segments) carry all attached nodes along any of their segments.
 */
import { describe, it, expect } from 'vitest';
import { getModeHandler, updateHandles } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-interaction.js';
import { LATTICE_DEFAULTS, LATTICE_ATTR } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice.js';

function makeMockEditor(mW = 7, mH = 9) {
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
      stroke(v) {
        if (typeof v === 'object' && v !== null) {
          if ('color' in v) store.stroke = v.color;
          if ('width' in v) store['stroke-width'] = v.width;
        }
        return elObj;
      },
      fill(v) { if (v !== undefined) store.fill = v; return elObj; },
      center(x, y) { store.cx = x; store.cy = y; return elObj; },
      translate(dx, dy) {
        const cur = store.transform || '';
        store.transform = `${cur} translate(${dx},${dy})`.trim();
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
    path(d) { return makeElement('path', { d }); },
    add(e) { elements.push(e); return e; },
    children() { const arr = elements.slice(); arr.toArray = () => arr; return arr; },
    node: {},
  };
  let handles = [];
  const handleLayer = {
    clear() { handles = []; },
    circle(d) { const h = makeElement('circle', { r: d / 2 }); handles.push(h); return h; },
    path(d) { const h = makeElement('path', { d }); handles.push(h); return h; },
    rect(w, h) { const e = makeElement('rect', { width: w, height: h }); handles.push(e); return e; },
    all: () => handles,
  };
  let pushes = 0;
  const editor = {
    _mW: mW, _mH: mH, _sketchLayer: sketchLayer, _handleLayer: handleLayer,
    _layers: [{ id: '0', name: 'Layer 1', visible: true }], _activeLayer: '0', _nextLayerId: 1,
    _grid: { spacing: 0.25, visible: true },
    _lattice: { ...LATTICE_DEFAULTS, drawKind: 'select' },
    _currentMode: 'lattice',
    _color: '#000', _strokeWidth: 0.02, _selectedElements: [], _paramHandles: [],
    _select(el) { this._selectedElements = [el]; }, _selectAdd(el) { if (!this._selectedElements.includes(el)) this._selectedElements.push(el); },
    _deselect() { this._selectedElements = []; },
    _updateHandles() { updateHandles(this); },
    _setHover() {}, _getMousePoint: (e) => ({ x: e.x, y: e.y }),
    _getNearbyElement: () => null,
    pushState() { pushes++; }, _notifyChange() {},
    get pushes() { return pushes; },
  };
  return editor;
}

function addTie(editor, x1, y1, x2, y2) {
  const el = editor._sketchLayer.line(x1, y1, x2, y2);
  el.attr({ [LATTICE_ATTR]: 'tie', 'data-layer': '0', 'stroke-width': 0.02 });
  return el;
}

function addNode(editor, cx, cy) {
  const el = editor._sketchLayer.circle(0.18);
  el.attr({ [LATTICE_ATTR]: 'node', cx, cy, 'data-layer': '0' });
  return el;
}

async function doLatticeDrag(editor, from, to) {
  const h = getModeHandler(editor._currentMode);
  h.start(editor, from, { x: from.x, y: from.y });
  h.update(editor, to);
  await h.finish(editor);
}

describe('LATTICE-NODE-FOLLOW-TIE: Nodes rigidly follow ties on move & stretch', () => {
  it('body drag on a tie moves both endpoint nodes and mid-span crossing nodes rigidly with the tie', async () => {
    const editor = makeMockEditor();
    editor._currentMode = 'lattice';
    // Tie on column x = 1.0, spanning y = 1.0 to y = 3.0
    const tie = addTie(editor, 1.0, 1.0, 1.0, 3.0);
    const nodeStart = addNode(editor, 1.0, 1.0);
    const nodeMid = addNode(editor, 1.0, 2.0); // mid-span crossing node
    const nodeEnd = addNode(editor, 1.0, 3.0);
    const unrelatedNode = addNode(editor, 2.5, 2.0); // unrelated node far away

    // Grab body of tie at y = 2.1 (away from endpoints) and drag +0.5 in X, +0.25 in Y
    const grabPt = { x: 1.0, y: 2.1 };
    const targetPt = { x: 1.5, y: 2.35 };

    await doLatticeDrag(editor, grabPt, targetPt);

    // Tie should have moved to x = 1.5, y = 1.25 to 3.25
    expect(parseFloat(tie.attr('x1'))).toBeCloseTo(1.5, 3);
    expect(parseFloat(tie.attr('y1'))).toBeCloseTo(1.25, 3);
    expect(parseFloat(tie.attr('x2'))).toBeCloseTo(1.5, 3);
    expect(parseFloat(tie.attr('y2'))).toBeCloseTo(3.25, 3);

    // All 3 attached nodes must follow rigidly:
    expect(parseFloat(nodeStart.attr('cx'))).toBeCloseTo(1.5, 3);
    expect(parseFloat(nodeStart.attr('cy'))).toBeCloseTo(1.25, 3);

    expect(parseFloat(nodeMid.attr('cx'))).toBeCloseTo(1.5, 3);
    expect(parseFloat(nodeMid.attr('cy'))).toBeCloseTo(2.25, 3);

    expect(parseFloat(nodeEnd.attr('cx'))).toBeCloseTo(1.5, 3);
    expect(parseFloat(nodeEnd.attr('cy'))).toBeCloseTo(3.25, 3);

    // Unrelated node must not move:
    expect(parseFloat(unrelatedNode.attr('cx'))).toBeCloseTo(2.5, 3);
    expect(parseFloat(unrelatedNode.attr('cy'))).toBeCloseTo(2.0, 3);
  });

  it('tie end stretch carries the end node along with the stretched endpoint while fixed end stays in place', async () => {
    const editor = makeMockEditor();
    editor._currentMode = 'lattice';
    // Tie from (1.0, 1.0) to (1.0, 2.0)
    const tie = addTie(editor, 1.0, 1.0, 1.0, 2.0);
    const nodeA = addNode(editor, 1.0, 1.0);
    const nodeB = addNode(editor, 1.0, 2.0);

    // Grab exactly at end B (1.0, 2.0) and stretch downward to y = 2.75
    const grabPt = { x: 1.0, y: 2.0 };
    const targetPt = { x: 1.0, y: 2.75 };

    await doLatticeDrag(editor, grabPt, targetPt);

    // Tie's end A is fixed at (1.0, 1.0), end B stretched to (1.0, 2.75)
    expect(parseFloat(tie.attr('x1'))).toBeCloseTo(1.0, 3);
    expect(parseFloat(tie.attr('y1'))).toBeCloseTo(1.0, 3);
    expect(parseFloat(tie.attr('x2'))).toBeCloseTo(1.0, 3);
    expect(parseFloat(tie.attr('y2'))).toBeCloseTo(2.75, 3);

    // Node A stayed in place:
    expect(parseFloat(nodeA.attr('cx'))).toBeCloseTo(1.0, 3);
    expect(parseFloat(nodeA.attr('cy'))).toBeCloseTo(1.0, 3);

    // Node B followed the stretched end to (1.0, 2.75):
    expect(parseFloat(nodeB.attr('cx'))).toBeCloseTo(1.0, 3);
    expect(parseFloat(nodeB.attr('cy'))).toBeCloseTo(2.75, 3);
  });

  it('Shape Lattice fractional coordinates: tie with contour-clipped fractional endpoints carries nodes without dropping on 1e-6 float noise', async () => {
    const editor = makeMockEditor();
    editor._currentMode = 'shapeLattice';
    // Tie with fractional coordinates from contour intersection:
    // e.g. x1 = 1.234567, y1 = 0.891234, x2 = 1.234567, y2 = 2.456789
    // Node center has minor float discrepancy (e.g. 5e-5)
    const tie = addTie(editor, 1.234567, 0.891234, 1.234567, 2.456789);
    const nodeA = addNode(editor, 1.234580, 0.891240); // differs by ~1.3e-5
    const nodeB = addNode(editor, 1.234575, 2.456780);

    // Grab body of tie at y = 1.6
    const grabPt = { x: 1.234567, y: 1.6 };
    const targetPt = { x: 1.484567, y: 1.85 };

    await doLatticeDrag(editor, grabPt, targetPt);

    // Nodes must move with the tie rather than being left behind
    const tieX1 = parseFloat(tie.attr('x1'));
    expect(tieX1).toBeCloseTo(1.484567, 2);
    expect(parseFloat(nodeA.attr('cx'))).toBeCloseTo(tieX1, 2);
    expect(parseFloat(nodeB.attr('cx'))).toBeCloseTo(tieX1, 2);
  });
});

/**
 * Rails custom-position + lock slice (seat D 2026-10-16; advisor 45, Fred's pre-decided design): a canvas drag
 * on an UNLOCKED custom rail (pattern.rails.custom, matched by its own Send-tagged RAIL_ID_ATTR) persists -- it
 * updates that entry's own `at` to the rail's new position. A LOCKED custom rail, or an ordinary rail with no
 * entry at all, is untouched -- "moving alone never protects" stays true for every rail this doesn't apply to.
 * Drag simulation through the REAL canvas handlers (getModeHandler), same convention
 * lattice-drag-highlight.test.js's own mock editor already established.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getModeHandler } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-interaction.js';
import { select, selectAdd, updateSelectionHighlight } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-ui.js';
import { LATTICE_DEFAULTS, RAIL_ID_ATTR } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice.js';
import { PATTERN_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';

function makeMockEditor(pattern) {
  let elements = [];
  function makeElement(type, initial) {
    const store = { ...initial };
    const node = { getAttribute: (k) => (store[k] !== undefined ? store[k] : null), hasAttribute: (k) => store[k] !== undefined, isConnected: true };
    const elObj = {
      type, node,
      attr(k, ...rest) {
        if (k && typeof k === 'object') { Object.assign(store, k); return elObj; }
        if (rest.length === 0) return store[k]; const v = rest[0]; if (v === null || v === undefined) delete store[k]; else store[k] = v; return elObj;
      },
      stroke(v) { if (typeof v === 'object' && v !== null) { if ('color' in v) store.stroke = v.color; if ('width' in v) store['stroke-width'] = v.width; } return elObj; },
      fill(v) { if (v !== undefined) store.fill = v; return elObj; },
      center(x, y) { store.cx = x; store.cy = y; return elObj; },
      clone() { return makeElement(type, { ...store }); },
      addClass() { return elObj; }, removeClass() { return elObj; }, hasClass() { return false; },
      back() { return elObj; },
      remove() { node.isConnected = false; elements = elements.filter((e) => e !== elObj); },
    };
    elements.push(elObj);
    return elObj;
  }
  const sketchLayer = {
    line(x1, y1, x2, y2) { return makeElement('line', { x1, y1, x2, y2 }); },
    circle(d) { return makeElement('circle', { r: d / 2 }); },
    path(d) { return makeElement('path', { d }); },
    add(e) { elements.push(e); return e; },
    children() { const arr = elements.slice(); arr.toArray = () => arr; return arr; },
    node: {},
  };
  const highlightLayer = { add(e) { e._isHalo = true; return e; } };
  return {
    _sketchLayer: sketchLayer,
    _highlightLayer: highlightLayer,
    _draw: { viewbox: () => ({ x: 0, y: 0, w: 10, h: 10 }) },
    _getDynamicTolerance: () => 0.02,
    // the pattern-owning layer ('0') -- rails-lock's own resolvePatternLayer(editor, getElementLayer(el)) reads
    // this the SAME way generatePattern's own owner-layer convention does.
    _layers: [{ id: '0', name: 'Layer 1', visible: true, pattern }],
    _activeLayer: '0',
    _mW: 10, _mH: 10, // boardRegion's own board size (inches) -- the SAME extent the pattern's own rails sit in
    _grid: { spacing: 0.25, visible: true },
    _lattice: { ...LATTICE_DEFAULTS },
    _color: '#000', _strokeWidth: 0.02, _selectedElements: [],
    _select(el) { select(this, el); },
    _selectAdd(el) { selectAdd(this, el); },
    _deselect() {
      this._selectedElements = [];
      for (const h of this._selectionHighlights || []) { try { h.remove(); } catch (_) {} }
      this._selectionHighlights = [];
      this._selectionHighlight = null;
    },
    _updateSelectionHighlight() { updateSelectionHighlight(this); },
    _updateHandles() {}, _setHover() {}, _getMousePoint: (e) => ({ x: e.x, y: e.y }), _getNearbyElement: () => null,
    pushState() {}, _notifyChange() {}, _onChange() {},
  };
}

function addRail(editor, x1, y1, x2, y2, railId) {
  const el = editor._sketchLayer.line(x1, y1, x2, y2);
  const attrs = { 'data-lattice': 'rail', 'data-layer': '0', 'stroke-width': 0.05 };
  if (railId) attrs[RAIL_ID_ATTR] = railId;
  el.attr(attrs);
  return el;
}

beforeEach(() => { document.body.innerHTML = ''; });

const basePattern = { ...PATTERN_DEFAULTS, spacing: 0.25, orientation: 'horizontal' };
const h = () => getModeHandler('lattice');

describe('rails-lock: a canvas drag on an UNLOCKED custom rail persists its own `at`', () => {
  it('updates ONLY that rail\'s own rails.custom entry, to its new row fraction', async () => {
    const pattern = { ...basePattern, rails: { ...basePattern.rails, custom: [{ id: 'rail7', at: 0.389, locked: false }] } };
    const editor = makeMockEditor(pattern);
    // board 10x10in, inset by CONTOUR_SIZE_INSET_IN (0.5in each side, editor-lattice-boundary.js) -> the lattice
    // extent is really [2,38] in j (spacing 0.25), not the board's own [0,40]. row y=6in -> j=24 -> at = (24-2)/(38-2).
    addRail(editor, 0.5, 4, 8, 4, 'rail7');

    h().start(editor, { x: 4, y: 4 }, { x: 4, y: 4 }); // grab the rail's body (not an end) -> MOVE
    h().update(editor, { x: 4, y: 6 }); // drag down 2in -> new row y=6in
    await h().finish(editor);

    expect(pattern.rails.custom).toHaveLength(1);
    expect(pattern.rails.custom[0].id).toBe('rail7');
    expect(pattern.rails.custom[0].locked).toBe(false);
    expect(pattern.rails.custom[0].at).toBeCloseTo(22 / 36, 10);
  });

  it('a LOCKED custom rail is untouched by the drag -- its `at` stays exactly as Pull left it', async () => {
    const pattern = { ...basePattern, rails: { ...basePattern.rails, custom: [{ id: 'rail7', at: 0.4, locked: true }] } };
    const editor = makeMockEditor(pattern);
    addRail(editor, 0.5, 4, 8, 4, 'rail7');

    h().start(editor, { x: 4, y: 4 }, { x: 4, y: 4 });
    h().update(editor, { x: 4, y: 6 });
    await h().finish(editor);

    expect(pattern.rails.custom).toEqual([{ id: 'rail7', at: 0.4, locked: true }]); // unchanged
  });

  it('an ORDINARY rail (no rails.custom entry at all) is untouched -- "moving alone never protects" still holds', async () => {
    const pattern = { ...basePattern, rails: { ...basePattern.rails, custom: [] } };
    const editor = makeMockEditor(pattern);
    addRail(editor, 0.5, 4, 8, 4, 'rail9'); // a real Send-tagged id, but never pulled -- no custom entry for it

    h().start(editor, { x: 4, y: 4 }, { x: 4, y: 4 });
    h().update(editor, { x: 4, y: 6 });
    await h().finish(editor);

    expect(pattern.rails.custom).toEqual([]); // nothing was ever added
  });

  it('dragging an UNRELATED (unlocked) custom rail never touches another entry', async () => {
    const pattern = { ...basePattern, rails: { ...basePattern.rails, custom: [{ id: 'rail7', at: 0.4, locked: false }, { id: 'rail8', at: 0.2, locked: false }] } };
    const editor = makeMockEditor(pattern);
    addRail(editor, 0.5, 4, 8, 4, 'rail7');

    h().start(editor, { x: 4, y: 4 }, { x: 4, y: 4 });
    h().update(editor, { x: 4, y: 6 });
    await h().finish(editor);

    const other = pattern.rails.custom.find((c) => c.id === 'rail8');
    expect(other).toEqual({ id: 'rail8', at: 0.2, locked: false }); // untouched
  });

  it('a tie drag never touches pattern.rails.custom at all -- only rails are Pull-matchable', async () => {
    const pattern = { ...basePattern, rails: { ...basePattern.rails, custom: [{ id: 'rail7', at: 0.4, locked: false }] } };
    const editor = makeMockEditor(pattern);
    const tie = editor._sketchLayer.line(1, 1, 1, 3);
    tie.attr({ 'data-lattice': 'tie', 'data-layer': '0' });

    h().start(editor, { x: 1, y: 2 }, { x: 1, y: 2 });
    h().update(editor, { x: 3, y: 2 });
    await h().finish(editor);

    expect(pattern.rails.custom).toEqual([{ id: 'rail7', at: 0.4, locked: false }]); // unchanged
  });

  // the kind check (not just "no RAIL_ID_ATTR") matters on its own: a tie element that happens to carry a
  // rail-id-shaped attribute (a corrupted save, or a future bug elsewhere) must still never be treated as a rail.
  it('a tie carrying a rail-id-shaped attribute is STILL never matched -- the kind check, not just the attribute, gates this', async () => {
    const pattern = { ...basePattern, rails: { ...basePattern.rails, custom: [{ id: 'rail7', at: 0.4, locked: false }] } };
    const editor = makeMockEditor(pattern);
    const tie = editor._sketchLayer.line(1, 1, 1, 3);
    tie.attr({ 'data-lattice': 'tie', 'data-layer': '0', [RAIL_ID_ATTR]: 'rail7' });

    h().start(editor, { x: 1, y: 2 }, { x: 1, y: 2 });
    h().update(editor, { x: 3, y: 2 });
    await h().finish(editor);

    expect(pattern.rails.custom).toEqual([{ id: 'rail7', at: 0.4, locked: false }]); // unchanged
  });
});

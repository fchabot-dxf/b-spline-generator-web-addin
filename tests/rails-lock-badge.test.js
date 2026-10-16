/**
 * Rails custom-position + lock slice (seat D 2026-10-16; advisor 45, Fred-approved mockup, shots/seatD/
 * rails_lock_mockup/rails_lock_mockup.png): a small lock badge, one per pattern.rails.custom entry, drawn into
 * editor._handleLayer (updateHandles) at the rail's own row, inset from the board's near edge. Tapping it (the
 * lattice tool's own pointerdown, a hit-test that runs BEFORE the regular piece hit-test) toggles that rail's
 * `locked` -- it never falls through to drawing/moving a piece on the same tap.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getModeHandler, updateHandles } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-interaction.js';
import { select, selectAdd, updateSelectionHighlight } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-ui.js';
import { LATTICE_DEFAULTS, RAIL_ID_ATTR } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice.js';
import { PATTERN_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';

function makeLayer() {
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
      font(v) { if (v !== undefined) Object.assign(store, { fontSize: v.size, fontAnchor: v.anchor }); return elObj; },
      center(x, y) { store.cx = x; store.cy = y; return elObj; },
      clone() { return makeElement(type, { ...store }); },
      addClass() { return elObj; }, removeClass() { return elObj; }, hasClass() { return false; },
      back() { return elObj; },
      remove() { node.isConnected = false; elements = elements.filter((e) => e !== elObj); },
    };
    elements.push(elObj);
    return elObj;
  }
  return {
    line(x1, y1, x2, y2) { return makeElement('line', { x1, y1, x2, y2 }); },
    circle(d) { return makeElement('circle', { r: d / 2 }); },
    text(t) { return makeElement('text', { text: t }); },
    path(d) { return makeElement('path', { d }); },
    add(e) { elements.push(e); return e; },
    children() { const arr = elements.slice(); arr.toArray = () => arr; return arr; },
    clear() { for (const e of elements.slice()) e.remove(); },
    node: {},
  };
}

function makeMockEditor(pattern) {
  const sketchLayer = makeLayer();
  const handleLayer = makeLayer();
  const highlightLayer = { add(e) { e._isHalo = true; return e; } };
  return {
    _sketchLayer: sketchLayer,
    _handleLayer: handleLayer,
    _highlightLayer: highlightLayer,
    _draw: { viewbox: () => ({ x: 0, y: 0, w: 10, h: 10 }) },
    _getDynamicTolerance: () => 0.02,
    _layers: [{ id: '0', name: 'Layer 1', visible: true, pattern }],
    _activeLayer: '0',
    _currentMode: 'lattice',
    _mW: 10, _mH: 10,
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

const badgesOf = (editor) => editor._handleLayer.children().toArray().filter((e) => e.attr('data-rail-lock-badge'));
const h = () => getModeHandler('lattice');
const basePattern = { ...PATTERN_DEFAULTS, spacing: 0.25, orientation: 'horizontal' };

beforeEach(() => { document.body.innerHTML = ''; });

describe('rails-lock: the badge renders once per pattern.rails.custom entry', () => {
  it('one badge per entry, positioned at that rail\'s own row, inset from the left edge', () => {
    const pattern = { ...basePattern, rails: { ...basePattern.rails, custom: [{ id: 'rail7', at: 0.4, locked: true }] } };
    const editor = makeMockEditor(pattern);
    addRail(editor, 0.5, 4, 8, 4, 'rail7');

    updateHandles(editor);

    const badges = badgesOf(editor);
    // 2 elements per badge (the circle background + the text glyph), both tagged with the SAME rail id
    expect(badges.filter((b) => b.attr('data-rail-lock-badge') === 'rail7').length).toBe(2);
    const circle = badges.find((b) => b.type === 'circle');
    expect(circle.attr('cy')).toBeCloseTo(4, 6); // the rail's own row
    expect(circle.attr('cx')).toBeGreaterThan(0); // inset, inside the board -- never negative/off-canvas
    expect(circle.attr('cx')).toBeLessThan(0.5); // well inside the rail's own left end (x1=0.5)
  });

  it('no custom rails at all: no badges, no crash', () => {
    const pattern = { ...basePattern, rails: { ...basePattern.rails, custom: [] } };
    const editor = makeMockEditor(pattern);
    addRail(editor, 0.5, 4, 8, 4, 'rail1');
    expect(() => updateHandles(editor)).not.toThrow();
    expect(badgesOf(editor)).toEqual([]);
  });

  it('a stale custom entry (its rail was removed, e.g. Clear) draws no orphaned badge', () => {
    const pattern = { ...basePattern, rails: { ...basePattern.rails, custom: [{ id: 'rail-gone', at: 0.4, locked: true }] } };
    const editor = makeMockEditor(pattern);
    updateHandles(editor);
    expect(badgesOf(editor)).toEqual([]);
  });

  it('re-rendering clears the PRIOR badges first -- never doubles up', () => {
    const pattern = { ...basePattern, rails: { ...basePattern.rails, custom: [{ id: 'rail7', at: 0.4, locked: true }] } };
    const editor = makeMockEditor(pattern);
    addRail(editor, 0.5, 4, 8, 4, 'rail7');
    updateHandles(editor);
    updateHandles(editor);
    updateHandles(editor);
    expect(badgesOf(editor).filter((b) => b.attr('data-rail-lock-badge') === 'rail7').length).toBe(2);
  });
});

describe('rails-lock: tapping the badge toggles lock, and nothing else', () => {
  it('a tap exactly on the badge flips locked -- and stops there (no piece grabbed, no draw)', () => {
    const pattern = { ...basePattern, rails: { ...basePattern.rails, custom: [{ id: 'rail7', at: 0.4, locked: true }] } };
    const editor = makeMockEditor(pattern);
    const rail = addRail(editor, 0.5, 4, 8, 4, 'rail7');
    updateHandles(editor);
    const badge = badgesOf(editor).find((b) => b.type === 'circle');
    const badgeX = badge.attr('cx'), badgeY = badge.attr('cy');

    h().start(editor, { x: badgeX, y: badgeY }, { x: badgeX, y: badgeY });

    expect(pattern.rails.custom[0].locked).toBe(false); // flipped
    expect(editor._latticeMove).toBeFalsy(); // never started a drag/draw on this same tap
    expect(editor._selectedElements).not.toContain(rail); // the rail itself was never touched
    // the badge sits on empty canvas space (no piece there) -- without the early return, falling through would
    // hit the "nothing here, start drawing a NEW rail" branch, which sets this flag. It must never fire.
    expect(editor._isDrawing).toBeFalsy();
  });

  it('tapping an unlocked badge locks it back', () => {
    const pattern = { ...basePattern, rails: { ...basePattern.rails, custom: [{ id: 'rail7', at: 0.4, locked: false }] } };
    const editor = makeMockEditor(pattern);
    addRail(editor, 0.5, 4, 8, 4, 'rail7');
    updateHandles(editor);
    const badge = badgesOf(editor).find((b) => b.type === 'circle');

    h().start(editor, { x: badge.attr('cx'), y: badge.attr('cy') }, { x: badge.attr('cx'), y: badge.attr('cy') });

    expect(pattern.rails.custom[0].locked).toBe(true);
  });

  it('a tap NEAR but outside the badge radius falls through to the normal piece hit-test instead', () => {
    const pattern = { ...basePattern, rails: { ...basePattern.rails, custom: [{ id: 'rail7', at: 0.4, locked: true }] } };
    const editor = makeMockEditor(pattern);
    addRail(editor, 0.5, 4, 8, 4, 'rail7');
    updateHandles(editor);

    // grab the rail's own body, well clear of the badge near x=0.3
    h().start(editor, { x: 4, y: 4 }, { x: 4, y: 4 });

    expect(pattern.rails.custom[0].locked).toBe(true); // the badge was never hit -- unchanged
    expect(editor._selectedElements.length).toBeGreaterThan(0); // the normal hit-test DID run
  });

  it('the toggle re-renders the badge immediately -- its own fill flips locked vs unlocked', () => {
    const pattern = { ...basePattern, rails: { ...basePattern.rails, custom: [{ id: 'rail7', at: 0.4, locked: true }] } };
    const editor = makeMockEditor(pattern);
    addRail(editor, 0.5, 4, 8, 4, 'rail7');
    updateHandles(editor);
    const before = badgesOf(editor).find((b) => b.type === 'circle').attr('fill');

    const badge = badgesOf(editor).find((b) => b.type === 'circle');
    h().start(editor, { x: badge.attr('cx'), y: badge.attr('cy') }, { x: badge.attr('cx'), y: badge.attr('cy') });

    const after = badgesOf(editor).find((b) => b.type === 'circle').attr('fill');
    expect(after).not.toBe(before);
  });
});

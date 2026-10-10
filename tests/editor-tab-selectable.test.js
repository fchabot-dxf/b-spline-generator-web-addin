/**
 * editor/editor-tab-selectable.js (Fred 2026-10-10, his rule: "I shouldn't be able to select brick in Artwork, or vice
 * versa"; his phone: Artwork > Edit > Select picked a Frame stone). One declared table read by every picker -- the hit
 * test, the selection writers (tap, multi-select, marquee, Select all, the menu's "Select all <kind>"), the cut pick,
 * and a tab switch dropping what the new tab can't own. + the empty menu's "Select all" named per tab and its "Select
 * all in current layer".
 */
import { describe, it, expect, vi } from 'vitest';
import { EDITOR_TAB_SELECTABLE, isSelectableInTab, selectKindOf, selectAllLabelFor } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-tab-selectable.js';
import { getNearbyElement } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-hit.js';
import { select, selectAdd, selectMany } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-ui.js';
import { setEditorFocus } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { selectAllInActiveLayer } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-interaction.js';
import { CONTEXT_MENU_ITEMS, matchingItems } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-context-menu.js';

// a drawing node as the pickers see it: a world bbox, a layer, and DOM attributes (a brick carries data-brick)
function node({ brick = false, layer = '0', at = 0, attrs = {} } = {}) {
  const a = { 'data-layer': layer, ...(brick ? { 'data-brick': 'frame', 'data-brick-gen': '1' } : {}), ...attrs };
  const dom = { hasAttribute: (k) => k in a, getAttribute: (k) => (k in a ? a[k] : null), setAttribute: (k, v) => { a[k] = v; } };
  return {
    node: dom, type: 'path',
    bbox: () => ({ x: at, y: 0, w: 1, h: 1, x2: at + 1, y2: 1 }), matrix: () => null,
    attr: (k) => (k === 'data-layer' ? layer : null),
    addClass() {}, removeClass() {},
  };
}
function editorOn(tab, els = []) {
  const ed = {
    _focusTab: tab, _strokeWidth: 0.1, _activeLayer: '0', _layers: [{ id: '0', visible: true }, { id: '1', visible: true }],
    _sketchLayer: { children: () => ({ toArray: () => els }), attr() { return this; }, node: null },
    _selectedElements: [],
    _deselect() { this._selectedElements = []; },
    _syncToolbarToSelected() {}, _renderSelectionHighlights() {}, _updateHandles() {}, _updateSelectionHighlight() {}, _clipboard: [],
  };
  ed._selectMany = (list) => selectMany(ed, list);
  return ed;
}

describe('EDITOR_TAB_SELECTABLE: declared per tab', () => {
  it('Artwork = art, Brick = bricks, Frame / Photo = nothing on the canvas; "Select all" named per tab', () => {
    expect(Object.fromEntries(Object.entries(EDITOR_TAB_SELECTABLE).map(([t, d]) => [t, d.kinds]))).toEqual({
      artwork: ['art'], brick: ['brick'], frame: [], photo: [],
    });
    expect(selectAllLabelFor({ _focusTab: 'artwork' })).toBe('Select all artwork');
    expect(selectAllLabelFor({ _focusTab: 'brick' })).toBe('Select all bricks');
  });
  it("a node's kind: data-brick (pieces, spines, grout) or a brick record = brick; anything else = art", () => {
    expect(selectKindOf(node({ brick: true }))).toBe('brick');
    expect(selectKindOf(node({ attrs: { 'data-brick-record': 'wall-full' } }))).toBe('brick');
    expect(selectKindOf(node())).toBe('art');
  });
});

describe('every picker honours it', () => {
  it('the hit test: a brick tap in Artwork finds nothing; an art tap in Brick finds nothing; each finds its own', () => {
    const art = node({ at: 0 }), brick = node({ brick: true, at: 5 });
    expect(getNearbyElement(editorOn('artwork', [art, brick]), { x: 5.5, y: 0.5 }, 0.1)).toBe(null);
    expect(getNearbyElement(editorOn('artwork', [art, brick]), { x: 0.5, y: 0.5 }, 0.1)).toBe(art);
    expect(getNearbyElement(editorOn('brick', [art, brick]), { x: 0.5, y: 0.5 }, 0.1)).toBe(null);
    expect(getNearbyElement(editorOn('brick', [art, brick]), { x: 5.5, y: 0.5 }, 0.1)).toBe(brick);
  });
  it('the writers: select / selectAdd / selectMany (marquee, Select all, the menu) keep only the tab\'s own kind', () => {
    const art = node(), brick = node({ brick: true });
    const ed = editorOn('artwork');
    select(ed, brick); expect(ed._selectedElements).toEqual([]);
    selectAdd(ed, brick); expect(ed._selectedElements).toEqual([]);
    selectMany(ed, [art, brick]); expect(ed._selectedElements).toEqual([art]);
    const eb = editorOn('brick');
    selectMany(eb, [art, brick]); expect(eb._selectedElements).toEqual([brick]);
    select(eb, art); expect(eb._selectedElements).toEqual([brick]); // an art pick in Brick changes nothing
  });
  it('a tab switch drops what the new tab can\'t own (so Delete / nudge act on its own kind only)', () => {
    const art = node(), brick = node({ brick: true });
    const ed = editorOn('artwork');
    ed._selectedElements = [art, brick]; // e.g. a selection made before the rule
    setEditorFocus(ed, 'brick');
    expect(ed._selectedElements).toEqual([brick]);
    setEditorFocus(ed, 'artwork');
    expect(ed._selectedElements).toEqual([]);
  });
});

describe('the empty menu: "Select all <tab>" and "Select all in current layer"', () => {
  it('the entries exist on the empty menu, next to each other; the label follows the open tab', () => {
    const ids = matchingItems({ kind: 'empty', editor: editorOn('artwork') }).map((i) => i.id);
    expect(ids.indexOf('select-all-layer')).toBe(ids.indexOf('select-all') + 1);
    const selectAll = CONTEXT_MENU_ITEMS.find((i) => i.id === 'select-all');
    expect(selectAll.label({ kind: 'empty' }, { _focusTab: 'brick' })).toBe('Select all bricks');
    expect(selectAll.label({ kind: 'empty' }, { _focusTab: 'artwork' })).toBe('Select all artwork');
  });
  it('"Select all in current layer": exactly the active layer\'s shown, unlocked pieces the tab owns', () => {
    const a0 = node({ layer: '0' }), a1 = node({ layer: '1' }), b0 = node({ brick: true, layer: '0' });
    const hidden0 = node({ layer: '0', attrs: { display: 'none' } }), locked0 = node({ layer: '0', attrs: { 'data-locked': '1' } });
    const ed = editorOn('artwork', [a0, a1, b0, hidden0, locked0]);
    selectAllInActiveLayer(ed);
    expect(ed._selectedElements).toEqual([a0]);
    const eb = editorOn('brick', [a0, a1, b0]);
    selectAllInActiveLayer(eb);
    expect(eb._selectedElements).toEqual([b0]);
  });
  it('an empty current layer selects nothing', () => {
    const ed = editorOn('artwork', [node({ layer: '1' })]);
    selectAllInActiveLayer(ed);
    expect(ed._selectedElements).toEqual([]);
  });
});

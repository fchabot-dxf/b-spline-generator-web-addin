/**
 * SE8f — `editor._selectMany`/`editor._selectAdd` were imported into
 * editor.js from editor-ui.js since the multi-selection refactor (the
 * constructor's own long-standing "multi-aware code uses editor._selectAdd
 * / editor._selectMany" comment) but never actually delegated as instance
 * methods — only `_select` was. Found while trying to drive a multi-
 * element drag for SE8b-3's perf measurement.
 *
 * Real consequences before this fix: Ctrl+A (`selectAllVisible`,
 * editor-interaction.js) was guarded (`typeof editor._selectMany ===
 * 'function'`) so it silently no-op'd — select-all did nothing. Paste was
 * guarded the same way. Shift-click add (`_selectAdd`) and marquee-
 * finalize (`editor-marquee.js`) were UNGUARDED, so both THREW whenever
 * they'd have selected more than one element.
 *
 * `Object.create(VectorEditor.prototype)` — a real instance's full
 * prototype chain (so `_selectMany`/`_selectAdd` exercise the ACTUAL new
 * delegation lines, which call through to the REAL, un-reimplemented
 * `selectMany`/`selectAdd`/`_afterSelectionChange` in editor-ui.js) with
 * only the instance fields each test actually touches — every DOM/SVG
 * dependency `_afterSelectionChange` reaches for (`_handleLayer`,
 * `getEl(...)` lookups inside `updateToolbarVisibility`) is already
 * written to degrade gracefully when absent (guarded `if (editor.
 * _handleLayer)` / `if (el)` checks), matching this codebase's own
 * established "real class, not a reimplementation" convention
 * (editor-session.test.js).
 */
import { describe, it, expect } from 'vitest';
import { VectorEditor } from '../bspline-frame-builder/b-spline-gen/html/editor/editor.js';
import { selectAllVisible } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-interaction.js';
import { finalizeMarquee } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-marquee.js';

function mockSelEl({ type = 'rect', cls = '', x = 0, y = 0, w = 1, h = 1 } = {}) {
  const state = { class: cls };
  return {
    type,
    attr(name) { return state[name] ?? null; },
    addClass(c) { state.class = (state.class + ' ' + c).trim(); },
    removeClass(c) { state.class = state.class.split(' ').filter((x) => x !== c).join(' '); },
    node: { getAttribute: (name) => state[name] ?? (name === 'class' ? state.class : null), parentNode: {} },
    bbox: () => ({ x, y, w, h, x2: x + w, y2: y + h }),
    matrix: () => null,
  };
}

function mockEditor(children = []) {
  const editor = Object.create(VectorEditor.prototype);
  editor._selectedElements = [];
  editor._sketchLayer = { children: () => ({ toArray: () => children }) };
  editor._activeLayer = '0';
  editor._strokeWidth = 0.5;
  return editor;
}

describe('SE8f: editor._selectMany / editor._selectAdd are real delegations', () => {
  it('_selectMany replaces the selection with the given elements (Ctrl+A\'s own contract)', () => {
    const els = [mockSelEl(), mockSelEl(), mockSelEl()];
    const editor = mockEditor(els);
    editor._selectMany(els);
    expect(editor._selectedElements).toEqual(els);
  });

  it('_selectAdd grows a single selection into a multi-selection (Shift-click)', () => {
    const a = mockSelEl(), b = mockSelEl();
    const editor = mockEditor([a, b]);
    editor._select(a);
    expect(editor._selectedElements).toEqual([a]);
    editor._selectAdd(b);
    expect(editor._selectedElements).toEqual([a, b]);
  });

  it('_selectAdd on an already-selected element REMOVES it (shift-click toggle-off)', () => {
    const a = mockSelEl(), b = mockSelEl();
    const editor = mockEditor([a, b]);
    editor._selectMany([a, b]);
    editor._selectAdd(a);
    expect(editor._selectedElements).toEqual([b]);
  });

});

describe('SE8f: Ctrl+A (selectAllVisible) selects every visible element', () => {
  it('selects all sketch-layer children except ones on a hidden layer', () => {
    const visible1 = mockSelEl({ cls: '' });
    const visible2 = mockSelEl({ cls: 'some-other-class' });
    const hidden = mockSelEl({ cls: 'layer-hidden' });
    const editor = mockEditor([visible1, visible2, hidden]);

    selectAllVisible(editor);

    expect(editor._selectedElements).toEqual([visible1, visible2]);
  });

  it('an empty sketch layer selects nothing (and does not throw)', () => {
    const editor = mockEditor([]);
    expect(() => selectAllVisible(editor)).not.toThrow();
    expect(editor._selectedElements).toEqual([]);
  });
});

describe('SE8f: marquee finalize selects the picked elements', () => {
  function mockMarqueeRect(x, y, w, h) {
    const state = { x, y, width: w, height: h };
    return { attr: (name) => state[name] ?? null, remove() {} };
  }

  it('replacing selection (non-additive): picks every element whose world bbox intersects the marquee', () => {
    const inside = mockSelEl({ x: 1, y: 1, w: 1, h: 1 });
    const outside = mockSelEl({ x: 100, y: 100, w: 1, h: 1 });
    const editor = mockEditor([inside, outside]);
    editor._marqueeStart = { x: 0, y: 0 };
    editor._marqueeRect = mockMarqueeRect(0, 0, 5, 5);
    editor._marqueeAdditive = false;

    const count = finalizeMarquee(editor);

    expect(count).toBe(1);
    expect(editor._selectedElements).toEqual([inside]);
  });

  it('additive marquee (Shift-drag): merges picked elements onto the existing selection', () => {
    const already = mockSelEl({ x: 50, y: 50, w: 1, h: 1 });
    const picked = mockSelEl({ x: 1, y: 1, w: 1, h: 1 });
    const editor = mockEditor([already, picked]);
    editor._selectedElements = [already];
    editor._marqueeStart = { x: 0, y: 0 };
    editor._marqueeRect = mockMarqueeRect(0, 0, 5, 5);
    editor._marqueeAdditive = true;

    finalizeMarquee(editor);

    expect(editor._selectedElements).toEqual([already, picked]);
  });
});

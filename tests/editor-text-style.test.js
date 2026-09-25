/**
 * SE12 T41 — the font-family CSS-override bug and its fix: base.css's own
 * app-wide `* { font-family: inherit; }` reset (loaded on every page) beats
 * a plain SVG presentation attribute (the weakest possible CSS source), so
 * `.font({family})` alone never actually changed what a user SAW on
 * screen — only what Expand/carve later read (opentype.js reads the
 * attribute directly, bypassing the DOM/CSS entirely, so THAT path was
 * always correct; only the live editor's own on-screen render was silently
 * wrong, for every font choice, confirmed live via getComputedStyle
 * showing the UI's own Inter/sans-serif stack instead of the chosen font).
 *
 * Found via a live CDP measurement comparing the browser's own rendered
 * bbox/per-glyph positions against opentype.js's own path output for the
 * SAME text — not reproducible in this file's own mocked DOM (happy-dom
 * doesn't load real external stylesheets, and the whole point IS real
 * browser CSS cascade behavior). What CAN be verified here, and is the
 * real regression risk this file guards against: that every code path
 * which sets font-family ALSO sets it as an inline style (via .css()),
 * which is what gives it enough specificity to survive that global reset
 * — verified by inspecting exactly what each function calls, not by
 * simulating the cascade itself.
 */
import { describe, it, expect } from 'vitest';
import { setFontFamily } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-text-style.js';

function mockTextEl(attrs = {}) {
  const state = { ...attrs };
  const cssCalls = [];
  const fontCalls = [];
  const el = {
    type: 'text',
    attr: (a, v) => {
      if (v !== undefined) { state[a] = v; return el; }
      return state[a];
    },
    font: (opts) => { fontCalls.push(opts); if (opts.family !== undefined) state['font-family'] = opts.family; return el; },
    css: (opts) => { cssCalls.push(opts); return el; },
    node: { childNodes: [] }, // no data-anchor-y set -> reanchorTextY's own early-return, no font-metrics dependency needed here
    _cssCalls: cssCalls,
    _fontCalls: fontCalls,
  };
  return el;
}

describe('setFontFamily — T41: font-family must be set as an inline style, not just an attribute', () => {
  it('the active editing text element gets BOTH .font({family}) (the attribute Expand/carve read) AND .css({font-family}) (the inline style the live render needs) — non-vacuous: checked as two SEPARATE calls, not inferred from one', () => {
    const el = mockTextEl({ 'font-size': '2' });
    const editor = { _editingTextEl: el, _selectedElements: [], _fontSize: 2 };
    setFontFamily(editor, 'Tahoma');

    expect(el._fontCalls).toEqual([{ family: 'Tahoma' }]);
    expect(el._cssCalls.some((c) => c['font-family'] === 'Tahoma')).toBe(true);
  });

  it('fans the SAME inline-style fix out across every selected <text> element, not just the actively-editing one', () => {
    const el1 = mockTextEl({ 'font-size': '2' });
    const el2 = mockTextEl({ 'font-size': '3' });
    const nonText = { type: 'rect' }; // must be silently skipped, no .css()/.font() calls
    const editor = { _editingTextEl: null, _selectedElements: [el1, el2, nonText], _fontSize: 2 };
    setFontFamily(editor, 'Verdana');

    for (const el of [el1, el2]) {
      expect(el._fontCalls).toEqual([{ family: 'Verdana' }]);
      expect(el._cssCalls.some((c) => c['font-family'] === 'Verdana')).toBe(true);
    }
  });

  it('editor._fontFamily is updated regardless of whether any text element is currently active/selected (the default for the NEXT text session)', () => {
    const editor = { _editingTextEl: null, _selectedElements: [], _fontSize: 2 };
    setFontFamily(editor, 'Georgia');
    expect(editor._fontFamily).toBe('Georgia');
  });
});

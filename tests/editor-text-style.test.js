/**
 * SE12 T41/T42 — the font-family CSS-override bug and its fix.
 *
 * Root cause: base.css's own app-wide `* { font-family: inherit; }` reset
 * (loaded on every page) beat a plain SVG presentation attribute (the
 * weakest possible CSS source), so `font-family="..."` on a `<text>`
 * element never actually changed what a user SAW on screen — only what
 * Expand/carve later read (opentype.js reads the attribute directly,
 * bypassing the DOM/CSS entirely, so THAT path was always correct; only
 * the live editor's own on-screen render was silently wrong, for every
 * font choice, confirmed live via getComputedStyle showing the UI's own
 * Inter/sans-serif stack instead of the chosen font).
 *
 * T41 patched the 3 places the EDITOR ITSELF sets a font with an extra
 * inline style (`.css({'font-family'})`), strong enough to survive the
 * reset — but text arriving any OTHER way (a re-opened saved document, an
 * imported/pasted SVG, a markup-restored undo snapshot) was still wrong,
 * since nothing patches THOSE. T42 fixed the CASCADE itself instead —
 * `base.css` now scopes the reset to `*:not(svg *)`, so it never reaches
 * a `<text>`/`<tspan>` at all, and the presentation attribute alone is
 * enough for EVERY <text>, however it was created. The 3 inline-style
 * patches (and the older, narrower `insertSymbol` workaround that
 * predates T41) are gone — one mechanism, not two.
 *
 * Neither the ORIGINAL bug nor this fix is reproducible in THIS file's
 * own mocked DOM: happy-dom's `getComputedStyle` does not resolve real
 * CSS cascade / presentation-attribute precedence at all for font-family
 * (verified directly, not assumed — injecting the real `base.css` rule
 * text and a `font-family` attribute into a happy-dom document and
 * reading `getComputedStyle(...).fontFamily` back returns the literal
 * STRING "inherit", the unresolved keyword, for BOTH the broken `*` rule
 * and the fixed `*:not(svg *)` one — happy-dom simply doesn't implement
 * this resolution step). This is a live-CDP-only class of bug/fix, same
 * as T40's own opentype-comparison work; the real proof is WORK-LOG's own
 * live measurement (computed font-family = the chosen family, for text
 * created from markup with ONLY the attribute — the exact case T41 alone
 * could not cover), not anything in this file.
 *
 * What CAN and does matter here: that `setFontFamily` still correctly
 * sets the font-family ATTRIBUTE (via `.font({family})`) — the ONE
 * mechanism now doing the whole job, so a regression here would ALSO
 * break the live render, not just Expand/carve — and that it does NOT
 * reach for a now-nonexistent inline-style helper.
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

describe('setFontFamily — T42: the font-family ATTRIBUTE alone is now the whole mechanism', () => {
  it('the active editing text element gets .font({family}) (sets the presentation attribute — now the ONLY font-family source, since base.css no longer reaches into SVG) and NOT a redundant .css({font-family}) call', () => {
    const el = mockTextEl({ 'font-size': '2' });
    const editor = { _editingTextEl: el, _selectedElements: [], _fontSize: 2 };
    setFontFamily(editor, 'Tahoma');

    expect(el._fontCalls).toEqual([{ family: 'Tahoma' }]);
    expect(el._cssCalls.some((c) => 'font-family' in c)).toBe(false);
  });

  it('fans .font({family}) out across every selected <text> element, not just the actively-editing one — non-text elements in the selection are silently skipped', () => {
    const el1 = mockTextEl({ 'font-size': '2' });
    const el2 = mockTextEl({ 'font-size': '3' });
    const nonText = { type: 'rect' };
    const editor = { _editingTextEl: null, _selectedElements: [el1, el2, nonText], _fontSize: 2 };
    setFontFamily(editor, 'Verdana');

    for (const el of [el1, el2]) {
      expect(el._fontCalls).toEqual([{ family: 'Verdana' }]);
      expect(el._cssCalls.some((c) => 'font-family' in c)).toBe(false);
    }
  });

  it('editor._fontFamily is updated regardless of whether any text element is currently active/selected (the default for the NEXT text session)', () => {
    const editor = { _editingTextEl: null, _selectedElements: [], _fontSize: 2 };
    setFontFamily(editor, 'Georgia');
    expect(editor._fontFamily).toBe('Georgia');
  });
});

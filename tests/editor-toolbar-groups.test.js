/**
 * SE8c / SA-DECL-2 — TOOLBAR_GROUPS (editor-ui.js): the declared
 * per-property-group visibility rules that replaced updateToolbarVisibility's
 * five parallel if/hidden-toggle blocks. Each predicate is pure —
 * `(rawMode, el, currentMode) => visible` — with no DOM access, so it's
 * tested directly rather than through the DOM-applying
 * applyToolbarGroups/updateToolbarVisibility wrapper (same pure/DOM split
 * as every other declared table in this codebase).
 */
import { describe, it, expect } from 'vitest';
import { TOOLBAR_GROUPS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-ui.js';

describe('TOOLBAR_GROUPS: text mode', () => {
  it('shows Font, Symbol, and the divider; hides Expand and Stroke', () => {
    expect(TOOLBAR_GROUPS.editorFontGroup('text', null)).toBe(true);
    expect(TOOLBAR_GROUPS.editorSymbolKeyboardToggle('text', null)).toBe(true);
    expect(TOOLBAR_GROUPS['.property-divider']('text', null)).toBe(true);
    expect(TOOLBAR_GROUPS.editorExpandGroup('text')).toBe(false);
    expect(TOOLBAR_GROUPS.editorStrokeGroup('text', null)).toBe(false);
  });
});

describe('TOOLBAR_GROUPS: expand mode', () => {
  it('shows Expand and the divider; hides Font/Symbol/Stroke', () => {
    expect(TOOLBAR_GROUPS.editorExpandGroup('expand')).toBe(true);
    expect(TOOLBAR_GROUPS['.property-divider']('expand', null)).toBe(true);
    expect(TOOLBAR_GROUPS.editorFontGroup('expand', null)).toBe(false);
    expect(TOOLBAR_GROUPS.editorStrokeGroup('expand', null)).toBe(false);
  });
});

describe('TOOLBAR_GROUPS: an ordinary mode (select)', () => {
  it('shows Stroke; hides Font/Symbol/Expand/the divider/AutoNodes/LatticePanel', () => {
    expect(TOOLBAR_GROUPS.editorStrokeGroup('select', null)).toBe(true);
    expect(TOOLBAR_GROUPS.editorFontGroup('select', null)).toBe(false);
    expect(TOOLBAR_GROUPS.editorExpandGroup('select')).toBe(false);
    expect(TOOLBAR_GROUPS['.property-divider']('select', null)).toBe(false);
    expect(TOOLBAR_GROUPS.editorAutoNodesGroup('select', null, 'select')).toBe(false);
    expect(TOOLBAR_GROUPS.editorLatticePanel('select', null, 'select')).toBe(false);
  });
});

describe('TOOLBAR_GROUPS: Font also shows for a selected text element from a DIFFERENT mode', () => {
  it('el.type === "text" satisfies the Font/Symbol/divider predicates even when rawMode is not "text"', () => {
    const textEl = { type: 'text' };
    expect(TOOLBAR_GROUPS.editorFontGroup('select', textEl)).toBe(true);
    expect(TOOLBAR_GROUPS.editorSymbolKeyboardToggle('select', textEl)).toBe(true);
    expect(TOOLBAR_GROUPS['.property-divider']('select', textEl)).toBe(true);
    expect(TOOLBAR_GROUPS.editorStrokeGroup('select', textEl)).toBe(false);
  });
});

describe('TOOLBAR_GROUPS: AutoNodes / LatticePanel read currentMode, not rawMode', () => {
  it('both show when currentMode is "lattice", even if rawMode is undefined (the parameterless call-site case)', () => {
    expect(TOOLBAR_GROUPS.editorAutoNodesGroup(undefined, null, 'lattice')).toBe(true);
    expect(TOOLBAR_GROUPS.editorLatticePanel(undefined, null, 'lattice')).toBe(true);
  });

  it('both stay hidden when currentMode is anything else, regardless of rawMode', () => {
    expect(TOOLBAR_GROUPS.editorAutoNodesGroup('lattice', null, 'select')).toBe(false);
    expect(TOOLBAR_GROUPS.editorLatticePanel('lattice', null, 'select')).toBe(false);
  });
});

describe('TOOLBAR_GROUPS: the parameterless call-site case (rawMode and el both undefined)', () => {
  it('Font/Symbol/divider/Stroke all fall back to their non-text defaults — NOT re-derived from selection', () => {
    // This is the exact (mode, el) pair _afterSelectionChange (editor-ui.js)
    // and editor.js's own selection-sync call updateToolbarVisibility with —
    // preserved byte-for-byte from before SE8c, see TOOLBAR_GROUPS' own doc
    // comment for why this is intentional, not fixed, this turn.
    expect(TOOLBAR_GROUPS.editorFontGroup(undefined, undefined)).toBe(false);
    expect(TOOLBAR_GROUPS.editorExpandGroup(undefined)).toBe(false);
    expect(TOOLBAR_GROUPS.editorStrokeGroup(undefined, undefined)).toBe(true);
  });
});

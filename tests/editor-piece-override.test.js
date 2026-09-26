/**
 * UI5 items 1-4 (per-piece overrides): editor-piece-override.js is the
 * ONE declared schema module (data-override-color/width + apply/clear/
 * read helpers) — this file tests it directly, in isolation, with a
 * minimal svg.js-shaped mock element (same shape as editor-lattice-
 * pattern-emit.test.js's own makeElement, extended with removeAttribute
 * since clearColorOverride/clearWidthOverride need it).
 */
import { describe, it, expect } from 'vitest';
import {
  OVERRIDE_COLOR_ATTR, OVERRIDE_WIDTH_ATTR, pieceKindOf,
  hasColorOverride, hasWidthOverride,
  applyColorOverride, applyWidthOverride, clearColorOverride, clearWidthOverride,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-piece-override.js';

function makeEl(initial) {
  const store = { ...initial };
  const el = {
    node: {
      getAttribute: (k) => (store[k] !== undefined ? store[k] : null),
      hasAttribute: (k) => store[k] !== undefined,
      removeAttribute: (k) => { delete store[k]; },
    },
    attr(k, v) {
      if (v === undefined) return store[k];
      store[k] = v;
      return el;
    },
    stroke(v) { if (v && 'color' in v) store.stroke = v.color; return el; },
    fill(v) { store.fill = v; return el; },
    _store: store,
  };
  return el;
}

describe('pieceKindOf', () => {
  it('maps data-lattice values to the panel-facing kind vocabulary', () => {
    expect(pieceKindOf(makeEl({ 'data-lattice': 'rail' }))).toBe('rails');
    expect(pieceKindOf(makeEl({ 'data-lattice': 'tie' }))).toBe('ties');
    expect(pieceKindOf(makeEl({ 'data-lattice': 'node' }))).toBe('nodes');
  });
  it('returns null for anything else (contour, hand-drawn shape, nothing)', () => {
    expect(pieceKindOf(makeEl({ 'data-contour-seg': '0' }))).toBeNull();
    expect(pieceKindOf(makeEl({}))).toBeNull();
    expect(pieceKindOf(null)).toBeNull();
  });
});

describe('colour override', () => {
  it('applyColorOverride sets stroke for a rail/tie and stamps the attribute', () => {
    const el = makeEl({});
    applyColorOverride(el, 'rails', '#123456');
    expect(el._store.stroke).toBe('#123456');
    expect(el._store[OVERRIDE_COLOR_ATTR]).toBe('#123456');
    expect(hasColorOverride(el)).toBe(true);
  });

  it('applyColorOverride sets FILL (not stroke) for a node', () => {
    const el = makeEl({});
    applyColorOverride(el, 'nodes', '#abcdef');
    expect(el._store.fill).toBe('#abcdef');
    expect(el._store.stroke).toBeUndefined();
  });

  it('clearColorOverride removes the attribute and repaints with the given default', () => {
    const el = makeEl({});
    applyColorOverride(el, 'rails', '#123456');
    clearColorOverride(el, 'rails', '#c62828');
    expect(hasColorOverride(el)).toBe(false);
    expect(el._store.stroke).toBe('#c62828');
  });
});

describe('width override', () => {
  it('applyWidthOverride sets stroke-width for a rail/tie directly (not halved)', () => {
    const el = makeEl({});
    applyWidthOverride(el, 'ties', 0.5);
    expect(el._store['stroke-width']).toBe(0.5);
    expect(el._store[OVERRIDE_WIDTH_ATTR]).toBe(0.5);
  });

  it('applyWidthOverride halves the value into `r` for a node (diameter-in, radius-out)', () => {
    const el = makeEl({});
    applyWidthOverride(el, 'nodes', 0.8);
    expect(el._store.r).toBe(0.4);
    expect(el._store[OVERRIDE_WIDTH_ATTR]).toBe(0.8); // the ATTRIBUTE still records the diameter the panel showed
  });

  it('clearWidthOverride removes the attribute and re-sizes with the given default', () => {
    const el = makeEl({});
    applyWidthOverride(el, 'nodes', 0.8);
    clearWidthOverride(el, 'nodes', 0.3);
    expect(hasWidthOverride(el)).toBe(false);
    expect(el._store.r).toBe(0.15);
  });
});

// Non-vacuous check (mutation-style, in-file): hasColorOverride/hasWidthOverride
// must actually distinguish "override present" from "not present", not just
// always return the same thing.
describe('hasColorOverride / hasWidthOverride are genuinely conditional', () => {
  it('read false before an override is applied, true after', () => {
    const el = makeEl({});
    expect(hasColorOverride(el)).toBe(false);
    expect(hasWidthOverride(el)).toBe(false);
    applyColorOverride(el, 'rails', '#111111');
    applyWidthOverride(el, 'rails', 0.4);
    expect(hasColorOverride(el)).toBe(true);
    expect(hasWidthOverride(el)).toBe(true);
  });
});

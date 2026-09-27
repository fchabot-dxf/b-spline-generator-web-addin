/**
 * UI5 items 1-4 (per-piece overrides): editor-piece-override.js is the
 * ONE declared schema module (data-override-color + apply/clear/read
 * helpers) — this file tests it directly, in isolation, with a minimal
 * svg.js-shaped mock element (same shape as editor-lattice-pattern-
 * emit.test.js's own makeElement, extended with removeAttribute since
 * clearColorOverride needs it).
 *
 * H3 (NO-PIECE-WIDTH): the module's own width half (data-override-width +
 * hasWidthOverride/applyWidthOverride/clearWidthOverride) is gone, not
 * just changed — see the "width override" describe block below for the
 * rewritten check. The BEHAVIOURAL new rule ("an old override no longer
 * blocks a general width change") is tested where that behaviour actually
 * lives: tests/editor-lattice-pattern-emit.test.js's own rewidthOwnedKind
 * describe block.
 */
import { describe, it, expect } from 'vitest';
import * as pieceOverride from '../bspline-frame-builder/b-spline-gen/html/editor/editor-piece-override.js';
import {
  OVERRIDE_COLOR_ATTR, pieceKindOf,
  hasColorOverride, applyColorOverride, clearColorOverride,
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

// H3 (NO-PIECE-WIDTH): the module's width half is REMOVED, not merely
// changed — asserted directly against the module's own exports (would
// fail on the pre-H3 module, which had all four; passes now that none
// do), rather than deleted outright with nothing in its place.
describe('width override (H3: removed)', () => {
  it('no width-override attribute constant or helpers remain exported', () => {
    expect(pieceOverride.OVERRIDE_WIDTH_ATTR).toBeUndefined();
    expect(pieceOverride.hasWidthOverride).toBeUndefined();
    expect(pieceOverride.applyWidthOverride).toBeUndefined();
    expect(pieceOverride.clearWidthOverride).toBeUndefined();
  });
});

// Non-vacuous check (mutation-style, in-file): hasColorOverride must
// actually distinguish "override present" from "not present", not just
// always return the same thing.
describe('hasColorOverride is genuinely conditional', () => {
  it('reads false before an override is applied, true after', () => {
    const el = makeEl({});
    expect(hasColorOverride(el)).toBe(false);
    applyColorOverride(el, 'rails', '#111111');
    expect(hasColorOverride(el)).toBe(true);
  });
});

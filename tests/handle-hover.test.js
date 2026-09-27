/**
 * T81 item 1 (Fred screenshot: the Shape Lattice shoulder/hip/waist handles
 * give no hover feedback -- "add visual feedback to these handles on
 * hover"). ONE declared hover/press style (handleHoverVisual, editor-
 * transform-handles.js) drives both handle systems named in the dispatch:
 * Shape Lattice's own param handles and the Frame editor's handles. Neither
 * had a hover state before this (confirmed by reading both: Frame's own
 * pointer wiring had no idle-hover path at all) -- there's nothing "already
 * declared" to unify onto except the shared helper this item adds.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  handleHoverVisual, HANDLE_HOVER_SCALE, HANDLE_HOVER_FILL, HANDLE_HOVER_STROKE, setHandleCursor,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-transform-handles.js';

describe('handleHoverVisual -- the ONE declared hover/press style', () => {
  it('idle: the caller\'s own base radius/fill/stroke, unchanged', () => {
    expect(handleHoverVisual(0.1, '#ffffff', '#7b1fa2', false)).toEqual({ radius: 0.1, fill: '#ffffff', stroke: '#7b1fa2' });
  });
  it('active (hover or press): grows by HANDLE_HOVER_SCALE and swaps to the shared accent look', () => {
    expect(handleHoverVisual(0.1, '#ffffff', '#7b1fa2', true)).toEqual({
      radius: 0.1 * HANDLE_HOVER_SCALE, fill: HANDLE_HOVER_FILL, stroke: HANDLE_HOVER_STROKE,
    });
  });
  it('active looks IDENTICAL regardless of the caller\'s own idle colours (Shape Lattice purple vs Frame brown)', () => {
    const shapeLattice = handleHoverVisual(0.09, '#ffffff', '#7b1fa2', true);
    const frame = handleHoverVisual(0.09, '#ffffff', '#5d4037', true);
    expect(shapeLattice).toEqual(frame);
  });
});

describe('setHandleCursor -- ONE cursor toggle for every handle system', () => {
  beforeEach(() => { document.body.innerHTML = '<div id="editorSVGContainer"></div>'; });
  const classes = () => Array.from(document.getElementById('editorSVGContainer').classList);

  it('null: neither class', () => { setHandleCursor(null); expect(classes()).toEqual([]); });
  it("'hover': grab", () => { setHandleCursor('hover'); expect(classes()).toEqual(['handle-hover-ready']); });
  it("'active': grabbing", () => { setHandleCursor('active'); expect(classes()).toEqual(['handle-hover-active']); });
  it('switching state removes the previous class', () => {
    setHandleCursor('hover'); setHandleCursor('active');
    expect(classes()).toEqual(['handle-hover-active']);
    setHandleCursor(null);
    expect(classes()).toEqual([]);
  });
  it('does not touch the pre-existing pan-ready/panning classes (own class names, per the dispatch)', () => {
    const c = document.getElementById('editorSVGContainer');
    c.classList.add('pan-ready');
    setHandleCursor('hover');
    expect(classes().sort()).toEqual(['handle-hover-ready', 'pan-ready']);
  });
  it('a missing #editorSVGContainer is a no-op, not a throw', () => {
    document.body.innerHTML = '';
    expect(() => setHandleCursor('hover')).not.toThrow();
  });
});

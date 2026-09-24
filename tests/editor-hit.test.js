/**
 * SE8b / SA-COORD-3 — getNearbyElement hit-tests against the element's
 * WORLD bbox now, not the LOCAL one el.bbox() returns (explicitly
 * documented in editor-coords.js's own header as "IGNORES transform").
 * Before this, dragging a shape via Select (writes a `transform`, never
 * touches x/y/width/height) then clicking where it now visually sits
 * missed entirely — the check compared against the shape's OLD position;
 * clicking the now-empty spot where it USED to be selected it instead.
 */
import { describe, it, expect } from 'vitest';
import { getNearbyElement } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-hit.js';

function mockShapeEl({ bbox, matrix = null, layer = '0', strokeWidth = null }) {
  return {
    bbox: () => bbox,
    matrix: () => matrix,
    attr: (name) => {
      if (name === 'data-layer') return layer;
      if (name === 'stroke-width') return strokeWidth;
      return null;
    },
  };
}

function mockEditor(elements, { activeLayer = '0' } = {}) {
  return {
    _strokeWidth: 0.5,
    _activeLayer: activeLayer,
    _layers: [{ id: '0', visible: true }],
    _sketchLayer: { children: () => ({ toArray: () => elements }) },
  };
}

describe('getNearbyElement', () => {
  it('finds an element at its WORLD position after a Select-mode move (transform set, local bbox stale)', () => {
    // A 1x1 shape drawn at the origin, then moved via Select — translate(5,5)
    // writes a transform WITHOUT touching the local bbox at all (matches
    // how editor-transform-handles.js's applyTransformDrag actually works).
    const el = mockShapeEl({
      bbox: { x: 0, y: 0, w: 1, h: 1, x2: 1, y2: 1 }, // stale LOCAL bbox
      matrix: { a: 1, b: 0, c: 0, d: 1, e: 5, f: 5 },  // translate(5,5)
    });
    const editor = mockEditor([el]);

    // Click where the shape NOW visually sits (world space).
    expect(getNearbyElement(editor, { x: 5.5, y: 5.5 }, 0.1)).toBe(el);
    // The OLD (empty) spot no longer hits it.
    expect(getNearbyElement(editor, { x: 0.5, y: 0.5 }, 0.1)).toBeNull();
  });

  it('picks the closer of two overlapping candidates, ranked in WORLD space', () => {
    const near = mockShapeEl({ bbox: { x: 0, y: 0, w: 1, h: 1, x2: 1, y2: 1 }, matrix: null });
    const far = mockShapeEl({ bbox: { x: 0.3, y: 0.3, w: 1, h: 1, x2: 1.3, y2: 1.3 }, matrix: null });
    const editor = mockEditor([far, near]); // order shouldn't matter
    // Click near (0.5,0.5) — near's centre (0.5,0.5) is closer than far's (0.8,0.8).
    expect(getNearbyElement(editor, { x: 0.5, y: 0.5 }, 0.1)).toBe(near);
  });

  it('returns null when nothing is within tolerance', () => {
    const el = mockShapeEl({ bbox: { x: 0, y: 0, w: 1, h: 1, x2: 1, y2: 1 }, matrix: null });
    const editor = mockEditor([el]);
    expect(getNearbyElement(editor, { x: 10, y: 10 }, 0.1)).toBeNull();
  });
});

/**
 * SE8b / SA-COORD-3 — getNearbyElement hit-tests against the element's
 * WORLD bbox now, not the LOCAL one el.bbox() returns (explicitly
 * documented in editor-coords.js's own header as "IGNORES transform").
 * Before this, dragging a shape via Select (writes a `transform`, never
 * touches x/y/width/height) then clicking where it now visually sits
 * missed entirely — the check compared against the shape's OLD position;
 * clicking the now-empty spot where it USED to be selected it instead.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getNearbyElement, getDynamicTolerance } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-hit.js';

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

describe('getDynamicTolerance: SE7m profileKey (SA-MOBILE-1/2)', () => {
  let container;
  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'editorSVGContainer';
    Object.defineProperty(container, 'clientWidth', { value: 100, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 100, configurable: true });
    document.body.appendChild(container);
  });
  afterEach(() => { container.remove(); });

  function mockToleranceEditor(pointerType) {
    return {
      _draw: { viewbox: () => ({ x: 0, y: 0, w: 10, h: 10 }) }, // viewScale reads .w/.h (svg.js's own Box shape) — 100/10 = 10 px/model-unit
      _pointerType: pointerType,
    };
  }

  it('without profileKey, uses the raw px argument as-is regardless of pointer type (every pre-existing purpose-specific call site is unaffected)', () => {
    const mouse = mockToleranceEditor('mouse');
    const touch = mockToleranceEditor('touch');
    expect(getDynamicTolerance(mouse, 8)).toBeCloseTo(0.8, 10);
    expect(getDynamicTolerance(touch, 8)).toBeCloseTo(0.8, 10); // SAME — profileKey omitted, touch gets no special treatment
  });

  it("with profileKey='slopPx', mouse gets the pre-SE7m default (10px) and touch gets INPUT_PROFILE.touch.slopPx (22px) — a real, different tolerance", () => {
    const mouse = mockToleranceEditor('mouse');
    const touch = mockToleranceEditor('touch');
    const mouseTol = getDynamicTolerance(mouse, 10, 'slopPx');
    const touchTol = getDynamicTolerance(touch, 10, 'slopPx');
    expect(mouseTol).toBeCloseTo(1.0, 10);  // 10px / 10(px/unit)
    expect(touchTol).toBeCloseTo(2.2, 10);  // 22px / 10(px/unit)
    expect(touchTol).toBeGreaterThan(mouseTol);
  });

  it("with profileKey='grabPx', touch's node-grab radius is larger than mouse's", () => {
    const mouse = mockToleranceEditor('mouse');
    const touch = mockToleranceEditor('touch');
    expect(getDynamicTolerance(touch, 15, 'grabPx')).toBeGreaterThan(getDynamicTolerance(mouse, 15, 'grabPx'));
  });

  it('an unrecognized pointerType falls back to the mouse profile (never a smaller/undefined tolerance)', () => {
    const weird = mockToleranceEditor('some-future-input-type');
    const mouse = mockToleranceEditor('mouse');
    expect(getDynamicTolerance(weird, 10, 'slopPx')).toBeCloseTo(getDynamicTolerance(mouse, 10, 'slopPx'), 10);
  });
});

/**
 * SE7s — beginTransform/applyTransformDrag's per-kind HANDLE_EDIT rewrite:
 * a scale-handle drag no longer always composes a scale into `transform`
 * (which scaled the stroke/carve width, and sheared a rotated element
 * whose handles sat on the WORLD-aligned bbox). Per ROADMAP "SE7s" +
 * Fred's rulings ("scaling on a tie shouldn't actually scale — only adjust
 * length", "scaling shapes shouldn't scale the stroke anywhere"):
 *   - 'geometry' (rect/path/polyline/polygon) bakes into raw coordinates
 *     on every move; `transform` never gains a scale, stroke-width never
 *     changes.
 *   - 'endpoints' (line) moves the nearest endpoint along the line's own
 *     direction (length only, angle kept).
 *   - 'radius'/'radii' (circle/ellipse) resize in place, centre fixed.
 *   - A single selection edits in the element's OWN (possibly rotated)
 *     frame; a rotated rect promotes to a path first so the same general
 *     point-list bake applies (an axis-aligned rect never promotes).
 *
 * Mock elements provide only what the code under test actually calls:
 * type, attr() (string get, string+value set, and object-merge set — all
 * three forms are used by the real code), bbox(), matrix(). Matches the
 * mocking convention already established in editor-nodes.test.js /
 * editor-coords.test.js (matrix() returns null for identity, or a plain
 * {a,b,c,d,e,f} with its own inverse() where a test needs a real one).
 */
import { describe, it, expect } from 'vitest';
import {
  beginTransform, applyTransformDrag, renderTransformHandles, bakeMatrixIntoElement,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-transform-handles.js';

function mockEditor(selectedElements, extra = {}) {
  return {
    _selectedElements: selectedElements,
    _grid: { visible: false, snap: false, spacing: 0.25 },
    _updateSelectionHighlight() {},
    _notifyChange() {},
    ...extra,
  };
}

function mockAttrEl(type, attrs, matrix = null) {
  const state = { ...attrs };
  const el = {
    type,
    attr(a, v) {
      if (typeof a === 'string') {
        if (v === undefined) return state[a];
        state[a] = v;
        return el;
      }
      Object.assign(state, a);
      return el;
    },
    matrix: () => matrix,
    _state: state,
  };
  return el;
}

function mockRectEl(attrs, matrix = null) {
  const el = mockAttrEl('rect', attrs, matrix);
  el.bbox = () => {
    const x = +el._state.x || 0, y = +el._state.y || 0;
    const w = +el._state.width || 0, h = +el._state.height || 0;
    return { x, y, w, h, x2: x + w, y2: y + h };
  };
  return el;
}

function mockLineEl(attrs, matrix = null) {
  const el = mockAttrEl('line', attrs, matrix);
  el.bbox = () => {
    const { x1, y1, x2, y2 } = el._state;
    const x = Math.min(x1, x2), y = Math.min(y1, y2);
    return { x, y, w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), x2: Math.max(x1, x2), y2: Math.max(y1, y2) };
  };
  return el;
}

function mockCircleEl(attrs, matrix = null) {
  const el = mockAttrEl('circle', attrs, matrix);
  el.bbox = () => {
    const cx = +el._state.cx || 0, cy = +el._state.cy || 0, r = +el._state.r || 0;
    return { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r, x2: cx + r, y2: cy + r };
  };
  return el;
}

function mockEllipseEl(attrs, matrix = null) {
  const el = mockAttrEl('ellipse', attrs, matrix);
  el.bbox = () => {
    const cx = +el._state.cx || 0, cy = +el._state.cy || 0;
    const rx = +el._state.rx || 0, ry = +el._state.ry || 0;
    return { x: cx - rx, y: cy - ry, w: 2 * rx, h: 2 * ry, x2: cx + rx, y2: cy + ry };
  };
  return el;
}

const handleRecFor = (id, sx, sy) => ({ kind: 'scale', id, sx, sy, hitR: 1 });

describe('geometry (rect): axis-aligned side-handle drag', () => {
  it('doubles width via x/y/width/height directly — stroke-width unchanged, no scale left in transform', () => {
    const el = mockRectEl({ x: 0, y: 0, width: 2, height: 1, 'stroke-width': 0.05 });
    const editor = mockEditor([el]);
    // 'e' handle: hx=1,hy=0.5,ax=0,ay=0.5,sx=true,sy=false.
    const handleRec = handleRecFor('e', true, false);
    const state = beginTransform(editor, handleRec, { x: 2, y: 0.5 });
    expect(state.frame).toBe('local');

    applyTransformDrag(editor, state, { x: 4, y: 0.5 }, {}); // pointer at local x=4 -> sx=2

    expect(el._state).toMatchObject({ x: 0, y: 0, width: 4, height: 1 });
    expect(el._state['stroke-width']).toBe(0.05); // untouched
    expect(el._state.transform).toBeUndefined(); // never written for a 'geometry' kind
  });

  it('non-vacuous: reverting to the OLD transform-scale behaviour would leave width=2 and set a scale transform instead', () => {
    // Proven by construction above, not by re-running old code: the OLD
    // code path (still present for 'text'/undeclared kinds, see the scale
    // test below) always writes `transform`, never x/y/width/height. Since
    // this test's rect ends with width=4 and NO transform attr, the
    // 'geometry' branch — not the fallback — is what ran.
    const el = mockRectEl({ x: 0, y: 0, width: 2, height: 1 });
    const editor = mockEditor([el]);
    const state = beginTransform(editor, handleRecFor('e', true, false), { x: 2, y: 0.5 });
    applyTransformDrag(editor, state, { x: 4, y: 0.5 }, {});
    expect(el._state.width).not.toBe(2);
    expect(el._state.transform).toBeUndefined();
  });
});

describe('geometry (path, standing in for a promoted rotated rect): side drag keeps right angles', () => {
  // A rotated rect promotes to a path holding the SAME 4 corners in local
  // space with the SAME transform (see _promoteRectToPath) before any
  // 'geometry' bake runs — this exercises exactly that downstream bake
  // (the mechanical DOM-swap promotion itself is not separately mocked;
  // see WORK-LOG). Local-frame math never depends on rotation for
  // correctness (it works entirely in pre-rotation local coordinates), so
  // this constructs the path a promoted 30°-rotated rect would produce.
  function mockPathEl(segments, matrix = null) {
    let arr = segments.map((s) => [...s]);
    return {
      type: 'path',
      array: () => arr,
      plot: (a) => { arr = a; },
      matrix: () => matrix,
      _get: () => arr,
      bbox() {
        const xs = arr.filter((s) => s[0] !== 'Z').map((s) => s[1]);
        const ys = arr.filter((s) => s[0] !== 'Z').map((s) => s[2]);
        const x = Math.min(...xs), y = Math.min(...ys), x2 = Math.max(...xs), y2 = Math.max(...ys);
        return { x, y, w: x2 - x, h: y2 - y, x2, y2 };
      },
    };
  }

  it('a 30°-rotated rect: side-handle drag stays axis-aligned in local space, so the rotated result keeps right angles', () => {
    const rad = (30 * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    // Pure rotation matrix, 30°, about the origin.
    const m = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0, inverse: () => ({ a: cos, b: -sin, c: sin, d: cos, e: 0, f: 0 }) };
    // Local rect 4 x 2 at the origin, as _promoteRectToPath would emit.
    const el = mockPathEl([['M', 0, 0], ['L', 4, 0], ['L', 4, 2], ['L', 0, 2], ['Z']], m);
    const editor = mockEditor([el]);

    // 'e' handle (hx=1,hy=0.5,ax=0,ay=0.5): local handle=(4,1), anchor=(0,1).
    const handleRec = handleRecFor('e', true, false);
    const state = beginTransform(editor, handleRec, { x: 0, y: 0 }); // startPt unused for scale math
    expect(state.frame).toBe('local');

    // World handle/anchor (for reference, not asserted): transformPoint(m, (4,1)) / (0,1).
    // Drag the world pointer to where local (8,1) maps — sx=2 exactly.
    const worldPointerAtLocal8_1 = { x: cos * 8 - sin * 1, y: sin * 8 + cos * 1 };
    applyTransformDrag(editor, state, worldPointerAtLocal8_1, {});

    const arr = el._get();
    // Reconstruct the 4 corners (Z closes back to the first M).
    const corners = [arr[0], arr[1], arr[2], arr[3]].map(([, x, y]) => ({ x, y }));
    expect(corners[0]).toEqual({ x: 0, y: 0 });
    expect(corners[1].x).toBeCloseTo(8, 9); // doubled width, height untouched
    expect(corners[1].y).toBeCloseTo(0, 9);
    expect(corners[2]).toEqual({ x: corners[1].x, y: 2 });
    expect(corners[3]).toEqual({ x: 0, y: 2 });

    // Right-angle check on the LOCAL geometry itself (still axis-aligned —
    // baked in local space, the rotation in `transform` is untouched and
    // rotates the whole rectangle rigidly, so right angles survive).
    const v1 = { x: corners[1].x - corners[0].x, y: corners[1].y - corners[0].y };
    const v2 = { x: corners[3].x - corners[0].x, y: corners[3].y - corners[0].y };
    expect(v1.x * v2.x + v1.y * v2.y).toBeCloseTo(0, 9); // dot product 0 = perpendicular
    expect(el.matrix()).toBe(m); // transform (rotation) never touched by a geometry bake
  });
});

describe('endpoints (line): handle drag changes length only', () => {
  it('angle is preserved to within 1e-9; only the dragged endpoint moves', () => {
    const el = mockLineEl({ x1: 0, y1: 0, x2: 4, y2: 0 });
    const editor = mockEditor([el]);
    // 'e' handle sits at the line's own bbox right-mid — nearest to x2.
    const state = beginTransform(editor, handleRecFor('e', true, false), { x: 4, y: 0 });
    expect(state.els[0].kind).toBe('endpoints');
    expect(state.els[0].movingIsP1).toBe(false);

    // Drag off-axis on purpose — the projection must still hold the line
    // to its ORIGINAL direction (length only), not follow the pointer's y.
    applyTransformDrag(editor, state, { x: 7, y: 0.4 }, {});

    expect(el._state.x1).toBe(0);
    expect(el._state.y1).toBe(0);
    expect(el._state.x2).toBeCloseTo(7, 9);
    expect(el._state.y2).toBeCloseTo(0, 9);
    const angle = Math.atan2(el._state.y2 - el._state.y1, el._state.x2 - el._state.x1);
    expect(Math.abs(angle)).toBeLessThan(1e-9);
  });

  it('non-vacuous: an off-axis pointer WOULD move y2 under naive "write the pointer directly" logic — it does not here', () => {
    const el = mockLineEl({ x1: 0, y1: 0, x2: 4, y2: 0 });
    const editor = mockEditor([el]);
    const state = beginTransform(editor, handleRecFor('e', true, false), { x: 4, y: 0 });
    applyTransformDrag(editor, state, { x: 5, y: 3 }, {}); // a naive write would set y2=3
    expect(el._state.y2).not.toBe(3);
    expect(el._state.y2).toBeCloseTo(0, 9);
  });
});

describe('radius (circle): corner-handle drag resizes in place', () => {
  it('centre stays fixed; radius scales by the projection factor', () => {
    const el = mockCircleEl({ cx: 2, cy: 3, r: 1 });
    const editor = mockEditor([el]);
    // 'se' handle: hx=1,hy=1,ax=0,ay=0 -> local handle=(3,4), anchor=(1,2).
    const state = beginTransform(editor, handleRecFor('se', true, true), { x: 3, y: 4 });
    expect(state.els[0].kind).toBe('radius');
    expect(state.els[0].r0).toBe(1);

    // Drag to local (1,2)+(2,2)*3 = (7,8): exact uniform factor 3 along the
    // anchor->handle direction.
    applyTransformDrag(editor, state, { x: 7, y: 8 }, {});

    expect(el._state.r).toBeCloseTo(3, 9);
    expect(el._state.cx).toBe(2);
    expect(el._state.cy).toBe(3);
    expect(el._state.transform).toBeUndefined();
  });
});

describe('radii (ellipse): side-handle drag resizes rx/ry independently', () => {
  it('a side handle changes only the axis it controls; the other radius and the centre stay put', () => {
    const el = mockEllipseEl({ cx: 0, cy: 0, rx: 2, ry: 1 });
    const editor = mockEditor([el]);
    // 'e' handle: hx=1,hy=0.5,ax=0,ay=0.5 -> local handle=(2,0), anchor=(-2,0).
    const state = beginTransform(editor, handleRecFor('e', true, false), { x: 2, y: 0 });
    expect(state.els[0].kind).toBe('radii');

    applyTransformDrag(editor, state, { x: 4, y: 0 }, {}); // sx = 6/4 = 1.5

    expect(el._state.rx).toBeCloseTo(3, 9); // 2 * 1.5
    expect(el._state.ry).toBe(1); // untouched — this handle doesn't control y
    expect(el._state.cx).toBe(0);
    expect(el._state.cy).toBe(0);
  });
});

describe('bakeMatrixIntoElement: circle/ellipse stay native under a similarity (SE12 Slice 0)', () => {
  // mockCircleEl/mockEllipseEl above have NO .parent()/.remove() — if the
  // native-stay branch's condition were wrong and control fell through to
  // the promote-to-path fallback, these tests would throw on `.parent()`
  // being undefined rather than silently mispass; that's the non-vacuity
  // signal for these cases, on top of the explicit assertions below.
  it('a pure uniform scale + translate (carveMatrix\'s own shape): circle stays a <circle>, r scaled, cx/cy mapped', () => {
    const el = mockCircleEl({ cx: 1, cy: 2, r: 0.1 });
    const m = { a: 96, b: 0, c: 0, d: 96, e: -(7 * 96) / 2, f: -(9 * 96) / 2 };
    expect(bakeMatrixIntoElement(el, m)).toBe(true);
    expect(el._state.r).toBeCloseTo(0.1 * 96, 6);
    expect(el._state.cx).toBeCloseTo(1 * 96 - (7 * 96) / 2, 6);
    expect(el._state.cy).toBeCloseTo(2 * 96 - (9 * 96) / 2, 6);
    expect(el._state.transform).toBeNull();
  });

  it('a rotated similarity: circle still stays native (rotation is invisible on a circle) — radius scaled by the uniform factor', () => {
    const rad = (40 * Math.PI) / 180, s = 3;
    const el = mockCircleEl({ cx: 0, cy: 0, r: 2 });
    const m = { a: s * Math.cos(rad), b: s * Math.sin(rad), c: -s * Math.sin(rad), d: s * Math.cos(rad), e: 0, f: 0 };
    expect(bakeMatrixIntoElement(el, m)).toBe(true);
    expect(el._state.r).toBeCloseTo(6, 6);
  });

  it('an axis-aligned (no rotation) similarity on an ellipse: rx/ry both scale, stays native', () => {
    const el = mockEllipseEl({ cx: 5, cy: -3, rx: 2, ry: 1 });
    const m = { a: 4, b: 0, c: 0, d: 4, e: 1, f: 1 };
    expect(bakeMatrixIntoElement(el, m)).toBe(true);
    expect(el._state.rx).toBeCloseTo(8, 6);
    expect(el._state.ry).toBeCloseTo(4, 6);
  });

  it('non-vacuous: a NON-uniform (side-handle) scale is excluded by the native branch — falls through to the fallback instead of wrongly staying a circle', () => {
    const el = mockCircleEl({ cx: 0, cy: 0, r: 1 });
    el.parent = () => null; // real SVG.js: null for a detached/unmocked element
    const nonUniform = { a: 2, b: 0, c: 0, d: 5, e: 0, f: 0 };
    // The fallback bails cleanly on a missing parent (bakeMatrixIntoElement's
    // own `if (!parent) return false`) WITHOUT needing a real SVG.js — which
    // is exactly what proves this reached the fallback at all: had the
    // native branch wrongly accepted a non-uniform matrix, it would have
    // returned true and rewritten r/cx/cy, never calling .parent() at all.
    expect(bakeMatrixIntoElement(el, nonUniform)).toBe(false);
    expect(el._state.r).toBe(1); // untouched — native branch never ran
  });
});

describe('renderTransformHandles: single-selection handle placement', () => {
  function mockHandleLayer() {
    const shape = () => ({ move: () => shape(), fill: () => shape(), stroke: () => shape(), attr: () => shape(), center: () => shape() });
    return { rect: () => shape(), line: () => shape(), circle: () => shape() };
  }

  it('an unrotated element: handle world positions match its plain bbox (unchanged from the pre-SE7s world-AABB behaviour)', () => {
    const el = mockRectEl({ x: 0, y: 0, width: 4, height: 2 });
    const editor = mockEditor([el], { _handleLayer: mockHandleLayer() });
    const records = renderTransformHandles(editor);
    const e = records.find((r) => r.id === 'e');
    expect(e).toMatchObject({ hx: 4, hy: 1, ax: 0, ay: 1 });
  });

  it('a 30°-rotated element: handles sit on its OWN rotated corners, not the world-AABB', () => {
    const rad = (30 * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const m = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
    const el = mockRectEl({ x: 0, y: 0, width: 4, height: 2 }, m);
    const editor = mockEditor([el], { _handleLayer: mockHandleLayer() });
    const records = renderTransformHandles(editor);
    const e = records.find((r) => r.id === 'e');
    // Local handle (4,1) mapped through the 30° rotation.
    expect(e.hx).toBeCloseTo(cos * 4 - sin * 1, 9);
    expect(e.hy).toBeCloseTo(sin * 4 + cos * 1, 9);
  });
});

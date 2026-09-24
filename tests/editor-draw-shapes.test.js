/**
 * SE8c / SA-DECL-1 — DRAW_SHAPES (editor-interaction.js): the per-tool
 * create/update table that replaced createDrawingShape/updateDrawingShape's
 * if/else chains. Tested directly against a minimal chainable mock of the
 * svg.js shape wrapper (fill/stroke/attr/move/size/center/radius, each
 * recording into one `_state` object like editor-nodes.test.js's
 * mockAttrEl) — no real svg.js/DOM needed, since create()/update() only
 * ever call chainable setter methods on whatever editor._sketchLayer.X()
 * returns.
 */
import { describe, it, expect } from 'vitest';
import { DRAW_SHAPES } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-interaction.js';

function mockChainableEl(kind) {
  const state = { kind };
  const wrapper = {
    fill: (v) => { state.fill = v; return wrapper; },
    stroke: (v) => { state.stroke = v; return wrapper; },
    move: (x, y) => { state.x = x; state.y = y; return wrapper; },
    size: (w, h) => { state.width = w; state.height = h; return wrapper; },
    center: (x, y) => { state.cx = x; state.cy = y; return wrapper; },
    radius: (r) => { state.r = r; return wrapper; },
    attr(a, b) {
      if (arguments.length === 1) {
        if (typeof a === 'string') return state[a];
        Object.assign(state, a);
        return wrapper;
      }
      state[a] = b;
      return wrapper;
    },
    _state: state,
  };
  return wrapper;
}

function mockSketchLayer() {
  const created = [];
  return {
    _created: created,
    path: (d) => { const el = mockChainableEl('path'); el._state.d = d; created.push(el); return el; },
    line: (x1, y1, x2, y2) => {
      const el = mockChainableEl('line');
      Object.assign(el._state, { x1, y1, x2, y2 });
      created.push(el);
      return el;
    },
    rect: (w, h) => { const el = mockChainableEl('rect'); Object.assign(el._state, { width: w, height: h }); created.push(el); return el; },
    circle: (r) => { const el = mockChainableEl('circle'); el._state.r = r; created.push(el); return el; },
  };
}

function mockEditor() {
  return { _sketchLayer: mockSketchLayer(), _points: [] };
}

const STYLE = {
  stroke: { color: '#123456', width: 0.5 },
  fillForShape: '#abcdef',
  strokeForShape: { color: '#123456', width: 0.5 },
};

describe('DRAW_SHAPES: table shape', () => {
  it('has exactly the 4 drawing tools, each with a create and an update function', () => {
    expect(Object.keys(DRAW_SHAPES).sort()).toEqual(['circle', 'draw', 'line', 'rect']);
    for (const entry of Object.values(DRAW_SHAPES)) {
      expect(typeof entry.create).toBe('function');
      expect(typeof entry.update).toBe('function');
    }
  });
});

describe('DRAW_SHAPES.line', () => {
  it('create: a zero-length line at the start point, stroked with linecap round', () => {
    const editor = mockEditor();
    const el = DRAW_SHAPES.line.create(editor, { x: 1, y: 2 }, STYLE);
    expect(el._state).toMatchObject({ x1: 1, y1: 2, x2: 1, y2: 2 });
    expect(el._state.stroke).toMatchObject({ color: '#123456', width: 0.5, linecap: 'round' });
  });

  it('update: moves only the end point (x2/y2) — x1/y1 stay at the start', () => {
    const editor = mockEditor();
    const el = DRAW_SHAPES.line.create(editor, { x: 1, y: 2 }, STYLE);
    DRAW_SHAPES.line.update(editor, el, { x: 9, y: 9 });
    expect(el._state).toMatchObject({ x1: 1, y1: 2, x2: 9, y2: 9 });
  });
});

describe('DRAW_SHAPES.rect', () => {
  it('update: normalizes a drag in any direction to a positive-size rect pinned at the min corner', () => {
    const editor = mockEditor();
    const el = DRAW_SHAPES.rect.create(editor, { x: 0, y: 0 }, STYLE);
    DRAW_SHAPES.rect.update(editor, el, { x: -3, y: 4 }, [0, 0]); // dragged up-left/down mixed
    expect(el._state).toMatchObject({ x: -3, y: 0, width: 3, height: 4 });
  });
});

describe('DRAW_SHAPES.circle', () => {
  it('update: radius is the distance from the start (center) to the current point', () => {
    const editor = mockEditor();
    const el = DRAW_SHAPES.circle.create(editor, { x: 0, y: 0 }, STYLE);
    DRAW_SHAPES.circle.update(editor, el, { x: 3, y: 4 }, [0, 0]); // 3-4-5 triangle
    expect(el._state.r).toBeCloseTo(5, 10);
  });
});

describe('DRAW_SHAPES.draw', () => {
  it('create: a path starting at the first point', () => {
    const editor = mockEditor();
    const el = DRAW_SHAPES.draw.create(editor, { x: 1, y: 1 }, STYLE);
    expect(el._state.d).toBe('M 1 1');
  });

  it('update: appends an L segment to the path AND pushes the point onto editor._points (the only DRAW_SHAPES entry that touches editor state directly)', () => {
    const editor = mockEditor();
    editor._points = [[1, 1]];
    const el = DRAW_SHAPES.draw.create(editor, { x: 1, y: 1 }, STYLE);
    DRAW_SHAPES.draw.update(editor, el, { x: 2, y: 3 });
    expect(el._state.d).toBe('M 1 1 L 2 3');
    expect(editor._points).toEqual([[1, 1], [2, 3]]);
  });
});

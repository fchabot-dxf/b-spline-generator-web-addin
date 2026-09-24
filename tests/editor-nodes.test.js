/**
 * SE7n — the node model getNodes returns: `{ x, y, set(localPt) }` per
 * node, x/y in WORLD space, set() closing over the real mutation (a line's
 * x1/y1 vs x2/y2, a polyline/polygon array index, a path's REAL segment
 * index — built in the SAME loop that walks el.array() so it can never
 * disagree with what set() writes — a rect's opposite-corner pin, or a
 * circle/ellipse centre).
 *
 * dragNode itself (editor-interaction.js) isn't exported — it's two
 * composed pieces: transformPoint(el.matrix().inverse(), worldPt) (from
 * editor-coords.js, exported and tested directly) feeding a node's set().
 * Test (a) below exercises that exact composition, matching what dragNode
 * actually does line for line, without needing dragNode itself exported.
 *
 * Mock elements provide only what getNodes/set() touch: type, attr()
 * (dual getter/setter, like svg.js), array()/plot() where relevant, and
 * matrix() (null = identity; an object with its own inverse() where a
 * test needs a real transform).
 */
import { describe, it, expect } from 'vitest';
import { getNodes } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-hit.js';
import { transformPoint } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-coords.js';

function mockAttrEl(type, attrs, matrix = null) {
  const state = { ...attrs };
  return {
    type,
    attr(arg) {
      if (typeof arg === 'string') return state[arg];
      Object.assign(state, arg);
      return this;
    },
    matrix: () => matrix,
    _state: state,
  };
}

function mockPathEl(segments, matrix = null) {
  let arr = segments.map((s) => [...s]);
  return {
    type: 'path',
    array: () => arr,
    plot: (newArr) => { arr = newArr; },
    matrix: () => matrix,
  };
}

function mockArrayEl(type, points, matrix = null) {
  let arr = points.map((p) => [...p]);
  return {
    type,
    array: () => arr,
    plot: (newArr) => { arr = newArr; },
    matrix: () => matrix,
  };
}

describe('getNodes: line', () => {
  it('(a) with translate(1,0): setting the world point (5,5) writes local (4,5)', () => {
    const matrix = { a: 1, b: 0, c: 0, d: 1, e: 1, f: 0 }; // translate(1,0)
    const inverse = { a: 1, b: 0, c: 0, d: 1, e: -1, f: 0 }; // its inverse
    const matrixWithInverse = { ...matrix, inverse: () => inverse };
    const el = mockAttrEl('line', { x1: 0, y1: 0, x2: 3, y2: 3 }, matrixWithInverse);

    const nodes = getNodes(el);
    // Sanity: getNodes' own forward mapping reports WORLD, not local.
    expect(nodes[0]).toMatchObject({ x: 1, y: 0 }); // local (0,0) + translate(1,0)

    // This is exactly what dragNode does: map the WORLD pointer into
    // local space via the inverse, then hand it to the cached node's set().
    const local = transformPoint(el.matrix().inverse(), { x: 5, y: 5 });
    expect(local).toEqual({ x: 4, y: 5 });
    nodes[0].set(local);
    expect(el._state.x1).toBe(4);
    expect(el._state.y1).toBe(5);
  });

  it('the second node (index 1) writes x2/y2, not x1/y1', () => {
    const el = mockAttrEl('line', { x1: 0, y1: 0, x2: 3, y2: 3 });
    const nodes = getNodes(el);
    nodes[1].set({ x: 9, y: 9 });
    expect(el._state).toMatchObject({ x1: 0, y1: 0, x2: 9, y2: 9 });
  });
});

describe('getNodes: path', () => {
  it('(b) M0 0 L1 0 Z M2 2 L3 3 — node 3 edits the "L 3 3" segment, not the Z', () => {
    const el = mockPathEl([
      ['M', 0, 0],
      ['L', 1, 0],
      ['Z'],
      ['M', 2, 2],
      ['L', 3, 3],
    ]);
    const nodes = getNodes(el);
    // Z contributes no node: M, L, M, L -> 4 nodes from 5 segments.
    expect(nodes).toHaveLength(4);
    expect(nodes[3]).toMatchObject({ x: 3, y: 3 });

    nodes[3].set({ x: 30, y: 30 });
    const arr = el.array();
    expect(arr[4]).toEqual(['L', 30, 30]); // the REAL segment index (4), not 2
    expect(arr[2]).toEqual(['Z']);          // the Z itself is untouched
  });

  it('(e) H/V: the endpoint keeps the OTHER coordinate from the previous point', () => {
    const el = mockPathEl([
      ['M', 0, 0],
      ['H', 5], // horizontal to x=5 — y inherited (0)
      ['V', 3], // vertical to y=3 — x inherited (5)
    ]);
    const nodes = getNodes(el);
    expect(nodes).toHaveLength(3);
    expect(nodes[0]).toMatchObject({ x: 0, y: 0 });
    expect(nodes[1]).toMatchObject({ x: 5, y: 0 });
    expect(nodes[2]).toMatchObject({ x: 5, y: 3 });

    // H is 1-DOF: only x can move. A set() implying a y-change is ignored
    // rather than silently corrupting the segment shape.
    nodes[1].set({ x: 8, y: 99 });
    expect(el.array()[1]).toEqual(['H', 8]);
  });

  it('C/Q/A/S/T each contribute exactly one node, at their real end point', () => {
    const el = mockPathEl([
      ['M', 0, 0],
      ['C', 1, 1, 2, 2, 3, 3],       // cubic, end (3,3)
      ['Q', 4, 4, 5, 5],             // quadratic, end (5,5)
      ['A', 1, 1, 0, 0, 1, 6, 6],    // arc, end (6,6)
      ['S', 7, 7, 8, 8],             // smooth cubic, end (8,8)
      ['T', 9, 9],                   // smooth quadratic, end (9,9)
    ]);
    const nodes = getNodes(el);
    expect(nodes.map((n) => [n.x, n.y])).toEqual([
      [0, 0], [3, 3], [5, 5], [6, 6], [8, 8], [9, 9],
    ]);

    nodes[3].set({ x: 60, y: 61 }); // the A node
    expect(el.array()[3]).toEqual(['A', 1, 1, 0, 0, 1, 60, 61]);
  });
});

describe('getNodes: rect', () => {
  it('(d) dragging a corner pins the OPPOSITE corner and normalises negative size positive', () => {
    const el = mockAttrEl('rect', { x: 0, y: 0, width: 4, height: 2 });
    const nodes = getNodes(el);
    expect(nodes).toHaveLength(4);
    expect(nodes[0]).toMatchObject({ x: 0, y: 0 }); // top-left; opposite = bottom-right (4,2)

    // Drag the top-left corner PAST the opposite corner.
    nodes[0].set({ x: 6, y: 5 });
    expect(el._state).toEqual({ x: 4, y: 2, width: 2, height: 3 });
  });

  it('the opposite corner stays pinned to where the drag STARTED, not the shrinking rect', () => {
    const el = mockAttrEl('rect', { x: 0, y: 0, width: 4, height: 2 });
    const nodes = getNodes(el); // captured once, like a real drag gesture
    nodes[0].set({ x: 1, y: 1 });  // first move
    nodes[0].set({ x: 2, y: 1.5 }); // second move — same cached node/closure
    // Opposite corner (4,2) must still be the pin, not re-derived from the
    // rect's state after the first move.
    expect(el._state).toEqual({ x: 2, y: 1.5, width: 2, height: 0.5 });
  });
});

describe('getNodes: circle/ellipse', () => {
  it('(c) circle centre set moves cx/cy', () => {
    const el = mockAttrEl('circle', { cx: 1, cy: 2, r: 0.5 });
    const nodes = getNodes(el);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ x: 1, y: 2 });
    nodes[0].set({ x: 5, y: 6 });
    expect(el._state).toMatchObject({ cx: 5, cy: 6, r: 0.5 }); // radius untouched (SE7s)
  });
});

describe('getNodes: polyline/polygon', () => {
  it('setting a node writes that array index and re-plots', () => {
    const el = mockArrayEl('polyline', [[0, 0], [1, 1], [2, 2]]);
    const nodes = getNodes(el);
    expect(nodes).toHaveLength(3);
    nodes[1].set({ x: 9, y: 9 });
    expect(el.array()).toEqual([[0, 0], [9, 9], [2, 2]]);
  });
});

/**
 * SE7a — the Lattice tool (editor/editor-lattice.js).
 *
 * toLattice/fromLattice/classifyDrag/constrain/latticeCrossings are pure
 * (no svg.js/DOM) and unit-tested directly here, matching editor-view.js's
 * and editor-grid.js's own split between pure math and DOM-touching code.
 * emitNode/findNodeAt (DOM-touching) get a lightweight mock sketch layer,
 * same shape as editor-grid.test.js's mockGridLayer for applyGrid.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  LATTICE_DEFAULTS,
  DEFAULT_NODE_RADIUS_IN,
  toLattice,
  fromLattice,
  classifyDrag,
  constrain,
  latticeCrossings,
  findNodeAt,
  emitNode,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice.js';

describe('toLattice / fromLattice', () => {
  it('round-trips a point that already sits on the lattice', () => {
    const spacing = 0.25;
    const p = { x: 1.25, y: -0.5 };
    expect(fromLattice(toLattice(p, spacing), spacing)).toEqual(p);
  });

  it('rounds an off-lattice point to the nearest cell', () => {
    expect(toLattice({ x: 0.61, y: -0.4 }, 0.25)).toEqual({ i: 2, j: -2 });
  });
});

describe('classifyDrag', () => {
  it('is "node" when start and end are the same cell (a bare click)', () => {
    expect(classifyDrag({ i: 3, j: 5 }, { i: 3, j: 5 })).toBe('node');
  });

  it('is "rail" when the horizontal step dominates', () => {
    expect(classifyDrag({ i: 0, j: 0 }, { i: 4, j: 1 })).toBe('rail');
  });

  it('is "tie" when the vertical step dominates', () => {
    expect(classifyDrag({ i: 0, j: 0 }, { i: 1, j: 4 })).toBe('tie');
  });

  it('resolves an exact diagonal drag to the dominant axis via the >= tie-break (rail)', () => {
    // |di| === |dj| — classifyDrag's own tie-break (>=) picks rail.
    expect(classifyDrag({ i: 0, j: 0 }, { i: 3, j: 3 })).toBe('rail');
  });
});

describe('constrain', () => {
  it('keeps the dominant (rail) coordinate and locks the other to the start row', () => {
    expect(constrain({ i: 2, j: 2 }, { i: 6, j: 3 })).toEqual({ i: 6, j: 2 });
  });

  it('keeps the dominant (tie) coordinate and locks the other to the start column', () => {
    expect(constrain({ i: 2, j: 2 }, { i: 3, j: 7 })).toEqual({ i: 2, j: 7 });
  });
});

describe('latticeCrossings', () => {
  it('a tie crossing two rails yields 2 crossings + 2 endpoints, no duplicates', () => {
    // Tie runs from (5,0) to (5,10) — a vertical column.
    const tie = { kind: 'tie', a: { i: 5, j: 0 }, b: { i: 5, j: 10 } };
    // Two rails crossing it at j=2 and j=7, each spanning i=0..10.
    const rail1 = { kind: 'rail', a: { i: 0, j: 2 }, b: { i: 10, j: 2 } };
    const rail2 = { kind: 'rail', a: { i: 0, j: 7 }, b: { i: 10, j: 7 } };

    const result = latticeCrossings(tie, [rail1, rail2]);

    expect(result).toHaveLength(4);
    expect(result).toContainEqual({ i: 5, j: 0 });   // own endpoint
    expect(result).toContainEqual({ i: 5, j: 10 });  // own endpoint
    expect(result).toContainEqual({ i: 5, j: 2 });   // crossing with rail1
    expect(result).toContainEqual({ i: 5, j: 7 });   // crossing with rail2
  });

  it('ignores segments of the SAME kind (rail x rail never crosses at a lattice point here)', () => {
    const railA = { kind: 'rail', a: { i: 0, j: 0 }, b: { i: 10, j: 0 } };
    const railB = { kind: 'rail', a: { i: 0, j: 0 }, b: { i: 10, j: 5 } }; // not axis-aligned, but same kind anyway
    const result = latticeCrossings(railA, [railB]);
    expect(result).toEqual([{ i: 0, j: 0 }, { i: 10, j: 0 }]); // just its own endpoints
  });

  it('does not double-count a crossing that lands exactly on one of the segment\'s own endpoints', () => {
    const tie = { kind: 'tie', a: { i: 5, j: 0 }, b: { i: 5, j: 10 } };
    const rail = { kind: 'rail', a: { i: 0, j: 0 }, b: { i: 10, j: 0 } }; // crosses tie at (5,0) = tie's own endpoint
    const result = latticeCrossings(tie, [rail]);
    expect(result).toEqual([{ i: 5, j: 0 }, { i: 5, j: 10 }]); // deduped, not 3
  });

  it('excludes a rail that does not actually reach the tie\'s column', () => {
    const tie = { kind: 'tie', a: { i: 5, j: 0 }, b: { i: 5, j: 10 } };
    const shortRail = { kind: 'rail', a: { i: 0, j: 3 }, b: { i: 4, j: 3 } }; // stops at i=4, tie is at i=5
    const result = latticeCrossings(tie, [shortRail]);
    expect(result).toEqual([{ i: 5, j: 0 }, { i: 5, j: 10 }]);
  });
});

function mockSketchLayer(nodeCircles) {
  const children = nodeCircles.map((c) => ({
    node: {
      getAttribute(name) {
        if (name === 'data-lattice') return 'node';
        if (name === 'cx') return String(c.x);
        if (name === 'cy') return String(c.y);
        return null;
      },
    },
  }));
  return { children: () => ({ toArray: () => children }) };
}

describe('findNodeAt', () => {
  it('finds an existing node at the same lattice cell', () => {
    const editor = { _grid: { spacing: 0.25 }, _sketchLayer: mockSketchLayer([{ x: 1.0, y: 0.5 }]) };
    expect(findNodeAt(editor, { x: 1.0, y: 0.5 })).not.toBeNull();
  });

  it('returns null when no node sits at that cell', () => {
    const editor = { _grid: { spacing: 0.25 }, _sketchLayer: mockSketchLayer([{ x: 1.0, y: 0.5 }]) };
    expect(findNodeAt(editor, { x: 2.0, y: 0.5 })).toBeNull();
  });
});

function mockEditorForEmit(nodeCircles = []) {
  const emitted = [];
  const chain = {
    center() { return chain; },
    fill() { return chain; },
    stroke() { return chain; },
    attr(k, v) { emitted.push([k, v]); return chain; },
  };
  const sketchLayer = mockSketchLayer(nodeCircles);
  sketchLayer.circle = () => chain;
  return {
    editor: {
      _grid: { visible: true, snap: false, spacing: 0.25 },
      _lattice: { ...LATTICE_DEFAULTS },
      _sketchLayer: sketchLayer,
      _layers: [{ id: '0' }],
      _activeLayer: '0',
      _strokeColor: '#000',
      _fillColor: '#000',
    },
    emitted,
  };
}

describe('emitNode', () => {
  it('does not emit (returns null) when a node already sits at that lattice cell', () => {
    const { editor } = mockEditorForEmit([{ x: 1.0, y: 0.5 }]);
    expect(emitNode(editor, { x: 1.0, y: 0.5 })).toBeNull();
  });

  it('emits when the cell is empty', () => {
    const { editor } = mockEditorForEmit([]);
    expect(emitNode(editor, { x: 1.0, y: 0.5 })).not.toBeNull();
  });

  it('uses DEFAULT_NODE_RADIUS_IN\'s declared value as the off-grid fallback (sanity: it is a small positive inch value)', () => {
    expect(DEFAULT_NODE_RADIUS_IN).toBeGreaterThan(0);
    expect(DEFAULT_NODE_RADIUS_IN).toBeLessThan(0.5);
  });
});

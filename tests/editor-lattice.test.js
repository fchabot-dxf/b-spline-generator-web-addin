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
  LATTICE_STYLE,
  DEFAULT_NODE_RADIUS_IN,
  toLattice,
  fromLattice,
  classifyDrag,
  constrain,
  latticeCrossings,
  nearestRailRow,
  findNodeAt,
  emitNode,
  emitSegment,
  ORIENTATIONS,
  orient,
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

/**
 * SE7h (Fred: "invert rails and ties so rails are vertical") — orient()
 * is the ONE mapping every lattice consumer (computePattern, editor-
 * interaction.js's hand tool) conjugates through: transpose into the
 * canonical (horizontal) frame, run the existing algorithm unchanged,
 * transpose the result back out. Self-inverse by construction (swapping
 * i/j twice is the identity) — proven directly here, since every caller
 * relies on that property to use ONE function for both directions.
 */
describe('orient (SE7h)', () => {
  it('declares exactly the two orientations', () => {
    expect(ORIENTATIONS).toEqual(['horizontal', 'vertical']);
  });

  it('horizontal is the identity', () => {
    expect(orient({ i: 3, j: 7 }, 'horizontal')).toEqual({ i: 3, j: 7 });
  });

  it('vertical swaps i and j', () => {
    expect(orient({ i: 3, j: 7 }, 'vertical')).toEqual({ i: 7, j: 3 });
  });

  it('is self-inverse for vertical (applying it twice returns the original point)', () => {
    const p = { i: 2, j: -5 };
    expect(orient(orient(p, 'vertical'), 'vertical')).toEqual(p);
  });

  it('non-vacuous: a point with i !== j actually changes under vertical (rules out an identity-in-disguise bug)', () => {
    const p = { i: 1, j: 9 };
    expect(orient(p, 'vertical')).not.toEqual(p);
  });
});

/**
 * SE7h: the exact conjugation pattern editor-interaction.js's hand tool
 * uses (orient the two drag points in, run classifyDrag/constrain
 * UNCHANGED, orient the result back out) — proven here as a pure
 * composition, independent of the DOM/pointer-event plumbing that
 * actually drives it (editor-interaction.js has no exported hook for a
 * lighter-weight test; this validates the MATH the hand tool's
 * `update`/`finish` handlers apply verbatim, which is what SE7h actually
 * changed there).
 */
describe('orient() composed with classifyDrag/constrain (the hand-tool pattern, SE7h)', () => {
  function classifyOriented(a, b, orientation) {
    return classifyDrag(orient(a, orientation), orient(b, orientation));
  }
  function constrainOriented(a, b, orientation) {
    const aC = orient(a, orientation), bC = orient(b, orientation);
    return orient(constrain(aC, bC), orientation);
  }

  it('a horizontally-dominant drag (rail today) classifies as a TIE once vertical is the rail axis', () => {
    const a = { i: 0, j: 0 }, b = { i: 4, j: 1 }; // classifyDrag(a,b) === 'rail' in horizontal
    expect(classifyDrag(a, b)).toBe('rail'); // sanity on the un-oriented baseline
    expect(classifyOriented(a, b, 'vertical')).toBe('tie');
  });

  it('a vertically-dominant drag (tie today) classifies as a RAIL once vertical is the rail axis', () => {
    const a = { i: 0, j: 0 }, b = { i: 1, j: 4 };
    expect(classifyDrag(a, b)).toBe('tie');
    expect(classifyOriented(a, b, 'vertical')).toBe('rail');
  });

  it('horizontal orientation reproduces classifyDrag exactly (identity — no behavior change for the default)', () => {
    const a = { i: 0, j: 0 }, b = { i: 4, j: 1 };
    expect(classifyOriented(a, b, 'horizontal')).toBe(classifyDrag(a, b));
  });

  it('constrainOriented reproduces plain constrain exactly under horizontal', () => {
    const a = { i: 2, j: 2 }, b = { i: 6, j: 3 };
    expect(constrainOriented(a, b, 'horizontal')).toEqual(constrain(a, b));
  });

  it('constrainOriented under vertical locks the dominant REAL-vertical drag onto a straight vertical line (constant real-i)', () => {
    // A drag mostly along j (vertical on screen) is now the RAIL-shaped
    // one; the constrained endpoint must share the START's real i
    // (a straight vertical line), not its j.
    const a = { i: 3, j: 0 }, b = { i: 3, j: 8 };
    const result = constrainOriented(a, b, 'vertical');
    expect(result.i).toBe(a.i); // straight vertical line: constant i
  });
});

describe('nearestRailRow (T30)', () => {
  it('returns the exact row when j already sits on a rail', () => {
    expect(nearestRailRow(4, [0, 2, 4, 6], 1)).toBe(4);
  });

  it('snaps to the nearest rail within `within` rows', () => {
    expect(nearestRailRow(5, [0, 4, 9], 1)).toBe(4);
    expect(nearestRailRow(8, [0, 4, 9], 1)).toBe(9);
  });

  it('returns null when nothing is within `within` rows', () => {
    expect(nearestRailRow(5, [0, 20], 1)).toBeNull();
  });

  it('breaks a tie toward whichever candidate is scanned first (deterministic, not order-dependent by chance)', () => {
    // j=5 is equidistant (2) from both 3 and 7 — the FIRST-seen strictly-
    // closer row wins (`d < bestDist`, not `<=`), so the array's own order
    // decides, not incidentally correct output.
    expect(nearestRailRow(5, [3, 7], 2)).toBe(3);
    expect(nearestRailRow(5, [7, 3], 2)).toBe(7);
  });

  it('`within:0` turns snapping off even for an exact-row match', () => {
    expect(nearestRailRow(4, [4], 0)).toBeNull();
  });

  it('no rails at all -> null, regardless of `within`', () => {
    expect(nearestRailRow(4, [], 5)).toBeNull();
    expect(nearestRailRow(4, null, 5)).toBeNull();
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
    // Only present when a test needs a real transform — worldPoint()
    // degrades to identity when .matrix isn't a function, so omitting
    // this leaves every pre-existing test's raw cx/cy == world position.
    ...(c.matrix ? { matrix: () => c.matrix } : {}),
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

  it('SE7n: compares the WORLD position, not the raw cx/cy — a node dragged with Select (transform="translate(...)") is still matched', () => {
    // Raw cx/cy say (0,0); a translate(1,0.5) puts its REAL position at
    // (1,0.5). The pre-SE7n code compared the raw attribute directly and
    // would have missed this — matched here only because findNodeAt now
    // bakes the transform in via worldPoint before converting to lattice.
    const editor = {
      _grid: { spacing: 0.25 },
      _sketchLayer: mockSketchLayer([{ x: 0, y: 0, matrix: { a: 1, b: 0, c: 0, d: 1, e: 1, f: 0.5 } }]),
    };
    expect(findNodeAt(editor, { x: 1.0, y: 0.5 })).not.toBeNull();
    // And it does NOT match its own stale raw position any more.
    expect(findNodeAt(editor, { x: 0, y: 0 })).toBeNull();
  });
});

function mockEditorForEmit(nodeCircles = [], gridSpacing = 0.25) {
  const emitted = [];
  const calls = { stroke: [], circle: [], line: [] };
  const chain = {
    center() { return chain; },
    fill() { return chain; },
    stroke(arg) { calls.stroke.push(arg); return chain; },
    attr(k, v) { emitted.push([k, v]); return chain; },
  };
  const sketchLayer = mockSketchLayer(nodeCircles);
  sketchLayer.circle = (d) => { calls.circle.push(d); return chain; };
  sketchLayer.line = (...args) => { calls.line.push(args); return chain; };
  return {
    editor: {
      _grid: { visible: true, snap: false, spacing: gridSpacing },
      _lattice: { ...LATTICE_DEFAULTS },
      _sketchLayer: sketchLayer,
      _layers: [{ id: '0' }],
      _activeLayer: '0',
      _color: '#000',
    },
    emitted,
    calls,
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

  it('SE7c: radius is LATTICE_STYLE.node.radiusFactor x grid spacing, not a hand-tuned constant', () => {
    const { editor, calls } = mockEditorForEmit([], 0.25);
    emitNode(editor, { x: 1.0, y: 0.5 });
    expect(calls.circle[0]).toBeCloseTo(2 * LATTICE_STYLE.node.radiusFactor * 0.25, 10); // circle(d) — d = 2r
  });

  it('SE7c: radius scales with grid spacing (a different spacing gives a proportionally different radius)', () => {
    const { editor, calls } = mockEditorForEmit([], 0.5);
    emitNode(editor, { x: 1.0, y: 0.5 });
    expect(calls.circle[0]).toBeCloseTo(2 * LATTICE_STYLE.node.radiusFactor * 0.5, 10);
  });

  it('off-grid (grid not visible) still falls back to DEFAULT_NODE_RADIUS_IN, unchanged by SE7c', () => {
    const { editor, calls } = mockEditorForEmit([], 0.25);
    editor._grid.visible = false;
    emitNode(editor, { x: 1.0, y: 0.5 });
    expect(calls.circle[0]).toBeCloseTo(2 * DEFAULT_NODE_RADIUS_IN, 10);
  });
});

describe('emitSegment (SE7c)', () => {
  it('a rail\'s stroke-width is LATTICE_STYLE.rail.widthFactor x grid spacing, not editor._strokeWidth', () => {
    const { editor, calls } = mockEditorForEmit([], 0.25);
    editor._strokeWidth = 0.5; // the general drawing-tool setting — must NOT be what rails use
    emitSegment(editor, 'rail', { x: 0, y: 0 }, { x: 1, y: 0 });
    expect(calls.line).toEqual([[0, 0, 1, 0]]);
    expect(calls.stroke[0].width).toBeCloseTo(LATTICE_STYLE.rail.widthFactor * 0.25, 10);
    expect(calls.stroke[0].width).not.toBe(0.5);
  });

  it('a tie uses its OWN (narrower) widthFactor, independent of the rail\'s', () => {
    const { editor, calls } = mockEditorForEmit([], 0.25);
    emitSegment(editor, 'tie', { x: 0, y: 0 }, { x: 0, y: 1 });
    expect(calls.stroke[0].width).toBeCloseTo(LATTICE_STYLE.tie.widthFactor * 0.25, 10);
    expect(LATTICE_STYLE.tie.widthFactor).toBeLessThan(LATTICE_STYLE.rail.widthFactor); // ties read visually lighter than rails
  });

  it('width scales with grid spacing, same proportion', () => {
    const { editor, calls } = mockEditorForEmit([], 1.0);
    emitSegment(editor, 'rail', { x: 0, y: 0 }, { x: 1, y: 0 });
    expect(calls.stroke[0].width).toBeCloseTo(LATTICE_STYLE.rail.widthFactor * 1.0, 10);
  });
});

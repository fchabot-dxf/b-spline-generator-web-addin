/**
 * SE7a — the Lattice tool (editor/editor-lattice.js).
 *
 * toLattice/fromLattice/constrainToKind/latticeCrossings are pure (no
 * svg.js/DOM) and unit-tested directly here, matching editor-view.js's
 * and editor-grid.js's own split between pure math and DOM-touching code.
 * emitNode/findNodeAt (DOM-touching) get a lightweight mock sketch layer,
 * same shape as editor-grid.test.js's mockGridLayer for applyGrid.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  LATTICE_DEFAULTS,
  LATTICE_STYLE,
  LATTICE_DRAW_KINDS,
  DEFAULT_NODE_RADIUS_IN,
  toLattice,
  fromLattice,
  constrainToKind,
  latticeCrossings,
  nearestRailRow,
  findNodeAt,
  emitNode,
  emitSegment,
  ORIENTATIONS,
  orient,
  isLatticePoint,
  moveRailAlongAxis,
  translateTie,
  toLatticeFractional,
  nearestEndWithin,
  stretchRailEnd,
  stretchTieEnd,
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

describe('LATTICE_DRAW_KINDS (SE7k, declared table)', () => {
  it('declares exactly rail, tie, node, in that order, each with a label and a hint', () => {
    expect(LATTICE_DRAW_KINDS.map((k) => k.value)).toEqual(['rail', 'tie', 'node']);
    for (const k of LATTICE_DRAW_KINDS) {
      expect(typeof k.label).toBe('string');
      expect(k.label.length).toBeGreaterThan(0);
      expect(typeof k.hint).toBe('string');
      expect(k.hint.length).toBeGreaterThan(0);
    }
  });

  it('select is the default drawKind (LATTICE_DEFAULTS) -- UI3 AMEND 1', () => {
    expect(LATTICE_DEFAULTS.drawKind).toBe('select');
  });
});

describe('constrainToKind (SE7k — replaces classifyDrag+constrain\'s direction guessing)', () => {
  it('rail: locks j to a\'s row, frees i to b\'s — regardless of which way the drag actually moved', () => {
    expect(constrainToKind({ i: 2, j: 2 }, { i: 6, j: 3 }, 'rail')).toEqual({ i: 6, j: 2 });
    // A drag that moves MOSTLY vertically still comes out as a rail —
    // the old constrain() would have picked 'tie' here by dominant axis;
    // constrainToKind never looks at the drag's shape at all.
    expect(constrainToKind({ i: 2, j: 2 }, { i: 3, j: 9 }, 'rail')).toEqual({ i: 3, j: 2 });
  });

  it('tie: locks i to a\'s column, frees j to b\'s — regardless of drag direction', () => {
    expect(constrainToKind({ i: 2, j: 2 }, { i: 3, j: 7 }, 'tie')).toEqual({ i: 2, j: 7 });
    // A drag that moves MOSTLY horizontally still comes out as a tie.
    expect(constrainToKind({ i: 2, j: 2 }, { i: 9, j: 3 }, 'tie')).toEqual({ i: 2, j: 3 });
  });

  it('a === b (no movement) returns a\'s own row/column for either kind', () => {
    expect(constrainToKind({ i: 4, j: 4 }, { i: 4, j: 4 }, 'rail')).toEqual({ i: 4, j: 4 });
    expect(constrainToKind({ i: 4, j: 4 }, { i: 4, j: 4 }, 'tie')).toEqual({ i: 4, j: 4 });
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
 * SE7h/SE7k: the exact conjugation pattern editor-interaction.js's hand
 * tool uses (orient the two drag points in, run constrainToKind for the
 * EXPLICITLY chosen kind, orient the result back out) — proven here as a
 * pure composition, independent of the DOM/pointer-event plumbing that
 * actually drives it (editor-interaction.js has no exported hook for a
 * lighter-weight test; this validates the MATH the hand tool's
 * `update`/`finish` handlers apply verbatim). Covers the dispatch's own
 * "pure tests for each kind's constraint in both orientations."
 */
describe('orient() composed with constrainToKind (the hand-tool pattern, SE7h/SE7k)', () => {
  function constrainOriented(a, b, kind, orientation) {
    const aC = orient(a, orientation), bC = orient(b, orientation);
    return orient(constrainToKind(aC, bC, kind), orientation);
  }

  it('horizontal orientation reproduces plain constrainToKind exactly (identity — no behavior change for the default)', () => {
    const a = { i: 2, j: 2 }, b = { i: 6, j: 3 };
    expect(constrainOriented(a, b, 'rail', 'horizontal')).toEqual(constrainToKind(a, b, 'rail'));
    expect(constrainOriented(a, b, 'tie', 'horizontal')).toEqual(constrainToKind(a, b, 'tie'));
  });

  it('vertical orientation: a RAIL comes out as a straight vertical line (constant real-i), whichever way the drag moved', () => {
    // In vertical orientation a rail's own axis is the real column — the
    // constrained endpoint must share the START's real i, matching
    // _existingRailRows' own "row here means canonical-frame row — in
    // vertical orientation that's a real column" convention.
    const a = { i: 3, j: 0 }, b = { i: 7, j: 8 }; // a drag that moves in BOTH real axes
    const result = constrainOriented(a, b, 'rail', 'vertical');
    expect(result.i).toBe(a.i);
  });

  it('vertical orientation: a TIE comes out as a straight horizontal line (constant real-j), whichever way the drag moved', () => {
    const a = { i: 3, j: 0 }, b = { i: 7, j: 8 };
    const result = constrainOriented(a, b, 'tie', 'vertical');
    expect(result.j).toBe(a.j);
  });

  it('the SAME drag vector produces a rail under one explicit choice and a tie under the other — the kind is the input, not derived from the drag', () => {
    const a = { i: 0, j: 0 }, b = { i: 1, j: 9 }; // an almost-vertical-on-screen drag
    const asRail = constrainOriented(a, b, 'rail', 'horizontal');
    const asTie = constrainOriented(a, b, 'tie', 'horizontal');
    expect(asRail).toEqual({ i: 1, j: 0 }); // rail: j frozen, i free — even though the drag barely moved in i
    expect(asTie).toEqual({ i: 0, j: 9 });  // tie: i frozen, j free
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

/**
 * SE7i (connected editing, Section 3): the pure math behind "drag on an
 * existing piece moves it, structure-aware." Fred: "attach should mean
 * snapped to grid on the same point" — isLatticePoint is the exact-match
 * primitive that claim rests on.
 */
describe('isLatticePoint (SE7i)', () => {
  const spacing = 0.25;

  it('is true for a point exactly on a lattice cell', () => {
    expect(isLatticePoint({ x: 0.5, y: 0.75 }, spacing)).toBe(true);
    expect(isLatticePoint({ x: 0, y: 0 }, spacing)).toBe(true);
  });

  it('is false for a point off-grid by a real amount (an Alt-drag / Select nudge)', () => {
    expect(isLatticePoint({ x: 0.51, y: 0.75 }, spacing)).toBe(false);
    expect(isLatticePoint({ x: 0.5, y: 0.751 }, spacing)).toBe(false);
  });

  it('tolerates only genuine floating-point noise, not a generous snap range', () => {
    expect(isLatticePoint({ x: 0.5 + 1e-9, y: 0.75 - 1e-9 }, spacing)).toBe(true);
    expect(isLatticePoint({ x: 0.5 + 1e-3, y: 0.75 }, spacing)).toBe(false);
  });
});


describe('moveRailAlongAxis (SE7i): derive attachments + apply a rail move in one step', () => {
  const rail = { a: { i: 0, j: 4 }, b: { i: 10, j: 4 } };

  it('moves the rail itself to the new row, i-range unchanged (never slides along its own length)', () => {
    const result = moveRailAlongAxis(rail, 7, [], []);
    expect(result.rail).toEqual({ a: { i: 0, j: 7 }, b: { i: 10, j: 7 } });
  });

  it('stretches an attached tie: the attached end follows the new row, the OTHER end is untouched (length changes)', () => {
    const tie = { a: { i: 3, j: 4 }, b: { i: 3, j: 9 } }; // 'a' sits on the rail
    const result = moveRailAlongAxis(rail, 7, [tie], []);
    expect(result.tieUpdates).toEqual([{ tie, end: 'a', point: { i: 3, j: 7 } }]);
  });

  it('a tie end can be attached on EITHER side ("a" or "b") — the position along the rail (i) never changes', () => {
    const tieA = { a: { i: 2, j: 4 }, b: { i: 2, j: 1 } };
    const tieB = { a: { i: 8, j: 1 }, b: { i: 8, j: 4 } };
    const result = moveRailAlongAxis(rail, 6, [tieA, tieB], []);
    expect(result.tieUpdates).toEqual(expect.arrayContaining([
      { tie: tieA, end: 'a', point: { i: 2, j: 6 } },
      { tie: tieB, end: 'b', point: { i: 8, j: 6 } },
    ]));
  });

  it('a tie with NEITHER end on the rail is not touched at all', () => {
    const tie = { a: { i: 3, j: 2 }, b: { i: 3, j: 1 } };
    const result = moveRailAlongAxis(rail, 7, [tie], []);
    expect(result.tieUpdates).toHaveLength(0);
  });

  it('a tie end on the rail\'s ROW but beyond its i-RANGE is not attached', () => {
    const tie = { a: { i: 20, j: 4 }, b: { i: 20, j: 9 } };
    const result = moveRailAlongAxis(rail, 7, [tie], []);
    expect(result.tieUpdates).toHaveLength(0);
  });

  it('carries a node sitting on the rail along with it (rigidly — i unchanged, j follows)', () => {
    const node = { i: 5, j: 4 };
    const result = moveRailAlongAxis(rail, 7, [], [node]);
    expect(result.nodeUpdates).toEqual([{ node, point: { i: 5, j: 7 } }]);
  });

  it('accepts a node wrapped as {point} too (the DOM-touching caller\'s own record shape)', () => {
    const wrapped = { el: 'stand-in-for-a-real-element', point: { i: 5, j: 4 } };
    const result = moveRailAlongAxis(rail, 7, [], [wrapped]);
    expect(result.nodeUpdates).toEqual([{ node: wrapped, point: { i: 5, j: 7 } }]);
  });

  it('non-vacuous: a rail with NO attachments at all still moves itself, with empty update lists (not a crash)', () => {
    const result = moveRailAlongAxis(rail, 7, [], []);
    expect(result.rail).toBeDefined();
    expect(result.tieUpdates).toEqual([]);
    expect(result.nodeUpdates).toEqual([]);
  });

  it('is a pure re-derivation from the SAME start snapshot — calling it twice with different newRow values never mutates the inputs (attachments stay fixed at drag start)', () => {
    const tie = { a: { i: 3, j: 4 }, b: { i: 3, j: 9 } };
    const before = JSON.parse(JSON.stringify(rail));
    moveRailAlongAxis(rail, 7, [tie], []);
    moveRailAlongAxis(rail, 2, [tie], []);
    expect(rail).toEqual(before); // the rail snapshot itself is never mutated
    expect(tie.a).toEqual({ i: 3, j: 4 }); // neither is the tie's own recorded geometry
  });
});

describe('moveRailAlongAxis composed with orient() (the vertical-orientation mirror, SE7i)', () => {
  // Fred: "vice versa if I inverse the orientation" — with rails VERTICAL,
  // a rail's own axis (the thing it moves ACROSS) is the real-i column,
  // and ties run horizontally. Conjugating the SAME moveRailAlongAxis
  // through orient() (exactly the hand-tool's own established pattern)
  // must reproduce that mirror with zero new math.
  it('a vertical rail moving left/right (real-i) stretches a horizontal tie\'s length, never its width, and the tie slides up/down conceptually mapped through orient()', () => {
    const orientation = 'vertical';
    // Real geometry: a vertical rail at real-i=4, spanning real-j 0..10;
    // a horizontal tie whose real-i=4 end sits ON that rail at real-j=3.
    const railReal = { a: { i: 4, j: 0 }, b: { i: 4, j: 10 } };
    const tieReal = { a: { i: 4, j: 3 }, b: { i: 9, j: 3 } };

    const railCanon = { a: orient(railReal.a, orientation), b: orient(railReal.b, orientation) };
    const tieCanon = { a: orient(tieReal.a, orientation), b: orient(tieReal.b, orientation) };

    // Drag the rail to real-i=7 (a horizontal move for a vertical rail) —
    // in canonical frame that's the row (j) changing to 7.
    const result = moveRailAlongAxis(railCanon, 7, [tieCanon], []);

    // The tie's attached end (canonical 'a') moves to canonical j=7;
    // translated back through orient(), that's real-i=7 — the tie's
    // OTHER end (real-i=9) is untouched, so its LENGTH (real-i span)
    // changed, never its stroke width (this function never touches that
    // attribute at all).
    const update = result.tieUpdates[0];
    expect(update.end).toBe('a');
    const realPoint = orient(update.point, orientation);
    expect(realPoint).toEqual({ i: 7, j: 3 }); // real-i moved, real-j (3) unchanged — a horizontal tie stayed horizontal
  });
});

describe('translateTie (SE7i): rigid translation, not confined between rails', () => {
  it('moves both ends by the same delta, preserving the tie\'s shape and length', () => {
    const tie = { a: { i: 3, j: 1 }, b: { i: 3, j: 4 } };
    const moved = translateTie(tie, 2, -1);
    expect(moved).toEqual({ a: { i: 5, j: 0 }, b: { i: 5, j: 3 } });
    expect(moved.b.j - moved.a.j).toBe(tie.b.j - tie.a.j); // length unchanged
  });

  it('a zero delta is a no-op (same coordinates back)', () => {
    const tie = { a: { i: 3, j: 1 }, b: { i: 3, j: 4 } };
    expect(translateTie(tie, 0, 0)).toEqual(tie);
  });

  it('does not mutate the input', () => {
    const tie = { a: { i: 3, j: 1 }, b: { i: 3, j: 4 } };
    const before = JSON.parse(JSON.stringify(tie));
    translateTie(tie, 5, 5);
    expect(tie).toEqual(before);
  });
});

/**
 * SE7j introduced this composition (grabbing a node used to force a tie
 * move's dj to 0, so a node-drag could never lean the tie); SE7k AMEND 5
 * later retired that specific redirect (a node grab now either STRETCHES
 * the piece it sits at the end of, or falls through to a plain, free-
 * both-axes MOVE for a mid-span crossing — see editor-interaction.js's
 * _beginLatticeMove) — no live call site passes dj=0 to translateTie any
 * more. Left in place as a plain composition test of translateTie's own
 * contract (a pure function; a fixed dj=0 is still a valid, meaningful
 * input to verify, even though nothing currently calls it that way) —
 * not a claim about current dispatch behavior.
 */
describe('translateTie composed with dj=0 (a pure-math regression guard, not a live dispatch path since SE7k AMEND 5)', () => {
  it('a single along-axis delta (dj=0) shifts the tie sideways without leaning it — still perpendicular to a horizontal rail, same length', () => {
    const tie = { a: { i: 3, j: 1 }, b: { i: 3, j: 4 } };
    const moved = translateTie(tie, 2, 0);
    expect(moved).toEqual({ a: { i: 5, j: 1 }, b: { i: 5, j: 4 } });
    expect(moved.a.i).toBe(moved.b.i); // still a straight vertical line — never leaned
    expect(moved.b.j - moved.a.j).toBe(tie.b.j - tie.a.j); // length unchanged
  });

  it('nodes carried: applying the SAME delta to every point on the tie (both ends AND a mid-span crossing) keeps them all coincident with the moved tie', () => {
    const tie = { a: { i: 3, j: 1 }, b: { i: 3, j: 4 } };
    const midSpanCrossing = { i: 3, j: 2 }; // e.g. where another rail crosses this tie
    const di = 2;
    const moved = translateTie(tie, di, 0);
    const movedCrossing = { i: midSpanCrossing.i + di, j: midSpanCrossing.j };
    // The moved crossing point still lies exactly on the moved tie's line
    // (same i, j within the moved tie's span) — it rode along correctly.
    expect(movedCrossing.i).toBe(moved.a.i);
    expect(movedCrossing.j).toBeGreaterThanOrEqual(Math.min(moved.a.j, moved.b.j));
    expect(movedCrossing.j).toBeLessThanOrEqual(Math.max(moved.a.j, moved.b.j));
  });

  it('vertical orientation mirror: the SAME dj=0 composition, conjugated through orient(), shifts a real-vertical tie up/down instead of sideways — still upright, still perpendicular to the (now vertical) rail', () => {
    const orientation = 'vertical';
    // Real geometry: a horizontal tie at real-j=3, spanning real-i 1..4.
    const tieReal = { a: { i: 1, j: 3 }, b: { i: 4, j: 3 } };
    const tieCanon = { a: orient(tieReal.a, orientation), b: orient(tieReal.b, orientation) };
    const moved = translateTie(tieCanon, 2, 0); // the exact same call a node-drag makes
    const movedReal = { a: orient(moved.a, orientation), b: orient(moved.b, orientation) };
    // Real-j (the row) shifted by 2; real-i (the span) is untouched —
    // under vertical orientation this IS "along the rail axis" (rails run
    // real-i, ties run real-j), so the mirror holds with zero new math.
    expect(movedReal).toEqual({ a: { i: 1, j: 5 }, b: { i: 4, j: 5 } });
    expect(movedReal.a.i).toBe(tieReal.a.i);
    expect(movedReal.b.i).toBe(tieReal.b.i); // span (real-i) unchanged — still upright, not leaned
  });
});

describe('toLatticeFractional (SE7k AMEND 5)', () => {
  it('does NOT round — the pre-round intermediate toLattice itself rounds', () => {
    expect(toLatticeFractional({ x: 0.6, y: -0.4 }, 0.25)).toEqual({ i: 2.4, j: -1.6 });
  });

  it('agrees with toLattice once rounded', () => {
    const pt = { x: 1.1, y: 3.9 };
    const frac = toLatticeFractional(pt, 0.25);
    expect({ i: Math.round(frac.i), j: Math.round(frac.j) }).toEqual(toLattice(pt, 0.25));
  });
});

describe('nearestEndWithin (SE7k AMEND 5 — the end-grab-zone test)', () => {
  const piece = { a: { i: 1, j: 5 }, b: { i: 8, j: 5 } };

  it('returns "a" when within tol of a and farther from b', () => {
    expect(nearestEndWithin(piece, { i: 1.3, j: 5 }, 0.5)).toBe('a');
  });

  it('returns "b" when within tol of b and farther from a', () => {
    expect(nearestEndWithin(piece, { i: 7.7, j: 5 }, 0.5)).toBe('b');
  });

  it('returns null (body) when outside tol of both ends', () => {
    expect(nearestEndWithin(piece, { i: 4.5, j: 5 }, 0.5)).toBeNull();
  });

  it('prefers "a" on an exact tie (equidistant and both within tol) — deterministic, not order-dependent', () => {
    const symmetric = { a: { i: 0, j: 0 }, b: { i: 10, j: 0 } };
    expect(nearestEndWithin(symmetric, { i: 5, j: 0 }, 100)).toBe('a');
  });

  it('a point exactly ON an end is within tol for any tol >= 0', () => {
    expect(nearestEndWithin(piece, { i: 1, j: 5 }, 0)).toBe('a');
    expect(nearestEndWithin(piece, { i: 8, j: 5 }, 0)).toBe('b');
  });
});

describe('stretchRailEnd (SE7k AMEND 4/5)', () => {
  it('moves the given end along i, leaves the row (j) and the OTHER end untouched', () => {
    const rail = { a: { i: 1, j: 5 }, b: { i: 8, j: 5 } };
    const stretched = stretchRailEnd(rail, 'a', -3);
    expect(stretched).toEqual({ a: { i: -3, j: 5 }, b: { i: 8, j: 5 } });
  });

  it('stretching "b" leaves "a" untouched', () => {
    const rail = { a: { i: 1, j: 5 }, b: { i: 8, j: 5 } };
    const stretched = stretchRailEnd(rail, 'b', 12);
    expect(stretched).toEqual({ a: { i: 1, j: 5 }, b: { i: 12, j: 5 } });
  });

  it('clamps so the moving end can never reach or pass the fixed end (minimum length 1 step)', () => {
    const rail = { a: { i: 1, j: 5 }, b: { i: 8, j: 5 } };
    expect(stretchRailEnd(rail, 'a', 8)).toEqual({ a: { i: 7, j: 5 }, b: { i: 8, j: 5 } }); // tried to reach b
    expect(stretchRailEnd(rail, 'a', 20)).toEqual({ a: { i: 7, j: 5 }, b: { i: 8, j: 5 } }); // tried to pass b
  });

  it('preserves which side of the fixed end the moving end started on, even near the clamp', () => {
    // 'a' started BELOW 'b' (i=1 < i=8) — the clamp must not let it flip
    // to the other side (i > 8) just because the pointer overshot.
    const rail = { a: { i: 1, j: 5 }, b: { i: 8, j: 5 } };
    const stretched = stretchRailEnd(rail, 'a', 100);
    expect(stretched.a.i).toBeLessThan(stretched.b.i);
  });

  it('vertical orientation mirror: the SAME call, conjugated through orient(), stretches a real-vertical rail along its own real column', () => {
    const orientation = 'vertical';
    const railReal = { a: { i: 3, j: 1 }, b: { i: 3, j: 8 } }; // a vertical rail, real column i=3
    const railCanon = { a: orient(railReal.a, orientation), b: orient(railReal.b, orientation) };
    const stretched = stretchRailEnd(railCanon, 'a', -2);
    const stretchedReal = { a: orient(stretched.a, orientation), b: orient(stretched.b, orientation) };
    expect(stretchedReal).toEqual({ a: { i: 3, j: -2 }, b: { i: 3, j: 8 } });
    expect(stretchedReal.a.i).toBe(railReal.a.i); // still a straight vertical line
  });
});

describe('stretchTieEnd (SE7k AMEND 4/5)', () => {
  it('moves the given end along j, leaves the column (i) and the OTHER end untouched', () => {
    const tie = { a: { i: 4, j: 1 }, b: { i: 4, j: 6 } };
    const stretched = stretchTieEnd(tie, 'b', 10);
    expect(stretched).toEqual({ a: { i: 4, j: 1 }, b: { i: 4, j: 10 } });
  });

  it('clamps so the moving end can never reach or pass the fixed end (minimum length 1 step)', () => {
    const tie = { a: { i: 4, j: 1 }, b: { i: 4, j: 6 } };
    expect(stretchTieEnd(tie, 'b', 1)).toEqual({ a: { i: 4, j: 1 }, b: { i: 4, j: 2 } }); // tried to reach a
    expect(stretchTieEnd(tie, 'b', -5)).toEqual({ a: { i: 4, j: 1 }, b: { i: 4, j: 2 } }); // tried to pass a
  });

  it('vertical orientation mirror: the SAME call, conjugated through orient(), stretches a real-horizontal tie along its own real row', () => {
    const orientation = 'vertical';
    const tieReal = { a: { i: 1, j: 3 }, b: { i: 6, j: 3 } }; // a horizontal tie, real row j=3
    const tieCanon = { a: orient(tieReal.a, orientation), b: orient(tieReal.b, orientation) };
    const stretched = stretchTieEnd(tieCanon, 'b', 10);
    const stretchedReal = { a: orient(stretched.a, orientation), b: orient(stretched.b, orientation) };
    expect(stretchedReal).toEqual({ a: { i: 1, j: 3 }, b: { i: 10, j: 3 } });
    expect(stretchedReal.a.j).toBe(tieReal.a.j); // still a straight horizontal line
  });
});

describe('LATTICE_DRAW_KINDS.clickSpawn (SE7k AMEND 1, declared table)', () => {
  it('declares a clickSpawn for every kind', () => {
    const byValue = Object.fromEntries(LATTICE_DRAW_KINDS.map((k) => [k.value, k.clickSpawn]));
    expect(byValue).toEqual({ rail: 'fullRow', tie: 'betweenRails', node: 'point' });
  });
});

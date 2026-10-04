/**
 * F35 item 1 — editor/editor-brick-tool.js: the one pure, DOM-free piece of
 * the brick-tab adapter (primitivesToPolyline). The rest (ensureBricksLayer,
 * runBricks, brickBrushHandler) is svg.js/DOM-dependent, like main/photo-
 * panel.js's own DOM wiring, and verified live instead (see WORK-LOG-fb-
 * app.md's F35 item 1 entry for the headless-Chrome pass).
 *
 * `corners` (added in the advisor's turn-131 review fix): primitivesToPolyline
 * now marks a point as a declared corner ONLY when its own primitive index is
 * in `corners` (frameContourSilhouette's own "sharp, not tangent" list) --
 * marking EVERY primitive boundary (the original version) forced a mitred
 * brick-boundary correction at tangent arc-to-arc samples too, breaking
 * curved runs.
 */
import { describe, it, expect } from 'vitest';
import { primitivesToPolyline, reconstructChains } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

describe('primitivesToPolyline: contour-from-frame.js primitives -> a flat polyline + DECLARED corner indices only', () => {
  it('a square made of 4 L primitives, ALL declared as corners, becomes 4 points each its own corner', () => {
    const square = [
      { type: 'L', p0: { x: 0, y: 0 }, p1: { x: 4, y: 0 } },
      { type: 'L', p0: { x: 4, y: 0 }, p1: { x: 4, y: 4 } },
      { type: 'L', p0: { x: 4, y: 4 }, p1: { x: 0, y: 4 } },
      { type: 'L', p0: { x: 0, y: 4 }, p1: { x: 0, y: 0 } },
    ];
    const { points, cornerIndices } = primitivesToPolyline(square, [0, 1, 2, 3]);
    expect(points).toEqual([
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 },
    ]);
    expect(cornerIndices).toEqual([0, 1, 2, 3]);
  });

  it('omitting `corners` declares NO corners at all, even with real primitives present', () => {
    const square = [
      { type: 'L', p0: { x: 0, y: 0 }, p1: { x: 4, y: 0 } },
      { type: 'L', p0: { x: 4, y: 0 }, p1: { x: 4, y: 4 } },
    ];
    expect(primitivesToPolyline(square).cornerIndices).toEqual([]);
    expect(primitivesToPolyline(square, []).cornerIndices).toEqual([]);
  });

  it('only the DECLARED subset of primitive indices becomes a corner -- not every primitive boundary', () => {
    const square = [
      { type: 'L', p0: { x: 0, y: 0 }, p1: { x: 4, y: 0 } },
      { type: 'L', p0: { x: 4, y: 0 }, p1: { x: 4, y: 4 } },
      { type: 'L', p0: { x: 4, y: 4 }, p1: { x: 0, y: 4 } },
      { type: 'L', p0: { x: 0, y: 4 }, p1: { x: 0, y: 0 } },
    ];
    // Only primitives 0 and 2 are declared sharp -- 1 and 3 are "tangent" (a
    // synthetic case; the real input would be arcs there, but the corner-
    // selection logic itself doesn't care what TYPE the skipped primitive is).
    const { cornerIndices } = primitivesToPolyline(square, [0, 2]);
    expect(cornerIndices).toEqual([0, 2]); // points[0] and points[2], not points[1]/[3]
  });

  it('an empty/undefined primitives list produces an empty polyline, not a throw', () => {
    expect(primitivesToPolyline([])).toEqual({ points: [], cornerIndices: [] });
    expect(primitivesToPolyline(undefined)).toEqual({ points: [], cornerIndices: [] });
  });

  it('an A (arc) primitive is subdivided into multiple points along the true arc, not collapsed to its endpoints', () => {
    // A quarter circle, radius 2, centered at origin, 0 -> 90 degrees.
    const arc = [{ type: 'A', cx: 0, cy: 0, rx: 2, ry: 2, theta1: 0, dTheta: Math.PI / 2 }];
    const { points, cornerIndices } = primitivesToPolyline(arc, [0]);
    expect(cornerIndices).toEqual([0]);
    expect(points.length).toBeGreaterThan(2); // genuinely subdivided, not just 2 endpoints
    // Every sampled point must actually sit ON the declared circle (radius 2 from origin) --
    // this is the property a lazy "just return the 2 endpoints" implementation would still
    // pass for the FIRST point but not catch a wrong radius/center for interior points.
    for (const p of points) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(2, 9);
    }
    // First sampled point is the arc's own start (theta1=0 -> (2,0)); the true end
    // (theta=90deg -> (0,2)) is NOT included (that's the START of whatever primitive
    // follows, consistent with the L-primitive case only emitting its OWN start point).
    expect(points[0]).toEqual({ x: 2, y: 0 });
  });

  it('TWO consecutive arcs with only the FIRST declared a corner stay a single smooth run -- the tangent join produces no corner', () => {
    // A half-circle split into two quarter-arcs (a realistic "one smooth curve,
    // represented as several primitives" case) -- only primitive 0 is a real
    // (sharp) corner; primitive 1 is a tangent continuation of primitive 0.
    const halfCircleInTwoArcs = [
      { type: 'A', cx: 0, cy: 0, rx: 2, ry: 2, theta1: 0, dTheta: Math.PI / 2 },
      { type: 'A', cx: 0, cy: 0, rx: 2, ry: 2, theta1: Math.PI / 2, dTheta: Math.PI / 2 },
    ];
    const { cornerIndices } = primitivesToPolyline(halfCircleInTwoArcs, [0]);
    expect(cornerIndices).toEqual([0]); // NOT [0, 16] -- primitive 1's own start is not a corner
  });

  it('mixed L + A primitives concatenate in order, corner indices only at the DECLARED ones', () => {
    const mixed = [
      { type: 'L', p0: { x: 0, y: 0 }, p1: { x: 2, y: 0 } },
      { type: 'A', cx: 2, cy: 2, rx: 2, ry: 2, theta1: -Math.PI / 2, dTheta: Math.PI / 2 },
    ];
    const { points, cornerIndices } = primitivesToPolyline(mixed, [0, 1]);
    expect(cornerIndices[0]).toBe(0); // the L's own start
    expect(cornerIndices[1]).toBe(1); // the A's own start, right after the L's single point
    expect(points.length).toBe(1 + 16); // 1 for the straight edge + ARC_STEPS for the arc
  });
});

describe('reconstructChains: F35 item 3 -- spine segments -> regenerate units', () => {
  const SETTINGS_A = { setId: 1, scale: 1, seed: 7 };
  const SETTINGS_B = { setId: 1, scale: 2, seed: 9 };

  it('a single segment is its own one-chain unit', () => {
    const segs = [{ a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, stripeId: null, settings: SETTINGS_A }];
    const chains = reconstructChains(segs);
    expect(chains).toHaveLength(1);
    expect(chains[0].points).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }]);
    expect(chains[0].cycleIndex).toBeNull();
    expect(chains[0].settings).toBe(SETTINGS_A);
  });

  it('plain CONTIGUOUS segments merge into one ordered chain, regardless of array order', () => {
    // Drawn 0->1->2->3, but handed in shuffled order -- the chain must still
    // reconstruct the TRUE geometric sequence, not the input order.
    const segs = [
      { a: { x: 2, y: 0 }, b: { x: 3, y: 0 }, stripeId: null, settings: SETTINGS_A },
      { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, stripeId: null, settings: SETTINGS_A },
      { a: { x: 1, y: 0 }, b: { x: 2, y: 0 }, stripeId: null, settings: SETTINGS_A },
    ];
    const chains = reconstructChains(segs);
    expect(chains).toHaveLength(1);
    expect(chains[0].points).toEqual([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 },
    ]);
  });

  it('a Scissors cut (two touching, still-contiguous plain pieces) stays ONE merged chain -- nothing should visually change from a bare cut', () => {
    // cutAtNoCommit's own clone copies the settings attribute verbatim, so
    // both resulting pieces carry the SAME settings object/value.
    const segs = [
      { a: { x: 0, y: 0 }, b: { x: 1.5, y: 0 }, stripeId: null, settings: SETTINGS_A },
      { a: { x: 1.5, y: 0 }, b: { x: 3, y: 0 }, stripeId: null, settings: SETTINGS_A },
    ];
    expect(reconstructChains(segs)).toHaveLength(1);
  });

  it('dragging one piece away (geometric gap, no shared endpoint) splits it into two independent chains', () => {
    const segs = [
      { a: { x: 0, y: 0 }, b: { x: 1.5, y: 0 }, stripeId: null, settings: SETTINGS_A },
      { a: { x: 5, y: 5 }, b: { x: 6.5, y: 5 }, stripeId: null, settings: SETTINGS_A }, // moved away
    ];
    const chains = reconstructChains(segs);
    expect(chains).toHaveLength(2);
  });

  it('two DIFFERENT brick elements (unrelated spines) never merge with each other', () => {
    // Geometrically touching by coincidence, but the caller only ever passes
    // ONE element's own segments at a time (regenerateOwnedBrickElements
    // groups by BRICK_ELEMENT_ATTR first) -- this test documents that
    // reconstructChains itself has no element-id awareness, it just merges
    // whatever contiguous segments it's given, so the CALLER's grouping is
    // what keeps separate strokes from bleeding into each other.
    const segs = [
      { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, stripeId: null, settings: SETTINGS_A },
      { a: { x: 1, y: 0 }, b: { x: 2, y: 0 }, stripeId: null, settings: SETTINGS_B },
    ];
    expect(reconstructChains(segs)).toHaveLength(1); // merges purely on geometry
  });

  it('a Stripe run (shared stripeId) NEVER merges, even though the pieces are contiguous -- each cycles its own index', () => {
    const segs = [
      { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, stripeId: 'run-1', settings: SETTINGS_A },
      { a: { x: 1, y: 0 }, b: { x: 2, y: 0 }, stripeId: 'run-1', settings: SETTINGS_A },
      { a: { x: 2, y: 0 }, b: { x: 3, y: 0 }, stripeId: 'run-1', settings: SETTINGS_A },
    ];
    const chains = reconstructChains(segs);
    expect(chains).toHaveLength(3);
    expect(chains.map((c) => c.cycleIndex).sort()).toEqual([0, 1, 2]);
  });

  it('two separate stripe runs cycle independently of each other', () => {
    const segs = [
      { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, stripeId: 'run-A', settings: SETTINGS_A },
      { a: { x: 1, y: 0 }, b: { x: 2, y: 0 }, stripeId: 'run-A', settings: SETTINGS_A },
      { a: { x: 10, y: 0 }, b: { x: 11, y: 0 }, stripeId: 'run-B', settings: SETTINGS_B },
      { a: { x: 11, y: 0 }, b: { x: 12, y: 0 }, stripeId: 'run-B', settings: SETTINGS_B },
    ];
    const chains = reconstructChains(segs);
    expect(chains).toHaveLength(4);
    const runACycles = chains.filter((c) => c.settings === SETTINGS_A).map((c) => c.cycleIndex).sort();
    const runBCycles = chains.filter((c) => c.settings === SETTINGS_B).map((c) => c.cycleIndex).sort();
    expect(runACycles).toEqual([0, 1]);
    expect(runBCycles).toEqual([0, 1]);
  });

  it('empty input produces no chains', () => {
    expect(reconstructChains([])).toEqual([]);
    expect(reconstructChains(undefined)).toEqual([]);
  });
});

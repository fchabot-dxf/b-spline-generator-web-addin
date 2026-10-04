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
 *
 * OFF-BY-ONE FIX (f3, found live on T1's own real contour -- a visible void
 * at the board's bottom-left corner): `corners`' declared convention is
 * "index i = the joint BETWEEN primitive i and i+1", not "the joint BEFORE
 * primitive i" -- every expected cornerIndices value below is the CORRECTED
 * one (the joint lands at the position where the FOLLOWING primitive's own
 * points start, wrapping to 0 when the declared corner is the last
 * primitive).
 */
import { describe, it, expect } from 'vitest';
import { primitivesToPolyline, reconstructChains } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { pointInPolygon } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

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
    // The joint AFTER primitive i: 1, 2, 3, then primitive 3's own "after"
    // wraps (4 % 4) to 0 -- all 4 points are still corners, just the wrap
    // lands last in this declared order rather than first.
    expect(cornerIndices).toEqual([1, 2, 3, 0]);
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
    expect(cornerIndices).toEqual([1, 3]); // the joint AFTER primitive 0, and AFTER primitive 2
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
    // The joint AFTER primitive 0 = index 16 (primitive 1's own start) --
    // declaring corner 0 means "arc0 meets arc1 sharply here", never a
    // SECOND corner wherever primitive 1 happens to end.
    expect(cornerIndices).toEqual([16]);
  });

  it('mixed L + A primitives concatenate in order, corner indices only at the DECLARED ones', () => {
    const mixed = [
      { type: 'L', p0: { x: 0, y: 0 }, p1: { x: 2, y: 0 } },
      { type: 'A', cx: 2, cy: 2, rx: 2, ry: 2, theta1: -Math.PI / 2, dTheta: Math.PI / 2 },
    ];
    const { points, cornerIndices } = primitivesToPolyline(mixed, [0, 1]);
    expect(cornerIndices[0]).toBe(1); // the joint AFTER the L -- the A's own start
    expect(cornerIndices[1]).toBe(0); // the joint AFTER the A (the last primitive) wraps to 0
    expect(points.length).toBe(1 + 16); // 1 for the straight edge + ARC_STEPS for the arc
  });

  it('T1 7x9 real contour (advisor/f3): all 4 corners mitred, no void -- the EXACT case the off-by-one bug broke', () => {
    // The adapter's own real call chain, RAW unshifted sil.corners (f3's own
    // test file applies a +1 workaround to their LOCAL, deliberately-
    // unfixed copy of this function specifically to isolate core/bricks'
    // own contract from this adapter bug -- that workaround is unneeded
    // here since this IS the real, now-fixed adapter function).
    const record = normalizeFrameRecord({ templateId: 'template_1' });
    const frame = { defs: FRAME_DEFS, record, board: { widthIn: 7, heightIn: 9 } };
    const sil = frameContourSilhouette(frame, 0, 0);
    expect(sil.error).toBeUndefined();

    const { points, cornerIndices } = primitivesToPolyline(sil.primitives, sil.corners);
    const SET = BRICK_SETS[0];
    const { bricks } = bricksContourBands(points, FRAME_PRESETS.single_soldier, { set: SET, cornerIndices, seed: 1 });
    expect(bricks.length).toBeGreaterThan(0);

    // Checked DIRECTLY at the board's own 4 true geometric corners (the
    // single_soldier band sits distance=0 from the frame's own outer cut
    // profile, so a rectangular board's corners land exactly at
    // (widthIn-margin, margin) etc. -- margin=0.25in here, MEASURED off
    // template_1's own real silhouette, not assumed), rather than at
    // whatever point `cornerIndices` happens to mark. An EARLIER version of
    // this test checked gaps between ALL nearby brick PAIRS instead (f3's
    // own "MUTATION CHECK" test uses exactly that) and was itself
    // mutation-tested against a REAL run of this exact scenario -- it
    // reported a 2.07in "gap" even on the CORRECT, fixed geometry, between
    // two bricks on entirely different, non-adjacent sides of the board
    // that simply happen to have nearby bounding boxes (a false positive
    // from the loose reach heuristic, not an actual void) -- MEASURED
    // directly before trusting it, the same discipline that caught the
    // original bug. Checking the 4 known corner POINTS directly avoids
    // that noise entirely and was confirmed, via the same measurement, to
    // correctly separate the broken case (0.47in gap at the true top-left
    // corner) from the fixed one (0.0 at all four).
    const trueCorners = [
      { x: 6.75, y: 0.25 }, { x: 6.75, y: 8.75 }, { x: 0.25, y: 8.75 }, { x: 0.25, y: 0.25 },
    ];
    const distPointToSeg = (p, a, b) => {
      const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
      const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
      return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    };
    const distPointToPoly = (p, poly) => {
      if (pointInPolygon(p.x, p.y, poly)) return 0;
      let best = Infinity;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) best = Math.min(best, distPointToSeg(p, poly[j], poly[i]));
      return best;
    };
    for (const corner of trueCorners) {
      let nearest = Infinity;
      for (const b of bricks) nearest = Math.min(nearest, distPointToPoly(corner, b.polygon));
      expect(nearest, `void at board corner (${corner.x},${corner.y})`).toBeLessThanOrEqual(SET.grout.widthIn * 2);
    }
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

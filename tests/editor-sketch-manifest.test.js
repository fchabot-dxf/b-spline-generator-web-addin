/**
 * T61 (SE15 Slice 1+2 combined dispatch) — editor-sketch-manifest.js. Verify
 * list, matching the dispatch's own bullets: entities/constraints/
 * parameters for a box lattice AND a Shape Lattice hourglass/bottle;
 * widths as offsets with round caps; the >=SKETCH_PIECE_THRESHOLD plain-
 * fallback flag. Every geometric claim (H/V, tie-on-rail, cap
 * perpendicularity, Equal-implies-same-radius/length) is checked with an
 * INDEPENDENT calculation over the entities' own numeric fields, not by
 * re-trusting the function under test — same "independent oracle"
 * discipline this codebase already uses for T55/T58's own tangency tests.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSketchManifest, manifestFromLattice, manifestFromShape, SKETCH_PIECE_THRESHOLD, SKETCH_WIDTH_MODE,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-sketch-manifest.js';
import { computePattern, PATTERN_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { fromLattice, toLattice } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice.js';
import { generateSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import { primitivesBBox } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-boundary.js';

const REGION = { x: 0, y: 0, w: 7, h: 9 };

function entityById(entities, id) {
  return entities.find((e) => e.id === id);
}

function pointOf(entities, target) {
  // target is an id, or "id:S"/"id:E" for a Line/ArcCenter's own endpoint.
  const [id, suffix] = target.split(':');
  const e = entityById(entities, id);
  if (!e) return null;
  if (e.type === 'Line' || e.type === 'Slot') {
    if (suffix === 'S') return { x: e.p1[0], y: e.p1[1] };
    if (suffix === 'E') return { x: e.p2[0], y: e.p2[1] };
    return null;
  }
  if (e.type === 'ArcCenter') {
    const angle = (deg) => (deg * Math.PI) / 180;
    const at = (deg) => ({
      x: e.center[0] + e.radius * Math.cos(angle(deg)),
      y: e.center[1] + e.radius * Math.sin(angle(deg)),
    });
    if (suffix === 'S') return at(e.startAngleDeg);
    if (suffix === 'E') return at(e.startAngleDeg + e.sweepDeg);
    return { x: e.center[0], y: e.center[1] };
  }
  if (e.type === 'Arc3Point') {
    // T65: post-carve-placement arcs carry their 3 defining points
    // directly (see toCarveArc3Point) -- no center/angle to recompute.
    if (suffix === 'S') return { x: e.p1[0], y: e.p1[1] };
    if (suffix === 'E') return { x: e.p2[0], y: e.p2[1] };
    return null;
  }
  if (e.type === 'Circle') return { x: e.center[0], y: e.center[1] };
  return null;
}

// Mirrors editor-sketch-manifest.js's own `resolveShapeBoundaryExtent`/
// `scalePrimitiveToLattice` exactly (neither is exported) — needed so a
// test's own INDEPENDENT `computePattern` call resolves the SAME extent
// `buildSketchManifest` itself would, for a Shape Lattice pattern.
function resolveShapeBoundaryExtentForTest(pattern, region) {
  const spacing = pattern.spacing || PATTERN_DEFAULTS.spacing;
  const { primitives } = generateSilhouette(region, pattern.shape);
  const scalePt = (p) => ({ x: p.x / spacing, y: p.y / spacing });
  const scaled = primitives.map((p) => (p.type === 'L'
    ? { type: 'L', p0: scalePt(p.p0), p1: scalePt(p.p1) }
    : { type: 'A', cx: p.cx / spacing, cy: p.cy / spacing, rx: p.rx / spacing, ry: p.ry / spacing, phi: p.phi, theta1: p.theta1, dTheta: p.dTheta }));
  const bbox = primitivesBBox(scaled);
  if (!bbox) return { iMin: 0, jMin: 0, iMax: -1, jMax: -1, mode: 'boundary', primitives: [] };
  return {
    iMin: Math.floor(bbox.xMin), jMin: Math.floor(bbox.yMin),
    iMax: Math.ceil(bbox.xMax), jMax: Math.ceil(bbox.yMax),
    mode: 'boundary', primitives: scaled,
  };
}

describe('manifestFromLattice — box lattice (no shape)', () => {
  // Deterministic, dense-enough pattern: a rail on every row, a tie in
  // every column at a seeded free span — exercises rails, ties, AND both
  // a "touches a rail" and (thanks to sparse rail rows below) a "doesn't
  // touch any rail" tie endpoint.
  const PATTERN = {
    ...PATTERN_DEFAULTS,
    spacing: 0.25,
    orientation: 'horizontal',
    rails: { mode: 'every', every: 2, offset: 0 },
    ties: { mode: 'density', density: 1, anchor: 'free', spanMin: 1, spanMax: 2, railSnapRows: 0 },
    nodes: { ends: true, crossings: true, railEnds: false },
    widths: { rails: 0.07, ties: 0.05, nodeRadius: 0.075, linkRailsTies: false },
    seed: 42,
  };
  const EXTENT = { iMin: 0, jMin: 0, iMax: 8, jMax: 8 };

  it('entities match computePattern + fromLattice exactly (independent re-run)', () => {
    const { segments, nodePoints } = computePattern(PATTERN, { extent: EXTENT, occupied: null });
    const manifest = manifestFromLattice(PATTERN, EXTENT);
    const rails = segments.filter((s) => s.kind === 'rail');
    const ties = segments.filter((s) => s.kind === 'tie');

    const railEntities = manifest.entities.filter((e) => e.id.startsWith('rail') && e.type === 'Slot');
    expect(railEntities.length).toBe(rails.length);
    rails.forEach((seg, i) => {
      const p1 = fromLattice(seg.a, PATTERN.spacing), p2 = fromLattice(seg.b, PATTERN.spacing);
      const e = entityById(manifest.entities, `rail${i}`);
      expect(e.p1).toEqual([p1.x, p1.y]);
      expect(e.p2).toEqual([p2.x, p2.y]);
    });
    const tieEntities = manifest.entities.filter((e) => e.id.startsWith('tie') && e.type === 'Slot');
    expect(tieEntities.length).toBe(ties.length);
    ties.forEach((seg, i) => {
      const p1 = fromLattice(seg.a, PATTERN.spacing), p2 = fromLattice(seg.b, PATTERN.spacing);
      const e = entityById(manifest.entities, `tie${i}`);
      expect(e.p1).toEqual([p1.x, p1.y]);
      expect(e.p2).toEqual([p2.x, p2.y]);
    });
    const nodeEntities = manifest.entities.filter((e) => e.type === 'Circle' && e.id.startsWith('node'));
    expect(nodeEntities.length).toBe(nodePoints.length);
  });

  it('every Horizontal/Vertical constraint is geometrically true, and every rail/tie gets exactly one (below threshold)', () => {
    const manifest = manifestFromLattice(PATTERN, EXTENT);
    expect(manifest.constrained).toBe(true);
    const railTieIds = manifest.entities.filter((e) => e.type === 'Slot').map((e) => e.id);
    for (const id of railTieIds) {
      const hv = manifest.constraints.filter((c) => (c.type === 'Horizontal' || c.type === 'Vertical') && c.targets[0] === id);
      expect(hv.length).toBe(1);
      const e = entityById(manifest.entities, id);
      if (hv[0].type === 'Horizontal') expect(e.p1[1]).toBeCloseTo(e.p2[1], 9);
      else expect(e.p1[0]).toBeCloseTo(e.p2[0], 9);
    }
  });

  it('tie-on-rail Coincident constraints are geometrically real: no false positive, no false negative (independent scan)', () => {
    const manifest = manifestFromLattice(PATTERN, EXTENT);
    const railEntities = manifest.entities.filter((e) => e.id.match(/^rail\d+$/));
    const onAnyRail = (pt) => railEntities.some((r) => {
      const [x1, y1] = r.p1, [x2, y2] = r.p2;
      if (Math.abs(x1 - x2) < 1e-9) return Math.abs(pt.x - x1) < 1e-6 && pt.y >= Math.min(y1, y2) - 1e-6 && pt.y <= Math.max(y1, y2) + 1e-6;
      if (Math.abs(y1 - y2) < 1e-9) return Math.abs(pt.y - y1) < 1e-6 && pt.x >= Math.min(x1, x2) - 1e-6 && pt.x <= Math.max(x1, x2) + 1e-6;
      return false;
    });

    // Positive: every declared TIE-ON-RAIL Coincident really touches a
    // rail. T64 added a SEPARATE node-to-piece Coincident feature whose
    // own targets can ALSO include a tie id (e.g. node5<->tie3:S) without
    // that tie end being anywhere near a rail — filtered out here by
    // requiring BOTH targets look like a bare rail/tie piece (never a
    // node), so this test stays specific to the tie-on-rail relationship
    // it was written to verify.
    const pieceIdPattern = /^(rail|tie)\d+(:[SE])?$/;
    const coincidents = manifest.constraints.filter((c) => c.type === 'Coincident' && c.targets.every((t) => pieceIdPattern.test(t)));
    expect(coincidents.length).toBeGreaterThan(0); // non-vacuous: this pattern actually produces some
    for (const c of coincidents) {
      const tieEndTarget = c.targets.find((t) => t.startsWith('tie'));
      const pt = pointOf(manifest.entities, tieEndTarget);
      expect(onAnyRail(pt)).toBe(true);
    }

    // Negative: every tie endpoint WITHOUT a declared Coincident genuinely
    // doesn't touch any rail.
    const declaredTargets = new Set(coincidents.flatMap((c) => c.targets));
    const tieEntities = manifest.entities.filter((e) => e.id.match(/^tie\d+$/));
    let uncoveredChecked = 0;
    for (const tie of tieEntities) {
      for (const [suffix, pt] of [['S', { x: tie.p1[0], y: tie.p1[1] }], ['E', { x: tie.p2[0], y: tie.p2[1] }]]) {
        if (declaredTargets.has(`${tie.id}:${suffix}`)) continue;
        uncoveredChecked++;
        expect(onAnyRail(pt)).toBe(false);
      }
    }
    expect(uncoveredChecked).toBeGreaterThan(0); // non-vacuous: some free ends actually exist to check
  });

  it('T66: a tie-on-rail Coincident is point-to-point (rail:S/:E) when the tie lands EXACTLY on the rail\'s own end, point-on-curve (bare rail id) only for a genuine mid-span landing — matching the advisor\'s own measured working scheme precisely', () => {
    const manifest = manifestFromLattice(PATTERN, EXTENT);
    const railEntities = manifest.entities.filter((e) => e.id.match(/^rail\d+$/));
    const tieEntities = manifest.entities.filter((e) => e.id.match(/^tie\d+$/));
    const pointsEqual = (a, b) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

    let endMatches = 0, curveMatches = 0;
    for (const tie of tieEntities) {
      for (const [suffix, pt] of [['S', { x: tie.p1[0], y: tie.p1[1] }], ['E', { x: tie.p2[0], y: tie.p2[1] }]]) {
        const c = manifest.constraints.find((cc) => cc.type === 'Coincident' && cc.targets[0] === `${tie.id}:${suffix}`);
        if (!c) continue; // this end doesn't touch any rail at all -- covered by the test above
        const railTarget = c.targets[1];
        const rail = railEntities.find((r) => r.id === railTarget.split(':')[0]);
        const railP1 = { x: rail.p1[0], y: rail.p1[1] }, railP2 = { x: rail.p2[0], y: rail.p2[1] };
        if (pointsEqual(pt, railP1)) { expect(railTarget).toBe(`${rail.id}:S`); endMatches++; }
        else if (pointsEqual(pt, railP2)) { expect(railTarget).toBe(`${rail.id}:E`); endMatches++; }
        else { expect(railTarget).toBe(rail.id); curveMatches++; }
      }
    }
    expect(endMatches).toBeGreaterThan(0); // non-vacuous: real end-matches exist in this fixture
    expect(curveMatches).toBeGreaterThan(0); // non-vacuous: real mid-span matches exist too
  });

  it('T66: no rail/tie/node ever has an exactly-zero-length piece (a real bug: the advisor\'s own live Fusion run hit "InternalValidationError : isSuccessful" on a degenerate slot) — reproduced here with the SAME default hourglass shape, no exotic params needed', () => {
    const shapePattern = {
      ...PATTERN_DEFAULTS, spacing: 0.25,
      rails: { mode: 'every', every: 2, offset: 0 },
      ties: { mode: 'density', density: 1, anchor: 'free', spanMin: 1, spanMax: 2, railSnapRows: 0 },
      nodes: { ends: false, crossings: false, railEnds: false },
      widths: { rails: 0.07, ties: 0.07, nodeRadius: 0.075, linkRailsTies: true },
      extent: { mode: 'boundary' },
      shape: { source: 'generated', preset: 'hourglass', seed: 42, params: {}, segments: null },
      seed: 42,
    };
    // Independent re-derivation: recompute the RAW (pre-filter) segments
    // directly, to confirm this fixture genuinely contains a degenerate
    // piece -- otherwise "no zero-length Slot exists" would be trivially
    // true regardless of whether the filter does anything at all.
    const extent = resolveShapeBoundaryExtentForTest(shapePattern, REGION);
    const { segments } = computePattern(shapePattern, { extent, occupied: null });
    const rawHasDegenerate = segments.some((s) => {
      const a = fromLattice(s.a, shapePattern.spacing), b = fromLattice(s.b, shapePattern.spacing);
      return Math.hypot(b.x - a.x, b.y - a.y) < 1e-6;
    });
    expect(rawHasDegenerate).toBe(true); // non-vacuous: this fixture genuinely has one to filter

    const manifest = buildSketchManifest(shapePattern, REGION, {});
    for (const e of manifest.entities) {
      if (e.type !== 'Slot' && e.type !== 'Line') continue;
      const len = Math.hypot(e.p2[0] - e.p1[0], e.p2[1] - e.p1[1]);
      expect(len).toBeGreaterThan(1e-6);
    }
  });

  it('T64 ADD-ON (amendment #1): every node sitting on a rail/tie gets an explicit Coincident to it — end-match uses :S/:E, mid-span match uses the bare (point-on-curve) id', () => {
    const manifest = manifestFromLattice(PATTERN, EXTENT);
    const nodeEntities = manifest.entities.filter((e) => e.id.match(/^node\d+$/));
    expect(nodeEntities.length).toBeGreaterThan(0); // non-vacuous: this pattern actually produces nodes

    // Independent re-derivation: does a node's own coordinate sit
    // EXACTLY at a piece's own end, or somewhere along its own span?
    const pieceEntities = manifest.entities.filter((e) => e.type === 'Slot');
    const pointsEqual = (a, b) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
    const onSpan = (pt, p1, p2) => {
      if (Math.abs(p1.x - p2.x) < 1e-9) return Math.abs(pt.x - p1.x) < 1e-6 && pt.y >= Math.min(p1.y, p2.y) - 1e-6 && pt.y <= Math.max(p1.y, p2.y) + 1e-6;
      if (Math.abs(p1.y - p2.y) < 1e-9) return Math.abs(pt.y - p1.y) < 1e-6 && pt.x >= Math.min(p1.x, p2.x) - 1e-6 && pt.x <= Math.max(p1.x, p2.x) + 1e-6;
      return false;
    };

    let endMatches = 0, curveMatches = 0;
    for (const node of nodeEntities) {
      const nodePt = { x: node.center[0], y: node.center[1] };
      const nodeConstraints = manifest.constraints.filter((c) => c.type === 'Coincident' && c.targets[0] === node.id);
      for (const piece of pieceEntities) {
        const p1 = { x: piece.p1[0], y: piece.p1[1] }, p2 = { x: piece.p2[0], y: piece.p2[1] };
        if (pointsEqual(nodePt, p1)) {
          expect(nodeConstraints.some((c) => c.targets[1] === `${piece.id}:S`)).toBe(true);
          endMatches++;
        } else if (pointsEqual(nodePt, p2)) {
          expect(nodeConstraints.some((c) => c.targets[1] === `${piece.id}:E`)).toBe(true);
          endMatches++;
        } else if (onSpan(nodePt, p1, p2)) {
          expect(nodeConstraints.some((c) => c.targets[1] === piece.id)).toBe(true);
          curveMatches++;
        }
      }
    }
    expect(endMatches).toBeGreaterThan(0); // non-vacuous: real end-matches exist in this fixture
    expect(curveMatches).toBeGreaterThan(0); // non-vacuous: real mid-span (crossing) matches exist too
  });

  it('T64: every rail/tie is a Slot entity with exactly ONE SlotWidth dimension referencing its own width param', () => {
    const manifest = manifestFromLattice(PATTERN, EXTENT);
    const railIds = manifest.entities.filter((e) => e.id.match(/^rail\d+$/)).map((e) => e.id);
    const tieIds = manifest.entities.filter((e) => e.id.match(/^tie\d+$/)).map((e) => e.id);
    expect(railIds.length).toBeGreaterThan(0);
    expect(tieIds.length).toBeGreaterThan(0);
    for (const id of railIds) {
      const e = entityById(manifest.entities, id);
      expect(e.type).toBe('Slot');
      expect(e.width).toBe(0.07); // PATTERN.widths.rails -- the Python builder's own addCenterToCenterSlot seed
      const dim = manifest.dimensions.find((d) => d.type === 'SlotWidth' && d.target === id);
      expect(dim.expression).toBe('rail_width'); // PATTERN's own linkRailsTies:false
    }
    for (const id of tieIds) {
      const e = entityById(manifest.entities, id);
      expect(e.type).toBe('Slot');
      expect(e.width).toBe(0.05); // PATTERN.widths.ties -- deliberately DIFFERENT from rails, so a
      // swapped-argument bug (rails' own width leaking onto ties, or vice versa) would fail here.
      const dim = manifest.dimensions.find((d) => d.type === 'SlotWidth' && d.target === id);
      expect(dim.expression).toBe('tie_width');
    }
    // No leftover offset/cap machinery of any kind.
    expect(manifest.dimensions.some((d) => d.type === 'Offset')).toBe(false);
    expect(manifest.entities.some((e) => e.id.includes('_cap'))).toBe(false);
  });

  it('T63: linked rail/tie widths (linkRailsTies true, the default) share ONE stroke_width param, not rail_width+tie_width', () => {
    const linkedPattern = {
      ...PATTERN,
      widths: { rails: 0.07, ties: 0.07, nodeRadius: 0.075, linkRailsTies: true },
    };
    const manifest = manifestFromLattice(linkedPattern, EXTENT);
    expect(manifest.parameters.some((p) => p.name === 'stroke_width')).toBe(true);
    expect(manifest.parameters.some((p) => p.name === 'rail_width')).toBe(false);
    expect(manifest.parameters.some((p) => p.name === 'tie_width')).toBe(false);

    const someRailId = manifest.entities.find((e) => e.id.match(/^rail\d+$/)).id;
    const someTieId = manifest.entities.find((e) => e.id.match(/^tie\d+$/)).id;
    const railSlotDim = manifest.dimensions.find((d) => d.type === 'SlotWidth' && d.target === someRailId);
    const tieSlotDim = manifest.dimensions.find((d) => d.type === 'SlotWidth' && d.target === someTieId);
    expect(railSlotDim.expression).toBe('stroke_width');
    expect(tieSlotDim.expression).toBe('stroke_width');
  });

  it('T63: an UNLINKED layer whose rail/tie widths genuinely differ still gets separate rail_width/tie_width (non-vacuous: verified against the SAME fixture the default-linked test above uses, just with the flag flipped)', () => {
    const unlinkedPattern = {
      ...PATTERN,
      widths: { rails: 0.07, ties: 0.05, nodeRadius: 0.075, linkRailsTies: false },
    };
    const manifest = manifestFromLattice(unlinkedPattern, EXTENT);
    expect(manifest.parameters.some((p) => p.name === 'stroke_width')).toBe(false);
    expect(manifest.parameters.find((p) => p.name === 'rail_width').value).toBeCloseTo(0.07, 9);
    expect(manifest.parameters.find((p) => p.name === 'tie_width').value).toBeCloseTo(0.05, 9);
  });

  it('T63: an UNLINKED layer whose rail/tie widths happen to be EQUAL still uses stroke_width (the "linked OR equal" rule, not "linked flag alone")', () => {
    const unlinkedButEqual = {
      ...PATTERN,
      widths: { rails: 0.07, ties: 0.07, nodeRadius: 0.075, linkRailsTies: false },
    };
    const manifest = manifestFromLattice(unlinkedButEqual, EXTENT);
    expect(manifest.parameters.some((p) => p.name === 'stroke_width')).toBe(true);
    expect(manifest.parameters.some((p) => p.name === 'rail_width')).toBe(false);
  });

  it('>=SKETCH_PIECE_THRESHOLD pieces: no per-piece H/V/Coincident constraints, but every Slot + its SlotWidth dimension still present', () => {
    const bigPattern = {
      ...PATTERN,
      rails: { mode: 'every', every: 1, offset: 0 },
      ties: { mode: 'density', density: 1, anchor: 'free', spanMin: 1, spanMax: 1, railSnapRows: 0 },
      nodes: { ends: false, crossings: false, railEnds: false },
    };
    const bigExtent = { iMin: 0, jMin: 0, iMax: 60, jMax: 60 };
    const manifest = manifestFromLattice(bigPattern, bigExtent);
    expect(manifest.pieceCount).toBeGreaterThanOrEqual(SKETCH_PIECE_THRESHOLD);
    expect(manifest.constrained).toBe(false);
    expect(manifest.constraints.filter((c) => c.type === 'Horizontal' || c.type === 'Vertical' || c.type === 'Coincident').length).toBe(0);
    // The width/slot mechanism is NOT gated by the threshold (§6) — every
    // rail still becomes a real Slot with its own SlotWidth dimension.
    const railIds = manifest.entities.filter((e) => e.id.match(/^rail\d+$/)).map((e) => e.id);
    expect(railIds.length).toBeGreaterThan(0);
    for (const id of railIds) {
      expect(entityById(manifest.entities, id).type).toBe('Slot');
      expect(manifest.dimensions.some((d) => d.type === 'SlotWidth' && d.target === id)).toBe(true);
    }
  });

  it('a small pattern (< threshold) is constrained', () => {
    const smallExtent = { iMin: 0, jMin: 0, iMax: 4, jMax: 4 };
    const manifest = manifestFromLattice(PATTERN, smallExtent);
    expect(manifest.pieceCount).toBeLessThan(SKETCH_PIECE_THRESHOLD);
    expect(manifest.constrained).toBe(true);
  });
});

describe.each(['hourglass', 'bottle'])('manifestFromShape(%s)', (preset) => {
  it('entities match generateSilhouette primitives 1:1 (independent re-run)', () => {
    const shape = { preset, seed: 42, params: {} };
    const { primitives } = generateSilhouette(REGION, shape);
    const manifest = manifestFromShape(shape, REGION);
    expect(manifest.entities.length).toBe(primitives.length);
    primitives.forEach((prim, i) => {
      const e = entityById(manifest.entities, `seg${i}`);
      if (prim.type === 'L') {
        expect(e.type).toBe('Line');
        expect(e.p1).toEqual([prim.p0.x, prim.p0.y]);
        expect(e.p2).toEqual([prim.p1.x, prim.p1.y]);
      } else {
        expect(e.type).toBe('ArcCenter');
        expect(e.center).toEqual([prim.cx, prim.cy]);
        expect(e.radius).toBeCloseTo(prim.rx, 9);
        expect(e.startAngleDeg).toBeCloseTo((prim.theta1 * 180) / Math.PI, 9);
        expect(e.sweepDeg).toBeCloseTo((prim.dTheta * 180) / Math.PI, 9);
      }
    });
  });

  it('every Coincident constraint is a genuinely shared point (independent coordinate check)', () => {
    const shape = { preset, seed: 42, params: {} };
    const manifest = manifestFromShape(shape, REGION);
    const coincidents = manifest.constraints.filter((c) => c.type === 'Coincident');
    expect(coincidents.length).toBeGreaterThan(0);
    for (const c of coincidents) {
      const [ptA, ptB] = c.targets.map((t) => pointOf(manifest.entities, t));
      expect(ptA.x).toBeCloseTo(ptB.x, 6);
      expect(ptA.y).toBeCloseTo(ptB.y, 6);
    }
  });

  it('every Tangent constraint touches at least one arc and never a kink joint', () => {
    const shape = { preset, seed: 42, params: {} };
    const manifest = manifestFromShape(shape, REGION);
    const tangents = manifest.constraints.filter((c) => c.type === 'Tangent');
    expect(tangents.length).toBeGreaterThan(0);
    for (const c of tangents) {
      const types = c.targets.map((id) => entityById(manifest.entities, id).type);
      expect(types.includes('ArcCenter')).toBe(true);
    }
  });

  it('every Equal constraint pairs entities of genuinely matching radius (arcs) or length (lines)', () => {
    const shape = { preset, seed: 42, params: {} };
    const manifest = manifestFromShape(shape, REGION);
    const equals = manifest.constraints.filter((c) => c.type === 'Equal');
    expect(equals.length).toBeGreaterThan(0);
    for (const c of equals) {
      const [a, b] = c.targets.map((id) => entityById(manifest.entities, id));
      expect(a.type).toBe(b.type);
      if (a.type === 'ArcCenter') expect(a.radius).toBeCloseTo(b.radius, 6);
      else {
        const lenA = Math.hypot(a.p2[0] - a.p1[0], a.p2[1] - a.p1[1]);
        const lenB = Math.hypot(b.p2[0] - b.p1[0], b.p2[1] - b.p1[1]);
        expect(lenA).toBeCloseTo(lenB, 6);
      }
    }
  });

  it('parameters carry the resolved params (snake_case, unit:null) plus half_width (unit:in)', () => {
    const shape = { preset, seed: 42, params: {} };
    const { params } = generateSilhouette(REGION, shape);
    const manifest = manifestFromShape(shape, REGION);
    const halfWidth = manifest.parameters.find((p) => p.name === 'half_width');
    expect(halfWidth.value).toBeCloseTo(REGION.w / 2, 9);
    expect(halfWidth.unit).toBe('in');
    expect(manifest.parameters.length).toBe(Object.keys(params).length + 1);
    for (const p of manifest.parameters) if (p.name !== 'half_width') expect(p.unit).toBeNull();
  });
});

describe('manifestFromShape — hourglass-specific: shoulder<->hip cross-tie', () => {
  it('declares an Equal + a Radial dimension between the shoulder and hip arcs when both are still curves', () => {
    const shape = { preset: 'hourglass', seed: 42, params: {} };
    const manifest = manifestFromShape(shape, REGION);
    const seg1Id = 'seg1', seg3Id = 'seg3'; // default (no kink override): segment index === primitive index, both single-primitive
    const hasEqual = manifest.constraints.some((c) => c.type === 'Equal' && c.targets.includes(seg1Id) && c.targets.includes(seg3Id));
    expect(hasEqual).toBe(true);
    const dim = manifest.dimensions.find((d) => d.target === seg1Id && d.type === 'Radial');
    expect(dim.expression).toBe('corner_radius * half_width');
  });

  it('non-vacuous: kinking segment 1 removes its own Tangent AND the shoulder<->hip Equal (no radius to equate)', () => {
    // 12 segments (hourglass): override index 1 (the shoulder arc) to a
    // kink — matches _normalizeSegment's own accepted shape.
    const fresh = generateSilhouette(REGION, { preset: 'hourglass', seed: 42, params: {} }).segments;
    const overridden = fresh.map((s, i) => (i === 1 ? { style: 'kink', bulge: 0.3, dir: 'out', cornerRadius: 0 } : s));
    const shape = { preset: 'hourglass', seed: 42, params: {}, segments: overridden };
    const manifest = manifestFromShape(shape, REGION);

    // seg1's own two kink-Line ids are seg1/seg2 now (kink emits 2
    // primitives at that slot) — neither should carry a Tangent or the
    // shoulder<->hip Equal.
    const kinkIds = ['seg1', 'seg2'];
    const badTangent = manifest.constraints.some((c) => c.type === 'Tangent' && c.targets.some((t) => kinkIds.includes(t)));
    expect(badTangent).toBe(false);
    const badEqual = manifest.constraints.some((c) => c.type === 'Equal' && c.targets.some((t) => kinkIds.includes(t)) && c.targets.some((t) => t.startsWith('seg') && !kinkIds.includes(t) && manifest.entities.find((e) => e.id === t)?.type === 'ArcCenter'));
    expect(badEqual).toBe(false);
    expect(manifest.dimensions.some((d) => kinkIds.includes(d.target))).toBe(false);
  });
});

describe('buildSketchManifest — T64 carve-space placement (centered + Y-flipped)', () => {
  // The advisor's own real end-to-end Fusion measurement (NEXT-SESSION-
  // lane-b.md T64): a rect drawn at board x 2.5..4.5, y 3..4.5 on a 7x9
  // board lands, via the PLAIN-SVG carve path, at sketch bbox x -1..1,
  // y 0..1.5 -- i.e. x_carve = x_board - W/2, y_carve = H/2 - y_board.
  // build_constrained_sketch builds geometry directly (no SVG importer),
  // so it never got that transform for free; this suite proves
  // buildSketchManifest's own output already carries it, independently
  // re-derived from computePattern + fromLattice (natural space), not by
  // re-trusting applyCarvePlacement's own internals.
  const CARVE_PATTERN = {
    ...PATTERN_DEFAULTS, spacing: 0.25,
    rails: { mode: 'every', every: 2, offset: 0 },
    ties: { mode: 'density', density: 1, anchor: 'free', spanMin: 1, spanMax: 2, railSnapRows: 0 },
    nodes: { ends: false, crossings: false, railEnds: false },
    widths: { rails: 0.07, ties: 0.07, nodeRadius: 0.075, linkRailsTies: true },
    seed: 42,
  };
  // buildSketchManifest resolves its OWN board extent internally
  // (resolveBoardExtent, editor-sketch-manifest.js — not exported), from
  // `region`/`pattern.margin`/`pattern.spacing` via `toLattice` — the
  // SAME formula replicated here so the "independent" natural-space
  // re-run below uses the IDENTICAL extent the manifest itself actually
  // built against, not an arbitrarily-guessed one.
  function resolveBoardExtentForTest(pattern, region) {
    const spacing = pattern.spacing || PATTERN_DEFAULTS.spacing;
    const margin = pattern.margin ?? PATTERN_DEFAULTS.margin ?? 1;
    const topLeft = toLattice({ x: region.x, y: region.y }, spacing);
    const bottomRight = toLattice({ x: region.x + region.w, y: region.y + region.h }, spacing);
    return { iMin: topLeft.i + margin, jMin: topLeft.j + margin, iMax: bottomRight.i - margin, jMax: bottomRight.j - margin };
  }

  it('every rail Line lands at carve-space (x - W/2, H/2 - y), matching an independent natural-space re-run', () => {
    const extent = resolveBoardExtentForTest(CARVE_PATTERN, REGION);
    const { segments } = computePattern(CARVE_PATTERN, { extent, occupied: null });
    const rails = segments.filter((s) => s.kind === 'rail');
    expect(rails.length).toBeGreaterThan(0); // non-vacuous: this pattern actually produces rails to check

    const manifest = buildSketchManifest(CARVE_PATTERN, REGION, {});
    rails.forEach((seg, i) => {
      const naturalP1 = fromLattice(seg.a, CARVE_PATTERN.spacing);
      const naturalP2 = fromLattice(seg.b, CARVE_PATTERN.spacing);
      const e = manifest.entities.find((en) => en.id === `rail${i}`);
      expect(e.p1[0]).toBeCloseTo(naturalP1.x - REGION.w / 2, 9);
      expect(e.p1[1]).toBeCloseTo(REGION.h / 2 - naturalP1.y, 9);
      expect(e.p2[0]).toBeCloseTo(naturalP2.x - REGION.w / 2, 9);
      expect(e.p2[1]).toBeCloseTo(REGION.h / 2 - naturalP2.y, 9);
    });
  });

  it('reproduces the advisor\'s own exact measured example (x 2.5..4.5, y 3..4.5 -> x -1..1, y 0..1.5) via the raw transform formula', () => {
    // A direct, hand-computed check of the documented formula itself,
    // independent of any lattice/shape producer.
    const region = { x: 0, y: 0, w: 7, h: 9 };
    const p1 = { x: 2.5, y: 3 }, p2 = { x: 4.5, y: 4.5 };
    const c1 = { x: p1.x - region.w / 2, y: region.h / 2 - p1.y };
    const c2 = { x: p2.x - region.w / 2, y: region.h / 2 - p2.y };
    expect(c1).toEqual({ x: -1, y: 1.5 });
    expect(c2).toEqual({ x: 1, y: 0 });
    // i.e. bbox x [-1,1], y [0,1.5] -- exactly the advisor's own reported numbers.
  });

  it('T65: a Shape Lattice arc entity becomes Arc3Point after carve placement (advisor\'s own real Fusion run measured the old angle-negation approach as WRONG) -- its 3 defining points independently re-derived in natural space, then transformed', () => {
    const shapePattern = {
      ...CARVE_PATTERN,
      extent: { mode: 'boundary' },
      shape: { source: 'generated', preset: 'hourglass', seed: 42, params: {}, segments: null },
    };
    const { primitives } = generateSilhouette(REGION, shapePattern.shape);
    const arcPrim = primitives.find((p) => p.type === 'A');
    expect(arcPrim).toBeTruthy(); // non-vacuous: the hourglass preset genuinely has arcs to check

    const manifest = buildSketchManifest(shapePattern, REGION, {});
    const arcIndex = primitives.indexOf(arcPrim);
    const e = manifest.entities.find((en) => en.id === `seg${arcIndex}`);
    expect(e.type).toBe('Arc3Point');

    // Independent re-derivation: the arc's own 3 defining points in NATURAL
    // (pre-carve) board space, computed straight from the primitive's own
    // cx/cy/rx/theta1/dTheta (never touching toCarveArc3Point's own code),
    // then each one run through the documented raw transform formula.
    const toCarve = (pt) => ({ x: pt.x - REGION.w / 2, y: REGION.h / 2 - pt.y });
    const rawAt = (theta) => ({ x: arcPrim.cx + arcPrim.rx * Math.cos(theta), y: arcPrim.cy + arcPrim.rx * Math.sin(theta) });
    const expP1 = toCarve(rawAt(arcPrim.theta1));
    const expPMid = toCarve(rawAt(arcPrim.theta1 + arcPrim.dTheta / 2));
    const expP2 = toCarve(rawAt(arcPrim.theta1 + arcPrim.dTheta));

    expect(e.p1[0]).toBeCloseTo(expP1.x, 9);
    expect(e.p1[1]).toBeCloseTo(expP1.y, 9);
    expect(e.pMid[0]).toBeCloseTo(expPMid.x, 9);
    expect(e.pMid[1]).toBeCloseTo(expPMid.y, 9);
    expect(e.p2[0]).toBeCloseTo(expP2.x, 9);
    expect(e.p2[1]).toBeCloseTo(expP2.y, 9);
  });

  it('T65: every carve-placed arc\'s own start/end point coincides with its neighbouring line/arc\'s own matching end (dispatch\'s own acceptance test)', () => {
    const shapePattern = {
      ...CARVE_PATTERN,
      extent: { mode: 'boundary' },
      shape: { source: 'generated', preset: 'hourglass', seed: 42, params: {}, segments: null },
    };
    const manifest = buildSketchManifest(shapePattern, REGION, {});
    const arcs = manifest.entities.filter((e) => e.type === 'Arc3Point');
    expect(arcs.length).toBeGreaterThan(0); // non-vacuous
    // Every silhouette segment's own :E must land exactly on the NEXT
    // segment's own :S -- re-derived independently via pointOf (which for
    // Arc3Point reads e.p1/e.p2 directly, and for Line reads e.p1/e.p2 too),
    // so a wrong per-point transform (not just a wrong center) would show
    // up here as a broken chain, not just a wrong bbox.
    const silIds = manifest.groups.silhouette;
    expect(silIds.length).toBeGreaterThan(1);
    for (let i = 0; i < silIds.length; i++) {
      const endPt = pointOf(manifest.entities, `${silIds[i]}:E`);
      const nextStartPt = pointOf(manifest.entities, `${silIds[(i + 1) % silIds.length]}:S`);
      expect(endPt.x).toBeCloseTo(nextStartPt.x, 9);
      expect(endPt.y).toBeCloseTo(nextStartPt.y, 9);
    }
  });

  it('T65: the carve-placed silhouette\'s own bbox matches its natural-space bbox transformed through the SAME raw formula (independent of any per-entity type dispatch)', () => {
    const shapePattern = {
      ...CARVE_PATTERN,
      extent: { mode: 'boundary' },
      shape: { source: 'generated', preset: 'hourglass', seed: 42, params: {}, segments: null },
    };
    const { primitives } = generateSilhouette(REGION, shapePattern.shape);
    // Sample many points along the ORIGINAL (natural-space) primitives --
    // lines by their 2 endpoints, arcs by a dense angle sweep -- and bbox
    // those, entirely independent of buildSketchManifest/applyCarvePlacement.
    const rawPts = [];
    for (const p of primitives) {
      if (p.type === 'L') {
        rawPts.push({ x: p.p0.x, y: p.p0.y }, { x: p.p1.x, y: p.p1.y });
      } else if (p.type === 'A') {
        for (let k = 0; k <= 32; k++) {
          const theta = p.theta1 + (p.dTheta * k) / 32;
          rawPts.push({ x: p.cx + p.rx * Math.cos(theta), y: p.cy + p.rx * Math.sin(theta) });
        }
      }
    }
    expect(rawPts.length).toBeGreaterThan(0);
    const toCarve = (pt) => ({ x: pt.x - REGION.w / 2, y: REGION.h / 2 - pt.y });
    const carvePts = rawPts.map(toCarve);
    const expected = {
      minX: Math.min(...carvePts.map((p) => p.x)), maxX: Math.max(...carvePts.map((p) => p.x)),
      minY: Math.min(...carvePts.map((p) => p.y)), maxY: Math.max(...carvePts.map((p) => p.y)),
    };

    const manifest = buildSketchManifest(shapePattern, REGION, {});
    const sampled = [];
    for (const id of manifest.groups.silhouette) {
      const e = manifest.entities.find((en) => en.id === id);
      if (e.type === 'Line') sampled.push({ x: e.p1[0], y: e.p1[1] }, { x: e.p2[0], y: e.p2[1] });
      else if (e.type === 'Arc3Point') sampled.push({ x: e.p1[0], y: e.p1[1] }, { x: e.pMid[0], y: e.pMid[1] }, { x: e.p2[0], y: e.p2[1] });
    }
    // An arc's own extreme point (e.g. the top of a circle) can bulge past
    // its own start/mid/end sample points, so the ACTUAL bbox may exceed
    // this coarse sampling slightly for the manifest side too -- compare
    // against the SAME coarse 3-point sampling scheme applied to the
    // manifest's own arcs, not the 33-point-dense raw sampling above, by
    // re-deriving the coarse bbox from the SAME dense raw samples restricted
    // to k=0,16,32 (start/mid/end) for a fair apples-to-apples comparison.
    const coarseRawPts = [];
    for (const p of primitives) {
      if (p.type === 'L') coarseRawPts.push({ x: p.p0.x, y: p.p0.y }, { x: p.p1.x, y: p.p1.y });
      else if (p.type === 'A') {
        for (const k of [0, 16, 32]) {
          const theta = p.theta1 + (p.dTheta * k) / 32;
          coarseRawPts.push({ x: p.cx + p.rx * Math.cos(theta), y: p.cy + p.rx * Math.sin(theta) });
        }
      }
    }
    const coarseCarvePts = coarseRawPts.map(toCarve);
    const coarseExpected = {
      minX: Math.min(...coarseCarvePts.map((p) => p.x)), maxX: Math.max(...coarseCarvePts.map((p) => p.x)),
      minY: Math.min(...coarseCarvePts.map((p) => p.y)), maxY: Math.max(...coarseCarvePts.map((p) => p.y)),
    };
    const actual = {
      minX: Math.min(...sampled.map((p) => p.x)), maxX: Math.max(...sampled.map((p) => p.x)),
      minY: Math.min(...sampled.map((p) => p.y)), maxY: Math.max(...sampled.map((p) => p.y)),
    };
    expect(actual.minX).toBeCloseTo(coarseExpected.minX, 6);
    expect(actual.maxX).toBeCloseTo(coarseExpected.maxX, 6);
    expect(actual.minY).toBeCloseTo(coarseExpected.minY, 6);
    expect(actual.maxY).toBeCloseTo(coarseExpected.maxY, 6);
    // And the manifest's own bbox must land WITHIN the densely-sampled
    // true bbox (never bulge past the real silhouette) -- the regression
    // this test actually guards: the advisor's reported bug had centers
    // landing OUTSIDE the board entirely (x -6.38..5.19 on a 7-wide board).
    expect(actual.minX).toBeGreaterThanOrEqual(expected.minX - 1e-6);
    expect(actual.maxX).toBeLessThanOrEqual(expected.maxX + 1e-6);
  });

  it('H/V constraint TYPES are unaffected by the carve transform (a reflection in y alone cannot turn horizontal into vertical)', () => {
    const manifest = buildSketchManifest(CARVE_PATTERN, REGION, {});
    const hvCount = manifest.constraints.filter((c) => c.type === 'Horizontal' || c.type === 'Vertical').length;
    expect(hvCount).toBeGreaterThan(0); // non-vacuous
    for (const c of manifest.constraints) {
      if (c.type !== 'Horizontal' && c.type !== 'Vertical') continue;
      const e = manifest.entities.find((en) => en.id === c.targets[0]);
      if (c.type === 'Horizontal') expect(e.p1[1]).toBeCloseTo(e.p2[1], 9);
      else expect(e.p1[0]).toBeCloseTo(e.p2[0], 9);
    }
  });
});

describe('buildSketchManifest — composition', () => {
  it('a box lattice (no shape) has empty shape-groups and a populated lattice', () => {
    const pattern = { ...PATTERN_DEFAULTS, spacing: 0.25 };
    const manifest = buildSketchManifest(pattern, REGION, { layerId: 'L1' });
    expect(manifest.layerId).toBe('L1');
    expect(manifest.groups.silhouette).toBeUndefined();
    expect(manifest.entities.some((e) => e.id.startsWith('rail') || e.id.startsWith('tie'))).toBe(true);
    expect(typeof manifest.latticePieceCount).toBe('number');
  });

  it('a Shape Lattice layer clips its own lattice fill to the silhouette (non-vacuous: fewer pieces than the unclipped board)', () => {
    const basePattern = {
      ...PATTERN_DEFAULTS, spacing: 0.25,
      rails: { mode: 'every', every: 1, offset: 0 },
      ties: { mode: 'density', density: 1, anchor: 'free', spanMin: 1, spanMax: 1, railSnapRows: 0 },
    };
    const shapePattern = {
      ...basePattern,
      extent: { mode: 'boundary' },
      shape: { source: 'generated', preset: 'hourglass', seed: 42, params: {}, segments: null },
    };
    const boardManifest = buildSketchManifest(basePattern, REGION, {});
    const shapeManifest = buildSketchManifest(shapePattern, REGION, {});
    expect(shapeManifest.entities.some((e) => e.id.startsWith('seg'))).toBe(true); // silhouette entities present
    expect(shapeManifest.latticePieceCount).toBeLessThan(boardManifest.latticePieceCount); // genuinely clipped, not board-wide
  });

  it('T64 CHANGE: a plain box lattice (no shape) ALSO gets widthMode "slot" (Fred: "box lattice needs to be slots too") — Slot entities + SlotWidth dims, relationship constraints intact', () => {
    const pattern = {
      ...PATTERN_DEFAULTS, spacing: 0.25,
      rails: { mode: 'every', every: 8, offset: 0 },
      ties: { mode: 'density', density: 0.1, anchor: 'free', spanMin: 1, spanMax: 1, railSnapRows: 0 },
    };
    const manifest = buildSketchManifest(pattern, REGION, {});
    expect(manifest.latticePieceCount).toBeLessThan(SKETCH_PIECE_THRESHOLD); // non-vacuous: below threshold, so H/V constraints genuinely apply
    expect(manifest.widthMode).toBe('slot');
    expect(manifest.parameters.some((p) => p.name === 'stroke_width')).toBe(true);
    const railIds = manifest.entities.filter((e) => e.id.match(/^rail\d+$/)).map((e) => e.id);
    expect(railIds.length).toBeGreaterThan(0);
    for (const id of railIds) {
      expect(entityById(manifest.entities, id).type).toBe('Slot');
      expect(manifest.dimensions.some((d) => d.type === 'SlotWidth' && d.target === id)).toBe(true);
    }
    expect(manifest.constraints.some((c) => c.type === 'Horizontal' || c.type === 'Vertical')).toBe(true);
    // No silhouette entities at all -- this is a plain box lattice.
    expect(manifest.entities.some((e) => e.id.startsWith('seg'))).toBe(false);
  });

  it('T64: a Shape Lattice layer ALSO gets widthMode "slot" for its own lattice fill, plus the silhouette entities widthMode never touches', () => {
    const basePattern = {
      ...PATTERN_DEFAULTS, spacing: 0.25,
      rails: { mode: 'every', every: 1, offset: 0 },
      ties: { mode: 'density', density: 1, anchor: 'free', spanMin: 1, spanMax: 1, railSnapRows: 0 },
    };
    const shapePattern = {
      ...basePattern,
      extent: { mode: 'boundary' },
      shape: { source: 'generated', preset: 'hourglass', seed: 42, params: {}, segments: null },
    };
    const manifest = buildSketchManifest(shapePattern, REGION, {});
    expect(manifest.widthMode).toBe('slot');
    const railIds = manifest.entities.filter((e) => e.id.match(/^rail\d+$/)).map((e) => e.id);
    expect(railIds.length).toBeGreaterThan(0);
    expect(entityById(manifest.entities, railIds[0]).type).toBe('Slot');
    // The silhouette's own segments stay plain Line/ArcCenter, untouched
    // by widthMode (only rails/ties become slots — §4's own "the
    // silhouette's own boundary centerline is NOT separately offset by a
    // rail/tie/node width").
    expect(manifest.entities.some((e) => e.id.startsWith('seg') && (e.type === 'Line' || e.type === 'ArcCenter'))).toBe(true);
  });
});

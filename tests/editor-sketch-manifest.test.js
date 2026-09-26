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
import { primitivesBBox, insetRegionForContour } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-boundary.js';

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
  if (e.type === 'ArcCenter' || e.type === 'ArcCenterSlot') {
    const angle = (deg) => (deg * Math.PI) / 180;
    const at = (deg) => ({
      x: e.center[0] + e.radius * Math.cos(angle(deg)),
      y: e.center[1] + e.radius * Math.sin(angle(deg)),
    });
    if (suffix === 'S') return at(e.startAngleDeg);
    if (suffix === 'E') return at(e.startAngleDeg + e.sweepDeg);
    return { x: e.center[0], y: e.center[1] };
  }
  if (e.type === 'Arc3Point' || e.type === 'Arc3PointSlot') {
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
      // T73 AMEND 3: a shown contour now clips the lattice to the RAW
      // (wider) centerline instead of the contour-half-width inset this
      // T66 fixture was originally tuned against -- pinning contour.show
      // false here keeps this historical regression fixture reproducing
      // the SAME degenerate-piece geometry it always has, independent of
      // AMEND 3's own, unrelated change to the shown-contour case.
      contour: { show: false },
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

  it('T67 AMEND 3+4 (Fred: "ties needs to be coincident to their rails" -> refined to "one setting: number of one ended ties"): for the DEFAULT pattern (PATTERN_DEFAULTS.ties, unmodified), every tie has AT LEAST ONE end on a rail, exactly `oneEnded` (1) ties have their OTHER end free (no constraint at all), and every rail-touching end gets its own tie-on-rail Coincident', () => {
    const defaultPattern = { ...PATTERN_DEFAULTS, spacing: 0.25 };
    const extent = { iMin: 0, jMin: 0, iMax: 8, jMax: 8 };
    const manifest = manifestFromLattice(defaultPattern, extent);
    const railIds = manifest.entities.filter((e) => e.id.match(/^rail\d+$/)).map((e) => e.id);
    const tieIds = manifest.entities.filter((e) => e.id.match(/^tie\d+$/)).map((e) => e.id);
    expect(railIds.length).toBeGreaterThan(0); // non-vacuous
    expect(tieIds.length).toBeGreaterThan(0); // non-vacuous

    // Independent re-derivation: does each tie's own end land, by real
    // GEOMETRY (not by trusting the declared constraint), on some rail's
    // own y-coordinate, within that rail's own x-extent?
    const onAnyRail = (pt) => railIds.some((rid) => {
      const r = entityById(manifest.entities, rid);
      const [x1, y1] = r.p1, [x2, y2] = r.p2;
      return Math.abs(pt.y - y1) < 1e-9 && Math.abs(y1 - y2) < 1e-9
        && pt.x >= Math.min(x1, x2) - 1e-6 && pt.x <= Math.max(x1, x2) + 1e-6;
    });

    let oneEndedCount = 0;
    for (const tid of tieIds) {
      const tie = entityById(manifest.entities, tid);
      const p1 = { x: tie.p1[0], y: tie.p1[1] }, p2 = { x: tie.p2[0], y: tie.p2[1] };
      const p1OnRail = onAnyRail(p1), p2OnRail = onAnyRail(p2);
      expect(p1OnRail || p2OnRail).toBe(true); // never BOTH ends floating
      if (!p1OnRail || !p2OnRail) oneEndedCount++;

      const tieOnRailCount = manifest.constraints.filter((c) => c.type === 'Coincident'
        && (c.targets[0] === `${tid}:S` || c.targets[0] === `${tid}:E`)
        && railIds.some((rid) => c.targets[1] === rid || c.targets[1] === `${rid}:S` || c.targets[1] === `${rid}:E`)).length;
      // one Coincident per rail-touching end -- 2 for a rail-to-rail tie, 1 for a one-ended tie.
      expect(tieOnRailCount).toBe((p1OnRail ? 1 : 0) + (p2OnRail ? 1 : 0));
    }
    expect(oneEndedCount).toBe(PATTERN_DEFAULTS.ties.oneEnded);
  });

  it('T67 AMEND 3+4: for the DEFAULT SHAPE LATTICE pattern too (hourglass, unmodified PATTERN_DEFAULTS.ties), every tie has at least one end on a rail — never both ends floating — the boundary-clipping interaction (a pinched/non-convex shape) is specifically what this fixture exercises, unlike the box-lattice test above', () => {
    const shapePattern = {
      ...PATTERN_DEFAULTS, spacing: 0.25, seed: 42,
      extent: { mode: 'boundary' },
      shape: { source: 'generated', preset: 'hourglass', seed: 42, params: {}, segments: null },
    };
    const manifest = buildSketchManifest(shapePattern, REGION, {});
    const railIds = manifest.entities.filter((e) => e.id.match(/^rail\d+$/)).map((e) => e.id);
    const tieIds = manifest.entities.filter((e) => e.id.match(/^tie\d+$/)).map((e) => e.id);
    expect(railIds.length).toBeGreaterThan(0); // non-vacuous
    expect(tieIds.length).toBeGreaterThan(0); // non-vacuous

    const onAnyRail = (pt) => railIds.some((rid) => {
      const r = entityById(manifest.entities, rid);
      const [x1, y1] = r.p1, [x2, y2] = r.p2;
      return Math.abs(pt.y - y1) < 1e-6 && Math.abs(y1 - y2) < 1e-6
        && pt.x >= Math.min(x1, x2) - 1e-6 && pt.x <= Math.max(x1, x2) + 1e-6;
    });

    for (const tid of tieIds) {
      const tie = entityById(manifest.entities, tid);
      const p1 = { x: tie.p1[0], y: tie.p1[1] }, p2 = { x: tie.p2[0], y: tie.p2[1] };
      expect(onAnyRail(p1) || onAnyRail(p2)).toBe(true);
    }
  });

  it('T64 ADD-ON (amendment #1) / T67: every node sitting on a rail/tie gets an explicit Coincident FROM ITS OWN :C (centre) point to it — end-match uses :S/:E, mid-span match uses the bare (point-on-curve) id — except where T67\'s own dedup correctly drops a rail-match already implied transitively via a tie-end this node ALSO matches', () => {
    const manifest = manifestFromLattice(PATTERN, EXTENT);
    const nodeEntities = manifest.entities.filter((e) => e.id.match(/^node\d+$/));
    expect(nodeEntities.length).toBeGreaterThan(0); // non-vacuous: this pattern actually produces nodes

    // Independent re-derivation: does a node's own coordinate sit
    // EXACTLY at a piece's own end, or somewhere along its own span?
    const pieceEntities = manifest.entities.filter((e) => e.type === 'Slot');
    const railEntities2 = pieceEntities.filter((e) => e.id.match(/^rail\d+$/));
    const tieEntities2 = pieceEntities.filter((e) => e.id.match(/^tie\d+$/));
    const pointsEqual = (a, b) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
    const onSpan = (pt, p1, p2) => {
      if (Math.abs(p1.x - p2.x) < 1e-9) return Math.abs(pt.x - p1.x) < 1e-6 && pt.y >= Math.min(p1.y, p2.y) - 1e-6 && pt.y <= Math.max(p1.y, p2.y) + 1e-6;
      if (Math.abs(p1.y - p2.y) < 1e-9) return Math.abs(pt.y - p1.y) < 1e-6 && pt.x >= Math.min(p1.x, p2.x) - 1e-6 && pt.x <= Math.max(p1.x, p2.x) + 1e-6;
      return false;
    };
    // T67's own dedup only ever suppresses a RAIL-side target (never a
    // tie one) -- reconstructed here independently from the DECLARED
    // tie-on-rail constraints themselves, not from re-reading the
    // producer's own dedup code, so this stays an outside check.
    const railTargetIfDedupedViaTie = (node, rail) => tieEntities2.some((tie) => {
      const tieP1 = { x: tie.p1[0], y: tie.p1[1] }, tieP2 = { x: tie.p2[0], y: tie.p2[1] };
      for (const [suffix, tiePt] of [['S', tieP1], ['E', tieP2]]) {
        if (!pointsEqual({ x: node.center[0], y: node.center[1] }, tiePt)) continue;
        const tieTarget = `${tie.id}:${suffix}`;
        const wired = manifest.constraints.some((c) => c.type === 'Coincident'
          && c.targets[0] === tieTarget && (c.targets[1] === rail.id || c.targets[1] === `${rail.id}:S` || c.targets[1] === `${rail.id}:E`));
        if (wired) return true;
      }
      return false;
    });

    let endMatches = 0, curveMatches = 0, dedupedMatches = 0;
    for (const node of nodeEntities) {
      const nodePt = { x: node.center[0], y: node.center[1] };
      const nodeConstraints = manifest.constraints.filter((c) => c.type === 'Coincident' && c.targets[0] === `${node.id}:C`);
      for (const piece of pieceEntities) {
        const p1 = { x: piece.p1[0], y: piece.p1[1] }, p2 = { x: piece.p2[0], y: piece.p2[1] };
        const isRail = railEntities2.includes(piece);
        if (pointsEqual(nodePt, p1) || pointsEqual(nodePt, p2)) {
          const suffix = pointsEqual(nodePt, p1) ? 'S' : 'E';
          const hasDirect = nodeConstraints.some((c) => c.targets[1] === `${piece.id}:${suffix}`);
          if (!hasDirect && isRail && railTargetIfDedupedViaTie(node, piece)) { dedupedMatches++; continue; }
          expect(hasDirect).toBe(true);
          endMatches++;
        } else if (onSpan(nodePt, p1, p2)) {
          const hasDirect = nodeConstraints.some((c) => c.targets[1] === piece.id);
          if (!hasDirect && isRail && railTargetIfDedupedViaTie(node, piece)) { dedupedMatches++; continue; }
          expect(hasDirect).toBe(true);
          curveMatches++;
        }
      }
    }
    expect(endMatches).toBeGreaterThan(0); // non-vacuous: real end-matches exist in this fixture
    expect(curveMatches).toBeGreaterThan(0); // non-vacuous: real mid-span (crossing) matches exist too
    // T67: this PATTERN/EXTENT fixture (nodes.ends:true) genuinely
    // exercises the dedup path -- a node at a tie's own end that is
    // ALSO tie-on-rail-wired gets no SEPARATE, redundant node-to-rail
    // Coincident of its own; confirmed here rather than merely tolerated
    // (a broken dedup that removed EVERY rail match, not just the
    // transitively-implied ones, would still pass every check above but
    // would show up as a suspiciously large dedupedMatches count here).
    expect(dedupedMatches).toBeGreaterThan(0);
  });

  it('T67: a node\'s own dedup never drops the SAME rail relation it explains away — the tie-end -> rail edge it relies on is always still declared', () => {
    const manifest = manifestFromLattice(PATTERN, EXTENT);
    const nodeEntities = manifest.entities.filter((e) => e.id.match(/^node\d+$/));
    const pieceEntities = manifest.entities.filter((e) => e.type === 'Slot');
    const railEntities3 = pieceEntities.filter((e) => e.id.match(/^rail\d+$/));
    const tieEntities3 = pieceEntities.filter((e) => e.id.match(/^tie\d+$/));
    const pointsEqual = (a, b) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

    let checked = 0;
    for (const node of nodeEntities) {
      const nodePt = { x: node.center[0], y: node.center[1] };
      for (const rail of railEntities3) {
        const railP1 = { x: rail.p1[0], y: rail.p1[1] }, railP2 = { x: rail.p2[0], y: rail.p2[1] };
        const isEnd = pointsEqual(nodePt, railP1) || pointsEqual(nodePt, railP2);
        if (!isEnd) continue;
        const suffix = pointsEqual(nodePt, railP1) ? 'S' : 'E';
        const hasDirect = manifest.constraints.some((c) => c.type === 'Coincident'
          && c.targets[0] === `${node.id}:C` && c.targets[1] === `${rail.id}:${suffix}`);
        if (hasDirect) continue; // not a deduped case -- nothing to check here
        const viaTie = tieEntities3.find((tie) => {
          const tp1 = { x: tie.p1[0], y: tie.p1[1] }, tp2 = { x: tie.p2[0], y: tie.p2[1] };
          return pointsEqual(nodePt, tp1) || pointsEqual(nodePt, tp2);
        });
        expect(viaTie).toBeTruthy(); // this WAS a deduped case -- a tie-end match must exist
        const tieSuffix = pointsEqual(nodePt, { x: viaTie.p1[0], y: viaTie.p1[1] }) ? 'S' : 'E';
        const tieToRailStillDeclared = manifest.constraints.some((c) => c.type === 'Coincident'
          && c.targets[0] === `${viaTie.id}:${tieSuffix}` && (c.targets[1] === rail.id || c.targets[1] === `${rail.id}:S` || c.targets[1] === `${rail.id}:E`));
        expect(tieToRailStillDeclared).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0); // non-vacuous: real deduped cases exist in this fixture
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
    // T72 (SKETCH_PIECE_THRESHOLD raised 60 -> 300): a big-enough extent to
    // clear the new, higher threshold with real headroom.
    const bigExtent = { iMin: 0, jMin: 0, iMax: 200, jMax: 200 };
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
  it('T69: entities match generateSilhouette primitives 1:1 (independent re-run) -- default contour width mode is now slot', () => {
    const shape = { preset, seed: 42, params: {} };
    const { primitives } = generateSilhouette(REGION, shape);
    const manifest = manifestFromShape(shape, REGION);
    // T70 AMEND 3: manifest.entities can ALSO carry a non-primitive-derived
    // mirror-axis construction Line now -- filter to the per-primitive
    // `seg*` entities specifically, rather than asserting an exact overall
    // count that a structural (not per-segment) entity would break.
    const segEntities = manifest.entities.filter((e) => e.id.startsWith('seg'));
    expect(segEntities.length).toBe(primitives.length);
    primitives.forEach((prim, i) => {
      const e = entityById(manifest.entities, `seg${i}`);
      if (prim.type === 'L') {
        expect(e.type).toBe('Slot');
        expect(e.p1).toEqual([prim.p0.x, prim.p0.y]);
        expect(e.p2).toEqual([prim.p1.x, prim.p1.y]);
      } else {
        expect(e.type).toBe('ArcCenterSlot');
        expect(e.center).toEqual([prim.cx, prim.cy]);
        expect(e.radius).toBeCloseTo(prim.rx, 9);
        expect(e.startAngleDeg).toBeCloseTo((prim.theta1 * 180) / Math.PI, 9);
        expect(e.sweepDeg).toBeCloseTo((prim.dTheta * 180) / Math.PI, 9);
      }
      expect(e.width).toBeGreaterThan(0);
      expect(manifest.dimensions.some((d) => d.type === 'SlotWidth' && d.target === e.id && d.expression === 'stroke_width')).toBe(true);
    });
  });

  it('T69: widthMode "centerline" is still a real, available alternative -- plain Line/ArcCenter, no width, no SlotWidth dims', () => {
    const shape = { preset, seed: 42, params: {} };
    const { primitives } = generateSilhouette(REGION, shape);
    const manifest = manifestFromShape(shape, REGION, { widthMode: 'centerline' });
    primitives.forEach((prim, i) => {
      const e = entityById(manifest.entities, `seg${i}`);
      expect(e.type).toBe(prim.type === 'L' ? 'Line' : 'ArcCenter');
      expect(e.width).toBeUndefined();
    });
    expect(manifest.dimensions.some((d) => d.type === 'SlotWidth')).toBe(false);
    expect(manifest.parameters.some((p) => p.name === 'stroke_width')).toBe(false);
  });

  it('every Coincident constraint is a genuinely shared point (independent coordinate check)', () => {
    const shape = { preset, seed: 42, params: {} };
    const manifest = manifestFromShape(shape, REGION);
    // T71: no mirror axis / Coincident-to-origin exists any more at all
    // (see the "loose contour" describe block below) -- this exclusion is
    // now a harmless no-op, kept only so this check still reads correctly
    // if that ever changes again.
    const coincidents = manifest.constraints.filter((c) => c.type === 'Coincident' && !c.targets.includes('origin'));
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
      expect(types.some((t) => t === 'ArcCenter' || t === 'ArcCenterSlot')).toBe(true);
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
      if (a.type === 'ArcCenter' || a.type === 'ArcCenterSlot') expect(a.radius).toBeCloseTo(b.radius, 6);
      else {
        const lenA = Math.hypot(a.p2[0] - a.p1[0], a.p2[1] - a.p1[1]);
        const lenB = Math.hypot(b.p2[0] - b.p1[0], b.p2[1] - b.p1[1]);
        expect(lenA).toBeCloseTo(lenB, 6);
      }
    }
  });

  it('parameters carry the resolved params (snake_case, unit:null) plus half_width/stroke_width (T69) plus (T71) contour_width/contour_height (unit:in)', () => {
    const shape = { preset, seed: 42, params: {} };
    const { params } = generateSilhouette(REGION, shape);
    const manifest = manifestFromShape(shape, REGION);
    const halfWidth = manifest.parameters.find((p) => p.name === 'half_width');
    expect(halfWidth.value).toBeCloseTo(REGION.w / 2, 9);
    expect(halfWidth.unit).toBe('in');
    const strokeWidth = manifest.parameters.find((p) => p.name === 'stroke_width');
    expect(strokeWidth.unit).toBe('in');
    // T71: the shoulder/waist Radial dims (and waist_radius, the parameter
    // that only ever existed to drive one) are gone entirely ("no radius
    // dims" -- Fred's own loose-contour ruling); contour_width/
    // contour_height (new, independent, plain-number parameters) replace
    // the old REFERENCED-only widthIn/heightIn as this function's own
    // size-dimension drivers -- both presets get both (a generic mirror-
    // pair + self-mirror-horizontal-edge discovery, not hourglass-only).
    const contourWidth = manifest.parameters.find((p) => p.name === 'contour_width');
    const contourHeight = manifest.parameters.find((p) => p.name === 'contour_height');
    expect(contourWidth.value).toBeCloseTo(REGION.w, 9);
    expect(contourWidth.unit).toBe('in');
    expect(contourHeight.value).toBeCloseTo(REGION.h, 9);
    expect(contourHeight.unit).toBe('in');
    const extra = 4; // half_width, stroke_width, contour_width, contour_height
    expect(manifest.parameters.length).toBe(Object.keys(params).length + extra);
    for (const p of manifest.parameters) {
      if (!['half_width', 'stroke_width', 'contour_width', 'contour_height'].includes(p.name)) expect(p.unit).toBeNull();
    }
  });

  it('T73 AMEND 1 (advisor, measured live in Fusion on main 660f417): the contour_width/contour_height Distance dims are anchored on the contour\'s OWN geometric extremes (min-x/max-x, min-y/max-y), never merely the first mirror pair a search happens to visit -- Bottle\'s NECK (narrower than its body) previously got forced to the full contour_width', () => {
    const shape = { preset, seed: 42, params: {} };
    const { primitives } = generateSilhouette(REGION, shape);
    const manifest = manifestFromShape(shape, REGION);

    // T74 AMEND 0: the width dim's own expression is now PER-PRESET (the
    // bottle's own body is a bodyWidth FRACTION of contour_width, so its
    // expression is 'contour_width * body_width', not the bare name) --
    // found by orientation, not by matching a specific expression string.
    const widthDim = manifest.dimensions.find((d) => d.type === 'Distance' && d.orientation === 'Horizontal');
    const heightDim = manifest.dimensions.find((d) => d.type === 'Distance' && d.orientation === 'Vertical');
    expect(widthDim).toBeDefined(); // non-vacuous
    expect(heightDim).toBeDefined();
    expect(widthDim.orientation).toBe('Horizontal');
    expect(heightDim.orientation).toBe('Vertical');

    const [wA, wB] = widthDim.targets.map((t) => pointOf(manifest.entities, t));
    const [hA, hB] = heightDim.targets.map((t) => pointOf(manifest.entities, t));
    // NOTE: the dim's own driven VALUE (region.w/h, already covered by the
    // "parameters carry..." test above) is NOT the same claim as "the raw,
    // undriven geometry already measures region.w/h apart" -- a Distance
    // dim is a DRIVING dimension; its whole job is to STRETCH whatever the
    // raw generated geometry measured (params like bodyWidth jitter narrower
    // than the full region on purpose) out to the declared value once Fusion
    // solves it. The bug was never "wrong VALUE" -- it's "wrong POINTS":
    // independent oracle, the anchor points must sit at the contour's own
    // TRUE geometric extremes (every Line primitive's own endpoints), never
    // an incidental mirror pair narrower than the shape's real widest/
    // tallest point (e.g. Bottle's neck).
    const xs = primitives.flatMap((p) => (p.type === 'L' ? [p.p0.x, p.p1.x] : []));
    const ys = primitives.flatMap((p) => (p.type === 'L' ? [p.p0.y, p.p1.y] : []));
    expect(Math.min(wA.x, wB.x)).toBeCloseTo(Math.min(...xs), 9);
    expect(Math.max(wA.x, wB.x)).toBeCloseTo(Math.max(...xs), 9);
    expect(Math.min(hA.y, hB.y)).toBeCloseTo(Math.min(...ys), 9);
    expect(Math.max(hA.y, hB.y)).toBeCloseTo(Math.max(...ys), 9);
  });

  it('T74 AMEND 0 (advisor, measured live in Fusion on 847f289: the bottle spawned 0.45in off): each size dim\'s own EXPRESSION evaluates (using the manifest\'s own declared parameter values) to exactly the distance between its two anchor points in the raw, undriven geometry -- a Distance dim is a DRIVING dimension, so a mismatch here means Fusion silently re-shapes the contour to whatever the expression DOES evaluate to, not what the points actually measure', () => {
    const shape = { preset, seed: 42, params: {} };
    const manifest = manifestFromShape(shape, REGION);
    const paramValue = Object.fromEntries(manifest.parameters.map((p) => [p.name, p.value]));
    const evalExpr = (expr) => expr.split('*').map((tok) => {
      const name = tok.trim();
      expect(name in paramValue).toBe(true); // non-vacuous: every token must be a REAL declared parameter
      return paramValue[name];
    }).reduce((a, b) => a * b, 1);

    const widthDim = manifest.dimensions.find((d) => d.type === 'Distance' && d.orientation === 'Horizontal');
    const heightDim = manifest.dimensions.find((d) => d.type === 'Distance' && d.orientation === 'Vertical');
    const [wA, wB] = widthDim.targets.map((t) => pointOf(manifest.entities, t));
    const [hA, hB] = heightDim.targets.map((t) => pointOf(manifest.entities, t));

    // A Fusion 'Horizontal'/'Vertical' Distance dim reads only the ONE
    // relevant axis between its two points, not the full point-to-point
    // distance -- matching AMEND 1's own oracle above.
    expect(evalExpr(widthDim.expression)).toBeCloseTo(Math.abs(wB.x - wA.x), 9);
    expect(evalExpr(heightDim.expression)).toBeCloseTo(Math.abs(hB.y - hA.y), 9);
  });
});

describe('manifestFromShape — hourglass-specific: shoulder<->hip cross-tie', () => {
  it('declares an Equal between the shoulder and hip arcs when both are still curves, but (T71) no Radial dimension -- "no radius dims" means no DRIVING dimension, not no relationship', () => {
    const shape = { preset: 'hourglass', seed: 42, params: {} };
    const manifest = manifestFromShape(shape, REGION);
    const seg1Id = 'seg1', seg3Id = 'seg3'; // default (no kink override): segment index === primitive index, both single-primitive
    const hasEqual = manifest.constraints.some((c) => c.type === 'Equal' && c.targets.includes(seg1Id) && c.targets.includes(seg3Id));
    expect(hasEqual).toBe(true);
    expect(manifest.dimensions.some((d) => d.target === seg1Id && d.type === 'Radial')).toBe(false);
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
    const badEqual = manifest.constraints.some((c) => c.type === 'Equal' && c.targets.some((t) => kinkIds.includes(t)) && c.targets.some((t) => {
      if (!t.startsWith('seg') || kinkIds.includes(t)) return false;
      const et = manifest.entities.find((e) => e.id === t)?.type;
      return et === 'ArcCenter' || et === 'ArcCenterSlot';
    }));
    expect(badEqual).toBe(false);
    // T69: a kink Line still gets its OWN SlotWidth dimension (every
    // contour Slot does, unconditionally) -- what this test actually
    // guards is the hourglass-specific RADIAL dimension (there's no
    // "radius" to drive once seg1 is a kink, not an arc), so this checks
    // only THAT type, not dimensions in general.
    expect(manifest.dimensions.some((d) => d.type === 'Radial' && kinkIds.includes(d.target))).toBe(false);
  });
});

describe('manifestFromShape — T71 (T69-fix-3): loose contour -- Symmetry/mirror-axis/Radial all removed, mirror pass reverted to plain Equal', () => {
  it('declares no Symmetry constraint, no mirrorAxis/horizontalAxis construction entity, and no Coincident-to-origin anchor at all', () => {
    const shape = { preset: 'hourglass', seed: 42, params: {} };
    const manifest = manifestFromShape(shape, REGION);
    expect(manifest.constraints.some((c) => c.type === 'Symmetry')).toBe(false);
    expect(manifest.entities.some((e) => e.id === 'mirrorAxis' || e.id === 'horizontalAxis')).toBe(false);
    expect(manifest.constraints.some((c) => c.type === 'Coincident' && c.targets.includes('origin'))).toBe(false);
  });

  it('declares no Radial dimension anywhere in the contour -- "no radius dims" (Fred), including the now-gone waist_radius parameter', () => {
    const shape = { preset: 'hourglass', seed: 42, params: {} };
    const manifest = manifestFromShape(shape, REGION);
    expect(manifest.dimensions.some((d) => d.type === 'Radial')).toBe(false);
    expect(manifest.parameters.some((p) => p.name === 'waist_radius')).toBe(false);
  });

  it('T71 required test (AMEND 7): every Distance dimension targets 2 POINTS (an "id:S"/"id:E" suffix on each), never a bare curve id', () => {
    const shape = { preset: 'hourglass', seed: 42, params: {} };
    const manifest = manifestFromShape(shape, REGION);
    const distances = manifest.dimensions.filter((d) => d.type === 'Distance');
    expect(distances.length).toBeGreaterThan(0); // non-vacuous
    for (const d of distances) {
      expect(d.targets.length).toBe(2);
      for (const t of d.targets) expect(t).toMatch(/:[SE]$/);
    }
  });

  it('a LINE mirror pair (seg0 horn-R <-> seg10 horn-L) gets a plain Equal, with no Symmetry alongside it -- T69\'s own ORIGINAL shape, T70\'s AMEND 3 fully reverted', () => {
    const shape = { preset: 'hourglass', seed: 42, params: {} };
    const manifest = manifestFromShape(shape, REGION);
    const hasEqual = manifest.constraints.some((c) => c.type === 'Equal' && c.targets.includes('seg0') && c.targets.includes('seg10'));
    expect(hasEqual).toBe(true);
    const hasSymmetry = manifest.constraints.some((c) => c.type === 'Symmetry'
      && c.targets.some((t) => t.startsWith('seg0')) && c.targets.some((t) => t.startsWith('seg10')));
    expect(hasSymmetry).toBe(false);
  });

  it('every arc-adjacency Tangent joint is declared, undeduped -- T70 AMEND 3\'s own mirror-redundant dedup reverted (advisor-confirmed judgment call)', () => {
    const shape = { preset: 'hourglass', seed: 42, params: {} };
    const manifest = manifestFromShape(shape, REGION);
    const tangents = manifest.constraints.filter((c) => c.type === 'Tangent');
    // Both halves of a mirror-symmetric joint pair are present now (T70
    // AMEND 3 kept only 4 of 8 candidate joints as "mirror-redundant";
    // reverting that dedup restores all 8).
    expect(tangents.length).toBe(8);
    const has12 = tangents.some((c) => c.targets.includes('seg1') && c.targets.includes('seg2'));
    const has89 = tangents.some((c) => c.targets.includes('seg8') && c.targets.includes('seg9'));
    expect(has12).toBe(true);
    expect(has89).toBe(true);
  });

  it('Equal([\'seg1\',\'seg9\']) (the shoulder mirror pair, dropped by T70 AMEND 4 since Symmetry-on-center made it redundant) is RESTORED now that Symmetry is gone entirely', () => {
    const shape = { preset: 'hourglass', seed: 42, params: {} };
    const manifest = manifestFromShape(shape, REGION);
    expect(manifest.constraints.some((c) => c.type === 'Equal' && c.targets.includes('seg1') && c.targets.includes('seg9'))).toBe(true);
  });

  it('the hip (seg3<->seg7) and waist (seg2<->seg8) mirror-Equal pairs are still declared too -- every valid mirror pair, uniformly, no exceptions', () => {
    const shape = { preset: 'hourglass', seed: 42, params: {} };
    const manifest = manifestFromShape(shape, REGION);
    expect(manifest.constraints.some((c) => c.type === 'Equal' && c.targets.includes('seg3') && c.targets.includes('seg7'))).toBe(true);
    expect(manifest.constraints.some((c) => c.type === 'Equal' && c.targets.includes('seg2') && c.targets.includes('seg8'))).toBe(true);
  });

  it('a horizontal point-to-point Distance dim (=contour_width, a NEW independent parameter) ties the contour\'s own left/right extreme corners, and a vertical one (=contour_height) ties its top/bottom extreme corners -- both driven by region.w/region.h, never widthIn/heightIn', () => {
    const shape = { preset: 'hourglass', seed: 42, params: {} };
    const { primitives } = generateSilhouette(REGION, shape);
    const manifest = manifestFromShape(shape, REGION);
    const widthDim = manifest.dimensions.find((c) => c.type === 'Distance' && c.orientation === 'Horizontal');
    expect(widthDim).toBeDefined();
    expect(widthDim.expression).toBe('contour_width');
    const heightDim = manifest.dimensions.find((c) => c.type === 'Distance' && c.orientation === 'Vertical');
    expect(heightDim).toBeDefined();
    expect(heightDim.expression).toBe('contour_height');
    // T73 AMEND 1: which SPECIFIC segment anchors each dim is no longer
    // asserted by hardcoded id -- the hourglass's 4 horn segments (the
    // top/bottom horn on each side) all sit at the identical left/right
    // extreme x, so any one of them is an equally valid, equally correct
    // anchor (the earlier hardcoded 'seg0'/'seg10' expectation was really
    // asserting an INCIDENTAL detail of the old, since-fixed mirror-pair
    // search order, not a real requirement). Assert the GEOMETRIC property
    // that actually matters instead: the anchor points sit at the
    // contour's own true min-x/max-x (width) and min-y/max-y (height).
    const [wA, wB] = widthDim.targets.map((t) => pointOf(manifest.entities, t));
    const [hA, hB] = heightDim.targets.map((t) => pointOf(manifest.entities, t));
    const xs = primitives.flatMap((p) => (p.type === 'L' ? [p.p0.x, p.p1.x] : []));
    const ys = primitives.flatMap((p) => (p.type === 'L' ? [p.p0.y, p.p1.y] : []));
    expect(Math.min(wA.x, wB.x)).toBeCloseTo(Math.min(...xs), 9);
    expect(Math.max(wA.x, wB.x)).toBeCloseTo(Math.max(...xs), 9);
    expect(Math.min(hA.y, hB.y)).toBeCloseTo(Math.min(...ys), 9);
    expect(Math.max(hA.y, hB.y)).toBeCloseTo(Math.max(...ys), 9);
    // The dims' own VALUES are independent numbers (region.w/region.h at
    // whatever region manifestFromShape was actually called with), never
    // an expression referencing the board's own widthIn/heightIn.
    expect(manifest.parameters.find((p) => p.name === 'contour_width').value).toBeCloseTo(REGION.w, 9);
    expect(manifest.parameters.find((p) => p.name === 'contour_height').value).toBeCloseTo(REGION.h, 9);
    expect(manifest.parameters.some((p) => p.name === 'widthIn' || p.name === 'heightIn')).toBe(false);
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
    // T71: buildSketchManifest now builds the contour from the board region
    // INSET by the declared contour-size margin (editor-lattice-boundary.js's
    // own insetRegionForContour) -- this independent re-derivation must use
    // the SAME region the manifest itself actually built from.
    const { primitives } = generateSilhouette(insetRegionForContour(REGION), shapePattern.shape);
    const arcPrim = primitives.find((p) => p.type === 'A');
    expect(arcPrim).toBeTruthy(); // non-vacuous: the hourglass preset genuinely has arcs to check

    const manifest = buildSketchManifest(shapePattern, REGION, {});
    const arcIndex = primitives.indexOf(arcPrim);
    const e = manifest.entities.find((en) => en.id === `seg${arcIndex}`);
    expect(e.type).toBe('Arc3PointSlot'); // T69: contour arcs default to slot mode now

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
    const arcs = manifest.entities.filter((e) => e.type === 'Arc3PointSlot');
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
    // T71: same inset region substitution as the arc test above.
    const { primitives } = generateSilhouette(insetRegionForContour(REGION), shapePattern.shape);
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
      if (e.type === 'Line' || e.type === 'Slot') sampled.push({ x: e.p1[0], y: e.p1[1] }, { x: e.p2[0], y: e.p2[1] });
      else if (e.type === 'Arc3Point' || e.type === 'Arc3PointSlot') sampled.push({ x: e.p1[0], y: e.p1[1] }, { x: e.pMid[0], y: e.pMid[1] }, { x: e.p2[0], y: e.p2[1] });
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

describe('buildSketchManifest — T71: the contour builds from the board region inset by the declared margin', () => {
  it('on the standard 7x9 test board, contour_width comes out to 6 and contour_height to 8 (board minus the 1in margin, 0.5in per side)', () => {
    const shapePattern = {
      ...PATTERN_DEFAULTS, spacing: 0.25,
      extent: { mode: 'boundary' },
      shape: { source: 'generated', preset: 'hourglass', seed: 42, params: {}, segments: null },
    };
    const manifest = buildSketchManifest(shapePattern, REGION, {});
    expect(REGION).toEqual({ x: 0, y: 0, w: 7, h: 9 }); // non-vacuous: this IS the standard test board
    expect(manifest.parameters.find((p) => p.name === 'contour_width').value).toBeCloseTo(6, 9);
    expect(manifest.parameters.find((p) => p.name === 'contour_height').value).toBeCloseTo(8, 9);
    // manifest.region (board-level metadata) and the carve placement both
    // still reflect the ORIGINAL, un-inset board -- only the contour's own
    // entities/dimensions shrink.
    expect(manifest.region).toEqual({ x: 0, y: 0, w: 7, h: 9 });
  });
});

describe('buildSketchManifest — T72: the default Bottle preset (and a deep-waist Hourglass) still generate a real lattice fill after T71\'s contour inset', () => {
  it('the default Bottle preset generates rails/ties, not an empty lattice (advisor-measured regression: 0 pieces on 8566623)', () => {
    const pattern = {
      ...PATTERN_DEFAULTS, spacing: 0.25,
      extent: { mode: 'boundary' },
      shape: { source: 'generated', preset: 'bottle', seed: 42, params: {}, segments: null },
    };
    const manifest = buildSketchManifest(pattern, REGION, {});
    expect(manifest.entities.some((e) => e.id.startsWith('rail'))).toBe(true);
    expect(manifest.entities.some((e) => e.id.startsWith('tie'))).toBe(true);
    expect(manifest.latticePieceCount).toBeGreaterThan(0);
  });

  it('a deep-waist Hourglass (waistReach 0.8, cornerRadius 0.4 -- the dispatch\'s own reported repro params) still generates rails', () => {
    const pattern = {
      ...PATTERN_DEFAULTS, spacing: 0.25,
      extent: { mode: 'boundary' },
      shape: { source: 'generated', preset: 'hourglass', seed: 42, params: { waistReach: 0.8, cornerRadius: 0.4 }, segments: null },
    };
    const manifest = buildSketchManifest(pattern, REGION, {});
    expect(manifest.entities.some((e) => e.id.startsWith('rail'))).toBe(true);
    expect(manifest.latticePieceCount).toBeGreaterThan(0);
  });

  it('stroke_width is declared exactly ONCE in the manifest\'s own parameters when rails/ties are linked (advisor-measured regression: declared twice on 8566623)', () => {
    const pattern = {
      ...PATTERN_DEFAULTS, spacing: 0.25,
      extent: { mode: 'boundary' },
      shape: { source: 'generated', preset: 'hourglass', seed: 42, params: {}, segments: null },
    };
    const manifest = buildSketchManifest(pattern, REGION, {});
    // Non-vacuous: BOTH producers genuinely have their own reason to
    // declare stroke_width here -- real lattice pieces (manifestFromLattice,
    // linked by default) AND a real contour (manifestFromShape, always) --
    // so without the dedup this would concretely be 2, not 1.
    expect(manifest.entities.some((e) => e.id.startsWith('rail'))).toBe(true);
    expect(manifest.entities.some((e) => e.id.startsWith('seg'))).toBe(true);
    expect(manifest.parameters.filter((p) => p.name === 'stroke_width').length).toBe(1);
  });
});

describe('buildSketchManifest — T72 (SE14c) + T73 AMEND 3: contour.show=false omits the contour from the manifest and keeps the OLD (contour-inset) lattice boundary; show=true clips the lattice fill to the contour\'s own wider, raw centerline instead', () => {
  function shapePattern(contour) {
    return {
      ...PATTERN_DEFAULTS, spacing: 0.25,
      extent: { mode: 'boundary' },
      shape: { source: 'generated', preset: 'hourglass', seed: 42, params: {}, segments: null },
      ...(contour ? { contour } : {}),
    };
  }

  it('ON (default, no contour key at all): contour entities/dims/params are present', () => {
    const manifest = buildSketchManifest(shapePattern(), REGION, {});
    expect(manifest.entities.some((e) => e.id.startsWith('seg'))).toBe(true);
    expect(manifest.contourWidthMode).toBe('slot');
    expect(manifest.parameters.some((p) => p.name === 'contour_width')).toBe(true);
    expect(manifest.dimensions.some((d) => d.expression === 'contour_width')).toBe(true);
  });

  it('OFF (contour.show:false): no seg* entities, no contour_width/height params/dims, contourWidthMode is null (matching the box-lattice "no contour" case exactly)', () => {
    const manifest = buildSketchManifest(shapePattern({ show: false }), REGION, {});
    expect(manifest.entities.some((e) => e.id.startsWith('seg'))).toBe(false);
    expect(manifest.constraints.some((c) => c.targets?.some?.((t) => typeof t === 'string' && t.startsWith('seg')))).toBe(false);
    expect(manifest.parameters.some((p) => p.name === 'contour_width' || p.name === 'contour_height')).toBe(false);
    expect(manifest.dimensions.some((d) => d.expression === 'contour_width' || d.expression === 'contour_height')).toBe(false);
    expect(manifest.contourWidthMode).toBeNull();
  });

  it('T73 AMEND 3 supersedes the ORIGINAL T72 invariant here: ON now clips the lattice fill to the contour\'s wider, RAW centerline (rails/ties reach it exactly, Fred\'s own "coincide to contour" ask), while OFF keeps the narrower, contour-half-width-inset boundary this describe block\'s OWN name still documents -- so the two are now deliberately DIFFERENT, never byte-identical', () => {
    const on = buildSketchManifest(shapePattern(), REGION, {});
    const off = buildSketchManifest(shapePattern({ show: false }), REGION, {});
    expect(on.latticePieceCount).toBeGreaterThan(0); // non-vacuous
    expect(off.latticePieceCount).toBeGreaterThan(0);
    // ON's own boundary is strictly WIDER (reaches the raw centerline
    // instead of stopping short by the contour's own half-stroke-width),
    // so it has room for at least as many lattice pieces as OFF, and for
    // this fixture strictly more.
    expect(on.latticePieceCount).toBeGreaterThan(off.latticePieceCount);
  });

  it('a saved pattern with no `contour` key at all reads as shown (true) -- pre-T72 patterns are unaffected', () => {
    // Simulates a pattern saved BEFORE T72 ever existed: PATTERN_DEFAULTS
    // itself always carries `contour` now, so `shapePattern()`'s own spread
    // would too -- this fixture explicitly omits it instead.
    const { contour: _unused, ...legacyDefaults } = PATTERN_DEFAULTS;
    const pattern = {
      ...legacyDefaults, spacing: 0.25,
      extent: { mode: 'boundary' },
      shape: { source: 'generated', preset: 'hourglass', seed: 42, params: {}, segments: null },
    };
    expect(pattern.contour).toBeUndefined(); // non-vacuous: genuinely absent, not defaulted by the test fixture
    const manifest = buildSketchManifest(pattern, REGION, {});
    expect(manifest.entities.some((e) => e.id.startsWith('seg'))).toBe(true);
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

  it('T64/T69: a Shape Lattice layer gets widthMode "slot" for its own lattice fill, AND (T69) its own silhouette contour becomes slots too (Fred: "want the shape contour to be made of slots")', () => {
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
    expect(manifest.contourWidthMode).toBe('slot');
    const railIds = manifest.entities.filter((e) => e.id.match(/^rail\d+$/)).map((e) => e.id);
    expect(railIds.length).toBeGreaterThan(0);
    expect(entityById(manifest.entities, railIds[0]).type).toBe('Slot');
    // T69: the silhouette's own segments are NOW slots too -- a Line
    // becomes 'Slot' (the EXACT same entity/dimension shape a rail/tie
    // slot already uses), an arc becomes 'Arc3PointSlot' (post-carve) --
    // driven by the SAME 'stroke_width' expression rails/ties use when
    // linked, per the dispatch's own "same param as rails/ties" ask.
    const segIds = manifest.entities.filter((e) => e.id.startsWith('seg')).map((e) => e.id);
    expect(segIds.length).toBeGreaterThan(0);
    for (const id of segIds) {
      const e = entityById(manifest.entities, id);
      expect(e.type === 'Slot' || e.type === 'Arc3PointSlot').toBe(true);
      expect(manifest.dimensions.some((d) => d.type === 'SlotWidth' && d.target === id && d.expression === 'stroke_width')).toBe(true);
    }
  });

  it('T69: a box lattice layer (no shape at all) never gets a contourWidthMode -- there is no contour to have one', () => {
    const pattern = { ...PATTERN_DEFAULTS, spacing: 0.25 };
    const manifest = buildSketchManifest(pattern, REGION, {});
    expect(manifest.contourWidthMode).toBeNull();
  });
});

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
  buildSketchManifest, manifestFromLattice, manifestFromShape, SKETCH_PIECE_THRESHOLD,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-sketch-manifest.js';
import { computePattern, PATTERN_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { fromLattice } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice.js';
import { generateSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';

const REGION = { x: 0, y: 0, w: 7, h: 9 };

function entityById(entities, id) {
  return entities.find((e) => e.id === id);
}

function pointOf(entities, target) {
  // target is an id, or "id:S"/"id:E" for a Line/ArcCenter's own endpoint.
  const [id, suffix] = target.split(':');
  const e = entityById(entities, id);
  if (!e) return null;
  if (e.type === 'Line') {
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
  if (e.type === 'Circle') return { x: e.center[0], y: e.center[1] };
  return null;
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

    const railEntities = manifest.entities.filter((e) => e.id.startsWith('rail') && e.type === 'Line');
    expect(railEntities.length).toBe(rails.length);
    rails.forEach((seg, i) => {
      const p1 = fromLattice(seg.a, PATTERN.spacing), p2 = fromLattice(seg.b, PATTERN.spacing);
      const e = entityById(manifest.entities, `rail${i}`);
      expect(e.p1).toEqual([p1.x, p1.y]);
      expect(e.p2).toEqual([p2.x, p2.y]);
    });
    const tieEntities = manifest.entities.filter((e) => e.id.startsWith('tie') && e.type === 'Line');
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
    const railTieIds = manifest.entities.filter((e) => e.type === 'Line' && !e.id.includes('_cap')).map((e) => e.id);
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

    // Positive: every declared Coincident really touches a rail.
    const coincidents = manifest.constraints.filter((c) => c.type === 'Coincident');
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

  it('width offsets (two per kind, +/- half) and round caps (two per piece, perpendicular endpoints)', () => {
    const manifest = manifestFromLattice(PATTERN, EXTENT);
    const railIds = manifest.entities.filter((e) => e.id.match(/^rail\d+$/)).map((e) => e.id);
    const railOffsetPos = manifest.dimensions.find((d) => d.id === 'rail_offset_pos');
    const railOffsetNeg = manifest.dimensions.find((d) => d.id === 'rail_offset_neg');
    expect(railOffsetPos.targets.sort()).toEqual(railIds.slice().sort());
    expect(railOffsetNeg.targets.sort()).toEqual(railIds.slice().sort());
    expect(railOffsetPos.expression).toBe('rail_width / 2');
    expect(railOffsetNeg.expression).toBe('-(rail_width / 2)');

    for (const id of railIds) {
      const capA = entityById(manifest.entities, `${id}_capA`);
      const capB = entityById(manifest.entities, `${id}_capB`);
      expect(capA.type).toBe('ArcCenter');
      expect(capB.type).toBe('ArcCenter');
      expect(capA.sweepDeg).toBe(180);
      const rail = entityById(manifest.entities, id);
      const [x1, y1] = rail.p1, [x2, y2] = rail.p2;
      const dirX = x2 - x1, dirY = y2 - y1;
      // The cap's own two endpoints must sit exactly `radius` from its
      // center AND be perpendicular to the rail's own direction (a
      // rounded line cap's diameter is perpendicular to the line it
      // caps) — independent check via dot product, not re-using capArc.
      const rad = (d) => (d * Math.PI) / 180;
      const sPt = { x: capA.center[0] + capA.radius * Math.cos(rad(capA.startAngleDeg)), y: capA.center[1] + capA.radius * Math.sin(rad(capA.startAngleDeg)) };
      const ePt = { x: capA.center[0] + capA.radius * Math.cos(rad(capA.startAngleDeg + capA.sweepDeg)), y: capA.center[1] + capA.radius * Math.sin(rad(capA.startAngleDeg + capA.sweepDeg)) };
      const chordX = ePt.x - sPt.x, chordY = ePt.y - sPt.y;
      expect(Math.abs(chordX * dirX + chordY * dirY)).toBeLessThan(1e-6); // perpendicular
      expect(Math.hypot(ePt.x - sPt.x, ePt.y - sPt.y)).toBeCloseTo(2 * capA.radius, 6); // a true diameter
      // Radial dimension drives the SAME parameter the offset does.
      const radDim = manifest.dimensions.find((d) => d.type === 'Radial' && d.target === capA.id);
      expect(radDim.expression).toBe('rail_width / 2');
    }
  });

  it('>=SKETCH_PIECE_THRESHOLD pieces: no per-piece H/V/Coincident constraints, but caps/dimensions still present', () => {
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
    // The width/offset/cap mechanism is NOT gated by the threshold (§6).
    expect(manifest.dimensions.some((d) => d.id === 'rail_offset_pos')).toBe(true);
    const railCount = manifest.entities.filter((e) => e.id.match(/^rail\d+$/)).length;
    const capCount = manifest.entities.filter((e) => e.id.match(/^rail\d+_cap[AB]$/)).length;
    expect(capCount).toBe(railCount * 2);
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
});

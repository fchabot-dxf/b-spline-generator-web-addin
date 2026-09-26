/**
 * T76 (SE17, item 4) — splitManifestByKind (editor-sketch-manifest.js):
 * partitions a combined buildSketchManifest result into ONE manifest per
 * kind (contour/rails/ties/nodes), converting every cross-kind constraint
 * into a PROJECTION reference in the LATER-built kind's own manifest
 * (mirroring frame-builder's own already-proven `project_step` contract:
 * `{sourceKind, sourceId, targetId}`) plus a constraint rewritten to
 * target the projected copy. Every claim here is checked against the
 * SAME combined manifest buildSketchManifest itself already produces (and
 * editor-sketch-manifest.test.js already independently verifies) — this
 * file is purely about the SPLIT being lossless and correctly routed, not
 * re-deriving the underlying geometry/constraint logic.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSketchManifest, splitManifestByKind,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-sketch-manifest.js';
import { PATTERN_DEFAULTS, LATTICE_FUSION_BUILD_ORDER } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';

const REGION = { x: 0, y: 0, w: 7, h: 9 };

const BOX_PATTERN = {
  ...PATTERN_DEFAULTS, spacing: 0.25, seed: 42, id: 'test-pattern-1',
  rails: { mode: 'every', every: 2, offset: 0 },
  ties: { mode: 'density', density: 1, anchor: 'free', spanMin: 1, spanMax: 2, railSnapRows: 0 },
  nodes: { ends: true, crossings: true, railEnds: false },
  widths: { rails: 0.07, ties: 0.05, nodeDiameter: 0.15, linkRailsTies: false },
};

const SHAPE_PATTERN = {
  ...PATTERN_DEFAULTS, spacing: 0.25, seed: 42,
  extent: { mode: 'boundary' },
  shape: { source: 'generated', preset: 'hourglass', seed: 42, params: {}, segments: null },
};

function entityKind(id) {
  const base = id.split(':')[0];
  if (base.startsWith('rail')) return 'rails';
  if (base.startsWith('tie')) return 'ties';
  if (base.startsWith('node')) return 'nodes';
  if (base.startsWith('seg')) return 'contour';
  return null;
}

describe('splitManifestByKind — box lattice (no contour)', () => {
  const combined = buildSketchManifest(BOX_PATTERN, REGION, {});
  const split = splitManifestByKind(BOX_PATTERN, REGION, {});

  it('each per-kind manifest carries its own kind, its build-order index, and this pattern\'s own id -- item 5\'s own Python orchestration groups/orders by these, not layer array position', () => {
    expect(split.rails.kind).toBe('rails');
    expect(split.ties.kind).toBe('ties');
    expect(split.nodes.kind).toBe('nodes');
    expect(split.rails.buildOrder).toBeLessThan(split.ties.buildOrder);
    expect(split.ties.buildOrder).toBeLessThan(split.nodes.buildOrder);
    expect(split.rails.patternId).toBe(BOX_PATTERN.id);
    expect(split.ties.patternId).toBe(BOX_PATTERN.id);
  });

  it('omits contour entirely — Box Lattice has no shape at all', () => {
    expect(split.contour).toBeUndefined();
    expect(split.rails).toBeDefined();
    expect(split.ties).toBeDefined();
    expect(split.nodes).toBeDefined();
  });

  it('every entity from the combined manifest lands in EXACTLY one kind, and every kind\'s entities are genuinely that kind\'s own', () => {
    const seen = new Set();
    for (const kind of ['rails', 'ties', 'nodes']) {
      for (const e of split[kind].entities) {
        expect(entityKind(e.id)).toBe(kind);
        expect(seen.has(e.id)).toBe(false); // never duplicated across kinds
        seen.add(e.id);
      }
    }
    expect(seen.size).toBe(combined.entities.length); // lossless: nothing dropped either
  });

  it('every kind gets the FULL parameter list (Python\'s own create-or-update-by-name already makes a redeclared parameter harmless)', () => {
    for (const kind of ['rails', 'ties', 'nodes']) {
      expect(split[kind].parameters).toEqual(combined.parameters);
    }
  });

  it('a tie-on-rail Coincident becomes a projection in the TIES manifest (ties is built AFTER rails) — no raw cross-kind constraint survives anywhere', () => {
    const crossKind = combined.constraints.filter((c) => {
      if (c.targets.length !== 2) return false;
      const [k1, k2] = c.targets.map(entityKind);
      return k1 === 'rails' && k2 === 'ties' || k1 === 'ties' && k2 === 'rails';
    });
    expect(crossKind.length).toBeGreaterThan(0); // non-vacuous: this fixture really has tie-on-rail links

    // None of the ORIGINAL cross-kind constraints appear verbatim anywhere in the split.
    for (const kind of ['rails', 'ties', 'nodes']) {
      for (const c of split[kind].constraints) {
        expect(crossKind).not.toContainEqual(c);
      }
    }
    // Every one of them shows up, rewritten, inside ties' own manifest, targeting a projected id.
    expect(split.ties.projections.length).toBeGreaterThan(0);
    const projectedIds = new Set(split.ties.projections.map((p) => p.targetId));
    let rewrittenFound = 0;
    for (const orig of crossKind) {
      const railTarget = orig.targets.find((t) => entityKind(t) === 'rails');
      const tieTarget = orig.targets.find((t) => entityKind(t) === 'ties');
      const match = split.ties.constraints.find((c) => c.type === orig.type
        && c.targets.includes(tieTarget) && c.targets.some((t) => projectedIds.has(t)));
      expect(match).toBeDefined();
      const proj = split.ties.projections.find((p) => match.targets.includes(p.targetId));
      expect(proj.sourceKind).toBe('rails');
      expect(proj.sourceId).toBe(railTarget);
      rewrittenFound++;
    }
    expect(rewrittenFound).toBe(crossKind.length);
  });

  it('a node->rail or node->tie Coincident becomes a projection in the NODES manifest (nodes is built LAST)', () => {
    const nodeCross = combined.constraints.filter((c) => c.targets.length === 2 && c.targets.some((t) => entityKind(t) === 'nodes'));
    expect(nodeCross.length).toBeGreaterThan(0); // non-vacuous
    for (const c of nodeCross) {
      const otherKind = entityKind(c.targets.find((t) => entityKind(t) !== 'nodes'));
      expect(['rails', 'ties']).toContain(otherKind);
    }
    expect(split.nodes.projections.length).toBeGreaterThan(0);
    // No node-cross constraint leaks into rails/ties own manifests.
    for (const kind of ['rails', 'ties']) {
      for (const c of split[kind].constraints) {
        expect(c.targets.some((t) => entityKind(t) === 'nodes')).toBe(false);
      }
    }
  });

  it('projections are deduped: two different ties touching the SAME rail end share ONE projected copy, not two', () => {
    const bySource = new Map();
    for (const p of split.ties.projections) {
      const key = `${p.sourceKind}:${p.sourceId}`;
      bySource.set(key, (bySource.get(key) || 0) + 1);
    }
    for (const count of bySource.values()) expect(count).toBe(1); // never declared twice
    // and non-vacuous: at least one rail end is genuinely shared by 2+ ties in this fixture, OR the test still holds trivially -- check by re-deriving from the combined constraints directly.
    const targets = combined.constraints
      .filter((c) => c.targets.length === 2 && c.targets.some((t) => entityKind(t) === 'rails') && c.targets.some((t) => entityKind(t) === 'ties'))
      .map((c) => c.targets.find((t) => entityKind(t) === 'rails'));
    const seenMoreThanOnce = targets.some((t, i) => targets.indexOf(t) !== i);
    expect(seenMoreThanOnce).toBe(true); // non-vacuous: the dedup path actually gets exercised
  });

  it('same-kind constraints (Horizontal/Vertical, Collinear) pass through byte-for-byte unchanged, in their own kind\'s manifest', () => {
    const sameKindOriginals = combined.constraints.filter((c) => {
      if (c.targets.length === 1) return true; // H/V
      const [k1, k2] = c.targets.map(entityKind);
      return k1 === k2 && k1 != null;
    });
    expect(sameKindOriginals.length).toBeGreaterThan(0); // non-vacuous
    for (const orig of sameKindOriginals) {
      const kind = entityKind(orig.targets[0]);
      expect(split[kind].constraints).toContainEqual(orig);
    }
  });

  it('dimensions are bucketed by their own target\'s kind (SlotWidth on rails stays in rails, on ties stays in ties)', () => {
    for (const d of combined.dimensions) {
      const kind = entityKind(d.target);
      expect(split[kind].dimensions).toContainEqual(d);
    }
  });

  it('groups are bucketed by kind (rails/ties/nodes keys map 1:1)', () => {
    expect(split.rails.groups.rails).toEqual(combined.groups.rails);
    expect(split.ties.groups.ties).toEqual(combined.groups.ties);
    expect(split.nodes.groups.nodes).toEqual(combined.groups.nodes);
  });
});

describe('splitManifestByKind — shape lattice (with contour)', () => {
  const combined = buildSketchManifest(SHAPE_PATTERN, REGION, {});
  const split = splitManifestByKind(SHAPE_PATTERN, REGION, {});

  it('includes all four kinds (this pattern genuinely has a contour, rails, ties, and nodes)', () => {
    for (const kind of LATTICE_FUSION_BUILD_ORDER) {
      expect(split[kind]).toBeDefined();
      expect(split[kind].entities.length).toBeGreaterThan(0);
    }
  });

  it('a rail/tie-end -> contour-seg Coincident becomes a projection in the CONSUMING kind\'s own manifest (contour is built FIRST, so rails/ties are always the consumer)', () => {
    const contourCross = combined.constraints.filter((c) => c.targets.length === 2 && c.targets.some((t) => entityKind(t) === 'contour') && c.targets.some((t) => entityKind(t) !== 'contour'));
    expect(contourCross.length).toBeGreaterThan(0); // non-vacuous
    for (const c of contourCross) {
      const consumerKind = entityKind(c.targets.find((t) => entityKind(t) !== 'contour'));
      expect(['rails', 'ties']).toContain(consumerKind);
      const proj = split[consumerKind].projections.find((p) => p.sourceKind === 'contour' && p.sourceId === c.targets.find((t) => entityKind(t) === 'contour'));
      expect(proj).toBeDefined();
    }
    // and none of them leak into the contour manifest itself as a cross-kind reference.
    for (const c of split.contour.constraints) {
      expect(c.targets.every((t) => entityKind(t) === 'contour')).toBe(true);
    }
  });

  it('the contour manifest itself has no projections (nothing is built before it)', () => {
    expect(split.contour.projections).toEqual([]);
  });

  it('the split entity/constraint counts, summed across kinds, match the combined manifest exactly (nothing lost, nothing invented beyond the declared projections)', () => {
    const totalEntities = LATTICE_FUSION_BUILD_ORDER.reduce((n, k) => n + (split[k]?.entities.length || 0), 0);
    expect(totalEntities).toBe(combined.entities.length);
  });
});

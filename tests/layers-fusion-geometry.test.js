/**
 * SE12 T36 — the ONE declared fusionGeometry field (not two: an earlier
 * design draft had a separate outline:boolean, but 'centerline' already
 * IS "no outline" — one concept, one field, per the advisor's revision).
 * Default 'centerline' (today's only behavior) means NO migration is
 * needed: applyToolingDefaults, the same mechanism every new layer and
 * every restore-from-save path already runs through, backfills it.
 */
import { describe, it, expect } from 'vitest';
import {
  FUSION_GEOMETRY, TOOLING_DEFAULTS, applyToolingDefaults, showsOutline,
} from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';

describe('FUSION_GEOMETRY (declared data table)', () => {
  it('has exactly the three values the dispatch names, each with a label and a hint', () => {
    const values = FUSION_GEOMETRY.map((g) => g.value);
    expect(values).toEqual(['centerline', 'outline', 'both']);
    for (const g of FUSION_GEOMETRY) {
      expect(typeof g.label).toBe('string');
      expect(g.label.length).toBeGreaterThan(0);
      expect(typeof g.hint).toBe('string');
      expect(g.hint.length).toBeGreaterThan(0);
    }
  });
});

describe('fusionGeometry default (no migration needed)', () => {
  it('TOOLING_DEFAULTS declares centerline', () => {
    expect(TOOLING_DEFAULTS.fusionGeometry).toBe('centerline');
  });

  it('a brand-new layer object (applyToolingDefaults, same call addLayer makes) gets centerline', () => {
    const layer = applyToolingDefaults({ id: '1', name: 'Layer 1' });
    expect(layer.fusionGeometry).toBe('centerline');
  });

  it('an OLD saved layer with no fusionGeometry key at all (pre-T36 document) also backfills to centerline, through the exact same call editor-io.js\'s restore path already uses — no new migration entry', () => {
    const oldSavedLayer = { id: '2', name: 'Layer 2', visible: true, depth: 0.3, profile: 'ballnose' };
    expect('fusionGeometry' in oldSavedLayer).toBe(false);
    const restored = applyToolingDefaults(oldSavedLayer);
    expect(restored.fusionGeometry).toBe('centerline');
  });

  it('non-vacuous: a layer that already HAS a fusionGeometry value keeps it — applyToolingDefaults fills gaps, never overwrites', () => {
    const layer = applyToolingDefaults({ id: '3', fusionGeometry: 'outline' });
    expect(layer.fusionGeometry).toBe('outline');
  });

  it('persists through a save/restore round-trip — the actual encode editor-io.js uses for data-editor-layers (JSON.stringify then &quot;-escaped, per the layer-carve-flag migration\'s own precedent)', () => {
    const layers = [
      { id: '1', name: 'A', visible: true, fusionGeometry: 'outline' },
      { id: '2', name: 'B', visible: true, fusionGeometry: 'both' },
    ];
    const encoded = JSON.stringify(layers).replace(/"/g, '&quot;');
    const decoded = JSON.parse(encoded.replace(/&quot;/g, '"'));
    expect(decoded[0].fusionGeometry).toBe('outline');
    expect(decoded[1].fusionGeometry).toBe('both');
  });
});

describe('showsOutline(l) — the compound gate the dispatch specifies exactly', () => {
  it('true for a visible layer picked outline or both', () => {
    expect(showsOutline({ visible: true, fusionGeometry: 'outline' })).toBe(true);
    expect(showsOutline({ visible: true, fusionGeometry: 'both' })).toBe(true);
  });

  it('false for a visible layer left on the default centerline', () => {
    expect(showsOutline({ visible: true, fusionGeometry: 'centerline' })).toBe(false);
  });

  it('false for a layer with no fusionGeometry key at all (pre-T36, pre-applyToolingDefaults) — undefined !== \'centerline\' textually, but this must still read as "no outline"', () => {
    // This is the one non-obvious case: showsOutline is a raw field read
    // (matching isCarved/showsColor's own convention, all of which read
    // raw layer.* fields, never a pre-normalized value), so an entirely
    // missing key must ALSO resolve to "not outline" for a layer object
    // that hasn't been through applyToolingDefaults yet.
    expect(showsOutline({ visible: true })).toBe(false);
  });

  it('false when the layer is hidden — the master visible gate wins, EVEN if fusionGeometry is outline/both (same rule isCarved/showsColor already follow)', () => {
    expect(showsOutline({ visible: false, fusionGeometry: 'outline' })).toBe(false);
    expect(showsOutline({ visible: false, fusionGeometry: 'both' })).toBe(false);
  });

  it('false for a null/undefined layer, same defensive shape as the other three gates', () => {
    expect(showsOutline(null)).toBe(false);
    expect(showsOutline(undefined)).toBe(false);
  });
});

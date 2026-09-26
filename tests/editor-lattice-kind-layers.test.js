/**
 * T76 (SE17, item 1) — the declared kind->layer map + Fusion sketch build
 * order: LATTICE_FUSION_BUILD_ORDER (editor-lattice-pattern.js) is the ONE
 * table both the (future) per-kind layer creation AND the Fusion build
 * sequencing read from, so the two can never independently drift.
 * Pure data, no behavior yet -- this file just locks the declared SHAPE
 * down before anything starts consuming it.
 */
import { describe, it, expect } from 'vitest';
import {
  LATTICE_FUSION_BUILD_ORDER, LATTICE_KIND_LAYER_DEFAULTS,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';

describe('LATTICE_FUSION_BUILD_ORDER', () => {
  it('is exactly contour -> rails -> ties -> nodes -- the fixed Fusion dependency order (contour under rails, rails under ties, rails/ties under nodes)', () => {
    expect(LATTICE_FUSION_BUILD_ORDER).toEqual(['contour', 'rails', 'ties', 'nodes']);
  });

  it('is frozen -- a declared constant, never mutated by a consumer', () => {
    expect(Object.isFrozen(LATTICE_FUSION_BUILD_ORDER)).toBe(true);
  });
});

describe('LATTICE_KIND_LAYER_DEFAULTS', () => {
  it('has exactly one entry per LATTICE_FUSION_BUILD_ORDER kind -- neither table can drift ahead of the other', () => {
    expect(Object.keys(LATTICE_KIND_LAYER_DEFAULTS).sort()).toEqual([...LATTICE_FUSION_BUILD_ORDER].sort());
  });

  it('every entry declares at least its own layer name', () => {
    for (const kind of LATTICE_FUSION_BUILD_ORDER) {
      expect(typeof LATTICE_KIND_LAYER_DEFAULTS[kind].name).toBe('string');
      expect(LATTICE_KIND_LAYER_DEFAULTS[kind].name.length).toBeGreaterThan(0);
    }
  });

  it('rails/ties/nodes keep the recovered SE7b tuned tooling (rails/ties V-bit, ties shallower; nodes ballnose)', () => {
    expect(LATTICE_KIND_LAYER_DEFAULTS.rails).toEqual({ name: 'Rails', depth: 0.15, profile: 'vbit', angle: 90 });
    expect(LATTICE_KIND_LAYER_DEFAULTS.ties).toEqual({ name: 'Ties', depth: 0.08, profile: 'vbit', angle: 90 });
    expect(LATTICE_KIND_LAYER_DEFAULTS.nodes).toEqual({ name: 'Nodes', depth: 0.12, profile: 'ballnose', angle: 90 });
  });

  it('contour (a genuinely new kind-layer, no SE7b precedent) declares only its own name, deferring every tooling field to addLayer\'s own generic TOOLING_DEFAULTS', () => {
    expect(LATTICE_KIND_LAYER_DEFAULTS.contour).toEqual({ name: 'Contour' });
  });

  it('is frozen, including every per-kind entry -- a declared table, never mutated by a consumer', () => {
    expect(Object.isFrozen(LATTICE_KIND_LAYER_DEFAULTS)).toBe(true);
    for (const kind of LATTICE_FUSION_BUILD_ORDER) {
      expect(Object.isFrozen(LATTICE_KIND_LAYER_DEFAULTS[kind])).toBe(true);
    }
  });
});

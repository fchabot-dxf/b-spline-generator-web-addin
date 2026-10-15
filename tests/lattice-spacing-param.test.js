/**
 * Send targets step 0 (seat A 2026-10-14; Fred's Pull must-work case "spacing"): a lattice's manifest names its
 * spacing as the user parameter `lattice_spacing` (inches) beside node_diameter / rail_width -- Pull reads it back
 * into the pattern. Nothing in the sketch is driven by it; 
 */
import { describe, it, expect } from 'vitest';
import { PATTERN_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { manifestFromLattice } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-sketch-manifest.js';

const PATTERN = { ...PATTERN_DEFAULTS, spacing: 0.3, orientation: 'horizontal', rails: { mode: 'every', every: 2, offset: 0 } };

describe('the lattice spacing is a named Fusion parameter', () => {
  it('declared with the pattern spacing, in inches, and driving no dimension', () => {
    const m = manifestFromLattice(PATTERN, { iMin: 0, jMin: 0, iMax: 6, jMax: 6 });
    expect(m.parameters.find((p) => p.name === 'lattice_spacing')).toEqual({ name: 'lattice_spacing', value: 0.3, unit: 'in' });
    expect(m.dimensions.some((d) => String(d.expression || '').includes('lattice_spacing'))).toBe(false);
  });
});

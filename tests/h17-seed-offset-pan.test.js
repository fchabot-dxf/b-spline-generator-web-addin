/**
 * H17 item 2 (Fred: "the seed offset isnt what i wanted" -> "pan the whole
 * map"): seedOffsetX/Y must slide the ENTIRE drawing -- coarse shapes AND
 * fine texture together -- like moving a picture under the board window.
 * Moved to the same (u,v) sampler entry as Map Zoom (H17 item 1):
 *   zu = 0.5 + (u-0.5)/mapZoom + seedOffsetX   (same for v)
 * and the old coarse-only "cx += seedOffsetX*cFreq*aspect" lines are
 * REMOVED so the offset isn't applied twice.
 */
import { describe, it, expect } from 'vitest';
import { generateHeightmap } from '../bspline-frame-builder/b-spline-gen/html/core/terrain.js';
import { DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

// Mirrors the real call site (core/engine/rebuild.js: generateHeightmap({
// ...P, nx, nz, edgeMargin })) -- a full P-shaped object, not a bare
// partial one (core/terrain.js's noise-mode functions NaN on a partial
// object, per H15's own test-construction finding).
const BASE = {
  ...DEFAULT,
  widthIn: 7, heightIn: 9,
  seed: 4242,
  symmetry: 'none',
};

describe('H17 item 2: Seed Offset pans the WHOLE map (fine texture + coarse shapes together)', () => {
  it('offset 0 (explicit) is byte-identical to offset omitted entirely -- 0 is a true no-op', () => {
    const explicit0 = generateHeightmap({ ...BASE, seedOffsetX: 0, seedOffsetY: 0, nx: 20, nz: 16 }).heights;
    const { seedOffsetX, seedOffsetY, ...omitted } = { ...BASE, nx: 20, nz: 16 };
    const withOmitted = generateHeightmap(omitted).heights;
    expect(Array.from(explicit0)).toEqual(Array.from(withOmitted));
  });

  it('a sample at (u, v) with offset dx is IDENTICAL to a sample at (u+dx, v) with offset 0 -- the checklist\'s exact scenario, symmetry off', () => {
    // nx=5 -> grid u values are exactly 0, 0.25, 0.5, 0.75, 1.0.
    const nx = 5, nz = 5;
    const row = 2 * nx; // v = 0.5 (centre row), held equal in both cases (offsetY=0 throughout)
    const withOffset = generateHeightmap({ ...BASE, nx, nz, seedOffsetX: 0.25 }).heights[row + 2]; // i=2 -> u=0.5
    const shiftedInstead = generateHeightmap({ ...BASE, nx, nz, seedOffsetX: 0 }).heights[row + 3]; // i=3 -> u=0.75
    expect(withOffset).toBe(shiftedInstead);
  });

  it('the pan is NOT applied twice: offset 0.25 must match exactly a +1-grid-step shift, not +2 steps', () => {
    // If the old coarse-only "cx += seedOffsetX*cFreq*aspect" line had been
    // left in place alongside the new zu/zv addition, the coarse layer
    // would receive the offset twice while the fine layer only got it
    // once -- splitting the two layers apart. This identity can only hold
    // if the offset is applied EXACTLY once, consistently to both layers.
    const nx = 5, nz = 5;
    const row = 2 * nx;
    const at025 = generateHeightmap({ ...BASE, nx, nz, seedOffsetX: 0.25 }).heights[row + 2]; // u=0.5, offset 0.25
    const at0_u075 = generateHeightmap({ ...BASE, nx, nz, seedOffsetX: 0 }).heights[row + 3]; // u=0.75, offset 0 (+1 step)
    const at0_u100 = generateHeightmap({ ...BASE, nx, nz, seedOffsetX: 0 }).heights[row + 4]; // u=1.0, offset 0 (+2 steps)
    expect(at025).toBe(at0_u075);
    expect(at025).not.toBe(at0_u100);
  });

  it('seedOffsetX actually changes the heightmap (a real effect, not a dead parameter)', () => {
    const nx = 20, nz = 16;
    const at0 = generateHeightmap({ ...BASE, nx, nz, seedOffsetX: 0 }).heights;
    const at05 = generateHeightmap({ ...BASE, nx, nz, seedOffsetX: 0.5 }).heights;
    expect(Array.from(at05)).not.toEqual(Array.from(at0));
  });

  it('interacts correctly with Map Zoom: at mapZoom=2, offset dx pans by HALF the board-width it would at zoom 1 (units are "screens" at the zoomed size)', () => {
    const nx = 5, nz = 5;
    const row = 2 * nx;
    // At zoom=2: zu = 0.5 + (u-0.5)/2 + offsetX. offsetX=0.25 at u=0.5 -> zu=0.75.
    // At zoom=1, offsetX=0 at u=1.0 -> zu = 0.5+(1.0-0.5)/1+0 = 1.0 (not 0.75) --
    // so the SAME raw offset value reaches a different zu depending on zoom,
    // confirming the offset is expressed in the CURRENT zoomed frame, not
    // an absolute one. Verify by comparing to the zoom=2 own zu=0.75
    // reference point instead (u=1.0 at zoom=2: zu=0.5+0.25+0=0.75).
    const zoomedOffset = generateHeightmap({ ...BASE, nx, nz, mapZoom: 2, seedOffsetX: 0.25 }).heights[row + 2]; // u=0.5
    const zoomedReference = generateHeightmap({ ...BASE, nx, nz, mapZoom: 2, seedOffsetX: 0 }).heights[row + 4]; // u=1.0
    expect(zoomedOffset).toBe(zoomedReference);
  });
});

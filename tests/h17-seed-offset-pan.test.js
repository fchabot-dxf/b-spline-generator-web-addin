/**
 * H17 item 2 (Fred: "the seed offset isnt what i wanted" -> "pan the whole
 * map"): seedOffsetX/Y must slide the ENTIRE drawing -- coarse shapes AND
 * fine texture together -- like moving a picture under the board window.
 * Moved to the same (u,v) sampler entry as Map Zoom (H17 item 1), and
 * REMOVED the old coarse-only "cx += seedOffsetX*cFreq*aspect" lines so
 * the offset isn't applied twice.
 *
 * H17 item 3 (spec of item 2, missed): item 2's first formula --
 *   zu = 0.5 + (u-0.5)/mapZoom + seedOffsetX
 * -- added the offset AFTER dividing by mapZoom, so the offset kept its
 * zoom=1 magnitude while the visible window shrank around it (at zoom 2,
 * offset 0.5 was already panning a full zoomed screen). Fixed to add the
 * offset BEFORE the division:
 *   zu = 0.5 + (u - 0.5 + seedOffsetX) / mapZoom   (same for v)
 * so "1 unit of offset" is always exactly one board-width at the CURRENT
 * zoom, matching the "(screens)" label.
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

  it('H17 item 3: at zoom 2, offset 1 pans by exactly ONE (zoomed) screen -- offset 1 at u equals offset 0 at u+1', () => {
    // The checklist's exact scenario. nx=5 -> grid u values 0, 0.25, 0.5,
    // 0.75, 1.0; only u=0 has a valid u+1 (=1.0) on this grid.
    // zu(zoom=2, offset=1, u=0)   = 0.5 + (0 - 0.5 + 1)/2   = 0.75
    // zu(zoom=2, offset=0, u=1.0) = 0.5 + (1.0 - 0.5 + 0)/2 = 0.75
    const nx = 5, nz = 5;
    const row = 2 * nx; // v = 0.5, held equal in both cases (offsetY=0 throughout)
    const withOffset = generateHeightmap({ ...BASE, nx, nz, mapZoom: 2, seedOffsetX: 1 }).heights[row + 0]; // u=0
    const shiftedInstead = generateHeightmap({ ...BASE, nx, nz, mapZoom: 2, seedOffsetX: 0 }).heights[row + 4]; // u=1.0
    expect(withOffset).toBe(shiftedInstead);
  });

  it('offset units scale with zoom: the SAME raw offset value pans a SMALLER absolute distance at a higher zoom', () => {
    // At zoom=1, offset=0.25 pans by exactly 1 grid step (0.25, this
    // grid's own u spacing). At zoom=2, the SAME offset=0.25 must pan by
    // only HALF a grid step -- i.e. it must NOT match the same +1-step
    // reference zoom=1 does, since "1 unit of offset" is now a smaller
    // absolute distance (half a board-width instead of a whole one).
    const nx = 5, nz = 5;
    const row = 2 * nx;
    const zoom1Offset = generateHeightmap({ ...BASE, nx, nz, mapZoom: 1, seedOffsetX: 0.25 }).heights[row + 2]; // u=0.5
    const zoom1Reference = generateHeightmap({ ...BASE, nx, nz, mapZoom: 1, seedOffsetX: 0 }).heights[row + 3]; // u=0.75 (+1 step)
    const zoom2Offset = generateHeightmap({ ...BASE, nx, nz, mapZoom: 2, seedOffsetX: 0.25 }).heights[row + 2]; // u=0.5
    expect(zoom1Offset).toBe(zoom1Reference);
    expect(zoom2Offset).not.toBe(zoom1Reference);
  });
});

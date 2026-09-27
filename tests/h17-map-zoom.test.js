/**
 * H17 item 1 (Fred: "add it in filters, not replace region"): Map Zoom, a
 * NEW slider in Filter's "Map" group, alongside (not replacing) Region
 * Scale. A drawing-style zoom of the WHOLE generated terrain about the
 * board centre -- bigger value = bigger features -- implemented once at
 * terrain.js's (u,v) sampler entry (zu = 0.5 + (u-0.5)/mapZoom, same for v)
 * so coarse shapes, fine texture and detail/cluster masks all inherit it
 * together. mapZoom=1 is the identity (today's terrain exactly).
 */
import { describe, it, expect } from 'vitest';
import { generateHeightmap } from '../bspline-frame-builder/b-spline-gen/html/core/terrain.js';
import { DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

// Mirrors the real call site (core/engine/rebuild.js: generateHeightmap({
// ...P, nx, nz, edgeMargin })) -- a full P-shaped object, not a bare
// partial one (core/terrain.js's noise-mode functions read scale/octaves/
// roughness/warpIntensity straight off the passed params and silently NaN
// on a partial object, per H15's own test-construction finding).
const BASE = {
  ...DEFAULT,
  widthIn: 7, heightIn: 9,
  seed: 777,
  symmetry: 'none',
};

describe('H17 item 1: Map Zoom (mapZoom) — a real, drawing-style zoom of the whole terrain', () => {
  it('mapZoom=1 is byte-identical to mapZoom omitted entirely (the pre-H17 shape) -- confirms 1 is a true no-op default', () => {
    const withExplicit1 = generateHeightmap({ ...BASE, mapZoom: 1, nx: 20, nz: 16 }).heights;
    const { mapZoom, ...withoutKey } = { ...BASE, nx: 20, nz: 16 };
    const withOmitted = generateHeightmap(withoutKey).heights;
    expect(Array.from(withExplicit1)).toEqual(Array.from(withOmitted));
  });

  it('the board centre sample is identical at any zoom (zoom is centred on the board)', () => {
    const nx = 21, nz = 21; // odd -> an exact centre grid point at u=v=0.5
    const centreIdx = ((nz - 1) / 2) * nx + (nx - 1) / 2;
    const at1 = generateHeightmap({ ...BASE, nx, nz, mapZoom: 1 }).heights[centreIdx];
    const at2 = generateHeightmap({ ...BASE, nx, nz, mapZoom: 2 }).heights[centreIdx];
    const at0_5 = generateHeightmap({ ...BASE, nx, nz, mapZoom: 0.5 }).heights[centreIdx];
    expect(at2).toBe(at1);
    expect(at0_5).toBe(at1);
  });

  it('a feature at u=0.75 at zoom 1 appears at u=1.0 at zoom 2 (symmetry off)', () => {
    // nx=5 -> grid u values are exactly 0, 0.25, 0.5, 0.75, 1.0.
    // nz=5, centre row j=2 -> v=0.5, which maps to zv=0.5 at ANY zoom (the
    // v-dimension is deliberately held invariant so this isolates the
    // u-dimension zoom behaviour the checklist actually asks for).
    const nx = 5, nz = 5;
    const centreRow = 2 * nx;
    const zoom1_u075 = generateHeightmap({ ...BASE, nx, nz, mapZoom: 1 }).heights[centreRow + 3]; // i=3 -> u=0.75
    const zoom2_u100 = generateHeightmap({ ...BASE, nx, nz, mapZoom: 2 }).heights[centreRow + 4]; // i=4 -> u=1.0
    expect(zoom2_u100).toBe(zoom1_u075);
  });

  it('mapZoom actually changes the heightmap (a real filter input, not a dead parameter)', () => {
    const nx = 20, nz = 16;
    const at1 = generateHeightmap({ ...BASE, nx, nz, mapZoom: 1 }).heights;
    const at1_5 = generateHeightmap({ ...BASE, nx, nz, mapZoom: 1.5 }).heights;
    expect(Array.from(at1_5)).not.toEqual(Array.from(at1));
  });

  it('does not scale edge fade: an edgeMargin-faded border stays faded the same way at any zoom', () => {
    const nx = 20, nz = 16;
    const params = { ...BASE, nx, nz, edgeMargin: 0.15 };
    const borderIdx = 0; // i=0, j=0 -> u=v=0 -- always inside the fade band regardless of zoom
    const at1 = generateHeightmap({ ...params, mapZoom: 1 }).heights[borderIdx];
    const at3 = generateHeightmap({ ...params, mapZoom: 3 }).heights[borderIdx];
    // Both must be exactly zero -- edgeFade(0, margin) is exactly 0, and it
    // reads the real board position (u=0), not the zoomed one, at any zoom.
    expect(at1).toBe(0);
    expect(at3).toBe(0);
  });
});

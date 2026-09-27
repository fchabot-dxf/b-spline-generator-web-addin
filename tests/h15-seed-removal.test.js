/**
 * H15 (Fred: "the whole seed section is redundant" / "I don't use them"):
 * the sidebar SEED section (Seed Type, hidden Seed, Region Scale, Offset
 * X/Y, Rotation, Edit Seed) and the Seed Editor modal it mirrored are both
 * REMOVED. "Generate New Seed" stays. The underlying P keys (seedType,
 * seed, macroScale, seedOffsetX, seedOffsetY, seedRotation) and the
 * terrain pipeline that reads them are untouched -- a project saved
 * BEFORE this removal, with non-default values for all of them, must
 * still load and render an IDENTICAL heightmap after the UI is gone.
 */
import { describe, it, expect } from 'vitest';
import { generateHeightmap } from '../bspline-frame-builder/b-spline-gen/html/core/terrain.js';
import { DEFAULT, persistableP } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

// Mirrors the real call site exactly (core/engine/rebuild.js:177 --
// generateHeightmap({ ...P, nx, nz, edgeMargin })): a full P-shaped
// object (every field generateHeightmap's noise-mode functions read,
// e.g. scale/octaves/roughness/warpIntensity, has a real value, not
// undefined -- a bare partial object would NaN out silently, which is
// a property of the real function, not something this test should
// paper over) with only the 5 removed-UI seed fields pushed away from
// their DEFAULT values.
const NON_DEFAULT_PARAMS = {
  ...DEFAULT,
  widthIn: 7, heightIn: 9, nx: 20, nz: 16,
  seed: 12345,
  seedType: 'voronoi', // DEFAULT is 'perlin'
  macroScale: 0.42,    // DEFAULT is 0.65
  seedOffsetX: 0.8,    // DEFAULT is 0
  seedOffsetY: -0.6,   // DEFAULT is 0
  seedRotation: 37,    // DEFAULT is 0
};

describe('H15: the seed pipeline survives the sidebar/modal removal', () => {
  it('generateHeightmap actually uses seedType/macroScale/seedOffsetX/seedOffsetY/seedRotation (the test is not vacuous)', () => {
    const base = generateHeightmap(NON_DEFAULT_PARAMS).heights;
    const atDefaults = generateHeightmap({ ...NON_DEFAULT_PARAMS, seedType: DEFAULT.seedType, macroScale: DEFAULT.macroScale, seedOffsetX: DEFAULT.seedOffsetX, seedOffsetY: DEFAULT.seedOffsetY, seedRotation: DEFAULT.seedRotation }).heights;
    expect(Array.from(base)).not.toEqual(Array.from(atDefaults));
  });

  it('a "saved project" (persistableP round-trip) with non-default values regenerates an IDENTICAL heightmap', () => {
    const before = generateHeightmap(NON_DEFAULT_PARAMS).heights;

    // Simulate save (persistableP, the one declared serializer saveLastSession/
    // the Project Manager/history all go through) then "load" (the generic
    // Object.keys(saved).forEach(k => P[k] = saved[k]) pattern every loader
    // uses) -- a plain object round-trip, no UI involved at any point.
    const saved = persistableP(NON_DEFAULT_PARAMS);
    const loaded = { ...saved };

    const after = generateHeightmap(loaded).heights;
    expect(Array.from(after)).toEqual(Array.from(before));
  });

  it('each removed-UI value individually still changes the output (none of the 5 became dead)', () => {
    const base = generateHeightmap(NON_DEFAULT_PARAMS).heights;
    for (const key of ['seedType', 'macroScale', 'seedOffsetX', 'seedOffsetY', 'seedRotation']) {
      const tweakedValue = key === 'seedType' ? 'ridged' : NON_DEFAULT_PARAMS[key] + 1;
      const tweaked = generateHeightmap({ ...NON_DEFAULT_PARAMS, [key]: tweakedValue }).heights;
      expect(Array.from(tweaked), `${key} had no effect on the heightmap`).not.toEqual(Array.from(base));
    }
  });
});

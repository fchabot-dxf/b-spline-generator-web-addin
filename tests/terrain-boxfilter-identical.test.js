/**
 * 2026-10-08 (seat A; the phone map, photo board: the terrain smoothing's boxFilter was ~4 s of 30 slow actions):
 * boxFilter's interior skips the edge clamp and its Y pass sums whole rows into a double accumulator, offset by offset,
 * instead of striding a column per cell -- every cell still 0 + its window in ascending order, / (2r + 1): the same
 * result to the bit. generateHeightmap's smoothed output is pinned here to the digests of the code BEFORE the change
 * (fixtures/terrain-boxfilter-digests.json). A deliberate change re-pins: PIN=1 npx vitest run <this file>.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { generateHeightmap } from '../bspline-frame-builder/b-spline-gen/html/core/terrain.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

const PINNED = 'tests/fixtures/terrain-boxfilter-digests.json';
const CASES = [];
for (const [widthIn, heightIn, nx, nz] of [[7, 9, 141, 181], [8, 10, 268, 334], [12, 6, 61, 31]])
  for (const smoothRadius of [0.05, 0.36, 1.2, 4, 7.2])
    for (const [smoothIntensity, symmetry, smoothRespectSymmetry] of [[0.3, 'none', false], [1, 'y', true]])
      CASES.push({ widthIn, heightIn, nx, nz, smoothRadius, smoothIntensity, symmetry, smoothRespectSymmetry, seed: 42, carveZ: 0.5 });

describe('generateHeightmap with smoothing: byte-identical to the pre-change boxFilter', () => {
  it(`${CASES.length} cases (3 boards x 5 radii x 2 intensity / symmetry)`, () => {
    const got = {};
    for (const c of CASES) {
      const { heights } = generateHeightmap({ ...P, ...c }, { mask: null }); // the app's own defaults: a real terrain
      got[JSON.stringify(c)] = createHash('sha1').update(Buffer.from(heights.buffer, heights.byteOffset, heights.byteLength)).digest('hex');
    }
    if (process.env.PIN === '1') writeFileSync(PINNED, JSON.stringify(got, null, 1) + '\n');
    expect(got).toEqual(JSON.parse(readFileSync(PINNED, 'utf8')));
    expect(new Set(Object.values(got)).size).toBe(CASES.length); // every case its own terrain (none flat)
  }, 120000);
});

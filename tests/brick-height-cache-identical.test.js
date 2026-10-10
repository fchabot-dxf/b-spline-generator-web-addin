/**
 * 2026-10-10 (seat A; the fresh phone map, loaded board: distanceToNearestEdge 12.3 s of self time over 44 slow actions,
 * most under the brick pattern taps): brickTopHeight (core/bricks/height-profile.js) runs per SAMPLE POINT, and per point
 * it recomputed two per-BRICK constants -- maxInteriorDistance (two reduce passes + a whole extra distanceToNearestEdge)
 * and the chip draw (hashId + two seeded rngs). Both are now computed once per polygon / brick. Same arithmetic, so
 * every height is the same to the bit: pinned here against the digests of the code BEFORE the change
 * (fixtures/brick-height-cache-digests.json) -- every library set (4 with chips), 2 seeds, a weathered (edge-noise)
 * variant, with and without a surface-detail callback, a 0.05 in lattice over a 9x12 board. PIN=1 re-pins.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { generateBricks, buildSpatialIndex, sampleHeight } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { BRICK_SETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

const PINNED = 'tests/fixtures/brick-height-cache-digests.json';
const W = 9, H = 12, STEP = 0.05;
const board = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
const detail = (x, y, b) => Math.sin(x * 7.3 + y * 3.1) * 0.8; // a deterministic stand-in for the photo sample

function digestFor(set, seed, withDetail) {
  const result = generateBricks({ boardOutline: board, set, seed });
  const index = buildSpatialIndex([...result.bricks, ...result.frameBricks], 1);
  const nx = Math.round(W / STEP) + 1, ny = Math.round(H / STEP) + 1;
  const out = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out[j * nx + i] = sampleHeight(result, index, i * STEP, j * STEP, set, 0, withDetail ? detail : undefined);
  const nonzero = out.reduce((n, v) => n + (v > 0 ? 1 : 0), 0);
  return `${result.bricks.length}/${nonzero}:${createHash('sha1').update(Buffer.from(out.buffer)).digest('hex')}`;
}

describe('brick heights with the per-brick constants cached: identical to the pre-change code', () => {
  it('every set x 2 seeds x weathered x detail', () => {
    const got = {};
    const sets = [...BRICK_SETS];
    const s1 = BRICK_SETS.find((s) => s.heightProfile && s.heightProfile.chipRate > 0);
    sets.push({ ...s1, id: `${s1.id}-weathered`, heightProfile: { ...s1.heightProfile, edgeNoiseIn: 0.03, edgeNoiseScaleIn: 0.4, wearWholeFace: true } });
    for (const set of sets) for (const seed of [3, 11]) for (const withDetail of [false, true]) {
      got[`${set.id} seed ${seed}${withDetail ? ' detail' : ''}`] = digestFor(set, seed, withDetail);
    }
    if (process.env.PIN === '1') writeFileSync(PINNED, JSON.stringify(got, null, 1) + '\n');
    const pinned = JSON.parse(readFileSync(PINNED, 'utf8'));
    expect(Object.keys(got).length).toBe(24);
    expect(new Set(Object.values(got)).size).toBeGreaterThan(16); // real, distinct terrains of bricks (not all flat)
    expect(got).toEqual(pinned);
  }, 120000);
});

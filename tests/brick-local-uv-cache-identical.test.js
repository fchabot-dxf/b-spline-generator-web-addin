/**
 * 2026-10-10 (seat A; the fresh phone map, loaded board: brickLocalUV 6.3 s of self time over 44 slow actions):
 * brickLocalUV (editor/editor-brick-surface.js) recomputed the polygon's centroid, longest-edge axis and half-extents
 * at EVERY sample point -- per-polygon constants, now computed once per polygon. Same arithmetic, so every (u, v) is
 * the same to the bit: pinned against the digest of the code BEFORE the change (fixtures/brick-local-uv-digests.json)
 * over every library set's real bricks (2 seeds), each brick sampled on a 0.03 in lattice, flipped and not. PIN=1
 * re-pins.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { brickLocalUV } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-surface.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { BRICK_SETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

const PINNED = 'tests/fixtures/brick-local-uv-digests.json';
const board = [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 12 }, { x: 0, y: 12 }];

describe('brickLocalUV with the per-polygon frame cached: identical to the pre-change code', () => {
  it('every set x 2 seeds, every brick on a 0.03 in lattice, flipped and not', () => {
    const got = {};
    for (const set of BRICK_SETS) for (const seed of [3, 11]) {
      const r = generateBricks({ boardOutline: board, set, seed });
      const vals = [];
      for (const b of [...r.bricks, ...r.frameBricks]) {
        const xs = b.polygon.map((p) => p.x), ys = b.polygon.map((p) => p.y);
        for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.03) for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.03) {
          for (const flip of [false, true]) { const { u, v } = brickLocalUV(b.polygon, x, y, flip); vals.push(u, v); }
        }
      }
      got[`${set.id} seed ${seed}`] = `${vals.length}:${createHash('sha1').update(Buffer.from(Float64Array.from(vals).buffer)).digest('hex')}`;
    }
    if (process.env.PIN === '1') writeFileSync(PINNED, JSON.stringify(got, null, 1) + '\n');
    expect(Object.values(got).filter((d) => !d.startsWith('0:')).length).toBeGreaterThan(6); // real bricks sampled
    expect(got).toEqual(JSON.parse(readFileSync(PINNED, 'utf8')));
  }, 120000);
});

/**
 * core/bricks/noise2d.js — PORTABLE (see rng.js). A minimal self-contained 2D VALUE noise
 * (bilinear-interpolated hashed lattice) -- not Perlin/simplex, deliberately simple, for exactly
 * one job: "clumping" (suppression.js), a continuous, SPATIALLY-CORRELATED field so nearby pieces
 * get similar scores (clusters) instead of independent-per-cell randomness. core/noise.js
 * (PerlinNoise.fbm) already does this well in the main app but is off-limits here (core/bricks/
 * must stay zero-dependency, portable to another app) -- this is the "own tiny seeded [noise]"
 * the advisor asked for, mirroring rng.js's own mulberry32 for the hash.
 */
import { mulberry32 } from './rng.js';

function hash2(seed, ix, iy) {
  const h = mulberry32((seed ^ Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x85ebca6b)) >>> 0);
  return h();
}

function smooth(t) { return t * t * (3 - 2 * t); }

/** Value noise at (x,y) in [0,1), lattice spacing 1 unit -- scale x/y before calling to control
 *  frequency (a SMALLER `scale` on the caller's own x/y = lower frequency = bigger smooth blobs). */
export function valueNoise2(seed, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smooth(x - x0), fy = smooth(y - y0);
  const v00 = hash2(seed, x0, y0), v10 = hash2(seed, x0 + 1, y0);
  const v01 = hash2(seed, x0, y0 + 1), v11 = hash2(seed, x0 + 1, y0 + 1);
  const a = v00 + (v10 - v00) * fx;
  const b = v01 + (v11 - v01) * fx;
  return a + (b - a) * fy;
}

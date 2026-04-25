/**
 * seed/voronoi.js — F1 Voronoi cell field.
 *
 * For each sample point, find the closest of a set of jittered cell-centre
 * "feature points" inside the surrounding 3×3 cell neighborhood. Output is
 * normalized squared distance — bright at cell centres, dark at cell
 * boundaries. Result is a clustered, blob-like field with discrete edges.
 *
 * Character: dense agglomerated cells with hard boundaries — "moss",
 * "lichen", "tile". Naturally clustered without the clustering knob.
 *
 * Cost: per-pixel scans 9 cells × 1 candidate = 9 hash lookups, slightly
 * heavier than 2-octave Perlin but still cheap for the coarse grid.
 */

export const id = 'voronoi';
export const label = 'Voronoi (cells)';
export const description = 'Discrete cells with hard edges — clustered, organic.';

// Cheap 2D hash → [0..1) reproducible per (ix, iy, seedSalt)
function hash2(ix, iy, salt) {
  let h = (ix | 0) * 374761393;
  h ^= (iy | 0) * 668265263;
  h ^= (salt | 0) * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 0xffffffff;
}

export function sample(x, y, seedRefs) {
  // Use the coarse perm to derive a seed salt — keeps Voronoi tied to
  // the same seed integer the rest of the pipeline uses.
  const salt = seedRefs.noiseCoarse._perm[0] ^ 0xa5a5a5a5;

  // Scale Voronoi up — the legacy Perlin coarse call runs at ~macroScale
  // frequency, but Voronoi cells need a slightly higher density to read
  // as "cells" rather than "one giant blob".
  const cx = x * 1.2;
  const cy = y * 1.2;

  const xi = Math.floor(cx);
  const yi = Math.floor(cy);
  const xf = cx - xi;
  const yf = cy - yi;

  let minDistSq = 8.0;

  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      // Jittered feature point inside cell (xi+di, yi+dj)
      const fx = di + hash2(xi + di, yi + dj, salt);
      const fy = dj + hash2(xi + di, yi + dj, salt + 13);
      const ddx = fx - xf;
      const ddy = fy - yf;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < minDistSq) minDistSq = d2;
    }
  }

  // minDistSq ∈ [0 .. ~2]. Bright at cell centres, dark at edges.
  // 1 - sqrt(d²) gives a smooth falloff per cell.
  const v = 1.0 - Math.sqrt(Math.max(0, minDistSq));
  return Math.max(0, Math.min(1, v));
}

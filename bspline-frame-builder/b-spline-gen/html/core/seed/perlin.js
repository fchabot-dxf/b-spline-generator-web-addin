/**
 * seed/perlin.js — Smooth Perlin FBM coarse field.
 *
 * This is the legacy seed: 2-octave Perlin FBM, normalized to [0..1].
 * Result is a continuous, evenly distributed undulating field with no
 * directional bias. Default for backward-compatibility — picking this
 * + every "skeleton" knob at default reproduces the old hard-coded look.
 *
 * Each seed module exports:
 *   id, label, description, sample(x, y, seedRefs) → [0..1]
 *
 * The skeleton's peak-shape, clustering, density, and edge-fade are
 * applied by terrain.js AFTER sampling. The seed module's only job is
 * to produce a normalized scalar field for the coarse position (x,y).
 */

export const id = 'perlin';
export const label = 'Perlin (smooth)';
export const description = 'Continuous undulating field — even distribution, organic.';

/**
 * Sample the Perlin seed at coarse coordinates.
 *
 * @param {number} x         — coarse X coordinate (already scaled by macroScale*aspect)
 * @param {number} y         — coarse Y coordinate (already scaled by macroScale)
 * @param {object} seedRefs  — { noiseCoarse } shared PerlinNoise instances
 * @returns {number} value in [0..1]
 */
export function sample(x, y, seedRefs) {
  // Match legacy offsets so default seed matches the pre-registry look.
  const v = seedRefs.noiseCoarse.fbm(x + 4.33, y + 8.77, 2, 2.0, 0.6);
  return (v + 1) * 0.5;
}

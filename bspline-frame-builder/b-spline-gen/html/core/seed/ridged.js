/**
 * seed/ridged.js — Ridged multifractal coarse field.
 *
 * Per-octave ridge function: r = 1 - |perlin| produces sharp ridges where
 * the underlying Perlin crosses zero. Squaring sharpens further. Summing
 * across octaves gives a fractal of fine ridges riding on broad ones.
 *
 * Character: sharp peaks, narrow valleys — ideal for spiky/rocky bones.
 * Pairs naturally with Peak Shape > 1 (the default 2.2 already amplifies).
 */

export const id = 'ridged';
export const label = 'Ridged (sharp peaks)';
export const description = 'Sharp ridges and narrow valleys — spiky, rocky.';

export function sample(x, y, seedRefs) {
  const n = seedRefs.noiseCoarse;

  // Manual fbm with ridge per octave; mirrors PerlinNoise.fbm structure
  // but applies r = 1 - |v| inline. Two octaves keeps the cost identical
  // to the legacy Perlin coarse pass.
  let val = 0, amp = 1, freq = 1, maxAmp = 0;
  const octaves = 2, lacunarity = 2.0, gain = 0.6;

  for (let i = 0; i < octaves; i++) {
    let v = n.noise2((x + 11.23) * freq, (y + 19.71) * freq);
    v = 1 - Math.abs(v);     // ridge
    v = v * v;               // sharpen
    val += v * amp;
    maxAmp += amp;
    amp *= gain;
    freq *= lacunarity;
  }

  // val is already in [0..1] because each ridged octave is in [0..1] and
  // we divided by maxAmp. Clamp defensively.
  const out = val / maxAmp;
  return Math.max(0, Math.min(1, out));
}

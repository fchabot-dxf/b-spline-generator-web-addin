/**
 * seed/billow.js — Billowy (absolute-value) Perlin field.
 *
 * Per-octave: b = |perlin|. Cusps where Perlin crosses zero now point
 * DOWN, producing rounded mounds — the topological complement of ridged.
 *
 * Character: rounded bumps separated by soft creases — feels like
 * cumulus clouds or weathered cobble. Reads as "curved/agglomerated".
 */

export const id = 'billow';
export const label = 'Billow (rounded bumps)';
export const description = 'Rounded mounds with soft creases — cobble-like.';

export function sample(x, y, seedRefs) {
  const n = seedRefs.noiseCoarse;

  let val = 0, amp = 1, freq = 1, maxAmp = 0;
  const octaves = 2, lacunarity = 2.0, gain = 0.6;

  for (let i = 0; i < octaves; i++) {
    const v = n.noise2((x + 7.91) * freq, (y + 13.42) * freq);
    val += Math.abs(v) * amp;
    maxAmp += amp;
    amp *= gain;
    freq *= lacunarity;
  }

  // |perlin| ∈ [0..1] roughly, but the average is ~0.4 — stretch a bit so
  // the field uses the full 0..1 dynamic range (otherwise the heightmap
  // would feel muted compared to the other seeds).
  const out = (val / maxAmp) * 1.4;
  return Math.max(0, Math.min(1, out));
}

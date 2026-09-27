/**
 * T79 item 2 — Pond Ripples (ripples.js), built from Fred's approved
 * prototype, sharing core/noise/cells.js.
 */
import { describe, it, expect } from 'vitest';
import { PerlinNoise } from '../bspline-frame-builder/b-spline-gen/html/core/noise.js';
import { NoiseList, NoiseTweaks } from '../bspline-frame-builder/b-spline-gen/html/core/noise/index.js';
import * as ripples from '../bspline-frame-builder/b-spline-gen/html/core/noise/ripples.js';

const ASPECT = 7 / 9;
const params = (seed, extra = {}, tweaks = {}) => ({ scale: 3.7, octaves: 4, roughness: 0.5, warpIntensity: 1.0, seed, ...extra, tweaks });
const refs = (seed) => ({ noiseFine: new PerlinNoise(seed), noiseWarp: new PerlinNoise(seed ^ 0x9e3779b9) });

function sample(mod, seed, n = 40, extra = {}, tweaks = {}) {
  const r = refs(seed); const p = params(seed, extra, tweaks); const out = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out.push(mod.fn(i / (n - 1), j / (n - 1), ASPECT, p, r));
  return out;
}

const FILTERS = [
  ['ripples', 'Pond Ripples', ripples, ['dropCount', 'ringDepth', 'ringSpacing']],
];

describe('T79 item 2: registered after Faceted Stone', () => {
  it('Pond Ripples follows Hand-Carved and Faceted Stone', () => {
    const ids = NoiseList.map((m) => m.id);
    expect(ids[ids.indexOf('faceted') + 1]).toBe('ripples');
  });
});

for (const [id, label, mod, keys] of FILTERS) {
  describe(`T79 item 2: ${label}`, () => {
    it('declares its tweaks, with defaults inside their ranges', () => {
      expect(mod.tweaks.map((t) => t.key).sort()).toEqual(keys);
      expect(NoiseTweaks[id]).toBe(mod.tweaks);
      for (const t of mod.tweaks) {
        expect(t.default).toBeGreaterThanOrEqual(t.min);
        expect(t.default).toBeLessThanOrEqual(t.max);
      }
    });

    it('is deterministic per seed, never NaN, and stays in a sane range', () => {
      for (const seed of [42, 7, 123]) {
        const a = sample(mod, seed);
        expect(sample(mod, seed)).toEqual(a);
        for (const v of a) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThan(-0.5);
          expect(v).toBeLessThan(2);
        }
        const mean = a.reduce((s, v) => s + v, 0) / a.length;
        const sd = Math.sqrt(a.reduce((s, v) => s + (v - mean) ** 2, 0) / a.length);
        expect(sd).toBeGreaterThan(0.02);
      }
    });

    it('varies with the seed', () => {
      expect(sample(mod, 7)).not.toEqual(sample(mod, 42));
      expect(sample(mod, 123)).not.toEqual(sample(mod, 42));
    });

    it('honours scale, roughness and warp', () => {
      for (const [key, lo, hi] of [['scale', 2.0, 6.0], ['roughness', 0.2, 0.8], ['warpIntensity', 0.2, 2.0]]) {
        expect(sample(mod, 42, 30, { [key]: lo }), key).not.toEqual(sample(mod, 42, 30, { [key]: hi }));
      }
    });

    it('each tweak changes the result', () => {
      for (const t of mod.tweaks) {
        expect(sample(mod, 42, 30, {}, { [t.key]: t.min }), t.key).not.toEqual(sample(mod, 42, 30, {}, { [t.key]: t.max }));
      }
    });

    it('centre-line slope is continuous: the mirrored halves meet without a crease', () => {
      for (const seed of [42, 7, 123]) {
        const r = refs(seed); const p = params(seed);
        for (let j = 1; j < 50; j++) {
          const sv = j / 50;
          const slope = (mod.fn(1e-5, sv, ASPECT, p, r) - mod.fn(0, sv, ASPECT, p, r)) / 1e-5;
          expect(Math.abs(slope), `seed ${seed} sv ${sv}`).toBeLessThan(0.05);
        }
      }
    });
  });
}

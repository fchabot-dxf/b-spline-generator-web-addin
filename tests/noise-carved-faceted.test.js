/**
 * T79 item 1 — Hand-Carved (carved.js) and Faceted Stone (faceted.js), built
 * from Fred's approved prototypes, sharing core/noise/cells.js.
 */
import { describe, it, expect } from 'vitest';
import { PerlinNoise } from '../bspline-frame-builder/b-spline-gen/html/core/noise.js';
import { NoiseList, NoiseTweaks } from '../bspline-frame-builder/b-spline-gen/html/core/noise/index.js';
import { latticeSalt, APPROVED_SEED } from '../bspline-frame-builder/b-spline-gen/html/core/noise/cells.js';
import * as carved from '../bspline-frame-builder/b-spline-gen/html/core/noise/carved.js';
import * as faceted from '../bspline-frame-builder/b-spline-gen/html/core/noise/faceted.js';

const ASPECT = 7 / 9;
const params = (seed, extra = {}, tweaks = {}) => ({ scale: 3.7, octaves: 4, roughness: 0.5, warpIntensity: 1.0, seed, ...extra, tweaks });
const refs = (seed) => ({ noiseFine: new PerlinNoise(seed), noiseWarp: new PerlinNoise(seed ^ 0x9e3779b9) });

function sample(mod, seed, n = 40, extra = {}, tweaks = {}) {
  const r = refs(seed); const p = params(seed, extra, tweaks); const out = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out.push(mod.fn(i / (n - 1), j / (n - 1), ASPECT, p, r));
  return out;
}

const FILTERS = [
  ['carved', 'Hand-Carved', carved, ['gougeDepth', 'gougeSize', 'grainTurn']],
  ['faceted', 'Faceted Stone', faceted, ['facetHeight', 'facetSize', 'seamSoftness']],
];

describe('T79 item 1: registered in Biomechanical\'s old slot', () => {
  it('both appear in the filter list right after Anatomical', () => {
    const ids = NoiseList.map((m) => m.id);
    const at = ids.indexOf('chest');
    expect(ids.slice(at + 1, at + 3)).toEqual(['carved', 'faceted']);
    expect(NoiseList.find((m) => m.id === 'carved').label).toBe('Hand-Carved');
    expect(NoiseList.find((m) => m.id === 'faceted').label).toBe('Faceted Stone');
  });
});

for (const [id, label, mod, keys] of FILTERS) {
  describe(`T79 item 1: ${label}`, () => {
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

describe('T79 item 1: shared cell lattice', () => {
  it('seed 42 keeps the approved lattice; other seeds get their own', () => {
    expect(APPROVED_SEED).toBe(42);
    expect(latticeSalt(4, 42)).toBe(4);
    expect(latticeSalt(1, 42)).toBe(1);
    expect(latticeSalt(1, 7)).not.toBe(1);
    expect(latticeSalt(1, undefined)).toBe(1);
  });
});

describe('T79 item 1: Faceted Stone seams', () => {
  const profile = faceted._cushionProfile;
  it('the seam bottom still reaches 0 at the seam (same depth) and is flat there: a U, not a V', () => {
    expect(profile(0, 0.09)).toBe(0);
    expect(profile(1e-6, 0.09) / 1e-6).toBeLessThan(0.01);
  });

  it('joins the approved edge^0.55 curve in value and slope at the seam width, and matches it beyond', () => {
    const x0 = 0.09; const e = 1e-6;
    expect(profile(x0 - e, x0)).toBeCloseTo(Math.pow(x0, 0.55), 4);
    const inner = (profile(x0 - e, x0) - profile(x0 - 2 * e, x0)) / e;
    const outer = (Math.pow(x0 + 2 * e, 0.55) - Math.pow(x0 + e, 0.55)) / e;
    expect(Math.abs(inner - outer)).toBeLessThan(0.01);
    for (const x of [0.1, 0.3, 0.7, 1]) expect(profile(x, x0)).toBe(Math.pow(x, 0.55));
  });

  it('seam softness 0 gives back the approved sharp profile exactly', () => {
    for (const x of [0, 0.01, 0.05, 0.5]) expect(profile(x, 0)).toBe(Math.pow(x, 0.55));
  });
});

/**
 * H18 item 1 (Fred: "all 5 are good, go on all five") — silk.js, ported
 * from the Fred-approved prototype N2_protoSilk.js ("Draped Silk"). Kept
 * the exact math at default tweak values; exposed foldSpacing/foldDepth/
 * foldSweep per the dispatch, dropped the unused `octaves` read (undefined
 * in-app -- the prototype never actually used it).
 */
import { describe, it, expect } from 'vitest';
import { PerlinNoise } from '../bspline-frame-builder/b-spline-gen/html/core/noise.js';
import * as silk from '../bspline-frame-builder/b-spline-gen/html/core/noise/silk.js';

const ASPECT = 7 / 9;
const PARAMS = { scale: 3.7, octaves: 4, roughness: 0.5, warpIntensity: 1.0, tweaks: {} };

function sample(seed, n, tweaks = {}) {
  const noiseFine = new PerlinNoise(seed);
  const noiseWarp = new PerlinNoise(seed ^ 0x9e3779b9);
  const noiseRefs = { noiseFine, noiseWarp };
  const params = { ...PARAMS, tweaks };
  const values = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      values.push(silk.fn(i / (n - 1), j / (n - 1), ASPECT, params, noiseRefs));
    }
  }
  return values;
}

describe('silk.js: declares exactly the 3 named tweaks at the prototype\'s own defaults', () => {
  it('foldSpacing/foldDepth/foldSweep, unchanged from the prototype math', () => {
    const byKey = Object.fromEntries(silk.tweaks.map((t) => [t.key, t]));
    expect(byKey.foldSpacing.default).toBe(1.0);
    expect(byKey.foldDepth.default).toBe(0.35);
    expect(byKey.foldSweep.default).toBe(1.6);
    expect(silk.tweaks).toHaveLength(3);
  });
});

describe('silk.js: determinism', () => {
  it('the same seed + params always produces the same output', () => {
    expect(sample(42, 24)).toEqual(sample(42, 24));
  });
});

describe('silk.js: no NaN, sane range, across several seeds', () => {
  it('every sample is a finite number within a sane range', () => {
    for (const seed of [1, 42, 7, 123]) {
      const values = sample(seed, 48);
      for (const v of values) {
        expect(Number.isFinite(v), `seed ${seed}: non-finite value ${v}`).toBe(true);
        expect(v, `seed ${seed}: value ${v} out of sane range`).toBeGreaterThan(-0.5);
        expect(v, `seed ${seed}: value ${v} out of sane range`).toBeLessThan(1.5);
      }
    }
  });
});

describe('silk.js: centre-line continuity (su=0, the mirror-fold vertex)', () => {
  it('is continuous across su=0 -- no jump/singularity at the point terrain.js\'s symmetry fold always lands on', () => {
    const noiseFine = new PerlinNoise(42);
    const noiseWarp = new PerlinNoise(42 ^ 0x9e3779b9);
    const noiseRefs = { noiseFine, noiseWarp };
    const sv = 0.37;
    const h = 1e-3;
    const atCentre = silk.fn(0, sv, ASPECT, PARAMS, noiseRefs);
    const left = silk.fn(-h, sv, ASPECT, PARAMS, noiseRefs);
    const right = silk.fn(h, sv, ASPECT, PARAMS, noiseRefs);
    expect(Number.isFinite(atCentre)).toBe(true);
    expect(Math.abs(right - atCentre), `right step: ${right} vs ${atCentre}`).toBeLessThan(0.05);
    expect(Math.abs(atCentre - left), `left step: ${atCentre} vs ${left}`).toBeLessThan(0.05);
  });
});

describe('silk.js: each tweak has a real, measurable effect', () => {
  it('foldSpacing changes the fold frequency', () => {
    const tight = sample(42, 48, { foldSpacing: 0.5 });
    const wide = sample(42, 48, { foldSpacing: 2.5 });
    expect(tight).not.toEqual(wide);
  });

  it('foldDepth is a real multiplier -- 0 removes the fold contribution entirely, matching the base-only formula', () => {
    const zero = sample(42, 48, { foldDepth: 0 });
    const noiseFine = new PerlinNoise(42);
    for (let j = 0, i = 0; j < 48; j++) {
      for (let ii = 0; ii < 48; ii++, i++) {
        const f = 3.7 * 1.2;
        const x = (ii / 47) * f * ASPECT, z = (j / 47) * f;
        const base = (noiseFine.fbm(x, z, 2, 2.0, 0.5) + 1) * 0.5;
        const grain = (noiseFine.fbm(x * 4, z * 4, 2) + 1) * 0.01;
        expect(zero[i]).toBeCloseTo(base * 0.6 + grain, 10);
      }
    }
  });

  it('foldSweep changes how much the fold direction bends across the board', () => {
    const straight = sample(42, 48, { foldSweep: 0 });
    const sweeping = sample(42, 48, { foldSweep: 3.0 });
    expect(straight).not.toEqual(sweeping);
  });
});

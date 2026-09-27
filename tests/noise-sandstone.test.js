/**
 * H18 item 1 (Fred: "all 5 are good, go on all five") — sandstone.js, ported
 * from the Fred-approved prototype N1_protoStrata.js ("Sandstone Waves").
 * Kept the exact math at default tweak values; exposed layerCount/
 * layerDepth/hillSoftness per the dispatch, dropped the unused `octaves`
 * read (undefined in-app -- the prototype never actually used it).
 */
import { describe, it, expect } from 'vitest';
import { PerlinNoise } from '../bspline-frame-builder/b-spline-gen/html/core/noise.js';
import * as sandstone from '../bspline-frame-builder/b-spline-gen/html/core/noise/sandstone.js';

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
      values.push(sandstone.fn(i / (n - 1), j / (n - 1), ASPECT, params, noiseRefs));
    }
  }
  return values;
}

describe('sandstone.js: declares exactly the 3 named tweaks at the prototype\'s own defaults', () => {
  it('layerCount/layerDepth/hillSoftness, unchanged from the prototype math', () => {
    const byKey = Object.fromEntries(sandstone.tweaks.map((t) => [t.key, t]));
    expect(byKey.layerCount.default).toBe(11);
    expect(byKey.layerDepth.default).toBe(0.06);
    expect(byKey.hillSoftness.default).toBe(1.0);
    expect(sandstone.tweaks).toHaveLength(3);
  });
});

describe('sandstone.js: determinism', () => {
  it('the same seed + params always produces the same output', () => {
    expect(sample(42, 24)).toEqual(sample(42, 24));
  });
});

describe('sandstone.js: no NaN, sane range, across several seeds', () => {
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

describe('sandstone.js: centre-line continuity (su=0, the mirror-fold vertex)', () => {
  it('is continuous across su=0 -- no jump/singularity at the point terrain.js\'s symmetry fold always lands on', () => {
    const noiseFine = new PerlinNoise(42);
    const noiseWarp = new PerlinNoise(42 ^ 0x9e3779b9);
    const noiseRefs = { noiseFine, noiseWarp };
    const sv = 0.37;
    const h = 1e-3;
    const atCentre = sandstone.fn(0, sv, ASPECT, PARAMS, noiseRefs);
    const left = sandstone.fn(-h, sv, ASPECT, PARAMS, noiseRefs);
    const right = sandstone.fn(h, sv, ASPECT, PARAMS, noiseRefs);
    expect(Number.isFinite(atCentre)).toBe(true);
    expect(Math.abs(right - atCentre), `right step: ${right} vs ${atCentre}`).toBeLessThan(0.05);
    expect(Math.abs(atCentre - left), `left step: ${atCentre} vs ${left}`).toBeLessThan(0.05);
  });
});

describe('sandstone.js: each tweak has a real, measurable effect', () => {
  it('layerCount changes the strata rib frequency', () => {
    const few = sample(42, 48, { layerCount: 4 });
    const many = sample(42, 48, { layerCount: 24 });
    expect(few).not.toEqual(many);
  });

  it('layerDepth is a real multiplier -- 0 removes the strata contribution entirely, matching the base-only formula', () => {
    const zero = sample(42, 48, { layerDepth: 0 });
    const noiseFine = new PerlinNoise(42);
    const noiseWarp = new PerlinNoise(42 ^ 0x9e3779b9);
    const noiseRefs = { noiseFine, noiseWarp };
    // At layerDepth=0 the whole "soft * layerDepth * fade" term vanishes,
    // so the output must equal exactly base*0.85 for every sample.
    let i = 0;
    for (let j = 0; j < 48; j++) {
      for (let ii = 0; ii < 48; ii++) {
        const f = 3.7 * 1.6;
        const x = (ii / 47) * f * ASPECT, z = (j / 47) * f;
        const wa = 0.6 * 1.0;
        const wx = noiseWarp.noise2(x * 0.4 + 3.1, z * 0.4 + 7.4) * wa;
        const wz = noiseWarp.noise2(x * 0.4 + 8.6, z * 0.4 + 1.3) * wa;
        const base = (noiseFine.fbm(x + wx, z + wz, 3, 2.0, 0.5) + 1) * 0.5;
        expect(zero[i]).toBeCloseTo(base * 0.85, 10);
        i++;
      }
    }
  });

  it('hillSoftness changes the strata rib width/contrast', () => {
    const sharp = sample(42, 48, { hillSoftness: 0.4 });
    const soft = sample(42, 48, { hillSoftness: 3.0 });
    expect(sharp).not.toEqual(soft);
  });
});

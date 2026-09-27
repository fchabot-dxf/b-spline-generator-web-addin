/**
 * T78 item 6 (FILTER REWORK) — the cross-cutting acceptance sweep for all
 * four reworked filters together. Each filter's own test file
 * (noise-moon/mars/dunes/reef.test.js) already covers its own tweak-key
 * preservation, determinism, and an individual std-dev-vs-Simplex guard —
 * this file is the single TABLE-STYLE check the dispatch's own item 6
 * describes as one unit ("relief comparable to Simplex... for all four"),
 * plus the "output range normalised" requirement, which no single
 * per-filter file states on its own.
 */
import { describe, it, expect } from 'vitest';
import { PerlinNoise } from '../bspline-frame-builder/b-spline-gen/html/core/noise.js';
import * as simplex from '../bspline-frame-builder/b-spline-gen/html/core/noise/simplex.js';
import * as moon from '../bspline-frame-builder/b-spline-gen/html/core/noise/moon.js';
import * as mars from '../bspline-frame-builder/b-spline-gen/html/core/noise/mars.js';
import * as dunes from '../bspline-frame-builder/b-spline-gen/html/core/noise/dunes.js';
import * as reef from '../bspline-frame-builder/b-spline-gen/html/core/noise/reef.js';

const ASPECT = 7 / 9;
const PARAMS = { scale: 3.7, octaves: 4, roughness: 0.5, warpIntensity: 1.0, tweaks: {} };
const FILTERS = { moon, mars, dunes, reef };

function sample(mod, seed, n) {
  const noiseFine = new PerlinNoise(seed);
  const noiseWarp = new PerlinNoise(seed ^ 0x9e3779b9);
  const noiseRefs = { noiseFine, noiseWarp };
  const values = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      values.push(mod.fn(i / (n - 1), j / (n - 1), ASPECT, PARAMS, noiseRefs));
    }
  }
  return values;
}

function stats(values) {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return {
    mean, stdDev: Math.sqrt(variance), min: Math.min(...values), max: Math.max(...values),
  };
}

describe('T78 item 6: all four reworked filters have relief comparable to Simplex, every seed', () => {
  for (const seed of [1, 42, 100]) {
    it(`seed ${seed}: every filter's stdDev is at least half of Simplex's own`, () => {
      const simplexSd = stats(sample(simplex, seed, 64)).stdDev;
      for (const [name, mod] of Object.entries(FILTERS)) {
        const sd = stats(sample(mod, seed, 64)).stdDev;
        expect(sd, `${name} @ seed ${seed}: stdDev ${sd} vs simplex ${simplexSd}`).toBeGreaterThan(simplexSd * 0.5);
      }
    });
  }
});

describe('T78 item 6: output range normalised -- no filter is suspiciously flat next to Simplex', () => {
  it('every filter\'s own raw output range (max-min) is at least half of Simplex\'s own, at the default seed', () => {
    const simplexRange = (() => { const s = stats(sample(simplex, 42, 96)); return s.max - s.min; })();
    for (const [name, mod] of Object.entries(FILTERS)) {
      const s = stats(sample(mod, 42, 96));
      const range = s.max - s.min;
      expect(range, `${name}: range ${range} vs simplex ${simplexRange}`).toBeGreaterThan(simplexRange * 0.5);
    }
  });
});

describe('T78 item 6: every filter stays deterministic per seed (a combined regression sweep)', () => {
  it('every filter reproduces byte-identical output for the same seed', () => {
    for (const [name, mod] of Object.entries(FILTERS)) {
      const a = sample(mod, 7, 24);
      const b = sample(mod, 7, 24);
      expect(a, name).toEqual(b);
    }
  });

  it('every filter genuinely changes with a different seed (placement is not seed-independent)', () => {
    for (const [name, mod] of Object.entries(FILTERS)) {
      const a = sample(mod, 7, 24);
      const b = sample(mod, 999, 24);
      expect(a, name).not.toEqual(b);
    }
  });
});

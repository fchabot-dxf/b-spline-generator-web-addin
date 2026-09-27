/**
 * T78 item 2 (FILTER REWORK, Fred: "craters don't look like craters
 * either") — craterField.js, the shared crater model Moon and Mars both
 * import. Tests are STATISTICAL/aggregate (sweep many (su,sv) points)
 * rather than pinpointing an exact crater site, since site placement is
 * itself hash-derived and not meant to be independently reproduced here —
 * same "seed sweep, not exact position" precedent this repo's own lattice
 * tests already established for seeded procedural placement.
 */
import { describe, it, expect } from 'vitest';
import { PerlinNoise } from '../bspline-frame-builder/b-spline-gen/html/core/noise.js';
import { craterField } from '../bspline-frame-builder/b-spline-gen/html/core/noise/craterField.js';

const ASPECT = 7 / 9;
const SCALE = 3.7;

function sampleGrid(noiseFine, n, opts) {
  const values = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const su = i / (n - 1); const sv = j / (n - 1);
      values.push(craterField(noiseFine, su, sv, ASPECT, SCALE, opts));
    }
  }
  return values;
}

describe('craterField: determinism', () => {
  it('the exact same (noiseFine, su, sv, aspect, scale, opts) always returns the exact same value', () => {
    const noiseFine = new PerlinNoise(42);
    const a = craterField(noiseFine, 0.37, 0.61, ASPECT, SCALE, {});
    const b = craterField(noiseFine, 0.37, 0.61, ASPECT, SCALE, {});
    expect(a).toBe(b);
  });

  it('a DIFFERENT seed produces a genuinely different field (not seed-independent placement)', () => {
    const values42 = sampleGrid(new PerlinNoise(42), 48, {});
    const values7 = sampleGrid(new PerlinNoise(7), 48, {});
    expect(values42).not.toEqual(values7);
  });
});

describe('craterField: non-vacuous coverage and real relief (bowls + rims, not flat)', () => {
  it('a meaningful fraction of sampled points fall inside SOME crater\'s influence (not near-zero coverage)', () => {
    const noiseFine = new PerlinNoise(42);
    const values = sampleGrid(noiseFine, 96, {});
    const nonZero = values.filter((v) => v !== 0).length;
    // Real lunar highlands are heavily cratered -- craters should be the
    // dominant feature, not a sparse sprinkle. Threshold set well below
    // what the actual measured rate (~35-40%) is, to survive future
    // parameter tuning without becoming a tripwire.
    expect(nonZero / values.length).toBeGreaterThan(0.15);
  });

  it('produces genuinely negative values (bowl floors) AND genuinely positive values (raised rims / peaks) -- not a one-sided profile', () => {
    const noiseFine = new PerlinNoise(42);
    const values = sampleGrid(noiseFine, 96, {});
    expect(Math.min(...values)).toBeLessThan(-0.2);
    expect(Math.max(...values)).toBeGreaterThan(0.05);
  });

  it('craterDepth and rimHeight are real multipliers -- doubling them roughly doubles the min/max magnitude', () => {
    const noiseFine = new PerlinNoise(42);
    const base = sampleGrid(noiseFine, 64, { craterDepth: 1, rimHeight: 1 });
    const doubled = sampleGrid(new PerlinNoise(42), 64, { craterDepth: 2, rimHeight: 2 });
    const baseMin = Math.min(...base); const doubledMin = Math.min(...doubled);
    const baseMax = Math.max(...base); const doubledMax = Math.max(...doubled);
    expect(doubledMin).toBeLessThan(baseMin * 1.5); // meaningfully deeper
    expect(doubledMax).toBeGreaterThan(baseMax * 1.5); // meaningfully taller
  });
});

describe('craterField: mariaGate suppresses but never eliminates crater density', () => {
  it('mariaGate=1 produces meaningfully LESS non-zero coverage than mariaGate=0, at the same seed/points', () => {
    const noiseFine0 = new PerlinNoise(42);
    const noiseFine1 = new PerlinNoise(42);
    const highlandValues = sampleGrid(noiseFine0, 96, { mariaGate: 0 });
    const mariaValues = sampleGrid(noiseFine1, 96, { mariaGate: 1 });
    const highlandCoverage = highlandValues.filter((v) => v !== 0).length / highlandValues.length;
    const mariaCoverage = mariaValues.filter((v) => v !== 0).length / mariaValues.length;
    expect(mariaCoverage).toBeLessThan(highlandCoverage * 0.5);
  });

  it('mariaGate=1 still leaves SOME craters (not a hard zero) -- the reference photo shows a few craters inside maria too', () => {
    const noiseFine = new PerlinNoise(42);
    const mariaValues = sampleGrid(noiseFine, 128, { mariaGate: 1 });
    expect(mariaValues.some((v) => v !== 0)).toBe(true);
  });
});

describe('craterField: saltOffset gives Mars an independently-placed field from Moon at the same seed', () => {
  it('a non-zero saltOffset changes crater placement even with the same noiseFine/su/sv/scale', () => {
    const valuesA = sampleGrid(new PerlinNoise(42), 48, { saltOffset: 0 });
    const valuesB = sampleGrid(new PerlinNoise(42), 48, { saltOffset: 1000 });
    expect(valuesA).not.toEqual(valuesB);
  });
});

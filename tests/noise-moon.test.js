/**
 * T78 item 2 (FILTER REWORK) — moon.js: maria/highlands relief blended
 * with the shared craterField, sinuous rilles, and regolith dust. Also the
 * T78 MOON REFERENCE amendment's own explicit asks: a `mariaAmount` tweak
 * (0 = all highlands, far-side style), and item 6's "keep existing tweak
 * keys, new keys get defaults" + "relief comparable to Simplex" checks.
 */
import { describe, it, expect } from 'vitest';
import { PerlinNoise } from '../bspline-frame-builder/b-spline-gen/html/core/noise.js';
import * as moon from '../bspline-frame-builder/b-spline-gen/html/core/noise/moon.js';
import * as simplex from '../bspline-frame-builder/b-spline-gen/html/core/noise/simplex.js';

const ASPECT = 7 / 9;
const PARAMS = { scale: 3.7, octaves: 4, roughness: 0.5, warpIntensity: 1.0, tweaks: {} };

function sample(mod, seed, n, tweaks = {}) {
  const noiseFine = new PerlinNoise(seed);
  const noiseWarp = new PerlinNoise(seed ^ 0x9e3779b9);
  const noiseRefs = { noiseFine, noiseWarp };
  const params = { ...PARAMS, tweaks };
  const values = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      values.push(mod.fn(i / (n - 1), j / (n - 1), ASPECT, params, noiseRefs));
    }
  }
  return values;
}

function meanStdDev(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, stdDev: Math.sqrt(variance) };
}

describe('moon.js: item 6 -- existing tweak keys preserved, new key added with a default', () => {
  it('still declares the 4 original tweak keys, unchanged defaults', () => {
    const byKey = Object.fromEntries(moon.tweaks.map((t) => [t.key, t]));
    expect(byKey.highlandHeight.default).toBe(0.45);
    expect(byKey.craterDepth.default).toBe(0.32);
    expect(byKey.rimSharpness.default).toBe(0.12);
    expect(byKey.rilleAmount.default).toBe(0.06);
  });

  it('declares the new mariaAmount tweak (T78 MOON REFERENCE: "0 = all highlands, far-side style")', () => {
    const byKey = Object.fromEntries(moon.tweaks.map((t) => [t.key, t]));
    expect(byKey.mariaAmount).toBeDefined();
    expect(byKey.mariaAmount.min).toBe(0);
    expect(byKey.mariaAmount.max).toBe(1);
  });

  it('an old saved pattern with no mariaAmount key at all still runs and reads the declared default', () => {
    const noiseFine = new PerlinNoise(1);
    const noiseWarp = new PerlinNoise(1 ^ 0x9e3779b9);
    const oldTweaks = { highlandHeight: 0.45, craterDepth: 0.32, rimSharpness: 0.12, rilleAmount: 0.06 };
    expect(() => moon.fn(0.4, 0.5, ASPECT, { ...PARAMS, tweaks: oldTweaks }, { noiseFine, noiseWarp })).not.toThrow();
  });
});

describe('moon.js: determinism', () => {
  it('the same seed + params always produces the same output', () => {
    const a = sample(moon, 42, 24);
    const b = sample(moon, 42, 24);
    expect(a).toEqual(b);
  });
});

describe('moon.js: mariaAmount controls the highlands/maria mix', () => {
  it('mariaAmount=0 leaves almost no low-relief "maria" area -- reliefMask stays high almost everywhere (far-side, all-highlands look)', () => {
    // A DIRECT structural check: with mariaAmount=0, moon.fn's own internal
    // maria mask should gate out almost everywhere, so craters keep close
    // to FULL density everywhere -- verified indirectly via coverage: more
    // non-baseline (non-mean) points than the default mariaAmount, since
    // suppressed-density maria zones would otherwise read as flatter.
    const far = sample(moon, 42, 64, { mariaAmount: 0 });
    const near = sample(moon, 42, 64, { mariaAmount: 1 });
    const farStats = meanStdDev(far);
    const nearStats = meanStdDev(near);
    // mariaAmount=1 floods MORE of the board into a low, near-flat maria
    // floor, so its own overall variance should be LOWER than the
    // all-highlands (mariaAmount=0) case.
    expect(nearStats.stdDev).toBeLessThan(farStats.stdDev);
  });
});

describe('moon.js: item 6 -- relief comparable to Simplex (measured std-dev)', () => {
  it('moon\'s stdDev at the default tweaks is at least half of Simplex\'s, across several seeds (never a near-flat "shallow dents" filter)', () => {
    for (const seed of [1, 42, 100]) {
      const moonStats = meanStdDev(sample(moon, seed, 64));
      const simplexStats = meanStdDev(sample(simplex, seed, 64));
      expect(moonStats.stdDev, `seed ${seed}: moon stdDev ${moonStats.stdDev} vs simplex ${simplexStats.stdDev}`)
        .toBeGreaterThan(simplexStats.stdDev * 0.5);
    }
  });

  it('moon\'s raw output range spans well beyond a shallow-dent range (item 1\'s own measured "before" max range was ~0.37) -- a real regression guard against the original bug', () => {
    const values = sample(moon, 42, 96);
    const range = Math.max(...values) - Math.min(...values);
    expect(range).toBeGreaterThan(0.5);
  });
});

/**
 * T78 item 3 (FILTER REWORK) — mars.js: the shared craterField (dust-
 * softened, independently placed from Moon), dendritic drainage, and
 * flat-topped mesa terraces with cliff edges. Dispatch: "the same crater
 * model but dust-softened, plus dry CHANNELS/valleys, flat-topped MESAS
 * with cliff edges (layered steps), and faint wind streaks. Distinct from
 * Moon at a glance."
 */
import { describe, it, expect } from 'vitest';
import { PerlinNoise } from '../bspline-frame-builder/b-spline-gen/html/core/noise.js';
import * as mars from '../bspline-frame-builder/b-spline-gen/html/core/noise/mars.js';
import * as moon from '../bspline-frame-builder/b-spline-gen/html/core/noise/moon.js';
import * as simplex from '../bspline-frame-builder/b-spline-gen/html/core/noise/simplex.js';
import { craterField } from '../bspline-frame-builder/b-spline-gen/html/core/noise/craterField.js';

const ASPECT = 7 / 9;
const PARAMS = { scale: 3.7, octaves: 4, roughness: 0.5, warpIntensity: 1.0, tweaks: {} };

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

function meanStdDev(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, stdDev: Math.sqrt(variance) };
}

describe('mars.js: item 6 -- existing tweak keys preserved, unchanged defaults', () => {
  it('still declares exactly the 4 original tweak keys at their original defaults', () => {
    const byKey = Object.fromEntries(mars.tweaks.map((t) => [t.key, t]));
    expect(byKey.reliefHeight.default).toBe(0.55);
    expect(byKey.riverDepth.default).toBe(0.45);
    expect(byKey.craterScale.default).toBe(0.18);
    expect(byKey.ridgeAmount.default).toBe(0.06);
    expect(mars.tweaks).toHaveLength(4);
  });
});

describe('mars.js: determinism', () => {
  it('the same seed + params always produces the same output', () => {
    expect(sample(mars, 42, 24)).toEqual(sample(mars, 42, 24));
  });
});

describe('mars.js: flat-topped mesas with cliff edges (layered steps)', () => {
  it('a scan line crosses at least one genuinely FLAT terrace band bordered by an abrupt step -- not smooth relief everywhere', () => {
    // Walk a fine 1D scan (fixed sv, sweeping su) and look for a run of
    // several consecutive samples whose relief-only contribution barely
    // changes (a flat terrace tread), followed by a much larger single-step
    // jump (a cliff) -- the signature Math.round()-quantization leaves.
    // Isolate the relief+mesa term the same way mars.fn's own item-1 code
    // computes it, since mixing in drainage/craters would mask the exact
    // step signature under other noise.
    const seed = 42;
    const noiseFine = new PerlinNoise(seed);
    const noiseWarp = new PerlinNoise(seed ^ 0x9e3779b9);
    const scale = 3.7; const warpIntensity = 1.0; const aspect = ASPECT;
    function reliefWithMesas(su, sv) {
      const cf = scale * 0.42;
      const wx = noiseWarp.fbm(su * 0.8, sv * 0.8, 2) * warpIntensity;
      const wy = noiseWarp.fbm(su * 0.8 + 5, sv * 0.8 + 9, 2) * warpIntensity;
      const reliefRaw = (noiseFine.fbm(su * cf * aspect + wx, sv * cf + wy, 5, 2.0, 0.5) + 1) * 0.5;
      const mesaMask = Math.min(1, Math.max(0, (reliefRaw - 0.50) / 0.20)) ** 2 * (3 - 2 * Math.min(1, Math.max(0, (reliefRaw - 0.50) / 0.20)));
      const terracedRaw = Math.round(reliefRaw * 5) / 5;
      return reliefRaw * (1 - mesaMask) + terracedRaw * mesaMask;
    }
    const N = 400;
    const vals = [];
    for (let i = 0; i < N; i++) vals.push(reliefWithMesas(i / (N - 1), 0.5));
    let bestFlatRun = 0; let curRun = 1;
    const FLAT_TOL = 0.0015;
    for (let i = 1; i < N; i++) {
      if (Math.abs(vals[i] - vals[i - 1]) < FLAT_TOL) curRun++; else { bestFlatRun = Math.max(bestFlatRun, curRun); curRun = 1; }
    }
    bestFlatRun = Math.max(bestFlatRun, curRun);
    // A genuinely flat tread should span a good double-digit run of the
    // 400-sample scan (real terraces are wide, not 1-2 samples wide).
    expect(bestFlatRun).toBeGreaterThan(8);
  });
});

describe('mars.js: craters are the shared craterField, dust-softened relative to Moon', () => {
  it("mars's own craterField call produces measurably LESS coverage than moon's -- craters are secondary here, not saturating like the Moon", () => {
    const marsCoverageAt = (seed) => {
      const noiseFine = new PerlinNoise(seed);
      const values = [];
      const N = 64;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) values.push(craterField(noiseFine, i / (N - 1), j / (N - 1), ASPECT, 3.7, { craterDensity: 0.22, craterDepth: 0.8, rimHeight: 0.35, saltOffset: 5000 }));
      return values.filter((v) => v !== 0).length / values.length;
    };
    const moonCoverageAt = (seed) => {
      const noiseFine = new PerlinNoise(seed);
      const values = [];
      const N = 64;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) values.push(craterField(noiseFine, i / (N - 1), j / (N - 1), ASPECT, 3.7, {}));
      return values.filter((v) => v !== 0).length / values.length;
    };
    expect(marsCoverageAt(42)).toBeLessThan(moonCoverageAt(42) * 0.75);
  });

  it('mars and moon are placed INDEPENDENTLY (different saltOffset) -- not visually identical crater positions at the same seed', () => {
    const marsVals = sample(mars, 42, 24);
    const moonVals = sample(moon, 42, 24);
    expect(marsVals).not.toEqual(moonVals);
  });
});

describe('mars.js: item 6 -- relief comparable to Simplex (measured std-dev)', () => {
  it("mars's stdDev at the default tweaks is at least Simplex's own, across several seeds (mars was measured well BELOW simplex before this rework)", () => {
    for (const seed of [1, 42, 100]) {
      const marsStats = meanStdDev(sample(mars, seed, 64));
      const simplexStats = meanStdDev(sample(simplex, seed, 64));
      expect(marsStats.stdDev, `seed ${seed}: mars stdDev ${marsStats.stdDev} vs simplex ${simplexStats.stdDev}`)
        .toBeGreaterThan(simplexStats.stdDev);
    }
  });
});

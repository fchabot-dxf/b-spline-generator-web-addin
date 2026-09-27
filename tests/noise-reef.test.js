/**
 * T78 item 5 (FILTER REWORK, Fred: reef showed "large FLAT-TOPPED plateaus
 * (clipped heights)") — reef.js: the colony-interior height no longer
 * saturates to a near-constant value. Root cause (found by isolating the
 * colony-interior-only samples, not by inspecting the whole-board
 * histogram, which is diluted by the large un-colonized sand area and
 * doesn't show an obvious spike on its own): the OLD `colonyLift =
 * pow(colonyMask, 0.7) * 0.45` compressed the UPPER range of colonyMask
 * so heavily (a concave pow curve with exponent <1) that most of a
 * colony's own interior — which covers a LARGE majority of the board at
 * default tweaks, not just isolated patches — converged toward nearly the
 * same height, independent of `min(1, colonyMask)`'s own hard cap (which,
 * measured, never actually engages at typical seeds/scale: colonyMask
 * stayed below 0.9 in every sample checked). Fixed by driving the colony
 * interior's OWN relief from an independent, unclipped mid-frequency FBM
 * (`headRaw`), gated by a smooth presence mask but never itself
 * compressed toward a shared ceiling.
 */
import { describe, it, expect } from 'vitest';
import { PerlinNoise } from '../bspline-frame-builder/b-spline-gen/html/core/noise.js';
import * as reef from '../bspline-frame-builder/b-spline-gen/html/core/noise/reef.js';

const ASPECT = 7 / 9;
const SCALE = 3.7;
const PARAMS = { scale: SCALE, octaves: 4, roughness: 0.5, warpIntensity: 1.0, tweaks: {} };
const COL_F = SCALE * 1.1;

/** Recomputes reef.js's own colVal (the pre-threshold colony signal) so
 *  tests can select "solidly inside a colony" sample points -- the same
 *  quantity reef.js's own colonyMaskRaw/presence are built from. */
function colVal(su, sv, noiseFine, noiseWarp) {
  const colWx = noiseWarp.fbm(su * 1.6, sv * 1.6, 3) * 2.0;
  const colWy = noiseWarp.fbm(su * 1.6 + 4, sv * 1.6 + 9, 3) * 2.0;
  return (noiseFine.fbm(su * COL_F * ASPECT + colWx, sv * COL_F + colWy, 3) + 1) * 0.5;
}

function sampleAll(seed, n) {
  const noiseFine = new PerlinNoise(seed);
  const noiseWarp = new PerlinNoise(seed ^ 0x9e3779b9);
  const all = []; const colonyOnly = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const su = i / (n - 1); const sv = j / (n - 1);
      const h = reef.fn(su, sv, ASPECT, PARAMS, { noiseFine, noiseWarp });
      all.push(h);
      // "solidly inside a colony" -- comfortably past the 0.45 default
      // threshold, not just barely across it (the presence gate's own
      // soft edge band), matching the region the old plateau bug affected.
      // PerlinNoise has no mutable state across calls, so reusing the SAME
      // instances here reproduces reef.fn's own internal colVal exactly.
      if (colVal(su, sv, noiseFine, noiseWarp) - 0.45 > 0.15) colonyOnly.push(h);
    }
  }
  return { all, colonyOnly };
}

function stdDev(arr) {
  const n = arr.length; const mean = arr.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
}

describe('reef.js: item 6 -- existing tweak keys preserved, unchanged defaults', () => {
  it('still declares exactly the 3 original tweak keys at their original defaults', () => {
    const byKey = Object.fromEntries(reef.tweaks.map((t) => [t.key, t]));
    expect(byKey.colonyThreshold.default).toBe(0.45);
    expect(byKey.brainStrength.default).toBe(0.18);
    expect(byKey.tubeStrength.default).toBe(0.55);
    expect(reef.tweaks).toHaveLength(3);
  });
});

describe('reef.js: determinism', () => {
  it('the same seed + params always produces the same output', () => {
    const noiseFine = new PerlinNoise(42); const noiseWarp = new PerlinNoise(42 ^ 0x9e3779b9);
    const a = reef.fn(0.31, 0.62, ASPECT, PARAMS, { noiseFine, noiseWarp });
    const noiseFine2 = new PerlinNoise(42); const noiseWarp2 = new PerlinNoise(42 ^ 0x9e3779b9);
    const b = reef.fn(0.31, 0.62, ASPECT, PARAMS, { noiseFine: noiseFine2, noiseWarp: noiseWarp2 });
    expect(a).toBe(b);
  });
});

describe('reef.js: item 5 -- no flat plateaus, structure continues on top', () => {
  it('a height histogram of the FULL output shows no large mass at the max -- the top 10% of the range holds under 2% of samples, across seeds', () => {
    for (const seed of [1, 42, 7, 100]) {
      const { all } = sampleAll(seed, 100);
      const max = Math.max(...all); const min = Math.min(...all);
      const bins = new Array(20).fill(0);
      for (const v of all) { let b = Math.floor(((v - min) / (max - min)) * 20); if (b >= 20) b = 19; bins[b]++; }
      const top2BinShare = (bins[18] + bins[19]) / all.length;
      expect(top2BinShare, `seed ${seed}: top-10%-of-range share ${top2BinShare}`).toBeLessThan(0.02);
    }
  });

  it('the colony INTERIOR (solidly past threshold, not just barely) keeps real height variance -- not a flat plateau with only texture riding on top', () => {
    for (const seed of [1, 42, 7, 100]) {
      const { colonyOnly } = sampleAll(seed, 100);
      expect(colonyOnly.length, `seed ${seed}: non-vacuous colony coverage`).toBeGreaterThan(20);
      const sd = stdDev(colonyOnly);
      // Measured: the OLD (buggy) colonyLift alone gave colony-interior
      // stdDev ~0.050 at seed 42; the fixed version measures ~0.08-0.087
      // across seeds. 0.065 sits clearly above the old value and clearly
      // below every measured new value -- a real regression guard, not a
      // trivially-passing threshold.
      expect(sd, `seed ${seed}: colony-interior stdDev ${sd}`).toBeGreaterThan(0.065);
    }
  });

  it('colony-interior variance is a healthy fraction of the WHOLE board\'s own variance (not disproportionately flatter than the surrounding terrain)', () => {
    for (const seed of [1, 42, 100]) {
      const { all, colonyOnly } = sampleAll(seed, 100);
      const ratio = stdDev(colonyOnly) / stdDev(all);
      expect(ratio, `seed ${seed}: colony/board stdDev ratio ${ratio}`).toBeGreaterThan(0.3);
    }
  });
});

describe('reef.js: presence still gates brain/tube/spike texture to the colony area only', () => {
  it('colonyThreshold:1 (an unreachable threshold) leaves virtually no colony texture -- sand only', () => {
    const noiseFine = new PerlinNoise(42); const noiseWarp = new PerlinNoise(42 ^ 0x9e3779b9);
    const params = { ...PARAMS, tweaks: { colonyThreshold: 1.0 } };
    const values = [];
    for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) values.push(reef.fn(i / 31, j / 31, ASPECT, params, { noiseFine, noiseWarp }));
    // Sand alone (no colony anywhere) has a small, tight range.
    expect(Math.max(...values) - Math.min(...values)).toBeLessThan(0.25);
  });
});

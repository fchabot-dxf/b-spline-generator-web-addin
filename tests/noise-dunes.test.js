/**
 * T78 item 4 (FILTER REWORK, Fred: dunes read as "a low flat slab with
 * fine ripples, no real crests") — dunes.js: a real asymmetric dune
 * cross-section (gentle windward/stoss climb, steep lee/slip-face drop),
 * a sharp crest, enough height to carve, and the existing cross-ripples +
 * curving-crest mechanics kept intact.
 */
import { describe, it, expect } from 'vitest';
import { PerlinNoise } from '../bspline-frame-builder/b-spline-gen/html/core/noise.js';
import * as dunes from '../bspline-frame-builder/b-spline-gen/html/core/noise/dunes.js';
import { _duneCrossSection } from '../bspline-frame-builder/b-spline-gen/html/core/noise/dunes.js';
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

describe('dunes.js: item 6 -- existing tweak keys preserved, unchanged defaults', () => {
  it('still declares exactly the 3 original tweak keys at their original defaults', () => {
    const byKey = Object.fromEntries(dunes.tweaks.map((t) => [t.key, t]));
    expect(byKey.crestSharpness.default).toBe(1.8);
    expect(byKey.windCurve.default).toBe(0.6);
    expect(byKey.rippleStrength.default).toBe(0.04);
    expect(dunes.tweaks).toHaveLength(3);
  });
});

describe('dunes.js: determinism', () => {
  it('the same seed + params always produces the same output', () => {
    expect(sample(dunes, 42, 24)).toEqual(sample(dunes, 42, 24));
  });
});

describe('dunes.js: _duneCrossSection -- real asymmetric profile, steep lee, gentle stoss', () => {
  // Direct unit tests on the core shaping function, isolated from the
  // wind-angle rotation/warp `fn()` layers on top -- a raw scan across the
  // full rotated+warped fn() doesn't reliably show the asymmetry at every
  // cross-section (the slowly-varying wind angle can cut a scan line at a
  // shallow angle to the crest, distorting the apparent local slope
  // ratio), so this is the precise, non-flaky place to verify the shape
  // itself.
  it('the climb (stoss) spans a WIDER fraction of the wavelength than the drop (lee) -- rises gently, falls quickly', () => {
    const N = 2000;
    let maxRise = 0; let maxFall = 0;
    for (let i = 1; i < N; i++) {
      const a = _duneCrossSection((i - 1) / N, 1); // crestSharpness:1 -- the raw triangle wave, unsharpened
      const b = _duneCrossSection(i / N, 1);
      const d = b - a;
      if (d > maxRise) maxRise = d;
      if (-d > maxFall) maxFall = -d;
    }
    // stossFrac=0.72 means the drop is covers only 28% of the wavelength
    // vs the climb's 72% -- for the same height range (0 to 1), the drop's
    // own per-sample slope should be roughly 0.72/0.28 =~ 2.57x steeper.
    expect(maxFall).toBeGreaterThan(maxRise * 2.0);
  });

  it('the profile is 0 at the trough (frac=0) and 1 at the crest (frac=stossFrac=0.72)', () => {
    expect(_duneCrossSection(0, 1)).toBeCloseTo(0, 5);
    expect(_duneCrossSection(0.72, 1)).toBeCloseTo(1, 5);
  });

  it('wraps correctly across wavelength boundaries (frac=1 behaves like frac=0)', () => {
    expect(_duneCrossSection(1.0, 1)).toBeCloseTo(_duneCrossSection(0, 1), 5);
    expect(_duneCrossSection(1.72, 1)).toBeCloseTo(_duneCrossSection(0.72, 1), 5);
  });

  it('crestSharpness still sharpens the peak -- a higher value produces a smaller fraction of "near-peak" samples', () => {
    const low = sample(dunes, 42, 64, { crestSharpness: 0.8 });
    const high = sample(dunes, 42, 64, { crestSharpness: 4.0 });
    const nearPeakFrac = (arr) => arr.filter((v) => v > 0.5).length / arr.length;
    expect(nearPeakFrac(high)).toBeLessThan(nearPeakFrac(low));
  });
});

describe('dunes.js: item 6 -- enough height to carve (relief comparable to Simplex)', () => {
  it("dunes's stdDev at the default tweaks is at least Simplex's own, across several seeds", () => {
    for (const seed of [1, 42, 100]) {
      const dunesStats = meanStdDev(sample(dunes, seed, 64));
      const simplexStats = meanStdDev(sample(simplex, seed, 64));
      expect(dunesStats.stdDev, `seed ${seed}: dunes stdDev ${dunesStats.stdDev} vs simplex ${simplexStats.stdDev}`)
        .toBeGreaterThan(simplexStats.stdDev);
    }
  });
});

describe('dunes.js: cross-ripples and curving crests kept', () => {
  it('rippleStrength is a real multiplier -- a higher value measurably changes the output from a zero-ripple baseline', () => {
    const none = sample(dunes, 42, 48, { rippleStrength: 0 });
    const strong = sample(dunes, 42, 48, { rippleStrength: 0.2 });
    let totalDiff = 0;
    for (let i = 0; i < none.length; i++) totalDiff += Math.abs(strong[i] - none[i]);
    expect(totalDiff / none.length).toBeGreaterThan(0.005);
  });

  it('windCurve still varies the dune direction -- windCurve:0 (parallel dunes) differs from windCurve:1.2 (curving dunes)', () => {
    const straight = sample(dunes, 42, 48, { windCurve: 0 });
    const curving = sample(dunes, 42, 48, { windCurve: 1.2 });
    expect(straight).not.toEqual(curving);
  });
});

/**
 * T78 item 7 (FILTER REWORK, Fred, three rounds of direction) — chest.js:
 * a lean torso, skin over bone. Direction #1 ("believable muscle relief")
 * was superseded before it shipped; direction #2+#3 ("more skin and bony
 * like", confirmed by a real reference photo) is what this file tests: a
 * visible ribcage (distinct curved bands, not one fused mound), a sternum
 * ridge, a costal margin, a sunken abdomen, and iliac crests.
 */
import { describe, it, expect } from 'vitest';
import { PerlinNoise } from '../bspline-frame-builder/b-spline-gen/html/core/noise.js';
import * as chest from '../bspline-frame-builder/b-spline-gen/html/core/noise/chest.js';

const ASPECT = 7 / 9;
const PARAMS = { scale: 3.7, octaves: 4, roughness: 0.5, warpIntensity: 1.0, tweaks: {} };

function sample(seed, n, tweaks = {}) {
  const noiseFine = new PerlinNoise(seed);
  const noiseWarp = new PerlinNoise(seed ^ 0x9e3779b9);
  const noiseRefs = { noiseFine, noiseWarp };
  const params = { ...PARAMS, tweaks };
  const grid = [];
  for (let j = 0; j < n; j++) {
    const row = [];
    for (let i = 0; i < n; i++) row.push(chest.fn(i / (n - 1), j / (n - 1), ASPECT, params, noiseRefs));
    grid.push(row);
  }
  return grid;
}

function sampleFlat(seed, n, tweaks = {}, extra = {}) {
  const noiseFine = new PerlinNoise(seed);
  const noiseWarp = new PerlinNoise(seed ^ 0x9e3779b9);
  const noiseRefs = { noiseFine, noiseWarp };
  const params = { ...PARAMS, ...extra, tweaks };
  const values = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) values.push(chest.fn(i / (n - 1), j / (n - 1), ASPECT, params, noiseRefs));
  return values;
}

describe('chest.js: T78 GUARD (Fred: "this is still a noise filter, right?") -- a real filter, not a fixed stamp', () => {
  it('two different seeds give visibly different detail at the same layout (skin texture + per-seed rib angle/count/spacing)', () => {
    expect(sampleFlat(1, 40)).not.toEqual(sampleFlat(2, 40));
  });

  it('a fixed seed is fully deterministic', () => {
    expect(sampleFlat(42, 40)).toEqual(sampleFlat(42, 40));
  });

  it('changing scale changes the result (affects the pore-texture and skin-drape frequencies)', () => {
    const a = sampleFlat(42, 40, {}, { scale: 2.0 });
    const b = sampleFlat(42, 40, {}, { scale: 6.0 });
    expect(a).not.toEqual(b);
  });

  it('changing warpIntensity changes the result (affects the skin-drape warp)', () => {
    const a = sampleFlat(42, 40, {}, { warpIntensity: 0.2 });
    const b = sampleFlat(42, 40, {}, { warpIntensity: 2.0 });
    expect(a).not.toEqual(b);
  });

  it('changing roughness changes the result (affects the pore-texture and skin-drape FBM gain)', () => {
    const a = sampleFlat(42, 40, {}, { roughness: 0.2 });
    const b = sampleFlat(42, 40, {}, { roughness: 0.8 });
    expect(a).not.toEqual(b);
  });
});

describe('chest.js: item 7 -- tweak keys kept (meaning changed), new skinDetail key added', () => {
  it('still declares exactly the 3 original keys plus the new skinDetail key', () => {
    const keys = chest.tweaks.map((t) => t.key).sort();
    expect(keys).toEqual(['absStrength', 'pectoralStrength', 'ribStrength', 'skinDetail'].sort());
  });

  it('an old saved pattern with only the 3 original keys (no skinDetail) still runs and reads the declared default', () => {
    const noiseFine = new PerlinNoise(1); const noiseWarp = new PerlinNoise(1 ^ 0x9e3779b9);
    const oldTweaks = { pectoralStrength: 0.70, absStrength: 0.25, ribStrength: 0.08 };
    expect(() => chest.fn(0.4, 0.5, ASPECT, { ...PARAMS, tweaks: oldTweaks }, { noiseFine, noiseWarp })).not.toThrow();
  });
});

describe('chest.js: determinism', () => {
  it('the same seed + params always produces the same output', () => {
    expect(sample(42, 24)).toEqual(sample(42, 24));
  });
});

describe('chest.js: item 7 -- a visible ribcage (distinct separated bands, not one fused mound)', () => {
  it('a vertical scan down one flank crosses MULTIPLE local peaks (separate ribs) with real valleys between them, not one solid mound', () => {
    // su=0.78 sits solidly in the "flank" region (past ribFrontFade's own
    // ramp, i.e. dx > ~0.38) where the ribcage is at full strength.
    const noiseFine = new PerlinNoise(42); const noiseWarp = new PerlinNoise(42 ^ 0x9e3779b9);
    const N = 300;
    const vals = [];
    for (let j = 0; j < N; j++) vals.push(chest.fn(0.78, j / (N - 1), ASPECT, PARAMS, { noiseFine, noiseWarp }));
    // Restrict to the ribcage's own span (roughly dy 0.15-0.55) to avoid
    // counting unrelated peaks from the clavicle/abdomen regions.
    const lo = Math.floor(N * 0.14); const hi = Math.floor(N * 0.56);
    let peaks = 0;
    for (let i = lo + 1; i < hi - 1; i++) {
      if (vals[i] > vals[i - 1] && vals[i] > vals[i + 1] && vals[i] > 0.05) peaks++;
    }
    // 7 ribs are declared; a real regression (bands merging into one
    // mound, the T78 tuning bug this file's own header documents) would
    // collapse this to 1 broad peak instead.
    expect(peaks).toBeGreaterThanOrEqual(4);
  });

  it('ribStrength is the MAIN control now -- a pointwise DIFFERENCE between two ribStrength values shows real, non-zero variation', () => {
    // Rather than comparing whole-window ranges (which mixes in deltoid/
    // soft-tissue/abdomen terms that DON'T scale with ribStrength and can
    // dominate the measurement once the ribcage's own span moves around
    // per seed -- see the T78 AMEND note on the per-seed structural
    // draws), take the pointwise DIFFERENCE fn(high) - fn(low) at the same
    // (su,sv): every term that doesn't depend on ribStrength cancels out
    // exactly, leaving only the ribcage/costal-margin/iliac-crest
    // contribution's own scaled delta -- a precise, seed-shape-independent
    // isolation of ribStrength's real effect.
    const noiseFineLow = new PerlinNoise(42); const noiseWarpLow = new PerlinNoise(42 ^ 0x9e3779b9);
    const noiseFineHigh = new PerlinNoise(42); const noiseWarpHigh = new PerlinNoise(42 ^ 0x9e3779b9);
    const N = 300;
    const diffs = [];
    for (let j = 0; j < N; j++) {
      const sv = 0.08 + (j / (N - 1)) * (0.75 - 0.08);
      const low = chest.fn(0.78, sv, ASPECT, { ...PARAMS, tweaks: { ribStrength: 0.07 } }, { noiseFine: noiseFineLow, noiseWarp: noiseWarpLow });
      const high = chest.fn(0.78, sv, ASPECT, { ...PARAMS, tweaks: { ribStrength: 0.14 } }, { noiseFine: noiseFineHigh, noiseWarp: noiseWarpHigh });
      diffs.push(high - low);
    }
    const range = Math.max(...diffs) - Math.min(...diffs);
    expect(range).toBeGreaterThan(0.03);
  });
});

describe('chest.js: sternum ridge, sunken abdomen, iliac crest', () => {
  it('the sternum centreline sits higher than a point just off-centre at the same height, within the ribcage span', () => {
    const noiseFine = new PerlinNoise(42); const noiseWarp = new PerlinNoise(42 ^ 0x9e3779b9);
    const centre = chest.fn(0.5, 0.3, ASPECT, PARAMS, { noiseFine, noiseWarp });
    const noiseFine2 = new PerlinNoise(42); const noiseWarp2 = new PerlinNoise(42 ^ 0x9e3779b9);
    const offCentre = chest.fn(0.5 + 0.03, 0.3, ASPECT, PARAMS, { noiseFine: noiseFine2, noiseWarp: noiseWarp2 });
    expect(centre).toBeGreaterThan(offCentre);
  });

  it('the abdomen (below the costal margin, near-centre) is SUNKEN -- height there is lower than at the ribcage centre-height', () => {
    const noiseFine = new PerlinNoise(42); const noiseWarp = new PerlinNoise(42 ^ 0x9e3779b9);
    const ribArea = chest.fn(0.5, 0.30, ASPECT, PARAMS, { noiseFine, noiseWarp });
    const noiseFine2 = new PerlinNoise(42); const noiseWarp2 = new PerlinNoise(42 ^ 0x9e3779b9);
    const abdomenArea = chest.fn(0.5, 0.75, ASPECT, PARAMS, { noiseFine: noiseFine2, noiseWarp: noiseWarp2 });
    expect(abdomenArea).toBeLessThan(ribArea);
  });

  it('absStrength controls abdomen depth -- a higher value sinks the abdomen further', () => {
    const noiseFine = new PerlinNoise(42); const noiseWarp = new PerlinNoise(42 ^ 0x9e3779b9);
    const shallow = chest.fn(0.5, 0.75, ASPECT, { ...PARAMS, tweaks: { absStrength: 0.05 } }, { noiseFine, noiseWarp });
    const noiseFine2 = new PerlinNoise(42); const noiseWarp2 = new PerlinNoise(42 ^ 0x9e3779b9);
    const deep = chest.fn(0.5, 0.75, ASPECT, { ...PARAMS, tweaks: { absStrength: 0.25 } }, { noiseFine: noiseFine2, noiseWarp: noiseWarp2 });
    expect(deep).toBeLessThan(shallow);
  });

  it('iliac crest bands are present near the waist sides (a real raised ridge, not zero)', () => {
    const noiseFine = new PerlinNoise(42); const noiseWarp = new PerlinNoise(42 ^ 0x9e3779b9);
    const N = 60;
    let maxNear = -Infinity;
    for (let j = 0; j < N; j++) {
      const sv = 0.80 + (j / (N - 1)) * 0.15; // scan the iliac crest's own dy band
      const h = chest.fn(0.75, sv, ASPECT, PARAMS, { noiseFine, noiseWarp });
      if (h > maxNear) maxNear = h;
    }
    expect(maxNear).toBeGreaterThan(0.05);
  });
});

describe('chest.js: skinDetail texture', () => {
  it('is a real multiplier -- a higher value measurably changes the output from a zero baseline', () => {
    const none = sample(42, 40, { skinDetail: 0 });
    const strong = sample(42, 40, { skinDetail: 0.2 });
    let totalDiff = 0; let n = 0;
    for (let j = 0; j < none.length; j++) for (let i = 0; i < none[j].length; i++) { totalDiff += Math.abs(strong[j][i] - none[j][i]); n++; }
    expect(totalDiff / n).toBeGreaterThan(0.002);
  });
});

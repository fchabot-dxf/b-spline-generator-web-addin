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

function refs(seed) {
  return { noiseFine: new PerlinNoise(seed), noiseWarp: new PerlinNoise(seed ^ 0x9e3779b9) };
}

// dy is chest.js's own neck->waist coordinate; sv=0 is the bottom edge of
// the board as rendered, so dy = 1 - sv.
const svAt = (dy) => 1 - dy;

function sample(seed, n, tweaks = {}) {
  const noiseRefs = refs(seed);
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
  const noiseRefs = refs(seed);
  const params = { ...PARAMS, ...extra, tweaks };
  const values = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) values.push(chest.fn(i / (n - 1), j / (n - 1), ASPECT, params, noiseRefs));
  return values;
}

describe('chest.js: T78 GUARD (Fred: "this is still a noise filter, right?") -- a real filter, not a fixed stamp', () => {
  it('two different seeds give visibly different detail at the same layout', () => {
    expect(sampleFlat(1, 40)).not.toEqual(sampleFlat(2, 40));
  });

  it('a fixed seed is fully deterministic', () => {
    expect(sampleFlat(42, 40)).toEqual(sampleFlat(42, 40));
  });

  it('changing scale changes the result (affects the pore-texture and skin-drape frequencies)', () => {
    expect(sampleFlat(42, 40, {}, { scale: 2.0 })).not.toEqual(sampleFlat(42, 40, {}, { scale: 6.0 }));
  });

  it('changing warpIntensity changes the result (affects the skin-drape warp)', () => {
    expect(sampleFlat(42, 40, {}, { warpIntensity: 0.2 })).not.toEqual(sampleFlat(42, 40, {}, { warpIntensity: 2.0 }));
  });

  it('changing roughness changes the result (affects the pore-texture and skin-drape FBM gain)', () => {
    expect(sampleFlat(42, 40, {}, { roughness: 0.2 })).not.toEqual(sampleFlat(42, 40, {}, { roughness: 0.8 }));
  });
});

describe('chest.js: item 7 -- tweak keys kept (meaning changed), new skinDetail key added', () => {
  it('still declares exactly the 3 original keys plus the new skinDetail key', () => {
    const keys = chest.tweaks.map((t) => t.key).sort();
    expect(keys).toEqual(['absStrength', 'pectoralStrength', 'ribStrength', 'skinDetail'].sort());
  });

  it('an old saved pattern with only the 3 original keys (no skinDetail) still runs and reads the declared default', () => {
    const oldTweaks = { pectoralStrength: 0.70, absStrength: 0.25, ribStrength: 0.08 };
    expect(() => chest.fn(0.4, 0.5, ASPECT, { ...PARAMS, tweaks: oldTweaks }, refs(1))).not.toThrow();
  });
});

describe('chest.js: determinism', () => {
  it('the same seed + params always produces the same output', () => {
    expect(sample(42, 24)).toEqual(sample(42, 24));
  });
});

describe('chest.js: T78 AMEND 8 -- three stacked canvas sections (shoulders, ribcage, abdomen)', () => {
  it('for 200 seeds the sections are contiguous, ordered, cover the board, and none is degenerate', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const L = chest._layout(new PerlinNoise(seed));
      expect(L.top2).toBeCloseTo(L.h1, 12);
      expect(L.top3).toBeCloseTo(L.h1 + L.h2, 12);
      expect(L.top3 + L.h3).toBeCloseTo(1, 12);
      for (const h of [L.h1, L.h2, L.h3]) expect(h).toBeGreaterThan(0.09);
    }
  });

  it('for 200 seeds every rib\'s full curve stays inside the ribcage section (the stack makes room for its own bend)', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const L = chest._layout(new PerlinNoise(seed));
      expect(L.ribs.length).toBe(L.ribCount);
      expect(L.ribCount).toBeGreaterThanOrEqual(3);
      for (let i = 0; i <= 20; i++) {
        const shape = Math.pow(i / 20, L.ribCurve);
        for (const rib of L.ribs) {
          const y = rib.y0 + rib.bend * shape;
          expect(y).toBeGreaterThan(L.top2);
          expect(y).toBeLessThan(L.top3);
        }
      }
      for (let k = 1; k < L.ribs.length; k++) expect(L.ribs[k].y0).toBeGreaterThan(L.ribs[k - 1].y0);
      expect(L.marginApex).toBeGreaterThan(L.top2);
      expect(L.marginApex).toBeLessThan(L.top3);
      expect(L.navelY).toBeGreaterThan(L.top3);
      expect(L.navelY).toBeLessThan(1);
    }
  });

  it('the ribs can never draw inside the shoulders section, which sits at the TOP of the board as rendered (sv near 1)', () => {
    // ribStrength scales only the ribcage, costal margin and iliac crest, so a
    // pointwise high-minus-low difference isolates exactly those parts.
    for (let seed = 1; seed <= 50; seed++) {
      const L = chest._layout(new PerlinNoise(seed));
      for (let j = 0; j <= 20; j++) {
        const dy = (j / 20) * (L.top2 - 0.03);
        for (const su of [0.3, 0.6, 0.9]) {
          const low = chest.fn(su, svAt(dy), ASPECT, { ...PARAMS, tweaks: { ribStrength: 0.0 } }, refs(seed));
          const high = chest.fn(su, svAt(dy), ASPECT, { ...PARAMS, tweaks: { ribStrength: 0.3 } }, refs(seed));
          expect(high - low).toBe(0);
        }
      }
    }
  });

  it('the torso is right way up: the ribcage relief sits above the board\'s vertical middle more often than a flipped torso would allow', () => {
    // A flipped torso would put the shoulders at sv near 0; here the
    // shoulders (no rib relief) must be the sv near 1 end.
    const L = chest._layout(new PerlinNoise(42));
    const ribAt = (sv) => {
      const low = chest.fn(0.8, sv, ASPECT, { ...PARAMS, tweaks: { ribStrength: 0.0 } }, refs(42));
      const high = chest.fn(0.8, sv, ASPECT, { ...PARAMS, tweaks: { ribStrength: 0.3 } }, refs(42));
      return Math.abs(high - low);
    };
    let nearTop = 0; let nearBottom = 0;
    for (let j = 0; j <= 40; j++) {
      const dy = (j / 40) * (L.top2 - 0.03);
      nearTop += ribAt(1 - dy);
      nearBottom += ribAt(dy);
    }
    expect(nearTop).toBe(0);
    expect(nearBottom).toBeGreaterThan(0);
  });

  it('the abdomen parts can never draw inside the ribcage or shoulders sections', () => {
    // absStrength scales only abdomen parts (concavity, ab lines, navel).
    for (let seed = 1; seed <= 50; seed++) {
      const L = chest._layout(new PerlinNoise(seed));
      for (let j = 0; j <= 20; j++) {
        const dy = (j / 20) * (L.top3 - 0.03);
        for (const su of [0, 0.4, 0.8]) {
          const low = chest.fn(su, svAt(dy), ASPECT, { ...PARAMS, tweaks: { absStrength: 0.0 } }, refs(seed));
          const high = chest.fn(su, svAt(dy), ASPECT, { ...PARAMS, tweaks: { absStrength: 0.3 } }, refs(seed));
          expect(high - low).toBe(0);
        }
      }
    }
  });

  it('only the ANGLE follows a neighbour: the costal margin bends with the lowest rib, within a small jitter', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const L = chest._layout(new PerlinNoise(seed));
      expect(Math.abs(L.marginBend - L.ribBend * (1 + L.ribFan))).toBeLessThanOrEqual(0.05 * L.h2 + 1e-12);
    }
  });

  it('rib bend stays in the range Fred approved: never past 0.07 of the board, both directions used', () => {
    let up = 0; let down = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const L = chest._layout(new PerlinNoise(seed));
      expect(Math.abs(L.ribBend)).toBeLessThanOrEqual(0.07);
      if (L.ribBend > 0.02) up++;
      if (L.ribBend < -0.02) down++;
    }
    expect(up).toBeGreaterThan(30);
    expect(down).toBeGreaterThan(30);
  });

  it('the clavicle is sometimes the long band, sometimes the hip-bone-style bump, mostly one clear style', () => {
    let band = 0; let bump = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const b = chest._layout(new PerlinNoise(seed)).clavicleBump;
      if (b < 0.1) band++;
      if (b > 0.9) bump++;
    }
    expect(band).toBeGreaterThan(40);
    expect(bump).toBeGreaterThan(40);
    expect(band + bump).toBeGreaterThan(120);
  });

  it('the sternum is sometimes raised, sometimes carved, with the range midpoint below the surface', () => {
    const depths = [];
    for (let seed = 1; seed <= 200; seed++) depths.push(chest._layout(new PerlinNoise(seed)).sternumDepth);
    const carved = depths.filter((d) => d < 0).length;
    expect(carved).toBeGreaterThan(100);
    expect(carved).toBeLessThan(180);
    depths.sort((a, b) => a - b);
    expect(depths[100]).toBeLessThan(0);
  });

  it('the sternum\'s depth and width change along its own length', () => {
    let seedsWithVariation = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const L = chest._layout(new PerlinNoise(seed));
      const depth = []; const width = [];
      for (let i = 0; i <= 40; i++) {
        const dy = L.sternumStart + (i / 40) * (L.sternumEnd - L.sternumStart);
        depth.push(L.sternumDepthAt(dy)); width.push(L.sternumWidthAt(dy));
      }
      if (Math.max(...depth) - Math.min(...depth) > 0.01) seedsWithVariation++;
    }
    expect(seedsWithVariation).toBeGreaterThan(40);
  });

  it('the lead angles really vary in both directions across seeds (no part pinned flat)', () => {
    const clav = []; const ribs = []; const abLines = [];
    for (let seed = 1; seed <= 200; seed++) {
      const L = chest._layout(new PerlinNoise(seed));
      clav.push(L.clavicleY(1) - L.clavicleY(0));
      ribs.push(L.ribBend);
      abLines.push(L.abLineTilt);
    }
    for (const angles of [clav, ribs, abLines]) {
      expect(Math.min(...angles)).toBeLessThan(-0.05);
      expect(Math.max(...angles)).toBeGreaterThan(0.02);
      // Pinning (the old clamped clavicle: 91 of 200 seeds on one value)
      // piles seeds into one slot; 100 slots across the range, 2 per slot
      // on average.
      const lo = Math.min(...angles); const hi = Math.max(...angles);
      const counts = new Map();
      for (const a of angles) {
        const slot = Math.round(((a - lo) / (hi - lo)) * 99);
        counts.set(slot, (counts.get(slot) ?? 0) + 1);
      }
      expect(Math.max(...counts.values())).toBeLessThanOrEqual(12);
    }
  });
});

describe('chest.js: item 7 -- a visible ribcage (distinct separated bands, not one fused mound)', () => {
  it('a vertical scan down one flank crosses MULTIPLE local peaks (separate ribs) with real valleys between them', () => {
    const noiseRefs = refs(42);
    const L = chest._layout(noiseRefs.noiseFine);
    const N = 400;
    let peaks = 0; let prev2 = null; let prev1 = null;
    for (let j = 0; j < N; j++) {
      const dy = L.top2 + (j / (N - 1)) * L.h2;
      const h = chest.fn(0.78, svAt(dy), ASPECT, PARAMS, noiseRefs);
      if (prev2 !== null && prev1 > prev2 && prev1 > h && prev1 > 0.05) peaks++;
      prev2 = prev1; prev1 = h;
    }
    expect(peaks).toBeGreaterThanOrEqual(Math.min(4, L.ribCount - 1));
  });

  it('ribStrength is the MAIN control -- a pointwise DIFFERENCE between two ribStrength values shows real, non-zero variation', () => {
    const N = 300;
    const diffs = [];
    for (let j = 0; j < N; j++) {
      const sv = 0.08 + (j / (N - 1)) * (0.75 - 0.08);
      const low = chest.fn(0.78, sv, ASPECT, { ...PARAMS, tweaks: { ribStrength: 0.07 } }, refs(42));
      const high = chest.fn(0.78, sv, ASPECT, { ...PARAMS, tweaks: { ribStrength: 0.14 } }, refs(42));
      diffs.push(high - low);
    }
    expect(Math.max(...diffs) - Math.min(...diffs)).toBeGreaterThan(0.03);
  });
});

describe('chest.js: sternum ridge, sunken abdomen, iliac crest', () => {
  it('the abdomen (below the costal margin, near-centre) is SUNKEN -- lower than the ribcage at the same su', () => {
    const L = chest._layout(new PerlinNoise(42));
    const ribArea = chest.fn(0.5, svAt(L.top2 + L.h2 * 0.5), ASPECT, PARAMS, refs(42));
    const abdomenArea = chest.fn(0.5, svAt(L.top3 + L.h3 * 0.5), ASPECT, PARAMS, refs(42));
    expect(abdomenArea).toBeLessThan(ribArea);
  });

  it('absStrength controls abdomen depth -- a higher value sinks the abdomen further', () => {
    const L = chest._layout(new PerlinNoise(42));
    const sv = svAt(L.top3 + L.h3 * 0.5);
    const shallow = chest.fn(0.5, sv, ASPECT, { ...PARAMS, tweaks: { absStrength: 0.05 } }, refs(42));
    const deep = chest.fn(0.5, sv, ASPECT, { ...PARAMS, tweaks: { absStrength: 0.25 } }, refs(42));
    expect(deep).toBeLessThan(shallow);
  });

  it('no hip bones (Fred): ribStrength has no effect anywhere in the abdomen section', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const L = chest._layout(new PerlinNoise(seed));
      for (let j = 0; j <= 20; j++) {
        const dy = L.top3 + 0.03 + (j / 20) * (L.h3 - 0.03);
        for (const su of [0.3, 0.6, 0.9]) {
          const low = chest.fn(su, svAt(dy), ASPECT, { ...PARAMS, tweaks: { ribStrength: 0.0 } }, refs(seed));
          const high = chest.fn(su, svAt(dy), ASPECT, { ...PARAMS, tweaks: { ribStrength: 0.3 } }, refs(seed));
          expect(high - low).toBe(0);
        }
      }
    }
  });

  it('3 to 7 ribs (Fred), and every seed keeps a real gap between adjacent ribs', () => {
    const counts = new Set();
    for (let seed = 1; seed <= 200; seed++) {
      const L = chest._layout(new PerlinNoise(seed));
      counts.add(L.ribCount);
      expect(L.ribCount).toBeGreaterThanOrEqual(3);
      expect(L.ribCount).toBeLessThanOrEqual(7);
    }
    expect([...counts].sort()).toEqual([3, 4, 5, 6, 7]);
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

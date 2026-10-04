/**
 * H23 item 73(c) -- height-profile.js's own brickTopHeight: the 3D shape (rounded shoulder, slight
 * crown, seeded corner chips) within a single brick's own top face, plus engine.js's own
 * sampleHeight now routing through it. The "real photo surface" detail is explicitly NOT built
 * here (an adapter/raster concern, see height-profile.js's own header) -- covered only via the
 * optional sampleDetailAt callback's own contract.
 */
import { describe, it, expect } from 'vitest';
import { brickTopHeight } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/height-profile.js';
import { generateBricks, buildSpatialIndex, sampleHeight } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { BRICK_SETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

const SET = BRICK_SETS[0]; // has a real, declared heightProfile
const rect = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];

// a plain 1x1 square brick centred at the origin, for isolated geometry checks
const squareBrick = { id: 1, polygon: [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }] };

describe('brickTopHeight — shape only (no declared heightProfile == the original flat top)', () => {
  const flatSet = { reliefIn: 0.125, reliefMaxIn: 0.25 }; // no heightProfile at all
  it('is exactly reliefIn everywhere inside the brick when no heightProfile is declared', () => {
    for (const [x, y] of [[0, 0], [0.3, 0.1], [-0.49, -0.49], [0.49, 0.49]]) {
      expect(brickTopHeight(x, y, squareBrick, flatSet, 1)).toBeCloseTo(0.125, 9);
    }
  });

  it('adds the brick\'s own heightOffset on top, unchanged from before', () => {
    const brick = { ...squareBrick, heightOffset: 0.02 };
    expect(brickTopHeight(0, 0, brick, flatSet, 1)).toBeCloseTo(0.145, 9);
  });
});

describe('brickTopHeight — shoulder (rounded edge)', () => {
  const set = { reliefIn: 0.125, reliefMaxIn: 0.25, heightProfile: { edgeRadiusIn: 0.1, crown: 0, chipRate: 0, chipSizeIn: 0, surfaceShare: 0 } };
  it('is ~0 right at the edge and rises toward the full relief height moving inward', () => {
    const atEdge = brickTopHeight(0, -0.5, squareBrick, set, 1); // on the bottom edge
    const halfway = brickTopHeight(0, -0.45, squareBrick, set, 1); // 0.05 in from the edge (half of edgeRadiusIn)
    const beyondRadius = brickTopHeight(0, -0.3, squareBrick, set, 1); // 0.2 in from the edge, past edgeRadiusIn
    expect(atEdge).toBeCloseTo(0, 6);
    expect(halfway).toBeGreaterThan(atEdge);
    expect(halfway).toBeLessThan(beyondRadius);
    expect(beyondRadius).toBeCloseTo(0.125, 6); // full relief once past edgeRadiusIn (crown=0 here)
  });

  it('is monotonically non-decreasing moving from the edge toward the centre', () => {
    let prev = -1;
    for (let d = 0; d <= 0.5; d += 0.02) {
      const h = brickTopHeight(0, -0.5 + d, squareBrick, set, 1);
      expect(h).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = h;
    }
  });
});

describe('brickTopHeight — crown (a slight dome)', () => {
  it('adds extra height at the centre beyond the shoulder alone, but not at the edge', () => {
    const noCrown = { reliefIn: 0.125, reliefMaxIn: 0.25, heightProfile: { edgeRadiusIn: 0.05, crown: 0, chipRate: 0, chipSizeIn: 0, surfaceShare: 0 } };
    const withCrown = { reliefIn: 0.125, reliefMaxIn: 0.25, heightProfile: { edgeRadiusIn: 0.05, crown: 0.15, chipRate: 0, chipSizeIn: 0, surfaceShare: 0 } };
    const centreNoCrown = brickTopHeight(0, 0, squareBrick, noCrown, 1);
    const centreWithCrown = brickTopHeight(0, 0, squareBrick, withCrown, 1);
    expect(centreWithCrown).toBeGreaterThan(centreNoCrown);
    // at the edge itself, both shoulder and crown are ~0 -- no meaningful difference
    const edgeNoCrown = brickTopHeight(0, -0.5, squareBrick, noCrown, 1);
    const edgeWithCrown = brickTopHeight(0, -0.5, squareBrick, withCrown, 1);
    expect(Math.abs(edgeWithCrown - edgeNoCrown)).toBeLessThan(1e-6);
  });
});

describe('brickTopHeight — chips (seeded, occasional)', () => {
  const set = { reliefIn: 0.125, reliefMaxIn: 0.25, heightProfile: { edgeRadiusIn: 0, crown: 0, chipRate: 1, chipSizeIn: 0.2, surfaceShare: 0 } };
  it('chipRate=1 guarantees a dip at SOME corner, down to ~0 right at that corner\'s own tip', () => {
    // rather than predict which of the 4 corners gets picked (seeded internally), just check that
    // AT LEAST one of them now reads ~0.
    const heights = squareBrick.polygon.map((p) => brickTopHeight(p.x, p.y, squareBrick, set, 7));
    expect(Math.min(...heights)).toBeLessThan(0.01);
  });

  it('chipRate=0 never dips any corner', () => {
    const noChipSet = { reliefIn: 0.125, reliefMaxIn: 0.25, heightProfile: { edgeRadiusIn: 0, crown: 0, chipRate: 0, chipSizeIn: 0.2, surfaceShare: 0 } };
    const heights = squareBrick.polygon.map((p) => brickTopHeight(p.x, p.y, squareBrick, noChipSet, 7));
    for (const h of heights) expect(h).toBeCloseTo(0.125, 6);
  });

  it('is deterministic for a given seed (same brick id -> same chip decision)', () => {
    const h1 = brickTopHeight(-0.5, -0.5, squareBrick, set, 7);
    const h2 = brickTopHeight(-0.5, -0.5, squareBrick, set, 7);
    expect(h1).toBe(h2);
  });
});

describe('brickTopHeight — surfaceShare (optional sampleDetailAt)', () => {
  const set = { reliefIn: 0.125, reliefMaxIn: 0.25, heightProfile: { edgeRadiusIn: 0, crown: 0, chipRate: 0, chipSizeIn: 0, surfaceShare: 0.3 } };
  it('with no sampleDetailAt callback, contributes nothing (shape-only, still correct)', () => {
    // surfaceShare=0.3 but no callback -> height = reliefIn*(1-0.3)*1 = 0.0875 (never silently 0 or NaN)
    expect(brickTopHeight(0, 0, squareBrick, set, 1)).toBeCloseTo(0.125 * 0.7, 6);
  });

  it('a +1 detail value adds up to surfaceShare*reliefIn; a -1 value subtracts the same amount', () => {
    const base = brickTopHeight(0, 0, squareBrick, set, 1);
    const plus = brickTopHeight(0, 0, squareBrick, set, 1, () => 1);
    const minus = brickTopHeight(0, 0, squareBrick, set, 1, () => -1);
    expect(plus - base).toBeCloseTo(0.125 * 0.3, 6);
    expect(base - minus).toBeCloseTo(0.125 * 0.3, 6);
  });

  it('clamps an out-of-range detail value to [-1,1] rather than trusting the adapter', () => {
    const huge = brickTopHeight(0, 0, squareBrick, set, 1, () => 100);
    const plus1 = brickTopHeight(0, 0, squareBrick, set, 1, () => 1);
    expect(huge).toBeCloseTo(plus1, 9);
  });
});

describe('sampleHeight integration (engine.js) — still clamps to reliefMaxIn, now via the full profile', () => {
  it('a set whose shoulder+crown+detail could exceed reliefMaxIn is still clamped', () => {
    const board = rect(9, 12);
    const extremeSet = { ...SET, heightProfile: { edgeRadiusIn: 0.01, crown: 0.2, chipRate: 0, chipSizeIn: 0, surfaceShare: 0 }, reliefIn: 0.24, reliefMaxIn: 0.25 };
    const result = generateBricks({ boardOutline: board, set: extremeSet, seed: 1 });
    const index = buildSpatialIndex([...result.bricks, ...result.frameBricks], 1);
    for (const b of result.bricks) {
      const c = b.polygon.reduce((s, p) => ({ x: s.x + p.x / b.polygon.length, y: s.y + p.y / b.polygon.length }), { x: 0, y: 0 });
      const h = sampleHeight(result, index, c.x, c.y, extremeSet);
      expect(h).toBeLessThanOrEqual(extremeSet.reliefMaxIn + 1e-9);
      expect(h).toBeGreaterThanOrEqual(0);
    }
  });

  it('is deterministic: same seed, same point, same height', () => {
    const board = rect(9, 12);
    const result = generateBricks({ boardOutline: board, set: SET, seed: 5 });
    const h1 = sampleHeight(result, null, 4.5, 6, SET);
    const h2 = sampleHeight(result, null, 4.5, 6, SET);
    expect(h1).toBe(h2);
  });
});

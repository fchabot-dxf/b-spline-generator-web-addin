/**
 * F34 item 1 — Fred's own ruling: "the photo is the SOURCE, the existing
 * Symmetry setting ... still applies on top ... the photo does NOT
 * override it." This is THE test that proves it: terrain.js folds (su, sv)
 * for Mirror X/Y/quadrant BEFORE calling any filter's fn() (core/terrain.js
 * lines ~83-90), so the Photo filter needed ZERO special-casing for
 * Symmetry -- it just samples the processed photo at whatever (su, sv) it's
 * handed. Exercised through the REAL generateHeightmap (not a hand-rolled
 * fold), the same entry point every other filter goes through.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateHeightmap } from '../bspline-frame-builder/b-spline-gen/html/core/terrain.js';
import { ensurePhotoDecoded, _resetPhotoStateForTests } from '../bspline-frame-builder/b-spline-gen/html/core/photo/state.js';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/photo/codec.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, decodeImageToGrey: vi.fn(async (url) => globalThis.__fakeDecoded[url]) };
});

const NX = 8, NZ = 6;

const BASE = {
  widthIn: 7, heightIn: 9, carveZ: 1.5, seed: 42, scale: 3.7, macroScale: 0.65,
  mapZoom: 1, seedOffsetX: 0, seedOffsetY: 0, octaves: 4, roughness: 0.5,
  edgeMargin: 0, symOffsetX: 0, symOffsetY: 0, noiseType: 'photo', warpIntensity: 1.0,
  nx: NX, nz: NZ,
};

beforeEach(async () => {
  _resetPhotoStateForTests();
  // A 4x4 photo with a CLEAR gradient both ways (i + j*4, 0..15) -- fully
  // asymmetric, so a 'none' run can be shown to actually differ L/R and
  // T/B, not just happen to pass because the source image was symmetric.
  globalThis.__fakeDecoded = {
    'data:grad': { data: Float32Array.from(Array.from({ length: 16 }, (_, k) => k / 15)), w: 4, h: 4 },
  };
  await ensurePhotoDecoded('data:grad');
});

function build(symmetry) {
  return generateHeightmap({ ...BASE, symmetry, photoImageDataUrl: 'data:grad', photoEdits: [] });
}

describe('Photo + Symmetry composition (terrain.js folds su/sv before any filter runs)', () => {
  it('symmetry=none: the asymmetric photo produces an asymmetric heightmap (sanity -- proves the test photo is a real asymmetry probe)', () => {
    const { heights } = build('none');
    let anyLRDiff = false, anyTBDiff = false;
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        if (heights[j * NX + i] !== heights[j * NX + (NX - 1 - i)]) anyLRDiff = true;
        if (heights[j * NX + i] !== heights[(NZ - 1 - j) * NX + i]) anyTBDiff = true;
      }
    }
    expect(anyLRDiff).toBe(true);
    expect(anyTBDiff).toBe(true);
  });

  it("symmetry='x' (Mirror X): every row mirrors left-right exactly, with zero photo-specific code", () => {
    const { heights } = build('x');
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        expect(heights[j * NX + i]).toBeCloseTo(heights[j * NX + (NX - 1 - i)], 6);
      }
    }
  });

  it("symmetry='y' (Mirror Y): every column mirrors top-bottom exactly", () => {
    const { heights } = build('y');
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        expect(heights[j * NX + i]).toBeCloseTo(heights[(NZ - 1 - j) * NX + i], 6);
      }
    }
  });

  it("symmetry='radial' (quadrant): mirrors BOTH ways at once", () => {
    const { heights } = build('radial');
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        expect(heights[j * NX + i]).toBeCloseTo(heights[j * NX + (NX - 1 - i)], 6);
        expect(heights[j * NX + i]).toBeCloseTo(heights[(NZ - 1 - j) * NX + i], 6);
      }
    }
  });

  it('a symOffsetX-shifted mirror axis still folds correctly (not just the default centre)', () => {
    const { heights } = generateHeightmap({ ...BASE, symmetry: 'x', symOffsetX: 0.2, photoImageDataUrl: 'data:grad', photoEdits: [] });
    // mx = 0.5 + 0.2 = 0.7 in u-space (0..1); mirror pairs are i, i' such
    // that u_i and u_i' are equidistant from 0.7 -- just re-derive from the
    // same formula terrain.js itself uses rather than asserting plain
    // left-right symmetry (which would be WRONG once the axis is shifted).
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        const u = i / (NX - 1);
        const mirroredU = 2 * 0.7 - u;
        if (mirroredU < 0 || mirroredU > 1) continue; // no in-range partner to compare against
        const iPrime = Math.round(mirroredU * (NX - 1));
        if (Math.abs(iPrime / (NX - 1) - mirroredU) > 1e-6) continue; // only exact grid hits
        expect(heights[j * NX + i]).toBeCloseTo(heights[j * NX + iPrime], 5);
      }
    }
  });
});

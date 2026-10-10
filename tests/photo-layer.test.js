/**
 * 2026-10-10 (Fred: the photo as its own LAYER on top of the chosen filter, "how much of the filter transpires"):
 * core/terrain.js photoLayer / photoFilterAmount, the migration of a save on the old Photo FILTER
 * (main/app-init.js MIGRATIONS 'photo-filter-to-layer'), each filter's declared nominalRange, and the filter dropdown.
 * LEGACY: a migrated photo board must give the SAME heights, bit for bit, as the old Photo filter did -- the goldens
 * below are tests/heightmap-golden.test.js's own photo hashes, measured on the code before the photo filter changed.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { generateHeightmap } from '../bspline-frame-builder/b-spline-gen/html/core/terrain.js';
import { NoiseModes, NoiseMetadata, populateNoiseDropdown } from '../bspline-frame-builder/b-spline-gen/html/core/noise/index.js';
import { PerlinNoise } from '../bspline-frame-builder/b-spline-gen/html/core/noise.js';
import { ensurePhotoDecoded, _resetPhotoStateForTests } from '../bspline-frame-builder/b-spline-gen/html/core/photo/state.js';
import { DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { MIGRATIONS } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';
import { HEIGHTS_INERT_KEYS, REBUILD_INERT_KEYS } from '../bspline-frame-builder/b-spline-gen/html/core/engine/rebuild.js';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/photo/codec.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, decodeImageToGrey: vi.fn(async (url) => globalThis.__fakeDecoded[url]) };
});

// the SAME board and fake photo as tests/heightmap-golden.test.js
const BASE = {
  widthIn: 7, heightIn: 9, carveZ: 1.5, seed: 42, scale: 3.7, macroScale: 0.65, mapZoom: 1, seedOffsetX: 0.03, seedOffsetY: -0.02,
  octaves: 4, roughness: 0.5, edgeMargin: 0.2, symOffsetX: 0, symOffsetY: 0, warpIntensity: 1.0, symmetry: 'none', nx: 48, nz: 62,
};
const PHOTO = 'data:golden';
const sha = (a) => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex').slice(0, 16);
const LEGACY = [
  ['photo, plain', { ...BASE, noiseType: 'photo', photoImageDataUrl: PHOTO, photoEdits: [] }, '07e7b7bbd7af461c'],
  ['photo, symmetry x', { ...BASE, noiseType: 'photo', symmetry: 'x', photoImageDataUrl: PHOTO, photoEdits: [] }, '3f3cf45a58f2d878'],
  ['photo, tweaks (rotation, scale, offsets, depth)', { ...BASE, noiseType: 'photo', photoImageDataUrl: PHOTO, photoEdits: [],
    filterTweaks: { photo: { rotation: 33, scale: 1.7, offsetX: 0.12, offsetY: -0.08, depth: 1.4, repeat: 0 } } }, 'abdac66e23aee261'],
  ['photo, repeat on', { ...BASE, noiseType: 'photo', photoImageDataUrl: PHOTO, photoEdits: [],
    filterTweaks: { photo: { rotation: -20, scale: 0.6, repeat: 1 } } }, 'ecb0b8bb8d941a2e'],
];
const migrate = (p) => {
  const q = JSON.parse(JSON.stringify(p));
  for (const m of MIGRATIONS) if (m.when(q)) m.apply(q);
  return q;
};

beforeAll(async () => {
  _resetPhotoStateForTests();
  const w = 37, h = 29;
  globalThis.__fakeDecoded = { [PHOTO]: { data: Float32Array.from({ length: w * h }, (_, k) => ((k * 7919) % 101) / 100), w, h } };
  await ensurePhotoDecoded(PHOTO);
});

describe('a save on the old Photo FILTER loads as the photo layer, the SAME heights', () => {
  for (const [name, legacy, golden] of LEGACY) {
    it(name, () => {
      const p = migrate(legacy);
      expect([p.noiseType, p.photoLayer, p.photoFilterAmount]).toEqual(['simplex', true, 0]);
      expect(p.filterTweaks).toEqual(legacy.filterTweaks); // the photo's own settings stay where they were
      expect(sha(generateHeightmap(p).heights)).toBe(golden);
    });
  }
  it('a save that hid the filter texture showed no photo: its layer stays off, the same flat-texture heights', () => {
    const legacy = { ...LEGACY[0][1], isolateSkeleton: true };
    const p = migrate(legacy);
    expect([p.noiseType, p.photoLayer]).toEqual(['simplex', false]);
    expect(sha(generateHeightmap(p).heights)).toBe(sha(generateHeightmap(legacy).heights));
  });
  it('runs once: a migrated board (or any board on a real filter) is not touched again', () => {
    const p = migrate(LEGACY[0][1]);
    expect(migrate(p)).toEqual(p);
  });
  it('absent fields on an older save read as the layer off, 0 % (the declared defaults)', () => {
    expect([DEFAULT.photoLayer, DEFAULT.photoFilterAmount]).toEqual([false, 0]);
    const { photoLayer, photoFilterAmount, ...older } = { ...BASE, noiseType: 'mars' };
    expect(sha(generateHeightmap(older).heights)).toBe(sha(generateHeightmap({ ...older, photoLayer: false, photoFilterAmount: 0 }).heights));
  });
});

describe('the photo layer over a filter', () => {
  const onMars = (extra) => ({ ...BASE, noiseType: 'mars', photoImageDataUrl: PHOTO, photoEdits: [], photoLayer: true, ...extra });
  it('at 0 % the filter is not even sampled -- the photo alone, whatever the filter', () => {
    const real = NoiseModes.mars;
    const spy = vi.fn(real);
    NoiseModes.mars = spy;
    try {
      const h0 = sha(generateHeightmap(onMars({ photoFilterAmount: 0 })).heights);
      expect(spy).not.toHaveBeenCalled();
      generateHeightmap(onMars({ photoFilterAmount: 50 }));
      expect(spy).toHaveBeenCalled();
      // the photo alone over a filter with the same coarse multiplier gives the same heights (eroded: 2.5, like simplex)
      expect(sha(generateHeightmap({ ...onMars({ photoFilterAmount: 0 }), noiseType: 'eroded' }).heights))
        .toBe(sha(generateHeightmap({ ...onMars({ photoFilterAmount: 0 }), noiseType: 'simplex' }).heights));
      expect(h0).not.toBe(sha(generateHeightmap(onMars({ photoFilterAmount: 50 })).heights));
    } finally { NoiseModes.mars = real; }
  });
  it('"Filter shows through" adds the filter, normalised by its declared span, times the share', () => {
    // one sample: nx = nz = 2 keeps the arithmetic visible; no edge fade / detail mask / smoothing in the way
    const p = (amt) => ({ ...onMars({ photoFilterAmount: amt }), edgeMargin: 0, nx: 2, nz: 2 });
    const [h0, h100] = [generateHeightmap(p(0)).heights, generateHeightmap(p(100)).heights];
    const h50 = generateHeightmap(p(50)).heights;
    // fine enters h linearly (lerp(fine*LOW, PEAK_BASE + fine*PEAK_RNG, coarse)): 50 % lands halfway
    for (let i = 0; i < 4; i++) expect(h50[i]).toBeCloseTo((h0[i] + h100[i]) / 2, 5);
    expect([...h100].some((v, i) => Math.abs(v - h0[i]) > 1e-4)).toBe(true);
  });
  it('a share beyond 0..100 % is held to it (the slider\'s own range)', () => {
    expect(sha(generateHeightmap(onMars({ photoFilterAmount: 250 })).heights)).toBe(sha(generateHeightmap(onMars({ photoFilterAmount: 100 })).heights));
  });
  it('"Hide filter texture" hides the filter only: the photo stays, no filter share', () => {
    expect(sha(generateHeightmap(onMars({ photoFilterAmount: 60, isolateSkeleton: true })).heights))
      .toBe(sha(generateHeightmap(onMars({ photoFilterAmount: 0, isolateSkeleton: true })).heights));
  });
  it('the layer off: the plain filter, exactly', () => {
    expect(sha(generateHeightmap(onMars({ photoLayer: false, photoFilterAmount: 80 })).heights))
      .toBe(sha(generateHeightmap({ ...BASE, noiseType: 'mars' }).heights));
  });
  it('the layer keys are heights inputs (never inert): a change rebuilds', () => {
    for (const k of ['photoLayer', 'photoFilterAmount']) { expect(HEIGHTS_INERT_KEYS.has(k), k).toBe(false); expect(REBUILD_INERT_KEYS.has(k), k).toBe(false); }
  });
});

describe('each filter declares its output span (nominalRange)', () => {
  const filters = Object.keys(NoiseModes).filter((id) => id !== 'photo');
  it('every filter has one, low < high', () => {
    for (const id of filters) {
      const r = NoiseMetadata[id].nominalRange;
      expect(Array.isArray(r) && r.length === 2 && r[0] < r[1], id).toBe(true);
    }
  });
  it('it still matches the filter: the middle 98 % of its output (2 seeds) lies within the span (15 % slack) and fills at least half of it', () => {
    for (const id of filters) {
      const vals = [];
      for (const seed of [3, 77]) {
        const refs = { noiseFine: new PerlinNoise(seed), noiseWarp: new PerlinNoise(seed ^ 0x9e3779b9), noiseCoarse: new PerlinNoise(seed ^ 0x5f3759df), rawU: 0, rawV: 0 };
        const params = { ...DEFAULT, seed, tweaks: {} };
        for (let j = 0; j < 40; j++) for (let i = 0; i < 40; i++) { refs.rawU = i / 39; refs.rawV = j / 39; vals.push(NoiseModes[id](i / 39, j / 39, 7 / 9, params, refs)); }
      }
      vals.sort((a, b) => a - b);
      const [lo, hi] = NoiseMetadata[id].nominalRange, slack = (hi - lo) * 0.15;
      expect(vals[Math.floor(vals.length * 0.01)], `${id} 1st percentile`).toBeGreaterThan(lo - slack);
      expect(vals[Math.floor(vals.length * 0.99)], `${id} 99th percentile`).toBeLessThan(hi + slack);
      // ...and the span is not loose: a too-wide span would quietly shrink what "Filter shows through" adds
      expect(vals[Math.floor(vals.length * 0.99)] - vals[Math.floor(vals.length * 0.01)], `${id} fills its span`).toBeGreaterThan((hi - lo) * 0.5);
    }
  });
});

describe('the filter dropdown', () => {
  it('no longer offers Photo (a layer now); every other filter is there', () => {
    const sel = document.createElement('select');
    populateNoiseDropdown(sel, 'simplex');
    const ids = [...sel.options].map((o) => o.value);
    expect(ids).not.toContain('photo');
    expect(ids.sort()).toEqual(Object.keys(NoiseModes).filter((id) => id !== 'photo').sort());
  });
});

/**
 * 2026-10-10 (seat A): which way up the photo lands on the board. The heightmap's row 0 is the board's FRONT
 * (core/coords.js COORD_SYSTEM: the bottom of the drawing -- art drawn at the top of the editor lands on the high rows,
 * MEASURED live). The marker: an image with a white block in its TOP-LEFT, minus the same image without it, so only the
 * block remains in the height difference.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { generateHeightmap } from '../bspline-frame-builder/b-spline-gen/html/core/terrain.js';
import { photoPixelAt, photoSampleOf } from '../bspline-frame-builder/b-spline-gen/html/core/noise/photo.js';
import { ensurePhotoDecoded, getProcessedPhotoImage, _resetPhotoStateForTests } from '../bspline-frame-builder/b-spline-gen/html/core/photo/state.js';
import { COORD_SYSTEM } from '../bspline-frame-builder/b-spline-gen/html/core/coords.js';
import { DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { MIGRATIONS } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/photo/codec.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, decodeImageToGrey: vi.fn(async (url) => globalThis.__fakeDecoded[url]) };
});
const MARKER = 'data:marker', PLAIN = 'data:plain', GOLDEN = 'data:golden';
const sha = (a) => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex').slice(0, 16);
const migrate = (p) => { const q = JSON.parse(JSON.stringify(p)); for (const m of MIGRATIONS) if (m.when(q)) m.apply(q); return q; };
const BASE = {
  widthIn: 7, heightIn: 9, carveZ: 1.5, seed: 42, scale: 3.7, macroScale: 0.65, mapZoom: 1, seedOffsetX: 0.03, seedOffsetY: -0.02,
  octaves: 4, roughness: 0.5, edgeMargin: 0.2, symOffsetX: 0, symOffsetY: 0, warpIntensity: 1.0, symmetry: 'none', nx: 48, nz: 62,
};

beforeAll(async () => {
  _resetPhotoStateForTests();
  const w = 70, h = 90; // 7 x 9 like the board: cover-fit = the whole board
  const marker = Float32Array.from({ length: w * h }, (_, k) => (Math.floor(k / w) < 20 && k % w < 25 ? 1 : 0));
  const gw = 37, gh = 29;
  globalThis.__fakeDecoded = {
    [MARKER]: { data: marker, w, h }, [PLAIN]: { data: new Float32Array(w * h), w, h },
    [GOLDEN]: { data: Float32Array.from({ length: gw * gh }, (_, k) => ((k * 7919) % 101) / 100), w: gw, h: gh },
  };
  await ensurePhotoDecoded(MARKER); await ensurePhotoDecoded(PLAIN); await ensurePhotoDecoded(GOLDEN);
});

// the centroid of |marker - plain| as board fractions: i 0 = left .. 1 = right; j 0 = FRONT .. 1 = BACK (the drawing top)
async function where(orientation) {
  const p = (url) => ({ ...BASE, seedOffsetX: 0, seedOffsetY: 0, edgeMargin: 0, noiseType: 'simplex', photoLayer: true, photoImageDataUrl: url, photoEdits: [], photoOrientation: orientation });
  // the decoder holds one photo at a time (core/photo/state.js): decode each right before its heightmap
  await ensurePhotoDecoded(MARKER); const a = generateHeightmap(p(MARKER));
  await ensurePhotoDecoded(PLAIN); const b = generateHeightmap(p(PLAIN)); const { nx, nz } = a;
  let sw = 0, si = 0, sj = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const d = Math.abs(a.heights[j * nx + i] - b.heights[j * nx + i]); sw += d; si += d * i / (nx - 1); sj += d * j / (nz - 1); }
  return { i: si / sw, j: sj / sw };
}

describe('where the image top-left block lands on the board', () => {
  it('grid row 0 is the bottom of the drawing (core/coords.js)', () => {
    expect(COORD_SYSTEM.gridRowToRasterY(0, 10, 100)).toBe(99);
  });
  // MEASURED live (the real app, 2026-10-10): a carved art square drawn at the editor's top-right lands at j 0.87 (BACK)
  it("'upright': the image's top-left lands at the board's top-left (left, BACK) -- the same way up as the art", async () => {
    const r = await where('upright');
    expect(r.i).toBeLessThan(0.3); expect(r.j).toBeGreaterThan(0.7);
  });
  it("legacy ('legacy-flipped' / no key): the old flip, byte-identical -- the image's top-left at the FRONT-left", async () => {
    for (const o of ['legacy-flipped', undefined]) { const r = await where(o); expect(r.i).toBeLessThan(0.3); expect(r.j).toBeLessThan(0.3); }
  });
});

describe('the orientation a board gets (MIGRATIONS photo-orientation)', () => {
  it('undecided by default; a board with a photo keeps the old; any other gets the new; a set value stays', () => {
    expect(DEFAULT.photoOrientation).toBe(null);
    expect(migrate({ photoImageDataUrl: GOLDEN }).photoOrientation).toBe('legacy-flipped');
    expect(migrate({ noiseType: 'photo' }).photoOrientation).toBe('legacy-flipped');
    expect(migrate({ noiseType: 'mars' }).photoOrientation).toBe('upright');
    expect(migrate({ photoImageDataUrl: GOLDEN, photoOrientation: 'upright' }).photoOrientation).toBe('upright');
  });
  it('LEGACY: a board on the old Photo filter loads byte-identical (the pre-change golden)', async () => {
    await ensurePhotoDecoded(GOLDEN);
    const p = migrate({ ...BASE, noiseType: 'photo', photoImageDataUrl: GOLDEN, photoEdits: [] });
    expect([p.photoLayer, p.photoOrientation]).toEqual([true, 'legacy-flipped']);
    expect(sha(generateHeightmap(p).heights)).toBe('07e7b7bbd7af461c'); // tests/heightmap-golden.test.js "photo, plain"
  });
});

describe('photoSampleOf inverts photoPixelAt upright too', () => {
  it('within one pixel', async () => {
    await ensurePhotoDecoded(GOLDEN);
    const p = { photoImageDataUrl: GOLDEN, photoEdits: [], photoOrientation: 'upright', tweaks: { rotation: 33, scale: 1.7, offsetX: 0.12, offsetY: -0.08 } };
    const img = getProcessedPhotoImage(p);
    for (let k = 1; k < 60; k++) {
      const u = 0.05 + ((k * 0.618) % 0.9), v = 0.05 + ((k * 0.414) % 0.9);
      const { su, sv } = photoSampleOf(u, v, 7 / 9, p, img);
      const i = photoPixelAt(su, sv, 7 / 9, p, img);
      expect(Math.abs((i % img.w) - Math.floor(u * img.w))).toBeLessThanOrEqual(1);
      expect(Math.abs(Math.floor(i / img.w) - Math.floor(v * img.h))).toBeLessThanOrEqual(1);
    }
  });
});

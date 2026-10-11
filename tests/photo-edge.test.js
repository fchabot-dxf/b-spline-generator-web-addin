/**
 * 2026-10-10 (Fred, via the advisor): outside the photo's footprint the photo layer contributes nothing -- the plain filter
 * shows there -- with a short declared fade at the photo's edge (core/terrain.js PHOTO_EDGE_MODES 'fade', 0.1 in). Before,
 * the edge pixels were stretched outward into stripes ('clamp'); boards saved with a photo keep that, byte-identical
 * (MIGRATIONS 'photo-edge'). Repeat on tiles the photo in both modes.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { generateHeightmap, PHOTO_EDGE_MODES, photoEdgeFadeUnits } from '../bspline-frame-builder/b-spline-gen/html/core/terrain.js';
import { photoCoverAt } from '../bspline-frame-builder/b-spline-gen/html/core/noise/photo.js';
import { ensurePhotoDecoded, getProcessedPhotoImage, _resetPhotoStateForTests } from '../bspline-frame-builder/b-spline-gen/html/core/photo/state.js';
import { DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { MIGRATIONS } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/photo/codec.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, decodeImageToGrey: vi.fn(async (url) => globalThis.__fakeDecoded[url]) };
});
const PHOTO = 'data:golden';
const BASE = {
  widthIn: 7, heightIn: 9, carveZ: 1.5, seed: 42, scale: 3.7, macroScale: 0.65, mapZoom: 1, seedOffsetX: 0.03, seedOffsetY: -0.02,
  octaves: 4, roughness: 0.5, edgeMargin: 0.2, symOffsetX: 0, symOffsetY: 0, warpIntensity: 1.0, symmetry: 'none', nx: 48, nz: 62,
};
const sha = (a) => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex').slice(0, 16);
const migrate = (p) => { const q = JSON.parse(JSON.stringify(p)); for (const m of MIGRATIONS) if (m.when(q)) m.apply(q); return q; };

beforeAll(async () => {
  _resetPhotoStateForTests();
  const w = 37, h = 29;
  globalThis.__fakeDecoded = { [PHOTO]: { data: Float32Array.from({ length: w * h }, (_, k) => ((k * 7919) % 101) / 100), w, h } };
  await ensurePhotoDecoded(PHOTO);
});

describe('the edge mode a board gets (MIGRATIONS photo-edge)', () => {
  it('undecided by default; a board with a photo keeps the clamp; any other fades; a set mode stays', () => {
    expect(DEFAULT.photoEdge).toBe(null);
    expect(migrate({ photoImageDataUrl: PHOTO }).photoEdge).toBe('clamp');
    expect(migrate({ noiseType: 'photo' }).photoEdge).toBe('clamp');
    expect(migrate({ noiseType: 'mars' }).photoEdge).toBe('fade');
    expect(migrate({ photoImageDataUrl: PHOTO, photoEdge: 'fade' }).photoEdge).toBe('fade');
    expect(PHOTO_EDGE_MODES.fade.fadeIn).toBe(0.1);
  });
  it('LEGACY: old Photo-filter boards load byte-identical (the pre-change goldens)', () => {
    const plain = migrate({ ...BASE, noiseType: 'photo', photoImageDataUrl: PHOTO, photoEdits: [] });
    expect(plain.photoEdge).toBe('clamp');
    expect(sha(generateHeightmap(plain).heights)).toBe('07e7b7bbd7af461c'); // tests/heightmap-golden.test.js "photo, plain"
    const symX = migrate({ ...BASE, noiseType: 'photo', symmetry: 'x', photoImageDataUrl: PHOTO, photoEdits: [] });
    expect(sha(generateHeightmap(symX).heights)).toBe('3f3cf45a58f2d878'); // "photo, symmetry x"
  });
});

describe("'fade': outside the photo the plain filter; inside, the photo as before", () => {
  // a small photo in the middle of the board (scale 0.4): most of the board is outside it
  const board = (photoEdge, tweaks = {}) => ({ ...BASE, noiseType: 'simplex', photoLayer: true, photoImageDataUrl: PHOTO, photoEdits: [],
    photoOrientation: 'upright', photoMirrorMode: 'whole', photoEdge, filterTweaks: { photo: { scale: 0.4, ...tweaks } } });
  const off = () => generateHeightmap({ ...board('fade'), photoLayer: false }).heights;
  it('far outside the footprint the heights are the layer-off heights; deep inside, the clamp heights', () => {
    const fade = generateHeightmap(board('fade')), clamp = generateHeightmap(board('clamp')).heights, plain = off();
    const { nx, nz } = fade;
    let outside = 0, inside = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const u = i / (nx - 1), v = j / (nz - 1), k = j * nx + i;
      if (Math.abs(u - 0.5) > 0.4 || Math.abs(v - 0.5) > 0.4) { expect(fade.heights[k]).toBeCloseTo(plain[k], 9); outside++; }
      if (Math.abs(u - 0.5) < 0.05 && Math.abs(v - 0.5) < 0.05) { expect(fade.heights[k]).toBeCloseTo(clamp[k], 9); inside++; }
    }
    expect(outside).toBeGreaterThan(500); expect(inside).toBeGreaterThan(5);
    expect(sha(fade.heights)).not.toBe(sha(clamp)); // the stripes are gone
  });
  it('Repeat on: the photo tiles -- fade and clamp identical', () => {
    expect(sha(generateHeightmap(board('fade', { repeat: 1 })).heights)).toBe(sha(generateHeightmap(board('clamp', { repeat: 1 })).heights));
  });
  it('a photo covering the whole board (scale 1, no offset): nothing changes far from its edge', () => {
    const full = (e) => generateHeightmap({ ...board(e), filterTweaks: { photo: {} } });
    const a = full('fade'), b = full('clamp');
    const { nx, nz } = a;
    for (let j = 8; j < nz - 8; j++) for (let i = 8; i < nx - 8; i++) expect(a.heights[j * nx + i]).toBeCloseTo(b.heights[j * nx + i], 9);
  });
});

describe('photoCoverAt: the fade is 0.1 in just inside the photo edge', () => {
  it('1 inside, 0 outside, linear across the fade', () => {
    const p = { photoImageDataUrl: PHOTO, photoEdits: [], photoOrientation: 'upright', tweaks: {}, heightIn: 9, mapZoom: 1, symmetry: 'none', photoEdge: 'fade' };
    const img = getProcessedPhotoImage(p);
    const fade = photoEdgeFadeUnits(p);
    expect(fade).toBeCloseTo(0.1 / 9, 12);
    // a landscape 37 x 29 photo on a 7 x 9 board, cover: its height spans the board (sv 0..1 at its edges), its width overflows
    expect(photoCoverAt(0.5, 0.5, 7 / 9, p, img, fade)).toBe(1);
    expect(photoCoverAt(0.5, 1.2, 7 / 9, p, img, fade)).toBe(0);
    expect(photoCoverAt(0.5, 1 - 0.05 / 9, 7 / 9, p, img, fade)).toBeCloseTo(0.5, 6); // 0.05 in inside its top edge
    expect(photoCoverAt(0.5, 0.05 / 9, 7 / 9, p, img, fade)).toBeCloseTo(0.5, 6); // and its bottom one
    expect(photoCoverAt(0.5, 0.5, 7 / 9, p, img, 0)).toBe(1); // no fade declared: untouched
  });
  it('the 0.1 in is board inches whatever the sampling: Map Zoom, a y fold (x2 coordinates), the true mirror', () => {
    const at = (q) => photoEdgeFadeUnits({ heightIn: 9, mapZoom: 1, symmetry: 'none', photoEdge: 'fade', ...q });
    expect(at({ mapZoom: 2 })).toBeCloseTo(0.1 / 18, 12);
    expect(at({ symmetry: 'y', photoMirrorMode: 'whole' })).toBeCloseTo(0.1 / 4.5, 12); // the fold doubles the coordinates
    expect(at({ symmetry: 'y', photoMirrorMode: 'mirror' })).toBeCloseTo(0.1 / 9, 12); // the true mirror does not
    expect(at({ symmetry: 'x', photoMirrorMode: 'whole' })).toBeCloseTo(0.1 / 9, 12); // an x fold leaves the vertical unit
    expect(at({ photoEdge: 'clamp' })).toBe(0);
  });
});

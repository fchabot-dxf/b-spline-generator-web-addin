/**
 * 2026-10-10 (Fred: "the photo shouldn't be squeezed by default"): with Symmetry on, the photo layer samples the TRUE
 * mirror in its 'mirror' mode (core/terrain.js foldUV mu / mv: no x2, the far side reflected onto the source side); the
 * legacy 'squeeze' (the whole photo fitted into each half) stays for boards that had a photo before (MIGRATIONS
 * 'photo-mirror-mode'), byte-identical. Procedural filters are untouched in both modes.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { generateHeightmap, foldUV, unfoldUV } from '../bspline-frame-builder/b-spline-gen/html/core/terrain.js';
import { NoiseModes } from '../bspline-frame-builder/b-spline-gen/html/core/noise/index.js';
import { ensurePhotoDecoded, _resetPhotoStateForTests } from '../bspline-frame-builder/b-spline-gen/html/core/photo/state.js';
import { DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { MIGRATIONS } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/photo/codec.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, decodeImageToGrey: vi.fn(async (url) => globalThis.__fakeDecoded[url]) };
});
// the board and fake photo of tests/heightmap-golden.test.js
const BASE = {
  widthIn: 7, heightIn: 9, carveZ: 1.5, seed: 42, scale: 3.7, macroScale: 0.65, mapZoom: 1, seedOffsetX: 0.03, seedOffsetY: -0.02,
  octaves: 4, roughness: 0.5, edgeMargin: 0.2, symOffsetX: 0, symOffsetY: 0, warpIntensity: 1.0, symmetry: 'none', nx: 48, nz: 62,
};
const PHOTO = 'data:golden';
const sha = (a) => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex').slice(0, 16);
const migrate = (p) => { const q = JSON.parse(JSON.stringify(p)); for (const m of MIGRATIONS) if (m.when(q)) m.apply(q); return q; };

beforeAll(async () => {
  _resetPhotoStateForTests();
  const w = 37, h = 29;
  globalThis.__fakeDecoded = { [PHOTO]: { data: Float32Array.from({ length: w * h }, (_, k) => ((k * 7919) % 101) / 100), w, h } };
  await ensurePhotoDecoded(PHOTO);
});

describe('the mode a board gets (MIGRATIONS photo-mirror-mode)', () => {
  it('the declared default is undecided; a board with a photo keeps the squeeze; any other mirrors; a set mode stays', () => {
    expect(DEFAULT.photoMirrorMode).toBe(null);
    expect(migrate({ photoImageDataUrl: PHOTO }).photoMirrorMode).toBe('squeeze');
    expect(migrate({ noiseType: 'photo' }).photoMirrorMode).toBe('squeeze'); // the old Photo filter
    expect(migrate({ noiseType: 'mars' }).photoMirrorMode).toBe('whole'); // a fresh / photo-less board (Fred's second pick)
    expect(migrate({ photoImageDataUrl: PHOTO, photoMirrorMode: 'mirror' }).photoMirrorMode).toBe('mirror');
  });
  it('LEGACY: a symmetric board on the old Photo filter loads byte-identical (the pre-change golden)', () => {
    const p = migrate({ ...BASE, noiseType: 'photo', symmetry: 'x', photoImageDataUrl: PHOTO, photoEdits: [] });
    expect([p.photoLayer, p.photoMirrorMode]).toEqual([true, 'squeeze']);
    expect(sha(generateHeightmap(p).heights)).toBe('3f3cf45a58f2d878'); // tests/heightmap-golden.test.js "photo, symmetry x"
  });
});

describe('what the photo samples', () => {
  const seen = (params) => {
    const real = NoiseModes.photo, got = [];
    NoiseModes.photo = (su, sv, ...rest) => { got.push([su, sv]); return real(su, sv, ...rest); };
    try { generateHeightmap(params); } finally { NoiseModes.photo = real; }
    return got;
  };
  const board = (mode) => ({ ...BASE, seedOffsetX: 0, seedOffsetY: 0, noiseType: 'simplex', symmetry: 'x', photoLayer: true, photoImageDataUrl: PHOTO, photoEdits: [], photoMirrorMode: mode, nx: 21, nz: 5 });
  it("'mirror': unsqueezed -- the source half samples its own board position, the far half its reflection", () => {
    const got = seen(board('mirror'));
    for (let i = 0; i < 21; i++) {
      const u = i / 20, [su] = got[i];
      expect(su).toBeCloseTo(u >= 0.5 ? u : 1 - u, 12);
    }
  });
  it("'squeeze' (legacy): the whole photo in each half -- twice the distance from the axis", () => {
    const got = seen(board('squeeze'));
    for (let i = 0; i < 21; i++) expect(got[i][0]).toBeCloseTo(Math.abs(i / 20 - 0.5) * 2, 12);
  });
  it('the procedural filter is untouched by the mode (the layer off: identical heights either way)', () => {
    const off = (mode) => sha(generateHeightmap({ ...board(mode), photoLayer: false }).heights);
    expect(off('mirror')).toBe(off('squeeze'));
  });
  it('no Symmetry: the mode changes nothing', () => {
    const h = (mode) => sha(generateHeightmap({ ...board(mode), symmetry: 'none' }).heights);
    expect(h('mirror')).toBe(h('squeeze'));
  });
});

describe('unfoldUV in mirror mode inverts foldUV mu / mv, every copy', () => {
  it('round trip', () => {
    for (const c of [{ symmetry: 'x', symOffsetX: 0.1 }, { symmetry: 'radial', mapZoom: 1.3, seedOffsetY: 0.05 }]) {
      for (let k = 0; k < 100; k++) {
        const u = (k * 0.618) % 1, v = (k * 0.414) % 1, f = foldUV(u, v, c);
        const sx = f.zu >= 0.5 + (c.symOffsetX || 0) ? 1 : -1, sy = f.zv >= 0.5 + (c.symOffsetY || 0) ? 1 : -1;
        const b = unfoldUV(f.mu, f.mv, c, sx, sy, true);
        expect(b.u).toBeCloseTo(u, 9); expect(b.v).toBeCloseTo(v, 9);
      }
    }
  });
});

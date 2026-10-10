/**
 * core/photo/mirror-dim.js photoUsedCells -- the Photo preview dims exactly the part of the photo the terrain never
 * samples (seat D 2026-10-10; Fred: "not sure if this is accurate, why is it dimmed in the middle"). GROUND TRUTH: the
 * REAL terrain generator (generateHeightmap, the photo as a layer) reads a photo whose pixel array records every index;
 * the overlay must leave every read pixel bright and dim (almost) everything never read. The old fixed half / quadrant
 * (computeMirrorDimRects) was wrong in every case -- its pins are replaced, not kept.
 */
import { describe, it, expect, vi } from 'vitest';

const W = 80, H = 60;
const read = new Uint8Array(W * H);
const data = new Proxy(new Float32Array(W * H).fill(0.5), { get(t, k) { if (typeof k === 'string' && /^\d+$/.test(k)) read[+k] = 1; return t[k]; } });
const IMG = { data, w: W, h: H };
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/photo/state.js', async (importOriginal) => ({ ...(await importOriginal()), getProcessedPhotoImage: () => IMG }));
const { generateHeightmap } = await import('../bspline-frame-builder/b-spline-gen/html/core/terrain.js');
const { photoUsedCells } = await import('../bspline-frame-builder/b-spline-gen/html/core/photo/mirror-dim.js');

const CW = 40, CH = 30; // the overlay's cells
function compare({ symmetry = 'none', symOffsetX = 0, symOffsetY = 0, widthIn = 7, heightIn = 9, tweaks = {} }) {
  read.fill(0);
  const params = { widthIn, heightIn, symmetry, symOffsetX, symOffsetY, nx: 300, nz: 300, photoLayer: true, photoFilterAmount: 0, filterTweaks: { photo: tweaks } };
  generateHeightmap(params); // the terrain's own sampling, recorded
  const truth = new Uint8Array(CW * CH);
  for (let k = 0; k < W * H; k++) if (read[k]) { const x = k % W, y = (k - x) / W; truth[Math.floor((y * CH) / H) * CW + Math.floor((x * CW) / W)] = 1; }
  const cells = photoUsedCells(IMG, { ...params, tweaks }, widthIn / heightIn, CW, CH);
  let falseDim = 0, falseDimInside = 0, extraBright = 0, used = 0;
  const at = (x, y) => x >= 0 && y >= 0 && x < CW && y < CH && cells[y * CW + x];
  for (let i = 0; i < CW * CH; i++) {
    used += truth[i];
    if (!truth[i] && cells[i]) extraBright++;
    if (truth[i] && !cells[i]) {
      falseDim++;
      const x = i % CW, y = (i - x) / CW;
      // a miss is only allowed on the used region's EDGE (a sliver the terrain's denser grid catches at a corner)
      if (![[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]].some(([dx, dy]) => at(x + dx, y + dy))) falseDimInside++;
    }
  }
  return { falseDim, falseDimInside, extraBright, usedFrac: used / (CW * CH), cells };
}
const CASES = {
  'no symmetry (cover-fit crops the sides)': {},
  'symmetry X': { symmetry: 'x' },
  'symmetry Y': { symmetry: 'y' },
  'radial': { symmetry: 'radial' },
  'X, axis +0.15': { symmetry: 'x', symOffsetX: 0.15 },
  'X, scale 1.5': { symmetry: 'x', tweaks: { scale: 1.5 } },
  'X, offset 0.2 / 0.1': { symmetry: 'x', tweaks: { offsetX: 0.2, offsetY: 0.1 } },
  'X, rotation 30': { symmetry: 'x', tweaks: { rotation: 30 } },
  'scale 0.5 + repeat': { tweaks: { scale: 0.5, repeat: 1 } },
  'landscape 9 x 7': { widthIn: 9, heightIn: 7 },
};

describe('photoUsedCells: dims exactly what the terrain never samples (vs the real generator)', () => {
  for (const [name, c] of Object.entries(CASES)) {
    it(name, () => {
      const r = compare(c);
      // a cell the terrain reads is never dimmed -- except, under a rotation, a few corner slivers on the region's edge
      expect(r.falseDimInside, 'a read cell away from the edge is never dimmed').toBe(0);
      expect(r.falseDim, 'edge slivers only, a handful').toBeLessThanOrEqual(c.tweaks?.rotation ? 8 : 0);
      expect(r.extraBright, 'a cell left bright that the terrain never reads (edges of the used region only)').toBeLessThanOrEqual(Math.ceil(0.03 * CW * CH));
    });
  }
  it('the old errors are gone: under symmetry X the LEFT half is used (the fold squeezes the whole photo into each half)', () => {
    const { cells } = compare({ symmetry: 'x' });
    let leftUsed = 0; for (let y = 0; y < CH; y++) for (let x = 0; x < CW / 2; x++) leftUsed += cells[y * CW + x];
    expect(leftUsed).toBeGreaterThan(0.25 * (CW / 2) * CH);
  });
  it('the cover-fit: a 4:3 photo on a 7:9 board leaves its sides unused even with no symmetry', () => {
    const { usedFrac } = compare({});
    expect(usedFrac).toBeGreaterThan(0.5); expect(usedFrac).toBeLessThan(0.7);
  });
});

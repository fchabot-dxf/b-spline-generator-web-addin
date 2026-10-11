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
const { photoUsedCells, photoAxisLines } = await import('../bspline-frame-builder/b-spline-gen/html/core/photo/mirror-dim.js');

const CW = 40, CH = 30; // the overlay's cells
function compare({ symmetry = 'none', symOffsetX = 0, symOffsetY = 0, widthIn = 7, heightIn = 9, tweaks = {}, photoMirrorMode = 'squeeze' }) {
  read.fill(0);
  const params = { widthIn, heightIn, symmetry, symOffsetX, symOffsetY, nx: 300, nz: 300, photoLayer: true, photoFilterAmount: 0, filterTweaks: { photo: tweaks }, photoMirrorMode };
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
  // a new board's photo (seat A / Fred): a TRUE mirror under Symmetry, no squeeze
  'mirror mode, X': { symmetry: 'x', photoMirrorMode: 'mirror' },
  'mirror mode, radial': { symmetry: 'radial', photoMirrorMode: 'mirror' },
  'mirror mode, X, axis +0.15': { symmetry: 'x', symOffsetX: 0.15, photoMirrorMode: 'mirror' },
  'mirror mode, X, rotation 30': { symmetry: 'x', photoMirrorMode: 'mirror', tweaks: { rotation: 30 } },
  // 'whole' (seat A / Fred): the whole photo, unsqueezed, on the source half -- sampled at the half's own aspect
  // (terrain.js photoSampleAspect)
  'whole mode, X': { symmetry: 'x', photoMirrorMode: 'whole' },
  'whole mode, Y': { symmetry: 'y', photoMirrorMode: 'whole' },
  'whole mode, radial': { symmetry: 'radial', photoMirrorMode: 'whole' },
  'whole mode, X, axis +0.15': { symmetry: 'x', symOffsetX: 0.15, photoMirrorMode: 'whole' },
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
  it('the old errors are gone: under symmetry X the LEFT half is used (squeeze mode: the fold squeezes the whole photo into each half)', () => {
    const { cells } = compare({ symmetry: 'x' });
    let leftUsed = 0; for (let y = 0; y < CH; y++) for (let x = 0; x < CW / 2; x++) leftUsed += cells[y * CW + x];
    expect(leftUsed).toBeGreaterThan(0.25 * (CW / 2) * CH);
  });
  it('the cover-fit: a 4:3 photo on a 7:9 board leaves its sides unused even with no symmetry', () => {
    const { usedFrac } = compare({});
    expect(usedFrac).toBeGreaterThan(0.5); expect(usedFrac).toBeLessThan(0.7);
  });
});

describe('mirror mode (a new board): only the source side of the axis is sampled', () => {
  it('symmetry X, mirror: the photo LEFT of the axis is not on the board (the mirror reflects the right side)', () => {
    const { cells } = compare({ symmetry: 'x', photoMirrorMode: 'mirror' });
    let left = 0, right = 0; for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) { if (x < CW / 2 - 1) left += cells[y * CW + x]; if (x > CW / 2) right += cells[y * CW + x]; }
    expect(left).toBe(0);
    expect(right).toBeGreaterThan(0);
  });
});

describe('photoAxisLines: the mirror axis on the preview, from the same mapping', () => {
  const base = { widthIn: 7, heightIn: 9, photoLayer: true, filterTweaks: { photo: {} }, tweaks: {} };
  const xs = (lines) => lines[0].pts.map(([x]) => x / W);
  it('mirror mode, X: the axis samples the photo where the board axis lands -- mid-photo for a centred photo', () => {
    const lines = photoAxisLines(IMG, { ...base, symmetry: 'x', photoMirrorMode: 'mirror' }, 7 / 9);
    expect(lines.map((l) => l.axis)).toEqual(['x']);
    for (const x of xs(lines)) expect(x).toBeCloseTo(0.5, 1);
  });
  it('squeeze mode, X: the axis samples su = 0 -- the used region\'s left edge (the cover-fit\'s 0.2)', () => {
    for (const x of xs(photoAxisLines(IMG, { ...base, symmetry: 'x', photoMirrorMode: 'squeeze' }, 7 / 9))) expect(x).toBeCloseTo(0.2, 1);
  });
  it('radial: two lines; no symmetry: none', () => {
    expect(photoAxisLines(IMG, { ...base, symmetry: 'radial', photoMirrorMode: 'mirror' }, 7 / 9).map((l) => l.axis)).toEqual(['x', 'y']);
    expect(photoAxisLines(IMG, { ...base, symmetry: 'none' }, 7 / 9)).toEqual([]);
  });
});

// Seat D's live shots (claude_18, a squeeze -> mirror -> whole switch): the preview's cell cache keyed on a hand-listed
// set of params that lacked photoMirrorMode, so the mirror / whole views reused squeeze's cells -- nothing dimmed.
// main/photo-panel.js USED_CELLS_INPUTS declares what the cells depend on; the cache key is built from it.
describe('the preview cell cache follows every sampler input', () => {
  it('squeeze then mirror on the same image: the mirror cells, not the cached squeeze ones', async () => {
    const { usedCellsFor } = await import('../bspline-frame-builder/b-spline-gen/html/main/photo-panel.js');
    const base = { symmetry: 'x', widthIn: 6, heightIn: 8, tweaks: { scale: 1 } };
    const sum = (c) => c.reduce((s, v) => s + v, 0);
    const squeeze = sum(usedCellsFor(IMG, { ...base, photoMirrorMode: 'squeeze' }, 0.75, 40, 30));
    const mirror = sum(usedCellsFor(IMG, { ...base, photoMirrorMode: 'mirror' }, 0.75, 40, 30));
    expect(mirror).toBe(sum(photoUsedCells(IMG, { ...base, photoMirrorMode: 'mirror' }, 0.75, 40, 30)));
    expect(mirror).not.toBe(squeeze); // the two modes really differ here (non-vacuous)
  });

  it('declared: the key lists the mirror mode and the orientation the sampler reads', async () => {
    const { USED_CELLS_INPUTS } = await import('../bspline-frame-builder/b-spline-gen/html/main/photo-panel.js');
    expect(USED_CELLS_INPUTS.p).toEqual(expect.arrayContaining(['symmetry', 'photoMirrorMode', 'photoOrientation', 'mapZoom']));
  });
});

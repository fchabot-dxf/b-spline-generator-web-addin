/**
 * HEIGHT-PAINTER slice 1 (AGENTS.md rule 3): P.heightLayers, the list of height patches. ABSENT (or empty, or only disabled
 * patches) = OFF: a board without a height patch collects the same stamp passes and lays the same heights, byte for byte --
 * the SAME golden tests/stl-layers-absent.test.js measured before the STL work (8f6095ecfe52b833).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { _collectStampPasses, rebuildInputDigest, heightsInputDigest } from '../bspline-frame-builder/b-spline-gen/html/core/engine/rebuild.js';
import { applyStampLayers } from '../bspline-frame-builder/b-spline-gen/html/core/engine/apply-stamp-layers.js';
import { DEFAULT, P, persistableP } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { encodeRaster } from '../bspline-frame-builder/b-spline-gen/html/core/height/raster.js';

const NX = 6, NZ = 5;
const sha = (a) => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex').slice(0, 16);
const grid = (f) => Float32Array.from({ length: NX * NZ }, (_, k) => f(k % NX, Math.floor(k / NX), k));
function editorLayer(id, depth, { bricks = false } = {}) { // the stl-layers-absent board, unchanged
  const body = grid((i, j) => (i >= 1 && i <= 3 && j >= 1 && j <= 3 ? 0.25 * (1 + ((i + j) % 3)) : 0));
  const fillet = grid((i, j) => (body[j * NX + i] === 0 && i >= 0 && i <= 4 && j >= 0 && j <= 4 ? 0.125 : 0));
  const layer = {
    id, name: `Layer ${id}`, visible: true, carve: true, depth, profile: 'ballnose', suppression: 0, smoothing: 0,
    edgeFilletRadius: 0.1, filletPower: 1,
    _mask: { body, fillet, isStamped: grid((i, j, k) => body[k] > 1e-6) },
  };
  if (bricks) { layer._brickMask = { body: grid((i, j) => (j === 4 ? 1 : 0)), fillet: null, isStamped: null }; layer._brickDepth = 0.125; }
  return layer;
}
const BOARD = () => ({ _layers: [editorLayer('a', 0.5), editorLayer('b', -0.25, { bricks: true })] });
const CLEAN = () => grid((i, j) => ((i * 7 + j * 3) % 11) / 10);
const OPTS = { stampDepth: 0, stampEdgeFilletRadius: 0 };

afterEach(() => { delete window.svgEditor; delete P.heightLayers; });

describe('GUARD: a board with no height patch is unchanged', () => {
  it('absent, [] and [a disabled patch] collect exactly the editor-only passes through the grid-aware call', async () => {
    window.svgEditor = BOARD();
    const view = (ps) => ps.map((p) => [p.id, p.kind, p.depth, p.mask]);
    const editorOnly = view(_collectStampPasses());
    const off = { v: 1, id: 'off', enabled: false, sizeIn: { w: 1, h: 1 }, raster: await encodeRaster(new Float32Array(4).fill(0.3), 2, 2) };
    for (const layers of [undefined, [], [off]]) {
      if (layers === undefined) delete P.heightLayers; else P.heightLayers = layers;
      expect(view(_collectStampPasses(NX, NZ)), JSON.stringify(layers && layers.length)).toEqual(editorOnly);
    }
  });
  it('the stamped heights keep the golden measured before the STL work, with P.heightLayers absent, [] or [a disabled patch]', async () => {
    window.svgEditor = BOARD();
    const off = { v: 1, id: 'off', enabled: false, raster: await encodeRaster(new Float32Array(4).fill(0.3), 2, 2) };
    for (const layers of [undefined, [], [off]]) {
      if (layers === undefined) delete P.heightLayers; else P.heightLayers = layers;
      expect(sha(applyStampLayers(CLEAN(), _collectStampPasses(NX, NZ), NX, NZ, OPTS))).toBe('8f6095ecfe52b833');
    }
  });
  it('the build digests follow a patch raster by its content hash: another raster rebuilds, a JSON copy of the same does not', async () => {
    const A = await encodeRaster(new Float32Array(4).fill(0.3), 2, 2), B = await encodeRaster(new Float32Array(4).fill(0.4), 2, 2);
    const rec = (raster) => [{ v: 1, id: 'hp', sizeIn: { w: 1, h: 1 }, raster }];
    P.heightLayers = rec(A);
    const a = [rebuildInputDigest(null, NX, NZ), heightsInputDigest(NX, NZ)];
    P.heightLayers = rec(JSON.parse(JSON.stringify(A)));
    expect([rebuildInputDigest(null, NX, NZ), heightsInputDigest(NX, NZ)]).toEqual(a);
    P.heightLayers = rec(B);
    const b = [rebuildInputDigest(null, NX, NZ), heightsInputDigest(NX, NZ)];
    expect(b[0]).not.toBe(a[0]);
    expect(b[1]).not.toBe(a[1]);
    // digested by its hash, never re-stringified (as the STL mesh): the text is not read on every slider tick
    P.heightLayers = rec({ ...A, data: A.data + 'AAAA' });
    expect([rebuildInputDigest(null, NX, NZ), heightsInputDigest(NX, NZ)]).toEqual(a);
  });
  it('persistableP keeps a height record whole (saved and loaded with the project, no save-path change)', () => {
    const rec = [{ v: 1, id: 'hp1', raster: { cols: 2, rows: 2, enc: 'f16-deflate-b64', data: 'AAAA', h: 'x' } }];
    expect(persistableP({ ...DEFAULT, heightLayers: rec }).heightLayers).toEqual(rec);
  });
});

describe('P.heightLayers is declared', () => {
  it('the declared default is an empty list (absent = off)', () => {
    expect(DEFAULT.heightLayers).toEqual([]);
  });
});

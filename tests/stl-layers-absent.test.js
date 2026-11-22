/**
 * STL-RELIEF (STL-RELIEF-DESIGN.md): P.stlLayers, the list of STL stamps. ABSENT (or empty) = OFF: a board without an STL
 * layer must collect the same stamp passes and lay the same heights, byte for byte (AGENTS.md rule 3).
 *
 * Two kinds of test:
 *  - GUARDS (the pin): measured on the code BEFORE the STL work; they pass now and must keep passing after it.
 *  - DECLARATION: P.stlLayers is declared (empty by default). This fails before the work.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { _collectStampPasses } from '../bspline-frame-builder/b-spline-gen/html/core/engine/rebuild.js';
import { applyStampLayers } from '../bspline-frame-builder/b-spline-gen/html/core/engine/apply-stamp-layers.js';
import { DEFAULT, P, persistableP } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

const NX = 6, NZ = 5;
const sha = (a) => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex').slice(0, 16);
const grid = (f) => Float32Array.from({ length: NX * NZ }, (_, k) => f(k % NX, Math.floor(k / NX), k));

/** A real-shaped editor layer: carved + visible, an art mask (body + fillet + isStamped) and, on one, a brick mask. */
function editorLayer(id, depth, { bricks = false } = {}) {
  const body = grid((i, j) => (i >= 1 && i <= 3 && j >= 1 && j <= 3 ? 0.25 * (1 + ((i + j) % 3)) : 0));
  const fillet = grid((i, j) => (body[j * NX + i] === 0 && i >= 0 && i <= 4 && j >= 0 && j <= 4 ? 0.125 : 0));
  const layer = {
    id, name: `Layer ${id}`, visible: true, carve: true, depth, profile: 'ballnose', suppression: 0, smoothing: 0,
    edgeFilletRadius: 0.1, filletPower: 1,
    _mask: { body, fillet, isStamped: grid((i, j, k) => body[k] > 1e-6) },
  };
  if (bricks) {
    layer._brickMask = { body: grid((i, j) => (j === 4 ? 1 : 0)), fillet: null, isStamped: null };
    layer._brickDepth = 0.125;
  }
  return layer;
}
const BOARD = () => ({ _layers: [editorLayer('a', 0.5), editorLayer('b', -0.25, { bricks: true })] });
const CLEAN = () => grid((i, j) => ((i * 7 + j * 3) % 11) / 10);

afterEach(() => { delete window.svgEditor; delete P.stlLayers; });

describe('GUARD: a board with no STL layer is unchanged', () => {
  it('collects exactly the editor layers\' passes (art, then bricks), in order', () => {
    window.svgEditor = BOARD();
    expect(_collectStampPasses().map((p) => [p.id, p.kind, p.depth])).toEqual([
      ['a', 'art', 0.5], ['b', 'art', -0.25], ['b#bricks', 'bricks', 0.125],
    ]);
  });
  it('an empty P.stlLayers collects the same passes as an absent one', () => {
    window.svgEditor = BOARD();
    const absent = _collectStampPasses().map((p) => p.id);
    P.stlLayers = [];
    expect(_collectStampPasses().map((p) => p.id)).toEqual(absent);
  });
  it('through the GRID-AWARE call (the one buildHeights makes, the STL gate reached): absent, [] and [a disabled STL] collect exactly the editor-only passes', () => {
    window.svgEditor = BOARD();
    const editorOnly = _collectStampPasses();
    const view = (ps) => ps.map((p) => [p.id, p.kind, p.depth, p.mask]);
    delete P.stlLayers;
    expect(view(_collectStampPasses(NX, NZ))).toEqual(view(editorOnly));
    P.stlLayers = [];
    expect(view(_collectStampPasses(NX, NZ))).toEqual(view(editorOnly));
    // a disabled record in the real shape: it reaches stlPasses (the grid is given) and contributes nothing
    P.stlLayers = [{ v: 1, id: 'off', enabled: false, mesh: { v: 1, nv: 3, nt: 1, min: [0, 0, 0], size: [1, 1, 0], idxBits: 16, pos: 'AAAAAAAA//8AAAAA//8AAA==', idx: 'AAABAAIA', h: 'x' } }];
    expect(view(_collectStampPasses(NX, NZ))).toEqual(view(editorOnly));
  });
  it('the stamped heights are byte-identical to the golden measured before the STL work', () => {
    window.svgEditor = BOARD();
    const heights = applyStampLayers(CLEAN(), _collectStampPasses(), NX, NZ, { stampDepth: 0, stampEdgeFilletRadius: 0 });
    expect(sha(heights)).toBe('8f6095ecfe52b833');
  });
  it('the golden holds through the grid-aware call too, with P.stlLayers absent, [] or [a disabled STL]', () => {
    window.svgEditor = BOARD();
    const opts = { stampDepth: 0, stampEdgeFilletRadius: 0 };
    for (const layers of [undefined, [], [{ v: 1, id: 'off', enabled: false, mesh: { v: 1 } }]]) {
      if (layers === undefined) delete P.stlLayers; else P.stlLayers = layers;
      const heights = applyStampLayers(CLEAN(), _collectStampPasses(NX, NZ), NX, NZ, opts);
      expect(sha(heights), JSON.stringify(layers)).toBe('8f6095ecfe52b833');
    }
  });
  it('persistableP already keeps an STL record, so it is saved and loaded with the project (no save-path change needed)', () => {
    const rec = [{ v: 1, id: 'stl1' }];
    expect(persistableP({ ...DEFAULT, stlLayers: rec }).stlLayers).toEqual(rec);
  });
});

describe('P.stlLayers is declared', () => {
  it('the declared default is an empty list (absent = off)', () => {
    expect(DEFAULT.stlLayers).toEqual([]);
  });
});

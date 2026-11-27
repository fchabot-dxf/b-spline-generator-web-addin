/**
 * LAYER STRENGTH (Fred 2026-11-27: "on the main sidebar where layers are stacked, if i open them can some show at least a
 * general strength override, 0-100%?"): core/stamp/strength.js + core/engine/apply-stamp-layers.js.
 * A HEIGHT scale: the layer's own height (art depth + fillet, the bricks' depth, the STL's height, a height patch's +/-1)
 * and its suppression are multiplied by it BEFORE the layer's rule runs; zOffset, the Level base and a Flat brick's plane
 * are never scaled. Absent / 1 = no arithmetic (bit-identical); stored only when not 100 %.
 * Real shapes: the pass objects rebuild.js / stlPass / heightPass build (mask { body, fillet, isStamped }, kind, blend, carve,
 * zOffset, surface + pivot, flatTop { brickOf, count }); the real rebuild on the real P for the saved-board pin.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { P, lastResult } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { applyStampLayers, flatBrickPlaneHeights } from '../bspline-frame-builder/b-spline-gen/html/core/engine/apply-stamp-layers.js';
import { rebuild, _forgetHeights, _collectStampPasses, heightsInputDigest } from '../bspline-frame-builder/b-spline-gen/html/core/engine/rebuild.js';
import { resolveGrid } from '../bspline-frame-builder/b-spline-gen/html/core/terrain.js';
import { createStlLayer, stlPass, _resetStlCachesForTests } from '../bspline-frame-builder/b-spline-gen/html/core/stl/layer.js';
import { heightPass } from '../bspline-frame-builder/b-spline-gen/html/core/height/layer.js';
import { encodeRaster } from '../bspline-frame-builder/b-spline-gen/html/core/height/raster.js';
import { ensurePatchDecoded } from '../bspline-frame-builder/b-spline-gen/html/core/height/compose.js';
import { fitPlane } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/plane-fit.js';
import { LAYER_TOOLING_FIELDS, restoreLayerTooling } from '../bspline-frame-builder/b-spline-gen/html/core/history.js';

const NX = 24, NZ = 20, N = NX * NZ;
const grid = (f) => Float32Array.from({ length: N }, (_, k) => f(k % NX, Math.floor(k / NX), k));
const CLEAN = () => grid((i, j) => 0.4 + 0.02 * i - 0.015 * j + 0.05 * Math.sin(i * 0.7 + j * 0.3));
/** a soft blob: 1 in the middle, a rim falling to 0 */
const blob = (ci, cj, r) => grid((i, j) => { const d = Math.hypot(i - ci, j - cj); return d <= r ? 1 - 0.4 * (d / r) : d <= r + 2 ? 0.6 * (1 - (d - r) / 2) : 0; });
const covered = (body) => Uint8Array.from(body, (v) => (v > 1e-6 ? 1 : 0));
const OPTS = { stampDepth: 0, stampEdgeFilletRadius: 0 };
const run = (passes, clean = CLEAN()) => applyStampLayers(clean, passes, NX, NZ, OPTS);
const bitSame = (a, b) => a.length === b.length && Array.prototype.every.call(a, (v, k) => Object.is(v, b[k]));

// the passes, as their builders shape them
const artPass = (extra = {}) => {
  const body = blob(8, 9, 4);
  const fillet = grid((i, j, k) => (body[k] === 0 && Math.hypot(i - 8, j - 9) < 8 ? 0.3 : 0));
  return { id: 'L1', kind: 'art', enabled: true, svg: '1', mask: { body, fillet, isStamped: covered(body), metrics: { effectiveFilletIn: 0.05 } },
    depth: 0.3, profile: 'flat', suppression: 0, smoothing: 0, edgeFilletRadius: 0.05, filletPower: 1, placement: 'withSurface', ...extra };
};
const recordPass = (kind, extra = {}) => {
  const body = blob(15, 10, 5);
  return { id: `${kind}:x`, kind, enabled: true, svg: '1', mask: { body, fillet: null, isStamped: covered(body) },
    depth: kind === 'height' ? 1 : 0.5, carve: false, blend: 'add', placement: 'withSurface', zOffset: 0, profile: 'flat',
    suppression: 0, smoothing: 0, edgeFilletRadius: 0, filletPower: 1, ...extra };
};
/** Flat bricks: four bricks (2 x 2 blocks of 10 x 8 points) with a one-point grout gap; body 1 on the brick, 0 in the grout. */
const flatBrickPass = (extra = {}) => {
  const brickOf = new Int32Array(N).fill(-1);
  const body = new Float32Array(N);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    if (i % 12 === 11 || j % 10 === 9) continue;
    brickOf[j * NX + i] = Math.floor(i / 12) + 2 * Math.floor(j / 10);
    body[j * NX + i] = 1;
  }
  return { id: 'W#bricks', kind: 'bricks', enabled: true, svg: '1', mask: { body, fillet: null, isStamped: covered(body), flatTop: { brickOf, count: 4 } },
    depth: 0.2, profile: 'flat', suppression: 0, smoothing: 0, edgeFilletRadius: 0, filletPower: 1, placement: 'withSurface', ...extra };
};

describe('strength halves the height of an Add stamp (art, STL Add, height patch Add)', () => {
  for (const [name, mk] of [
    ['art (with its fillet)', (s) => artPass(s)],
    ['art, carved', (s) => artPass({ depth: -0.3, ...s })],
    ['STL Add', (s) => recordPass('stl', s)],
    ['STL Add, carved', (s) => recordPass('stl', { carve: true, depth: -0.5, ...s })],
    ['height patch Add', (s) => recordPass('height', s)],
  ]) {
    it(`${name}: 50 % moves each point exactly half as far as 100 %; 0 % leaves the heights as they were`, () => {
      const clean = CLEAN();
      const full = run([mk({})]);
      const half = run([mk({ strength: 0.5 })]);
      const none = run([mk({ strength: 0 })]);
      let moved = 0;
      for (let k = 0; k < N; k++) {
        const d1 = full[k] - clean[k];
        if (Math.abs(d1) > 1e-4) moved++;
        expect(half[k] - clean[k]).toBeCloseTo(d1 / 2, 6);
        expect(none[k]).toBeCloseTo(clean[k], 7);
      }
      expect(moved).toBeGreaterThan(40); // the stamp really moves points
    });
  }
  it('art with suppression: 0 % leaves no smoothing trace either (its suppression is scaled too)', () => {
    const clean = CLEAN();
    const pass = (s) => artPass({ suppression: 0.6, smoothing: 2, ...s });
    expect(bitSame(run([pass({})]), clean)).toBe(false);
    const none = run([pass({ strength: 0 })]);
    for (let k = 0; k < N; k++) expect(none[k]).toBeCloseTo(clean[k], 7);
  });
});

describe('the rule of each kind still holds at 50 % (only the height is scaled)', () => {
  it('STL Max: lift = max(0, z + 0.5 * h) over its covered points (z is never scaled)', () => {
    const clean = CLEAN();
    const z = -0.12;
    const p = recordPass('stl', { blend: 'max', zOffset: z, strength: 0.5 });
    const out = run([p]);
    let lifted = 0, sunk = 0;
    for (let k = 0; k < N; k++) {
      const want = p.mask.isStamped[k] ? Math.max(0, z + 0.5 * p.mask.body[k] * 0.5) : 0;
      expect(out[k] - clean[k]).toBeCloseTo(want, 6);
      if (want > 0) lifted++; else if (p.mask.isStamped[k]) sunk++;
    }
    expect(lifted).toBeGreaterThan(10);
    expect(sunk).toBeGreaterThan(10); // the low rim stays under the surface (Max shows only what stands above)
  });
  it('STL Level: the object\'s top at the base + z + 0.5 * h (the base and z unscaled; still one rigid object)', () => {
    const clean = CLEAN();
    const z = 0.05;
    const p = recordPass('stl', { surface: 'level', pivot: [15, 10], zOffset: z, strength: 0.5 });
    const out = run([p]);
    const base = clean[10 * NX + 15]; // the pivot sits on a grid point: the bilinear base is that point
    for (let k = 0; k < N; k++) {
      if (!p.mask.isStamped[k]) { expect(out[k]).toBe(clean[k]); continue; }
      expect(out[k]).toBeCloseTo(base + z + p.mask.body[k] * 0.5 * 0.5, 6);
    }
  });
  it('Flat bricks: each top stays planar on the SAME fitted plane, its relief above the plane halved', () => {
    const clean = CLEAN();
    const p = flatBrickPass();
    const plane = flatBrickPlaneHeights(clean, p.mask.flatTop.brickOf, 4, NX);
    const full = run([p]);
    const half = run([flatBrickPass({ strength: 0.5 })]);
    for (let b = 0; b < 4; b++) {
      const ks = [];
      for (let k = 0; k < N; k++) if (p.mask.flatTop.brickOf[k] === b) ks.push(k);
      for (const k of ks) {
        expect(full[k] - plane[k]).toBeCloseTo(0.2, 6);
        expect(half[k] - plane[k]).toBeCloseTo(0.1, 6);
      }
      const fit = fitPlane(ks.map((k) => ({ x: k % NX, y: Math.floor(k / NX), z: half[k] })));
      for (const k of ks) expect(half[k]).toBeCloseTo(fit.eval(k % NX, Math.floor(k / NX)), 5); // a plane
    }
    for (let k = 0; k < N; k++) if (p.mask.flatTop.brickOf[k] < 0) expect(half[k]).toBe(clean[k]); // grout untouched
  });
  it('a carving under a Flat brick at 50 %: the brick plane is fitted without the art\'s REAL (scaled) change', () => {
    const clean = CLEAN();
    const both = (s) => run([artPass({ depth: -0.2, strength: s }), flatBrickPass()]);
    const plane = flatBrickPlaneHeights(clean, flatBrickPass().mask.flatTop.brickOf, 4, NX);
    const artOnly = run([artPass({ depth: -0.2, strength: 0.5 })]);
    const out = both(0.5);
    const artFull = run([artPass({ depth: -0.2 })]);
    for (let k = 0; k < N; k++) expect(artOnly[k] - clean[k]).toBeCloseTo((artFull[k] - clean[k]) / 2, 6); // the art's real change is halved
    for (let k = 0; k < N; k++) if (flatBrickPass().mask.flatTop.brickOf[k] >= 0) expect(out[k]).toBeCloseTo(plane[k] + 0.2 + (artOnly[k] - clean[k]), 6);
  });
});

describe('absent = 100 %: bit-identical, no arithmetic', () => {
  const ALL = (s) => [artPass(s), flatBrickPass(s), recordPass('stl', { blend: 'max', zOffset: -0.05, ...s }), recordPass('stl', s),
    recordPass('stl', { surface: 'level', pivot: [15, 10], ...s }), recordPass('height', s), recordPass('height', { carve: true, depth: -1, blend: 'max', ...s })];
  it('every kind: strength 1 and no strength give the same bits', () => {
    expect(bitSame(run(ALL({ strength: 1 })), run(ALL({})))).toBe(true);
  });
  it('pin (AGENTS.md rule 3): the passes without a strength stamp the heights measured on origin/main a40e88ee', () => {
    const fnv = (a) => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let h = 0x811c9dc5; for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
    expect(fnv(run(ALL({})))).toBe('b7770604');
  });
});

describe('each pass builder carries its layer\'s own stored strength (absent: no key)', () => {
  const KEYS = ['widthIn', 'heightIn', 'spacing', 'stlLayers', 'heightLayers'];
  const saved = {};
  beforeEach(() => { for (const k of KEYS) saved[k] = P[k]; _resetStlCachesForTests(); });
  afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete P[k]; else P[k] = saved[k]; } window.svgEditor = null; });
  const tri = (a, b, c) => [...a, ...b, ...c];
  const pyramid = () => { const A = [-5, -5, 0], B = [5, -5, 0], C = [5, 5, 0], D = [-5, 5, 0], T = [0, 0, 4]; return Float32Array.from([tri(A, B, T), tri(B, C, T), tri(C, D, T), tri(D, A, T), tri(A, C, B), tri(A, D, C)].flat()); };

  it('an editor layer\'s art (layer.strength) and its bricks (layer._brickPassFields, from P.brickSettings.strength)', () => {
    const body = blob(8, 9, 4);
    const layer = { id: 'a', name: 'A', visible: true, carve: true, depth: 0.2, profile: 'flat', suppression: 0, smoothing: 0, _mask: { body, fillet: null, isStamped: covered(body) },
      _brickMask: { body, fillet: null, isStamped: covered(body) }, _brickDepth: 0.1 };
    window.svgEditor = { _layers: [layer] };
    expect(_collectStampPasses().map((p) => 'strength' in p)).toEqual([false, false]);
    layer.strength = 0.4; layer._brickPassFields = { strength: 0.7 };
    expect(_collectStampPasses().map((p) => [p.kind, p.strength])).toEqual([['art', 0.4], ['bricks', 0.7]]);
  });
  it('an STL record (rec.strength) and a height patch record (rec.strength)', async () => {
    const grid = { nx: 15, nz: 19, widthIn: 7, heightIn: 9 };
    const { record } = createStlLayer({ soup: pyramid(), name: 'pyr', board: { widthIn: 7, heightIn: 9 } });
    expect('strength' in stlPass(record, grid)).toBe(false);
    expect(stlPass({ ...record, strength: 0.4 }, grid).strength).toBe(0.4);
    const hp = { v: 1, id: 'hp', sizeIn: { w: 3, h: 3 }, raster: await encodeRaster(new Float32Array(16).fill(0.2), 4, 4) };
    await ensurePatchDecoded(hp);
    expect(heightPass(hp, grid)).not.toBeNull();
    expect('strength' in heightPass(hp, grid)).toBe(false);
    expect(heightPass({ ...hp, strength: 0.4 }, grid).strength).toBe(0.4);
  });
  it('the heights digest: unchanged without a strength (the cache key of a saved board is as before); a strength rebuilds', () => {
    const body = blob(8, 9, 4);
    const layer = { id: 'a', visible: true, carve: true, depth: 0.2, _brickMask: { body }, _brickDepth: 0.1 };
    window.svgEditor = { _layers: [layer] };
    const a = heightsInputDigest(NX, NZ);
    layer._brickPassFields = { strength: 0.5 };
    expect(heightsInputDigest(NX, NZ)).not.toBe(a);
    delete layer._brickPassFields;
    layer.strength = 0.5;
    expect(heightsInputDigest(NX, NZ)).not.toBe(a);
  });
});

describe('a saved board without any strength builds as before (the real rebuild)', () => {
  const W = 5, H = 6, SP = 0.1;
  const KEYS = ['widthIn', 'heightIn', 'spacing', 'thickenEnabled', 'jobTimeline', 'stlLayers', 'heightLayers', 'brickSettings', 'layerOrder', 'terrainFit'];
  const saved = {};
  beforeEach(() => { for (const k of KEYS) saved[k] = P[k]; _resetStlCachesForTests(); });
  afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete P[k]; else P[k] = saved[k]; } window.svgEditor = null; _forgetHeights(); });
  const fnv = (a) => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let h = 0x811c9dc5; for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
  function disc(nx, nz, cx, cy, r) {
    return Float32Array.from({ length: nx * nz }, (_, k) => {
      const x = -W / 2 + (k % nx) * W / (nx - 1), y = -H / 2 + Math.floor(k / nx) * H / (nz - 1);
      const d = Math.hypot(x - cx, y - cy);
      return d <= r ? 1 : d <= r + 0.15 ? 1 - (d - r) / 0.15 : 0;
    });
  }
  it('art + bricks + an STL: the heights and back measured on origin/main a40e88ee', async () => {
    Object.assign(P, { widthIn: W, heightIn: H, spacing: SP, thickenEnabled: true, jobTimeline: null, heightLayers: [], layerOrder: null, terrainFit: 'legacy' });
    P.brickSettings = { ...(saved.brickSettings || {}) };
    const { nx, nz } = resolveGrid(W, H, SP);
    const tri = (a, b, c) => [...a, ...b, ...c];
    const A = [-5, -5, 0], B = [5, -5, 0], C = [5, 5, 0], D = [-5, 5, 0], T = [0, 0, 4];
    const soup = Float32Array.from([tri(A, B, T), tri(B, C, T), tri(C, D, T), tri(D, A, T), tri(A, C, B), tri(A, D, C)].flat());
    P.stlLayers = [{ ...createStlLayer({ soup, name: 'Pyr', board: { widthIn: W, heightIn: H } }).record, id: 'stlPin', position: { x: 0.8, y: -0.6, z: -0.05 } }];
    const art = { id: '0', name: 'Art', visible: true, carve: true, depth: 0.3, profile: 'flat', angle: 90, blur: 0, smoothing: 15, suppression: 0.15,
      edgeFilletRadius: 0, filletPower: 2.2, _mask: disc(nx, nz, 0.3, -0.2, 1.1) };
    const body = disc(nx, nz, -0.4, 0.5, 1.2);
    const wall = { id: '9', name: 'Wall', brickKind: 'wall', visible: true, carve: true, depth: 0.25, suppression: 0, smoothing: 0, filletPower: 2.2,
      _brickMask: { body, fillet: null, isStamped: Uint8Array.from(body, (v) => (v > 0 ? 1 : 0)) }, _brickDepth: 0.15 };
    window.svgEditor = { _layers: [art, wall] };
    _forgetHeights();
    await rebuild({ update() {}, setStlGhosts() {} }, () => {}, () => {});
    expect({ heights: fnv(lastResult.heights), back: fnv(lastResult.thickenData.offsetPts) }).toEqual({ heights: '1dd912fa', back: '7012da0a' });
  }, 60000);
});

describe('the field is saved and undone like the layer\'s other stamp settings', () => {
  it('in the undo tooling fields; a restore of a snapshot taken without it removes it again (absent = 100 %)', () => {
    expect(LAYER_TOOLING_FIELDS).toContain('strength');
    const layers = [{ id: 'a', depth: 0.25, strength: 0.4 }];
    restoreLayerTooling(layers, [{ id: 'a', depth: 0.25 }]);
    expect(layers[0]).not.toHaveProperty('strength');
    restoreLayerTooling(layers, [{ id: 'a', depth: 0.25, strength: 0.4 }]);
    expect(layers[0].strength).toBe(0.4);
  });
});

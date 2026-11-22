/**
 * STL-RELIEF engine fixes A1-A11 (the advisor's review of steps 1-4). Each block fails on the code before its fix, on real
 * meshes, the real record shape and the real app functions (applyStampLayers, _collectStampPasses, buildHeightField,
 * rebuild, the digests).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// A4: count the z-buffer renders (the real renderDepth runs; only the calls are counted)
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/stl/raster.js', async (importOriginal) => {
  const m = await importOriginal();
  return { ...m, renderDepth: vi.fn(m.renderDepth) };
});

import { parseStl } from '../bspline-frame-builder/b-spline-gen/html/core/stl/parse.js';
import { indexMesh, decimate, encodeMesh, decodeMesh, meshHealth, meshBounds, clusterMesh } from '../bspline-frame-builder/b-spline-gen/html/core/stl/mesh.js';
import { renderDepth } from '../bspline-frame-builder/b-spline-gen/html/core/stl/raster.js';
import {
  stlPass, stlPasses, normaliseStlLayer, createStlLayer, restoreAtDetail, stlHealth, getStlErrors, _resetStlCachesForTests,
} from '../bspline-frame-builder/b-spline-gen/html/core/stl/layer.js';
import { ghostGeometry, ghostSurface, updateStlGhosts, surfaceAt } from '../bspline-frame-builder/b-spline-gen/html/core/stl/ghost.js';
import { applyStampLayers } from '../bspline-frame-builder/b-spline-gen/html/core/engine/apply-stamp-layers.js';
import { _collectStampPasses, rebuildInputDigest, heightsInputDigest, rebuild, _forgetHeights } from '../bspline-frame-builder/b-spline-gen/html/core/engine/rebuild.js';
import { buildHeightField } from '../bspline-frame-builder/b-spline-gen/html/core/preview/terrain-mesh.js';
import { P, lastResult } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

// ── meshes ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const tri = (a, b, c) => [...a, ...b, ...c];
/** A closed square pyramid over [-5,5]^2 at z = 0 with its apex at (ax, ay, h): off-centre = asymmetric. */
function pyramid(ax = 0, ay = 0, h = 4) {
  const A = [-5, -5, 0], B = [5, -5, 0], C = [5, 5, 0], D = [-5, 5, 0], T = [ax, ay, h];
  return Float32Array.from([tri(A, B, T), tri(B, C, T), tri(C, D, T), tri(D, A, T), tri(A, C, B), tri(A, D, C)].flat());
}
/** A closed box w x d x h with its base at z = 0, centred on x / y. */
function box(w, d, h) {
  const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2;
  const p = (x, y, z) => [x, y, z];
  const q = (a, b, c, e) => [tri(a, b, c), tri(a, c, e)];
  const [a, b, c, e] = [p(x0, y0, 0), p(x1, y0, 0), p(x1, y1, 0), p(x0, y1, 0)];
  const [A, B, C, E] = [p(x0, y0, h), p(x1, y0, h), p(x1, y1, h), p(x0, y1, h)];
  return Float32Array.from([...q(a, e, c, b), ...q(A, B, C, E), ...q(a, b, B, A), ...q(b, c, C, B), ...q(c, e, E, C), ...q(e, a, A, E)].flat());
}
/** A flat 10 x 10 sheet at z = 0 (an open, planar mesh: hMax 0). */
const sheet = () => Float32Array.from([...tri([-5, -5, 0], [5, -5, 0], [5, 5, 0]), ...tri([-5, -5, 0], [5, 5, 0], [-5, 5, 0])]);
/** A closed UV sphere (radius r, `seg` around, `rings` pole to pole), welded by indexMesh. */
function sphere(r = 5, seg = 64, rings = 32) {
  const pt = (i, j) => {
    if (j === 0) return [0, 0, r];
    if (j === rings) return [0, 0, -r];
    const th = (Math.PI * j) / rings, ph = (2 * Math.PI * (i % seg)) / seg;
    return [r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)];
  };
  const t = [];
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
    const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
    if (j > 0) t.push(tri(a, d, b));
    if (j < rings - 1) t.push(tri(b, d, c));
  }
  return Float32Array.from(t.flat());
}
/** A closed thin slab: an n x n grid on top (z = th) and bottom (z = 0), joined by side walls. */
function slab(n, th) {
  const t = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    t.push(tri([i, j, th], [i + 1, j, th], [i + 1, j + 1, th]), tri([i, j, th], [i + 1, j + 1, th], [i, j + 1, th]));
    t.push(tri([i, j, 0], [i + 1, j + 1, 0], [i + 1, j, 0]), tri([i, j, 0], [i, j + 1, 0], [i + 1, j + 1, 0]));
  }
  for (let i = 0; i < n; i++) {
    for (const [p, q] of [[[i, 0], [i + 1, 0]], [[n, i], [n, i + 1]], [[i + 1, n], [i, n]], [[0, i + 1], [0, i]]]) {
      t.push(tri([...p, 0], [...q, 0], [...q, th]), tri([...p, 0], [...q, th], [...p, th]));
    }
  }
  return Float32Array.from(t.flat());
}
function binaryStl(soup, header = 'binary', pad = 0) {
  const n = soup.length / 9;
  const buf = new ArrayBuffer(84 + n * 50 + pad);
  const dv = new DataView(buf);
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i));
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) dv.setFloat32(84 + t * 50 + 12 + k * 4, soup[t * 9 + k], true);
  return buf;
}
function asciiStl(soup) {
  let s = 'solid test\n';
  for (let t = 0; t < soup.length / 9; t++) {
    s += 'facet normal 0 0 1\n outer loop\n';
    for (let v = 0; v < 3; v++) s += `  vertex ${soup[t * 9 + v * 3]} ${soup[t * 9 + v * 3 + 1]} ${soup[t * 9 + v * 3 + 2]}\n`;
    s += ' endloop\nendfacet\n';
  }
  return new TextEncoder().encode(s + 'endsolid test\n');
}
/** mulberry32: a seeded PRNG (the same "random" mesh on every run) */
function prng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const GRID = { nx: 41, nz: 41, widthIn: 20, heightIn: 20 }; // dx = dy = 0.5
const N = GRID.nx * GRID.nz;
const flat = (z) => new Float32Array(N).fill(z);
const rec = (soup, extra = {}) => ({ ...normaliseStlLayer({ id: 'r', unitIn: 1, mesh: encodeMesh(indexMesh(soup)) }), ...extra });
const cellAt = (h, x, y) => h[Math.round((y + 10) / 0.5) * GRID.nx + Math.round((x + 10) / 0.5)]; // scene (x, y)
const vertexAt = (pos, pick) => { let best = 0; for (let v = 1; v < pos.length / 3; v++) if (pick(pos[v * 3 + 2], pos[best * 3 + 2])) best = v; return best; };

beforeEach(() => _resetStlCachesForTests());

// ── A1 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('A1: the stamp lands where the ghost is (buildHeightField\'s frame), not mirrored top-to-bottom', () => {
  it('an off-centre apex placed at (-2, +3): the stamped surface\'s highest vertex (REAL buildHeightField) is under the ghost\'s apex', () => {
    const r = rec(pyramid(4, 2), { position: { x: -2, y: 3, z: 0 } }); // apex (4, 2) of a box centred at 0 -> scene (2, 5)
    const stamped = applyStampLayers(flat(1), stlPasses([r], GRID), GRID.nx, GRID.nz);
    const field = buildHeightField(stamped, GRID.nx, GRID.nz, GRID.widthIn, GRID.heightIn);
    const top = vertexAt(field.pos, (a, b) => a > b);
    const ghost = ghostGeometry(r, flat(1), GRID);
    const apex = vertexAt(ghost.positions, (a, b) => a > b);
    const [gx, gy] = [ghost.positions[apex * 3], ghost.positions[apex * 3 + 1]];
    expect(gx).toBeCloseTo(2, 3); expect(gy).toBeCloseTo(5, 3);
    expect(Math.abs(field.pos[top * 3] - gx)).toBeLessThanOrEqual(0.5);     // within one grid cell
    expect(Math.abs(field.pos[top * 3 + 1] - gy)).toBeLessThanOrEqual(0.5); // (the old raster put it at y = -5)
    expect(field.pos[top * 3 + 2]).toBeCloseTo(1 + 4, 2);
  });
  it('the ghost\'s base height follows the same frame: sampled at its centre on a surface that rises UP the view', () => {
    const rising = Float32Array.from({ length: N }, (_, k) => Math.floor(k / GRID.nx) * 0.1); // row j at y = -10 + j*0.5
    const field = buildHeightField(rising, GRID.nx, GRID.nz, GRID.widthIn, GRID.heightIn);
    const g = ghostGeometry(rec(pyramid(), { position: { x: 0, y: 6, z: 0 } }), rising, GRID);
    const lowest = vertexAt(g.positions, (a, b) => a < b);
    const k = Math.round((6 + 10) / 0.5) * GRID.nx + 20; // the field vertex at scene (0, 6)
    expect(field.pos[k * 3 + 1]).toBeCloseTo(6, 6);
    expect(g.positions[lowest * 3 + 2]).toBeCloseTo(field.pos[k * 3 + 2], 4); // 3.2 (the old surfaceAt read y = -6: 0.8)
  });
});

// ── A2 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('A2: the mesh hash covers the box, not only the quantised text', () => {
  it('a 10x10x10 box and a 10x10x2 box (the same 16-bit positions) get different h and stamp their own heights', () => {
    const tall = encodeMesh(indexMesh(box(10, 10, 10))), low = encodeMesh(indexMesh(box(10, 10, 2)));
    expect(low.pos).toBe(tall.pos); // the collision case: identical quantised text
    expect(low.h).not.toBe(tall.h);
    const pTall = stlPass({ id: 't', unitIn: 1, mesh: tall }, GRID), pLow = stlPass({ id: 'l', unitIn: 1, mesh: low }, GRID);
    expect(pTall.depth).toBeCloseTo(10, 3);
    expect(pLow.depth).toBeCloseTo(2, 3); // the old shared h handed it the tall box's cached raster: 10
  });
});

// ── A3 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('A3: one bad stored mesh does not break the board', () => {
  const saved = {};
  beforeEach(() => { Object.assign(saved, { w: P.widthIn, h: P.heightIn, s: P.stlLayers }); P.widthIn = GRID.widthIn; P.heightIn = GRID.heightIn; });
  afterEach(() => { P.widthIn = saved.w; P.heightIn = saved.h; if (saved.s === undefined) delete P.stlLayers; else P.stlLayers = saved.s; });
  it('an unknown mesh version and a truncated position string are skipped and named; a healthy sibling still stamps', () => {
    const good = rec(pyramid(), { id: 'good' });
    const truncated = { ...good, id: 'trunc', mesh: { ...good.mesh, pos: good.mesh.pos.slice(0, -3) } };
    P.stlLayers = [{ v: 1, id: 'v99', enabled: true, mesh: { v: 99 } }, truncated, good];
    let passes;
    expect(() => { passes = _collectStampPasses(GRID.nx, GRID.nz); }).not.toThrow();
    expect(passes.map((p) => p.id)).toEqual(['stl:good']);
    const errs = getStlErrors();
    expect(Object.keys(errs).sort()).toEqual(['trunc', 'v99']);
    expect(errs.v99).toMatch(/version 99/);
    expect(errs.trunc.length).toBeGreaterThan(0);
    const h = applyStampLayers(flat(1), passes, GRID.nx, GRID.nz);
    expect(cellAt(h, 0, 0)).toBeCloseTo(1 + 4, 3);
    P.stlLayers = [good]; // the next build refills the map: the errors of layers gone are gone
    _collectStampPasses(GRID.nx, GRID.nz);
    expect(getStlErrors()).toEqual({});
  });
  it('the ghost path records its own decode failure in the same map', () => {
    const p = { setStlGhosts(l) { this.list = l; } };
    updateStlGhosts(p, [{ id: 'bad', enabled: true, mesh: { v: 99 } }, rec(pyramid())], flat(0), GRID);
    expect(p.list).toHaveLength(1);
    expect(getStlErrors().bad).toMatch(/version 99/);
  });
});

// ── A4 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('A4: the final pass body is cached; the caches are LRU', () => {
  beforeEach(() => { renderDepth.mockClear(); }); // (braces: a returned function would run as the hook's teardown)
  const sum = (a) => a.reduce((n, v) => n + v, 0);
  it('identical inputs hand back the SAME body; softness recomputes the body only; position.z recomputes nothing', () => {
    const r = rec(pyramid());
    const a = stlPass(r, GRID), b = stlPass(r, GRID);
    expect(b.mask.body).toBe(a.mask.body);
    expect(renderDepth).toHaveBeenCalledTimes(1);
    const soft = stlPass({ ...r, softness: 1 }, GRID);
    expect(soft.mask.body).not.toBe(a.mask.body);
    expect(sum(soft.mask.isStamped)).toBeGreaterThan(sum(a.mask.isStamped));
    expect(renderDepth).toHaveBeenCalledTimes(1); // the raster is reused under the blur
    const sunk = stlPass({ ...r, position: { x: 0, y: 0, z: -1.5 } }, GRID);
    expect(sunk.mask.body).toBe(a.mask.body);
    expect(sunk.zOffset).toBe(-1.5);
    expect(renderDepth).toHaveBeenCalledTimes(1);
    stlPass({ ...r, position: { x: 1, y: 0, z: 0 } }, GRID); // a real move does render
    expect(renderDepth).toHaveBeenCalledTimes(2);
  });
  it('LRU, not FIFO: a layer used again stays while 16 others pass through', () => {
    const base = rec(pyramid());
    const at = (i) => ({ ...base, position: { x: (i % 9) - 4, y: Math.floor(i / 9) - 1, z: 0 } });
    for (let i = 0; i < 16; i++) stlPass(at(i), GRID);
    expect(renderDepth).toHaveBeenCalledTimes(16);
    stlPass(at(0), GRID);  // used again: now the newest
    stlPass(at(16), GRID); // the 17th: drops the oldest, which is #1, not #0
    expect(renderDepth).toHaveBeenCalledTimes(17);
    stlPass(at(0), GRID);
    expect(renderDepth).toHaveBeenCalledTimes(17); // still cached (FIFO had dropped it)
    stlPass(at(1), GRID);
    expect(renderDepth).toHaveBeenCalledTimes(18);
  });
});

// ── A5 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('A5: Depth (zScale) stretches the board-vertical height AFTER the rotation', () => {
  it('a 10x10x2 box stood up (rotation X = 90): zScale 2 doubles its standing height (10 -> 20), same footprint', () => {
    const m = indexMesh(box(10, 10, 2));
    const lay = (zScale) => ({ ...normaliseStlLayer({ unitIn: 1 }), rotation: { x: 90, y: 0, z: 0 }, zScale });
    const one = renderDepth(m, lay(1), GRID), two = renderDepth(m, lay(2), GRID);
    expect(one.hMax).toBeCloseTo(10, 4); // the box's 10 deep side now stands up
    expect(two.hMax).toBeCloseTo(20, 4); // (the old zScale stretched the 2 thick side, now lying flat: still 10)
    expect(Array.from(two.covered)).toEqual(Array.from(one.covered));
    expect(cellAt(one.covered, 0, 0.5)).toBe(1); expect(cellAt(one.covered, 0, 1.5)).toBe(0); // 2 deep from above (y -1..1)
  });
});

// ── A6 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('A6: Carved carries its own sign (a flat mesh has depth -0)', () => {
  const run = (r) => applyStampLayers(flat(1), stlPasses([r], GRID), GRID.nx, GRID.nz);
  it('a flat sheet, Carved, Z offset 0.5: Max digs 0.5 (1 -> 0.5), Add digs 0.5 (1 -> 0.5); Raised lifts 0.5', () => {
    const carvedMax = rec(sheet(), { raise: false, position: { x: 0, y: 0, z: 0.5 } });
    expect(stlPass(carvedMax, GRID)).toMatchObject({ carve: true });
    expect(cellAt(run(carvedMax), 0, 0)).toBeCloseTo(0.5, 6); // the old code raised it to 1.5
    expect(cellAt(run({ ...carvedMax, blend: 'add' }), 0, 0)).toBeCloseTo(0.5, 6); // old: 1.5
    expect(cellAt(run({ ...carvedMax, raise: true }), 0, 0)).toBeCloseTo(1.5, 6);
    expect(cellAt(run({ ...carvedMax, raise: true, blend: 'add' }), 0, 0)).toBeCloseTo(1.5, 6);
    expect(cellAt(run(carvedMax), 0, 6)).toBe(1); // off the sheet: untouched
  });
  it('a pyramid, Carved, Add, Z offset 0.5: the apex digs Z + height = 4.5 (1 -> -3.5); Raised Add is unchanged (1 + 0.5 + 4)', () => {
    const r = rec(pyramid(), { raise: false, blend: 'add', position: { x: 0, y: 0, z: 0.5 } });
    expect(cellAt(run(r), 0, 0)).toBeCloseTo(1 - 4.5, 3);
    expect(cellAt(run({ ...r, raise: true }), 0, 0)).toBeCloseTo(1 + 4.5, 3);
  });
});

// ── A7 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('A7: import robustness and the mesh health of the ORIGINAL', () => {
  const board = { widthIn: 20, heightIn: 20 };
  it('an empty or all-collapsed STL is refused with a message (no -0 unit, no Infinity in the record)', () => {
    expect(() => createStlLayer({ soup: new Float32Array(0), board })).toThrow('The STL has no usable triangles.');
    const collapsed = Float32Array.from([...tri([0, 0, 0], [0, 0, 0], [1, 1, 1]), ...tri([2, 2, 2], [3, 3, 3], [3, 3, 3])]);
    expect(() => createStlLayer({ soup: collapsed, board })).toThrow('The STL has no usable triangles.');
  });
  it('a closed thin slab stored decimated reports CLOSED (health of the original), though the stored copy is not', () => {
    // 40 x 40 x 0.3, top + bottom grids + side walls: closed. Clustering folds the top onto the bottom.
    const { record, original } = createStlLayer({ soup: slab(40, 0.3), board, storedDetail: 300 });
    expect(record.origTris).toBe(6720);
    const stored = meshHealth(decodeMesh(record.mesh));
    expect(stored.openEdges + stored.nonManifoldEdges).toBeGreaterThan(0); // what the old report showed: defects the file has not
    expect(record.health).toEqual({ triangles: 6720, vertices: 41 * 41 * 2, openEdges: 0, nonManifoldEdges: 0, boundaryLoops: 0, components: 1 });
    expect(stlHealth(record)).toEqual(record.health);
    expect(JSON.parse(JSON.stringify(record)).health).toEqual(record.health); // a small plain object: saved as is
    const re = restoreAtDetail(record, original, 1000);
    expect(re.storedTris).toBeGreaterThan(record.storedTris);
    expect(re.health).toBe(record.health);
    const { health, ...legacy } = record; // a record saved before `health`: measured on its stored copy
    expect(stlHealth(legacy)).toEqual(stored);
  });
});

// ── A8 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('A8: parseStl reads a padded binary file', () => {
  it('trailing bytes after the triangles: binary (also with a "solid" header); ASCII and garbage as before', () => {
    for (const header of ['binary', 'solid exported by a CAD tool']) {
      const r = parseStl(binaryStl(pyramid(), header, 7));
      expect(r.format).toBe('binary');
      expect(r.triCount).toBe(6);
      expect(Array.from(r.soup)).toEqual(Array.from(pyramid()));
    }
    const a = parseStl(asciiStl(pyramid()));
    expect(a.format).toBe('ascii');
    expect(Array.from(a.soup)).toEqual(Array.from(pyramid()));
    expect(() => parseStl(new Uint8Array(200).fill(7))).toThrow(/not an STL/i);
    const solidGarbage = new Uint8Array(300).fill(32); solidGarbage.set(new TextEncoder().encode('solid nothing here'));
    expect(() => parseStl(solidGarbage)).toThrow(/no complete triangles/i);
  });
});

// ── A9 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
// The implementations BEFORE A9 (string keys), kept verbatim as the reference oracle.
function oldIndexMesh(soup) {
  const keyOf = (x, y, z) => `${x},${y},${z}`;
  const nTri = Math.floor(soup.length / 9);
  const idOf = new Map();
  const pos = [];
  const idx = [];
  const keys = new Array(3);
  for (let t = 0; t < nTri; t++) {
    const o = t * 9;
    let ok = true;
    for (let v = 0; v < 3; v++) {
      const x = soup[o + v * 3], y = soup[o + v * 3 + 1], z = soup[o + v * 3 + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) { ok = false; break; }
      keys[v] = keyOf(x, y, z);
    }
    if (!ok || keys[0] === keys[1] || keys[1] === keys[2] || keys[0] === keys[2]) continue;
    for (let v = 0; v < 3; v++) {
      let id = idOf.get(keys[v]);
      if (id === undefined) { id = pos.length / 3; idOf.set(keys[v], id); pos.push(soup[o + v * 3], soup[o + v * 3 + 1], soup[o + v * 3 + 2]); }
      idx.push(id);
    }
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}
function oldCluster(mesh, size, min) {
  const { positions, indices } = mesh;
  const nv = positions.length / 3;
  const cellOf = new Map();
  const remap = new Int32Array(nv);
  const sum = [];
  for (let v = 0; v < nv; v++) {
    const cx = Math.floor((positions[v * 3] - min[0]) / size);
    const cy = Math.floor((positions[v * 3 + 1] - min[1]) / size);
    const cz = Math.floor((positions[v * 3 + 2] - min[2]) / size);
    const key = `${cx},${cy},${cz}`;
    let id = cellOf.get(key);
    if (id === undefined) { id = sum.length / 4; cellOf.set(key, id); sum.push(0, 0, 0, 0); }
    remap[v] = id;
    sum[id * 4] += positions[v * 3]; sum[id * 4 + 1] += positions[v * 3 + 1]; sum[id * 4 + 2] += positions[v * 3 + 2]; sum[id * 4 + 3] += 1;
  }
  const outPos = new Float32Array(sum.length / 4 * 3);
  for (let c = 0; c < sum.length / 4; c++) {
    outPos[c * 3] = sum[c * 4] / sum[c * 4 + 3]; outPos[c * 3 + 1] = sum[c * 4 + 1] / sum[c * 4 + 3]; outPos[c * 3 + 2] = sum[c * 4 + 2] / sum[c * 4 + 3];
  }
  const seen = new Set();
  const outIdx = [];
  for (let t = 0; t < indices.length; t += 3) {
    const a = remap[indices[t]], b = remap[indices[t + 1]], c = remap[indices[t + 2]];
    if (a === b || b === c || a === c) continue;
    const lo = Math.min(a, b, c), hi = Math.max(a, b, c), mid = a + b + c - lo - hi;
    const k = `${lo},${mid},${hi}`;
    if (seen.has(k)) continue;
    seen.add(k);
    outIdx.push(a, b, c);
  }
  return { positions: outPos, indices: Uint32Array.from(outIdx) };
}
/** A random soup: corners drawn from a small pool (so they weld), -0 next to 0, some collapsed and some NaN triangles. */
function randomSoup(seed, nTri = 4000, pool = 900) {
  const rnd = prng(seed);
  const verts = Array.from({ length: pool }, () => [Math.round(rnd() * 40) / 4 - 5, Math.round(rnd() * 40) / 4 - 5, Math.round(rnd() * 12) / 4]);
  verts[0] = [0, 0, 0]; verts[1] = [-0, 0, -0]; verts[2] = [0, -0, 0]; // three spellings of the origin
  const out = [];
  for (let t = 0; t < nTri; t++) {
    const a = verts[Math.floor(rnd() * pool)], b = verts[Math.floor(rnd() * pool)];
    const c = rnd() < 0.05 ? a : verts[Math.floor(rnd() * pool)]; // ~5% collapsed
    out.push(...(rnd() < 0.01 ? [NaN, 0, 0] : a), ...b, ...c);
  }
  return Float32Array.from(out);
}
/** a noisy height-field surface (welded), the kind decimate meets */
function bumpyGrid(n, seed) {
  const rnd = prng(seed);
  const z = Array.from({ length: (n + 1) * (n + 1) }, () => rnd() * 0.7);
  const P3 = (i, j) => [i, j, z[j * (n + 1) + i]];
  const t = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) t.push(tri(P3(i, j), P3(i + 1, j), P3(i + 1, j + 1)), tri(P3(i, j), P3(i + 1, j + 1), P3(i, j + 1)));
  return Float32Array.from(t.flat());
}
const triKeys = (m) => {
  const s = new Set();
  for (let t = 0; t < m.indices.length; t += 3) {
    const c = [0, 1, 2].map((k) => Array.from(m.positions.slice(m.indices[t + k] * 3, m.indices[t + k] * 3 + 3)).join(','));
    s.add(c.sort().join('|'));
  }
  return s;
};
/** the old decimate (string-keyed clustering + de-dup), verbatim around oldCluster: the A13 oracle */
function oldDecimate(mesh, target) {
  const nt = mesh.indices.length / 3;
  if (!(target >= 1) || nt <= target) return mesh;
  const { min, max } = meshBounds(mesh.positions);
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  let lo = extent / 4096, hi = extent;
  let best = oldCluster(mesh, hi, min);
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const m = oldCluster(mesh, mid, min);
    if (m.indices.length / 3 <= target) { best = m; hi = mid; } else lo = mid;
  }
  return best;
}
/** how many triangles repeat an earlier one's sorted vertex triple (either winding) */
const dupTriples = (m) => {
  const s = new Set();
  let d = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const k = [m.indices[t], m.indices[t + 1], m.indices[t + 2]].sort((x, y) => x - y).join(',');
    if (s.has(k)) d++; else s.add(k);
  }
  return d;
};
const unreferenced = (m) => { const used = new Uint8Array(m.positions.length / 3); for (const i of m.indices) used[i] = 1; return used.length - used.reduce((n, u) => n + u, 0); };

describe('A9: integer-keyed weld and clustering equal the string-keyed ones', () => {
  it('indexMesh: the same vertices, triangles and order as the old weld on seeded random soups', () => {
    for (const seed of [1, 7, 42]) {
      const soup = randomSoup(seed);
      const a = indexMesh(soup), b = oldIndexMesh(soup);
      expect(a.positions.length).toBe(b.positions.length);
      expect(a.indices.length).toBe(b.indices.length);
      expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
      expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
      expect(triKeys(a)).toEqual(triKeys(b));
    }
  });
  it('one cluster pass: the same set of triangles by coordinates as the old one, with no unreferenced vertex', () => {
    let oldOrphans = 0;
    // a noisy height field, a closed sphere (at cell 2 the old pass left 3 clusters no triangle used), a thin slab
    for (const [soup, sizes] of [[bumpyGrid(40, 3), [0.37, 1.1, 3.3, 9]], [sphere(), [1.5, 2, 3]], [slab(30, 0.3), [0.5, 1.7, 4]]]) {
      const m = indexMesh(soup);
      const { min } = meshBounds(m.positions);
      for (const size of sizes) {
        const a = clusterMesh(m, size, min), b = oldCluster(m, size, min);
        expect(triKeys(a)).toEqual(triKeys(b));
        expect(a.indices.length).toBe(b.indices.length); // A13: duplicates are dropped again, as the old pass did
        expect(dupTriples(a)).toBe(0);
        expect(unreferenced(a)).toBe(0);
        oldOrphans += unreferenced(b);
        const used = new Set(); for (const i of b.indices) used.add(Array.from(b.positions.slice(i * 3, i * 3 + 3)).join(','));
        const kept = new Set(); for (let v = 0; v < a.positions.length / 3; v++) kept.add(Array.from(a.positions.slice(v * 3, v * 3 + 3)).join(','));
        expect(kept).toEqual(used); // compact: exactly the old clusters a triangle uses
        expect(kept.size).toBe(a.positions.length / 3);
      }
    }
    expect(oldOrphans).toBeGreaterThan(0); // the old passes did leave orphans (the compaction is not vacuous)
  });
  it('decimate: at most the target, no unreferenced vertex, inside the original bounds', () => {
    // the sphere at 50: the old decimate kept 3 vertices no triangle used (measured: 48 triangles, 3 orphans)
    for (const [m, target] of [[indexMesh(bumpyGrid(60, 5)), 500], [indexMesh(bumpyGrid(60, 5)), 2000], [indexMesh(bumpyGrid(60, 5)), 6000], [indexMesh(sphere()), 50], [indexMesh(slab(30, 0.3)), 400]]) {
      const ob = meshBounds(m.positions);
      const d = decimate(m, target);
      expect(d.indices.length / 3).toBeLessThanOrEqual(target);
      expect(d.indices.length / 3).toBeGreaterThan(target / 10);
      expect(unreferenced(d)).toBe(0);
      const b = meshBounds(d.positions);
      for (let a = 0; a < 3; a++) { expect(b.min[a]).toBeGreaterThanOrEqual(ob.min[a] - 1e-5); expect(b.max[a]).toBeLessThanOrEqual(ob.max[a] + 1e-5); }
    }
  });
});

// ── A13 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('A13: decimate keeps each clustered triangle once (the stored budget is not spent on copies)', () => {
  it('the closed 40 x 40 x 0.3 slab at targets 1000 and 300: no repeated triple, and at least the old unique count', () => {
    const m = indexMesh(slab(40, 0.3));
    for (const target of [1000, 300]) {
      const d = decimate(m, target), old = oldDecimate(m, target);
      expect(d.indices.length / 3).toBeLessThanOrEqual(target);
      expect(dupTriples(d)).toBe(0); // measured before A13: 900 triangles at 1000, many of them the top folded onto the bottom
      const unique = d.indices.length / 3 - dupTriples(d), oldUnique = old.indices.length / 3 - dupTriples(old);
      expect(unique).toBeGreaterThanOrEqual(oldUnique); // the old (string-key) decimate: 968 at 1000, 288 at 300
      expect(unreferenced(d)).toBe(0);
    }
  });
  it('decimate equals the old string-key decimate on the 3 seeded random soups (the same triangles by coordinates)', () => {
    for (const seed of [1, 7, 42]) {
      const m = indexMesh(randomSoup(seed));
      const d = decimate(m, 1000), old = oldDecimate(m, 1000);
      expect(d.indices.length).toBe(old.indices.length);
      expect(triKeys(d)).toEqual(triKeys(old));
      expect(dupTriples(d)).toBe(0);
      expect(unreferenced(d)).toBe(0);
    }
  });
});

// ── A10 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('A10: the digests read a stored mesh by its content hash', () => {
  const saved = {};
  beforeEach(() => { saved.s = P.stlLayers; });
  afterEach(() => { if (saved.s === undefined) delete P.stlLayers; else P.stlLayers = saved.s; });
  it('the mesh text changing under the same h leaves both digests; a new h changes both', () => {
    const r = rec(pyramid());
    P.stlLayers = [r];
    const d = () => [rebuildInputDigest(null, 41, 41), heightsInputDigest(41, 41)];
    const d1 = d();
    expect(d1[0]).not.toBe(null); expect(d1[1]).not.toBe(null);
    r.mesh = { ...r.mesh, pos: `B${r.mesh.pos.slice(1)}` };
    expect(d()).toEqual(d1); // the old digests stringified the whole base64 text: they changed
    r.mesh = { ...r.mesh, h: `${r.mesh.h}x` };
    const d3 = d();
    expect(d3[0]).not.toBe(d1[0]); expect(d3[1]).not.toBe(d1[1]);
    r.position = { x: 1, y: 0, z: 0 }; // the record's other fields still count
    expect(d()[1]).not.toBe(d3[1]);
  });
});

// ── A11 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('A11: the ghost sits on the surface BEFORE the stamps, not on its own relief', () => {
  it('ghostSurface picks the pre-stamp heights; the ghost\'s lowest vertex is at the flat surface (1), not the stamped centre', () => {
    const r = rec(pyramid());
    const clean = flat(1);
    const stamped = applyStampLayers(clean, stlPasses([r], GRID), GRID.nx, GRID.nz);
    expect(cellAt(stamped, 0, 0)).toBeCloseTo(5, 3);
    expect(ghostSurface({ heights: stamped, cleanHeights: clean })).toBe(clean);
    expect(ghostSurface({ heights: stamped })).toBe(stamped);
    const g = ghostGeometry(r, ghostSurface({ heights: stamped, cleanHeights: clean }), GRID);
    expect(g.positions[vertexAt(g.positions, (a, b) => a < b) * 3 + 2]).toBeCloseTo(1, 4);
    expect(g.positions[vertexAt(g.positions, (a, b) => a > b) * 3 + 2]).toBeCloseTo(5, 3);
  });
  it('a real rebuild hands the preview ghosts sitting on its cleanHeights', async () => {
    const keys = ['widthIn', 'heightIn', 'spacing', 'stlLayers'];
    const before = Object.fromEntries(keys.map((k) => [k, P[k]]));
    try {
      Object.assign(P, { widthIn: 5, heightIn: 6, spacing: 0.1 });
      P.stlLayers = [rec(pyramid(), { id: 'rb', unitIn: 0.2 })]; // 2 in wide, 0.8 in tall, at the centre
      _forgetHeights();
      const preview = { update() {}, setStlGhosts(l) { this.ghosts = l; } };
      await rebuild(preview, () => {}, () => {});
      const { nx, nz, heights, cleanHeights } = lastResult;
      const grid = { nx, nz, widthIn: 5, heightIn: 6 };
      expect(preview.ghosts).toHaveLength(1);
      const g = preview.ghosts[0];
      const lowZ = g.positions[vertexAt(g.positions, (a, b) => a < b) * 3 + 2];
      const onClean = surfaceAt(cleanHeights, grid, 0, 0), onStamped = surfaceAt(heights, grid, 0, 0);
      expect(onStamped - onClean).toBeGreaterThan(0.5); // the stamp is there
      expect(lowZ).toBeCloseTo(onClean, 4);             // the old rebuild sat it on `heights` (onStamped)
    } finally {
      for (const k of keys) { if (before[k] === undefined) delete P[k]; else P[k] = before[k]; }
      _forgetHeights();
    }
  }, 60000);
});

/**
 * STL-RELIEF (STL-RELIEF-DESIGN.md) engine: parse -> weld -> store -> place -> z-buffer -> stamp pass -> applyStampLayers.
 * Real byte layouts and real meshes (a pyramid, an open box, a 300x300 grid), the real applyStampLayers / _collectStampPasses.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { parseStl } from '../bspline-frame-builder/b-spline-gen/html/core/stl/parse.js';
import { indexMesh, decimate, encodeMesh, decodeMesh, meshHealth, meshBounds } from '../bspline-frame-builder/b-spline-gen/html/core/stl/mesh.js';
import { renderDepth, rotationMatrix } from '../bspline-frame-builder/b-spline-gen/html/core/stl/raster.js';
import {
  stlPass, stlPasses, normaliseStlLayer, createStlLayer, restoreAtDetail, compressRelief, STL_LAYER_DEFAULTS, totalStoredTris, _resetStlCachesForTests,
} from '../bspline-frame-builder/b-spline-gen/html/core/stl/layer.js';
import { applyStampLayers } from '../bspline-frame-builder/b-spline-gen/html/core/engine/apply-stamp-layers.js';
import { _collectStampPasses } from '../bspline-frame-builder/b-spline-gen/html/core/engine/rebuild.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

// ── meshes ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const tri = (a, b, c) => [...a, ...b, ...c];
/** A square pyramid: 10 x 10 base at z=0, apex (0,0,4) at the middle. Closed (base included). */
function pyramid({ flip = false, base = true } = {}) {
  const A = [-5, -5, 0], B = [5, -5, 0], C = [5, 5, 0], D = [-5, 5, 0], T = [0, 0, 4];
  const t = [tri(A, B, T), tri(B, C, T), tri(C, D, T), tri(D, A, T)];
  if (base) t.push(tri(A, C, B), tri(A, D, C));
  const soup = Float32Array.from(t.flat());
  if (flip) for (let i = 0; i < soup.length; i += 9) for (let a = 0; a < 3; a++) { const x = soup[i + 3 + a]; soup[i + 3 + a] = soup[i + 6 + a]; soup[i + 6 + a] = x; }
  return soup;
}
/** A flat n x n grid of quads (2 triangles each) over [0,n] x [0,n], z = 0. */
function gridSoup(n) {
  const t = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    t.push(tri([i, j, 0], [i + 1, j, 0], [i + 1, j + 1, 0]), tri([i, j, 0], [i + 1, j + 1, 0], [i, j + 1, 0]));
  }
  return Float32Array.from(t.flat());
}
function binaryStl(soup, header = 'binary') {
  const n = soup.length / 9;
  const buf = new ArrayBuffer(84 + n * 50);
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

const GRID = { nx: 41, nz: 41, widthIn: 20, heightIn: 20 }; // dx = dy = 0.5
const at = (g, x, y) => g[Math.round(y / 0.5) * GRID.nx + Math.round(x / 0.5)];
const PYR = () => indexMesh(pyramid());
const REC = (extra = {}) => ({ ...normaliseStlLayer({ id: 't1', mesh: encodeMesh(PYR()), unitIn: 1 }), ...extra });

// ── parse ───────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('parseStl', () => {
  it('reads a binary STL (also one whose 80-byte header starts with "solid")', () => {
    for (const header of ['binary', 'solid exported by a CAD tool']) {
      const r = parseStl(binaryStl(pyramid(), header));
      expect(r.format).toBe('binary');
      expect(r.triCount).toBe(6);
      expect(Array.from(r.soup)).toEqual(Array.from(pyramid()));
    }
  });
  it('reads an ASCII STL to the same soup', () => {
    const r = parseStl(asciiStl(pyramid()));
    expect(r.format).toBe('ascii');
    expect(Array.from(r.soup)).toEqual(Array.from(pyramid()));
  });
  it('refuses a file that is neither', () => {
    expect(() => parseStl(new Uint8Array(200).fill(7))).toThrow(/not an STL/i);
    expect(() => parseStl(new Uint8Array(4))).toThrow(/too short/i);
  });
});

// ── mesh ────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('mesh: weld, health, stored record, decimate', () => {
  it('welds shared corners and drops collapsed triangles', () => {
    const m = indexMesh(Float32Array.from([...tri([0, 0, 0], [1, 0, 0], [0, 1, 0]), ...tri([1, 0, 0], [1, 1, 0], [0, 1, 0]), ...tri([0, 0, 0], [0, 0, 0], [1, 1, 1])]));
    expect(m.positions.length / 3).toBe(4);
    expect(m.indices.length / 3).toBe(2);
  });
  it('health: a closed pyramid has no open edges; without its base it has one open outline; a loose triangle is a 2nd piece', () => {
    expect(meshHealth(PYR())).toMatchObject({ triangles: 6, openEdges: 0, boundaryLoops: 0, components: 1 });
    expect(meshHealth(indexMesh(pyramid({ base: false })))).toMatchObject({ triangles: 4, openEdges: 4, boundaryLoops: 1, components: 1 });
    const two = Float32Array.from([...pyramid({ base: false }), ...tri([20, 20, 0], [21, 20, 0], [20, 21, 1])]);
    expect(meshHealth(indexMesh(two)).components).toBe(2);
  });
  it('the stored record round-trips within the 16-bit quantisation, and a big mesh switches to 32-bit indices', () => {
    const m = PYR();
    const back = decodeMesh(encodeMesh(m));
    expect(Array.from(back.indices)).toEqual(Array.from(m.indices));
    for (let i = 0; i < m.positions.length; i++) expect(Math.abs(back.positions[i] - m.positions[i])).toBeLessThan(10 / 65535 + 1e-6);
    const big = indexMesh(gridSoup(300)); // 301 x 301 = 90601 vertices
    const rec = encodeMesh(big);
    expect(rec.idxBits).toBe(32);
    expect(decodeMesh(rec).indices.length).toBe(big.indices.length);
    expect(() => decodeMesh({ v: 99 })).toThrow(/version/i);
  });
  it('decimate: at most the target, inside the same bounds; a mesh already under the target is returned as it is', () => {
    const m = indexMesh(gridSoup(60)); // 7200 triangles
    const d = decimate(m, 1000);
    expect(d.indices.length / 3).toBeLessThanOrEqual(1000);
    expect(d.indices.length / 3).toBeGreaterThan(100);
    const b = meshBounds(d.positions);
    expect(b.min[0]).toBeGreaterThanOrEqual(0); expect(b.max[0]).toBeLessThanOrEqual(60);
    const p = PYR();
    expect(decimate(p, 100)).toBe(p); // already under the target: the same object back, never a copy
  });
});

// ── raster ──────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('renderDepth: the placed STL seen from above', () => {
  const lay = (extra = {}) => ({ ...normaliseStlLayer({ unitIn: 1 }), ...extra });
  it('a pyramid: apex 4 high at the board centre, 0 at its base edge, uncovered outside; base rests at height 0', () => {
    const r = renderDepth(PYR(), lay(), GRID);
    expect(r.hMax).toBeCloseTo(4, 5);
    expect(at(r.height, 10, 10)).toBeCloseTo(4, 4);
    expect(at(r.height, 10 + 2.5, 10)).toBeCloseTo(2, 3); // halfway to the edge
    expect(at(r.covered, 10 + 6, 10)).toBe(0);            // outside the 10-wide base
    expect(at(r.height, 10 + 6, 10)).toBe(0);
  });
  it('position moves it; scale and the height factor scale it', () => {
    // the scene's frame (core/preview/terrain-mesh.js buildHeightField): +x right, +y UP the screen = a LARGER grid row
    // (row 0 is the bottom, y = -10)
    const moved = renderDepth(PYR(), lay({ position: { x: 3, y: -2, z: 0 } }), GRID);
    expect(at(moved.height, 13, 8)).toBeCloseTo(4, 3); // 3 right of centre, 2 DOWN the screen = row y 8 (scene y -2)
    expect(at(moved.covered, 10, 10)).toBe(1); // the footprint still reaches the old centre
    const bigger = renderDepth(PYR(), lay({ scale: 1.5, zScale: 2 }), GRID);
    expect(bigger.hMax).toBeCloseTo(4 * 1.5 * 2, 4);
    expect(at(bigger.covered, 10 + 7, 10)).toBe(1); // 15 wide now
  });
  it('orientation: the STL +Y axis is UP the screen (a LARGER grid row, as buildHeightField lays it), +X is right', () => {
    // a ramp rising along +Y: low at y=-5, high at y=+5 (an open sheet tilted 45 degrees)
    const ramp = indexMesh(Float32Array.from([...tri([-5, -5, 0], [5, -5, 0], [5, 5, 10]), ...tri([-5, -5, 0], [5, 5, 10], [-5, 5, 10])]));
    const r = renderDepth(ramp, lay(), GRID);
    expect(at(r.height, 10, 10 + 4)).toBeGreaterThan(at(r.height, 10, 10 - 4)); // up the screen = row y 14 (scene y +4) is HIGHER than row y 6
    const east = indexMesh(Float32Array.from([...tri([-5, -5, 0], [5, 5, 10], [5, -5, 10]), ...tri([-5, -5, 0], [-5, 5, 0], [5, 5, 10])]));
    const e = renderDepth(east, lay(), GRID);
    expect(at(e.height, 10 + 4, 10)).toBeGreaterThan(at(e.height, 10 - 4, 10)); // +X is to the right: column x 14 is higher than x 6
  });
  it('rotation: 180 degrees about X turns it upside down; the lowest point is still height 0', () => {
    // the OPEN pyramid: a closed one would show its flat base from above (the top-most surface wins)
    const r = renderDepth(indexMesh(pyramid({ base: false })), lay({ rotation: { x: 180, y: 0, z: 0 } }), GRID);
    expect(at(r.height, 10, 10)).toBeCloseTo(0, 3);   // the old apex is now the lowest point
    expect(at(r.height, 10 + 4.5, 10)).toBeCloseTo(4 * (4.5 / 5), 2); // 4.5 of the 5 out to the base edge: 3.6 up
    const closed = renderDepth(PYR(), lay({ rotation: { x: 180, y: 0, z: 0 } }), GRID);
    expect(at(closed.height, 10, 10)).toBeCloseTo(4, 3); // closed: the base (now on top) hides the apex
    expect(rotationMatrix(0, 0, 0).map((v) => v + 0)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]); // (v + 0: -0 is 0)
  });
  it('both sides count: flipped winding gives the same depth', () => {
    const a = renderDepth(PYR(), lay(), GRID), b = renderDepth(indexMesh(pyramid({ flip: true })), lay(), GRID);
    expect(Array.from(b.covered)).toEqual(Array.from(a.covered));
    let worst = 0;
    for (let k = 0; k < a.height.length; k++) worst = Math.max(worst, Math.abs(a.height[k] - b.height[k]));
    expect(worst).toBeLessThan(1e-4); // float rounding only
  });
  it('an OPEN mesh (no base) renders without error and covers the same footprint', () => {
    const open = renderDepth(indexMesh(pyramid({ base: false })), lay(), GRID);
    expect(at(open.height, 10, 10)).toBeCloseTo(4, 4);
    expect(Array.from(open.covered)).toEqual(Array.from(renderDepth(PYR(), lay(), GRID).covered));
  });
});

// ── the pass ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('stlPass', () => {
  beforeEach(() => _resetStlCachesForTests());
  it('a record with only its mesh, id and unit reads every other field as the declared default (and is not written to)', () => {
    const raw = { id: 't1', mesh: encodeMesh(PYR()), unitIn: 1 };
    const frozen = JSON.stringify(raw);
    const p = stlPass(raw, GRID);
    expect(JSON.stringify(raw)).toBe(frozen);
    expect(p).toMatchObject({ id: 'stl:t1', kind: 'stl', blend: 'max', zOffset: 0, enabled: true, svg: '1', profile: 'flat' });
    expect(p.depth).toBeCloseTo(4, 3);
    expect(Math.max(...p.mask.body)).toBeCloseTo(1, 3); // 16-bit stored positions: ~6e-5 in
    expect(normaliseStlLayer({}).blend).toBe(STL_LAYER_DEFAULTS.blend);
  });
  it('carve is a negative depth; a disabled layer is no pass', () => {
    expect(stlPass(REC({ raise: false }), GRID).depth).toBeCloseTo(-4, 3);
    expect(stlPass(REC({ enabled: false }), GRID)).toBeNull();
    expect(stlPasses([], GRID)).toEqual([]);
    expect(stlPasses(undefined, GRID)).toEqual([]);
  });
  it('compression lifts the low parts and leaves 0 and 1 where they are', () => {
    expect(compressRelief(0.3, 0)).toBe(0.3);
    expect(compressRelief(0, 0.7)).toBe(0);
    expect(compressRelief(1, 0.7)).toBeCloseTo(1, 10);
    expect(compressRelief(0.3, 0.7)).toBeGreaterThan(0.3);
    const lin = stlPass(REC(), GRID), cmp = stlPass(REC({ compress: 0.7 }), GRID);
    const k = Math.round(10 / 0.5) * GRID.nx + Math.round(12.5 / 0.5);
    expect(cmp.mask.body[k]).toBeGreaterThan(lin.mask.body[k]);
  });
  it('softness spreads the footprint past the object\'s own edge', () => {
    const hard = stlPass(REC(), GRID), soft = stlPass(REC({ softness: 1 }), GRID);
    const sum = (a) => a.reduce((n, v) => n + v, 0);
    expect(sum(soft.mask.isStamped)).toBeGreaterThan(sum(hard.mask.isStamped));
  });
});

// ── stamped into the surface ────────────────────────────────────────────────────────────────────────────────────────
describe('applyStampLayers with an STL pass', () => {
  const flat = (z) => new Float32Array(GRID.nx * GRID.nz).fill(z);
  const run = (rec, base = 1) => applyStampLayers(flat(base), stlPasses([rec], GRID), GRID.nx, GRID.nz);
  it('Max: stands on the surface (Z offset 0); only its footprint changes', () => {
    const h = run(REC());
    expect(at(h, 10, 10)).toBeCloseTo(1 + 4, 3);
    expect(at(h, 10 + 6, 10)).toBe(1);
  });
  it('Max with a negative Z offset sinks it in: only the part above the surface shows, nothing dips', () => {
    const h = run(REC({ position: { x: 0, y: 0, z: -2 } }));
    expect(at(h, 10, 10)).toBeCloseTo(1 + 2, 3);          // apex 4 - 2 = 2 above the surface
    expect(at(h, 10 + 4, 10)).toBe(1);                    // low part (0.8 high) is buried: unchanged, not 1 - 1.2
    expect(Math.min(...h)).toBe(1);
  });
  it('Add with a negative Z offset digs a pit where the object is low', () => {
    const h = run(REC({ blend: 'add', position: { x: 0, y: 0, z: -2 } }));
    expect(at(h, 10, 10)).toBeCloseTo(1 + 4 - 2, 3);
    expect(at(h, 10 + 4, 10)).toBeLessThan(1);
  });
  it('Carve is the shape as a hollow', () => {
    const h = run(REC({ raise: false }));
    expect(at(h, 10, 10)).toBeCloseTo(1 - 4, 3);
  });
  it('a floating STL (positive Z) stamps as a raised lump, no clamp', () => {
    const h = run(REC({ position: { x: 0, y: 0, z: 1 } }));
    expect(at(h, 10 + 4.5, 10)).toBeGreaterThan(1 + 1); // base edge sits 1 above the surface
  });
  it('two STLs on Max: the higher wins in the overlap, in either order', () => {
    const a = REC({ id: 'a' }), b = REC({ id: 'b', position: { x: 2, y: 0, z: 0 }, zScale: 0.5 });
    const ab = applyStampLayers(flat(0), stlPasses([a, b], GRID), GRID.nx, GRID.nz);
    const ba = applyStampLayers(flat(0), stlPasses([b, a], GRID), GRID.nx, GRID.nz);
    expect(Array.from(ab)).toEqual(Array.from(ba));
  });
});

// ── joins the pass list ─────────────────────────────────────────────────────────────────────────────────────────────
describe('_collectStampPasses', () => {
  const saved = {};
  beforeEach(() => { Object.assign(saved, { w: P.widthIn, h: P.heightIn, s: P.stlLayers }); P.widthIn = GRID.widthIn; P.heightIn = GRID.heightIn; _resetStlCachesForTests(); });
  afterEach(() => { P.widthIn = saved.w; P.heightIn = saved.h; if (saved.s === undefined) delete P.stlLayers; else P.stlLayers = saved.s; delete window.svgEditor; });
  it('appends the STL passes after the editor layers\' passes, only when it is given the grid', () => {
    window.svgEditor = { _layers: [{ id: 'a', name: 'A', visible: true, carve: true, depth: 0.5, _mask: { body: new Float32Array(GRID.nx * GRID.nz), fillet: null, isStamped: null } }] };
    P.stlLayers = [REC({ id: 'x1' }), REC({ id: 'x2', enabled: false })];
    expect(_collectStampPasses().map((p) => p.id)).toEqual(['a']);
    expect(_collectStampPasses(GRID.nx, GRID.nz).map((p) => p.id)).toEqual(['a', 'stl:x1']);
  });
  it('totalStoredTris sums the stored triangles (the panel\'s size warning)', () => {
    expect(totalStoredTris([{ storedTris: 10 }, { mesh: { nt: 5 } }, null])).toBe(15);
  });
});

// ── import ──────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('createStlLayer / restoreAtDetail', () => {
  it('fits the STL to half the board, stores it capped, keeps the original for a higher re-store', () => {
    const board = { widthIn: 20, heightIn: 10 };
    const { record, original } = createStlLayer({ soup: gridSoup(60), name: 'tile', board, storedDetail: 1000 });
    expect(record.unitIn).toBeCloseTo((0.5 * 10) / 60, 8);
    expect(record.origTris).toBe(7200);
    expect(record.storedTris).toBeLessThanOrEqual(1000);
    expect(record.mesh.nt).toBe(record.storedTris);
    const up = restoreAtDetail(record, original, 3000);
    expect(up.storedTris).toBeGreaterThan(record.storedTris);
    expect(up.storedTris).toBeLessThanOrEqual(3000);
    expect(restoreAtDetail(record, original, 100000).storedTris).toBe(7200);
  });
});

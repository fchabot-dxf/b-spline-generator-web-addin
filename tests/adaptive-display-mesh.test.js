/**
 * F35 item 17 — adaptive DISPLAY mesh (core/preview/adaptive-mesh.js, wired through
 * terrain-mesh.js's buildSolidMesh + TerrainPreview.update via P.adaptiveDisplay).
 *
 * Pins: far fewer triangles on flat ground; every grid sample within the declared error of
 * the adaptive surface on a grooved field (and the mesh is a crack-free tiling of the grid);
 * OFF = the exact old index; the Send/STEP export path never reads it; and the 7x9 brick
 * benchmark at spacing 0.015 hits the 5x target (numbers logged for the report).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ADAPTIVE_DISPLAY, adaptiveGridIndices } from '../bspline-frame-builder/b-spline-gen/html/core/preview/adaptive-mesh.js';
import { buildHeightField, buildSolidMesh, adaptiveCapIndices } from '../bspline-frame-builder/b-spline-gen/html/core/preview/terrain-mesh.js';
import { COORD_SYSTEM } from '../bspline-frame-builder/b-spline-gen/html/core/coords.js';
import { resolveGrid } from '../bspline-frame-builder/b-spline-gen/html/core/terrain.js';
import { DEFAULT, P, updateP } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { brickPos } from './helpers/brick-field.js';

const src = (rel) => readFileSync(`bspline-frame-builder/b-spline-gen/html/${rel}`, 'utf8');
const T = ADAPTIVE_DISPLAY.maxErrorIn;

function flatPos(nx, nz, W = 4, H = 4, z = 0.3) {
  const pos = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = (j * nx + i) * 3;
    pos[k] = -W / 2 + (i / (nx - 1)) * W; pos[k + 1] = -H / 2 + (j / (nz - 1)) * H; pos[k + 2] = z;
  }
  return pos;
}

/** One straight 0.034 in-wide, 0.125 in-deep groove, diagonal-ish, on a gently tilted+curved board. */
function groovePos(nx, nz, W, H) {
  const pos = flatPos(nx, nz, W, H, 0);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = (j * nx + i) * 3, x = pos[k], y = pos[k + 1];
    const d = Math.abs(0.8 * x - 0.6 * y - 0.13); // distance to the groove centreline
    pos[k + 2] = 0.05 * x + 0.3 * Math.cos(x / W * 2) * Math.cos(y / H * 2) - (d < 0.017 ? 0.125 : 0);
  }
  return pos;
}

/** Max |z_sample - z_mesh| over every grid sample, + coverage/conformity facts, for one cap. */
function inspect(pos, idx, nx, nz, base = 0) {
  const g = (v) => [(v - base) % nx, Math.floor((v - base) / nx)];
  const covered = new Uint8Array(nx * nz);
  let maxErr = 0, area = 0, badWinding = 0;
  const edges = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const tri = [idx[t], idx[t + 1], idx[t + 2]];
    const [[ax, ay], [bx, by], [cx, cy]] = tri.map(g);
    const cr = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (cr <= 0) badWinding++;
    area += Math.abs(cr) / 2;
    for (let e = 0; e < 3; e++) {
      const p = tri[e], q = tri[(e + 1) % 3];
      const key = `${p},${q}`;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
    for (let y = Math.min(ay, by, cy); y <= Math.max(ay, by, cy); y++) {
      for (let x = Math.min(ax, bx, cx); x <= Math.max(ax, bx, cx); x++) {
        const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / cr;
        const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / cr;
        const w = 1 - u - v;
        if (u < -1e-9 || v < -1e-9 || w < -1e-9) continue;
        covered[y * nx + x] = 1;
        const z = u * pos[tri[0] * 3 + 2] + v * pos[tri[1] * 3 + 2] + w * pos[tri[2] * 3 + 2];
        maxErr = Math.max(maxErr, Math.abs(z - pos[(base + y * nx + x) * 3 + 2]));
      }
    }
  }
  // Conformity: every directed edge used once; an edge with no reverse twin must be a unit
  // boundary edge (no T-junction / crack anywhere inside, full-res boundary).
  let tJunctions = 0;
  for (const key of edges.keys()) {
    const [p, q] = key.split(',').map(Number);
    if (edges.get(key) !== 1) tJunctions++;
    if (edges.has(`${q},${p}`)) continue;
    const [px, py] = g(p), [qx, qy] = g(q);
    const onB = (px === qx && (px === 0 || px === nx - 1)) || (py === qy && (py === 0 || py === nz - 1));
    if (!onB || Math.abs(px - qx) + Math.abs(py - qy) !== 1) tJunctions++;
  }
  const uncovered = covered.length - covered.reduce((s, v) => s + v, 0);
  return { maxErr, area, badWinding, tJunctions, uncovered };
}

function mockTHREE() {
  class BufferGeometry {
    constructor() { this.attributes = {}; this.index = null; this.userData = {}; }
    setAttribute(n, a) { this.attributes[n] = a; }
    setIndex(i) { this.index = i; }
    computeVertexNormals() {}
  }
  return {
    BufferGeometry,
    BufferAttribute: class { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; } },
    MeshPhongMaterial: class { constructor(o) { Object.assign(this, o); } },
    Mesh: class { constructor(g, m) { this.geometry = g; this.material = m; } },
  };
}

describe('adaptiveGridIndices (F35 item 17)', () => {
  it('declares its error threshold as data', () => {
    expect(ADAPTIVE_DISPLAY.maxErrorIn).toBe(0.002);
    expect(Object.isFrozen(ADAPTIVE_DISPLAY)).toBe(true);
  });

  it('a flat field collapses to far fewer triangles than the regular grid', () => {
    for (const [nx, nz] of [[101, 101], [120, 77], [65, 129]]) {
      const pos = flatPos(nx, nz);
      const idx = adaptiveGridIndices(pos, nx, nz);
      const regular = 2 * (nx - 1) * (nz - 1);
      expect(idx.length / 3).toBeLessThan(regular / 8);
      const r = inspect(pos, idx, nx, nz);
      expect(r).toMatchObject({ maxErr: 0, badWinding: 0, tJunctions: 0, uncovered: 0, area: (nx - 1) * (nz - 1) });
    }
  });

  it('a 0.034 in groove: every sample within the threshold, crack-free, groove kept', () => {
    for (const [W, H, sp] of [[7, 9, 0.03], [5, 3, 0.02]]) {
      const { nx, nz } = resolveGrid(W, H, sp);
      const pos = groovePos(nx, nz, W, H);
      const idx = adaptiveGridIndices(pos, nx, nz);
      const r = inspect(pos, idx, nx, nz);
      expect(r.maxErr).toBeLessThanOrEqual(T + 1e-7);
      expect(r).toMatchObject({ badWinding: 0, tJunctions: 0, uncovered: 0, area: (nx - 1) * (nz - 1) });
      expect(idx.length / 3).toBeLessThan(2 * (nx - 1) * (nz - 1)); // and it did simplify
    }
  });

  it('a larger threshold simplifies more; error stays under each threshold', () => {
    const { nx, nz } = resolveGrid(7, 9, 0.05);
    const pos = brickPos(7, 9, nx, nz, { domeIn: 0.5 });
    let prev = Infinity;
    for (const maxError of [0.0005, 0.002, 0.01]) {
      const idx = adaptiveGridIndices(pos, nx, nz, { maxError });
      expect(inspect(pos, idx, nx, nz).maxErr).toBeLessThanOrEqual(maxError + 1e-7);
      expect(idx.length).toBeLessThanOrEqual(prev);
      prev = idx.length;
    }
  });
});

describe('buildSolidMesh adaptive caps', () => {
  const nx = 41, nz = 53, W = 4, H = 5;
  const top = brickPos(W, H, nx, nz, { domeIn: 0.2 });
  const bot = new Float32Array(top.length);
  for (let k = 0; k < top.length; k += 3) { bot[k] = top[k] * 0.999; bot[k + 1] = top[k + 1]; bot[k + 2] = -0.5; }

  it('OFF = the exact old index (top cap + bottom cap + walls)', () => {
    const mesh = buildSolidMesh(mockTHREE(), top, bot, nx, nz, {});
    const count = nx * nz, B = COORD_SYSTEM.gridBoundaryIndices(nx, nz).length, side = count * 2;
    const old = COORD_SYSTEM.gridQuadFaceIndices(nx, nz, 0, false).concat(COORD_SYSTEM.gridQuadFaceIndices(nx, nz, count, true));
    for (let i = 0; i < B; i++) {
      const n = (i + 1) % B;
      old.push(side + i, side + B + i, side + n, side + n, side + B + i, side + B + n);
    }
    expect(mesh.geometry.index).toEqual(old);
    expect(mesh.geometry.userData.adaptiveCaps).toBeUndefined();
    // and the top-only path's regular index is untouched too
    expect(buildHeightField(new Float32Array(nx * nz), nx, nz, W, H).indices).toEqual(COORD_SYSTEM.gridQuadFaceIndices(nx, nz));
  });

  it('ON = same vertices, fewer cap triangles, identical walls, both caps within threshold', () => {
    const THREE = mockTHREE();
    const off = buildSolidMesh(THREE, top, bot, nx, nz, {});
    const on = buildSolidMesh(THREE, top, bot, nx, nz, { adaptiveMaxError: T });
    expect(on.geometry.attributes.position.array).toEqual(off.geometry.attributes.position.array);
    const caps = on.geometry.userData.adaptiveCaps;
    expect(caps).toEqual(adaptiveCapIndices(on.geometry.attributes.position.array, nx, nz, T));
    const regularCaps = 4 * (nx - 1) * (nz - 1) * 3;
    expect(caps.length).toBeLessThan(regularCaps);
    expect(on.geometry.index.slice(caps.length)).toEqual(off.geometry.index.slice(regularCaps)); // walls
    const pos = on.geometry.attributes.position.array;
    const count = nx * nz;
    const split = caps.findIndex((v) => v >= count); // top cap first, then the bottom cap
    const topIdx = caps.slice(0, split), botIdx = caps.slice(split);
    expect(split % 3).toBe(0);
    expect(inspect(pos, topIdx, nx, nz).maxErr).toBeLessThanOrEqual(T + 1e-7);
    // bottom cap winds the other way (faces down): flip for the inspector, then same checks
    const botFlipped = [];
    for (let t = 0; t < botIdx.length; t += 3) botFlipped.push(botIdx[t], botIdx[t + 2], botIdx[t + 1]);
    expect(inspect(pos, botFlipped, nx, nz, count)).toMatchObject({ badWinding: 0, tJunctions: 0, uncovered: 0 });
  });
});

describe('P.adaptiveDisplay wiring + export path', () => {
  it('is a declared boolean, default off, bound to the #adaptiveDisplay checkbox next to #spacing', () => {
    expect(DEFAULT.adaptiveDisplay).toBe(false);
    const was = P.adaptiveDisplay;
    updateP('adaptiveDisplay', 1);
    expect(P.adaptiveDisplay).toBe(true);
    updateP('adaptiveDisplay', was);
    const html = src('bspline_gen_palette.html');
    const at = html.indexOf('id="spacing"');
    const cb = html.indexOf('<input type="checkbox" id="adaptiveDisplay">');
    expect(at).toBeGreaterThan(0);
    expect(cb).toBeGreaterThan(at);
    expect(cb - at).toBeLessThan(800);
  });

  it('both preview.update calls pass P.adaptiveDisplay', () => {
    expect(src('core/engine/rebuild.js').match(/P\.flatShading, P\.adaptiveDisplay,/g)).toHaveLength(2);
  });

  it('the Send/STEP export path never reads it', () => {
    for (const rel of ['main/export-flow.js', 'core/stepWriter.js']) {
      const s = src(rel);
      expect(s.includes('adaptive-mesh')).toBe(false);
    }
    expect(src('main/export-flow.js').includes('adaptiveDisplay')).toBe(false);
    expect(src('core/stepWriter.js').includes('adaptiveDisplay')).toBe(false);
  });
});

describe('benchmark: grooved 7x9 brick field at spacing 0.015', () => {
  it('adaptive is 5x+ fewer triangles (numbers logged)', () => {
    const { nx, nz } = resolveGrid(7, 9, 0.015);
    for (const domeIn of [0, 0.25]) {
      const pos = brickPos(7, 9, nx, nz, { domeIn });
      const h = new Float32Array(nx * nz);
      for (let k = 0; k < h.length; k++) h[k] = pos[k * 3 + 2];
      const best = (f) => { let b = Infinity, r; for (let n = 0; n < 3; n++) { const t0 = performance.now(); r = f(); b = Math.min(b, performance.now() - t0); } return [b, r]; };
      const [tReg, field] = best(() => buildHeightField(h, nx, nz, 7, 9));
      const [tAd, idx] = best(() => adaptiveGridIndices(field.pos, nx, nz));
      const reg = field.indices.length / 3, ad = idx.length / 3;
      console.log(`[F35-17 bench] 7x9 @0.015 grid ${nx}x${nz} dome=${domeIn}: regular ${reg} tris ${tReg.toFixed(1)} ms | adaptive ${ad} tris ${(tReg + tAd).toFixed(1)} ms (index +${tAd.toFixed(1)} ms) -> ${(reg / ad).toFixed(2)}x fewer`);
      expect(reg / ad).toBeGreaterThanOrEqual(5);
    }
  });
});

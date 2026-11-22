/**
 * STL-CROP worker R (Fred 2026-11-22, decisions A-C): CROP is a real cut. core/stl/crop.js cropMesh(mesh, box) cuts the mesh to a box
 * given as FRACTIONS of the mesh's own bounding box ({ x: [min, max], y, z } in 0..1) and CAPS each cut flat (the plane's cut
 * segments chained into loops and ear-clipped by the shared triangulator of core/preview/frame-mesh.js). An open mesh leaves open
 * loops: counted, never a crash. Real welded meshes (core/stl/mesh.js indexMesh), no mocks.
 */
import { describe, it, expect } from 'vitest';
import { indexMesh, meshBounds } from '../bspline-frame-builder/b-spline-gen/html/core/stl/mesh.js';
import { cropMesh, soupOfMesh, isFullCropBox } from '../bspline-frame-builder/b-spline-gen/html/core/stl/crop.js';

// â”€â”€ shapes (outward winding fixed per triangle against a known inside point) â”€â”€
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crossV = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Triangles [[a, b, c], ...] -> a soup, each wound so its normal points away from `inside`. */
function soupOut(tris, inside) {
  const out = [];
  for (const [a, b, c] of tris) {
    const n = crossV(sub(b, a), sub(c, a));
    const cen = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    out.push(...(dot(n, sub(cen, inside)) >= 0 ? [...a, ...b, ...c] : [...a, ...c, ...b]));
  }
  return Float32Array.from(out);
}
/** An axis-aligned box [x0,x1] x [y0,y1] x [z0,z1], each face split into n x n quads (n = 1: 12 triangles). */
function boxSoup([x0, y0, z0], [x1, y1, z1], n = 1) {
  const tris = [];
  const L = (a, b, t) => a + (b - a) * t;
  const face = (P) => { for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const p = (u, v) => P(u / n, v / n);
    tris.push([p(i, j), p(i + 1, j), p(i + 1, j + 1)], [p(i, j), p(i + 1, j + 1), p(i, j + 1)]);
  } };
  face((u, v) => [L(x0, x1, u), L(y0, y1, v), z0]); face((u, v) => [L(x0, x1, u), L(y0, y1, v), z1]);
  face((u, v) => [L(x0, x1, u), y0, L(z0, z1, v)]); face((u, v) => [L(x0, x1, u), y1, L(z0, z1, v)]);
  face((u, v) => [x0, L(y0, y1, u), L(z0, z1, v)]); face((u, v) => [x1, L(y0, y1, u), L(z0, z1, v)]);
  return soupOut(tris, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]);
}
/** A UV sphere of radius r: `lat` bands, `lon` segments (multiples of 4 put a vertex at +-r on every axis). */
function sphereSoup(r, lat, lon) {
  const P = (i, j) => {
    if (i === 0) return [0, 0, r];
    if (i === lat) return [0, 0, -r];
    const th = (Math.PI * i) / lat, ph = (2 * Math.PI * (j % lon)) / lon; // the seam welds
    return [r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)];
  };
  const tris = [];
  for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) {
    const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
    if (i > 0) tris.push([a, b, d]);
    if (i < lat - 1) tris.push([b, c, d]);
  }
  return soupOut(tris, [0, 0, 0]);
}
function edgeUse(mesh) {
  const m = new Map();
  const { indices } = mesh;
  for (let t = 0; t < indices.length; t += 3) {
    for (const [u, v] of [[indices[t], indices[t + 1]], [indices[t + 1], indices[t + 2]], [indices[t + 2], indices[t]]]) {
      const k = u < v ? `${u},${v}` : `${v},${u}`;
      m.set(k, (m.get(k) || 0) + 1);
    }
  }
  return m;
}
const closed = (mesh) => [...edgeUse(mesh).values()].every((n) => n === 2);
/** Every directed edge once and its reverse once: one consistent winding. */
function consistent(mesh) {
  const d = new Map();
  const { indices } = mesh;
  for (let t = 0; t < indices.length; t += 3) {
    for (const [u, v] of [[indices[t], indices[t + 1]], [indices[t + 1], indices[t + 2]], [indices[t + 2], indices[t]]]) d.set(`${u},${v}`, (d.get(`${u},${v}`) || 0) + 1);
  }
  for (const [k, n] of d) { const [u, v] = k.split(','); if (n !== 1 || d.get(`${v},${u}`) !== 1) return false; }
  return true;
}
function volume(mesh) {
  const p = mesh.positions, ix = mesh.indices;
  let v = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const a = [p[ix[t] * 3], p[ix[t] * 3 + 1], p[ix[t] * 3 + 2]], b = [p[ix[t + 1] * 3], p[ix[t + 1] * 3 + 1], p[ix[t + 1] * 3 + 2]], c = [p[ix[t + 2] * 3], p[ix[t + 2] * 3 + 1], p[ix[t + 2] * 3 + 2]];
    v += dot(a, crossV(b, c)) / 6;
  }
  return v;
}
const box = (x, y, z) => ({ x, y, z });

describe('R1. cropMesh on a closed cube', () => {
  it('[0.25, 0.75]^3 of the unit cube -> a closed, consistently wound cube of half the side: volume 1/8, every vertex inside the box', () => {
    const cube = indexMesh(boxSoup([0, 0, 0], [1, 1, 1]));
    const r = cropMesh(cube, box([0.25, 0.75], [0.25, 0.75], [0.25, 0.75]));
    expect(r.openLoops).toBe(0);
    expect(r.capped).toBeGreaterThan(0);
    expect(closed(r.mesh)).toBe(true);
    expect(consistent(r.mesh)).toBe(true);
    expect(volume(r.mesh)).toBeCloseTo(1 / 8, 6);
    const b = meshBounds(r.mesh.positions);
    for (let a = 0; a < 3; a++) { expect(b.min[a]).toBeCloseTo(0.25, 6); expect(b.max[a]).toBeCloseTo(0.75, 6); }
  });
  it('a cube made of a 4 x 4 grid per face, cut through its middle on one axis: closed, half the volume', () => {
    const cube = indexMesh(boxSoup([-2, -2, -2], [2, 2, 2], 4));
    const r = cropMesh(cube, box([0, 1], [0, 1], [0.6, 1]));
    expect(closed(r.mesh)).toBe(true);
    expect(consistent(r.mesh)).toBe(true);
    expect(volume(r.mesh)).toBeCloseTo(64 * 0.4, 4);
    expect(r.capped).toBe(1);
  });
  it('the full box [0,1]^3 (and an absent axis) gives the SAME mesh object: nothing is cut', () => {
    const cube = indexMesh(boxSoup([0, 0, 0], [1, 1, 1]));
    for (const b of [box([0, 1], [0, 1], [0, 1]), {}, { x: [0, 1] }]) {
      const r = cropMesh(cube, b);
      expect(r.mesh).toBe(cube);
      expect(r).toMatchObject({ capped: 0, openLoops: 0 });
      expect(isFullCropBox(b)).toBe(true);
    }
    expect(isFullCropBox(box([0, 1], [0, 0.9], [0, 1]))).toBe(false);
  });
});

describe('R2. a sphere: the caps close it again', () => {
  it('cut on all three axes, every edge is shared by exactly two triangles and every vertex lies inside the box', () => {
    const s = indexMesh(sphereSoup(10, 12, 24));
    const fr = box([0.1, 0.8], [0.3, 1], [0, 0.55]);
    const r = cropMesh(s, fr);
    expect(r.openLoops).toBe(0);
    expect(closed(r.mesh)).toBe(true);
    expect(consistent(r.mesh)).toBe(true);
    expect(volume(r.mesh)).toBeGreaterThan(0);
    const lo = [-10 + 20 * 0.1, -10 + 20 * 0.3, -10], hi = [-10 + 20 * 0.8, 10, -10 + 20 * 0.55];
    const p = r.mesh.positions;
    for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a++) { expect(p[i + a]).toBeGreaterThanOrEqual(lo[a] - 1e-4); expect(p[i + a]).toBeLessThanOrEqual(hi[a] + 1e-4); }
    expect(soupOfMesh(r.mesh).length).toBe(r.mesh.indices.length * 3);
  });
  it('a hollow sphere (two shells) cut through the middle: the cap is a RING (the hole is left open), the result is closed', () => {
    const outer = sphereSoup(10, 12, 24), inner = sphereSoup(6, 12, 24);
    // the inner shell faces INWARD (a hollow ball): flip each of its triangles
    for (let t = 0; t < inner.length; t += 9) for (let k = 0; k < 3; k++) { const v = inner[t + 3 + k]; inner[t + 3 + k] = inner[t + 6 + k]; inner[t + 6 + k] = v; }
    const s = indexMesh(Float32Array.from([...outer, ...inner]));
    const r = cropMesh(s, box([0, 1], [0, 1], [0.5, 1]));
    expect(closed(r.mesh)).toBe(true);
    expect(consistent(r.mesh)).toBe(true);
    const full = volume(s);
    expect(volume(r.mesh)).toBeCloseTo(full / 2, 3); // the ring cap does not fill the hollow
  });
});

describe('R3. an open mesh', () => {
  it('a flat sheet cut on X: no crash, two open loops counted, the kept part is the middle', () => {
    const tris = [];
    const n = 6;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const p = (a, b) => [a, b, 0];
      tris.push([p(i, j), p(i + 1, j), p(i + 1, j + 1)], [p(i, j), p(i + 1, j + 1), p(i, j + 1)]);
    }
    const sheet = indexMesh(Float32Array.from(tris.flat(2)));
    const r = cropMesh(sheet, box([0.25, 0.75], [0, 1], [0, 1]));
    expect(r.openLoops).toBe(2);
    expect(r.capped).toBe(0);
    const b = meshBounds(r.mesh.positions);
    expect(b.min[0]).toBeCloseTo(1.5, 6);
    expect(b.max[0]).toBeCloseTo(4.5, 6);
    expect(b.max[1]).toBeCloseTo(6, 6);
  });
});

describe('R4. fractions are of the mesh\'s OWN bounding box', () => {
  it('the same fractional box keeps the same region of a low-detail and a high-detail copy of one sphere', () => {
    const fr = box([0.2, 0.9], [0, 0.6], [0.35, 1]);
    const lo = cropMesh(indexMesh(sphereSoup(5, 8, 16)), fr), hi = cropMesh(indexMesh(sphereSoup(5, 32, 64)), fr);
    const bl = meshBounds(lo.mesh.positions), bh = meshBounds(hi.mesh.positions);
    // the cut planes are the same: x 0.2 -> -3, y 0.6 -> +1, z 0.35 -> -1.5 (both copies span -5..5 on every axis)
    expect(bl.min[0]).toBeCloseTo(-3, 5); expect(bh.min[0]).toBeCloseTo(-3, 5);
    expect(bl.max[1]).toBeCloseTo(1, 5); expect(bh.max[1]).toBeCloseTo(1, 5);
    expect(bl.min[2]).toBeCloseTo(-1.5, 5); expect(bh.min[2]).toBeCloseTo(-1.5, 5);
    expect(hi.mesh.indices.length).toBeGreaterThan(lo.mesh.indices.length);
    expect(closed(lo.mesh) && closed(hi.mesh)).toBe(true);
  });
  it('a box offset from the origin: the planes sit at min + f * size on each axis', () => {
    const m = indexMesh(boxSoup([10, -4, 2], [14, 6, 3]));
    const r = cropMesh(m, box([0.5, 1], [0, 0.1], [0, 1]));
    const b = meshBounds(r.mesh.positions);
    expect([b.min[0], b.max[0], b.min[1], b.max[1], b.min[2], b.max[2]].map((v) => +v.toFixed(5))).toEqual([12, 14, -4, -3, 2, 3]);
    expect(volume(r.mesh)).toBeCloseTo(2 * 1 * 1, 5);
  });
});

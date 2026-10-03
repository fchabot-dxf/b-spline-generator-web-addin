/**
 * Test helpers for the frame's 3D geometry (F8 BLOCKER): a FakeTHREE, a carved
 * panel built by the REAL buildSolidMesh with a normal-offset underside (as the
 * app's thicken step makes it: its vertices leave the x,y grid), and a lookup
 * of the DRAWN faces of built meshes, written independently of the app's own
 * panelSurface so a check against it is not the code checking itself.
 */
import { buildHeightField, buildSolidMesh } from '../../bspline-frame-builder/b-spline-gen/html/core/preview/terrain-mesh.js';

class Attr { constructor(arr, n) { this.array = arr instanceof Float32Array ? arr : Float32Array.from(arr); this.itemSize = n; } }
export const FakeTHREE = {
  DoubleSide: 2, FrontSide: 0,
  BufferGeometry: class {
    constructor() { this.attributes = {}; this.index = null; this.userData = {}; }
    setAttribute(k, a) { this.attributes[k] = a; }
    setIndex(ix) { this.index = { array: Array.isArray(ix) ? ix : Array.from(ix) }; }
    computeVertexNormals() {}
    dispose() {} // H23 item 67: TerrainPreview._clearFrameMeshes calls this on teardown
  },
  BufferAttribute: Attr, Float32BufferAttribute: Attr,
  Mesh: class { constructor(g, m) { this.geometry = g; this.material = m; } },
  // H23 item 67: real THREE.js wraps a numeric `specular` (e.g. buildSolidMesh's own 0x111111)
  // into a Color instance with its own .clone() -- mirrored here so code that calls
  // material.specular.clone() (the drape overlay's own material recipe, core/preview/index.js)
  // works against a mesh built through this fake too, not just a hand-crafted mock material.
  Color: class { constructor(hex) { this.hex = hex; } clone() { return new FakeTHREE.Color(this.hex); } },
  MeshPhongMaterial: class {
    constructor(o) {
      Object.assign(this, o);
      if (typeof this.specular === 'number') this.specular = new FakeTHREE.Color(this.specular);
    }
    clone() { return new FakeTHREE.MeshPhongMaterial({ ...this }); }
    dispose() {} // H23 item 67: TerrainPreview._clearFrameMeshes calls this on teardown
  },
};

export const PANEL_COLOUR = [0.6, 0.5, 0.3];

/** Top z = f(x, y) on an nx x nz grid; underside = top offset along the surface
 *  normal by `thick`. */
export function carvedPanel(W, H, nx, nz, f, thick) {
  const heights = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) heights[j * nx + i] = f(-W / 2 + (i / (nx - 1)) * W, -H / 2 + (j / (nz - 1)) * H);
  const { pos, uvs } = buildHeightField(heights, nx, nz, W, H);
  const off = new Float32Array(pos.length), e = 1e-4, colours = new Float32Array(nx * nz * 3);
  for (let k = 0; k < nx * nz; k++) {
    const x = pos[k * 3], y = pos[k * 3 + 1];
    const gx = (f(x + e, y) - f(x - e, y)) / (2 * e), gy = (f(x, y + e) - f(x, y - e)) / (2 * e), l = Math.hypot(gx, gy, 1);
    off[k * 3] = x + (gx / l) * thick; off[k * 3 + 1] = y + (gy / l) * thick; off[k * 3 + 2] = pos[k * 3 + 2] - thick / l;
    colours.set(PANEL_COLOUR, k * 3);
  }
  // H23 item 67: real boards always carry a uv attribute (index.js's own buildSolidMesh call
  // passes topUvs: field.uvs) -- the edgeSampler colouring reads attrs.uv the same way attrs.color
  // is read, so this helper needs to supply it too, or every wall-colour test would (silently)
  // never reach the sampler path at all.
  const mesh = buildSolidMesh(FakeTHREE, pos, off, nx, nz, { topColours: colours, topUvs: uvs });
  // the whole solid as drawn before any trim (top, underside, side walls)
  const solid = { geometry: { attributes: mesh.geometry.attributes, index: { array: Array.from(mesh.geometry.index.array) } } };
  return { mesh, solid, grid: { W, H, nx, nz, topPos: pos, botPos: off } };
}

/** z of every drawn triangle of `meshes` above/below (x, y), bucketed on a 0.1 in grid. */
export function drawnFaces(meshes) {
  const B = 0.1, tris = [], buckets = new Map();
  for (const m of meshes) {
    const P = m.geometry.attributes.position.array, I = m.geometry.index.array;
    for (let t = 0; t < I.length; t += 3) {
      const v = [I[t], I[t + 1], I[t + 2]].map((k) => [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]]);
      const id = tris.push(v) - 1;
      const xs = v.map((q) => q[0]), ys = v.map((q) => q[1]);
      for (let i = Math.floor(Math.min(...xs) / B - 1e-9); i <= Math.floor(Math.max(...xs) / B + 1e-9); i++) {
        for (let j = Math.floor(Math.min(...ys) / B - 1e-9); j <= Math.floor(Math.max(...ys) / B + 1e-9); j++) {
          const k = `${i},${j}`;
          if (!buckets.has(k)) buckets.set(k, []);
          buckets.get(k).push(id);
        }
      }
    }
  }
  return (x, y) => {
    const out = [];
    for (const id of buckets.get(`${Math.floor(x / B)},${Math.floor(y / B)}`) || []) {
      const [a, b, c] = tris[id];
      const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(d) < 1e-14) continue;
      const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d;
      const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d;
      if (u >= -1e-7 && v >= -1e-7 && 1 - u - v >= -1e-7) out.push(u * a[2] + v * b[2] + (1 - u - v) * c[2]);
    }
    return out;
  };
}

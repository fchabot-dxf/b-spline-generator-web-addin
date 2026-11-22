/**
 * stl/ghost.js -- STL-RELIEF (STL-RELIEF-DESIGN.md, slice 2): the STL as a GHOST on the board in the 3D view, colour coded by how it
 * sits in the surface. Pure array math (the THREE mesh is built in core/preview/index.js setStlGhosts from what this returns).
 *
 * Colour per vertex (one declared table, STL_GHOST_COLOURS -- change a colour in ONE place):
 *   shows       the object stands above the surface here (Z offset + its height > 0): this part will be in the relief
 *   buried      below the surface: with Max blend it vanishes (with Add it digs a pit)
 *   meets       within STL_MEET_BAND_IN of the surface: the band where the STL meets the surface (the intersection)
 *   overhang    above the surface, the face looks DOWN: a top-down stamp loses it
 *   open        an open edge of the mesh (a hole): shows as a pit in the relief
 *
 * The ghost is a RIGID copy placed on the surface height under its centre (the surface BEFORE the stamps, ghostSurface: never
 * on top of its own relief); the stamp itself is relative per point (the object
 * follows the surface), so on a strongly curved board the ghost is the honest first look, the Stamp result is the truth.
 */
import { decodeMesh } from './mesh.js';
import { placeMesh } from './raster.js';
import { normaliseStlLayer, recordStlError, stlErrorId } from './layer.js';

export const STL_GHOST_COLOURS = Object.freeze({
  shows: [0.25, 0.75, 0.35],
  buried: [0.3, 0.45, 0.85],
  meets: [1.0, 0.9, 0.2],
  overhang: [0.95, 0.6, 0.15],
  open: [0.9, 0.2, 0.2],
});
export const STL_MEET_BAND_IN = 0.03;
export const STL_OVERHANG_NZ = -0.05; // a face normal pointing this far down is an overhang

/**
 * The surface height at scene (x, y), bilinear; clamped to the board. The grid is buildHeightField's own
 * (core/preview/terrain-mesh.js): column i at x = -W/2 + i*dx, row j at y = -H/2 + j*dy (row 0 = the bottom, +y = a larger row).
 */
export function surfaceAt(heights, grid, x, y) {
  const { nx, nz, widthIn, heightIn } = grid;
  const fi = Math.min(nx - 1, Math.max(0, ((x + widthIn / 2) / widthIn) * (nx - 1)));
  const fj = Math.min(nz - 1, Math.max(0, ((y + heightIn / 2) / heightIn) * (nz - 1)));
  const i0 = Math.floor(fi), j0 = Math.floor(fj), i1 = Math.min(nx - 1, i0 + 1), j1 = Math.min(nz - 1, j0 + 1);
  const ti = fi - i0, tj = fj - j0;
  const h = (i, j) => heights[j * nx + i];
  return (h(i0, j0) * (1 - ti) + h(i1, j0) * ti) * (1 - tj) + (h(i0, j1) * (1 - ti) + h(i1, j1) * ti) * tj;
}

/** 1 per vertex that lies on an edge used by exactly one triangle. */
export function openEdgeVertices(mesh) {
  const nv = mesh.positions.length / 3;
  const use = new Map();
  const key = (a, b) => (a < b ? a * nv + b : b * nv + a);
  const { indices } = mesh;
  for (let t = 0; t < indices.length; t += 3) {
    for (const [u, v] of [[indices[t], indices[t + 1]], [indices[t + 1], indices[t + 2]], [indices[t + 2], indices[t]]]) {
      const k = key(u, v); use.set(k, (use.get(k) || 0) + 1);
    }
  }
  const flag = new Uint8Array(nv);
  for (const [k, n] of use) if (n === 1) { const a = Math.floor(k / nv); flag[a] = 1; flag[k - a * nv] = 1; }
  return flag;
}

/**
 * The INTERSECTION LINE: where the ghost meets the surface, the rel = 0 contour of its triangles (marching triangles).
 * `rel[v]` = how far vertex v stands above (+) or below (-) the surface it is stamped into (Z offset + its placed height, the
 * value ghostGeometry colours by). A vertex counts as ABOVE when rel > 0 (so a vertex exactly on the surface is "not above"):
 * a triangle with vertices on both sides is crossed by exactly two of its edges, and the segment joins the two crossings
 * (linear interpolation of the scene `positions`, so the points lie at the ghost's own z for rel = 0). A base resting exactly
 * on the surface (rel = 0) yields its outline through the side faces; a zero-length segment (a triangle touching 0 at a single
 * vertex) is skipped.
 * @returns {Float32Array} segment endpoints, 6 floats per segment (x0, y0, z0, x1, y1, z1), scene coordinates
 */
export function meetLine(positions, rel, indices) {
  const out = [];
  const cross = (u, v) => {
    const t = (0 - rel[u]) / (rel[v] - rel[u]);
    return [0, 1, 2].map((k) => positions[u * 3 + k] + t * (positions[v * 3 + k] - positions[u * 3 + k]));
  };
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [indices[t], indices[t + 1], indices[t + 2]];
    const up = tri.map((v) => rel[v] > 0);
    if (up[0] === up[1] && up[1] === up[2]) continue;
    const pts = [];
    for (let e = 0; e < 3; e++) {
      const u = tri[e], v = tri[(e + 1) % 3];
      if (up[e] !== up[(e + 1) % 3]) pts.push(cross(u, v));
    }
    const [a, b] = pts;
    if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) continue;
    out.push(...a, ...b);
  }
  return Float32Array.from(out);
}

/**
 * @param rec     an STL layer record
 * @param heights the surface it sits on: the board's heights BEFORE the stamps (ghostSurface), or null (it then sits on z = 0)
 * @param grid    { nx, nz, widthIn, heightIn }
 * @returns {{ id, positions: Float32Array, indices: Uint32Array, colours: Float32Array, counts: {shows, buried, meets, overhang, open},
 *   meetLine: Float32Array, place: { x, y, z, rotZ, baseZ } }}  id = the record's id (the placement gizmo picks a ghost by it);
 *   place = the record's position / rotation.z and the surface height under its centre (the gizmo's pivot and start values)
 */
export function ghostGeometry(rawRec, heights, grid) {
  const rec = normaliseStlLayer(rawRec);
  const mesh = decodeMesh(rec.mesh);
  const { xyz } = placeMesh(mesh, rec);
  const nv = xyz.length / 3;
  const baseZ = heights ? surfaceAt(heights, grid, rec.position.x, rec.position.y) : 0;
  const zOff = rec.position.z;
  // per-vertex normals (area-weighted face normals, outward by the STL's own winding), in the PLACED frame
  const nrm = new Float64Array(nv * 3);
  const idx = mesh.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = xyz[b] - xyz[a], uy = xyz[b + 1] - xyz[a + 1], uz = xyz[b + 2] - xyz[a + 2];
    const vx = xyz[c] - xyz[a], vy = xyz[c + 1] - xyz[a + 1], vz = xyz[c + 2] - xyz[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    for (const v of [idx[t], idx[t + 1], idx[t + 2]]) { nrm[v * 3] += fx; nrm[v * 3 + 1] += fy; nrm[v * 3 + 2] += fz; }
  }
  const open = openEdgeVertices(mesh);
  const positions = new Float32Array(nv * 3);
  const colours = new Float32Array(nv * 3);
  const counts = { shows: 0, buried: 0, meets: 0, overhang: 0, open: 0 };
  const C = STL_GHOST_COLOURS;
  const rels = new Float64Array(nv);
  for (let v = 0; v < nv; v++) {
    const rel = zOff + xyz[v * 3 + 2]; // above (+) or below (-) the surface it is stamped into
    rels[v] = rel;
    positions[v * 3] = xyz[v * 3]; positions[v * 3 + 1] = xyz[v * 3 + 1]; positions[v * 3 + 2] = baseZ + rel;
    let kind = rel > 0 ? 'shows' : 'buried';
    if (Math.abs(rel) <= STL_MEET_BAND_IN) kind = 'meets';
    const len = Math.hypot(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
    if (len > 0 && nrm[v * 3 + 2] / len < STL_OVERHANG_NZ && kind === 'shows') kind = 'overhang'; // only ABOVE the surface: an underside on / in it is just the base
    if (open[v]) kind = 'open';
    counts[kind]++;
    colours[v * 3] = C[kind][0]; colours[v * 3 + 1] = C[kind][1]; colours[v * 3 + 2] = C[kind][2];
  }
  return {
    id: rec.id, positions, indices: mesh.indices, colours, counts,
    meetLine: meetLine(positions, rels, mesh.indices),
    place: { x: rec.position.x, y: rec.position.y, z: zOff, rotZ: rec.rotation.z, baseZ },
  };
}

/** Ghost state (UI-only, never saved): the ghosts show while this is true. */
export const ghostState = { visible: true };

/**
 * The surface a ghost sits on, from a build result (core/state.js lastResult or rebuild's own): the heights BEFORE the stamps
 * (cleanHeights), so a ghost never floats on top of its own relief; a result without them falls back to its heights.
 */
export const ghostSurface = (result) => (result ? (result.cleanHeights ?? result.heights ?? null) : null);

/**
 * Hand the preview the current ghosts (or none). Called after every build and after every panel change.
 * `heights` = the surface the ghosts sit on: pass ghostSurface(result) (the pre-stamp surface), not the stamped heights.
 */
export function updateStlGhosts(preview, layers, heights, grid) {
  if (!preview || typeof preview.setStlGhosts !== 'function') return;
  if (!ghostState.visible || !Array.isArray(layers) || !layers.length || !heights) { preview.setStlGhosts([]); return; }
  const list = [];
  layers.forEach((l, i) => {
    if (!l || l.enabled === false || !l.mesh) return;
    // a bad stored mesh shows no ghost; its message is recorded in the STL error map (core/stl/layer.js getStlErrors)
    try { list.push(ghostGeometry(l, heights, grid)); } catch (e) { recordStlError(stlErrorId(l, i), e); }
  });
  preview.setStlGhosts(list);
}

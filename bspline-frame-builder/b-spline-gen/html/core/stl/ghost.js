/**
 * stl/ghost.js -- STL-RELIEF (STL-RELIEF-DESIGN.md, slice 2): the STL as a GHOST on the board in the 3D view, colour coded by how it
 * sits in the surface. Pure array math (the THREE mesh is built in core/preview/index.js setStlGhosts from what this returns).
 *
 * Each vertex is classified (`kinds[v]` = an index into STL_GHOST_KINDS; `counts` per kind):
 *   shows       the object stands above the surface here (Z offset + its height > 0): this part will be in the relief
 *   buried      below the surface: with Max blend it vanishes (with Add it digs a pit)
 *   meets       within STL_MEET_BAND_IN of the surface: the band where the STL meets the surface (the intersection)
 *   overhang    above the surface, the face looks DOWN: a top-down stamp loses it
 *   open        an open edge of the mesh ABOVE the surface (a hole there can carve a pit; an open back resting on or in the
 *               terrain never shows, so it keeps its other kind), on a boundary loop larger than a grid cell
 *               (STL_OPEN_LOOP_MIN_CELLS: a sub-cell scan crack is smoothed over by the surface, it stays stone)
 * What it SHOWS (STL_GHOST_COLOURS, one declared table; Fred 2026-11-22 "only keep red"): a plain stone ghost, red only on
 * an `open` vertex. No meet line is drawn (the classification and meetLine stay: the counts and the gizmo read them).
 *
 * The ghost is a RIGID copy placed on the surface height under its centre (the surface BEFORE the stamps, ghostSurface: never
 * on top of its own relief); the stamp itself is relative per point (the object
 * follows the surface), so on a strongly curved board the ghost is the honest first look, the Stamp result is the truth.
 * A 'Level' STL (record.surface, Fred 2026-11-22) IS rigid at that height: its colours (and meet line) read each vertex against
 * the LOCAL terrain under it, rel = (baseZ + Z offset + its height) - surfaceAt(x, y), so a part over a rise reads buried.
 */
import { decodeMesh, meshBounds } from './mesh.js';
import { cropBoxIn, isFullCropBox } from './crop.js';
import { placeMesh } from './raster.js';
import { normaliseStlLayer, recordStlError, stlErrorId } from './layer.js';
import { polygonPointTester } from '../preview/frame-mesh.js'; // the terrain trim's own batched point-in-polygon

export const STL_GHOST_KINDS = Object.freeze(['shows', 'buried', 'meets', 'overhang', 'open']);
const STL_GHOST_STONE = Object.freeze([0.78, 0.72, 0.63]); // the library preview's stone (main/stl-preview-3d.js 0xc8b8a0)
export const STL_GHOST_COLOURS = Object.freeze({
  shows: STL_GHOST_STONE,
  buried: STL_GHOST_STONE,
  meets: STL_GHOST_STONE,
  overhang: STL_GHOST_STONE,
  open: Object.freeze([0.9, 0.2, 0.2]),
});
export const STL_MEET_BAND_IN = 0.03;
export const STL_OVERHANG_NZ = -0.05; // a face normal pointing this far down is an overhang

/**
 * The surface height at scene (x, y), bilinear; clamped to the board. The grid is buildHeightField's own
 * (core/preview/terrain-mesh.js): column i at x = -W/2 + i*dx, row j at y = -H/2 + j*dy (row 0 = the bottom, +y = a larger row).
 */
export function surfaceAt(heights, grid, x, y) {
  const { nx, nz, widthIn, heightIn } = grid;
  return sampleGridAt(heights, nx, nz, ((x + widthIn / 2) / widthIn) * (nx - 1), ((y + heightIn / 2) / heightIn) * (nz - 1));
}

/**
 * A height grid (row-major, nx columns, nz rows) sampled bilinearly at FRACTIONAL grid coordinates (fi, fj). The indices are kept
 * inside the grid (array bounds, not a rule): a point past the edge reads the edge. surfaceAt's sampler, and the one the 'Level'
 * STL pass reads its base from (core/engine/apply-stamp-layers.js).
 */
export function sampleGridAt(heights, nx, nz, fi0, fj0) {
  const fi = Math.min(nx - 1, Math.max(0, fi0));
  const fj = Math.min(nz - 1, Math.max(0, fj0));
  const i0 = Math.floor(fi), j0 = Math.floor(fj), i1 = Math.min(nx - 1, i0 + 1), j1 = Math.min(nz - 1, j0 + 1);
  const ti = fi - i0, tj = fj - j0;
  const h = (i, j) => heights[j * nx + i];
  return (h(i0, j0) * (1 - ti) + h(i1, j0) * ti) * (1 - tj) + (h(i0, j1) * (1 - ti) + h(i1, j1) * ti) * tj;
}

/**
 * Fred 2026-11-22 ("red spots were scan noise", claude 47's SMK friezes): an open boundary LOOP is marked red only when it
 * could carve a visible pit -- its extent in the placed board frame (the larger side of its X / Y bounding box, inches) is
 * more than this many of the board's grid cells (the ghost's own grid: min(W / (nx - 1), H / (nz - 1))). A scan crack smaller
 * than a cell is smoothed over by the surface; it keeps its other kind (stone). Detection only: it decides a colour.
 */
export const STL_OPEN_LOOP_MIN_CELLS = 1;

/** The open (boundary) edges of `mesh` -- each used by exactly one triangle -- grouped into connected LOOPS (edges sharing a
 *  vertex join): an array of vertex-index arrays. */
export function openEdgeLoops(mesh) {
  const nv = mesh.positions.length / 3, { indices } = mesh;
  const use = new Map();
  const key = (a, b) => (a < b ? a * nv + b : b * nv + a);
  for (let t = 0; t < indices.length; t += 3) {
    for (const [u, v] of [[indices[t], indices[t + 1]], [indices[t + 1], indices[t + 2]], [indices[t + 2], indices[t]]]) {
      const k = key(u, v); use.set(k, (use.get(k) || 0) + 1);
    }
  }
  const parent = new Map();
  const find = (v) => { let r = v; while (parent.get(r) !== r) r = parent.get(r); let c = v; while (c !== r) { const n = parent.get(c); parent.set(c, r); c = n; } return r; };
  for (const [k, n] of use) {
    if (n !== 1) continue;
    const a = Math.floor(k / nv), b = k - a * nv;
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const groups = new Map();
  for (const v of parent.keys()) { const r = find(v); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(v); }
  return [...groups.values()];
}

/** 1 per vertex of an open loop whose placed X / Y extent (`xyz`, scene inches) is more than STL_OPEN_LOOP_MIN_CELLS cells. */
function visibleOpenVertices(mesh, xyz, grid) {
  const cell = grid && grid.nx > 1 && grid.nz > 1 ? Math.min(grid.widthIn / (grid.nx - 1), grid.heightIn / (grid.nz - 1)) : 0;
  const min = STL_OPEN_LOOP_MIN_CELLS * cell;
  const flag = new Uint8Array(mesh.positions.length / 3);
  for (const loop of openEdgeLoops(mesh)) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const v of loop) { const x = xyz[v * 3], y = xyz[v * 3 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (Math.max(x1 - x0, y1 - y0) > min) for (const v of loop) flag[v] = 1;
  }
  return flag;
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
 * @returns {{ id, positions: Float32Array, indices: Uint32Array, colours: Float32Array, kinds: Uint8Array, counts: {shows, buried, meets, overhang, open},
 *   meetLine: Float32Array, place: { x, y, z, rotZ, baseZ } }}  id = the record's id (the placement gizmo picks a ghost by it);
 *   place = the record's position / rotation.z and the surface height under its centre (the gizmo's pivot and start values)
 */
export function ghostGeometry(rawRec, heights, grid, { cropBox = null } = {}) {
  const rec = normaliseStlLayer(rawRec);
  const full = decodeMesh(rec.mesh);
  // STL-CROP preview (the Crop group's sliders, before Apply): the triangles whose centre is outside the box (fractions of the
  // stored mesh's own box, core/stl/crop.js) move to `cutIndices` (drawn faint); the rest stay solid. No box: as before.
  const split = cropBox && !isFullCropBox(cropBox) ? splitByCropBox(full, cropBox) : null;
  const mesh = split ? { positions: full.positions, indices: split.kept } : full;
  const { xyz } = placeMesh(mesh, rec);
  const nv = xyz.length / 3;
  const baseZ = heights ? surfaceAt(heights, grid, rec.position.x, rec.position.y) : 0;
  const zOff = rec.position.z;
  const level = rec.surface === 'level' && !!heights; // without heights there is no local terrain to read: as follow
  // per-vertex normals (area-weighted face normals, outward by the STL's own winding), in the PLACED frame
  const nrm = new Float64Array(nv * 3);
  const idx = full.indices; // normals and open edges read the WHOLE stored mesh (a crop preview's edge is not a hole)
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = xyz[b] - xyz[a], uy = xyz[b + 1] - xyz[a + 1], uz = xyz[b + 2] - xyz[a + 2];
    const vx = xyz[c] - xyz[a], vy = xyz[c + 1] - xyz[a + 1], vz = xyz[c + 2] - xyz[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    for (const v of [idx[t], idx[t + 1], idx[t + 2]]) { nrm[v * 3] += fx; nrm[v * 3 + 1] += fy; nrm[v * 3 + 2] += fz; }
  }
  const open = visibleOpenVertices(full, xyz, grid); // only a loop larger than a grid cell (STL_OPEN_LOOP_MIN_CELLS)
  const positions = new Float32Array(nv * 3);
  const colours = new Float32Array(nv * 3);
  const kinds = new Uint8Array(nv);
  const counts = { shows: 0, buried: 0, meets: 0, overhang: 0, open: 0 };
  const C = STL_GHOST_COLOURS;
  const rels = new Float64Array(nv);
  for (let v = 0; v < nv; v++) {
    const placed = zOff + xyz[v * 3 + 2];
    // Fred 2026-11-22 ("ghost yes"): FOLLOW drapes -- each vertex rides the terrain under IT, as the stamp does; LEVEL stays one
    // rigid object at the terrain under its centre (baseZ), as its stamp does
    const under = level || !heights ? baseZ : surfaceAt(heights, grid, xyz[v * 3], xyz[v * 3 + 1]);
    positions[v * 3] = xyz[v * 3]; positions[v * 3 + 1] = xyz[v * 3 + 1]; positions[v * 3 + 2] = under + placed;
    // above (+) or below (-) the surface it is stamped into: follow = relative to the terrain it rides; Level = the rigid
    // object against the terrain under THIS vertex
    const rel = level ? baseZ + placed - surfaceAt(heights, grid, xyz[v * 3], xyz[v * 3 + 1]) : placed;
    rels[v] = rel;
    let kind = rel > 0 ? 'shows' : 'buried';
    if (Math.abs(rel) <= STL_MEET_BAND_IN) kind = 'meets';
    const len = Math.hypot(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
    if (len > 0 && nrm[v * 3 + 2] / len < STL_OVERHANG_NZ && kind === 'shows') kind = 'overhang'; // only ABOVE the surface: an underside on / in it is just the base
    if (open[v] && rel > STL_MEET_BAND_IN) kind = 'open'; // only a hole ABOVE the surface can show
    counts[kind]++;
    kinds[v] = STL_GHOST_KINDS.indexOf(kind);
    colours[v * 3] = C[kind][0]; colours[v * 3 + 1] = C[kind][1]; colours[v * 3 + 2] = C[kind][2];
  }
  return {
    id: rec.id, positions, indices: mesh.indices, colours, kinds, counts, rels,
    meetLine: meetLine(positions, rels, mesh.indices),
    place: { x: rec.position.x, y: rec.position.y, z: zOff, rotZ: rec.rotation.z, baseZ },
    ...(split ? { cutIndices: split.cut } : {}),
  };
}

/**
 * The ghost `g` (ghostGeometry's shape) TRIMMED to the board outline `poly` -- the SAME loop the terrain preview is trimmed to
 * (core/preview/index.js _trimPoly = frameLoopsWorld(spec, grid).panel, scene x / y; null = no frame template: the board
 * rectangle, nothing trimmed and `g` itself comes back). Fred 2026-11-22 (claude 47, template_3): the ghost hung past the
 * frame's waist notch over empty space. Every triangle whose centroid (x, y) lies outside `poly` is DROPPED (not drawn faint:
 * the faint set means "the pending crop cuts this", and past the trim there is no board to show it on); the crop preview's
 * faint triangles are trimmed the same way. The vertices only dropped triangles used are dropped too (the gizmo's arrow sits
 * on the kept ghost's top) and the meet line is recomputed from the kept triangles. `counts` stay the whole STL's.
 */
export function trimGhost(g, poly) {
  if (!g || !Array.isArray(poly) || poly.length < 3) return g;
  const inside = polygonPointTester(poly), p = g.positions;
  const keepTris = (ix) => {
    const out = [];
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
      if (inside((p[a] + p[b] + p[c]) / 3, (p[a + 1] + p[b + 1] + p[c + 1]) / 3)) out.push(ix[t], ix[t + 1], ix[t + 2]);
    }
    return out;
  };
  const kept = keepTris(g.indices), cut = g.cutIndices ? keepTris(g.cutIndices) : null;
  if (kept.length === g.indices.length && (!cut || cut.length === g.cutIndices.length)) return g;
  const nv = p.length / 3, map = new Int32Array(nv).fill(-1);
  let n = 0;
  for (const v of kept) if (map[v] < 0) map[v] = n++;
  if (cut) for (const v of cut) if (map[v] < 0) map[v] = n++;
  const positions = new Float32Array(n * 3), colours = new Float32Array(n * 3), kinds = new Uint8Array(n), rels = new Float64Array(n);
  for (let v = 0; v < nv; v++) {
    const k = map[v];
    if (k < 0) continue;
    for (let a = 0; a < 3; a++) { positions[k * 3 + a] = p[v * 3 + a]; colours[k * 3 + a] = g.colours[v * 3 + a]; }
    kinds[k] = g.kinds[v];
    rels[k] = g.rels ? g.rels[v] : 0;
  }
  const indices = Uint32Array.from(kept, (v) => map[v]);
  return {
    ...g, positions, colours, kinds, rels, indices,
    meetLine: g.rels ? meetLine(positions, rels, indices) : new Float32Array(0),
    ...(cut ? { cutIndices: Uint32Array.from(cut, (v) => map[v]) } : {}),
  };
}

/** The triangles of `mesh` whose centroid lies inside fractional `box` (kept) and the others (cut), as two index arrays. */
function splitByCropBox(mesh, box) {
  const { positions: p, indices: ix } = mesh;
  const { min, max } = cropBoxIn(meshBounds(p), box);
  const kept = [], cut = [];
  for (let t = 0; t < ix.length; t += 3) {
    let inside = true;
    for (let a = 0; a < 3 && inside; a++) {
      const c = (p[ix[t] * 3 + a] + p[ix[t + 1] * 3 + a] + p[ix[t + 2] * 3 + a]) / 3;
      if (c < min[a] || c > max[a]) inside = false;
    }
    (inside ? kept : cut).push(ix[t], ix[t + 1], ix[t + 2]);
  }
  return { kept: Uint32Array.from(kept), cut: Uint32Array.from(cut) };
}

/** Ghost state (UI-only, never saved): the ghosts show while `visible` is true. `cropPreview` = { id, box } while the STL
 *  panel's Crop sliders of layer `id` are set and not applied (main/stl-panel.js previewStlCrop), else null. */
export const ghostState = { visible: true, cropPreview: null };

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
    const cp = ghostState.cropPreview;
    try { list.push(cp && cp.id === l.id ? ghostGeometry(l, heights, grid, { cropBox: cp.box }) : ghostGeometry(l, heights, grid)); } catch (e) { recordStlError(stlErrorId(l, i), e); }
  });
  preview.setStlGhosts(list);
}

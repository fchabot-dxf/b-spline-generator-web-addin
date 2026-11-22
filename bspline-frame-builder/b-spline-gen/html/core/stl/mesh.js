/**
 * stl/mesh.js -- STL-RELIEF (STL-RELIEF-DESIGN.md): the mesh the project STORES. Pure array math (no DOM), unit-tested.
 *
 *   indexMesh(soup)            -> { positions: Float32Array(3*nv), indices: Uint32Array(3*nt) } welded, degenerate tris dropped
 *   decimate(mesh, target)     -> the same shape with <= target triangles (vertex clustering: deterministic, keeps the silhouette)
 *   encodeMesh / decodeMesh    -> the compact, VERSIONED record kept in P.stlLayers[i].mesh (16-bit quantised positions, base64)
 *   meshHealth(mesh)           -> what the panel reports (DETECTION only; nothing is repaired -- Fred: a repair rule needs his yes)
 *
 * The mesh does NOT have to be closed: the stamp only needs the surface seen from above (a hole shows as a pit in the relief).
 */

export const MESH_RECORD_VERSION = 1;

/** A power of two >= 2n (>= 16): the open-addressing tables below stay at most half full. */
const tableSize = (n) => { let c = 16; while (c < 2 * n) c *= 2; return c; };

/**
 * Weld the soup's identical vertices; drop triangles that collapse (two equal corners). Vertices are numbered in order of
 * first appearance. The weld is an open-addressing hash over the corners' three Float32 bit patterns (-0 keyed as +0, so
 * the two weld as equal numbers do; the first occurrence's own value is the one stored).
 */
export function indexMesh(soup) {
  const nTri = Math.floor(soup.length / 9);
  const f = new Float32Array(9);
  const bits = new Int32Array(f.buffer); // the 9 corner coordinates of the current triangle, as bit patterns
  const cap = tableSize(nTri * 3);
  const mask = cap - 1;
  const slot = new Int32Array(cap).fill(-1); // hash slot -> vertex id
  const keyBits = new Int32Array(nTri * 9); // vertex id -> its 3 key bit patterns
  const pos = new Float32Array(nTri * 9);
  const idx = new Uint32Array(nTri * 3);
  let nv = 0, ni = 0;
  for (let t = 0; t < nTri; t++) {
    const o = t * 9;
    let ok = true;
    for (let k = 0; k < 9; k++) {
      const v = soup[o + k];
      if (!Number.isFinite(v)) { ok = false; break; }
      f[k] = v + 0; // -0 + 0 = +0: one key for the two zeros
    }
    if (!ok) continue; // a non-finite triangle adds nothing -- no orphan vertex is left behind
    // a collapsed triangle (two equal corners) adds nothing either
    if ((bits[0] === bits[3] && bits[1] === bits[4] && bits[2] === bits[5])
      || (bits[3] === bits[6] && bits[4] === bits[7] && bits[5] === bits[8])
      || (bits[0] === bits[6] && bits[1] === bits[7] && bits[2] === bits[8])) continue;
    for (let c = 0; c < 9; c += 3) {
      const b0 = bits[c], b1 = bits[c + 1], b2 = bits[c + 2];
      let h = Math.imul(b0, 0x9e3779b1) ^ Math.imul(b1, 0x85ebca77) ^ Math.imul(b2, 0xc2b2ae3d);
      h = (h ^ (h >>> 15)) & mask;
      let id;
      for (;;) {
        id = slot[h];
        if (id < 0) {
          id = nv++;
          slot[h] = id;
          keyBits[id * 3] = b0; keyBits[id * 3 + 1] = b1; keyBits[id * 3 + 2] = b2;
          pos[id * 3] = soup[o + c]; pos[id * 3 + 1] = soup[o + c + 1]; pos[id * 3 + 2] = soup[o + c + 2];
          break;
        }
        if (keyBits[id * 3] === b0 && keyBits[id * 3 + 1] === b1 && keyBits[id * 3 + 2] === b2) break;
        h = (h + 1) & mask;
      }
      idx[ni++] = id;
    }
  }
  return { positions: pos.slice(0, nv * 3), indices: idx.slice(0, ni) };
}

export function meshBounds(positions) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

// ── decimation ──────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * One vertex-clustering pass at cell `size`: every vertex moves to the mean of its cell, triangles that collapse are dropped,
 * and the result is COMPACT (a cluster no remaining triangle uses is not kept: it would shift the bounding box and inflate the
 * stored size). Cells are keyed by the integer cx + n*(cy + n*cz), n = cells per axis (<= 4097 at decimate's finest size).
 * Two triangles that clustering makes identical are both kept (harmless to the z-buffer and the ghost).
 * `scratch` (optional) holds typed arrays reused across the passes of one decimate.
 */
export function clusterMesh(mesh, size, min, scratch) {
  const { positions, indices } = mesh;
  const nv = positions.length / 3;
  const sc = scratch || clusterScratch(nv);
  const { cell, slot, slotKey, remap, sum, used, keep } = sc;
  let n = 1;
  for (let v = 0; v < nv; v++) {
    for (let a = 0; a < 3; a++) {
      const c = Math.floor((positions[v * 3 + a] - min[a]) / size);
      cell[v * 3 + a] = c;
      if (c + 1 > n) n = c + 1;
    }
  }
  const mask = slot.length - 1;
  slot.fill(-1);
  let nc = 0;
  for (let v = 0; v < nv; v++) {
    const cx = cell[v * 3], cy = cell[v * 3 + 1], cz = cell[v * 3 + 2];
    const key = cx + n * (cy + n * cz);
    let h = (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663) ^ Math.imul(cz, 83492791)) & mask;
    let id;
    for (;;) {
      id = slot[h];
      if (id < 0) { id = nc++; slot[h] = id; slotKey[h] = key; sum[id * 4] = 0; sum[id * 4 + 1] = 0; sum[id * 4 + 2] = 0; sum[id * 4 + 3] = 0; break; }
      if (slotKey[h] === key) break;
      h = (h + 1) & mask;
    }
    remap[v] = id;
    sum[id * 4] += positions[v * 3]; sum[id * 4 + 1] += positions[v * 3 + 1]; sum[id * 4 + 2] += positions[v * 3 + 2]; sum[id * 4 + 3] += 1;
  }
  // the triangles that survive, and which clusters they use
  used.fill(0, 0, nc);
  const tri = new Uint32Array(indices.length);
  let nt = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = remap[indices[t]], b = remap[indices[t + 1]], c = remap[indices[t + 2]];
    if (a === b || b === c || a === c) continue;
    tri[nt++] = a; tri[nt++] = b; tri[nt++] = c;
    used[a] = 1; used[b] = 1; used[c] = 1;
  }
  // compact: renumber the used clusters in their own order
  let nk = 0;
  for (let c = 0; c < nc; c++) keep[c] = used[c] ? nk++ : -1;
  const outPos = new Float32Array(nk * 3);
  for (let c = 0; c < nc; c++) {
    const k = keep[c];
    if (k < 0) continue;
    const w = sum[c * 4 + 3];
    outPos[k * 3] = sum[c * 4] / w; outPos[k * 3 + 1] = sum[c * 4 + 1] / w; outPos[k * 3 + 2] = sum[c * 4 + 2] / w;
  }
  const outIdx = new Uint32Array(nt);
  for (let i = 0; i < nt; i++) outIdx[i] = keep[tri[i]];
  return { positions: outPos, indices: outIdx };
}
function clusterScratch(nv) {
  const cap = tableSize(nv);
  return {
    cell: new Int32Array(nv * 3), slot: new Int32Array(cap), slotKey: new Float64Array(cap), remap: new Int32Array(nv),
    sum: new Float64Array(nv * 4), used: new Uint8Array(nv), keep: new Int32Array(nv),
  };
}

/** At most `target` triangles (the mesh itself when it already fits). Vertex clustering on a grid whose cell size is searched. */
export function decimate(mesh, target) {
  const nt = mesh.indices.length / 3;
  if (!(target >= 1) || nt <= target) return mesh;
  const { min, max } = meshBounds(mesh.positions);
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const scratch = clusterScratch(mesh.positions.length / 3);
  let lo = extent / 4096, hi = extent; // lo: fine (many triangles); hi: coarse (few)
  let best = clusterMesh(mesh, hi, min, scratch);
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const m = clusterMesh(mesh, mid, min, scratch);
    if (m.indices.length / 3 <= target) { best = m; hi = mid; } else lo = mid;
  }
  return best;
}

// ── the stored record ───────────────────────────────────────────────────────────────────────────────────────────────
function toB64(typed) {
  const u8 = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}
function fromB64(b64, Type) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return new Type(u8.buffer, 0, u8.length / Type.BYTES_PER_ELEMENT);
}
function fnv(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

/**
 * The compact stored record: 16-bit positions inside the bounding box, 16/32-bit indices, base64. `h` = a content hash (the
 * cache key in core/stl/layer.js and the mesh's stand-in in rebuild.js's digests): it covers the box (min, size), the counts
 * and the index width as well as the quantised text, so two meshes whose 16-bit positions match but whose boxes differ (a
 * 10 x 10 x 10 box and a 10 x 10 x 2 one) never share it.
 */
export function encodeMesh(mesh) {
  const { positions, indices } = mesh;
  const nv = positions.length / 3, nt = indices.length / 3;
  const { min, max } = meshBounds(positions);
  const size = [0, 1, 2].map((a) => (Number.isFinite(max[a] - min[a]) ? max[a] - min[a] : 0));
  const q = new Uint16Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) q[i + a] = size[a] > 0 ? Math.round(((positions[i + a] - min[a]) / size[a]) * 65535) : 0;
  }
  const idxBits = nv <= 65536 ? 16 : 32;
  const idx = idxBits === 16 ? Uint16Array.from(indices) : Uint32Array.from(indices);
  const pos = toB64(q), ix = toB64(idx);
  const h = fnv(`${JSON.stringify([min, size, nv, nt, idxBits])}|${pos}|${ix}`);
  return { v: MESH_RECORD_VERSION, nv, nt, min, size, idxBits, pos, idx: ix, h };
}

export function decodeMesh(rec) {
  if (!rec || rec.v !== MESH_RECORD_VERSION) throw new Error(`Unknown stored STL mesh version ${rec && rec.v}.`);
  const q = fromB64(rec.pos, Uint16Array);
  const positions = new Float32Array(q.length);
  for (let i = 0; i < q.length; i += 3) {
    for (let a = 0; a < 3; a++) positions[i + a] = rec.min[a] + (q[i + a] / 65535) * rec.size[a];
  }
  const raw = fromB64(rec.idx, rec.idxBits === 16 ? Uint16Array : Uint32Array);
  return { positions, indices: Uint32Array.from(raw) };
}

// ── health (detection only) ─────────────────────────────────────────────────────────────────────────────────────────
/**
 * @returns {{ triangles, vertices, openEdges, nonManifoldEdges, boundaryLoops, components }}
 *  openEdges: edges used by ONE triangle (a hole or a deliberately open back); boundaryLoops: how many separate open outlines
 *  those edges form (an open relief scan is normally 1); components: separate pieces (a floating fragment is a 2nd one).
 */
export function meshHealth(mesh) {
  const { indices } = mesh;
  const nv = mesh.positions.length / 3, nt = indices.length / 3;
  const edgeUse = new Map();
  const ekey = (a, b) => (a < b ? a * nv + b : b * nv + a);
  const parent = Int32Array.from({ length: nv }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const join = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) { const k = ekey(u, v); edgeUse.set(k, (edgeUse.get(k) || 0) + 1); }
    join(a, b); join(b, c);
  }
  let openEdges = 0, nonManifoldEdges = 0;
  const loop = Int32Array.from({ length: nv }, (_, i) => i);
  const lfind = (x) => { while (loop[x] !== x) { loop[x] = loop[loop[x]]; x = loop[x]; } return x; };
  const open = [];
  for (const [k, n] of edgeUse) {
    if (n === 1) { openEdges++; open.push(k); } else if (n > 2) nonManifoldEdges++;
  }
  for (const k of open) {
    const a = Math.floor(k / nv), b = k - a * nv;
    const ra = lfind(a), rb = lfind(b);
    if (ra !== rb) loop[ra] = rb;
  }
  const loops = new Set();
  for (const k of open) loops.add(lfind(Math.floor(k / nv)));
  const comps = new Set();
  const used = new Set();
  for (let t = 0; t < indices.length; t++) used.add(indices[t]);
  for (const v of used) comps.add(find(v));
  return { triangles: nt, vertices: nv, openEdges, nonManifoldEdges, boundaryLoops: loops.size, components: comps.size };
}

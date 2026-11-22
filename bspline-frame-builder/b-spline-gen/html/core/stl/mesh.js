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

const keyOf = (x, y, z) => `${x},${y},${z}`;

/** Weld the soup's identical vertices; drop triangles that collapse (two equal corners). */
export function indexMesh(soup) {
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
    // a collapsed (two equal corners) or non-finite triangle adds nothing -- no orphan vertex is left behind
    if (!ok || keys[0] === keys[1] || keys[1] === keys[2] || keys[0] === keys[2]) continue;
    for (let v = 0; v < 3; v++) {
      let id = idOf.get(keys[v]);
      if (id === undefined) { id = pos.length / 3; idOf.set(keys[v], id); pos.push(soup[o + v * 3], soup[o + v * 3 + 1], soup[o + v * 3 + 2]); }
      idx.push(id);
    }
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
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
function cluster(mesh, size, min) {
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
    if (seen.has(k)) continue; // a triangle two clusters made identical
    seen.add(k);
    outIdx.push(a, b, c);
  }
  return { positions: outPos, indices: Uint32Array.from(outIdx) };
}

/** At most `target` triangles (the mesh itself when it already fits). Vertex clustering on a grid whose cell size is searched. */
export function decimate(mesh, target) {
  const nt = mesh.indices.length / 3;
  if (!(target >= 1) || nt <= target) return mesh;
  const { min, max } = meshBounds(mesh.positions);
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  let lo = extent / 4096, hi = extent; // lo: fine (many triangles); hi: coarse (few)
  let best = cluster(mesh, hi, min);
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const m = cluster(mesh, mid, min);
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

/** The compact stored record: 16-bit positions inside the bounding box, 16/32-bit indices, base64. `h` = a content hash (cache key). */
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
  return { v: MESH_RECORD_VERSION, nv, nt, min, size, idxBits, pos, idx: ix, h: fnv(pos + ix) };
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

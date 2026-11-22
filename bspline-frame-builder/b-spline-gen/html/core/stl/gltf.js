/**
 * core/stl/gltf.js -- SMITHSONIAN-BROWSER (SMITHSONIAN-BROWSER-DESIGN.md section 3): a GLB as the SAME triangle soup an STL gives
 * (core/stl/parse.js parseStl's `.soup`: Float32Array, 9 floats per triangle), so a GLB enters the one STL import path.
 * Every vertex goes through GLTF_TO_BOARD after its node's world matrix; a library model's parts are then put in their Voyager
 * pose (transformSoup). GEOMETRY ONLY: a GLB reaches the loader without its textures (stripGlbTextures), and a download asks for
 * the geometry's bytes alone (fetchGlbGeometry, byte ranges).
 * The loaders (three r128's GLTFLoader + DRACOLoader, pinned to the same r128 the palette loads) are added ON FIRST USE only:
 * a board that never opens a GLB never loads them.
 */

/**
 * The declared turn, glTF -> board: the IDENTITY, (x, y, z) -> (x, y, z). For a RELIEF a model lies FACE UP: glTF's front (+Z)
 * points out of the board (the relief's height), its up (+Y) toward the top of the board (+y, up the screen), as its picture
 * shows it. (Measured 2026-11-22: the earlier Y-up -> Z-up turn stood a Smithsonian bust UP, so the top-down stamp was a 2.6 in
 * column = the top of the head.) A default only: the Rotate sliders turn it any way.
 */
export const GLTF_TO_BOARD = Object.freeze((p) => [p[0], p[1], p[2]]);

export const GLTF_LOADER_URLS = Object.freeze({
  gltf: 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js',
  draco: 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/DRACOLoader.js',
  decoderPath: 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/draco/gltf/',
});

/** A position attribute's reader: a plain BufferAttribute (array + itemSize) or an InterleavedBufferAttribute (data.stride + offset). */
function positionReader(attr) {
  if (attr.isInterleavedBufferAttribute) {
    const a = attr.data.array, stride = attr.data.stride, off = attr.offset || 0;
    return { count: attr.count ?? Math.floor((a.length - off) / stride), at: (i, k) => a[i * stride + off + k] };
  }
  const a = attr.array, size = attr.itemSize || 3;
  return { count: attr.count ?? Math.floor(a.length / size), at: (i, k) => a[i * size + k] };
}

/** Every mesh of a THREE scene (as GLTFLoader returns it), in world space, through GLTF_TO_BOARD, as one triangle soup. */
export function soupFromGltfScene(scene) {
  scene.updateMatrixWorld?.(true);
  const parts = [];
  scene.traverse((o) => {
    if (!o || !o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
    const g = o.geometry;
    const pos = positionReader(g.attributes.position);
    const idx = g.index && g.index.array ? g.index.array : null;
    const n = idx ? (g.index.count ?? idx.length) : pos.count;
    const tris = Math.floor(n / 3);
    if (!tris) return;
    const m = (o.matrixWorld && o.matrixWorld.elements) || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; // column-major
    const out = new Float32Array(tris * 9);
    for (let t = 0; t < tris * 3; t++) {
      const v = idx ? idx[t] : t;
      const x = pos.at(v, 0), y = pos.at(v, 1), z = pos.at(v, 2);
      const w = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
      const b = GLTF_TO_BOARD(w);
      out[t * 3] = b[0]; out[t * 3 + 1] = b[1]; out[t * 3 + 2] = b[2];
    }
    parts.push(out);
  });
  return concatSoups(parts);
}

/** Several triangle soups as one (a model in several parts = one layer). */
export function concatSoups(parts) {
  const soup = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { soup.set(p, at); at += p.length; }
  return soup;
}

/**
 * A model's POSE applied to its soup (the Voyager scene's model entry, core/stl/smithsonian.js parseVoyagerScene): rotate every
 * point by the unit quaternion `rotation` [qx, qy, qz, qw], THEN add `translation` [x, y, z]. Either absent (or null) = identity.
 * Pure: a new soup, the input untouched.
 */
export function transformSoup(soup, { rotation = null, translation = null } = {}) {
  const [qx, qy, qz, qw] = rotation || [0, 0, 0, 1];
  const [tx, ty, tz] = translation || [0, 0, 0];
  const out = new Float32Array(soup.length);
  for (let i = 0; i < soup.length; i += 3) {
    const x = soup[i], y = soup[i + 1], z = soup[i + 2];
    // v' = v + w t + q x t, with t = 2 (q x v)
    const cx = 2 * (qy * z - qz * y), cy = 2 * (qz * x - qx * z), cz = 2 * (qx * y - qy * x);
    out[i] = x + qw * cx + (qy * cz - qz * cy) + tx;
    out[i + 1] = y + qw * cy + (qz * cx - qx * cz) + ty;
    out[i + 2] = z + qw * cz + (qx * cy - qy * cx) + tz;
  }
  return out;
}

// ── geometry only: a GLB without its textures (Fred: "I don't want the texture"; measured: the images are half of each GLB) ──
const GLB_MAGIC = 0x46546c67, CHUNK_JSON = 0x4e4f534a, CHUNK_BIN = 0x004e4942;
/** The extensions that only serve materials / textures: dropped from extensionsUsed / extensionsRequired with them. */
export const GLB_TEXTURE_EXTENSIONS = /^(KHR_texture_|EXT_texture_|MSFT_texture_|KHR_materials_)/;
/** fetchGlbGeometry merges two kept byte ranges closer than this into one request. */
export const GLB_RANGE_MERGE_GAP = 64 * 1024;
const pad4 = (n) => (n + 3) & ~3;

/**
 * The stripped glTF JSON and where its kept bytes come from: no images / textures / samplers / materials (and no primitive
 * `material`), ONLY the bufferViews still referenced (accessors, sparse accessors, KHR_draco_mesh_compression), re-indexed. The
 * views in the GLB's own BIN buffer are re-packed in order, each at its original offset modulo 4 (4-byte alignment, the
 * accessors' component alignment kept): `copies` = [{ from (old BIN offset), to (new BIN offset), length }].
 */
function stripPlan(json) {
  const out = JSON.parse(JSON.stringify(json));
  for (const k of ['images', 'textures', 'samplers', 'materials']) delete out[k];
  for (const m of out.meshes || []) for (const p of (m && m.primitives) || []) {
    if (!p) continue;
    delete p.material;
    if (p.extensions) { delete p.extensions.KHR_materials_variants; if (!Object.keys(p.extensions).length) delete p.extensions; }
  }
  for (const k of ['extensionsUsed', 'extensionsRequired']) {
    if (!Array.isArray(out[k])) continue;
    out[k] = out[k].filter((e) => !GLB_TEXTURE_EXTENSIONS.test(e));
    if (!out[k].length) delete out[k];
  }
  // every bufferView reference that stays: [object, key] pairs, rewritten once the views are re-indexed
  const refs = [];
  for (const a of out.accessors || []) {
    if (!a) continue;
    refs.push([a, 'bufferView']);
    if (a.sparse) { if (a.sparse.indices) refs.push([a.sparse.indices, 'bufferView']); if (a.sparse.values) refs.push([a.sparse.values, 'bufferView']); }
  }
  for (const m of out.meshes || []) for (const p of (m && m.primitives) || []) {
    const d = p && p.extensions && p.extensions.KHR_draco_mesh_compression;
    if (d) refs.push([d, 'bufferView']);
  }
  const views = Array.isArray(json.bufferViews) ? json.bufferViews : [];
  const kept = [...new Set(refs.map(([o, k]) => o[k]).filter((i) => Number.isInteger(i) && views[i]))].sort((a, b) => a - b);
  const remap = new Map(kept.map((old, i) => [old, i]));
  for (const [o, k] of refs) if (remap.has(o[k])) o[k] = remap.get(o[k]);
  const glbBin = Array.isArray(json.buffers) && json.buffers[0] && json.buffers[0].uri === undefined; // buffer 0 = the BIN chunk
  const copies = [];
  let at = 0;
  out.bufferViews = kept.map((old) => {
    const v = { ...views[old] };
    if (glbBin && (v.buffer || 0) === 0) {
      const from = v.byteOffset || 0;
      at += ((from % 4) - (at % 4) + 4) % 4;
      copies.push({ from, to: at, length: v.byteLength });
      v.byteOffset = at;
      at += v.byteLength;
    }
    return v;
  });
  if (glbBin) out.buffers[0].byteLength = at;
  return { json: out, copies, binLength: glbBin ? at : 0 };
}

/** The stripped GLB's bytes: the plan's JSON chunk (space-padded) and a BIN chunk built from `readBin(from, length)` (zero-padded). */
function writeStrippedGlb(plan, readBin) {
  const j = new TextEncoder().encode(JSON.stringify(plan.json));
  const jl = pad4(j.length), bl = pad4(plan.binLength);
  const hasBin = plan.binLength > 0;
  const total = 20 + jl + (hasBin ? 8 + bl : 0);
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, GLB_MAGIC, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jl, true); dv.setUint32(16, CHUNK_JSON, true);
  out.fill(0x20, 20, 20 + jl); out.set(j, 20);
  if (hasBin) {
    dv.setUint32(20 + jl, bl, true); dv.setUint32(24 + jl, CHUNK_BIN, true);
    for (const c of plan.copies) out.set(readBin(c.from, c.length), 28 + jl + c.to);
  }
  return out.buffer;
}

/** The GLB container's parts, or null when these bytes are not one: { json, binStart, binLength } (binStart null: no BIN chunk). */
function readGlbContainer(u8) {
  if (u8.byteLength < 20) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== GLB_MAGIC || dv.getUint32(16, true) !== CHUNK_JSON) return null;
  const jl = dv.getUint32(12, true);
  if (20 + jl > u8.byteLength) return null;
  let json;
  try { json = JSON.parse(new TextDecoder().decode(u8.subarray(20, 20 + jl))); } catch (_) { return null; }
  if (!json || typeof json !== 'object') return null;
  let binStart = null, binLength = 0;
  if (20 + jl + 8 <= u8.byteLength && dv.getUint32(24 + jl, true) === CHUNK_BIN) {
    binStart = 28 + jl;
    binLength = Math.min(dv.getUint32(20 + jl, true), u8.byteLength - binStart);
  }
  return { json, binStart, binLength };
}

const copiesFit = (plan, binStart, binLength) => plan.copies.every((c) => binStart !== null && c.from + c.length <= binLength);

/**
 * A GLB without its textures: a NEW GLB whose JSON has no images / textures / samplers / materials and whose BIN chunk holds
 * ONLY the referenced bufferViews (their bytes unchanged, re-packed, offsets rewritten). Bytes that are not a readable GLB come
 * back as they are (the loader then says what is wrong with them).
 */
export function stripGlbTextures(arrayBuffer) {
  const u8 = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
  const glb = readGlbContainer(u8);
  if (!glb) return arrayBuffer;
  const plan = stripPlan(glb.json);
  if (!copiesFit(plan, glb.binStart, glb.binLength)) return arrayBuffer;
  return writeStrippedGlb(plan, (from, length) => u8.subarray(glb.binStart + from, glb.binStart + from + length));
}

const downloadError = (res) => new Error(`the download answered ${res ? res.status : '?'}${res && res.statusText ? ` ${res.statusText}` : ''}`);

/**
 * A GLB's GEOMETRY only, downloaded by byte RANGE: the header (bytes 0-19: the length and the JSON chunk's length), the JSON
 * chunk (+ the BIN chunk's header), then only the kept bufferViews' bytes in the BIN chunk (ranges closer than
 * GLB_RANGE_MERGE_GAP merged into one request), assembled into the same GLB stripGlbTextures builds. A server answering 200 (no
 * range support): that full answer is stripped. Any other answer, or anything inconsistent: a full download + stripGlbTextures.
 */
export async function fetchGlbGeometry(url, fetchImpl = (...a) => globalThis.fetch(...a)) {
  const first = await fetchImpl(url, { headers: { Range: 'bytes=0-19' } });
  if (first && first.status === 200) return stripGlbTextures(await first.arrayBuffer());
  if (first && first.status === 206) {
    try {
      const got = await rangedGeometry(url, fetchImpl, first);
      if (got) return got;
    } catch (_) { /* inconsistent or interrupted: the full download below */ }
  }
  const res = await fetchImpl(url);
  if (!res || !res.ok) throw downloadError(res);
  return stripGlbTextures(await res.arrayBuffer());
}

/** The range plan of fetchGlbGeometry; null = inconsistent (the caller downloads it all). */
async function rangedGeometry(url, fetchImpl, first) {
  const get = async (a, b) => { // bytes a..b inclusive, exactly, or null
    const res = a === 0 && b === 19 ? first : await fetchImpl(url, { headers: { Range: `bytes=${a}-${b}` } });
    if (!res || res.status !== 206) return null;
    const cr = res.headers && res.headers.get ? res.headers.get('content-range') : null; // only readable when the server exposes it
    if (cr) { const m = /^bytes (\d+)-(\d+)\//.exec(cr); if (!m || Number(m[1]) !== a || Number(m[2]) !== b) return null; }
    const body = new Uint8Array(await res.arrayBuffer());
    return body.byteLength === b - a + 1 ? body : null;
  };
  const head = await get(0, 19);
  if (!head) return null;
  const hv = new DataView(head.buffer, head.byteOffset, 20);
  if (hv.getUint32(0, true) !== GLB_MAGIC || hv.getUint32(16, true) !== CHUNK_JSON) return null;
  const total = hv.getUint32(8, true), jl = hv.getUint32(12, true);
  const withBinHead = 20 + jl + 8 <= total;
  const js = await get(20, 20 + jl + (withBinHead ? 8 : 0) - 1);
  if (!js) return null;
  const json = JSON.parse(new TextDecoder().decode(js.subarray(0, jl)));
  let binStart = null, binLength = 0;
  if (withBinHead) {
    const bv = new DataView(js.buffer, js.byteOffset + jl, 8);
    if (bv.getUint32(4, true) === CHUNK_BIN) { binStart = 20 + jl + 8; binLength = Math.min(bv.getUint32(0, true), total - binStart); }
  }
  const plan = stripPlan(json);
  if (!copiesFit(plan, binStart, binLength)) return null;
  // the kept views' byte ranges in the BIN chunk, merged when closer than the gap
  const ranges = [];
  for (const c of [...plan.copies].filter((c) => c.length > 0).sort((p, q) => p.from - q.from)) {
    const last = ranges[ranges.length - 1];
    if (last && c.from - last.b < GLB_RANGE_MERGE_GAP) last.b = Math.max(last.b, c.from + c.length);
    else ranges.push({ a: c.from, b: c.from + c.length });
  }
  for (const r of ranges) { r.bytes = await get(binStart + r.a, binStart + r.b - 1); if (!r.bytes) return null; }
  return writeStrippedGlb(plan, (from, length) => {
    const r = ranges.find((x) => from >= x.a && from + length <= x.b);
    return r ? r.bytes.subarray(from - r.a, from - r.a + length) : new Uint8Array(length);
  });
}

// ── the loaders, on first use ───────────────────────────────────────────────────────────────────────────────────────
let _scripts = null;   // the shared promise: both loader scripts in
let _loader = null;    // one GLTFLoader (one Draco worker pool) for the session

function addScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Could not load the 3D model reader (${src.split('/').pop()}).`));
    document.head.appendChild(s);
  });
}

function ensureLoaderScripts() {
  const T = globalThis.THREE;
  if (!T) return Promise.reject(new Error('three.js is not loaded.'));
  if (T.GLTFLoader && T.DRACOLoader) return Promise.resolve();
  if (!_scripts) {
    _scripts = (async () => {
      if (!globalThis.THREE.GLTFLoader) await addScript(GLTF_LOADER_URLS.gltf);
      if (!globalThis.THREE.DRACOLoader) await addScript(GLTF_LOADER_URLS.draco);
    })();
    _scripts.catch(() => { _scripts = null; }); // offline: a later try loads them again
  }
  return _scripts;
}

/** A GLB's bytes -> its THREE scene (Draco decoded). The loader gets the GLB WITHOUT its textures (stripGlbTextures): every GLB,
 *  downloaded or a local file, so no texture is ever decoded. */
export async function loadGlbScene(arrayBuffer) {
  await ensureLoaderScripts();
  const T = globalThis.THREE;
  if (!_loader) {
    const draco = new T.DRACOLoader();
    draco.setDecoderPath(GLTF_LOADER_URLS.decoderPath);
    _loader = new T.GLTFLoader();
    _loader.setDRACOLoader(draco);
  }
  const loader = _loader;
  const geometryOnly = stripGlbTextures(arrayBuffer);
  return new Promise((resolve, reject) => {
    loader.parse(geometryOnly, '', (gltf) => resolve(gltf.scene), (e) => reject(e instanceof Error ? e : new Error(`This GLB cannot be read${e && e.message ? `: ${e.message}` : '.'}`)));
  });
}

/** Free a loaded scene's geometries / materials / textures (the soup or the preview copy has what it needs). */
export function disposeGltfScene(scene) {
  scene?.traverse?.((o) => {
    o.geometry?.dispose?.();
    for (const m of [].concat(o.material || [])) {
      for (const v of Object.values(m)) if (v && v.isTexture) v.dispose?.();
      m.dispose?.();
    }
  });
}

/** A GLB's bytes -> its soup (the loaded scene freed once read). */
export async function soupFromGlbBuffer(buf) {
  const scene = await loadGlbScene(buf);
  try { return soupFromGltfScene(scene); } finally { disposeGltfScene(scene); }
}

/**
 * Download every part of one model (`parts`: [{ url, rotation?, translation? }]), each as its geometry only (fetchGlbGeometry),
 * read it, put it in its pose (transformSoup; no pose = as stored) and return ONE soup. A failed download throws.
 */
export async function soupFromGlbParts(parts, fetchImpl = (...a) => globalThis.fetch(...a)) {
  const soups = [];
  for (const part of parts) soups.push(transformSoup(await soupFromGlbBuffer(await fetchGlbGeometry(part.url, fetchImpl)), part));
  return concatSoups(soups);
}

/** Test hook. */
export function _resetGltfLoaderForTests() { _scripts = null; _loader = null; }

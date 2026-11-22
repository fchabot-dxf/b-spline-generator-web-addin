/**
 * height/raster.js -- HEIGHT-PAINTER (HEIGHT-PAINTER-DESIGN.md section 7): a height patch's raster. In memory it is a
 * Float32Array of heights in INCHES (signed: + raises, - lowers, 0 = transparent), row-major, `cols` x `rows`. It is STORED
 * (P.heightLayers[i].raster) as Float16 -> deflate-raw (the platform CompressionStream) -> base64, with a content hash `h`:
 *   { cols, rows, enc: 'f16-deflate-b64', data: '<base64>', h: '<hash>' }
 * `h` is the decode cache key here, the undo store key (core/history.js) and the raster's stand-in in the build digests
 * (core/engine/rebuild.js), the same role as the STL mesh's `h` (core/stl/mesh.js encodeMesh).
 * Float16 keeps 11 significant bits: 0.0005 in steps at 1 in, 0.00003 in at 0.1 in (finer than any CNC finish).
 */

export const RASTER_ENC = 'f16-deflate-b64';
/** HEIGHT-PAINTER slice 2: an IMAGE layer's normalised grey 0..1 (core/height/compose.js) as 16-bit levels q / 65535 ->
 *  deflate-raw -> base64: a 16-bit heightmap's levels are kept exactly (Float16 would round them to 1/2048 near white). */
export const RASTER_ENC_U16 = 'u16-deflate-b64';
const RASTER_ENCS = Object.freeze([RASTER_ENC, RASTER_ENC_U16]);

// ── Float16 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const _f32 = new Float32Array(1);
const _u32 = new Uint32Array(_f32.buffer);
/** The IEEE half-precision bits of `v` (round to nearest, ties to even; overflow -> infinity; subnormals kept). */
export function f32ToF16Bits(v) {
  _f32[0] = v;
  const x = _u32[0];
  const sign = (x >>> 16) & 0x8000;
  const e32 = (x >>> 23) & 0xff;
  const m = x & 0x7fffff;
  if (e32 === 0xff) return sign | 0x7c00 | (m ? 0x200 : 0);
  const e = e32 - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00;
  if (e <= 0) {
    if (e < -10) return sign;
    const M = m | 0x800000, shift = 14 - e;
    let half = M >>> shift;
    const rem = M & ((1 << shift) - 1), mid = 1 << (shift - 1);
    if (rem > mid || (rem === mid && (half & 1))) half++;
    return sign | half;
  }
  let half = (e << 10) | (m >>> 13);
  const rem = m & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && (half & 1))) half++; // a carry into the exponent is the right rounding
  return sign | half;
}
let _halfTable = null;
/** half bits -> its value (a 65536-entry table, built once) */
function halfTable() {
  if (_halfTable) return _halfTable;
  const t = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const s = h & 0x8000 ? -1 : 1, e = (h >>> 10) & 0x1f, m = h & 0x3ff;
    t[h] = e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
  }
  _halfTable = t;
  return t;
}
/** `v` rounded to the nearest Float16 value (what a stored raster gives back). */
export const f16Round = (v) => halfTable()[f32ToF16Bits(v)];

// ── bytes ───────────────────────────────────────────────────────────────────────────────────────────────────────────
function toB64(u8) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}
function fromB64(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}
/** All of `u8` through a CompressionStream / DecompressionStream (written and read here: no Blob / Response needed). */
async function throughStream(stream, u8) {
  const writer = stream.writable.getWriter();
  const done = writer.write(u8).then(() => writer.close());
  const reader = stream.readable.getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const { done: end, value } = await reader.read();
    if (end) break;
    parts.push(value); n += value.length;
  }
  await done;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
/** A 53-bit content hash (cyrb53) of a string, base 36. */
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
/** The content hash of a stored raster: its encoding, its shape and its text. */
export const rasterHash = (enc, cols, rows, data) => cyrb53(`${enc}|${cols}x${rows}|${data}`);

/** A stored raster (the record's `raster`, never a history `{ ref }`). */
export const isStoredRaster = (v) => !!(v && typeof v === 'object' && typeof v.data === 'string' && typeof v.enc === 'string' && typeof v.h === 'string' && v.h);

// ── the decode cache: h -> the decoded Float32Array (LRU; the arrays are SHARED: never write into one) ─────────────
export const RASTER_CACHE_CAP = 8;
const _decoded = new Map();
const _pending = new Map();
function cacheGet(h) {
  const v = _decoded.get(h);
  if (v !== undefined) { _decoded.delete(h); _decoded.set(h, v); }
  return v;
}
function cacheSet(h, v) {
  _decoded.set(h, v);
  while (_decoded.size > RASTER_CACHE_CAP) _decoded.delete(_decoded.keys().next().value);
  return v;
}

/**
 * Store `data` (Float32 inches, cols x rows). Resolves to the stored raster; its decoded values (the Float16 roundings of
 * `data`) are put in the decode cache at once, so the build and the painter read exactly what a reload will.
 */
export async function encodeRaster(data, cols, rows, enc = RASTER_ENC) {
  const n = cols * rows;
  const half = new Uint16Array(n);
  const stored = new Float32Array(n);
  if (enc === RASTER_ENC_U16) {
    // the 16-bit levels of a 0..1 grey (the encoding's own range: a value outside it is the nearest level)
    for (let k = 0; k < n; k++) { const q = Math.round(Math.min(1, Math.max(0, data[k] || 0)) * 65535); half[k] = q; stored[k] = q / 65535; }
  } else {
    const t = halfTable();
    for (let k = 0; k < n; k++) { const b = f32ToF16Bits(data[k]); half[k] = b; stored[k] = t[b]; }
  }
  const packed = await throughStream(new CompressionStream('deflate-raw'), new Uint8Array(half.buffer));
  const b64 = toB64(packed);
  const rec = { cols, rows, enc, data: b64, h: rasterHash(enc, cols, rows, b64) };
  cacheSet(rec.h, stored);
  return rec;
}

/** A stored raster's heights (a fresh Float32Array; no cache). */
export async function decodeRaster(rec) {
  if (!rec || !RASTER_ENCS.includes(rec.enc)) throw new Error(`Unknown stored height raster encoding ${rec && rec.enc}.`);
  const bytes = await throughStream(new DecompressionStream('deflate-raw'), fromB64(rec.data));
  const half = new Uint16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >>> 1);
  const out = new Float32Array(half.length);
  if (rec.enc === RASTER_ENC_U16) { for (let k = 0; k < half.length; k++) out[k] = half[k] / 65535; return out; }
  const t = halfTable();
  for (let k = 0; k < half.length; k++) out[k] = t[half[k]];
  return out;
}

/** The decoded heights of `rec` when they are in the cache (sync: the build reads this), else undefined. */
export const decodedRaster = (rec) => (rec && rec.h ? cacheGet(rec.h) : undefined);

/** The decoded heights of `rec`, decoding it once (concurrent callers share one decode). */
export function ensureRasterDecoded(rec) {
  const hit = decodedRaster(rec);
  if (hit) return Promise.resolve(hit);
  if (_pending.has(rec.h)) return _pending.get(rec.h);
  const p = decodeRaster(rec).then((d) => { _pending.delete(rec.h); return cacheSet(rec.h, d); }, (e) => { _pending.delete(rec.h); throw e; });
  _pending.set(rec.h, p);
  return p;
}

export function _resetRasterCacheForTests() { _decoded.clear(); _pending.clear(); }

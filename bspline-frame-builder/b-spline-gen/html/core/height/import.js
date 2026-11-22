/**
 * height/import.js -- HEIGHT-PAINTER slice 2 (HEIGHT-PAINTER-DESIGN.md, the import notes): a heightmap FILE as normalised
 * grey 0..1 for an IMAGE layer (core/height/compose.js), and the patch's composite as a 16-bit PNG (export).
 *  - 8-bit PNG / JPG / WebP: the browser's own decoder (createImageBitmap -> canvas, no colour conversion);
 *  - 16-bit PNG: fast-png, loaded ON FIRST USE from a pinned jsDelivr URL (no npm dependency, nothing at app start), so the
 *    16 bits are kept;
 *  - EXR: three r128's EXRLoader (+ its fflate), pinned to the r128 the palette loads, on first use (as core/stl/gltf.js
 *    loads GLTFLoader). Its R channel, normalised (lo = min(0, min), hi = max).
 * The decoded grey has row 0 = the image's TOP; resampleToGrid puts it on a patch's grid in the raster frame (row 0 = the
 * BOTTOM, core/height/layer.js).
 */

/** The libraries, pinned (each at least weeks old), loaded only when a file needs them. */
export const HEIGHTMAP_LIB_URLS = Object.freeze({
  png: 'https://cdn.jsdelivr.net/npm/fast-png@6.2.0/+esm', // MIT; decode + encode, 16-bit grey
  exr: 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/EXRLoader.js',
  fflate: 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/fflate.min.js', // EXRLoader's inflate (a global)
});

// ── the loaders, on first use ───────────────────────────────────────────────────────────────────────────────────────
let _png = null;
let _exrScripts = null;
/** fast-png's module ({ decode, encode }). */
export function loadPngLib() {
  if (!_png) {
    _png = import(/* @vite-ignore */ HEIGHTMAP_LIB_URLS.png);
    _png.catch(() => { _png = null; }); // offline: a later try loads it again
  }
  return _png;
}
function addScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Could not load the EXR reader (${src.split('/').pop()}).`));
    document.head.appendChild(s);
  });
}
/** A THREE.EXRLoader (Float32 output). */
export async function loadExrLoader() {
  const T = globalThis.THREE;
  if (!T) throw new Error('three.js is not loaded.');
  if (!T.EXRLoader || typeof globalThis.fflate === 'undefined') {
    if (!_exrScripts) {
      _exrScripts = (async () => {
        if (typeof globalThis.fflate === 'undefined') await addScript(HEIGHTMAP_LIB_URLS.fflate);
        if (!globalThis.THREE.EXRLoader) await addScript(HEIGHTMAP_LIB_URLS.exr);
      })();
      _exrScripts.catch(() => { _exrScripts = null; });
    }
    await _exrScripts;
  }
  const loader = new globalThis.THREE.EXRLoader();
  if (typeof loader.setDataType === 'function') loader.setDataType(globalThis.THREE.FloatType);
  return loader;
}
/** The browser's decoder: any picture it reads, as RGBA (row 0 = the top), no colour-space conversion. */
export async function decodeImage8(bytes) {
  const bmp = await createImageBitmap(new Blob([bytes]), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  if (typeof bmp.close === 'function') bmp.close();
  return { width: c.width, height: c.height, rgba: ctx.getImageData(0, 0, c.width, c.height).data };
}
/** The real loaders (a test passes stand-ins with the same shapes). */
export const HEIGHTMAP_LOADERS = Object.freeze({ png16: loadPngLib, exr: loadExrLoader, image8: decodeImage8 });

// ── decode ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const isPng = (b) => b.length > 25 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
/** Which reader a file needs: 'png16' (a PNG of bit depth 16), 'exr' (its magic number), else 'image8' (the browser). */
export function sniffHeightmap(name, bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length >= 4 && b[0] === 0x76 && b[1] === 0x2f && b[2] === 0x31 && b[3] === 0x01) return 'exr';
  if (isPng(b) && b[24] === 16) return 'png16'; // IHDR's bit depth
  return 'image8';
}

/** The grey of each pixel of `data` (`channels` per pixel): the mean of its colour channels (alpha ignored), / `max`. */
function greyOf(data, n, channels, max) {
  const out = new Float32Array(n);
  const colour = channels >= 3 ? 3 : 1;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < colour; k++) s += data[i * channels + k];
    out[i] = colour === 1 ? s / max : s / (colour * max);
  }
  return out;
}

/**
 * A heightmap file's bytes -> { width, height, values: Float32Array grey 0..1 (row 0 = the top), bits: 8 | 16 | 32, kind }.
 * `loaders` = { png16, exr, image8 } (HEIGHTMAP_LOADERS by default).
 */
export async function decodeHeightmap(name, bytes, loaders = HEIGHTMAP_LOADERS) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const kind = sniffHeightmap(name, b);
  if (kind === 'png16') {
    const lib = await loaders.png16();
    const png = lib.decode(b);
    const n = png.width * png.height;
    const channels = png.channels || 1;
    if (png.depth !== 16) return { width: png.width, height: png.height, values: greyOf(png.data, n, channels, (1 << png.depth) - 1), bits: png.depth, kind };
    return { width: png.width, height: png.height, values: greyOf(png.data, n, channels, 65535), bits: 16, kind };
  }
  if (kind === 'exr') {
    const loader = await loaders.exr();
    const ab = b.byteOffset === 0 && b.byteLength === b.buffer.byteLength ? b.buffer : b.slice().buffer;
    const t = loader.parse(ab);
    const { width, height, data } = t;
    const ch = Math.round(data.length / (width * height)) || 4;
    let lo = 0, hi = -Infinity;
    for (let i = 0; i < width * height; i++) { const v = data[i * ch]; if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    const span = hi - lo;
    const values = new Float32Array(width * height);
    for (let y = 0; y < height; y++) { // EXRLoader's rows run bottom-up (a texture); ours top-down
      const src = (height - 1 - y) * width;
      for (let x = 0; x < width; x++) { const v = data[(src + x) * ch]; values[y * width + x] = span > 0 && Number.isFinite(v) ? (v - lo) / span : 0; }
    }
    return { width, height, values, bits: 32, kind };
  }
  const img = await loaders.image8(b);
  return { width: img.width, height: img.height, values: greyOf(img.rgba, img.width * img.height, 4, 255), bits: 8, kind };
}

// ── resample onto a patch grid ──────────────────────────────────────────────────────────────────────────────────────
/** Per output index, the source taps [[index, weight], ...] of a `src` -> `dst` resample along one axis: the AREA mean when
 *  shrinking (each source pixel weighted by its overlap), linear between the pixel centres when enlarging. */
function taps(src, dst) {
  const out = [];
  const k = src / dst;
  for (let i = 0; i < dst; i++) {
    if (k >= 1) {
      const x0 = i * k, x1 = (i + 1) * k, list = [];
      for (let j = Math.floor(x0); j < Math.min(src, Math.ceil(x1)); j++) {
        const w = Math.min(x1, j + 1) - Math.max(x0, j);
        if (w > 0) list.push([j, w / k]);
      }
      out.push(list);
    } else {
      const x = Math.min(src - 1, Math.max(0, (i + 0.5) * k - 0.5));
      const j = Math.floor(x), f = x - j;
      out.push(f > 0 && j + 1 < src ? [[j, 1 - f], [j + 1, f]] : [[j, 1]]);
    }
  }
  return out;
}
/** Grey `values` (w x h, row 0 = the top) onto a cols x rows grid in the RASTER frame (row 0 = the bottom). */
export function resampleToGrid(values, w, h, cols, rows) {
  const tx = taps(w, cols), ty = taps(h, rows);
  const across = new Float32Array(cols * h);
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < cols; c++) {
      let s = 0;
      for (const [j, wt] of tx[c]) s += values[y * w + j] * wt;
      across[y * cols + c] = s;
    }
  }
  const out = new Float32Array(cols * rows);
  for (let i = 0; i < rows; i++) {
    const r = rows - 1 - i; // output image row i is raster row rows - 1 - i
    for (let c = 0; c < cols; c++) {
      let s = 0;
      for (const [j, wt] of ty[i]) s += across[j * cols + c] * wt;
      out[r * cols + c] = s;
    }
  }
  return out;
}

// ── the mapping range a file name carries (export writes it: name_<lo>-<hi>in.png) ──────────────────────────────────
const RANGE_RE = /_(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)in\.[a-z0-9]+$/i;
/** The mapping an exported file's name declares, or null: lo 0 = black is 0 (white = hi); else mid-grey is 0 (white = hi,
 *  black = lo). */
export function mappingFromName(name) {
  const m = RANGE_RE.exec(String(name || ''));
  if (!m) return null;
  const lo = Number(m[1]), hi = Number(m[2]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return lo === 0 ? { zero: 'black', whiteIn: hi, darkIn: hi } : { zero: 'mid', whiteIn: hi, darkIn: -lo };
}

export function _resetHeightmapLoadersForTests() { _png = null; _exrScripts = null; }

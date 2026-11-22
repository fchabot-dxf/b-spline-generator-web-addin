/**
 * height/export.js -- HEIGHT-PAINTER slice 2: a patch's COMPOSITE (inches) as a 16-bit greyscale PNG, with the mapping range
 * in the file name (name_<lo>-<hi>in.png) so core/height/import.js mappingFromName reads the same mapping back:
 *  - lo = 0 (nothing carved): black = 0 (transparent), white = hi            v = h / hi
 *  - lo < 0: mid-grey = 0, white = hi, black = lo                             v = 0.5 + h / (2 hi)   (h >= 0)
 *                                                                             v = 0.5 + h / (2 |lo|) (h < 0)
 * (import's mapImageValue inverts these exactly; each level is q = round(v x 65535)). Encoded by the same on-first-use
 * library as the import (fast-png, core/height/import.js HEIGHTMAP_LIB_URLS.png).
 */
import { loadPngLib } from './import.js';

/** 4 decimals: what the file name carries. */
const DECIMALS = 1e4;
/** The range of `heights`, always holding 0, widened OUTWARD to the 4 decimals the file name carries (a Float32 a hair over a
 *  round value keeps the round value). */
export function exportRange(heights) {
  let min = 0, max = 0;
  for (let k = 0; k < heights.length; k++) { const v = heights[k]; if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; } }
  const lo = min < 0 ? Math.floor(min * DECIMALS + 1e-3) / DECIMALS : 0;
  const hi = max > 0 ? Math.ceil(max * DECIMALS - 1e-3) / DECIMALS : 0;
  return { lo: lo === 0 ? 0 : lo, hi };
}

/** The 16-bit levels (rows TOP first: an image) of `heights` (cols x rows, raster frame: row 0 = the bottom) in `range`. */
export function heightsToLevels(heights, cols, rows, { lo, hi }) {
  const out = new Uint16Array(cols * rows);
  const level = (h) => {
    let v;
    if (lo === 0) v = hi > 0 ? h / hi : 0;
    else v = h >= 0 ? (hi > 0 ? 0.5 + h / (2 * hi) : 0.5) : 0.5 + h / (2 * -lo);
    return Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 65535); // a PNG level's own range
  };
  for (let r = 0; r < rows; r++) {
    const y = rows - 1 - r;
    for (let c = 0; c < cols; c++) out[y * cols + c] = level(heights[r * cols + c] || 0);
  }
  return out;
}

const num = (x) => String(Math.round(x * DECIMALS) / DECIMALS);
/** `name` (a patch name, made file-safe) + the range: 'Rose-1_0-0.5in.png'. */
export function exportFileName(name, { lo, hi }) {
  const safe = String(name || 'height').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'height';
  return `${safe}_${num(lo)}-${num(hi)}in.png`;
}

/** The PNG of `heights` (cols x rows) named after `name`: { bytes, fileName, range }. `png16` = the library loader. */
export async function exportHeightmapPng(heights, cols, rows, name, { png16 = loadPngLib } = {}) {
  const range = exportRange(heights);
  const lib = await png16();
  if (!lib || typeof lib.encode !== 'function') throw new Error('The PNG library cannot write files.');
  const bytes = lib.encode({ width: cols, height: rows, data: heightsToLevels(heights, cols, rows, range), depth: 16, channels: 1 });
  return { bytes, fileName: exportFileName(name, range), range };
}

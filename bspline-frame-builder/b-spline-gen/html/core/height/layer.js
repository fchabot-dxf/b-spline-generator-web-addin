/**
 * height/layer.js -- HEIGHT-PAINTER (HEIGHT-PAINTER-DESIGN.md, Fred's answer 2: "a placeable patch, like an STL"): the
 * height patch RECORD (P.heightLayers[i]), its declared defaults, and the stamp PASS it becomes. Self-contained like the
 * STL record (core/stl/layer.js): every setting lives in the record. The pass joins the app at exactly one place:
 * core/engine/rebuild.js _collectStampPasses, AFTER the STL passes.
 *
 * A saved record stores its OWN values; a field it lacks reads as the declared default (normaliseHeightLayer never writes
 * back to a loaded board -- AGENTS.md rule 3).
 *
 * Frames. The board: x right, y UP, inches from the board centre (buildHeightField: column i at x = -W/2 + i*dx, row j at
 * y = -H/2 + j*dy). The patch: centred at `position`, turned `rotation` degrees counter-clockwise (+Y up), `sizeIn` w x h;
 * its raster pixel (c, r) has its centre at u = -w/2 + (c + 0.5) w / cols, v = -h/2 + (r + 0.5) h / rows -- row 0 is the
 * patch's BOTTOM edge. A changed `sizeIn` stretches the painting (the raster keeps its pixels, like a placed image).
 */
import { encodeRaster } from './raster.js';
import { patchComposite, compositeKey, patchGrid, patchReady, ensurePatchDecoded } from './compose.js';

export const HEIGHT_BLENDS = Object.freeze(['add', 'max']);
export const HEIGHT_PLACEMENTS = Object.freeze(['withSurface', 'afterBack']); // core/stl/layer.js STL_PLACEMENTS' meanings
// No `surface` / Level: a height patch ALWAYS follows the terrain -- its values are added on the terrain under each point,
// like an SVG layer's art (Fred 2026-11-22, "No rigid"; HEIGHT-PAINTER-DESIGN.md section 10 answer 5).
/** Fred's answer 1: 100 pixels per inch (0.01 in a pixel). */
export const HEIGHT_PX_PER_IN = 100;

/** The declared defaults. `sizeIn` null = not stored: a new patch is given the whole board (newHeightLayer). */
export const HEIGHT_LAYER_DEFAULTS = Object.freeze({
  v: 1,
  enabled: true,
  name: 'Height',
  position: Object.freeze({ x: 0, y: 0 }),
  rotation: 0,          // degrees about Z
  sizeIn: null,
  pxPerIn: HEIGHT_PX_PER_IN, // the density the raster was made at
  raise: true,          // false = Carved: the painted heights cut into the surface
  blend: 'add',         // 'add': heights[k] += the painted height; 'max': only what stands above the surface shows
  zOffset: 0,           // inches, added where the patch is painted
  placement: 'withSurface',
});

/** A record with every absent field read as its declared default (a fresh object; the input is never touched). */
export function normaliseHeightLayer(rec) {
  const d = HEIGHT_LAYER_DEFAULTS;
  const r = rec || {};
  return {
    ...d, ...r,
    position: { ...d.position, ...(r.position || {}) },
    blend: HEIGHT_BLENDS.includes(r.blend) ? r.blend : d.blend,
    placement: HEIGHT_PLACEMENTS.includes(r.placement) ? r.placement : d.placement,
  };
}

let _idSeq = 0;
export const newHeightId = () => `hp${Date.now().toString(36)}${(_idSeq++).toString(36)}`;

/** A new, unpainted patch covering the whole board (`board` = { widthIn, heightIn }) at 100 px/in. Async (the encode). */
export async function newHeightLayer(board, name = 'Height') {
  const sizeIn = { w: board.widthIn, h: board.heightIn };
  const cols = Math.max(1, Math.round(sizeIn.w * HEIGHT_PX_PER_IN)), rows = Math.max(1, Math.round(sizeIn.h * HEIGHT_PX_PER_IN));
  const raster = await encodeRaster(new Float32Array(cols * rows), cols, rows);
  return { ...normaliseHeightLayer({}), id: newHeightId(), name, sizeIn, raster };
}

/** The patch's size (its stored one, else the board's). */
const sizeOf = (rec, board) => rec.sizeIn || { w: board.widthIn, h: board.heightIn };

/**
 * Board point (X, Y) (inches from the board centre, +Y up) -> fractional raster pixel { c, r } of patch `rec`, `inside`
 * = within the patch rectangle (edges included). The ONE mapping: the pass samples through it, the painter's pointer too.
 */
export function boardToPatchPixel(rawRec, X, Y, board = null) {
  return patchMapper(rawRec, board)(X, Y);
}
/** The same mapping as a function of (X, Y), its constants worked out once (the pass calls it per grid point). */
export function patchMapper(rawRec, board = null) {
  const rec = normaliseHeightLayer(rawRec);
  const { w, h } = sizeOf(rec, board || { widthIn: 0, heightIn: 0 });
  const { cols, rows } = patchGrid(rec);
  const a = (rec.rotation * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
  const px = rec.position.x, py = rec.position.y;
  return (X, Y) => {
    const dx = X - px, dy = Y - py;
    const u = cs * dx + sn * dy, v = -sn * dx + cs * dy;
    return { c: ((u + w / 2) * cols) / w - 0.5, r: ((v + h / 2) * rows) / h - 0.5, inside: Math.abs(u) <= w / 2 && Math.abs(v) <= h / 2, u, v };
  };
}

/** Bilinear sample of `data` (cols x rows) at fractional pixel (c, r), clamped to the edge pixels. */
export function sampleRaster(data, cols, rows, c, r) {
  const cc = Math.min(Math.max(c, 0), cols - 1), rr = Math.min(Math.max(r, 0), rows - 1);
  const c0 = Math.floor(cc), r0 = Math.floor(rr);
  const c1 = Math.min(c0 + 1, cols - 1), r1 = Math.min(r0 + 1, rows - 1);
  const fc = cc - c0, fr = rr - r0;
  const top = data[r0 * cols + c0] * (1 - fc) + data[r0 * cols + c1] * fc;
  const bot = data[r1 * cols + c0] * (1 - fc) + data[r1 * cols + c1] * fc;
  return top * (1 - fr) + bot * fr;
}

// ── the pass ────────────────────────────────────────────────────────────────────────────────────────────────────────
// One LRU cache: (raster h, shape, size, position, rotation, grid) -> the pass's { body, covered }. raise, blend, zOffset
// and placement are applied at pass time / in applyStampLayers, so they never resample.
export const HEIGHT_CACHE_CAP = 8;
const _sampled = new Map();
function lruGet(key) { const v = _sampled.get(key); if (v !== undefined) { _sampled.delete(key); _sampled.set(key, v); } return v; }
function lruSet(key, v) { _sampled.set(key, v); while (_sampled.size > HEIGHT_CACHE_CAP) _sampled.delete(_sampled.keys().next().value); return v; }

/** The patch resampled onto the build grid: body = the signed painted height (inches) per point, covered = inside the
 *  patch AND painted (0 is transparent: an unpainted / erased pixel has no effect on the board). */
function sampled(rec, data, grid) {
  const { nx, nz, widthIn, heightIn } = grid;
  const size = sizeOf(rec, grid);
  const g = patchGrid(rec);
  const key = JSON.stringify([compositeKey(rec), g.cols, g.rows, size.w, size.h, rec.position.x, rec.position.y, rec.rotation, nx, nz, widthIn, heightIn]);
  const hit = lruGet(key);
  if (hit) return hit;
  const { cols, rows } = g;
  const body = new Float32Array(nx * nz);
  const covered = new Uint8Array(nx * nz);
  const dx = widthIn / (nx - 1), dy = heightIn / (nz - 1);
  const map = patchMapper({ ...rec, sizeIn: size });
  for (let j = 0; j < nz; j++) {
    const y = -heightIn / 2 + j * dy;
    for (let i = 0; i < nx; i++) {
      const q = map(-widthIn / 2 + i * dx, y);
      if (!q.inside) continue;
      const v = sampleRaster(data, cols, rows, q.c, q.r);
      if (v === 0 || !Number.isFinite(v)) continue;
      body[j * nx + i] = v;
      covered[j * nx + i] = 1;
    }
  }
  return lruSet(key, { body, covered });
}

/**
 * One height record as a stamp pass (core/engine/apply-stamp-layers.js), or null when it contributes nothing this build.
 * The pass carries the SIGNED height itself as its body with depth +1 (Raised) / -1 (Carved), so the STL Add / Max branches
 * it shares are exact: Add = heights[k] +/- (zOffset + height), on the terrain under each point (no `surface`: it never
 * reaches the STL's Level branch). The mask arrays are SHARED with the cache: never write them.
 * A raster that is not decoded yet gives null and an entry in the error map (the rebuild decodes before it builds).
 */
export function heightPass(rawRec, grid) {
  const rec = normaliseHeightLayer(rawRec);
  // a slice-1 record (one raster) or a layered one (core/height/compose.js): the pass reads the patch's COMPOSITE
  if (rec.enabled === false || !patchGrid(rec) || !compositeKey(rec)) return null;
  const data = patchComposite(rec);
  if (!data) { recordHeightError(rec.id, 'The height patch is still being read.'); return null; }
  const { body, covered } = sampled(rec, data, grid);
  return {
    id: `height:${rec.id}`,
    kind: 'height',
    name: rec.name,
    enabled: true,
    svg: '1', // applyStampLayers' guard wants a non-empty marker; the mask is already built
    mask: { body, fillet: null, isStamped: covered },
    depth: rec.raise ? 1 : -1,
    carve: !rec.raise,
    blend: rec.blend,
    placement: rec.placement,
    zOffset: rec.zOffset,
    profile: 'flat',
    suppression: 0,
    smoothing: 0,
    edgeFilletRadius: 0,
    filletPower: 1,
  };
}

// ── errors (the STL error map's twin: record id -> message, refilled at each build) ──────────────────────────────────
const _errors = new Map();
export function recordHeightError(id, err) { _errors.set(String(id), String((err && err.message) || err)); }
export function getHeightErrors() { return Object.fromEntries(_errors); }

/** Every enabled height record as a pass, in list order. A record that throws is skipped and its message recorded. */
export function heightPasses(layers, grid) {
  _errors.clear();
  if (!Array.isArray(layers) || !layers.length) return [];
  const out = [];
  layers.forEach((l, i) => {
    try {
      const p = heightPass(l, grid);
      if (p) out.push(p);
    } catch (e) { recordHeightError(l && l.id != null ? l.id : `#${i}`, e); }
  });
  return out;
}

/** True when every enabled record's raster is decoded (the build digests read this, like the photo's readiness). */
export const heightRastersReady = (layers) => !Array.isArray(layers) || layers.every((l) => !l || l.enabled === false || !patchGrid(l) || !compositeKey(l) || patchReady(l));

/** Decode every enabled record's raster that is not in the cache yet (the rebuild awaits this before it builds). */
export async function decodeHeightLayers(layers) {
  if (!Array.isArray(layers)) return;
  await Promise.all(layers.filter((l) => l && l.enabled !== false && patchGrid(l) && compositeKey(l) && !patchReady(l))
    .map((l) => ensurePatchDecoded(l).catch((e) => recordHeightError(l.id, e))));
}

export function _resetHeightCachesForTests() { _sampled.clear(); _errors.clear(); }

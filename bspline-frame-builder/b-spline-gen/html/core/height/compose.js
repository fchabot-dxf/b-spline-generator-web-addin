/**
 * height/compose.js -- HEIGHT-PAINTER slice 2 (HEIGHT-PAINTER-DESIGN.md section 3 "Layers"): a height patch's LAYERS and
 * their COMPOSITE (what the stamp pass and the shaded view read). Pure apart from the decode / composite caches.
 *
 * A layered patch record holds `layers`, BOTTOM FIRST (layers[0] is composited first; the panel lists them top first):
 *   { id, name, kind: 'paint' | 'image', visible, opacity 0..1, blend: PATCH_LAYER_BLENDS, raster, mapping? }
 *  - paint: `raster` = heights in inches (core/height/raster.js, Float16);
 *  - image: `raster` = the imported picture's NORMALISED grey 0..1 (RASTER_ENC_U16: the file's 16 bits kept), read
 *    through its LIVE `mapping` { zero: 'black' | 'mid', whiteIn, darkIn } (mapImageValue), so a new mapping re-composites
 *    and never re-imports.
 * Every layer of a patch has the patch's pixel grid (cols x rows).
 *
 * BACKWARD COMPATIBLE (AGENTS.md rule 3): a slice-1 record has ONE `raster` and no `layers`. It reads as ONE paint layer
 * (normal, opacity 1) -- patchLayers() makes that view on the fly and never writes it back -- and its composite IS its
 * decoded raster (the same array: byte-identical by construction, pinned in tests/height-patch-layers.test.js).
 * A record is only turned into the layered shape by a user action on its layers (layeredRecord).
 *
 * The blends, at a pixel where the layer's height L is not 0 (0 = transparent: no effect), a = opacity:
 *   normal   out (1 - a) + L a     add  out + L a      subtract  out - L a
 *   max      out + (max(out, L) - out) a               min       out + (min(out, L) - out) a
 */
import { decodedRaster, ensureRasterDecoded, rasterHash } from './raster.js';

export const PATCH_LAYER_KINDS = Object.freeze(['paint', 'image']);
export const PATCH_LAYER_BLENDS = Object.freeze(['normal', 'add', 'max', 'min', 'subtract']);
export const IMAGE_ZEROS = Object.freeze(['black', 'mid']);
/** The declared defaults of a layer (an absent field reads as these). */
export const PATCH_LAYER_DEFAULTS = Object.freeze({ kind: 'paint', visible: true, opacity: 1, blend: 'normal' });
/** An image layer's mapping when nothing else says: black = 0 (transparent), white = 0.25 in. */
export const IMAGE_MAPPING_DEFAULTS = Object.freeze({ zero: 'black', whiteIn: 0.25, darkIn: 0.25 });
/** The id of the one layer a slice-1 record reads as (kept when that record becomes layered). */
export const BASE_LAYER_ID = 'base';

/** True when the record holds its own layer list. */
export const isLayered = (rec) => !!(rec && Array.isArray(rec.layers) && rec.layers.length);

/** A layer with every absent field read as its declared default (a fresh object; the input is never touched). */
export function normalisePatchLayer(l) {
  const d = PATCH_LAYER_DEFAULTS;
  const r = l || {};
  const out = {
    ...d, ...r,
    kind: PATCH_LAYER_KINDS.includes(r.kind) ? r.kind : d.kind,
    blend: PATCH_LAYER_BLENDS.includes(r.blend) ? r.blend : d.blend,
    visible: r.visible !== false,
    opacity: Number.isFinite(r.opacity) ? r.opacity : d.opacity,
  };
  if (out.kind === 'image') out.mapping = normaliseMapping(r.mapping);
  return out;
}
export function normaliseMapping(m) {
  const d = IMAGE_MAPPING_DEFAULTS, r = m || {};
  return {
    zero: IMAGE_ZEROS.includes(r.zero) ? r.zero : d.zero,
    whiteIn: Number.isFinite(r.whiteIn) ? r.whiteIn : d.whiteIn,
    darkIn: Number.isFinite(r.darkIn) ? r.darkIn : d.darkIn,
  };
}

/**
 * The record's layers, bottom first. A slice-1 record (one `raster`) reads as ONE paint layer, made here and never
 * stored (the record is not touched).
 */
export function patchLayers(rec) {
  if (!rec) return [];
  if (isLayered(rec)) return rec.layers.map(normalisePatchLayer);
  if (rec.raster) return [{ ...PATCH_LAYER_DEFAULTS, id: BASE_LAYER_ID, name: 'Paint 1', raster: rec.raster }];
  return [];
}

/** The patch's pixel grid { cols, rows } (its raster's, or its first layer's), or null. */
export function patchGrid(rec) {
  if (!rec) return null;
  const r = rec.raster || (isLayered(rec) ? rec.layers[0] && rec.layers[0].raster : null);
  return r && r.cols && r.rows ? { cols: r.cols, rows: r.rows } : null;
}

/** The layered shape of a record (a user action on its layers): a slice-1 record's raster becomes its first layer. */
export function layeredRecord(rec) {
  if (isLayered(rec)) return rec;
  const { raster, ...rest } = rec;
  return { ...rest, layers: patchLayers(rec) };
}

/** An image layer's grey `v` (0..1) as a height in inches through `mapping` (the live mapping; never stored). */
export function mapImageValue(v, mapping) {
  const m = mapping || IMAGE_MAPPING_DEFAULTS;
  if (m.zero === 'mid') return (v - 0.5) * 2 * (v >= 0.5 ? m.whiteIn : m.darkIn);
  return v * m.whiteIn;
}

/** A layer's heights from its decoded raster `data`: a paint layer's are its data; an image layer's are mapped. */
export function layerHeights(layer, data) {
  if (!data) return null;
  if (layer.kind !== 'image') return data;
  const m = normaliseMapping(layer.mapping);
  const out = new Float32Array(data.length);
  for (let k = 0; k < data.length; k++) out[k] = mapImageValue(data[k], m);
  return out;
}

/**
 * The composite of `items` ([{ heights, visible, opacity, blend }], bottom first) over `n` pixels: a new Float32Array.
 * A pixel a layer leaves at 0 is untouched by that layer (0 = transparent).
 */
export function compositeLayers(items, n) {
  const out = new Float32Array(n);
  for (const it of items) {
    if (!it || it.visible === false || !it.heights) continue;
    const a = Number.isFinite(it.opacity) ? it.opacity : 1;
    const L = it.heights;
    const blend = it.blend || 'normal';
    for (let k = 0; k < n; k++) {
      const v = L[k];
      if (v === 0 || !Number.isFinite(v)) continue;
      const o = out[k];
      if (blend === 'normal') out[k] = o * (1 - a) + v * a;
      else if (blend === 'add') out[k] = o + v * a;
      else if (blend === 'subtract') out[k] = o - v * a;
      else if (blend === 'max') out[k] = o + (Math.max(o, v) - o) * a;
      else if (blend === 'min') out[k] = o + (Math.min(o, v) - o) * a;
    }
  }
  return out;
}

// ── the composite cache: key -> Float32Array (LRU; SHARED: never write into one) ───────────────────────────────────────
export const COMPOSITE_CACHE_CAP = 8;
const _composites = new Map();
function cGet(key) { const v = _composites.get(key); if (v !== undefined) { _composites.delete(key); _composites.set(key, v); } return v; }
function cSet(key, v) { _composites.set(key, v); while (_composites.size > COMPOSITE_CACHE_CAP) _composites.delete(_composites.keys().next().value); return v; }

/**
 * What the composite of `rec` depends on, as one key: a slice-1 record's raster hash (so its pass and its picture caches
 * keep their slice-1 keys); a layered record's layers (each raster by its hash, its visibility, opacity, blend, mapping).
 */
export function compositeKey(rec) {
  if (!rec) return '';
  if (!isLayered(rec)) return rec.raster && rec.raster.h ? rec.raster.h : '';
  const g = patchGrid(rec) || { cols: 0, rows: 0 };
  const parts = patchLayers(rec).map((l) => [l.kind, l.raster && l.raster.h, l.visible, l.opacity, l.blend, l.kind === 'image' ? l.mapping : null]);
  return `L${rasterHash('layers', g.cols, g.rows, JSON.stringify(parts))}`;
}

/**
 * The composite heights of `rec` (sync), or undefined while a layer is not decoded yet. A slice-1 record's composite IS its
 * decoded raster (the same array). `override` = { layerId, data }: that layer's heights replaced (the painter's live view).
 */
export function patchComposite(rec, override = null) {
  if (!rec) return undefined;
  if (!isLayered(rec)) {
    if (override && override.layerId === BASE_LAYER_ID) return override.data;
    return rec.raster ? decodedRaster(rec.raster) : undefined;
  }
  const key = override ? null : compositeKey(rec);
  if (key) { const hit = cGet(key); if (hit) return hit; }
  const g = patchGrid(rec);
  if (!g) return undefined;
  const items = [];
  for (const l of patchLayers(rec)) {
    if (!l.visible) continue;
    const data = override && override.layerId === l.id ? override.data : (l.raster ? decodedRaster(l.raster) : undefined);
    if (!data) return undefined;
    items.push({ heights: override && override.layerId === l.id && l.kind !== 'image' ? data : layerHeights(l, data), visible: true, opacity: l.opacity, blend: l.blend });
  }
  const out = compositeLayers(items, g.cols * g.rows);
  return key ? cSet(key, out) : out;
}

/** True when the composite of `rec` can be read now. */
export const patchReady = (rec) => !!patchComposite(rec);

/** Decode every layer raster of `rec` not in the cache yet, then build its composite (so it is cached as one array). */
export async function ensurePatchDecoded(rec) {
  if (!rec) return undefined;
  if (!isLayered(rec)) return rec.raster ? ensureRasterDecoded(rec.raster) : undefined;
  const hit = patchComposite(rec);
  if (hit) return hit;
  const layers = patchLayers(rec).filter((l) => l.visible && l.raster);
  const datas = await Promise.all(layers.map((l) => ensureRasterDecoded(l.raster)));
  const key = compositeKey(rec);
  const again = cGet(key);
  if (again) return again;
  const g = patchGrid(rec);
  const out = compositeLayers(layers.map((l, i) => ({ heights: layerHeights(l, datas[i]), visible: true, opacity: l.opacity, blend: l.blend })), g.cols * g.rows);
  return cSet(key, out);
}

/** Every stored raster of `rec` (the record's own, or each layer's): the history blob store and the size readout read it. */
export const patchRasters = (rec) => (rec ? (isLayered(rec) ? rec.layers.map((l) => l && l.raster).filter(Boolean) : rec.raster ? [rec.raster] : []) : []);

export function _resetCompositeCacheForTests() { _composites.clear(); }

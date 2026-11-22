/**
 * core/stl/recent.js -- STL-CROP (STL-RELIEF-DESIGN.md section 14, Fred 2026-11-22: "we can have a recent model section"): the
 * models inserted lately, the FIRST choice of the library sheet's Library picker ('Recent'). No DOM.
 *
 * - Library models: stored PER DEVICE (localStorage, every read / write wrapped: a private window or blocked storage just shows
 *   none), never in P. Newest first, the latest RECENT_MAX kept (a display list, not a rule). An entry holds what the library's
 *   own Insert path needs again: the library id, the tile (its file url(s), title, pictures) and the crop box it was inserted with.
 *   Re-inserting a model moves its entry to the top.
 * - Own STL files: listed only while their original is still in memory this session (not persisted): main/stl-panel.js notes
 *   and forgets them here (noteLocalModel / forgetLocalModel); LOCAL_LIBRARY is the "library" their tiles name, so the sheet's
 *   preview and Insert take the one library path (core/stl/libraries.js LIBRARY_OPS.local).
 */

export const RECENT_KEY = 'bspline.stl.recent';
export const RECENT_MAX = 30;

/** The Library picker's 'Recent' entry (shown first, only when something is in it). */
export const RECENT_LIBRARY = Object.freeze({ id: 'recent', label: 'Recent', short: 'Recent', pageSize: 1000, credit: '' });
/** The library an own STL file's Recent tile names (its model is the in-memory original). */
export const LOCAL_LIBRARY = Object.freeze({
  id: 'local', label: 'Your STL files', short: 'Your file', format: 'local', licence: 'your own file', credit: '',
  sourceNote: 'Your file', pageSize: 1000, shape: false,
});

const store = (s) => (s !== undefined ? s : (typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null));
const isEntry = (e) => !!(e && typeof e === 'object' && typeof e.libraryId === 'string' && e.tile && typeof e.tile === 'object' && e.tile.id != null);

/** The stored library entries, newest first ([] when there are none or the storage cannot be read). */
export function readRecent(storage) {
  try {
    const s = store(storage);
    const list = s ? JSON.parse(s.getItem(RECENT_KEY) || '[]') : [];
    return Array.isArray(list) ? list.filter(isEntry) : [];
  } catch (_) {
    return [];
  }
}

/**
 * Put `entry` ({ libraryId, modelId, title, thumbUrl, previewUrl, tile, crop, insertedAt }) at the top: an earlier entry of the
 * same library + model is replaced; the latest RECENT_MAX are kept. Returns the new list (also when it could not be written).
 */
export function pushRecent(entry, storage) {
  if (!isEntry(entry)) return readRecent(storage);
  const key = (e) => `${e.libraryId}|${e.modelId ?? e.tile.id}`;
  const list = [entry, ...readRecent(storage).filter((e) => key(e) !== key(entry))].slice(0, RECENT_MAX);
  try { const s = store(storage); if (s) s.setItem(RECENT_KEY, JSON.stringify(list)); } catch (_) { /* storage unavailable: this session only */ }
  return list;
}

/** The Recent entry of a library insert: the tile as the library gave it (its urls) + the crop box (null = uncropped). */
export function recentEntryOf(tile, lib, crop = null, now = Date.now()) {
  return {
    libraryId: lib.id, modelId: tile.id, title: tile.title || '', thumbUrl: tile.thumbUrl || '', previewUrl: tile.previewUrl || '',
    tile: JSON.parse(JSON.stringify(tile)), crop: crop ? JSON.parse(JSON.stringify(crop)) : null, insertedAt: now,
  };
}

// ── own STL files, this session only ──
const _local = new Map(); // id -> { id, title, mesh }  (Map order = when noted; re-noting moves it to the end)
export function noteLocalModel(id, title, mesh) {
  if (id == null || !mesh) return;
  _local.delete(String(id));
  _local.set(String(id), { id: String(id), title: title || 'STL', mesh, at: Date.now() });
}
export function forgetLocalModel(id) { _local.delete(String(id)); }
export const localModel = (id) => _local.get(String(id)) || null;
/** The own files still in memory, newest first. */
export const localModels = () => [..._local.values()].reverse();
export function _resetLocalModelsForTests() { _local.clear(); }

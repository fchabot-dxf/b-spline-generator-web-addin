/**
 * core/stl/libraries.js -- SMK-LIBRARY (SMITHSONIAN-BROWSER-DESIGN.md section 9): the DECLARED list of model libraries the STL
 * sheet browses, and the one table of what each library does (search a page, download a model, name where a record came from).
 * A library is one entry in STL_LIBRARIES + one in LIBRARY_OPS: the sheet (main/stl-library-sheet.js) and the panel
 * (main/stl-panel.js) read these and nothing library-specific of their own. No DOM here.
 *
 * Fred 2026-11-22: "searching searches all libs at once and simply tells me which libs they're from along their sizes etc":
 * the sheet's default is ALL_LIBRARIES (every library, searched in parallel, interleaved); one library can be picked to get its
 * own filters back.
 */
import { SMITHSONIAN_SOURCE, fetchSmithsonianPage, downloadSmithsonianModelSoup } from './smithsonian.js';
import { SMK_SOURCE, fetchSmkPage, smkTypeNames, downloadSmkStlSoup } from './smk.js';
import { transformSoup } from './gltf.js';

/** Every library, in the order the sheet lists (and interleaves) them. */
export const STL_LIBRARIES = Object.freeze([SMITHSONIAN_SOURCE, SMK_SOURCE]);

/** The Library picker's first entry (its default): every library at once. */
export const ALL_LIBRARIES = Object.freeze({ id: 'all', label: 'All libraries' });

/** The sheet's title when it holds several libraries. */
export const LIBRARY_SHEET_LABEL = '3D model libraries';

export function libraryById(id) { return STL_LIBRARIES.find((l) => l.id === id) || null; }

/** The library a stored record's `source` came from (a record from before SMK has provider 'smithsonian'). */
export function libraryOfRecordSource(src) { return (src && libraryById(src.provider)) || SMITHSONIAN_SOURCE; }

/**
 * Per library: the searches one query runs (`queries(filters)` -> a list of per-feed options; the sheet runs each as its own
 * paged feed), how a page is fetched, the model download, the record's `source`, and the file a tile downloads.
 *   filters = { q, unit, type } (unit: the Smithsonian museum; type: SMK's Type; each only when that library is the one picked)
 */
export const LIBRARY_OPS = Object.freeze({
  smithsonian: Object.freeze({
    queries: ({ q = '', unit = '' } = {}) => [{ q, unit }],
    fetchPage: (lib, opts, page, fetchImpl) => fetchSmithsonianPage({ ...opts, page }, fetchImpl, lib),
    fileUrl: (tile) => tile.glbUrl,
    // the ONE Smithsonian download (its Voyager pose; preview = the small Thumb GLB)
    download: (lib, ref, fetchImpl, { preview = false, onFullModel } = {}) =>
      downloadSmithsonianModelSoup({ modelId: ref.id, glbUri: ref.uri, preview, onFullModel }, fetchImpl, lib),
    sourceRecord: (tile) => ({ provider: 'smithsonian', modelUrl: tile.id, title: tile.title, uri: tile.glbUrl }),
    refOf: (src) => ({ id: src.modelUrl, uri: src.uri }),
  }),
  smk: Object.freeze({
    // a Type of several object_names = one search per name (the API ANDs two name filters)
    queries: ({ q = '', type = 'all' } = {}) => { const names = smkTypeNames(type); return names.length ? names.map((name) => ({ q, name })) : [{ q }]; },
    fetchPage: (lib, opts, page, fetchImpl) => fetchSmkPage({ ...opts, page }, fetchImpl, lib),
    fileUrl: (tile) => tile.stlUrl,
    // the STL as stored (Z-up, standing); the 3D preview turns it upright for the view's front camera (lib.previewTurn)
    download: async (lib, ref, fetchImpl, { preview = false, onProgress } = {}) => {
      const soup = await downloadSmkStlSoup(ref.uri, fetchImpl, { onProgress }, lib);
      return preview ? transformSoup(soup, { rotation: lib.previewTurn }) : soup;
    },
    sourceRecord: (tile) => ({ provider: 'smk', id: tile.id, title: tile.title, uri: tile.stlUrl }),
    refOf: (src) => ({ id: src.id, uri: src.uri }),
  }),
});

export const opsOf = (lib) => LIBRARY_OPS[lib.id];

/** Download library `lib`'s model `ref` ({ id, uri }) as ONE soup (Insert, Turn in 3D, the Stored-detail re-download). */
export function downloadLibrarySoup(lib, ref, fetchImpl, opts = {}) {
  return opsOf(lib).download(lib, ref, fetchImpl, opts);
}

/** Bytes -> '0.8 MB' / '15 MB' (decimal megabytes, as download sizes are quoted; one decimal under 10 MB). */
export function mbNumber(bytes) {
  const mb = bytes / 1e6;
  return mb < 10 ? mb.toFixed(1) : String(Math.round(mb));
}
export const mbText = (bytes) => `${mbNumber(bytes)} MB`;

/**
 * The size of the file at `url` without downloading it: a 1-byte Range request, read from Content-Range's total (a 200 answer:
 * its Content-Length, the body cancelled unread). Unknown -> null. Used for the SELECTED tile only (never one per grid tile).
 */
export async function fetchDownloadSize(url, fetchImpl) {
  try {
    const res = await fetchImpl(url, { headers: { Range: 'bytes=0-0' } });
    if (!res) return null;
    const range = res.headers && res.headers.get('content-range');
    const m = range && /\/(\d+)\s*$/.exec(range);
    let n = m ? Number(m[1]) : null;
    if (n == null && res.status === 200) n = Number(res.headers.get('content-length')) || null;
    try { await res.body?.cancel?.(); } catch (_) { /* nothing to cancel */ }
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch (_) {
    return null;
  }
}

/**
 * core/stl/smithsonian.js -- SMITHSONIAN-BROWSER (SMITHSONIAN-BROWSER-DESIGN.md): the Smithsonian's open 3D collection as ONE
 * declared source. The 3D file API (3d-api.si.edu, measured live 2026-11-22) needs no key and answers with CORS *, so the browser
 * calls it directly. The API lists one row per FILE; `modelFilter` (the Low GLB) is the one-row-per-model query, and each row's
 * own uri is the model to download. The model's UPRIGHT pose and its parts come from its Voyager scene (scene.svx.json beside
 * the GLB); downloadSmithsonianModelSoup is the ONE download every path uses (Insert, the Stored-detail re-download, Turn in 3D).
 * No DOM here: the sheet (main/stl-library-sheet.js) renders what these return.
 * A later library (Kenney, Quaternius) is another declared source, not another mechanism.
 */
import { soupFromGlbParts } from './gltf.js';

export const SMITHSONIAN_SOURCE = Object.freeze({
  id: 'smithsonian',
  label: 'Smithsonian 3D',
  api: 'https://3d-api.si.edu/api/v1.0/content/file/search',
  modelFilter: Object.freeze({ file_type: 'glb', file_quality: 'Low' }),       // one row per model: its Low GLB (~0.8 MB, Draco)
  previewGlbFilter: Object.freeze({ file_type: 'glb', file_quality: 'Thumb' }), // the 20k-triangle GLB the preview turns in 3D
  pageSize: 24,
  partsRows: 50,                         // the per-model Low-GLB lookup's rows (a bust and its base = 2 rows of one model)
  thumbName: 'scene-image-thumb.jpg',    // beside the GLB, ~10 KB (the grid tile)
  previewName: 'scene-image-medium.jpg', // beside the GLB, ~123 KB (the preview pane's large picture)
  sceneName: 'scene.svx.json',           // beside the GLB, ~9 KB: the Voyager scene (each part's GLBs and its upright pose)
  sceneModel: Object.freeze({ usage: 'Web3D', quality: 'Low' }),     // the scene derivative Insert downloads
  scenePreview: Object.freeze({ usage: 'Web3D', quality: 'Thumb' }), // the scene derivative Turn in 3D downloads
  credit: 'Smithsonian Open Access (CC0). Models load from 3d-api.si.edu.',
  // the mirrored catalog (core/stl/catalog.js format; tools/build_stl_catalog.py), relative to the app root: the Shape filter's data
  catalogPath: 'data/stl-catalog-smithsonian.json',
  // every owning_unit with Low GLBs (design section 2 counts; FSG has none and is left out), with a readable name
  museums: Object.freeze([
    ['NMNHMAMMALS', 'Natural History: Mammals'],
    ['NMNHINV', 'Natural History: Invertebrates'],
    ['NMNHPALEO', 'Natural History: Paleobiology'],
    ['NMNHEDUCATION', 'Natural History: Education'],
    ['NMNHFISHES', 'Natural History: Fishes'],
    ['NMNHHERPS', 'Natural History: Reptiles and Amphibians'],
    ['NMAH', 'American History'],
    ['NMAAHC', 'African American History and Culture'],
    ['NASM', 'Air and Space'],
    ['NPG', 'Portrait Gallery'],
    ['CHNDM', 'Cooper Hewitt (design)'],
    ['SAAM', 'American Art'],
    ['SAO', 'Astrophysical Observatory'],
    ['DPO', 'Digitization Program Office'],
    ['NMAfA', 'African Art'],
    ['OFEO-SG', 'Smithsonian Gardens'],
  ].map((m) => Object.freeze(m))),
});

/** One page of the collection: q only when non-empty, owning_unit only when set, the model filter, rows / start. */
export function smithsonianSearchUrl({ q = '', unit = '', page = 0 } = {}, source = SMITHSONIAN_SOURCE) {
  const p = new URLSearchParams();
  const query = String(q || '').trim();
  if (query) p.set('q', query);
  if (unit) p.set('owning_unit', unit);
  for (const [k, v] of Object.entries(source.modelFilter)) p.set(k, v);
  p.set('rows', String(source.pageSize));
  p.set('start', String(Math.max(0, page | 0) * source.pageSize));
  return `${source.api}?${p}`;
}

const folderOf = (uri) => uri.slice(0, uri.lastIndexOf('/'));

/**
 * THE tile of one model (the API search and the mirrored catalog, core/stl/catalog.js, both build it here):
 * { id, title, glbUrl, thumbUrl, previewUrl }, the pictures beside the GLB.
 */
export function tileFromGlb({ id, title, uri }, source = SMITHSONIAN_SOURCE) {
  const folder = folderOf(uri);
  return { id, title: String(title || ''), glbUrl: uri, thumbUrl: `${folder}/${source.thumbName}`, previewUrl: `${folder}/${source.previewName}` };
}

/** The API's answer -> { total, tiles }: one tile per model (a model listed twice keeps its first row), rows without a uri skipped. */
export function parseSmithsonianSearch(json, source = SMITHSONIAN_SOURCE) {
  const tiles = [];
  const seen = new Set();
  for (const row of (json && Array.isArray(json.rows) ? json.rows : [])) {
    const c = row && row.content;
    if (!c || !c.uri) continue;
    const id = c.model_url || c.uri;
    if (seen.has(id)) continue;
    seen.add(id);
    tiles.push(tileFromGlb({ id, title: row.title, uri: c.uri }, source));
  }
  return { total: Number(json && json.rowCount) || 0, tiles };
}

async function getJson(url, fetchImpl) {
  let res;
  try { res = await fetchImpl(url); } catch (e) { throw new Error(`Could not reach 3d-api.si.edu (${e && e.message ? e.message : e}).`); }
  if (!res || !res.ok) throw new Error(`The Smithsonian search answered ${res ? res.status : '?'}${res && res.statusText ? ` ${res.statusText}` : ''}.`);
  return res.json();
}

/** Fetch and parse one page. A refused request throws a readable Error. */
export async function fetchSmithsonianPage(opts = {}, fetchImpl = fetch, source = SMITHSONIAN_SOURCE) {
  return parseSmithsonianSearch(await getJson(smithsonianSearchUrl(opts, source), fetchImpl), source);
}

/** The lookup of one model's small preview GLB (measured: 1 or 2 rows per model). */
export function smithsonianThumbGlbUrl(modelId, source = SMITHSONIAN_SOURCE) {
  const p = new URLSearchParams({ model_url: String(modelId || '') });
  for (const [k, v] of Object.entries(source.previewGlbFilter)) p.set(k, v);
  return `${source.api}?${p}`;
}

/** The row choice: the first row with a GLB uri (the rows carry no file size); none -> null. */
export function pickThumbGlbUri(json) {
  for (const row of (json && Array.isArray(json.rows) ? json.rows : [])) {
    const uri = row && row.content && row.content.uri;
    if (uri && /\.glb$/i.test(uri)) return uri;
  }
  return null;
}

/** The model's preview GLB uri, or null when it has none. */
export async function fetchSmithsonianThumbGlb(modelId, fetchImpl = fetch, source = SMITHSONIAN_SOURCE) {
  return pickThumbGlbUri(await getJson(smithsonianThumbGlbUrl(modelId, source), fetchImpl));
}

/**
 * The lookup of ALL of one model's Low GLBs: a model in several parts (a bust and its base) lists one Low GLB row per part,
 * while the search keeps one tile per model. model_url + the model filter + rows = partsRows.
 */
export function smithsonianModelGlbsUrl(modelId, source = SMITHSONIAN_SOURCE) {
  const p = new URLSearchParams({ model_url: String(modelId || '') });
  for (const [k, v] of Object.entries(source.modelFilter)) p.set(k, v);
  p.set('rows', String(source.partsRows));
  return `${source.api}?${p}`;
}

/** Every GLB uri of model `modelId` in the lookup's answer (a row naming another model is not a part of it), in row order, once each. */
export function pickModelGlbUris(json, modelId) {
  const out = [];
  for (const row of (json && Array.isArray(json.rows) ? json.rows : [])) {
    const c = row && row.content;
    const uri = c && c.uri;
    if (!uri || !/\.glb$/i.test(uri) || out.includes(uri)) continue;
    if (c.model_url && modelId && c.model_url !== modelId) continue;
    out.push(uri);
  }
  return out;
}

/**
 * The GLBs to download for one model: every Low part from the lookup; a failed lookup, or one that lists none, falls back to
 * `fallbackUri` (the tile's own GLB). No model id: the fallback alone.
 */
export async function fetchSmithsonianModelGlbs(modelId, fallbackUri, fetchImpl = fetch, source = SMITHSONIAN_SOURCE) {
  if (!modelId) return fallbackUri ? [fallbackUri] : [];
  let uris = [];
  try { uris = pickModelGlbUris(await getJson(smithsonianModelGlbsUrl(modelId, source), fetchImpl), modelId); } catch (_) { uris = []; }
  return uris.length ? uris : (fallbackUri ? [fallbackUri] : []);
}

// ── the Voyager scene: the model's parts and their upright pose ──────────────────────────────────────────────────────────
/** The model's Voyager scene, beside its GLB. */
export function sceneUrlOf(glbUri, source = SMITHSONIAN_SOURCE) {
  return `${folderOf(glbUri)}/${source.sceneName}`;
}

/**
 * A Voyager scene (scene.svx.json) -> one entry per model (each part of the model): { glbUrl (its Web3D Low GLB, absolute),
 * thumbGlbUrl (its Web3D Thumb GLB, absolute, or null), rotation ([qx, qy, qz, qw] or null), translation ([x, y, z] or null) }.
 * Rotating then translating a part's points stands it upright (+Y up) facing the Voyager camera (+Z). A model entry without a
 * Web3D Low GLB is left out; not a scene -> [].
 */
export function parseVoyagerScene(json, folder, source = SMITHSONIAN_SOURCE) {
  const abs = (uri) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(uri) ? uri : `${folder}/${uri}`);
  const assetOf = (m, want) => {
    for (const d of (Array.isArray(m.derivatives) ? m.derivatives : [])) {
      if (!d || d.usage !== want.usage || d.quality !== want.quality) continue;
      for (const a of (Array.isArray(d.assets) ? d.assets : [])) if (a && a.uri && /\.glb$/i.test(a.uri)) return abs(a.uri);
    }
    return null;
  };
  const out = [];
  for (const m of (json && Array.isArray(json.models) ? json.models : [])) {
    if (!m) continue;
    const glbUrl = assetOf(m, source.sceneModel);
    if (!glbUrl) continue;
    out.push({
      glbUrl,
      thumbGlbUrl: assetOf(m, source.scenePreview),
      rotation: Array.isArray(m.rotation) ? m.rotation.slice() : null,
      translation: Array.isArray(m.translation) ? m.translation.slice() : null,
    });
  }
  return out;
}

/** Fetch and parse the scene beside `glbUri`. A refused request (or a body that is not JSON) throws. */
export async function fetchVoyagerScene(glbUri, fetchImpl = fetch, source = SMITHSONIAN_SOURCE) {
  return parseVoyagerScene(await getJson(sceneUrlOf(glbUri, source), fetchImpl), folderOf(glbUri), source);
}

/**
 * THE download of one library model as ONE soup (Insert, the Stored-detail re-download and Turn in 3D all use it).
 * FIRST the model's Voyager scene: every part listed there, its Low GLB (`preview`: its Thumb GLB; a part without one: its Low,
 * and `onFullModel()` is called once), each put in its own upright pose. A scene that is missing, unreadable or lists no part:
 * the parts lookup as before (`preview`: the Thumb lookup first; none -> `onFullModel()` and the Low parts), no pose.
 */
export async function downloadSmithsonianModelSoup({ modelId, glbUri, preview = false, onFullModel } = {}, fetchImpl = fetch, source = SMITHSONIAN_SOURCE) {
  let scene = [];
  try { scene = await fetchVoyagerScene(glbUri, fetchImpl, source); } catch (_) { scene = []; }
  if (scene.length) {
    if (preview && scene.some((e) => !e.thumbGlbUrl)) onFullModel?.();
    const parts = scene.map((e) => ({ url: (preview && e.thumbGlbUrl) || e.glbUrl, rotation: e.rotation, translation: e.translation }));
    return soupFromGlbParts(parts, fetchImpl);
  }
  let uris = null;
  if (preview) {
    const thumb = await fetchSmithsonianThumbGlb(modelId, fetchImpl, source);
    if (thumb) uris = [thumb]; else onFullModel?.();
  }
  if (!uris) uris = await fetchSmithsonianModelGlbs(modelId, glbUri, fetchImpl, source);
  return soupFromGlbParts(uris.map((url) => ({ url })), fetchImpl);
}

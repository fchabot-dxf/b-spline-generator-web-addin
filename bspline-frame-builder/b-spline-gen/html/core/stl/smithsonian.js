/**
 * core/stl/smithsonian.js -- SMITHSONIAN-BROWSER (SMITHSONIAN-BROWSER-DESIGN.md): the Smithsonian's open 3D collection as ONE
 * declared source. The 3D file API (3d-api.si.edu, measured live 2026-11-22) needs no key and answers with CORS *, so the browser
 * calls it directly. The API lists one row per FILE; `modelFilter` (the Low GLB) is the one-row-per-model query, and each row's
 * own uri is the model to download. Pure (no DOM): the sheet (main/stl-library-sheet.js) renders what these return.
 * A later library (Kenney, Quaternius) is another declared source, not another mechanism.
 */

export const SMITHSONIAN_SOURCE = Object.freeze({
  id: 'smithsonian',
  label: 'Smithsonian 3D',
  api: 'https://3d-api.si.edu/api/v1.0/content/file/search',
  modelFilter: Object.freeze({ file_type: 'glb', file_quality: 'Low' }),       // one row per model: its Low GLB (~0.8 MB, Draco)
  previewGlbFilter: Object.freeze({ file_type: 'glb', file_quality: 'Thumb' }), // the 20k-triangle GLB the preview turns in 3D
  pageSize: 24,
  thumbName: 'scene-image-thumb.jpg',    // beside the GLB, ~10 KB (the grid tile)
  previewName: 'scene-image-medium.jpg', // beside the GLB, ~123 KB (the preview pane's large picture)
  credit: 'Smithsonian Open Access (CC0). Models load from 3d-api.si.edu.',
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
    const folder = folderOf(c.uri);
    tiles.push({ id, title: String(row.title || ''), glbUrl: c.uri, thumbUrl: `${folder}/${source.thumbName}`, previewUrl: `${folder}/${source.previewName}` });
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

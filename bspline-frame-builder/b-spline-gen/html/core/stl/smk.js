/**
 * core/stl/smk.js -- SMK-LIBRARY (SMITHSONIAN-BROWSER-DESIGN.md section 9, Fred 2026-11-22: "Smk for the win"; no-key,
 * no-login libraries only): SMK, Statens Museum for Kunst (the National Gallery of Denmark), as the SECOND declared library of
 * the STL sheet. Measured live 2026-11-22 (plain curl, tests/fixtures/smk/):
 *   - search: GET api.smk.dk/api/v1/art/search/?keys=<words | *>&filters=[has_3d_file:true]&offset&rows&lang=en -> { found: 373,
 *     items: [...] }, no key, Access-Control-Allow-Origin: *. Each item: titles, object_names ([{ name }], English with lang=en),
 *     rights (371 of 373 = the Public Domain Mark), image_thumbnail (IIIF, CORS *), dimensions, and files_3D: [{ url, mime_type,
 *     file_size }] (the 3D file reference; file_size is missing on some rows).
 *   - a second filter on object_names NARROWS (`[object_names:Relief]` -> 41); two object_names filters are ANDed (0 found), so a
 *     type made of several names runs one search per name (the sheet merges them as it merges libraries).
 *   - the STL: api.smk.dk/api/v1/download-3d/<file>.stl, no auth, CORS *, byte ranges OK. Binary STL. 367 of 373 items list a
 *     `_small` STL (10-20 MB; one is named `_small8`); the full ones run ~10-500 MB. Z-UP and STANDING, 130 mm tall (KAS2906/8,
 *     a relief: 49 x 21 x 130 mm, thin along Y = its face points along -/+Y, not up).
 * Pure helpers, no DOM: the sheet (main/stl-library-sheet.js) renders what these return, in the SAME tile shape as the
 * Smithsonian's ({ id, title, format, stlUrl, thumbUrl, previewUrl } + what SMK lists: sizeBytes, dims, licence, type).
 */
import { parseStl } from './parse.js';

/**
 * The Type picker: [id, label, the API's object_names (lang=en) it covers]. Every object_name the 373 models carry (2026-11-22:
 * Statue 127, Bust 95, Head 70, Relief 41, Group of statues 14, Torso 7, Statuette 5, Herma 5, Stele 2, Group of statuettes 2,
 * Sculpture in the round 2, Tympanum 1, Kore 1, Sculpture related to architecture 1) is in exactly one type. A name SMK adds
 * later shows under All types only.
 */
export const SMK_TYPES = Object.freeze([
  ['all', 'All types', []],
  ['relief', 'Relief', ['Relief', 'Tympanum', 'Stele']],
  ['bust', 'Bust', ['Bust', 'Herma']],
  ['head', 'Head', ['Head']],
  ['statue', 'Statue', ['Statue', 'Statuette', 'Group of statues', 'Group of statuettes', 'Torso', 'Kore']],
  ['other', 'Other', ['Sculpture in the round', 'Sculpture related to architecture']],
].map(([id, label, names]) => Object.freeze([id, label, Object.freeze(names)])));

export const SMK_SOURCE = Object.freeze({
  id: 'smk',
  label: 'SMK (Denmark)',
  short: 'SMK',                          // the tile badge
  host: 'api.smk.dk',
  api: 'https://api.smk.dk/api/v1/art/search/',
  baseFilter: '[has_3d_file:true]',
  lang: 'en',
  pageSize: 24,
  format: 'stl',
  smallStl: /_small\d*\.stl$/i,           // the model Insert downloads (10-20 MB); none listed: the smallest STL
  thumbSize: '!200,200',                  // IIIF size: the grid tile (~40 KB)
  previewSize: '!1024,1024',              // IIIF size: the preview pane's large picture
  publicDomain: Object.freeze(['https://creativecommons.org/publicdomain/mark/1.0/']), // only these rights are shown
  licence: 'Public domain (PDM 1.0)',
  credit: 'SMK — National Gallery of Denmark, public domain (PDM). Models load from api.smk.dk.',
  sourceNote: 'From SMK, the National Gallery of Denmark (public domain)',
  // the orientation rule at Insert: the STL stands Z-up, so it is laid flat once (core/stl/orient.js layFlatFrame)
  orient: 'layFlat',
  // Turn in 3D shows it UPRIGHT as stored: -90 degrees about X takes its Z-up to the view's +Y up and its -Y side to the camera
  previewTurn: Object.freeze([-Math.SQRT1_2, 0, 0, Math.SQRT1_2]),
  shape: false,                           // no shape data to filter by (a shape-filtered All search leaves SMK out)
  types: SMK_TYPES,
});

/** The object_names one Type covers: [] for All types (no name filter). */
export function smkTypeNames(type, source = SMK_SOURCE) {
  const t = source.types.find(([id]) => id === type);
  return t ? t[2].slice() : [];
}

/** One page of the collection: keys = the words (or *), the 3D filter (+ one object_name when given), offset / rows, English. */
export function smkSearchUrl({ q = '', name = '', page = 0 } = {}, source = SMK_SOURCE) {
  const p = new URLSearchParams();
  p.set('keys', String(q || '').trim() || '*');
  p.set('filters', name ? `${source.baseFilter},[object_names:${name}]` : source.baseFilter);
  p.set('offset', String(Math.max(0, page | 0) * source.pageSize));
  p.set('rows', String(source.pageSize));
  p.set('lang', source.lang);
  return `${source.api}?${p}`;
}

/** The STL an item's tile downloads: the `_small` one; none: the smallest STL listed (by file_size); no STL: null. */
export function pickSmkStl(files, source = SMK_SOURCE) {
  const stls = (Array.isArray(files) ? files : []).filter((f) => f && f.url && (/\.stl$/i.test(f.url) || f.mime_type === 'model/stl'));
  const small = stls.find((f) => source.smallStl.test(f.url));
  if (small) return small;
  const sized = stls.filter((f) => Number.isFinite(f.file_size)).sort((a, b) => a.file_size - b.file_size);
  return sized[0] || stls[0] || null;
}

/** An IIIF image id from the item: its thumbnail's (iip-thumb.smk.dk, cached) without the region / size / rotation / quality. */
function iiifBase(item) {
  const m = /^(.+)\/full\/[^/]+\/[^/]+\/[^/]+$/.exec(String(item.image_thumbnail || ''));
  return m ? m[1] : (item.image_iiif_id || null);
}

/** The item's English title (titles[] in several languages, 'engelsk' = English), else its first one. */
function titleOf(item) {
  const ts = Array.isArray(item.titles) ? item.titles : [];
  const t = ts.find((x) => x && x.language === 'engelsk') || ts[0];
  return String((t && t.title) || item.object_number || '');
}

/** The type (SMK_TYPES id) of an object_name; one not declared: 'other'. */
export function smkTypeOf(name, source = SMK_SOURCE) {
  const t = source.types.find(([id, , names]) => id !== 'all' && names.includes(name));
  return t ? t[0] : 'other';
}

/** The object's own size from the listing: { w, h, d, unit } (the first height / width / depth in one unit), or null. */
function dimsOf(item) {
  const out = {};
  let unit = null;
  for (const d of (Array.isArray(item.dimensions) ? item.dimensions : [])) {
    const key = { width: 'w', height: 'h', depth: 'd' }[d && d.type];
    const v = Number(d && d.value);
    if (!key || key in out || !Number.isFinite(v)) continue;
    if (unit && d.unit !== unit) continue;
    unit = d.unit;
    out[key] = v;
  }
  return unit && Object.keys(out).length ? { ...out, unit } : null;
}

/**
 * The API's answer -> { total, tiles, dropped: { notPublicDomain, noStl } }. Only PUBLIC-DOMAIN items (rights in
 * source.publicDomain) become tiles; an item with no STL is skipped. A tile: { id (object_number), title, format: 'stl', stlUrl,
 * sizeBytes (null when not listed), thumbUrl / previewUrl (IIIF sizes; '' when the item has no image), objectName, type, dims,
 * licence }.
 */
export function parseSmkSearch(json, source = SMK_SOURCE) {
  const tiles = [];
  const dropped = { notPublicDomain: 0, noStl: 0 };
  for (const item of (json && Array.isArray(json.items) ? json.items : [])) {
    if (!item) continue;
    if (!source.publicDomain.includes(item.rights)) { dropped.notPublicDomain++; continue; }
    const stl = pickSmkStl(item.files_3D, source);
    if (!stl) { dropped.noStl++; continue; }
    const base = iiifBase(item);
    const objectName = (Array.isArray(item.object_names) && item.object_names[0] && item.object_names[0].name) || '';
    tiles.push({
      id: String(item.object_number || item.id),
      title: titleOf(item),
      format: 'stl',
      stlUrl: stl.url,
      sizeBytes: Number.isFinite(stl.file_size) ? stl.file_size : null,
      thumbUrl: base ? `${base}/full/${source.thumbSize}/0/default.jpg` : '',
      previewUrl: base ? `${base}/full/${source.previewSize}/0/default.jpg` : '',
      objectName,
      type: smkTypeOf(objectName, source),
      dims: dimsOf(item),
      licence: source.licence,
    });
  }
  return { total: Number(json && json.found) || 0, tiles, dropped };
}

const why = (e) => (e && e.message ? e.message : String(e));

async function getJson(url, fetchImpl, source) {
  let res;
  try { res = await fetchImpl(url); } catch (e) { throw new Error(`could not reach ${source.host} (${why(e)}).`); }
  if (!res || !res.ok) throw new Error(`${source.host} answered ${res ? res.status : '?'}${res && res.statusText ? ` ${res.statusText}` : ''}.`);
  return res.json();
}

/** Fetch and parse one page (`name`: one object_name, or none). A refused request throws a readable Error. */
export async function fetchSmkPage(opts = {}, fetchImpl = fetch, source = SMK_SOURCE) {
  return parseSmkSearch(await getJson(smkSearchUrl(opts, source), fetchImpl, source), source);
}

/**
 * A response's bytes, reporting progress: onProgress(bytesSoFar, totalBytes | null) per chunk (the body read in chunks when the
 * browser gives a stream; else at once).
 */
export async function readWithProgress(res, onProgress) {
  const total = Number(res.headers && res.headers.get && res.headers.get('content-length')) || null;
  const reader = onProgress && res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;
  if (!reader) { const buf = await res.arrayBuffer(); onProgress?.(buf.byteLength, total); return buf; }
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.byteLength;
    onProgress(got, total);
  }
  const out = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out.buffer;
}

/** Download one SMK STL and read it as a triangle soup (as stored: Z-up, standing). A refused download throws. */
export async function downloadSmkStlSoup(url, fetchImpl = fetch, { onProgress } = {}, source = SMK_SOURCE) {
  let res;
  try { res = await fetchImpl(url); } catch (e) { throw new Error(`could not reach ${source.host} (${why(e)}).`); }
  if (!res || !res.ok) throw new Error(`${source.host} answered ${res ? res.status : '?'}${res && res.statusText ? ` ${res.statusText}` : ''}.`);
  return parseStl(await readWithProgress(res, onProgress)).soup;
}

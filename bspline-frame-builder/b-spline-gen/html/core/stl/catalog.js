/**
 * core/stl/catalog.js -- SMITHSONIAN-BROWSER (SMITHSONIAN-BROWSER-DESIGN.md section 8, Fred 2026-11-22): the SHAPE filter over a
 * MIRRORED catalog of a model library. The format is SOURCE-NEUTRAL (a later library writes the same fields and names itself):
 *
 *   { v: 1, source: '<source id>', built: 'YYYY-MM-DD', base: '<common uri prefix>',
 *     models: [{ id, t: title, u: owning unit ('' = none), g: <the model's GLB uri WITHOUT base>, d: [small, mid, large] | null }] }
 *
 * d = the model's box sides, sorted (from its GLB's POSITION min / max, tools/build_stl_catalog.py); null = no box read.
 * Flat = small / mid <= ratio (a plate: thin against BOTH other sides); Rod = mid / large <= ratio (long and thin).
 * Pure helpers, no DOM: the sheet (main/stl-library-sheet.js) renders what these return, with the SAME tiles the API search gives.
 */
import { SMITHSONIAN_SOURCE, tileFromGlb } from './smithsonian.js';

export const CATALOG_VERSION = 1;

/** The Shape picker: [id, label], in order. 'any' = no shape filter (the live API search, as before). */
export const CATALOG_SHAPES = Object.freeze([
  ['any', 'Any shape'],
  ['flat', 'Flat'],
  ['rod', 'Rod'],
  ['either', 'Flat or rod'],
].map((s) => Object.freeze(s)));

/** The filter's declared defaults: the shape, the ratio and its slider, the live re-filter's debounce. */
export const CATALOG_FILTER = Object.freeze({
  shape: 'any',
  ratio: 0.3,
  ratioMin: 0.05,
  ratioMax: 1,
  ratioStep: 0.01,
  debounceMs: 120,
});

/** d = [small, mid, large] -> { flat: small/mid <= ratio, rod: mid/large <= ratio }; no box -> neither. */
export function shapeOf(d, ratio) {
  if (!Array.isArray(d) || d.length < 3) return { flat: false, rod: false };
  const [s, m, l] = d;
  return { flat: s / m <= ratio, rod: m / l <= ratio };
}

const SHAPE_TEST = Object.freeze({
  flat: (sh) => sh.flat,
  rod: (sh) => sh.rod,
  either: (sh) => sh.flat || sh.rod,
});

/**
 * The catalog's models matching every given part: q = words (case-insensitive, each one somewhere in the title), unit = the
 * owning unit, shape = any | flat | rod | either at `ratio` (a model without a box only matches any). Catalog order kept.
 */
export function filterCatalog(cat, { q = '', unit = '', shape = CATALOG_FILTER.shape, ratio = CATALOG_FILTER.ratio } = {}) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const test = SHAPE_TEST[shape] || null;
  return (cat && Array.isArray(cat.models) ? cat.models : []).filter((m) => {
    if (unit && m.u !== unit) return false;
    if (words.length) { const t = String(m.t || '').toLowerCase(); if (!words.every((w) => t.includes(w))) return false; }
    return !test || test(shapeOf(m.d, ratio));
  });
}

/** One model's full GLB uri: base + g (a g that is already absolute stays as it is). */
export function catalogUri(cat, m) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(m.g) ? m.g : `${(cat && cat.base) || ''}${m.g}`;
}

/** Models -> the sheet's tiles ({ id, title, glbUrl, thumbUrl, previewUrl }), built by the same tileFromGlb the API search uses. */
export function catalogTiles(cat, models, source = SMITHSONIAN_SOURCE) {
  return models.map((m) => tileFromGlb({ id: m.id, title: m.t, uri: catalogUri(cat, m) }, source));
}

// this module's own URL, held in a name: Vite (vitest) rewrites a literal `new URL(<template>, import.meta.url)` into its
// asset lookup (measured: 'core/stl/undefined'); the browser resolves it natively either way
const HERE = import.meta.url;

/** The source's shipped catalog file, absolute (its path is relative to the app root, two folders up from this module). */
export function catalogUrl(source = SMITHSONIAN_SOURCE) {
  return new URL(`../../${source.catalogPath}`, HERE).href;
}

/** Fetch the source's catalog. A refused request (or a body that is not JSON) throws a readable Error. */
export async function fetchCatalog(fetchImpl = fetch, source = SMITHSONIAN_SOURCE) {
  let res;
  try { res = await fetchImpl(catalogUrl(source)); } catch (e) { throw new Error(`Could not load the catalog (${e && e.message ? e.message : e}).`); }
  if (!res || !res.ok) throw new Error(`The catalog answered ${res ? res.status : '?'}${res && res.statusText ? ` ${res.statusText}` : ''}.`);
  return res.json();
}

/**
 * SMITHSONIAN-BROWSER worker L (Fred 2026-11-22): the SHAPE filter over a mirrored, SOURCE-NEUTRAL catalog
 * (core/stl/catalog.js): Any (default, the live API exactly as before) · Flat (small/mid <= ratio) · Rod (mid/long <= ratio) ·
 * Flat or rod, with a ratio slider (0.05..1, default 0.30) that re-filters live. The catalog file ships under the app's data/
 * folder (data/stl-catalog-smithsonian.json, built by tools/build_stl_catalog.py). NO network: fetch is stubbed.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import {
  CATALOG_FILTER, CATALOG_SHAPES, shapeOf, filterCatalog, catalogTiles, catalogUri, catalogUrl,
} from '../bspline-frame-builder/b-spline-gen/html/core/stl/catalog.js';
import { SMITHSONIAN_SOURCE, parseSmithsonianSearch, smithsonianSearchUrl } from '../bspline-frame-builder/b-spline-gen/html/core/stl/smithsonian.js';
import { openStlLibrarySheet } from '../bspline-frame-builder/b-spline-gen/html/main/stl-library-sheet.js';

const APP = 'bspline-frame-builder/b-spline-gen/html/';
const FX = (name) => JSON.parse(readFileSync(`tests/fixtures/smithsonian/${name}.json`, 'utf8'));
const flush = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const settle = () => new Promise((r) => setTimeout(r, CATALOG_FILTER.debounceMs + 60));
const BASE = 'https://3d-api.si.edu/content/document/';

/**
 * A small catalog in the slim format: 30 plates (d [i+1, 100, 120]: small/mid = 0.01..0.30; even = 'Leaf plate', odd =
 * 'Shell plate'; 0..19 at NMNHINV, 20..29 at NPG), 5 rods (d [2, 3, 100]), a cube, a model without a box.
 */
function fixtureCatalog() {
  const models = [];
  for (let i = 0; i < 30; i++) {
    models.push({ id: `3d_package:flat-${i}`, t: `${i % 2 ? 'Shell' : 'Leaf'} plate ${i}`, u: i < 20 ? 'NMNHINV' : 'NPG',
      g: `3d_package:flat-${i}/plate-${i}-150k-1024-low.glb`, d: [i + 1, 100, 120] });
  }
  for (let i = 0; i < 5; i++) models.push({ id: `3d_package:rod-${i}`, t: `Femur ${i}`, u: 'NMNHPALEO', g: `3d_package:rod-${i}/femur-${i}-low.glb`, d: [2, 3, 100] });
  models.push({ id: '3d_package:cube', t: 'Leaf box', u: 'NMNHINV', g: '3d_package:cube/cube-low.glb', d: [10, 10, 10] });
  models.push({ id: '3d_package:nobox', t: 'Leaf with no box', u: 'NMNHINV', g: '3d_package:nobox/nobox-low.glb', d: null });
  return { v: 1, source: 'smithsonian', built: '2026-11-22', base: BASE, models };
}

describe('L1. shapeOf: flat = small/mid <= ratio, rod = mid/long <= ratio', () => {
  it('a plate 10 x 8 x 0.5 is flat at 0.3, not a rod; a rod 10 x 0.8 x 0.6 is a rod, not flat; a cube neither', () => {
    expect(shapeOf([0.5, 8, 10], 0.3)).toEqual({ flat: true, rod: false });
    expect(shapeOf([0.6, 0.8, 10], 0.3)).toEqual({ flat: false, rod: true });
    expect(shapeOf([5, 5, 5], 0.3)).toEqual({ flat: false, rod: false });
    // the ratio moves the line: the plate (0.5 / 8 = 0.0625) is no longer flat at 0.05
    expect(shapeOf([0.5, 8, 10], 0.05).flat).toBe(false);
    expect(shapeOf([5, 5, 5], 1)).toEqual({ flat: true, rod: true });
    expect(shapeOf(null, 0.3)).toEqual({ flat: false, rod: false });
  });
  it('the declared defaults: shape any, ratio 0.30 over 0.05..1 step 0.01; the four shapes in order', () => {
    expect(CATALOG_FILTER).toMatchObject({ shape: 'any', ratio: 0.3, ratioMin: 0.05, ratioMax: 1, ratioStep: 0.01 });
    expect(CATALOG_SHAPES.map(([id]) => id)).toEqual(['any', 'flat', 'rod', 'either']);
    expect(CATALOG_SHAPES.map(([, label]) => label)).toEqual(['Any shape', 'Flat', 'Rod', 'Flat or rod']);
  });
});

describe('L2. filterCatalog: words + museum + shape + ratio', () => {
  const cat = fixtureCatalog();
  const ids = (ms) => ms.map((m) => m.id);
  it('any: every model (a model without a box too); the words narrow it, case-insensitive, every word', () => {
    expect(filterCatalog(cat, {})).toHaveLength(37);
    expect(filterCatalog(cat, { shape: 'any', q: 'LEAF' }).map((m) => m.t)).toEqual([
      ...Array.from({ length: 15 }, (_, k) => `Leaf plate ${2 * k}`), 'Leaf box', 'Leaf with no box']);
    // every word, anywhere in the title ('2' is in 'plate 12' too)
    expect(ids(filterCatalog(cat, { q: ' plate  2 ' }))).toEqual([2, 12, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29].map((i) => `3d_package:flat-${i}`));
  });
  it('flat / rod / either at a ratio; a model without a box only matches any', () => {
    expect(filterCatalog(cat, { shape: 'flat', ratio: 0.3 })).toHaveLength(30);
    expect(ids(filterCatalog(cat, { shape: 'flat', ratio: 0.1 }))).toEqual(Array.from({ length: 10 }, (_, i) => `3d_package:flat-${i}`));
    expect(ids(filterCatalog(cat, { shape: 'rod', ratio: 0.3 }))).toEqual(Array.from({ length: 5 }, (_, i) => `3d_package:rod-${i}`));
    expect(filterCatalog(cat, { shape: 'either', ratio: 0.1 })).toHaveLength(15);
    expect(filterCatalog(cat, { shape: 'flat', ratio: 1 }).map((m) => m.id)).toContain('3d_package:cube');
    expect(filterCatalog(cat, { shape: 'either', ratio: 1 }).map((m) => m.id)).not.toContain('3d_package:nobox');
  });
  it('all four together: "leaf" + NPG + flat at 0.25 = the even NPG plates up to 0.25', () => {
    expect(ids(filterCatalog(cat, { q: 'leaf', unit: 'NPG', shape: 'flat', ratio: 0.25 }))).toEqual(['3d_package:flat-20', '3d_package:flat-22', '3d_package:flat-24']);
    expect(filterCatalog(cat, { unit: 'NMNHPALEO', shape: 'flat', ratio: 0.3 })).toHaveLength(0);
  });
});

describe('L3. catalogTiles: the same tile shape (and urls) the API search gives', () => {
  it('for the same GLB uri: the same glbUrl, thumbUrl and previewUrl as parseSmithsonianSearch', () => {
    const t0 = parseSmithsonianSearch(FX('search-all-p1')).tiles[0];
    const g = t0.glbUrl.slice(BASE.length);
    const cat = { v: 1, source: 'smithsonian', built: '2026-11-22', base: BASE, models: [{ id: t0.id, t: t0.title, u: 'NMNHMAMMALS', g, d: [1, 2, 3] }] };
    expect(catalogTiles(cat, cat.models)).toEqual([t0]);
    expect(catalogUri(cat, cat.models[0])).toBe(t0.glbUrl);
  });
});

describe('L4. the shipped catalog file', () => {
  const path = `${APP}${SMITHSONIAN_SOURCE.catalogPath}`;
  it('is declared, sits in the app data folder and is what catalogUrl points at', () => {
    expect(SMITHSONIAN_SOURCE.catalogPath).toBe('data/stl-catalog-smithsonian.json');
    expect(existsSync(path)).toBe(true);
    expect(catalogUrl()).toMatch(/\/b-spline-gen\/html\/data\/stl-catalog-smithsonian\.json$/);
  });
  it('parses; slim, source-neutral format; >= 3,400 models; base + g reproduce the original uris', () => {
    const cat = JSON.parse(readFileSync(path, 'utf8'));
    expect(cat).toMatchObject({ v: 1, source: 'smithsonian', base: BASE });
    expect(cat.built).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(cat.models.length).toBeGreaterThanOrEqual(3400);
    for (const m of cat.models) {
      expect(Object.keys(m).sort()).toEqual(['d', 'g', 'id', 't', 'u']);
      expect(m.g.startsWith('https://')).toBe(false);
    }
    expect(cat.models.filter((m) => Array.isArray(m.d)).length).toBeGreaterThanOrEqual(3400);
    // spot checks against the advisor's crawl (2026-11-22), one per museum
    const ORIGINAL = {
      '3d_package:b0bf6d44-af22-40dc-bd85-7d66255be4a7': ['Blue Crab', 'DPO', 'https://3d-api.si.edu/content/document/3d_package:b0bf6d44-af22-40dc-bd85-7d66255be4a7/blue-crab-150k-1024-low.glb', [67.2003, 154.5564, 220.0707]],
      '3d_package:1788235b-d2bc-4287-8fb5-f2965a069fd9': ['Theodore Roosevelt', 'NPG', 'https://3d-api.si.edu/content/document/3d_package:1788235b-d2bc-4287-8fb5-f2965a069fd9/theodore-roosevelt-bronze-relief-150k-1024-low.glb', [416.4857, 491.5428, 606.3999]],
      '3d_package:f8998076-078c-4951-9665-f643cce1ff69': ['Carnegie Mansion: Interior', 'CHNDM', 'https://3d-api.si.edu/content/document/3d_package:f8998076-078c-4951-9665-f643cce1ff69/cooper-hewitt-1st-low.glb', null],
    };
    for (const [id, [t, u, uri, d]] of Object.entries(ORIGINAL)) {
      const m = cat.models.find((x) => x.id === id);
      expect(m).toEqual({ id, t, u, g: uri.slice(BASE.length), d });
      expect(catalogUri(cat, m)).toBe(uri);
    }
  });
});

describe('L5. the sheet: the Shape picker and the ratio', () => {
  afterEach(() => { for (const o of document.querySelectorAll('.cad-modal-overlay')) o.remove(); vi.restoreAllMocks(); });
  const tiles = () => [...document.querySelectorAll('.stl-lib-tile')];
  const tileIds = () => tiles().map((t) => t.getAttribute('data-model-id'));
  const statusText = () => document.querySelector('#stlLibStatus').textContent;
  const shape = () => document.querySelector('select#stlLibShape');
  const ratioRow = () => document.querySelector('#stlLibRatioRow');
  const slider = () => document.querySelector('input#stlLibRatio');
  const num = () => document.querySelector('input#stlLibRatioNum');
  const setShape = (v) => { shape().value = v; shape().dispatchEvent(new Event('change', { bubbles: true })); };
  /** fetch: the catalog file -> the fixture catalog (or `catalog()`); anything else -> the recorded API page. */
  const sheetFetch = ({ catalog = () => new Response(JSON.stringify(fixtureCatalog()), { status: 200 }) } = {}) => vi.fn(async (url) => {
    if (String(url) === catalogUrl()) return catalog();
    return new Response(JSON.stringify(FX('search-all-p1')), { status: 200 });
  });
  const catalogCalls = (f) => f.mock.calls.filter(([u]) => String(u) === catalogUrl()).length;

  it('Shape Any (the default) keeps the API path: the search URL, no catalog; the ratio row hidden', async () => {
    const f = sheetFetch();
    openStlLibrarySheet({ fetchImpl: f, onPick: vi.fn() });
    expect([...shape().options].map((o) => o.value)).toEqual(['any', 'flat', 'rod', 'either']);
    expect(shape().value).toBe('any');
    expect(ratioRow().hidden).toBe(true);
    await flush();
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toBe(smithsonianSearchUrl());
    expect(tiles()).toHaveLength(24);
    expect(statusText()).toBe('24 models shown · more available');
  });

  it('Flat fetches the catalog once and shows only flat models, 24 at a time; More results pages the catalog', async () => {
    const f = sheetFetch();
    openStlLibrarySheet({ fetchImpl: f, onPick: vi.fn() });
    await flush();
    setShape('flat');
    expect(statusText()).toBe('Loading the catalog…');
    expect(ratioRow().hidden).toBe(false);
    expect(slider()).toMatchObject({ min: '0.05', max: '1', step: '0.01', value: '0.3' });
    expect(num().value).toBe('0.3');
    await flush();
    expect(catalogCalls(f)).toBe(1);
    expect(tileIds()).toEqual(Array.from({ length: 24 }, (_, i) => `3d_package:flat-${i}`));
    expect(statusText()).toBe('24 models shown · more available');
    const more = document.querySelector('#stlLibMore');
    expect(more.hidden).toBe(false);
    more.click();
    await flush();
    expect(tileIds()).toEqual(Array.from({ length: 30 }, (_, i) => `3d_package:flat-${i}`));
    expect(statusText()).toBe('30 models shown');
    expect(more.hidden).toBe(true);
    expect(f).toHaveBeenCalledTimes(2); // the API page at open + the catalog, nothing else
    // the tiles are the same shape the API's are: a tile's thumbnail beside its GLB
    expect(tiles()[0].querySelector('img').getAttribute('src')).toBe(`${BASE}3d_package:flat-0/scene-image-thumb.jpg`);
  });

  it('moving the ratio re-filters with no new fetch (the slider and the number box agree)', async () => {
    const f = sheetFetch();
    openStlLibrarySheet({ fetchImpl: f, onPick: vi.fn() });
    await flush();
    setShape('flat');
    await flush();
    slider().value = '0.1';
    slider().dispatchEvent(new Event('input', { bubbles: true }));
    expect(num().value).toBe('0.1');
    await settle();
    expect(tileIds()).toEqual(Array.from({ length: 10 }, (_, i) => `3d_package:flat-${i}`));
    expect(statusText()).toBe('10 models shown');
    num().value = '0.2';
    num().dispatchEvent(new Event('input', { bubbles: true }));
    expect(slider().value).toBe('0.2');
    await settle();
    expect(tiles()).toHaveLength(20);
    setShape('rod');
    await flush();
    expect(tileIds()).toEqual(Array.from({ length: 5 }, (_, i) => `3d_package:rod-${i}`));
    setShape('either');
    await flush();
    expect(tiles()).toHaveLength(24);
    expect(statusText()).toBe('24 models shown · more available'); // 20 flat + 5 rods
    expect(catalogCalls(f)).toBe(1);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('the words and the museum narrow the catalog too; back to Any = the API search again', async () => {
    const f = sheetFetch();
    openStlLibrarySheet({ fetchImpl: f, onPick: vi.fn() });
    await flush();
    setShape('flat');
    await flush();
    document.querySelector('#stlLibQuery').value = 'leaf';
    document.querySelector('#stlLibMuseum').value = 'NPG';
    document.querySelector('#stlLibSearch').click();
    await flush();
    expect(tileIds()).toEqual([20, 22, 24, 26, 28].map((i) => `3d_package:flat-${i}`));
    expect(statusText()).toBe('5 models shown');
    expect(catalogCalls(f)).toBe(1);
    setShape('any');
    expect(ratioRow().hidden).toBe(true);
    await flush();
    expect(String(f.mock.calls.at(-1)[0])).toBe(smithsonianSearchUrl({ q: 'leaf', unit: 'NPG' }));
    expect(catalogCalls(f)).toBe(1);
  });

  it('a catalog tile selects and inserts like an API tile (the same tile object)', async () => {
    const onPick = vi.fn();
    openStlLibrarySheet({ fetchImpl: sheetFetch(), onPick });
    await flush();
    setShape('rod');
    await flush();
    tiles()[2].click();
    expect(document.querySelector('#stlLibPane').hidden).toBe(false);
    expect(document.querySelector('#stlLibPane img').getAttribute('src')).toBe(`${BASE}3d_package:rod-2/scene-image-medium.jpg`);
    document.querySelector('#stlLibInsert').click();
    const cat = fixtureCatalog();
    expect(onPick.mock.calls[0][0]).toEqual(catalogTiles(cat, [cat.models.find((m) => m.id === '3d_package:rod-2')])[0]);
  });

  it('a catalog that fails to load: the message in the status line; the next try fetches it again', async () => {
    let n = 0;
    const f = sheetFetch({ catalog: () => (++n === 1 ? new Response('gone', { status: 404, statusText: 'Not Found' }) : new Response(JSON.stringify(fixtureCatalog()), { status: 200 })) });
    openStlLibrarySheet({ fetchImpl: f, onPick: vi.fn() });
    await flush();
    setShape('flat');
    await flush();
    expect(statusText()).toMatch(/404/);
    expect(document.querySelector('#stlLibStatus').classList.contains('stl-error')).toBe(true);
    expect(tiles()).toHaveLength(0);
    setShape('rod');
    await flush();
    expect(catalogCalls(f)).toBe(2);
    expect(tiles()).toHaveLength(5);
  });
});

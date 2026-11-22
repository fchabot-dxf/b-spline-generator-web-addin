/**
 * SMK-LIBRARY worker M (Fred 2026-11-22: "Smk for the win"; "searching searches all libs at once and simply tells me which libs
 * they're from along their sizes etc"): SMK (the National Gallery of Denmark) as the second declared library of the STL sheet.
 * The source (core/stl/smk.js) on a RECORDED live search page + item (tests/fixtures/smk/*.json, plain curl 2026-11-22), the
 * declared library list (core/stl/libraries.js), the sheet's Library picker (All libraries by default: every library in
 * parallel, interleaved, badges, sizes), and Insert of an SMK STL (stubbed fetch, a SYNTHETIC standing slab) laid flat.
 * NO network.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  SMK_SOURCE, SMK_TYPES, smkSearchUrl, smkTypeNames, parseSmkSearch, pickSmkStl,
} from '../bspline-frame-builder/b-spline-gen/html/core/stl/smk.js';
import {
  STL_LIBRARIES, ALL_LIBRARIES, fetchDownloadSize, mbText,
} from '../bspline-frame-builder/b-spline-gen/html/core/stl/libraries.js';
import { SMITHSONIAN_SOURCE, smithsonianSearchUrl, parseSmithsonianSearch } from '../bspline-frame-builder/b-spline-gen/html/core/stl/smithsonian.js';
import { catalogUrl } from '../bspline-frame-builder/b-spline-gen/html/core/stl/catalog.js';
import { rotationMatrix } from '../bspline-frame-builder/b-spline-gen/html/core/stl/raster.js';
import { openStlLibrarySheet, SIZE_LOOKUP_DELAY_MS } from '../bspline-frame-builder/b-spline-gen/html/main/stl-library-sheet.js';
import {
  renderStlPanel, bindStlPanel, addStlFromSoup, setStoredDetail, _resetStlPanelForTests,
} from '../bspline-frame-builder/b-spline-gen/html/main/stl-panel.js';

const SMK = (name) => JSON.parse(readFileSync(`tests/fixtures/smk/${name}.json`, 'utf8'));
const SI = (name) => JSON.parse(readFileSync(`tests/fixtures/smithsonian/${name}.json`, 'utf8'));
const $ = (id) => document.getElementById(id);
const flush = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const RELIEF = 'KAS2906/8'; // a Relief in the recorded page (item 22 of 24), the recorded item too

// ── a synthetic SMK-like STL: a slab STANDING Z-up (40 wide x 4 thin along Y x 100 tall), a bump on its -Y face (the relief) ──
const tri = (a, b, c) => [...a, ...b, ...c];
function standingSlab() {
  const [x0, x1, y0, y1, z0, z1] = [0, 40, -2, 2, 0, 100];
  const v = (x, y, z) => [x, y, z];
  const q = (a, b, c, d) => [tri(a, b, c), tri(a, c, d)];
  const A = v(x0, y0, z0), B = v(x1, y0, z0), C = v(x1, y0, z1), D = v(x0, y0, z1);
  const E = v(x0, y1, z0), F = v(x1, y1, z0), G = v(x1, y1, z1), H = v(x0, y1, z1);
  const faces = [...q(A, B, F, E), ...q(D, H, G, C), ...q(E, F, G, H), ...q(A, E, H, D), ...q(B, C, G, F)];
  // the front (-Y) face carries a pyramid: its base on the face, its apex 6 out
  const a = v(10, y0, 30), b = v(30, y0, 30), c = v(30, y0, 70), d = v(10, y0, 70), T = v(20, y0 - 6, 50);
  faces.push(tri(a, b, T), tri(b, c, T), tri(c, d, T), tri(d, a, T));
  faces.push(tri(A, B, b), tri(A, b, a), tri(B, C, c), tri(B, c, b), tri(C, D, d), tri(C, d, c), tri(D, A, a), tri(D, a, d));
  return Float32Array.from(faces.flat());
}
const binaryStl = (soup) => {
  const n = soup.length / 9, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) dv.setFloat32(84 + t * 50 + 12 + k * 4, soup[t * 9 + k], true);
  return buf;
};

/** fetch for both libraries: the Smithsonian search / catalog / Range; SMK search pages (page 2 = the ids suffixed) and its STLs. */
function bothFetch({ smk = null, stl = null, si = null } = {}) {
  return vi.fn(async (url, init) => {
    const s = String(url);
    if (init && init.headers && init.headers.Range) return new Response(new Uint8Array(1), { status: 206, headers: { 'content-range': 'bytes 0-0/815012' } });
    if (s === catalogUrl()) return json({ v: 1, source: 'smithsonian', built: '2026-11-22', base: 'https://3d-api.si.edu/content/document/',
      models: [{ id: '3d_package:flat-0', t: 'Leaf plate', u: 'NMNHINV', g: '3d_package:flat-0/plate-low.glb', d: [1, 100, 120] }] });
    if (s.startsWith(SMK_SOURCE.api)) {
      if (smk) return smk(s);
      const page = SMK('search-all-p1');
      if (new URL(s).searchParams.get('offset') === '24') for (const it of page.items) it.object_number = `${it.object_number}-p2`;
      return json(page);
    }
    if (s.startsWith('https://api.smk.dk/api/v1/download-3d/')) return stl ? stl(s) : new Response(binaryStl(standingSlab()), { status: 200 });
    if (s.startsWith(SMITHSONIAN_SOURCE.api)) {
      if (si) return si(s);
      return json(SI(new URL(s).searchParams.get('start') === '24' ? 'search-skull-p2' : 'search-all-p1'));
    }
    return new Response('not stubbed', { status: 404 });
  });
}
const urls = (f) => f.mock.calls.map(([u]) => String(u));
const smkCalls = (f) => urls(f).filter((u) => u.startsWith(SMK_SOURCE.api));
const siCalls = (f) => urls(f).filter((u) => u.startsWith(SMITHSONIAN_SOURCE.api));
const tiles = () => [...document.querySelectorAll('.stl-lib-tile')];
const libOf = (t) => t.getAttribute('data-library');
const statusText = () => $('stlLibStatus').textContent;
const notesText = () => ($('stlLibNotes') && !$('stlLibNotes').hidden ? $('stlLibNotes').textContent : '');
const choose = (id, v) => { $(id).value = v; $(id).dispatchEvent(new Event('change', { bubbles: true })); };
const openAll = (fetchImpl, onPick = vi.fn()) => openStlLibrarySheet({ libraries: STL_LIBRARIES, fetchImpl, onPick });

const saved = {};
beforeEach(() => {
  Object.assign(saved, { stl: P.stlLayers, w: P.widthIn, h: P.heightIn, three: globalThis.THREE });
  P.widthIn = 7; P.heightIn = 9; delete P.stlLayers;
  document.body.innerHTML = '<div id="stlLayerBody"></div>';
  _resetStlPanelForTests();
});
afterEach(() => {
  for (const o of document.querySelectorAll('.cad-modal-overlay')) o.remove();
  if (saved.stl === undefined) delete P.stlLayers; else P.stlLayers = saved.stl;
  P.widthIn = saved.w; P.heightIn = saved.h;
  if (saved.three === undefined) delete globalThis.THREE; else globalThis.THREE = saved.three;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('M1. the SMK search URL and the Type table', () => {
  it('page 0, no words: keys=*, the 3D filter alone, offset 0, 24 rows, English', () => {
    const u = new URL(smkSearchUrl());
    expect(`${u.origin}${u.pathname}`).toBe('https://api.smk.dk/api/v1/art/search/');
    expect(Object.fromEntries(u.searchParams)).toEqual({ keys: '*', filters: '[has_3d_file:true]', offset: '0', rows: '24', lang: 'en' });
  });
  it('words + one object_name + page 2: keys, the name ANDed in the filters, offset 48', () => {
    const p = new URL(smkSearchUrl({ q: ' apostlen thomas ', name: 'Group of statues', page: 2 })).searchParams;
    expect(p.get('keys')).toBe('apostlen thomas');
    expect(p.get('filters')).toBe('[has_3d_file:true],[object_names:Group of statues]');
    expect(p.get('offset')).toBe('48');
  });
  it('the declared types: All / Relief / Bust / Head / Statue / Other, each name in one type; a relief is Relief + Tympanum + Stele', () => {
    expect(SMK_TYPES.map(([id, label]) => [id, label])).toEqual([['all', 'All types'], ['relief', 'Relief'], ['bust', 'Bust'], ['head', 'Head'], ['statue', 'Statue'], ['other', 'Other']]);
    expect(smkTypeNames('relief')).toEqual(['Relief', 'Tympanum', 'Stele']);
    expect(smkTypeNames('all')).toEqual([]);
    const names = SMK_TYPES.flatMap(([, , n]) => n);
    expect(new Set(names).size).toBe(names.length);
    // every object_name on the recorded page belongs to a declared type
    for (const it of SMK('search-all-p1').items) expect(names).toContain(it.object_names[0].name);
  });
  it('the source: SMK (Denmark), 24 a page, STL, the _small file, the declared credit, laid flat at Insert', () => {
    expect(SMK_SOURCE).toMatchObject({ id: 'smk', label: 'SMK (Denmark)', short: 'SMK', pageSize: 24, format: 'stl', orient: 'layFlat',
      credit: 'SMK — National Gallery of Denmark, public domain (PDM). Models load from api.smk.dk.' });
    expect(STL_LIBRARIES.map((l) => l.id)).toEqual(['smithsonian', 'smk']);
    expect(ALL_LIBRARIES).toMatchObject({ id: 'all', label: 'All libraries' });
  });
});

describe('M2. parseSmkSearch on the recorded page and item', () => {
  it('the recorded page: 373 found, 24 tiles in the shared tile shape (format stl, IIIF thumb + preview), all public domain', () => {
    const r = parseSmkSearch(SMK('search-all-p1'));
    expect(r.total).toBe(373);
    expect(r.tiles).toHaveLength(24);
    expect(r.dropped).toEqual({ notPublicDomain: 0, noStl: 0 });
    expect(r.tiles[0]).toEqual({
      id: 'KAS385', title: 'Laocoon', format: 'stl',
      stlUrl: 'https://api.smk.dk/api/v1/download-3d/d504rr247_KAS385_small.stl', sizeBytes: 20005084,
      thumbUrl: 'https://iip-thumb.smk.dk/iiif/jp2/hq37vt35m_KAS385.tif.jp2/full/!200,200/0/default.jpg',
      previewUrl: 'https://iip-thumb.smk.dk/iiif/jp2/hq37vt35m_KAS385.tif.jp2/full/!1024,1024/0/default.jpg',
      objectName: 'Group of statues', type: 'statue', dims: { h: 242, w: 162.5, d: 103, unit: 'cm' }, licence: 'Public domain (PDM 1.0)',
    });
    for (const t of r.tiles) expect(t.stlUrl).toMatch(/_small\d*\.stl$/);
    // a row that lists no file_size: the size is unknown (the pane asks for it), not 0
    expect(r.tiles.find((t) => t.id === 'KAS248').sizeBytes).toBeNull();
  });
  it('the recorded item: a Relief, its _small STL', () => {
    const [t] = parseSmkSearch(SMK('item-relief-kas2906-8')).tiles;
    expect(t).toMatchObject({ id: RELIEF, type: 'relief', objectName: 'Relief', stlUrl: 'https://api.smk.dk/api/v1/download-3d/8623j340n_KAS2906-8_small.stl', sizeBytes: 19999884,
      dims: { h: 206.5, w: 71, d: 28, unit: 'cm' } });
  });
  it('only PUBLIC-DOMAIN items are kept (the others are counted); an item with no STL is skipped; no _small = the smallest STL', () => {
    const page = SMK('search-all-p1');
    page.items[1].rights = 'https://www.smk.dk/en/section/use-of-smk-material/';
    page.items[2].rights = 'https://www.smk.dk/en/section/use-of-smk-material/';
    page.items[3].files_3D = [{ url: 'https://api.smk.dk/api/v1/download-3d/x.obj', mime_type: 'model/obj', file_size: 5 }];
    const r = parseSmkSearch(page);
    expect(r.tiles).toHaveLength(21);
    expect(r.dropped).toEqual({ notPublicDomain: 2, noStl: 1 });
    expect(r.tiles.map((t) => t.id)).not.toContain(page.items[1].object_number);
    expect(pickSmkStl([{ url: 'a/big.stl', file_size: 900 }, { url: 'a/mid.stl', file_size: 300 }])).toEqual({ url: 'a/mid.stl', file_size: 300 });
    expect(pickSmkStl([{ url: 'a/big.stl', file_size: 900 }, { url: 'a/KAS1690_small8.stl', file_size: 950 }]).url).toBe('a/KAS1690_small8.stl');
  });
});

describe('M3. the sheet: All libraries (the default) searches every library at once', () => {
  it('a Library select (All libraries + each library); one search fetches BOTH, merged round-robin, each tile badged', async () => {
    const f = bothFetch();
    openAll(f);
    const sel = $('stlLibLibrary');
    expect(sel.hidden).toBe(false);
    expect([...sel.options].map((o) => [o.value, o.textContent])).toEqual([['all', 'All libraries'], ['smithsonian', 'Smithsonian 3D'], ['smk', 'SMK (Denmark)']]);
    expect(sel.value).toBe('all');
    await flush();
    expect(siCalls(f)).toEqual([smithsonianSearchUrl()]);
    expect(smkCalls(f)).toEqual([smkSearchUrl()]);
    expect(tiles()).toHaveLength(48);
    expect(tiles().slice(0, 6).map(libOf)).toEqual(['smithsonian', 'smk', 'smithsonian', 'smk', 'smithsonian', 'smk']);
    expect(tiles()[1].getAttribute('data-model-id')).toBe('KAS385');
    expect(tiles()[0].querySelector('.stl-lib-badge').textContent).toBe('Smithsonian');
    expect(tiles()[1].querySelector('.stl-lib-badge').textContent).toBe('SMK');
    // the size, where the listing has it (SMK lists its STL's bytes; the Smithsonian API does not -> no size on the tile)
    expect(tiles()[1].querySelector('.stl-lib-size').textContent).toBe('20 MB');
    expect(tiles()[0].querySelector('.stl-lib-size')).toBeNull();
    expect(statusText()).toBe('48 models shown · more available');
    // the SMK thumbnail is its IIIF image at the grid size
    expect(tiles()[1].querySelector('img').getAttribute('src')).toBe(parseSmkSearch(SMK('search-all-p1')).tiles[0].thumbUrl);
    // with All only the common filters show: the words and the Shape (the museum and SMK's Type are one library's own)
    expect($('stlLibMuseum').hidden).toBe(true);
    expect($('stlLibType').hidden).toBe(true);
    expect($('stlLibShape').hidden).toBe(false);
    expect(document.querySelector('.cad-modal-header').textContent).toContain('3D model libraries');
  });
  it('the words go to every library', async () => {
    const f = bothFetch();
    openAll(f);
    await flush();
    $('stlLibQuery').value = 'venus';
    $('stlLibSearch').click();
    await flush();
    expect(siCalls(f).at(-1)).toBe(smithsonianSearchUrl({ q: 'venus' }));
    expect(smkCalls(f).at(-1)).toBe(smkSearchUrl({ q: 'venus' }));
  });
  it('one library failing: the others still show, with a one-line note naming it', async () => {
    const f = bothFetch({ smk: async () => { throw new TypeError('Failed to fetch'); } });
    openAll(f);
    await flush();
    expect(tiles()).toHaveLength(24);
    expect(tiles().every((t) => libOf(t) === 'smithsonian')).toBe(true);
    expect(notesText()).toBe('SMK: could not reach api.smk.dk (Failed to fetch).');
    expect(statusText()).toBe('24 models shown · more available');
    const g = bothFetch({ si: async () => new Response('down', { status: 503, statusText: 'Service Unavailable' }) });
    document.querySelector('.cad-modal-header button').click();
    openAll(g);
    await flush();
    expect(tiles()).toHaveLength(24);
    expect(tiles().every((t) => libOf(t) === 'smk')).toBe(true);
    expect(notesText()).toMatch(/^Smithsonian: .*503/);
  });
  it('More results asks each library for its next page; a library with nothing more is skipped', async () => {
    const f = bothFetch();
    openAll(f);
    await flush();
    $('stlLibMore').click();
    await flush();
    expect(new URL(siCalls(f)[1]).searchParams.get('start')).toBe('24');
    expect(new URL(smkCalls(f)[1]).searchParams.get('offset')).toBe('24');
    expect(tiles().filter((t) => libOf(t) === 'smk')).toHaveLength(48);
    // SMK has exactly one page: More asks the Smithsonian alone
    const one = SMK('search-all-p1'); one.found = 24;
    const g = bothFetch({ smk: async () => json(one) });
    document.querySelector('.cad-modal-header button').click();
    openAll(g);
    await flush();
    $('stlLibMore').click();
    await flush();
    expect(smkCalls(g)).toHaveLength(1);
    expect(siCalls(g)).toHaveLength(2);
  });
  it('a Shape-filtered All search leaves out a library with no shape data, with a note', async () => {
    const f = bothFetch();
    openAll(f);
    await flush();
    choose('stlLibShape', 'flat');
    await flush();
    expect(smkCalls(f)).toHaveLength(1); // only the opening search
    expect(tiles().map(libOf)).toEqual(['smithsonian']);
    expect(notesText()).toMatch(/^SMK: .*shape/);
  });
});

describe('M4. picking ONE library restores its own filters', () => {
  it('SMK: its Type select (museum + Shape hidden), only SMK searched; a Type of several names = one search per name', async () => {
    const f = bothFetch();
    openAll(f);
    await flush();
    $('stlLibMuseum').value = 'NPG';
    choose('stlLibLibrary', 'smk');
    expect($('stlLibType').hidden).toBe(false);
    expect([...$('stlLibType').options].map((o) => o.textContent)).toEqual(['All types', 'Relief', 'Bust', 'Head', 'Statue', 'Other']);
    expect($('stlLibMuseum').hidden).toBe(true);
    expect($('stlLibShape').hidden).toBe(true);
    await flush();
    expect(siCalls(f)).toHaveLength(1);
    expect(tiles()).toHaveLength(24);
    expect(tiles().every((t) => libOf(t) === 'smk')).toBe(true);
    choose('stlLibType', 'relief');
    await flush();
    expect(smkCalls(f).slice(-3).map((u) => new URL(u).searchParams.get('filters'))).toEqual(
      ['[has_3d_file:true],[object_names:Relief]', '[has_3d_file:true],[object_names:Tympanum]', '[has_3d_file:true],[object_names:Stele]']);
    expect(document.querySelector('.stl-lib-credit').textContent).toBe(SMK_SOURCE.credit);
    // back to the Smithsonian: its museum (still NPG) + Shape, no Type
    choose('stlLibLibrary', 'smithsonian');
    expect($('stlLibMuseum').hidden).toBe(false);
    expect($('stlLibMuseum').value).toBe('NPG');
    expect($('stlLibShape').hidden).toBe(false);
    expect($('stlLibType').hidden).toBe(true);
    await flush();
    expect(siCalls(f).at(-1)).toBe(smithsonianSearchUrl({ unit: 'NPG' }));
    expect(tiles().every((t) => libOf(t) === 'smithsonian')).toBe(true);
  });
});

describe('M5. the preview pane: the library, its credit and licence, the download size', () => {
  it('an SMK tile: the listed size (no request), the object\'s size, PDM; Turn in 3D says what it downloads', async () => {
    const f = bothFetch();
    openAll(f);
    await flush();
    const before = f.mock.calls.length;
    tiles()[1].click();
    await flush();
    expect(f.mock.calls.length).toBe(before);
    const info = $('stlLibPaneInfo').textContent;
    expect(info).toContain('SMK (Denmark)');
    expect(info).toContain('Public domain (PDM 1.0)');
    expect(info).toContain(SMK_SOURCE.credit);
    expect(info).toContain('20 MB');
    expect(info).toContain('162.5 × 242 × 103 cm');
    expect($('stlLibPaneNote').textContent).toBe('Turn in 3D downloads the model (~20 MB).');
  });
  it('a Smithsonian tile: its size from a 1-byte Range request for the SELECTED tile only', async () => {
    const f = bothFetch();
    openAll(f);
    await flush();
    const siTile = parseSmithsonianSearch(SI('search-all-p1')).tiles[0];
    const rangedCalls = () => f.mock.calls.filter(([, init]) => init && init.headers && init.headers.Range);
    expect(rangedCalls()).toHaveLength(0); // none for the grid
    // tapping through tiles sends nothing; the one left selected is asked once it stays a moment
    tiles()[2].click();
    tiles()[0].click();
    await flush();
    expect(rangedCalls()).toHaveLength(0);
    await new Promise((r) => setTimeout(r, SIZE_LOOKUP_DELAY_MS + 50));
    await flush();
    const ranged = rangedCalls();
    expect(ranged).toHaveLength(1);
    expect(String(ranged[0][0])).toBe(siTile.glbUrl);
    expect(ranged[0][1].headers.Range).toBe('bytes=0-0');
    const info = $('stlLibPaneInfo').textContent;
    expect(info).toContain('Smithsonian 3D');
    expect(info).toContain('CC0');
    expect(info).toContain('0.8 MB');
  });
  it('fetchDownloadSize reads Content-Range; mbText is decimal MB', async () => {
    expect(await fetchDownloadSize('u', async () => new Response(new Uint8Array(1), { status: 206, headers: { 'content-range': 'bytes 0-0/19999884' } }))).toBe(19999884);
    expect(await fetchDownloadSize('u', async () => { throw new Error('x'); })).toBeNull();
    expect(mbText(815012)).toBe('0.8 MB');
    expect(mbText(19999884)).toBe('20 MB');
  });
});

describe('M6. Turn in 3D for SMK: the STL itself, on press only, shown upright', () => {
  function stubThree() {
    const seen = { geometries: [], renderers: [] };
    class WebGLRenderer { constructor() { this.domElement = document.createElement('canvas'); seen.renderers.push(this); } setPixelRatio() {} setSize() {} setClearColor() {} render() {} dispose() {} forceContextLoss() {} }
    class BufferAttribute { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; } }
    class BufferGeometry { constructor() { this.attributes = {}; seen.geometries.push(this); } setAttribute(k, a) { this.attributes[k] = a; return this; } computeVertexNormals() {} dispose() {} }
    class MeshStandardMaterial { dispose() {} }
    const v3 = () => ({ set() { return this; } });
    class Object3D { constructor() { this.children = []; this.position = v3(); this.up = v3(); this.rotation = { x: 0, y: 0, z: 0 }; } add(...c) { this.children.push(...c); return this; } lookAt() {} }
    class Mesh extends Object3D {}
    class PerspectiveCamera extends Object3D { updateProjectionMatrix() {} }
    globalThis.THREE = { WebGLRenderer, BufferAttribute, BufferGeometry, MeshStandardMaterial, Group: Object3D, Scene: Object3D, Mesh,
      PerspectiveCamera, AmbientLight: Object3D, DirectionalLight: Object3D, DoubleSide: 2 };
    return seen;
  }
  it('downloads the tile\'s STL when pressed; the standing model is upright in the view (tallest along the view\'s Y)', async () => {
    const three = stubThree();
    const f = bothFetch();
    openAll(f);
    await flush();
    choose('stlLibLibrary', 'smk');
    await flush();
    document.querySelector(`.stl-lib-tile[data-model-id="${RELIEF}"]`).click();
    expect(urls(f).filter((u) => u.includes('/download-3d/'))).toHaveLength(0);
    $('stlLibTurn').click();
    await flush();
    expect(urls(f).filter((u) => u.includes('/download-3d/'))).toEqual(['https://api.smk.dk/api/v1/download-3d/8623j340n_KAS2906-8_small.stl']);
    expect(document.querySelector('#stlLibPane canvas')).toBeTruthy();
    const p = three.geometries[0].attributes.position.array;
    const ext = [0, 1, 2].map((a) => { let lo = Infinity, hi = -Infinity; for (let i = a; i < p.length; i += 3) { lo = Math.min(lo, p[i]); hi = Math.max(hi, p[i]); } return hi - lo; });
    expect(ext[1]).toBeCloseTo(100, 3); // its Z-up height is the view's up
    expect(ext[2]).toBeCloseTo(10, 3);  // its thin Y (4 + the 6 bump) faces the camera
  });
});

describe('M7. Insert of an SMK tile: the STL, one layer, LAID FLAT', () => {
  const insertRelief = async (f) => {
    vi.stubGlobal('fetch', f);
    renderStlPanel($('stlLayerBody')); bindStlPanel({});
    $('stlBrowseSi').click();
    await flush();
    expect($('stlLibLibrary').value).toBe('all'); // the panel opens every library
    document.querySelector(`.stl-lib-tile[data-library="smk"][data-model-id="${RELIEF}"]`).click();
    $('stlLibInsert').click();
    await flush(20);
  };
  it('a standing slab (thin along Y) ends face up: its thin axis vertical, its long axis up the board, the bump up; source stored', async () => {
    const f = bothFetch();
    await insertRelief(f);
    expect(urls(f).filter((u) => u.includes('/download-3d/'))).toEqual(['https://api.smk.dk/api/v1/download-3d/8623j340n_KAS2906-8_small.stl']);
    expect(P.stlLayers).toHaveLength(1);
    const rec = P.stlLayers[0];
    const t = parseSmkSearch(SMK('search-all-p1')).tiles.find((x) => x.id === RELIEF);
    expect(rec.source).toEqual({ provider: 'smk', id: RELIEF, title: t.title, uri: t.stlUrl });
    expect(rec.name).toBe(t.title);
    const R = rotationMatrix(rec.rotation.x, rec.rotation.y, rec.rotation.z); // world = R * local, row-major
    expect(R[7]).toBeCloseTo(-1, 3); // local -Y (the bump side) -> board +Z: face up
    expect(Math.abs(R[5])).toBeCloseTo(1, 3); // local Z (its 100 height) -> board Y: up the (portrait) board
    expect($('stlSource').textContent).toBe(`From SMK, the National Gallery of Denmark (public domain): ${t.title}`);
    expect($('stlStatus').hidden).toBe(true);
  });
  it('the download shows its progress (MB) in the panel status line while it streams', async () => {
    const bytes = new Uint8Array(binaryStl(standingSlab()));
    let release; const gate = new Promise((r) => { release = r; });
    const body = new ReadableStream({ async start(c) { c.enqueue(bytes.slice(0, 500)); await gate; c.enqueue(bytes.slice(500)); c.close(); } });
    const f = bothFetch({ stl: async () => new Response(body, { status: 200, headers: { 'content-length': String(bytes.length) } }) });
    const pending = insertRelief(f);
    await pending;
    expect($('stlStatus').hidden).toBe(false);
    expect($('stlStatus').textContent).toMatch(/^Downloading .*: 0\.0 of 0\.0 MB…$/);
    release();
    await flush(20);
    expect(P.stlLayers).toHaveLength(1);
    expect($('stlStatus').hidden).toBe(true);
  });
  it('the Stored-detail re-download after a reload works for an SMK record (its source.uri STL)', async () => {
    const f = bothFetch();
    vi.stubGlobal('fetch', f);
    renderStlPanel($('stlLayerBody')); bindStlPanel({});
    const uri = 'https://api.smk.dk/api/v1/download-3d/8623j340n_KAS2906-8_small.stl';
    addStlFromSoup(standingSlab(), 'Relief', { source: { provider: 'smk', id: RELIEF, title: 'Relief', uri } });
    const full = P.stlLayers[0].origTris;
    setStoredDetail(8);
    expect(P.stlLayers[0].storedTris).toBeLessThan(full);
    _resetStlPanelForTests();
    renderStlPanel($('stlLayerBody')); bindStlPanel({});
    $('stlDetailSlider').value = String(full); $('stlDetailSlider').dispatchEvent(new Event('change', { bubbles: true }));
    await flush(20);
    expect(urls(f)).toEqual([uri]);
    expect(P.stlLayers[0].storedTris).toBe(full);
  });
});

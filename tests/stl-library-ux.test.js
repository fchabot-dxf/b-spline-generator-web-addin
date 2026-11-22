/**
 * 3D-LIBRARIES worker O (Fred 2026-11-22: "And the 2D image view? How do we see the next results? Can it be better"; "maybe on
 * desktop make the tiles bigger so we have about 20 tiles"): the library sheet's 2D | 3D pill, the full-screen lightbox, endless
 * scroll with per-library totals, the arrow / Enter keys, and the bigger desktop tiles. Recorded fixtures, stubbed fetch, a
 * stand-in THREE and IntersectionObserver. NO network.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { SMK_SOURCE } from '../bspline-frame-builder/b-spline-gen/html/core/stl/smk.js';
import { STL_LIBRARIES } from '../bspline-frame-builder/b-spline-gen/html/core/stl/libraries.js';
import { SMITHSONIAN_SOURCE } from '../bspline-frame-builder/b-spline-gen/html/core/stl/smithsonian.js';
import { openStlLibrarySheet } from '../bspline-frame-builder/b-spline-gen/html/main/stl-library-sheet.js';

const SMK = (name) => JSON.parse(readFileSync(`tests/fixtures/smk/${name}.json`, 'utf8'));
const SI = (name) => JSON.parse(readFileSync(`tests/fixtures/smithsonian/${name}.json`, 'utf8'));
const CSS = readFileSync('bspline-frame-builder/styles/layout-app.css', 'utf8').replace(/\r\n/g, '\n');
const $ = (id) => document.getElementById(id);
const flush = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

const tri = (a, b, c) => [...a, ...b, ...c];
const slabStl = () => { // a small solid: 4 triangles, binary STL
  const soup = Float32Array.from([...tri([0, 0, 0], [10, 0, 0], [0, 0, 20]), ...tri([0, 0, 0], [0, 4, 0], [10, 0, 0]), ...tri([0, 0, 0], [0, 0, 20], [0, 4, 0]), ...tri([10, 0, 0], [0, 4, 0], [0, 0, 20])]);
  const n = soup.length / 9, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) dv.setFloat32(84 + t * 50 + 12 + k * 4, soup[t * 9 + k], true);
  return buf;
};
function bothFetch() {
  return vi.fn(async (url, init) => {
    const s = String(url);
    if (init && init.headers && init.headers.Range) return new Response(new Uint8Array(1), { status: 206, headers: { 'content-range': 'bytes 0-0/815012' } });
    if (s.startsWith(SMK_SOURCE.api)) {
      const page = SMK('search-all-p1');
      if (new URL(s).searchParams.get('offset') === '24') for (const it of page.items) it.object_number = `${it.object_number}-p2`;
      return json(page);
    }
    if (s.startsWith('https://api.smk.dk/api/v1/download-3d/')) return new Response(slabStl(), { status: 200 });
    if (s.startsWith(SMITHSONIAN_SOURCE.api)) return json(SI(new URL(s).searchParams.get('start') === '24' ? 'search-skull-p2' : 'search-all-p1'));
    return new Response('not stubbed', { status: 404 });
  });
}
const urls = (f) => f.mock.calls.map(([u]) => String(u));
const smkSearches = (f) => urls(f).filter((u) => u.startsWith(SMK_SOURCE.api));
const siSearches = (f) => urls(f).filter((u) => u.startsWith(SMITHSONIAN_SOURCE.api));
const downloads = (f) => urls(f).filter((u) => u.startsWith('https://api.smk.dk/api/v1/download-3d/'));
const tiles = () => [...document.querySelectorAll('.stl-lib-tile')];
const active = () => tiles().findIndex((t) => t.classList.contains('active'));
const openAll = (fetchImpl, onPick = vi.fn()) => openStlLibrarySheet({ libraries: STL_LIBRARIES, fetchImpl, onPick });
const key = (k, target = document) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

function stubThree() {
  const seen = { renderers: [] };
  class WebGLRenderer {
    constructor() { this.domElement = document.createElement('canvas'); this.disposed = false; seen.renderers.push(this); }
    setPixelRatio() {} setSize() {} setClearColor() {} render() {} dispose() { this.disposed = true; } forceContextLoss() {}
  }
  class BufferGeometry { constructor() { this.attributes = {}; } setAttribute(k, a) { this.attributes[k] = a; return this; } computeVertexNormals() {} dispose() {} }
  class Mat { dispose() {} }
  const v3 = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } });
  class O3 { constructor() { this.children = []; this.position = v3(); this.up = v3(); this.rotation = { x: 0, y: 0, z: 0 }; } add(...c) { this.children.push(...c); return this; } lookAt() {} }
  globalThis.THREE = { WebGLRenderer, BufferAttribute: class { constructor(a, n) { this.array = a; this.itemSize = n; } }, BufferGeometry, MeshStandardMaterial: Mat,
    Group: O3, Scene: O3, Mesh: class extends O3 {}, PerspectiveCamera: class extends O3 { updateProjectionMatrix() {} }, AmbientLight: O3, DirectionalLight: O3, DoubleSide: 2 };
  return seen;
}
/** A recording IntersectionObserver: the observed elements and a way to fire the callback. */
function stubObserver() {
  const o = { observed: [], cbs: [] };
  vi.stubGlobal('IntersectionObserver', class { constructor(cb) { o.cbs.push(cb); } observe(e) { o.observed.push(e); } disconnect() {} unobserve() {} });
  o.fire = (isIntersecting = true) => { for (const cb of o.cbs) cb([{ isIntersecting }]); };
  return o;
}

const saved = {};
beforeEach(() => {
  Object.assign(saved, { three: globalThis.THREE, w: P.widthIn, h: P.heightIn });
  document.body.innerHTML = '';
});
afterEach(() => {
  for (const o of document.querySelectorAll('.cad-modal-overlay')) o.remove();
  if (saved.three === undefined) delete globalThis.THREE; else globalThis.THREE = saved.three;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const selectSmk = async (f) => {
  const h = openAll(f);
  await flush();
  const i = tiles().findIndex((t) => t.dataset.library === 'smk');
  tiles()[i].click();
  return { h, i };
};

describe('O1. the preview pane: a 2D | 3D pill', () => {
  it('2D is active with the picture; 3D loads the view once; back to 2D shows the picture and keeps the view; 3D again does not download again; another tile disposes it', async () => {
    const three = stubThree();
    const f = bothFetch();
    const { i } = await selectSmk(f);
    const pill = document.querySelector('#stlLibPane .view-mode-toggle');
    expect(pill).toBeTruthy();
    const b2 = $('stlLibView2d'), b3 = $('stlLibTurn');
    expect(pill.contains(b2) && pill.contains(b3)).toBe(true);
    expect([b2.textContent, b3.textContent]).toEqual(['2D', '3D']);
    expect([b2.getAttribute('aria-pressed'), b3.getAttribute('aria-pressed')]).toEqual(['true', 'false']);
    expect(document.querySelector('#stlLibPane img.stl-lib-preview')).toBeTruthy();
    b3.click();
    await flush();
    expect(downloads(f)).toHaveLength(1);
    expect(three.renderers).toHaveLength(1);
    expect(document.querySelector('#stlLibPane canvas')).toBe(three.renderers[0].domElement);
    expect(document.querySelector('#stlLibPane img')).toBeNull();
    expect([b2.getAttribute('aria-pressed'), b3.getAttribute('aria-pressed')]).toEqual(['false', 'true']);
    b2.click();
    expect(document.querySelector('#stlLibPane img.stl-lib-preview')).toBeTruthy();
    expect(three.renderers[0].disposed).toBe(false);
    expect(three.renderers[0].domElement.isConnected).toBe(true);
    expect(three.renderers[0].domElement.closest('[hidden]')).toBeTruthy(); // hidden, not gone
    b3.click();
    await flush();
    expect(downloads(f)).toHaveLength(1);
    expect(three.renderers).toHaveLength(1);
    expect(three.renderers[0].domElement.closest('[hidden]')).toBeNull();
    expect(document.querySelector('#stlLibPane img')).toBeNull();
    tiles().find((t, k) => k !== i && t.dataset.library === 'smk').click();
    expect(three.renderers[0].disposed).toBe(true);
    expect(document.querySelectorAll('canvas')).toHaveLength(0);
    expect(b2.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('O2. the lightbox', () => {
  it('clicking the picture opens it with the large picture; the wheel zooms; Esc closes it, the sheet stays with the same tile selected', async () => {
    const f = bothFetch();
    const { i } = await selectSmk(f);
    const src = document.querySelector('#stlLibPane img.stl-lib-preview').getAttribute('src');
    document.querySelector('#stlLibPane img.stl-lib-preview').click();
    const box = document.querySelector('.stl-lib-lightbox');
    expect(box).toBeTruthy();
    expect(box.classList.contains('cad-modal-overlay')).toBe(true);
    const img = box.querySelector('img');
    expect(img.getAttribute('src')).toBe(src);
    const scale = () => Number((/scale\(([\d.]+)\)/.exec(img.style.transform) || [0, 1])[1]);
    expect(scale()).toBe(1);
    box.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    expect(scale()).toBeGreaterThan(1);
    expect(box.querySelector('.stl-lib-lightbox-close')).toBeTruthy();
    key('Escape');
    expect(document.querySelector('.stl-lib-lightbox')).toBeNull();
    expect($('stlLibraryOverlay')).toBeTruthy();
    expect(active()).toBe(i);
    key('Escape');
    expect($('stlLibraryOverlay')).toBeNull();
  });
  it('closing the sheet takes an open lightbox with it', async () => {
    const f = bothFetch();
    const { h } = await selectSmk(f);
    document.querySelector('#stlLibPane img.stl-lib-preview').click();
    h.close();
    expect(document.querySelector('.stl-lib-lightbox')).toBeNull();
  });
});

describe('O3. endless scroll and the per-library totals', () => {
  it('a sentinel after the grid; its intersection loads ONE next page per library, never twice while one is pending', async () => {
    const io = stubObserver();
    const f = bothFetch();
    openAll(f);
    await flush();
    const sentinel = $('stlLibSentinel');
    expect(sentinel).toBeTruthy();
    expect(sentinel.previousElementSibling).toBe($('stlLibGrid'));
    expect(io.observed).toContain(sentinel);
    expect(siSearches(f)).toHaveLength(1);
    expect(smkSearches(f)).toHaveLength(1);
    const before = tiles().length;
    io.fire(false);
    await flush();
    expect(smkSearches(f)).toHaveLength(1); // not intersecting: nothing
    io.fire(); io.fire(); io.fire(); // three firings while the first is pending
    await flush();
    expect(siSearches(f)).toHaveLength(2);
    expect(smkSearches(f)).toHaveLength(2);
    expect(new URL(smkSearches(f)[1]).searchParams.get('offset')).toBe('24');
    expect(new URL(siSearches(f)[1]).searchParams.get('start')).toBe('24');
    expect(tiles().length).toBeGreaterThan(before);
    expect($('stlLibMore')).toBeTruthy(); // the button stays as the fallback
  });
  it('without IntersectionObserver (happy-dom) the sheet opens and More results still pages', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const f = bothFetch();
    openAll(f);
    await flush();
    $('stlLibMore').click();
    await flush();
    expect(smkSearches(f)).toHaveLength(2);
  });
  it('the status line names each library\'s total (a library whose total is unknown shows nothing)', async () => {
    const f = bothFetch();
    openAll(f);
    await flush();
    expect($('stlLibTotals').textContent).toBe('Smithsonian 3,523 · SMK 373');
    const g = vi.fn(async (u, init) => (String(u).startsWith(SMK_SOURCE.api) ? new Response('down', { status: 500, statusText: 'x' }) : f(u, init)));
    document.body.innerHTML = '';
    openAll(g);
    await flush();
    expect($('stlLibTotals').textContent).toBe('Smithsonian 3,523');
  });
});

describe('O4. the keyboard', () => {
  /** happy-dom has no layout: give the tiles a 4-column grid so "one row down" can be computed from positions. */
  const layout = (cols = 4) => tiles().forEach((t, k) => {
    t.getBoundingClientRect = () => ({ left: (k % cols) * 100, top: Math.floor(k / cols) * 100, width: 90, height: 90, right: 0, bottom: 0 });
  });
  it('arrows move the selection (left/right one tile, up/down one row), not while the search box has focus', async () => {
    openAll(bothFetch());
    await flush();
    layout();
    tiles()[1].click();
    key('ArrowRight'); expect(active()).toBe(2);
    key('ArrowLeft'); key('ArrowLeft'); expect(active()).toBe(0);
    key('ArrowDown'); expect(active()).toBe(4);
    key('ArrowDown'); expect(active()).toBe(8);
    key('ArrowUp'); expect(active()).toBe(4);
    const q = $('stlLibQuery'); q.focus();
    key('ArrowRight', q);
    expect(active()).toBe(4);
  });
  it('with nothing selected an arrow selects the first tile; Enter inserts the selected tile once and closes', async () => {
    const onPick = vi.fn();
    openAll(bothFetch(), onPick);
    await flush();
    layout();
    key('ArrowRight');
    expect(active()).toBe(0);
    key('ArrowRight');
    const second = tiles()[1].dataset.modelId;
    key('Enter');
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0].id).toBe(second);
    expect($('stlLibraryOverlay')).toBeNull();
  });
  it('Enter in the search box searches (not inserts)', async () => {
    const onPick = vi.fn();
    openAll(bothFetch(), onPick);
    await flush();
    tiles()[0].click();
    const q = $('stlLibQuery'); q.focus();
    key('Enter', q);
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe('O5. bigger tiles on a desktop sheet, the phone unchanged', () => {
  const rule = (css, sel) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, s]) => s.trim().split(',').map((x) => x.trim()).includes(sel)).map(([, , d]) => d).join(';');
  it('one declared desktop size, used by the > 600 px grid rule; ~5-6 columns of the 1400 px sheet\'s grid area', () => {
    const decl = /--stl-lib-tile-desktop:\s*(\d+)px/.exec(CSS);
    expect(decl).toBeTruthy();
    expect(CSS.match(/--stl-lib-tile-desktop:/g)).toHaveLength(1);
    const at = CSS.indexOf('@media (min-width: 601px)');
    expect(at).toBeGreaterThan(-1);
    const block = CSS.slice(at, CSS.indexOf('\n}', at));
    expect(rule(block, '.stl-lib-grid')).toMatch(/grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(var\(--stl-lib-tile-desktop\),\s*1fr\)\)/);
    const px = Number(decl[1]);
    const area = 1400 - 24 - 340 - 12; // sheet padding, preview pane, gap
    const cols = Math.floor((area + 6) / (px + 6));
    expect(cols).toBeGreaterThanOrEqual(5);
    expect(cols).toBeLessThanOrEqual(7);
  });
});

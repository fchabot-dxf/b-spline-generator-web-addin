/**
 * SMITHSONIAN-BROWSER answer 5 (SMITHSONIAN-BROWSER-DESIGN.md section 7): "Stored in the project" is a SLIDER + the number box.
 * Its travel: min 500, max = the in-memory original's triangle count; after a reload, a library model (source.uri) keeps its
 * origTris (it downloads again to go up), any other STL the stored count (down only, as before). The slider applies on release.
 * Real panel, real binary STL, real P; the network (fetch) and the CDN glTF loader (THREE) are stubbed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  renderStlPanel, bindStlPanel, syncStlPanel, addStlFromBuffer, setStoredDetail, activeStlLayer, _resetStlPanelForTests,
} from '../bspline-frame-builder/b-spline-gen/html/main/stl-panel.js';
import { _resetGltfLoaderForTests } from '../bspline-frame-builder/b-spline-gen/html/core/stl/gltf.js';

const tri = (a, b, c) => [...a, ...b, ...c];
function gridSoup(n) {
  const t = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) t.push(tri([i, j, 0], [i + 1, j, 0], [i + 1, j + 1, 0]), tri([i, j, 0], [i + 1, j + 1, 0], [i, j + 1, 0]));
  return Float32Array.from(t.flat());
}
function binaryStl(soup) {
  const n = soup.length / 9, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) dv.setFloat32(84 + t * 50 + 12 + k * 4, soup[t * 9 + k], true);
  return buf;
}
/** The same grid as a GLB scene would hold it (face up: board (x, y, z) is glTF (x, y, z), GLTF_TO_BOARD is the identity),
 *  THREE-shaped, one non-indexed mesh. */
function gridScene(n) {
  const g = gridSoup(n);
  const mesh = { isMesh: true, geometry: { attributes: { position: { array: g, itemSize: 3, count: g.length / 3 } }, index: null },
    matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }, children: [] };
  return { isMesh: false, children: [mesh], traverse(cb) { cb(this); cb(mesh); } };
}
function stubThree() {
  const seen = { parsed: 0 };
  class DRACOLoader { setDecoderPath() { return this; } }
  class GLTFLoader { setDRACOLoader() { return this; } parse(buf, path, ok) { seen.parsed++; ok({ scene: gridScene(60) }); } }
  globalThis.THREE = { GLTFLoader, DRACOLoader };
  return seen;
}
const GLB = () => { const b = new Uint8Array(64); b.set([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]); return b.buffer; };
const URI = 'https://3d-api.si.edu/content/document/3d_package:abc/model-150k-1024-low.glb';
const $ = (id) => document.getElementById(id);
const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const json = (o) => JSON.parse(JSON.stringify(o));
const saved = {};

beforeEach(() => {
  Object.assign(saved, { stl: P.stlLayers, w: P.widthIn, h: P.heightIn, three: globalThis.THREE });
  P.widthIn = 7; P.heightIn = 9; delete P.stlLayers;
  document.body.innerHTML = '<div id="stlLayerBody"></div>';
  _resetStlPanelForTests();
  _resetGltfLoaderForTests();
  renderStlPanel($('stlLayerBody'));
  bindStlPanel({});
});
afterEach(() => {
  if (saved.stl === undefined) delete P.stlLayers; else P.stlLayers = saved.stl;
  P.widthIn = saved.w; P.heightIn = saved.h;
  if (saved.three === undefined) delete globalThis.THREE; else globalThis.THREE = saved.three;
  vi.unstubAllGlobals();
});

/** An imported 7200-triangle grid stored at 1000, then a reload (the in-memory original gone); `source` added copy-on-write. */
function reloadedAt1000({ source = null } = {}) {
  addStlFromBuffer(binaryStl(gridSoup(60)), 'tile.stl');
  setStoredDetail(1000);
  if (source) P.stlLayers = P.stlLayers.map((r) => ({ ...r, source }));
  _resetStlPanelForTests();
  syncStlPanel();
  return activeStlLayer();
}

describe('the Stored detail slider', () => {
  it('after an import: a range beside the number box, min 500, max = the original\'s count, step 500', () => {
    addStlFromBuffer(binaryStl(gridSoup(60)), 'tile.stl');
    const s = $('stlDetailSlider');
    expect(s).toBeTruthy();
    expect(s.type).toBe('range');
    expect(s.classList.contains('cad-slider')).toBe(true);
    expect(s.min).toBe('500');
    expect(s.max).toBe('7200');
    expect(s.step).toBe('500');
    expect(s.closest('.cad-slider-row')).toBe($('stlDetail').closest('.cad-slider-row'));
  });
  it('dragging updates the box live and stores nothing; the release re-stores', () => {
    addStlFromBuffer(binaryStl(gridSoup(60)), 'tile.stl');
    const s = $('stlDetailSlider');
    const before = json(activeStlLayer());
    s.value = '1500'; fire(s, 'input');
    expect($('stlDetail').value).toBe('1500');
    expect(json(activeStlLayer())).toEqual(before);
    fire(s, 'change');
    expect(activeStlLayer().storedDetail).toBe(1500);
    expect(activeStlLayer().storedTris).toBeLessThanOrEqual(1500);
  });
  it('after a reload (no original, no source): max = the stored count, and moving up re-stores nothing', () => {
    const rec = reloadedAt1000();
    const s = $('stlDetailSlider');
    expect(s.max).toBe(String(rec.storedTris));
    const before = json(rec);
    s.value = '5000'; fire(s, 'change');
    expect(json(activeStlLayer())).toEqual(before);
  });
});

describe('a library model after a reload downloads again to go up', () => {
  it('max = origTris; moving up downloads once, re-stores at the request, and keeps the original (a second move up does not fetch)', async () => {
    // the model's parts lookup (model_url, Low GLB) answers its one row; the GLB itself = the grid
    const f = vi.fn(async (url) => (String(url).endsWith('.glb') ? new Response(GLB(), { status: 200 })
      : new Response(JSON.stringify({ rows: [{ title: 'Tile', content: { uri: URI, model_url: '3d_package:abc', file_type: 'glb', quality: 'Low' } }], rowCount: 1 }), { status: 200 })));
    vi.stubGlobal('fetch', f);
    const three = stubThree();
    const rec = reloadedAt1000({ source: { provider: 'smithsonian', modelUrl: '3d_package:abc', title: 'Tile', uri: URI } });
    const low = rec.storedTris;
    const s = $('stlDetailSlider');
    expect(s.max).toBe('7200');
    s.value = '4000'; fire(s, 'change');
    await flush();
    expect(f).toHaveBeenCalledTimes(3); // the Voyager scene (not a scene here: the fallback), the parts lookup, then the one part
    expect(String(f.mock.calls[0][0])).toBe(`${URI.slice(0, URI.lastIndexOf('/'))}/scene.svx.json`);
    expect(new URL(String(f.mock.calls[1][0])).searchParams.get('model_url')).toBe('3d_package:abc');
    expect(String(f.mock.calls[2][0])).toBe(URI);
    expect(three.parsed).toBe(1);
    const mid = activeStlLayer();
    expect(mid.storedDetail).toBe(4000);
    expect(mid.storedTris).toBeGreaterThan(low);
    expect(mid.storedTris).toBeLessThanOrEqual(4000);
    expect(mid.source.uri).toBe(URI);
    expect($('stlStored').textContent).toMatch(/the detail can go up or down/);
    s.value = '6000'; fire(s, 'change');
    await flush();
    expect(f).toHaveBeenCalledTimes(3);
    expect(activeStlLayer().storedTris).toBeGreaterThan(mid.storedTris);
  });
  it('a failed download: the record is unchanged and the status line says so', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gone', { status: 404, statusText: 'Not Found' })));
    stubThree();
    const rec = reloadedAt1000({ source: { provider: 'smithsonian', modelUrl: '3d_package:abc', title: 'Tile', uri: URI } });
    const before = json(rec);
    const s = $('stlDetailSlider');
    s.value = '4000'; fire(s, 'change');
    await flush();
    expect(json(activeStlLayer())).toEqual(before);
    expect($('stlStatus').hidden).toBe(false);
    expect($('stlStatus').classList.contains('stl-error')).toBe(true);
    expect($('stlStatus').textContent).toMatch(/^Could not download .*404/);
  });
});

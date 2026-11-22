/**
 * SMITHSONIAN-BROWSER worker I, part 1 (SMITHSONIAN-BROWSER-DESIGN.md sections 2-3): the upright pose from the model's Voyager
 * scene. A raw Smithsonian GLB is NOT upright (the Hayes bust's Low GLB: no node transform, its longest side X, 281 x 211 x 148
 * mm, so it inserted lying sideways). The pose lives in `<the GLB's folder>/scene.svx.json` (recorded live:
 * tests/fixtures/smithsonian/scene-hayes.svx.json): each model entry's rotation (then translation) stands it upright (+Y up) facing
 * the Voyager camera (+Z). Insert, the Stored-detail re-download and Turn in 3D read the scene FIRST (every part with its own
 * pose); a missing or unreadable scene falls back to the parts lookup (no pose, as before). NO network: fetch is stubbed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  sceneUrlOf, parseVoyagerScene, fetchVoyagerScene, downloadSmithsonianModelSoup, parseSmithsonianSearch,
} from '../bspline-frame-builder/b-spline-gen/html/core/stl/smithsonian.js';
import { transformSoup, _resetGltfLoaderForTests } from '../bspline-frame-builder/b-spline-gen/html/core/stl/gltf.js';
import { openStlLibrarySheet } from '../bspline-frame-builder/b-spline-gen/html/main/stl-library-sheet.js';
import {
  renderStlPanel, bindStlPanel, addStlFromSoup, setStoredDetail, _resetStlPanelForTests,
} from '../bspline-frame-builder/b-spline-gen/html/main/stl-panel.js';

const FX = (name) => JSON.parse(readFileSync(`tests/fixtures/smithsonian/${name}.json`, 'utf8'));
const SCENE = () => FX('scene-hayes.svx');
const NPG = FX('search-npg');
const HAYES = '3d_package:1f3700e8-6d01-4488-8ab9-ea14031ef641';
const FOLDER = `https://3d-api.si.edu/content/document/${HAYES}`;
const HAYES_LOW = `${FOLDER}/rutherford-b-150k-1024-low.glb`;
const HAYES_THUMB = `${FOLDER}/rutherford-b-20k-512-thumb.glb`;
const $ = (id) => document.getElementById(id);
const flush = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

// ── the Hayes GLB's RAW frame: a box of the scene's recorded boundingBox (12 triangles) ──
function boxSoup({ min, max }) {
  const c = (i) => [(i & 1) ? max[0] : min[0], (i & 2) ? max[1] : min[1], (i & 4) ? max[2] : min[2]];
  const quads = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  const out = [];
  for (const [a, b, d, e] of quads) out.push(...c(a), ...c(b), ...c(d), ...c(a), ...c(d), ...c(e));
  return Float32Array.from(out);
}
const HAYES_BOX = () => boxSoup(SCENE().models[0].boundingBox);
function extents(soup) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < soup.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], soup[i + k]); hi[k] = Math.max(hi[k], soup[i + k]); }
  return { size: hi.map((h, k) => h - lo[k]), centre: hi.map((h, k) => (h + lo[k]) / 2) };
}
const argMax = (a) => a.indexOf(Math.max(...a));

// ── a stand-in THREE: GLTFLoader.parse answers the Hayes box in its raw frame (what the Low GLB holds); the preview's classes ──
function stubThree() {
  const seen = { parsed: 0, geometries: [] };
  const sceneOfBox = () => {
    const soup = HAYES_BOX();
    const mesh = { isMesh: true, geometry: { attributes: { position: { array: soup, itemSize: 3, count: soup.length / 3 } }, index: null, dispose() {} },
      matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } };
    return { traverse(cb) { cb(mesh); }, updateMatrixWorld() {} };
  };
  class DRACOLoader { setDecoderPath() { return this; } }
  class GLTFLoader { setDRACOLoader() { return this; } parse(buf, path, ok) { seen.parsed++; ok({ scene: sceneOfBox() }); } }
  class WebGLRenderer {
    constructor() { this.domElement = document.createElement('canvas'); }
    setPixelRatio() {} setSize() {} setClearColor() {} render() {} dispose() {} forceContextLoss() {}
  }
  class BufferAttribute { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; } }
  class BufferGeometry { constructor() { this.attributes = {}; seen.geometries.push(this); } setAttribute(k, a) { this.attributes[k] = a; return this; } computeVertexNormals() {} dispose() {} }
  class MeshStandardMaterial { dispose() {} }
  const v3 = () => ({ set() { return this; } });
  class Object3D { constructor() { this.children = []; this.position = v3(); this.up = v3(); this.rotation = { x: 0, y: 0, z: 0 }; } add() { return this; } lookAt() {} }
  class PerspectiveCamera extends Object3D { updateProjectionMatrix() {} }
  globalThis.THREE = { GLTFLoader, DRACOLoader, WebGLRenderer, BufferAttribute, BufferGeometry, MeshStandardMaterial, Group: Object3D, Scene: Object3D,
    Mesh: Object3D, PerspectiveCamera, AmbientLight: Object3D, DirectionalLight: Object3D, DoubleSide: 2 };
  return seen;
}

/** 'glTF' v2 header only (not a readable GLB: the stub loader does not read it). */
const GLB_BYTES = () => { const b = new Uint8Array(64); b.set([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]); return b.buffer; };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
/** fetch: the scene -> scene(); a .glb -> header bytes (200: no range support, the full file); the Low / Thumb lookups; else the NPG page. */
const siFetch = ({ scene = () => json(SCENE()), thumbRows = [] } = {}) => vi.fn(async (url) => {
  const s = String(url);
  if (s.endsWith('/scene.svx.json')) return scene();
  if (s.endsWith('.glb')) return new Response(GLB_BYTES(), { status: 200 });
  const p = new URL(s).searchParams;
  if (p.get('model_url') && p.get('file_quality') === 'Low') return json({ rows: NPG.rows.filter((r) => r.content.model_url === p.get('model_url')), rowCount: 1 });
  if (p.get('model_url') && p.get('file_quality') === 'Thumb') return json({ rows: thumbRows, rowCount: thumbRows.length });
  return json(NPG);
});
const urls = (f) => f.mock.calls.map(([u]) => String(u));
const isLookup = (q) => (u) => !u.endsWith('.glb') && !u.endsWith('.json') && new URL(u).searchParams.get('model_url') && new URL(u).searchParams.get('file_quality') === q;

const saved = {};
beforeEach(() => {
  Object.assign(saved, { stl: P.stlLayers, w: P.widthIn, h: P.heightIn, three: globalThis.THREE });
  P.widthIn = 7; P.heightIn = 9; delete P.stlLayers;
  document.body.innerHTML = '<div id="stlLayerBody"></div>';
  _resetStlPanelForTests();
  _resetGltfLoaderForTests();
});
afterEach(() => {
  for (const o of document.querySelectorAll('.cad-modal-overlay')) o.remove();
  if (saved.stl === undefined) delete P.stlLayers; else P.stlLayers = saved.stl;
  P.widthIn = saved.w; P.heightIn = saved.h;
  if (saved.three === undefined) delete globalThis.THREE; else globalThis.THREE = saved.three;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('I1. the Voyager scene file', () => {
  it('sceneUrlOf: the GLB\'s folder + /scene.svx.json', () => {
    expect(sceneUrlOf(HAYES_LOW)).toBe(`${FOLDER}/scene.svx.json`);
  });
  it('the RECORDED Hayes scene: one model entry, its Web3D Low and Thumb GLBs (absolute), its rotation and translation', () => {
    const s = SCENE();
    expect(parseVoyagerScene(s, FOLDER)).toEqual([{
      glbUrl: HAYES_LOW,
      thumbGlbUrl: HAYES_THUMB,
      rotation: [-0.7155827, -0.6682664, 0.1729404, 0.1070187],
      translation: [-375.2004064, -103.2661236, -671.6042172],
    }]);
    // the tile's own uri IS the scene's Low asset (the API and the scene name the same file)
    expect(parseSmithsonianSearch(NPG).tiles.find((t) => t.id === HAYES).glbUrl).toBe(HAYES_LOW);
  });
  it('several models (each part its own pose), an absent pose, an absolute asset uri; no Thumb -> null; no models -> []', () => {
    const s = { models: [
      { units: 'mm', derivatives: [{ usage: 'Web3D', quality: 'Low', assets: [{ uri: 'bust-low.glb' }] }] },
      { units: 'mm', rotation: [0, 0, 1, 0], translation: [1, 2, 3], derivatives: [
        { usage: 'Web3D', quality: 'Thumb', assets: [{ uri: 'base-thumb.glb' }] },
        { usage: 'App3D', quality: 'Low', assets: [{ uri: 'not-web.glb' }] },
        { usage: 'Web3D', quality: 'Low', assets: [{ uri: 'https://elsewhere.example/base-low.glb' }] },
      ] },
    ] };
    expect(parseVoyagerScene(s, FOLDER)).toEqual([
      { glbUrl: `${FOLDER}/bust-low.glb`, thumbGlbUrl: null, rotation: null, translation: null },
      { glbUrl: 'https://elsewhere.example/base-low.glb', thumbGlbUrl: `${FOLDER}/base-thumb.glb`, rotation: [0, 0, 1, 0], translation: [1, 2, 3] },
    ]);
    expect(parseVoyagerScene(NPG, FOLDER)).toEqual([]); // not a scene (a search answer)
    expect(parseVoyagerScene(null, FOLDER)).toEqual([]);
  });
  it('fetchVoyagerScene fetches the scene beside the GLB and parses it; a refused request throws', async () => {
    const f = siFetch();
    const entries = await fetchVoyagerScene(HAYES_LOW, f);
    expect(urls(f)).toEqual([`${FOLDER}/scene.svx.json`]);
    expect(entries).toHaveLength(1);
    expect(entries[0].glbUrl).toBe(HAYES_LOW);
    await expect(fetchVoyagerScene(HAYES_LOW, siFetch({ scene: () => new Response('no', { status: 404, statusText: 'Not Found' }) }))).rejects.toThrow(/404/);
  });
});

describe('I2. transformSoup: rotate by the quaternion, then translate', () => {
  const S = Math.SQRT1_2;
  it('+X under 90 degrees about Z lands on +Y; +Y under 90 degrees about X lands on +Z; then the translation is added', () => {
    const qz = [0, 0, S, S], qx = [S, 0, 0, S];
    const a = transformSoup(Float32Array.from([1, 0, 0]), { rotation: qz });
    expect(Array.from(a).map((v) => +v.toFixed(6) + 0)).toEqual([0, 1, 0]);
    const b = transformSoup(Float32Array.from([0, 1, 0]), { rotation: qx });
    expect(Array.from(b).map((v) => +v.toFixed(6) + 0)).toEqual([0, 0, 1]);
    // rotation FIRST, then translation: (1,0,0) -> (0,1,0) -> (10,21,30)
    const c = transformSoup(Float32Array.from([1, 0, 0]), { rotation: qz, translation: [10, 20, 30] });
    expect(Array.from(c).map((v) => +v.toFixed(5) + 0)).toEqual([10, 21, 30]);
    // 180 degrees about Y: (1,2,3) -> (-1,2,-3)
    const d = transformSoup(Float32Array.from([1, 2, 3]), { rotation: [0, 1, 0, 0] });
    expect(Array.from(d).map((v) => +v.toFixed(6) + 0)).toEqual([-1, 2, -3]);
  });
  it('no pose (absent / null): the same points; the input is never changed', () => {
    const src = Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const copy = Float32Array.from(src);
    expect(Array.from(transformSoup(src, {}))).toEqual(Array.from(copy));
    expect(Array.from(transformSoup(src, { rotation: null, translation: null }))).toEqual(Array.from(copy));
    expect(Array.from(transformSoup(src, { translation: [1, 1, 1] }))).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    transformSoup(src, { rotation: [0, 0, S, S], translation: [5, 5, 5] });
    expect(Array.from(src)).toEqual(Array.from(copy));
  });
  it('the RECORDED Hayes pose stands its raw box upright: raw longest side X -> transformed longest side Y, centred near the origin', () => {
    const raw = extents(HAYES_BOX());
    expect(argMax(raw.size)).toBe(0); // as measured: 281 x 211 x 148, lying sideways
    const [pose] = parseVoyagerScene(SCENE(), FOLDER);
    const up = extents(transformSoup(HAYES_BOX(), pose));
    expect(argMax(up.size)).toBe(1); // upright: tallest along +Y
    const big = Math.max(...up.size);
    for (const c of up.centre) expect(Math.abs(c)).toBeLessThan(0.05 * big);
  });
});

describe('I3. one shared download: the scene first, the parts lookup as the fallback', () => {
  it('Insert-quality (Low): the scene, then its Low GLB with a Range request; no parts lookup; the soup stands upright', async () => {
    stubThree();
    const f = siFetch();
    const soup = await downloadSmithsonianModelSoup({ modelId: HAYES, glbUri: HAYES_LOW }, f);
    expect(urls(f)[0]).toBe(`${FOLDER}/scene.svx.json`);
    expect(urls(f).filter((u) => u.endsWith('.glb'))).toEqual([HAYES_LOW]);
    expect(urls(f).filter(isLookup('Low'))).toHaveLength(0);
    // every GLB download is a geometry-only range download (header first)
    const glbCall = f.mock.calls.find(([u]) => String(u).endsWith('.glb'));
    expect(glbCall[1].headers.Range).toBe('bytes=0-19');
    expect(argMax(extents(soup).size)).toBe(1);
  });
  it('a scene that is missing (404) or unreadable: the parts lookup, the tile\'s GLB, no pose (lying as before)', async () => {
    for (const scene of [() => new Response('no', { status: 404 }), () => new Response('not json {', { status: 200 })]) {
      stubThree();
      const f = siFetch({ scene });
      const soup = await downloadSmithsonianModelSoup({ modelId: HAYES, glbUri: HAYES_LOW }, f);
      expect(urls(f).filter(isLookup('Low'))).toHaveLength(1);
      expect(urls(f).filter((u) => u.endsWith('.glb'))).toEqual([HAYES_LOW]);
      expect(argMax(extents(soup).size)).toBe(0);
    }
  });
  it('the 3D preview: the scene\'s Thumb GLB (no Thumb lookup); a model entry without a Thumb uses its Low and says so', async () => {
    stubThree();
    const f = siFetch();
    const onFullModel = vi.fn();
    const soup = await downloadSmithsonianModelSoup({ modelId: HAYES, glbUri: HAYES_LOW, preview: true, onFullModel }, f);
    expect(urls(f).filter((u) => u.endsWith('.glb'))).toEqual([HAYES_THUMB]);
    expect(urls(f).filter(isLookup('Thumb'))).toHaveLength(0);
    expect(onFullModel).not.toHaveBeenCalled();
    expect(argMax(extents(soup).size)).toBe(1);
    const noThumb = SCENE();
    noThumb.models[0].derivatives = noThumb.models[0].derivatives.filter((d) => d.quality !== 'Thumb');
    const g = siFetch({ scene: () => json(noThumb) });
    await downloadSmithsonianModelSoup({ modelId: HAYES, glbUri: HAYES_LOW, preview: true, onFullModel }, g);
    expect(urls(g).filter((u) => u.endsWith('.glb'))).toEqual([HAYES_LOW]);
    expect(onFullModel).toHaveBeenCalledTimes(1);
  });
});

describe('I4. the three paths use it: Insert, Turn in 3D, the Stored-detail re-download', () => {
  const insertHayes = async (f) => {
    vi.stubGlobal('fetch', f);
    renderStlPanel($('stlLayerBody')); bindStlPanel({});
    $('stlBrowseSi').click();
    await flush();
    document.querySelector(`.stl-lib-tile[data-model-id="${HAYES}"]`).click();
    document.querySelector('#stlLibInsert').click();
    await flush();
  };
  it('Insert: the layer holds the UPRIGHT model (its stored mesh tallest along y), read from the scene, no parts lookup', async () => {
    stubThree();
    const f = siFetch();
    await insertHayes(f);
    expect(P.stlLayers).toHaveLength(1);
    expect(urls(f)).toContain(`${FOLDER}/scene.svx.json`);
    expect(urls(f).filter(isLookup('Low'))).toHaveLength(0);
    expect(argMax(P.stlLayers[0].mesh.size)).toBe(1);
    expect(P.stlLayers[0].source).toMatchObject({ modelUrl: HAYES, uri: HAYES_LOW });
  });
  it('Insert with no scene: the fallback as before (the parts lookup, lying sideways)', async () => {
    stubThree();
    const f = siFetch({ scene: () => new Response('no', { status: 404 }) });
    await insertHayes(f);
    expect(urls(f).filter(isLookup('Low'))).toHaveLength(1);
    expect(argMax(P.stlLayers[0].mesh.size)).toBe(0);
  });
  it('Turn in 3D: the scene\'s Thumb GLB, shown upright (the view\'s geometry tallest along y)', async () => {
    const three = stubThree();
    const f = siFetch();
    openStlLibrarySheet({ fetchImpl: f, onPick: vi.fn() });
    await flush();
    document.querySelector(`.stl-lib-tile[data-model-id="${HAYES}"]`).click();
    document.querySelector('#stlLibTurn').click();
    await flush();
    expect(urls(f).filter((u) => u.endsWith('.glb'))).toEqual([HAYES_THUMB]);
    expect(urls(f).filter(isLookup('Thumb'))).toHaveLength(0);
    expect(document.querySelector('#stlLibPane canvas')).toBeTruthy();
    expect(argMax(extents(three.geometries[0].attributes.position.array).size)).toBe(1);
  });
  it('the Stored-detail re-download after a reload reads the scene too (upright again)', async () => {
    stubThree();
    const f = siFetch();
    vi.stubGlobal('fetch', f);
    renderStlPanel($('stlLayerBody')); bindStlPanel({});
    const [pose] = parseVoyagerScene(SCENE(), FOLDER);
    addStlFromSoup(transformSoup(HAYES_BOX(), pose), 'Rutherford B. Hayes', { source: { provider: 'smithsonian', modelUrl: HAYES, title: 'Rutherford B. Hayes', uri: HAYES_LOW } });
    setStoredDetail(6);
    expect(P.stlLayers[0].storedTris).toBeLessThan(12);
    _resetStlPanelForTests();
    renderStlPanel($('stlLayerBody')); bindStlPanel({});
    $('stlDetailSlider').value = '12'; $('stlDetailSlider').dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(urls(f)).toContain(`${FOLDER}/scene.svx.json`);
    expect(urls(f).filter(isLookup('Low'))).toHaveLength(0);
    expect(P.stlLayers[0].storedTris).toBe(12);
    expect(argMax(P.stlLayers[0].mesh.size)).toBe(1);
  });
});

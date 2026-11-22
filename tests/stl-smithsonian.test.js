/**
 * SMITHSONIAN-BROWSER (SMITHSONIAN-BROWSER-DESIGN.md): browse the Smithsonian's open 3D collection from the STL panel.
 * The declared source (core/stl/smithsonian.js) on RECORDED live API responses (tests/fixtures/smithsonian/*.json), the GLB ->
 * triangle soup walk (core/stl/gltf.js) on THREE-shaped scenes, the one import path (main/stl-panel.js addStlFromSoup), and the
 * full-screen sheet (main/stl-library-sheet.js). NO network: fetch is stubbed with the recorded responses; the CDN loaders
 * (THREE.GLTFLoader / DRACOLoader) are stubbed because node has no THREE.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  SMITHSONIAN_SOURCE, smithsonianSearchUrl, parseSmithsonianSearch, fetchSmithsonianPage, smithsonianThumbGlbUrl, pickThumbGlbUri,
  smithsonianModelGlbsUrl, pickModelGlbUris,
} from '../bspline-frame-builder/b-spline-gen/html/core/stl/smithsonian.js';
import {
  GLTF_TO_BOARD, GLTF_LOADER_URLS, soupFromGltfScene, loadGlbScene, _resetGltfLoaderForTests,
} from '../bspline-frame-builder/b-spline-gen/html/core/stl/gltf.js';
import { parseStl } from '../bspline-frame-builder/b-spline-gen/html/core/stl/parse.js';
import { openStlLibrarySheet } from '../bspline-frame-builder/b-spline-gen/html/main/stl-library-sheet.js';
import {
  renderStlPanel, bindStlPanel, addStlFromBuffer, addStlFromSoup, noteStlProjectReplaced, setStoredDetail, _resetStlPanelForTests,
} from '../bspline-frame-builder/b-spline-gen/html/main/stl-panel.js';
import { PICKER_TILE } from '../bspline-frame-builder/b-spline-gen/html/main/icon-select.js';

const FX = (name) => JSON.parse(readFileSync(`tests/fixtures/smithsonian/${name}.json`, 'utf8'));
const DESIGN = readFileSync('SMITHSONIAN-BROWSER-DESIGN.md', 'utf8');
const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const $ = (id) => document.getElementById(id);
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

/** fetch stubbed with the RECORDED responses, chosen by the request's params (as the live API answered them). */
function fixtureFor(url) {
  const p = new URL(url).searchParams;
  if (p.get('owning_unit') === 'NPG') return 'search-npg';
  if (p.get('q') === 'leaf') return 'search-leaf';
  if (p.get('q') === 'nothing-here') return 'model-jpgs-none-wright-flyer'; // the API's real empty answer
  if (p.get('start') === '24') return 'search-skull-p2';
  return 'search-all-p1';
}
const fixtureFetch = () => vi.fn(async (url) => new Response(JSON.stringify(FX(fixtureFor(url))), { status: 200, headers: { 'content-type': 'application/json' } }));

// ── THREE-shaped scene objects (node has no THREE): Object3D's matrix / matrixWorld (column-major), traverse, updateMatrixWorld ──
const I4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const T4 = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
function mul4(a, b) { // column-major a * b, as THREE's Matrix4.multiplyMatrices
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function obj3d({ matrix = I4(), geometry = null, children = [] } = {}) {
  const o = { isMesh: !!geometry, geometry, matrix: { elements: matrix }, matrixWorld: { elements: I4() }, children, parent: null };
  for (const c of children) c.parent = o;
  o.traverse = (cb) => { cb(o); for (const c of o.children) c.traverse(cb); };
  o.updateMatrixWorld = () => {
    o.matrixWorld.elements = o.parent ? mul4(o.parent.matrixWorld.elements, o.matrix.elements) : o.matrix.elements.slice();
    for (const c of o.children) c.updateMatrixWorld(true);
  };
  return o;
}
const attr = (array, itemSize = 3) => ({ array, itemSize, count: array.length / itemSize });
/** A tetrahedron in glTF space (Y-up): the base on y = 0, the apex at +Y. */
const TETRA_POS = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1, 0.2, 2, 0.2]);
const TETRA_IDX = Uint16Array.from([0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3]);
function tetraScene() {
  const mesh = obj3d({ matrix: T4(0, 1, 0), geometry: { attributes: { position: attr(TETRA_POS) }, index: { array: TETRA_IDX, count: 12 } } });
  const parent = obj3d({ matrix: T4(10, 5, -3), children: [mesh] });
  return obj3d({ children: [parent] });
}
/** 'glTF' v2 header; byte 8 = a tag the stub loader reads (which part this file is: the stub's scene is moved by 100 * tag in x). */
const GLB_BYTES = (tag = 0) => { const b = new Uint8Array(64); b.set([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, tag]); return b.buffer; };
/** The tetrahedron scene moved by `dx` along x (a second part of one model). */
const tetraSceneAt = (dx) => obj3d({ matrix: T4(dx, 0, 0), children: [tetraScene()] });

// ── a stand-in THREE (node has none): the two CDN loaders (what GLTFLoader.js / DRACOLoader.js add to the global) and the few
//    r128 classes the preview's 3D view uses, counting what is created and disposed ─────────────────────────────────────────────
function stubThree({ scene = tetraScene, fail = null } = {}) {
  const seen = { decoderPath: null, parsed: 0, draco: null, renderers: [], geometries: [], materials: [], cameras: [] };
  class DRACOLoader { setDecoderPath(p) { seen.decoderPath = p; return this; } }
  class GLTFLoader {
    setDRACOLoader(d) { seen.draco = d; return this; }
    parse(buf, path, ok, err) {
      seen.parsed++;
      const tag = new Uint8Array(buf)[8] || 0;
      if (fail) err(new Error(fail)); else ok({ scene: tag ? tetraSceneAt(100 * tag) : scene() });
    }
  }
  class WebGLRenderer {
    constructor() { this.domElement = document.createElement('canvas'); this.renders = 0; this.disposed = false; seen.renderers.push(this); }
    setPixelRatio() {} setSize(w, h) { this.size = [w, h]; } setClearColor() {}
    render() { this.renders++; } dispose() { this.disposed = true; } forceContextLoss() { this.lost = true; }
  }
  class BufferAttribute { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; } }
  class BufferGeometry {
    constructor() { this.attributes = {}; this.disposed = false; seen.geometries.push(this); }
    setAttribute(k, a) { this.attributes[k] = a; return this; } computeVertexNormals() {} dispose() { this.disposed = true; }
  }
  class MeshStandardMaterial { constructor(o) { Object.assign(this, o); this.disposed = false; seen.materials.push(this); } dispose() { this.disposed = true; } }
  const v3 = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } });
  class Object3D { constructor() { this.children = []; this.position = v3(); this.up = v3(); this.rotation = { x: 0, y: 0, z: 0 }; } add(...c) { this.children.push(...c); return this; } lookAt(...a) { this.lookedAt = a; } }
  class Group extends Object3D {}
  class Scene extends Object3D {}
  class Mesh extends Object3D { constructor(g, m) { super(); this.geometry = g; this.material = m; } }
  class PerspectiveCamera extends Object3D { constructor(fov, aspect, near, far) { super(); Object.assign(this, { fov, aspect, near, far }); seen.cameras.push(this); } updateProjectionMatrix() {} }
  class AmbientLight extends Object3D {}
  class DirectionalLight extends Object3D {}
  globalThis.THREE = { GLTFLoader, DRACOLoader, WebGLRenderer, BufferAttribute, BufferGeometry, MeshStandardMaterial, Group, Scene, Mesh,
    PerspectiveCamera, AmbientLight, DirectionalLight, DoubleSide: 2 };
  return seen;
}

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

describe('a. the search URL', () => {
  it('page 0, no query: exactly the model filter, 24 rows from 0, no q and no owning_unit', () => {
    const u = new URL(smithsonianSearchUrl());
    expect(`${u.origin}${u.pathname}`).toBe('https://3d-api.si.edu/api/v1.0/content/file/search');
    expect(Object.fromEntries(u.searchParams)).toEqual({ file_type: 'glb', file_quality: 'Low', rows: '24', start: '0' });
    expect(u.searchParams.has('q')).toBe(false);
    expect(u.searchParams.has('owning_unit')).toBe(false);
    expect(new URL(smithsonianSearchUrl({ q: '   ', unit: '' })).searchParams.has('q')).toBe(false);
  });
  it('"skull" page 1 at NPG: q, owning_unit, start = 24', () => {
    const p = new URL(smithsonianSearchUrl({ q: ' skull ', unit: 'NPG', page: 1 })).searchParams;
    expect(p.get('q')).toBe('skull');
    expect(p.get('owning_unit')).toBe('NPG');
    expect(p.get('start')).toBe('24');
    expect(p.get('rows')).toBe('24');
    expect(p.get('file_type')).toBe('glb');
    expect(p.get('file_quality')).toBe('Low');
  });
});

describe('b. the search parser on recorded live responses', () => {
  it('the whole collection, page 1: 3,523 models, 24 tiles, each with its GLB and the thumbnail beside it', () => {
    const r = parseSmithsonianSearch(FX('search-all-p1'));
    expect(r.total).toBe(3523);
    expect(r.tiles).toHaveLength(24);
    for (const t of r.tiles) {
      expect(t.id).toMatch(/^3d_package:/);
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.glbUrl).toMatch(/\.glb$/);
      expect(t.thumbUrl).toBe(`${t.glbUrl.slice(0, t.glbUrl.lastIndexOf('/'))}/scene-image-thumb.jpg`);
    }
    expect(r.tiles[0]).toEqual({
      id: '3d_package:3f24212e-6753-4e25-b8c6-ed267375607a',
      title: 'Pan troglodytes verus: Talus Left',
      glbUrl: 'https://3d-api.si.edu/content/document/3d_package:3f24212e-6753-4e25-b8c6-ed267375607a/USNM481803_talus_left_-100-150k-1024-low.glb',
      thumbUrl: 'https://3d-api.si.edu/content/document/3d_package:3f24212e-6753-4e25-b8c6-ed267375607a/scene-image-thumb.jpg',
      previewUrl: 'https://3d-api.si.edu/content/document/3d_package:3f24212e-6753-4e25-b8c6-ed267375607a/scene-image-medium.jpg',
    });
  });
  it('"leaf": total 2; an empty answer: total 0, no tiles', () => {
    expect(parseSmithsonianSearch(FX('search-leaf'))).toMatchObject({ total: 2 });
    expect(parseSmithsonianSearch(FX('search-leaf')).tiles).toHaveLength(2);
    expect(parseSmithsonianSearch(FX('model-jpgs-none-wright-flyer'))).toEqual({ total: 0, tiles: [] });
  });
  it('a model listed twice appears once; a row without a uri is skipped', () => {
    const j = FX('search-leaf');
    const dup = { ...j, rows: [j.rows[0], { ...j.rows[0] }, j.rows[1], { title: 'no file', content: { model_url: '3d_package:x' } }] };
    const r = parseSmithsonianSearch(dup);
    expect(r.tiles.map((t) => t.id)).toEqual([j.rows[0].content.model_url, j.rows[1].content.model_url]);
    // the live NPG answer itself lists two models twice (a bust and its base are two GLB rows of one model)
    const npg = parseSmithsonianSearch(FX('search-npg'));
    expect(FX('search-npg').rows).toHaveLength(14);
    expect(npg.tiles).toHaveLength(12);
    expect(new Set(npg.tiles.map((t) => t.id)).size).toBe(12);
  });
  it('fetchSmithsonianPage reads the JSON; a refused request throws a readable message', async () => {
    const f = fixtureFetch();
    const r = await fetchSmithsonianPage({ q: 'leaf' }, f);
    expect(f).toHaveBeenCalledTimes(1);
    expect(new URL(f.mock.calls[0][0]).searchParams.get('q')).toBe('leaf');
    expect(r.total).toBe(2);
    const bad = vi.fn(async () => new Response('busy', { status: 503, statusText: 'Service Unavailable' }));
    await expect(fetchSmithsonianPage({}, bad)).rejects.toThrow(/503/);
  });
});

describe('b2. the small preview GLB lookup (fixture-free)', () => {
  it('the URL asks for that model\'s Thumb GLB only', () => {
    const u = new URL(smithsonianThumbGlbUrl('3d_package:abc-1'));
    expect(`${u.origin}${u.pathname}`).toBe(SMITHSONIAN_SOURCE.api);
    expect(Object.fromEntries(u.searchParams)).toEqual({ model_url: '3d_package:abc-1', file_type: 'glb', file_quality: 'Thumb' });
  });
  it('the row choice: the first row with a GLB uri; none -> null', () => {
    const row = (uri) => ({ title: 't', content: { uri, file_type: 'glb', quality: 'Thumb', model_url: '3d_package:abc-1' } });
    expect(pickThumbGlbUri({ rows: [row('https://x/a/USNM_1174917-20k-thumb.glb'), row('https://x/a/other-20k-512-thumb.glb')], rowCount: 2 }))
      .toBe('https://x/a/USNM_1174917-20k-thumb.glb');
    expect(pickThumbGlbUri({ rows: [{ title: 'no uri', content: {} }, row('https://x/b/b-20k-thumb.glb')], rowCount: 2 })).toBe('https://x/b/b-20k-thumb.glb');
    expect(pickThumbGlbUri({ rows: [], rowCount: 0 })).toBeNull();
    expect(pickThumbGlbUri(null)).toBeNull();
  });
});

describe('c. the museum table', () => {
  // the units the live API answered with Low GLBs (design section 2, measured), with their counts
  const lines = DESIGN.split('\n');
  const from = lines.findIndex((l) => l.includes('Per museum (owning_unit), Low GLBs'));
  const to = lines.findIndex((l, i) => i >= from && l.includes('FSG 0'));
  const line = lines.slice(from, to + 1).join(' ').split('Low GLBs:**')[1];
  const measured = [...line.matchAll(/([A-Za-z][A-Za-z-]+) ([\d,]+)/g)].map((m) => [m[1], Number(m[2].replace(/,/g, ''))]);
  it('every unit with models is listed once, FSG (0 models) is left out, names readable and unique', () => {
    expect(measured.length).toBeGreaterThan(15);
    const codes = SMITHSONIAN_SOURCE.museums.map(([c]) => c);
    expect(new Set(codes)).toEqual(new Set(measured.filter(([, n]) => n > 0).map(([c]) => c)));
    expect(codes).toHaveLength(new Set(codes).size);
    expect(codes).not.toContain('FSG');
    const names = SMITHSONIAN_SOURCE.museums.map(([, n]) => n);
    for (const n of names) expect(n.trim().length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
    expect(SMITHSONIAN_SOURCE.museums[0]).toEqual(['NMNHMAMMALS', 'Natural History: Mammals']);
  });
});

describe('d. GLB scene -> triangle soup', () => {
  it('the declared turn is the IDENTITY (relief default: a model lies FACE UP, its front +Z out of the board, its up +Y up the board)', () => {
    expect(GLTF_TO_BOARD([0, 1, 0])).toEqual([0, 1, 0]); // glTF up = up the board (the top of the board)
    expect(GLTF_TO_BOARD([0, 0, 1])).toEqual([0, 0, 1]); // glTF front = out of the board (the relief's height)
    expect(GLTF_TO_BOARD([1, 2, 3])).toEqual([1, 2, 3]);
  });
  it('a STANDING model (tall in glTF +Y, shallow in +Z) lies face up: its height runs up the board, its depth is the relief', () => {
    // a bust 2.6 tall (y), 1 wide (x), 0.4 deep (z): the measured column stamp came from standing it up out of the board
    const bust = Float32Array.from([0, 0, 0, 1, 0, 0, 0.5, 2.6, 0.4]);
    const soup = soupFromGltfScene(obj3d({ geometry: { attributes: { position: attr(bust) }, index: null } }));
    const zs = [soup[2], soup[5], soup[8]], ys = [soup[1], soup[4], soup[7]];
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(0.4, 6); // the relief height = its depth, not its 2.6 height
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2.6, 6);
  });
  it('an indexed tetrahedron under a translated parent: 4 triangles, the world matrices applied, the apex is the highest board y', () => {
    const soup = soupFromGltfScene(tetraScene());
    expect(soup).toBeInstanceOf(Float32Array);
    expect(soup.length).toBe(4 * 9); // the SAME soup shape parseStl returns: 9 floats per triangle
    const pts = []; for (let i = 0; i < soup.length; i += 3) pts.push([soup[i], soup[i + 1], soup[i + 2]]);
    const yMax = Math.max(...pts.map((p) => p[1]));
    // apex (0.2, 2, 0.2) + child (0, 1, 0) + parent (10, 5, -3) = (10.2, 8, -2.8) in glTF = on the board (face up)
    const apex = pts.find((p) => p[1] === yMax);
    expect(apex[0]).toBeCloseTo(10.2, 5); expect(apex[1]).toBeCloseTo(8, 5); expect(apex[2]).toBeCloseTo(-2.8, 5);
    // the base (y = 0 in glTF, + 6 from the two translations) is at board y = 6
    expect(Math.min(...pts.map((p) => p[1]))).toBeCloseTo(6, 5);
    expect(pts.filter((p) => Math.abs(p[1] - 6) < 1e-5)).toHaveLength(9); // 3 base vertices on each of the 3 triangles that touch it
    // first triangle = index (0, 2, 1): glTF (10,6,-3), (10,6,-2), (11,6,-3), unchanged on the board
    expect(Array.from(soup.slice(0, 9))).toEqual([10, 6, -3, 10, 6, -2, 11, 6, -3]);
  });
  it('a non-indexed mesh reads consecutive triples; meshes add up; non-mesh nodes are skipped', () => {
    const flat = obj3d({ geometry: { attributes: { position: attr(Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0])) }, index: null } });
    const scene = obj3d({ children: [flat, obj3d(), tetraScene()] });
    const soup = soupFromGltfScene(scene);
    expect(soup.length).toBe((1 + 4) * 9);
    expect(Array.from(soup.slice(0, 9)).map((v) => v + 0)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });
  it('an interleaved position attribute (stride + offset) is read in place', () => {
    // [x y z u v] per vertex, the position at offset 0 of a 5-float stride
    const data = { array: Float32Array.from([0, 0, 0, 9, 9, 1, 0, 0, 9, 9, 0, 1, 0, 9, 9]), stride: 5 };
    const pos = { isInterleavedBufferAttribute: true, data, offset: 0, itemSize: 3, count: 3 };
    const soup = soupFromGltfScene(obj3d({ geometry: { attributes: { position: pos }, index: null } }));
    expect(Array.from(soup).map((v) => v + 0)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });
  it('the loader URLs are pinned to the same three r128 the palette loads; nothing loads them at app start', () => {
    expect(GLTF_LOADER_URLS).toEqual({
      gltf: 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js',
      draco: 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/DRACOLoader.js',
      decoderPath: 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/draco/gltf/',
    });
    expect(HTML).toMatch(/three\.js\/r128\/three\.min\.js/);
    expect(HTML).not.toMatch(/GLTFLoader|DRACOLoader/);
  });
  it('loadGlbScene adds the two loader scripts once (first use), sets the Draco decoder path, and resolves the scene', async () => {
    globalThis.THREE = {};
    const added = [];
    vi.spyOn(document.head, 'appendChild').mockImplementation((s) => {
      added.push(s.src);
      setTimeout(() => {
        if (s.src === GLTF_LOADER_URLS.gltf) globalThis.THREE.GLTFLoader = class { setDRACOLoader(d) { this.d = d; return this; } parse(b, p, ok) { ok({ scene: { id: 'scene', d: this.d } }); } };
        if (s.src === GLTF_LOADER_URLS.draco) globalThis.THREE.DRACOLoader = class { setDecoderPath(p) { this.path = p; return this; } };
        s.onload?.();
      }, 0);
      return s;
    });
    const a = await loadGlbScene(GLB_BYTES());
    const b = await loadGlbScene(GLB_BYTES());
    expect(added).toEqual([GLTF_LOADER_URLS.gltf, GLTF_LOADER_URLS.draco]);
    expect(a.id).toBe('scene');
    expect(a.d.path).toBe(GLTF_LOADER_URLS.decoderPath);
    expect(b.id).toBe('scene');
  });
});

describe('e. one import path: addStlFromSoup', () => {
  const RECORD_KEYS = ['v', 'enabled', 'name', 'position', 'rotation', 'scale', 'zScale', 'unitIn', 'compress', 'blend', 'raise', 'softness',
    'placement', 'storedDetail', 'id', 'origTris', 'storedTris', 'health', 'mesh'].sort();
  const tri = (a, b, c) => [...a, ...b, ...c];
  const pyramid = () => { const A = [-5, -5, 0], B = [5, -5, 0], C = [5, 5, 0], D = [-5, 5, 0], T = [0, 0, 4];
    return Float32Array.from([tri(A, B, T), tri(B, C, T), tri(C, D, T), tri(D, A, T), tri(A, C, B), tri(A, D, C)].flat()); };
  const binaryStl = (soup) => { const n = soup.length / 9, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf); dv.setUint32(80, n, true);
    for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) dv.setFloat32(84 + t * 50 + 12 + k * 4, soup[t * 9 + k], true); return buf; };
  it('a GLB soup becomes a layer carrying its source; a soup without one carries none', () => {
    renderStlPanel($('stlLayerBody')); bindStlPanel({});
    const source = { provider: 'smithsonian', modelUrl: '3d_package:abc', title: 'A leaf', uri: 'https://3d-api.si.edu/x.glb' };
    const rec = addStlFromSoup(soupFromGltfScene(tetraScene()), 'A leaf', { source });
    expect(rec.source).toEqual(source);
    expect(rec).toMatchObject({ name: 'A leaf', origTris: 4, storedTris: 4 });
    expect(Object.keys(rec).sort()).toEqual([...RECORD_KEYS, 'source'].sort());
    expect($('stlSource').hidden).toBe(false);
    expect($('stlSource').textContent).toBe('From the Smithsonian (CC0): A leaf');
    const plain = addStlFromSoup(parseStl(binaryStl(pyramid())).soup, 'pyr');
    expect('source' in plain).toBe(false);
    expect($('stlSource').hidden).toBe(true);
  });
  it('addStlFromBuffer: the same record shape as before, copy-on-write (the previous list and DEFAULT untouched)', () => {
    P.stlLayers = DEFAULT.stlLayers;
    const before = P.stlLayers, beforeLen = before.length, defaultJson = JSON.stringify(DEFAULT.stlLayers);
    const rec = addStlFromBuffer(binaryStl(pyramid()), 'my pyramid.stl');
    expect(Object.keys(rec).sort()).toEqual(RECORD_KEYS);
    expect(rec).toMatchObject({ name: 'my pyramid', storedTris: 6, origTris: 6 });
    expect(rec.health).toMatchObject({ openEdges: 0 });
    expect(before).toHaveLength(beforeLen);
    expect(P.stlLayers).not.toBe(before);
    expect(JSON.stringify(DEFAULT.stlLayers)).toBe(defaultJson);
  });
});

describe('f. the full-screen sheet', () => {
  const open = (opts = {}) => openStlLibrarySheet({ fetchImpl: fixtureFetch(), onPick: vi.fn(), ...opts });
  const tiles = () => [...document.querySelectorAll('.stl-lib-tile')];
  const statusText = () => document.querySelector('#stlLibStatus').textContent;
  it('built on the app dialog classes, full screen, a close button >= 28 px; opening pages the whole collection', async () => {
    const fetchImpl = fixtureFetch();
    open({ fetchImpl });
    const overlay = document.querySelector('.cad-modal-overlay');
    expect(overlay).toBeTruthy();
    const win = overlay.querySelector('.cad-modal-window');
    expect(win.style.width).toBe('100vw'); expect(win.style.height).toBe('100vh');
    expect(win.querySelector('.cad-modal-header').textContent).toContain('Smithsonian 3D');
    expect(win.querySelector('.cad-modal-body')).toBeTruthy();
    const close = win.querySelector('.cad-modal-header button');
    expect(parseFloat(close.style.minWidth)).toBeGreaterThanOrEqual(28); expect(parseFloat(close.style.minHeight)).toBeGreaterThanOrEqual(28);
    expect(statusText()).toBe('Loading…');
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const p = new URL(fetchImpl.mock.calls[0][0]).searchParams;
    expect(p.has('q')).toBe(false); expect(p.has('owning_unit')).toBe(false); expect(p.get('start')).toBe('0');
    expect(tiles()).toHaveLength(24);
    expect(statusText()).toBe('24 models shown · more available'); // models SHOWN (the API's rowCount counts files)
    const first = tiles()[0];
    expect(first.tagName).toBe('BUTTON');
    expect(first.getAttribute('data-model-id')).toBe('3d_package:3f24212e-6753-4e25-b8c6-ed267375607a');
    const img = first.querySelector('img');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('src')).toMatch(/\/scene-image-thumb\.jpg$/);
    expect(first.textContent).toContain('Pan troglodytes verus: Talus Left');
    expect(document.querySelector('.stl-lib-credit').textContent).toBe(SMITHSONIAN_SOURCE.credit);
    // the tile grid from the shared picker tile size: 3+ per row on a 390 px phone
    expect(document.querySelector('#stlLibGrid').style.gridTemplateColumns).toBe(`repeat(auto-fill, minmax(${PICKER_TILE.tilePx}px, 1fr))`);
    expect(Math.floor(390 / PICKER_TILE.tilePx)).toBeGreaterThanOrEqual(3);
    // the museum picker is a native select: All museums + the declared table
    const sel = document.querySelector('select#stlLibMuseum');
    expect([...sel.options].map((o) => o.value)).toEqual(['', ...SMITHSONIAN_SOURCE.museums.map(([c]) => c)]);
    expect(sel.options[0].textContent).toBe('All museums');
  });
  it('More results fetches start = 24 and appends (a model already shown is not shown twice); hidden when all are shown', async () => {
    const fetchImpl = fixtureFetch();
    open({ fetchImpl });
    await flush();
    const more = document.querySelector('#stlLibMore');
    expect(more.hidden).toBe(false);
    more.click();
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(new URL(fetchImpl.mock.calls[1][0]).searchParams.get('start')).toBe('24');
    // the recorded page 2 shares one model with page 1
    expect(tiles()).toHaveLength(47);
    expect(new Set(tiles().map((t) => t.getAttribute('data-model-id'))).size).toBe(47);
    expect(tiles()[0].getAttribute('data-model-id')).toBe('3d_package:3f24212e-6753-4e25-b8c6-ed267375607a');
    expect(statusText()).toBe('47 models shown · more available');
    // "leaf": 2 of 2, nothing more to fetch
    document.querySelector('#stlLibQuery').value = 'leaf';
    document.querySelector('#stlLibSearch').click();
    await flush();
    expect(tiles()).toHaveLength(2);
    expect(statusText()).toBe('2 models shown');
    expect(more.hidden).toBe(true);
  });
  it('a museum + Search refetches with owning_unit and resets the grid; Enter in the box searches too', async () => {
    const fetchImpl = fixtureFetch();
    open({ fetchImpl });
    await flush();
    document.querySelector('#stlLibMuseum').value = 'NPG';
    document.querySelector('#stlLibSearch').click();
    expect(statusText()).toBe('Loading…');
    await flush();
    const p = new URL(fetchImpl.mock.calls[1][0]).searchParams;
    expect(p.get('owning_unit')).toBe('NPG'); expect(p.get('start')).toBe('0'); expect(p.has('q')).toBe(false);
    expect(tiles()).toHaveLength(12); // 14 rows, two models listed twice
    expect(tiles()[0].textContent).toContain('Theodore Roosevelt');
    expect(statusText()).toBe('12 models shown'); // was '1–14 of 14' with 12 tiles: the rows are files, not models
    document.querySelector('#stlLibMuseum').value = '';
    const q = document.querySelector('#stlLibQuery');
    q.value = 'nothing-here';
    q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(new URL(fetchImpl.mock.calls[2][0]).searchParams.get('q')).toBe('nothing-here');
    expect(tiles()).toHaveLength(0);
    expect(statusText()).toBe('No models found');
  });
  it('a stale response (searched again meanwhile) is dropped', async () => {
    let release; const gate = new Promise((r) => { release = r; });
    const real = fixtureFetch();
    const fetchImpl = vi.fn(async (url) => { if (!new URL(url).searchParams.has('q')) await gate; return real(url); });
    open({ fetchImpl });
    document.querySelector('#stlLibQuery').value = 'leaf';
    document.querySelector('#stlLibSearch').click();
    await flush();
    expect(tiles()).toHaveLength(2);
    release(); // the whole-collection page lands late
    await flush();
    expect(tiles()).toHaveLength(2);
    expect(statusText()).toBe('2 models shown');
  });
  it('a tile tap SELECTS it and fills the preview pane (nothing inserted); Insert calls onPick with that tile and closes', async () => {
    const onPick = vi.fn();
    open({ onPick });
    await flush();
    const pane = document.querySelector('#stlLibPane');
    expect(pane.hidden).toBe(true);
    tiles()[3].click();
    const t3 = parseSmithsonianSearch(FX('search-all-p1')).tiles[3];
    expect(onPick).not.toHaveBeenCalled();
    expect(document.querySelector('.cad-modal-overlay')).toBeTruthy();
    expect(tiles()[3].classList.contains('active')).toBe(true);
    expect(tiles().filter((t) => t.classList.contains('active'))).toHaveLength(1);
    expect(pane.hidden).toBe(false);
    expect(pane.querySelector('img').getAttribute('src')).toBe(t3.previewUrl);
    expect(pane.querySelector('img').getAttribute('src')).toMatch(/\/scene-image-medium\.jpg$/);
    expect(pane.querySelector('.stl-lib-pane-title').textContent).toBe(t3.title);
    expect(document.querySelector('#stlLibTurn').textContent).toBe('Turn in 3D');
    expect(document.querySelector('#stlLibInsert').textContent).toBe('Insert');
    // another tile moves the selection
    tiles()[5].click();
    expect(tiles()[3].classList.contains('active')).toBe(false);
    expect(tiles()[5].classList.contains('active')).toBe(true);
    document.querySelector('#stlLibInsert').click();
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0]).toEqual(parseSmithsonianSearch(FX('search-all-p1')).tiles[5]);
    expect(document.querySelector('.cad-modal-overlay')).toBeNull();
  });
  it('the large picture falls back to the thumbnail, then to the title alone', async () => {
    open();
    await flush();
    tiles()[0].click();
    const t0 = parseSmithsonianSearch(FX('search-all-p1')).tiles[0];
    const img = () => document.querySelector('#stlLibPane img');
    img().dispatchEvent(new Event('error'));
    expect(img().getAttribute('src')).toBe(t0.thumbUrl);
    img().dispatchEvent(new Event('error'));
    expect(img()).toBeNull();
    expect(document.querySelector('#stlLibPane .stl-lib-pane-title').textContent).toBe(t0.title);
  });
  it('a thumbnail that fails to load leaves a title tile', async () => {
    open();
    await flush();
    const t = tiles()[0];
    t.querySelector('img').dispatchEvent(new Event('error'));
    expect(t.querySelector('img')).toBeNull();
    expect(t.textContent).toBe('Pan troglodytes verus: Talus Left');
  });
  it('a failed search shows its message in the status line', async () => {
    open({ fetchImpl: vi.fn(async () => new Response('down', { status: 500, statusText: 'Internal Server Error' })) });
    await flush();
    expect(statusText()).toMatch(/500/);
    expect(document.querySelector('#stlLibStatus').classList.contains('stl-error')).toBe(true);
    expect(tiles()).toHaveLength(0);
    expect(document.querySelector('#stlLibMore').hidden).toBe(true);
  });
  it('Escape closes it, and so does the close button; closing removes its key listener', async () => {
    const add = vi.spyOn(document, 'addEventListener'), rem = vi.spyOn(document, 'removeEventListener');
    open();
    await flush();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.cad-modal-overlay')).toBeNull();
    const keyAdds = add.mock.calls.filter(([t]) => t === 'keydown').map(([, f]) => f);
    expect(keyAdds).toHaveLength(1);
    expect(rem.mock.calls.some(([t, f]) => t === 'keydown' && f === keyAdds[0])).toBe(true);
    open();
    document.querySelector('.cad-modal-header button').click();
    expect(document.querySelector('.cad-modal-overlay')).toBeNull();
  });
});

describe('f2. Turn in 3D', () => {
  const t0 = () => parseSmithsonianSearch(FX('search-all-p1')).tiles[0];
  /** fetch: searches -> the recorded page; the Thumb lookup -> `thumbRows`; any .glb -> a glTF header. */
  const fetchWith = ({ thumbRows = [{ title: 't', content: { uri: 'https://3d-api.si.edu/content/document/x/USNM_1174917-20k-thumb.glb' } }], lookup = null } = {}) => {
    const search = fixtureFetch();
    return vi.fn(async (url) => {
      const s = String(url);
      if (s.endsWith('.glb')) return new Response(GLB_BYTES(), { status: 200 });
      if (new URL(s).searchParams.get('file_quality') === 'Thumb') return lookup ? lookup() : new Response(JSON.stringify({ rows: thumbRows, rowCount: thumbRows.length }), { status: 200 });
      return search(s);
    });
  };
  const openAndSelect = async (fetchImpl, i = 0) => {
    const h = openStlLibrarySheet({ fetchImpl, onPick: vi.fn() });
    await flush();
    document.querySelectorAll('.stl-lib-tile')[i].click();
    return h;
  };
  const note = () => document.querySelector('#stlLibPaneNote');
  it('looks up the model\'s small preview GLB, loads it with the Draco loader and shows a turnable view in place of the picture', async () => {
    const three = stubThree();
    const fetchImpl = fetchWith();
    await openAndSelect(fetchImpl);
    document.querySelector('#stlLibTurn').click();
    await flush();
    const urls = fetchImpl.mock.calls.map(([u]) => String(u));
    const lookup = urls.find((u) => u.includes('file_quality=Thumb'));
    expect(new URL(lookup).searchParams.get('model_url')).toBe(t0().id);
    expect(urls).toContain('https://3d-api.si.edu/content/document/x/USNM_1174917-20k-thumb.glb');
    expect(urls).not.toContain(t0().glbUrl);
    expect(three.parsed).toBe(1);
    expect(three.decoderPath).toBe(GLTF_LOADER_URLS.decoderPath);
    expect(three.renderers).toHaveLength(1);
    const canvas = document.querySelector('#stlLibPane canvas');
    expect(canvas).toBe(three.renderers[0].domElement);
    expect(document.querySelector('#stlLibPane img')).toBeNull();
    // the model is the board's soup (Z-up): 4 triangles of the tetrahedron, centred
    const pos = three.geometries[0].attributes.position;
    expect(pos.array.length).toBe(4 * 9);
    expect(three.renderers[0].renders).toBeGreaterThan(0);
    // a drag turns it (and redraws)
    const before = three.renderers[0].renders;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, pointerId: 1, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 40, clientY: 25, pointerId: 1, bubbles: true }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 40, clientY: 25, pointerId: 1, bubbles: true }));
    expect(three.renderers[0].renders).toBeGreaterThan(before);
  });
  it('no Thumb GLB: the full model is loaded and the pane says so', async () => {
    stubThree();
    const inner = fetchWith({ thumbRows: [] });
    let noteWhileLoading = null;
    const fetchImpl = vi.fn(async (url) => { if (String(url) === t0().glbUrl) noteWhileLoading = note().textContent; return inner(url); });
    await openAndSelect(fetchImpl);
    document.querySelector('#stlLibTurn').click();
    await flush();
    expect(fetchImpl.mock.calls.map(([u]) => String(u))).toContain(t0().glbUrl);
    expect(noteWhileLoading).toMatch(/loading the full model \(~0\.8 MB\)/);
    expect(document.querySelector('#stlLibPane canvas')).toBeTruthy();
  });
  it('a lookup error: a message in the pane, the picture stays, no view', async () => {
    const three = stubThree();
    await openAndSelect(fetchWith({ lookup: () => new Response('no', { status: 502, statusText: 'Bad Gateway' }) }));
    document.querySelector('#stlLibTurn').click();
    await flush();
    expect(note().textContent).toMatch(/502/);
    expect(note().classList.contains('stl-error')).toBe(true);
    expect(document.querySelector('#stlLibPane img').getAttribute('src')).toBe(t0().previewUrl);
    expect(three.renderers).toHaveLength(0);
    expect(document.querySelector('#stlLibPane canvas')).toBeNull();
  });
  it('closing the sheet disposes the 3D view: renderer, geometry, material, canvas, listeners -- nothing left behind', async () => {
    const three = stubThree();
    const h = await openAndSelect(fetchWith());
    document.querySelector('#stlLibTurn').click();
    await flush();
    const canvas = document.querySelector('#stlLibPane canvas');
    const rem = vi.spyOn(canvas, 'removeEventListener');
    document.querySelector('.cad-modal-header button').click();
    expect(three.renderers[0].disposed).toBe(true);
    expect(three.renderers[0].lost).toBe(true);
    expect(three.geometries.every((g) => g.disposed)).toBe(true);
    expect(three.materials.every((m) => m.disposed)).toBe(true);
    expect(canvas.isConnected).toBe(false);
    expect(document.querySelectorAll('canvas')).toHaveLength(0);
    expect(rem.mock.calls.map(([t]) => t)).toEqual(expect.arrayContaining(['pointerdown', 'pointermove', 'pointerup', 'pointercancel']));
    expect(h.overlay.isConnected).toBe(false);
  });
  it('selecting another tile disposes the view and shows that tile\'s picture; a view still loading for the old tile is dropped', async () => {
    const three = stubThree();
    await openAndSelect(fetchWith());
    document.querySelector('#stlLibTurn').click();
    await flush();
    document.querySelectorAll('.stl-lib-tile')[1].click();
    expect(three.renderers[0].disposed).toBe(true);
    expect(document.querySelectorAll('canvas')).toHaveLength(0);
    const t1 = parseSmithsonianSearch(FX('search-all-p1')).tiles[1];
    expect(document.querySelector('#stlLibPane img').getAttribute('src')).toBe(t1.previewUrl);
    // Turn on tile 1, then pick tile 2 before it loads: no view appears for tile 1
    document.querySelector('#stlLibTurn').click();
    document.querySelectorAll('.stl-lib-tile')[2].click();
    await flush();
    expect(three.renderers).toHaveLength(1);
    expect(document.querySelectorAll('canvas')).toHaveLength(0);
  });
});

describe('g. the panel', () => {
  const setup = () => { renderStlPanel($('stlLayerBody')); bindStlPanel({}); };
  const leafTile = () => parseSmithsonianSearch(FX('search-leaf')).tiles[0];
  /** fetch: the search -> the recorded "leaf" answer; the leaf's GLB -> a glTF header (THREE's loader is stubbed). */
  const panelFetch = ({ glb = async () => new Response(GLB_BYTES(), { status: 200 }) } = {}) => vi.fn(async (url) => {
    if (String(url).endsWith('.glb')) return glb(url);
    return new Response(JSON.stringify(FX('search-leaf')), { status: 200 });
  });
  it('the Browse button sits beside Add STL and opens the sheet; both file inputs take .glb', async () => {
    const f = panelFetch(); vi.stubGlobal('fetch', f);
    setup();
    const b = $('stlBrowseSi');
    expect(b).toBeTruthy();
    expect(b.parentElement.classList.contains('stl-add-row')).toBe(true);
    expect(b.textContent).toBe('🏛 Browse Smithsonian…');
    for (const id of ['stlFile', 'stlReimportFile']) {
      expect($(id).getAttribute('accept')).toContain('.glb');
      expect($(id).getAttribute('accept')).toContain('model/gltf-binary');
      expect($(id).getAttribute('accept')).toContain('.stl');
    }
    expect(document.querySelectorAll('script')).toHaveLength(0); // the loaders are not loaded by the panel
    b.click();
    expect(document.querySelector('.cad-modal-overlay .cad-modal-window')).toBeTruthy();
    await flush();
    expect(f).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.stl-lib-tile')).toHaveLength(2);
  });
  const insertFirst = async () => {
    $('stlBrowseSi').click();
    await flush();
    document.querySelector('.stl-lib-tile').click();
    document.querySelector('#stlLibInsert').click();
  };
  it('Insert downloads the GLB and adds it through the one import path, with its source and the note', async () => {
    const f = panelFetch(); vi.stubGlobal('fetch', f);
    const three = stubThree();
    setup();
    await insertFirst();
    await flush();
    const t = leafTile();
    expect(f.mock.calls.map(([u]) => String(u))).toContain(t.glbUrl);
    expect(three.parsed).toBe(1);
    expect(three.decoderPath).toBe(GLTF_LOADER_URLS.decoderPath);
    expect(P.stlLayers).toHaveLength(1);
    expect(P.stlLayers[0]).toMatchObject({ name: t.title, origTris: 4, source: { provider: 'smithsonian', modelUrl: t.id, title: t.title, uri: t.glbUrl } });
    expect($('stlSource').textContent).toBe(`From the Smithsonian (CC0): ${t.title}`);
    expect($('stlStatus').hidden).toBe(true);
  });
  it('a failed download: the panel says so, nothing is added', async () => {
    vi.stubGlobal('fetch', panelFetch({ glb: async () => new Response('gone', { status: 404, statusText: 'Not Found' }) }));
    stubThree();
    setup();
    await insertFirst();
    await flush();
    expect(P.stlLayers ?? []).toHaveLength(0);
    expect($('stlStatus').hidden).toBe(false);
    expect($('stlStatus').classList.contains('stl-error')).toBe(true);
    expect($('stlStatus').textContent).toMatch(new RegExp(`^Could not load ${leafTile().title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: .*404`));
  });
  it('a project load during the download drops the model with the import message', async () => {
    let release; const gate = new Promise((r) => { release = r; });
    vi.stubGlobal('fetch', panelFetch({ glb: async () => { await gate; return new Response(GLB_BYTES(), { status: 200 }); } }));
    stubThree();
    setup();
    await insertFirst();
    await flush();
    noteStlProjectReplaced();
    release();
    await flush();
    expect(P.stlLayers ?? []).toHaveLength(0);
    expect($('stlStatus').textContent).toBe('The project changed while the STL was being read: add it again.');
  });
  it('a .glb picked with the file button goes through the GLB loader and the same import path', async () => {
    const three = stubThree();
    setup();
    const input = $('stlFile');
    Object.defineProperty(input, 'files', { value: [{ name: 'bust.glb', arrayBuffer: async () => GLB_BYTES() }], configurable: true });
    input.dispatchEvent(new Event('change'));
    await flush();
    expect(three.parsed).toBe(1);
    expect(P.stlLayers).toHaveLength(1);
    expect(P.stlLayers[0]).toMatchObject({ name: 'bust', origTris: 4 });
    expect('source' in P.stlLayers[0]).toBe(false);
  });
});

describe('A2. Turn in 3D shows the model as its picture does (front view, upright)', () => {
  it('the camera sits on +Z looking down -Z at the centred model, camera.up = +Y, at the distance that frames its bounds', async () => {
    const three = stubThree();
    const fetchImpl = vi.fn(async (url) => {
      const s = String(url);
      if (s.endsWith('.glb')) return new Response(GLB_BYTES(), { status: 200 });
      if (new URL(s).searchParams.get('file_quality') === 'Thumb') return new Response(JSON.stringify({ rows: [{ title: 't', content: { uri: 'https://x/a/t-20k-thumb.glb' } }], rowCount: 1 }), { status: 200 });
      return fixtureFetch()(s);
    });
    openStlLibrarySheet({ fetchImpl, onPick: vi.fn() });
    await flush();
    document.querySelector('.stl-lib-tile').click();
    document.querySelector('#stlLibTurn').click();
    await flush();
    expect(three.cameras).toHaveLength(1);
    const cam = three.cameras[0];
    expect([cam.up.x, cam.up.y, cam.up.z]).toEqual([0, 1, 0]);
    expect(cam.position.x).toBe(0);
    expect(cam.position.y).toBe(0);
    expect(cam.position.z).toBeGreaterThan(0);
    expect(cam.lookedAt).toEqual([0, 0, 0]);
    // framed on the soup's bounds: the tetrahedron (world) spans x 10..11, y 6..8, z -3..-2; its bounding sphere fits the fov
    const r = Math.hypot(1, 2, 1) / 2;
    expect(cam.position.z).toBeCloseTo(r / Math.sin((cam.fov / 2) * Math.PI / 180), 5);
  });
});

describe('A3. a multi-part model (a bust and its base: two Low GLB rows of ONE model) loads every part', () => {
  const NPG = FX('search-npg');
  const WASH = '3d_package:d8c63fde-4ebc-11ea-b77f-2e728ce88125'; // George Washington: listed twice in the live NPG answer
  /** the per-model Low-GLB lookup's answer, in the recorded row shape: the model's two rows of search-npg.json */
  const partsJson = () => ({ rows: NPG.rows.filter((r) => r.content.model_url === WASH), rowCount: 2, message: NPG.message });
  const PARTS = () => partsJson().rows.map((r) => r.content.uri);
  const washTile = () => parseSmithsonianSearch(NPG).tiles.find((t) => t.id === WASH);
  /** fetch: the lookup (model_url, Low) -> lookup(); a part's .glb -> a GLB tagged 1, 2 (its row order); else the recorded NPG page */
  const npgFetch = ({ lookup = () => new Response(JSON.stringify(partsJson()), { status: 200 }) } = {}) => vi.fn(async (url) => {
    const s = String(url);
    if (s.endsWith('.glb')) return new Response(GLB_BYTES(PARTS().indexOf(s) + 1), { status: 200 });
    const p = new URL(s).searchParams;
    if (p.get('model_url') && p.get('file_quality') === 'Low') return lookup();
    if (p.get('model_url') && p.get('file_quality') === 'Thumb') return new Response(JSON.stringify({ rows: [], rowCount: 0 }), { status: 200 });
    return new Response(JSON.stringify(NPG), { status: 200 });
  });
  const isLowLookup = (u) => !u.endsWith('.glb') && !!new URL(u).searchParams.get('model_url') && new URL(u).searchParams.get('file_quality') === 'Low';
  const lowLookups = (f) => f.mock.calls.map(([u]) => String(u)).filter(isLowLookup);
  const glbCalls = (f) => f.mock.calls.map(([u]) => String(u)).filter((u) => u.endsWith('.glb'));
  const insertWash = async () => {
    renderStlPanel($('stlLayerBody')); bindStlPanel({});
    $('stlBrowseSi').click();
    await flush();
    document.querySelector(`.stl-lib-tile[data-model-id="${WASH}"]`).click();
    document.querySelector('#stlLibInsert').click();
    await flush(10);
  };

  it('the declared lookup: model_url + the model filter (glb, Low) + rows=50; the row choice keeps every GLB of that model', () => {
    const u = new URL(smithsonianModelGlbsUrl(WASH));
    expect(`${u.origin}${u.pathname}`).toBe(SMITHSONIAN_SOURCE.api);
    expect(Object.fromEntries(u.searchParams)).toEqual({ model_url: WASH, file_type: 'glb', file_quality: 'Low', rows: '50' });
    expect(PARTS()).toHaveLength(2);
    expect(pickModelGlbUris(partsJson(), WASH)).toEqual(PARTS());
    expect(pickModelGlbUris({ rows: [], rowCount: 0 }, WASH)).toEqual([]);
    expect(pickModelGlbUris(null, WASH)).toEqual([]);
  });
  it('Insert downloads BOTH parts and adds ONE layer holding both soups', async () => {
    const f = npgFetch(); vi.stubGlobal('fetch', f);
    const three = stubThree();
    await insertWash();
    expect(lowLookups(f)).toHaveLength(1);
    expect(new URL(lowLookups(f)[0]).searchParams.get('model_url')).toBe(WASH);
    expect(glbCalls(f).sort()).toEqual(PARTS().sort());
    expect(three.parsed).toBe(2);
    expect(P.stlLayers).toHaveLength(1);
    expect(P.stlLayers[0]).toMatchObject({ name: washTile().title, origTris: 8, source: { provider: 'smithsonian', modelUrl: WASH, uri: washTile().glbUrl } });
  });
  it('a lookup failure falls back to the tile\'s own GLB (one part)', async () => {
    const f = npgFetch({ lookup: () => new Response('no', { status: 502, statusText: 'Bad Gateway' }) }); vi.stubGlobal('fetch', f);
    const three = stubThree();
    await insertWash();
    expect(lowLookups(f)).toHaveLength(1);
    expect(glbCalls(f)).toEqual([washTile().glbUrl]);
    expect(three.parsed).toBe(1);
    expect(P.stlLayers).toHaveLength(1);
    expect(P.stlLayers[0]).toMatchObject({ origTris: 4 });
  });
  it('Turn in 3D without a Thumb GLB falls back to ALL the Low parts', async () => {
    const three = stubThree();
    const f = npgFetch();
    openStlLibrarySheet({ fetchImpl: f, onPick: vi.fn() });
    await flush();
    document.querySelector(`.stl-lib-tile[data-model-id="${WASH}"]`).click();
    document.querySelector('#stlLibTurn').click();
    await flush(10);
    expect(lowLookups(f)).toHaveLength(1);
    expect(glbCalls(f).sort()).toEqual(PARTS().sort());
    expect(three.parsed).toBe(2);
    expect(three.geometries[0].attributes.position.array.length).toBe(8 * 9);
  });
  it('the Stored-detail re-download (after a reload) fetches every part too', async () => {
    const f = npgFetch(); vi.stubGlobal('fetch', f);
    const three = stubThree();
    renderStlPanel($('stlLayerBody')); bindStlPanel({});
    // the two parts as imported, then stored at 4 triangles and a reload (the in-memory original gone)
    const both = new Float32Array([...soupFromGltfScene(tetraSceneAt(100)), ...soupFromGltfScene(tetraSceneAt(200))]);
    addStlFromSoup(both, 'George Washington', { source: { provider: 'smithsonian', modelUrl: WASH, title: 'George Washington', uri: washTile().glbUrl } });
    expect(P.stlLayers[0].origTris).toBe(8);
    setStoredDetail(4);
    const low = P.stlLayers[0].storedTris;
    expect(low).toBeLessThan(8);
    _resetStlPanelForTests();
    renderStlPanel($('stlLayerBody')); bindStlPanel({});
    $('stlDetailSlider').value = '8'; $('stlDetailSlider').dispatchEvent(new Event('change', { bubbles: true }));
    await flush(10);
    expect(lowLookups(f)).toHaveLength(1);
    expect(glbCalls(f).sort()).toEqual(PARTS().sort());
    expect(three.parsed).toBe(2);
    expect(P.stlLayers[0].storedTris).toBe(8);
  });
});

describe('A5. phone: the preview stays small enough for the grid to show below it', () => {
  const CSS = readFileSync('bspline-frame-builder/styles/layout-app.css', 'utf8').replace(/\r\n/g, '\n');
  it('<= 600 px: the picture AND the 3D canvas max-height 40vh, object-fit contain', () => {
    const at = CSS.indexOf('@media (max-width: 600px) {\n  .stl-lib-main');
    expect(at).toBeGreaterThan(-1);
    const block = CSS.slice(at, CSS.indexOf('\n}', at));
    const decl = (sel) => [...block.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, sels]) => sels.split(',').map((x) => x.trim()).includes(sel)).map(([, , d]) => d).join(';');
    for (const sel of ['.stl-lib-preview', '.stl-lib-view']) {
      expect(decl(sel)).toMatch(/max-height:\s*40vh/);
      expect(decl(sel)).toMatch(/object-fit:\s*contain/);
    }
  });
});

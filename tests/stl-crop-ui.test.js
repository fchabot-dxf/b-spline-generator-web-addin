/**
 * STL-CROP worker R (Fred 2026-11-22, decisions A-E): the crop in its two places (ONE mechanism, core/stl/crop.js cropMesh) and
 * the Recent list.
 *  - The library sheet: Crop mode in the pane (the box drawn in the 3D view, the six shared sliders); Insert cuts the downloaded
 *    model BEFORE it is stored and the record remembers the box; Recent gets the entry and its Insert re-applies the crop.
 *  - The STL panel: a Crop group in each card (sliders preview on the ghost, nothing is cut until Apply; Apply = one undo step;
 *    Reset only before Apply) and the falloff controls (a live record field).
 * The real panel and sheet on the real shell, the recorded SMK fixtures with a stubbed fetch, a stand-in THREE. NO network.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { scheduleUndoSnapshot } from '../bspline-frame-builder/b-spline-gen/html/core/history.js';
import { SMK_SOURCE } from '../bspline-frame-builder/b-spline-gen/html/core/stl/smk.js';
import { SMITHSONIAN_SOURCE } from '../bspline-frame-builder/b-spline-gen/html/core/stl/smithsonian.js';
import { indexMesh, decodeMesh, meshBounds } from '../bspline-frame-builder/b-spline-gen/html/core/stl/mesh.js';
import { cropMesh, placedFootprint } from '../bspline-frame-builder/b-spline-gen/html/core/stl/crop.js';
import { readRecent, pushRecent, recentEntryOf, RECENT_KEY, RECENT_MAX } from '../bspline-frame-builder/b-spline-gen/html/core/stl/recent.js';
import { ghostState, updateStlGhosts } from '../bspline-frame-builder/b-spline-gen/html/core/stl/ghost.js';
import {
  renderStlPanel, bindStlPanel, addStlFromSoup, addStlFromBuffer, setStoredDetail, setStlField, applyStlCrop, _resetStlPanelForTests,
} from '../bspline-frame-builder/b-spline-gen/html/main/stl-panel.js';
import { mountLayerStack } from './helpers/layer-stack-mount.js'; // the STL cards are the layer stack's (main/layer-stack.js)

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/history.js', () => ({ scheduleUndoSnapshot: vi.fn() }));

const SMK = (name) => JSON.parse(readFileSync(`tests/fixtures/smk/${name}.json`, 'utf8'));
const SI = (name) => JSON.parse(readFileSync(`tests/fixtures/smithsonian/${name}.json`, 'utf8'));
const $ = (id) => document.getElementById(id);
const flush = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const RELIEF = 'KAS2906/8';
const STL_URL = 'https://api.smk.dk/api/v1/download-3d/8623j340n_KAS2906-8_small.stl';

// ── a standing slab (40 wide x 4 thin along Y x 100 tall, Z-up) with a bump on its -Y face: SMK's shape, closed ──
const tri = (a, b, c) => [...a, ...b, ...c];
function standingSlab() {
  const [x0, x1, y0, y1, z0, z1] = [0, 40, -2, 2, 0, 100];
  const v = (x, y, z) => [x, y, z];
  const q = (a, b, c, d) => [tri(a, b, c), tri(a, c, d)];
  const A = v(x0, y0, z0), B = v(x1, y0, z0), C = v(x1, y0, z1), D = v(x0, y0, z1);
  const E = v(x0, y1, z0), F = v(x1, y1, z0), G = v(x1, y1, z1), H = v(x0, y1, z1);
  const faces = [...q(A, B, F, E), ...q(D, H, G, C), ...q(E, F, G, H), ...q(A, E, H, D), ...q(B, C, G, F)];
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
function bothFetch() {
  return vi.fn(async (url, init) => {
    const s = String(url);
    if (init && init.headers && init.headers.Range) return new Response(new Uint8Array(1), { status: 206, headers: { 'content-range': 'bytes 0-0/815012' } });
    if (s.startsWith(SMK_SOURCE.api)) return json(SMK('search-all-p1'));
    if (s.startsWith('https://api.smk.dk/api/v1/download-3d/')) return new Response(binaryStl(standingSlab()), { status: 200 });
    if (s.startsWith(SMITHSONIAN_SOURCE.api)) return json(SI('search-all-p1'));
    return new Response('not stubbed', { status: 404 });
  });
}
const downloads = (f) => f.mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('https://api.smk.dk/api/v1/download-3d/'));

/** A stand-in THREE with what the 3D view and its crop overlay use; it records the renderers and the line geometries. */
function stubThree() {
  const seen = { renderers: [], lines: [] };
  class WebGLRenderer {
    constructor() { this.domElement = document.createElement('canvas'); seen.renderers.push(this); this.localClippingEnabled = false; }
    setPixelRatio() {} setSize() {} setClearColor() {} render() {} dispose() {} forceContextLoss() {}
  }
  class BufferGeometry { constructor() { this.attributes = {}; } setAttribute(k, a) { this.attributes[k] = a; return this; } computeVertexNormals() {} dispose() {} }
  class Mat { constructor(o = {}) { Object.assign(this, o); } dispose() {} }
  const v3 = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } });
  class O3 {
    constructor() { this.children = []; this.position = v3(); this.up = v3(); this.rotation = { x: 0, y: 0, z: 0 }; this.matrixWorld = {}; this.visible = true; }
    add(...c) { this.children.push(...c); return this; } lookAt() {} updateMatrixWorld() {}
  }
  class Plane { constructor() { this.normal = null; this.constant = 0; } set(n, c) { this.normal = n; this.constant = c; return this; } copy(p) { this.normal = p.normal; this.constant = p.constant; return this; } applyMatrix4() { return this; } }
  class LineSegments extends O3 { constructor(g, m) { super(); this.geometry = g; this.material = m; seen.lines.push(this); } }
  globalThis.THREE = { WebGLRenderer, BufferAttribute: class { constructor(a, n) { this.array = a; this.itemSize = n; } }, BufferGeometry,
    MeshStandardMaterial: Mat, MeshBasicMaterial: Mat, LineBasicMaterial: Mat, Plane, Vector3: class { constructor(x, y, z) { Object.assign(this, { x, y, z }); } },
    Group: O3, Scene: O3, Mesh: class extends O3 { constructor(g, m) { super(); this.geometry = g; this.material = m; } }, LineSegments,
    PerspectiveCamera: class extends O3 { updateProjectionMatrix() {} }, AmbientLight: O3, DirectionalLight: O3, DoubleSide: 2 };
  return seen;
}
const setSlider = (id, v) => { const s = $(id); s.value = String(v); s.dispatchEvent(new Event('input', { bubbles: true })); };
const extent = (arr, a) => { let lo = Infinity, hi = -Infinity; for (let i = a; i < arr.length; i += 3) { lo = Math.min(lo, arr[i]); hi = Math.max(hi, arr[i]); } return [lo, hi]; };

const saved = {};
beforeEach(() => {
  Object.assign(saved, { stl: P.stlLayers, w: P.widthIn, h: P.heightIn, three: globalThis.THREE });
  P.widthIn = 7; P.heightIn = 9; delete P.stlLayers;
  document.body.innerHTML = '<div id="stlLayerBody"></div>';
  localStorage.clear();
  _resetStlPanelForTests();
  scheduleUndoSnapshot.mockClear();
  ghostState.visible = true;
});
afterEach(() => {
  for (const o of document.querySelectorAll('.cad-modal-overlay')) o.remove();
  if (saved.stl === undefined) delete P.stlLayers; else P.stlLayers = saved.stl;
  P.widthIn = saved.w; P.heightIn = saved.h;
  if (saved.three === undefined) delete globalThis.THREE; else globalThis.THREE = saved.three;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const openSheetFromPanel = async (f) => {
  vi.stubGlobal('fetch', f);
  renderStlPanel($('stlLayerBody')); bindStlPanel({}); mountLayerStack();
  $('stlBrowseSi').click();
  await flush();
};
const pickRelief = () => document.querySelector(`.stl-lib-tile[data-library="smk"][data-model-id="${RELIEF}"]`).click();

describe('C1. the library sheet: Crop mode', () => {
  it('Crop loads the 3D view and draws the box in it; Z min 60 % keeps the top 40 % of the STORED Z (the view\'s up: SMK is turned for its camera)', async () => {
    const three = stubThree();
    const f = bothFetch();
    await openSheetFromPanel(f);
    pickRelief();
    expect($('stlLibCrop').getAttribute('aria-pressed')).toBe('false');
    expect($('stlLibCropBox').hidden).toBe(true);
    $('stlLibCrop').click();
    await flush();
    expect(downloads(f)).toEqual([STL_URL]);
    expect($('stlLibCrop').getAttribute('aria-pressed')).toBe('true');
    expect($('stlLibCropBox').hidden).toBe(false);
    expect(three.renderers[0].localClippingEnabled).toBe(true);
    for (const id of ['stlLibCropXMin', 'stlLibCropXMax', 'stlLibCropYMin', 'stlLibCropYMax', 'stlLibCropZMin', 'stlLibCropZMax']) expect($(id), id).toBeTruthy();
    expect([$('stlLibCropZMin').value, $('stlLibCropZMax').value]).toEqual(['0', '100']);
    setSlider('stlLibCropZMin', 60);
    expect($('stlLibCropZMinNum').value).toBe('60');
    const edges = three.lines[0].geometry.attributes.position.array;
    // the view frame: stored Z (100 tall) is the view's Y; the box spans 40 of it, at the top; X (40 wide) is whole
    const [y0, y1] = extent(edges, 1), [x0, x1] = extent(edges, 0);
    expect(y1 - y0).toBeCloseTo(40, 3);
    expect(y1).toBeCloseTo(50, 3); // the view centres the model: its top at +50
    expect(x1 - x0).toBeCloseTo(40, 3);
  });
});

describe('C2. Insert with a crop: the model is cut BEFORE it is stored; Recent remembers it', () => {
  const insertCropped = async (f) => {
    await openSheetFromPanel(f);
    pickRelief();
    $('stlLibCrop').click();
    await flush();
    setSlider('stlLibCropZMin', 60);
    $('stlLibInsert').click();
    await flush();
    return P.stlLayers[P.stlLayers.length - 1];
  };
  it('the stored mesh is the kept part (its box = the cropped region), storedTris counts only it, the record carries crop.box', async () => {
    stubThree();
    const f = bothFetch();
    const rec = await insertCropped(f);
    expect(P.stlLayers).toHaveLength(1);
    expect(rec.crop.box).toEqual({ x: [0, 1], y: [0, 1], z: [0.6, 1] });
    const full = indexMesh(standingSlab());
    expect(rec.crop.bounds).toEqual(meshBounds(full.positions));
    const kept = cropMesh(full, { z: [0.6, 1] }).mesh;
    expect(rec.storedTris).toBe(kept.indices.length / 3);
    expect(rec.origTris).toBe(kept.indices.length / 3);
    const b = meshBounds(decodeMesh(rec.mesh).positions);
    expect(b.min[2]).toBeCloseTo(60, 2);
    expect(b.max[2]).toBeCloseTo(100, 2);
    expect(b.max[0] - b.min[0]).toBeCloseTo(40, 2);
    expect(rec.source).toMatchObject({ provider: 'smk', id: RELIEF, uri: STL_URL });
    expect(rec.health.openEdges).toBe(0); // the cut is capped: still closed
  });
  it('Recent gets the entry (this device: localStorage), and its Insert re-downloads through the library and re-applies the crop', async () => {
    stubThree();
    const f = bothFetch();
    const first = await insertCropped(f);
    const recent = readRecent();
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ libraryId: 'smk', modelId: RELIEF, crop: { x: [0, 1], y: [0, 1], z: [0.6, 1] } });
    expect(recent[0].tile.stlUrl).toBe(STL_URL);
    expect(JSON.parse(localStorage.getItem(RECENT_KEY))).toHaveLength(1);
    // the sheet again: Recent is the FIRST choice; picking it lists the model; its tile brings the crop back
    $('stlBrowseSi').click();
    await flush();
    const sel = $('stlLibLibrary');
    expect(sel.options[0].value).toBe('recent');
    expect(sel.value).toBe('all'); // still the default
    sel.value = 'recent'; sel.dispatchEvent(new Event('change'));
    await flush();
    const tiles = [...document.querySelectorAll('.stl-lib-tile')];
    expect(tiles.map((t) => t.getAttribute('data-model-id'))).toEqual([RELIEF]);
    tiles[0].click();
    expect($('stlLibCrop').getAttribute('aria-pressed')).toBe('true');
    expect($('stlLibCropZMin').value).toBe('60');
    $('stlLibInsert').click();
    await flush();
    expect(P.stlLayers).toHaveLength(2);
    const again = P.stlLayers[1];
    expect(again.crop.box).toEqual(first.crop.box);
    expect(again.mesh.h).toBe(first.mesh.h); // the same kept part, from a fresh download
    expect(downloads(f).length).toBe(3); // the 3D preview, the first Insert, the Recent Insert
    expect(readRecent()).toHaveLength(1); // re-inserting moves it to the top, never a second entry
  });
  it('an Insert without Crop stores the whole model and records no crop (as before)', async () => {
    stubThree();
    const f = bothFetch();
    await openSheetFromPanel(f);
    pickRelief();
    $('stlLibInsert').click();
    await flush();
    const rec = P.stlLayers[0];
    expect('crop' in rec).toBe(false);
    expect(rec.origTris).toBe(indexMesh(standingSlab()).indices.length / 3);
    expect(readRecent()[0].crop).toBeNull();
  });
});

describe('C3. Recent: a display list per device', () => {
  const tile = (i) => ({ id: `m${i}`, title: `Model ${i}`, stlUrl: `https://x/${i}.stl`, thumbUrl: '', previewUrl: '' });
  it(`newest first, at most ${RECENT_MAX}; re-inserting moves an entry to the top; a storage that throws shows none and breaks nothing`, () => {
    for (let i = 0; i < RECENT_MAX + 3; i++) pushRecent(recentEntryOf(tile(i), SMK_SOURCE, null, 1000 + i));
    let list = readRecent();
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0].modelId).toBe(`m${RECENT_MAX + 2}`);
    pushRecent(recentEntryOf(tile(10), SMK_SOURCE, { z: [0.5, 1] }, 9999));
    list = readRecent();
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0]).toMatchObject({ modelId: 'm10', crop: { z: [0.5, 1] } });
    expect(list.filter((e) => e.modelId === 'm10')).toHaveLength(1);
    const bad = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    expect(readRecent(bad)).toEqual([]);
    expect(() => pushRecent(recentEntryOf(tile(1), SMK_SOURCE), bad)).not.toThrow();
  });
  it('an own STL file is listed while its original is in memory (not stored), and inserts from memory without a download', async () => {
    stubThree();
    const f = bothFetch();
    vi.stubGlobal('fetch', f);
    renderStlPanel($('stlLayerBody')); bindStlPanel({}); mountLayerStack();
    addStlFromBuffer(binaryStl(standingSlab()), 'mine.stl');
    expect(readRecent()).toEqual([]); // own files are never persisted
    $('stlBrowseSi').click();
    await flush();
    const sel = $('stlLibLibrary');
    sel.value = 'recent'; sel.dispatchEvent(new Event('change'));
    await flush();
    const t = document.querySelector('.stl-lib-tile');
    expect(t.getAttribute('data-library')).toBe('local');
    expect(t.textContent).toContain('mine');
    t.click();
    $('stlLibCrop').click();
    await flush();
    setSlider('stlLibCropXMax', 50);
    $('stlLibInsert').click();
    await flush();
    expect(P.stlLayers).toHaveLength(2);
    expect('source' in P.stlLayers[1]).toBe(false);
    expect(P.stlLayers[1].crop.box.x).toEqual([0, 0.5]);
    expect(downloads(f)).toEqual([]);
  });
  it('the sheet has no Recent choice when nothing was inserted (All libraries first, as before)', async () => {
    const f = bothFetch();
    await openSheetFromPanel(f);
    expect([...$('stlLibLibrary').options].map((o) => o.value)).toEqual(['all', 'smithsonian', 'smk']);
  });
});

// ── the STL panel ─────────────────────────────────────────────────────────────────────────────────────────────────────
const group = (g) => document.querySelector(`[data-stl-group="${g}"]`);
const mount = (hooks = {}) => { renderStlPanel($('stlLayerBody')); bindStlPanel(hooks); mountLayerStack(); };

describe('C4. the STL panel: a Crop group in each card', () => {
  it('renders in the open card: six sliders, Apply / Reset (Reset shows once a box cuts), then the Falloff controls', () => {
    mount();
    const rec = addStlFromSoup(standingSlab(), 'Slab');
    const card = document.querySelector(`[data-stl-card="${rec.id}"]`);
    expect(card.contains(group('crop'))).toBe(true);
    for (const id of ['stlCropXMin', 'stlCropXMax', 'stlCropYMin', 'stlCropYMax', 'stlCropZMin', 'stlCropZMax', 'stlCropApply', 'stlCropReset']) expect(group('crop').contains($(id)), id).toBe(true);
    expect($('stlCropReset').hidden).toBe(true);
    const before = P.stlLayers[0];
    $('stlCropApply').click(); // no box yet: nothing is cut, the status line says what to do
    expect(P.stlLayers[0]).toBe(before);
    expect($('stlStatus').textContent).toMatch(/move a crop slider/);
    // the falloff: width (absent = 0), the brush's built-in profiles (Smooth shown), five edge boxes (absent = all on)
    expect($('stl_cropFalloffWidth').value).toBe('0');
    const profiles = [...document.querySelectorAll('#stl_cropFalloffProfile [data-stl-choice]')].map((b) => b.textContent);
    expect(profiles).toEqual(['Smooth', 'Linear', 'Dome', 'Soft', 'Spike', 'Plateau']);
    expect(document.querySelector('#stl_cropFalloffProfile .active').textContent).toBe('Smooth');
    for (const k of ['Left', 'Right', 'Front', 'Back', 'Bottom']) expect($(`stl_cropEdge${k}`).checked, k).toBe(true);
    expect('cropFalloff' in P.stlLayers[0]).toBe(false); // showing the defaults writes nothing
  });
  it('the sliders PREVIEW on the ghost without cutting: no write, no undo step; the ghost splits into kept + faint', () => {
    const refreshGhosts = vi.fn();
    mount({ refreshGhosts });
    const rec = addStlFromSoup(standingSlab(), 'Slab');
    const before = P.stlLayers[0];
    scheduleUndoSnapshot.mockClear();
    setSlider('stlCropZMin', 50);
    expect(P.stlLayers[0]).toBe(before);
    expect(scheduleUndoSnapshot).not.toHaveBeenCalled();
    expect(refreshGhosts).toHaveBeenCalled();
    expect(ghostState.cropPreview).toEqual({ id: rec.id, box: { x: [0, 1], y: [0, 1], z: [0.5, 1] } });
    expect($('stlCropReset').hidden).toBe(false);
    const got = [];
    updateStlGhosts({ setStlGhosts: (l) => got.push(...l) }, P.stlLayers, new Float32Array(11 * 11), { nx: 11, nz: 11, widthIn: 7, heightIn: 9 });
    expect(got[0].cutIndices.length).toBeGreaterThan(0);
    expect(got[0].indices.length + got[0].cutIndices.length).toBe(rec.mesh.nt * 3);
  });
  it('Reset (before Apply) puts the sliders back and ends the preview; nothing is written', () => {
    mount();
    addStlFromSoup(standingSlab(), 'Slab');
    const before = P.stlLayers[0];
    setSlider('stlCropXMax', 30);
    $('stlCropReset').click();
    expect($('stlCropXMax').value).toBe('100');
    expect(ghostState.cropPreview).toBeNull();
    expect(P.stlLayers[0]).toBe(before);
    expect($('stlCropReset').hidden).toBe(true);
  });
  it('Apply crop cuts ONCE (one undo step) from the in-memory original; the record keeps the box; the kept part stays in place on the board', async () => {
    mount();
    addStlFromSoup(standingSlab(), 'Slab');
    const before = P.stlLayers[0];
    const footBefore = placedFootprint(decodeMesh(before.mesh), before);
    setSlider('stlCropXMin', 50);
    scheduleUndoSnapshot.mockClear();
    $('stlCropApply').click();
    await flush();
    expect(scheduleUndoSnapshot).toHaveBeenCalledTimes(1);
    const rec = P.stlLayers[0];
    expect(rec).not.toBe(before);
    expect(rec.crop.box).toEqual({ x: [0.5, 1], y: [0, 1], z: [0, 1] });
    const b = meshBounds(decodeMesh(rec.mesh).positions);
    expect(b.max[0] - b.min[0]).toBeCloseTo(20, 2);
    expect(rec.health.openEdges).toBe(0);
    // the kept (right) half sits where it was: the footprint's right edge has not moved
    const footAfter = placedFootprint(decodeMesh(rec.mesh), rec);
    expect(footAfter.x1).toBeCloseTo(footBefore.x1, 3);
    expect(footAfter.x1 - footAfter.x0).toBeCloseTo((footBefore.x1 - footBefore.x0) / 2, 3);
    expect(ghostState.cropPreview).toBeNull();
    expect($('stlCropReset').hidden).toBe(true); // Reset is for before Apply: Undo takes this back
    expect($('stlCropNote').textContent).toMatch(/^Cropped: X 50–100 %/);
  });
  it('a library record after a reload re-downloads to crop, and a SECOND crop is remembered against the uncropped model', async () => {
    const f = bothFetch();
    vi.stubGlobal('fetch', f);
    mount();
    addStlFromSoup(standingSlab(), 'Relief', { source: { provider: 'smk', id: RELIEF, title: 'Relief', uri: STL_URL } });
    _resetStlPanelForTests(); mount(); // a reload: no original in memory
    expect(await applyStlCrop(P.stlLayers[0].id, { z: [0.5, 1] })).toBeTruthy();
    expect(downloads(f)).toEqual([STL_URL]);
    expect(P.stlLayers[0].crop.box.z).toEqual([0.5, 1]);
    _resetStlPanelForTests(); mount();
    await applyStlCrop(P.stlLayers[0].id, { z: [0.5, 1] }); // the top half of the kept top half
    expect(downloads(f)).toHaveLength(2);
    const c = P.stlLayers[0].crop;
    expect(c.box.z[0]).toBeCloseTo(0.75, 6);
    expect(c.box.z[1]).toBeCloseTo(1, 6);
    const b = meshBounds(decodeMesh(P.stlLayers[0].mesh).positions);
    expect(b.min[2]).toBeCloseTo(75, 2);
    // the Stored-detail re-download cuts the downloaded model the same way (not the whole model again)
    _resetStlPanelForTests(); mount();
    setStoredDetail(8);
    const low = P.stlLayers[0].storedTris;
    _resetStlPanelForTests(); mount();
    await setStoredDetail(P.stlLayers[0].origTris);
    expect(P.stlLayers[0].storedTris).toBeGreaterThan(low);
    expect(meshBounds(decodeMesh(P.stlLayers[0].mesh).positions).min[2]).toBeCloseTo(75, 2);
  });
  it('without an original or a source, Apply cuts the stored mesh', async () => {
    mount();
    addStlFromSoup(standingSlab(), 'Slab');
    _resetStlPanelForTests(); mount();
    await applyStlCrop(P.stlLayers[0].id, { y: [0, 0.5] });
    const b = meshBounds(decodeMesh(P.stlLayers[0].mesh).positions);
    expect(b.max[1]).toBeCloseTo(-8 + 0.5 * 10, 2); // the bump reaches y = -8: the box is -8..2, its lower half ends at -3
  });
  it('the falloff controls write the record\'s cropFalloff (copy-on-write, one field at a time)', () => {
    mount();
    addStlFromSoup(standingSlab(), 'Slab');
    const before = P.stlLayers[0];
    setStlField('cropFalloffWidth', 0.5);
    expect(P.stlLayers[0].cropFalloff).toEqual({ widthIn: 0.5 });
    document.querySelector('#stl_cropFalloffProfile [data-stl-choice="cropFalloffProfile:dome"]').click();
    $('stl_cropEdgeFront').checked = false; $('stl_cropEdgeFront').dispatchEvent(new Event('change'));
    expect(P.stlLayers[0].cropFalloff).toEqual({ widthIn: 0.5, profile: 'dome', edges: { front: false } });
    expect(before.cropFalloff).toBeUndefined();
    expect($('stl_cropEdgeFront').checked).toBe(false);
    expect($('stl_cropEdgeBack').checked).toBe(true);
  });
});

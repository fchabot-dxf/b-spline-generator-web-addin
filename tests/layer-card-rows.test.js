/**
 * The layer stack's CARD ROWS beyond Strength (Fred 2026-11-27, advisor scope add): Raised / Carved, Z offset, Soften edges,
 * Ground under it -- main/layer-stack.js LAYER_CARD_ROWS + each type's `rows`, ONE row component, shown while the layer
 * carves. Where a type had the field the row edits THAT field (Draw depth sign / edge fillet / suppression, Bricks invert /
 * suppression, STL raise / position.z / softness, Height raise / zOffset); the fields a type lacked are new
 * (core/stamp/pass-fields.js: art + bricks zOffset, STL + Height suppression, Height + Bricks softness through the STL's own
 * softening, core/stamp/soften.js). Absent = the stamp exactly as before.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/history.js', async (orig) => ({ ...(await orig()), scheduleUndoSnapshot: vi.fn() }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js', async (orig) => ({ ...(await orig()), commitBrickSetting: vi.fn(), setInvert: vi.fn() }));
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { commitBrickSetting, setInvert } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';
import { applyStampLayers, flatBrickPlaneHeights } from '../bspline-frame-builder/b-spline-gen/html/core/engine/apply-stamp-layers.js';
import { _collectStampPasses } from '../bspline-frame-builder/b-spline-gen/html/core/engine/rebuild.js';
import { gaussianSmooth } from '../bspline-frame-builder/b-spline-gen/html/core/gaussian.js';
import { softenBody } from '../bspline-frame-builder/b-spline-gen/html/core/stamp/soften.js';
import { GROUND_SMOOTHING_CELLS, zOffsetOf, recordGroundOf, brickPassFieldsOf } from '../bspline-frame-builder/b-spline-gen/html/core/stamp/pass-fields.js';
import { TOOLING_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';
import { LAYER_TOOLING_FIELDS } from '../bspline-frame-builder/b-spline-gen/html/core/history.js';
import { createStlLayer, stlPass, _resetStlCachesForTests } from '../bspline-frame-builder/b-spline-gen/html/core/stl/layer.js';
import { heightPass } from '../bspline-frame-builder/b-spline-gen/html/core/height/layer.js';
import { encodeRaster } from '../bspline-frame-builder/b-spline-gen/html/core/height/raster.js';
import { ensurePatchDecoded } from '../bspline-frame-builder/b-spline-gen/html/core/height/compose.js';
import { LAYER_TYPES, LAYER_CARD_ROWS, initLayerStack, openLayerStackItem, cardRowId, _resetLayerStackForTests } from '../bspline-frame-builder/b-spline-gen/html/main/layer-stack.js';
import { renderStlPanel, bindStlPanel, _resetStlPanelForTests } from '../bspline-frame-builder/b-spline-gen/html/main/stl-panel.js';

const NX = 24, NZ = 20, N = NX * NZ;
const grid = (f) => Float32Array.from({ length: N }, (_, k) => f(k % NX, Math.floor(k / NX), k));
const CLEAN = () => grid((i, j) => 0.4 + 0.02 * i - 0.015 * j + 0.05 * Math.sin(i * 0.7 + j * 0.3));
const blob = (ci, cj, r) => grid((i, j) => { const d = Math.hypot(i - ci, j - cj); return d <= r ? 1 - 0.4 * (d / r) : d <= r + 2 ? 0.6 * (1 - (d - r) / 2) : 0; });
const covered = (body) => Uint8Array.from(body, (v) => (v > 1e-6 ? 1 : 0));
const run = (passes, clean = CLEAN()) => applyStampLayers(clean, passes, NX, NZ, { stampDepth: 0, stampEdgeFilletRadius: 0 });
const bitSame = (a, b) => a.length === b.length && Array.prototype.every.call(a, (v, k) => Object.is(v, b[k]));
const artPass = (extra = {}) => { const body = blob(8, 9, 4); return { id: 'L1', kind: 'art', enabled: true, svg: '1', mask: { body, fillet: null, isStamped: covered(body) },
  depth: 0.3, profile: 'flat', suppression: 0, smoothing: 0, edgeFilletRadius: 0, filletPower: 1, ...extra }; };
const recordPass = (kind, extra = {}) => { const body = blob(15, 10, 5); return { id: `${kind}:x`, kind, enabled: true, svg: '1', mask: { body, fillet: null, isStamped: covered(body) },
  depth: kind === 'height' ? 1 : 0.5, carve: false, blend: 'add', zOffset: 0, profile: 'flat', suppression: 0, smoothing: 0, edgeFilletRadius: 0, filletPower: 1, ...extra }; };
const flatBrickPass = (extra = {}) => {
  const brickOf = new Int32Array(N).fill(-1), body = new Float32Array(N);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { if (i % 12 === 11 || j % 10 === 9) continue; brickOf[j * NX + i] = Math.floor(i / 12) + 2 * Math.floor(j / 10); body[j * NX + i] = 1; }
  return { id: 'W#bricks', kind: 'bricks', enabled: true, svg: '1', mask: { body, fillet: null, isStamped: covered(body), flatTop: { brickOf, count: 4 } },
    depth: 0.2, profile: 'flat', suppression: 0, smoothing: 0, edgeFilletRadius: 0, filletPower: 1, ...extra };
};

describe('engine: an own Z offset for art and bricks (the STL meaning)', () => {
  it('art raised: + zOffset over its covered points only; carved: - zOffset; not scaled by the strength', () => {
    const z = 0.1;
    for (const [depth, sign] of [[0.3, 1], [-0.3, -1]]) {
      const base = run([artPass({ depth })]);
      const lifted = run([artPass({ depth, zOffset: z })]);
      const p = artPass();
      for (let k = 0; k < N; k++) expect(lifted[k] - base[k]).toBeCloseTo(p.mask.isStamped[k] ? sign * z : 0, 6);
      const half = run([artPass({ depth, strength: 0.5 })]), halfZ = run([artPass({ depth, strength: 0.5, zOffset: z })]);
      for (let k = 0; k < N; k++) expect(halfZ[k] - half[k]).toBeCloseTo(p.mask.isStamped[k] ? sign * z : 0, 6);
    }
  });
  it('Flat bricks: the top = its plane + relief + zOffset (still planar; the grout untouched)', () => {
    const clean = CLEAN();
    const p = flatBrickPass({ zOffset: 0.05 });
    const plane = flatBrickPlaneHeights(clean, p.mask.flatTop.brickOf, 4, NX);
    const out = run([p]);
    for (let k = 0; k < N; k++) {
      if (p.mask.flatTop.brickOf[k] >= 0) expect(out[k] - plane[k]).toBeCloseTo(0.25, 6);
      else expect(out[k]).toBe(clean[k]);
    }
  });
  it('a record\'s own zOffset is left to its branch (never added twice)', () => {
    const a = run([recordPass('stl', { zOffset: 0.1 })]), clean = CLEAN(), p = recordPass('stl');
    for (let k = 0; k < N; k++) expect(a[k] - clean[k]).toBeCloseTo(p.mask.isStamped[k] ? 0.1 + p.mask.body[k] * 0.5 : 0, 6);
  });
  it('absent and 0: bit-identical; zOffsetOf writes no key for them', () => {
    expect(bitSame(run([artPass({ zOffset: 0 }), flatBrickPass({ zOffset: 0 })]), run([artPass(), flatBrickPass()]))).toBe(true);
    expect([zOffsetOf(undefined), zOffsetOf(0), zOffsetOf(0.1)]).toEqual([{}, {}, { zOffset: 0.1 }]);
  });
  it('the passes carry it: an editor layer\'s zOffset, the bricks\' through _brickPassFields (P.brickSettings)', () => {
    const body = blob(8, 9, 4);
    const layer = { id: 'a', visible: true, carve: true, depth: 0.2, _mask: { body, fillet: null, isStamped: covered(body) }, _brickMask: { body }, _brickDepth: 0.1 };
    window.svgEditor = { _layers: [layer] };
    expect(_collectStampPasses().map((p) => 'zOffset' in p)).toEqual([false, false]);
    layer.zOffset = 0.1;
    layer._brickPassFields = brickPassFieldsOf({ zOffset: -0.05, strength: 0.5 });
    expect(_collectStampPasses().map((p) => [p.kind, p.zOffset])).toEqual([['art', 0.1], ['bricks', -0.05]]);
    expect(brickPassFieldsOf({})).toEqual({});
    expect(LAYER_TOOLING_FIELDS).toContain('zOffset');
    window.svgEditor = null;
  });
});

describe('engine: "Ground under it" for STL / height records (the existing suppression step)', () => {
  it('a record pass carries its suppression over the Draw layer\'s default smoothing; absent = 0 / 0 (as before)', () => {
    expect(GROUND_SMOOTHING_CELLS).toBe(TOOLING_DEFAULTS.smoothing);
    expect(recordGroundOf(undefined)).toEqual({ suppression: 0, smoothing: 0 });
    expect(recordGroundOf(0.6)).toEqual({ suppression: 0.6, smoothing: GROUND_SMOOTHING_CELLS });
  });
  it('STL Add at Ground 100 %: its covered points sit on the SMOOTHED terrain (+ the stamp); outside them nothing moves', () => {
    const clean = CLEAN();
    const smooth = gaussianSmooth(clean, NX, NZ, GROUND_SMOOTHING_CELLS);
    const p = recordPass('stl', recordGroundOf(1));
    const out = run([p], clean);
    for (let k = 0; k < N; k++) {
      if (p.mask.isStamped[k]) expect(out[k]).toBeCloseTo(smooth[k] + p.mask.body[k] * 0.5, 5);
      else expect(out[k]).toBe(clean[k]);
    }
  });
  it('stlPass / heightPass: the record\'s suppression reaches the pass; a record without it builds the pass as before', async () => {
    _resetStlCachesForTests();
    const g = { nx: 15, nz: 19, widthIn: 7, heightIn: 9 };
    const tri = (a, b, c) => [...a, ...b, ...c];
    const A = [-5, -5, 0], B = [5, -5, 0], C = [5, 5, 0], D = [-5, 5, 0], T = [0, 0, 4];
    const soup = Float32Array.from([tri(A, B, T), tri(B, C, T), tri(C, D, T), tri(D, A, T), tri(A, C, B), tri(A, D, C)].flat());
    const { record } = createStlLayer({ soup, name: 'pyr', board: { widthIn: 7, heightIn: 9 } });
    expect(stlPass(record, g)).toMatchObject({ suppression: 0, smoothing: 0 });
    expect(stlPass({ ...record, suppression: 0.4 }, g)).toMatchObject({ suppression: 0.4, smoothing: GROUND_SMOOTHING_CELLS });
    const hp = { v: 1, id: 'hp', sizeIn: { w: 3, h: 3 }, raster: await encodeRaster(new Float32Array(16).fill(0.2), 4, 4) };
    await ensurePatchDecoded(hp);
    expect(heightPass(hp, g)).toMatchObject({ suppression: 0, smoothing: 0 });
    expect(heightPass({ ...hp, suppression: 0.4 }, g)).toMatchObject({ suppression: 0.4, smoothing: GROUND_SMOOTHING_CELLS });
  });
});

describe('engine: "Soften edges" -- the STL\'s own softening, shared (core/stamp/soften.js)', () => {
  it('softenBody is exactly the STL\'s former inline blur; 0 hands the same arrays back', () => {
    const body = blob(10, 10, 4), cov = covered(body), g = { nx: NX, nz: NZ, widthIn: 7 };
    const same = softenBody(body, cov, 0, g);
    expect(same.body).toBe(body); expect(same.covered).toBe(cov);
    const s = softenBody(body, cov, 0.6, g);
    const want = gaussianSmooth(body, NX, NZ, 0.6 / (7 / (NX - 1)));
    expect(bitSame(s.body, want)).toBe(true);
    expect(Array.from(s.covered)).toEqual(Array.from(cov, (c, k) => (c || want[k] > 1e-4 ? 1 : 0)));
    expect(s.covered.reduce((a, b) => a + b, 0)).toBeGreaterThan(cov.reduce((a, b) => a + b, 0)); // the footprint grew
  });
  it('a height patch with softness: its pass body is the softened sample; without: as before', async () => {
    const g = { nx: 30, nz: 30, widthIn: 6, heightIn: 6 };
    const data = new Float32Array(100); for (let r = 3; r < 7; r++) for (let c = 3; c < 7; c++) data[r * 10 + c] = 0.2;
    const hp = { v: 1, id: 'hs', sizeIn: { w: 4, h: 4 }, raster: await encodeRaster(data, 10, 10) };
    await ensurePatchDecoded(hp);
    const plain = heightPass(hp, g), soft = heightPass({ ...hp, softness: 0.3 }, g);
    const want = softenBody(plain.mask.body, plain.mask.isStamped, 0.3, g);
    expect(bitSame(soft.mask.body, want.body)).toBe(true);
    expect(bitSame(plain.mask.body, soft.mask.body)).toBe(false);
    expect(bitSame(heightPass(hp, g).mask.body, plain.mask.body)).toBe(true);
  });
});

// ── the card rows ──────────────────────────────────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const DOM = '<div id="svgEditorModal" style="display:none"></div><div id="layerStackAddRow"><div id="layerStackAddGrid"></div></div><div id="layerStackList"></div>'
  + '<span id="layerStackSummary"></span><div id="layerStackPark" hidden></div><div id="thickenSettingsPark" hidden><div id="thickenSettings"></div></div><div id="stlLayerBody"></div>';
const KEYS = ['stlLayers', 'heightLayers', 'brickSettings', 'layerOrder', 'widthIn', 'heightIn', 'spacing'];
const saved = {};
let editor;
const card = (key) => document.querySelector(`#layerStackList [data-stack-key="${key}"]`);
const tick = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)); };
async function setRow(row, key, v) {
  const s = $(cardRowId(row, key));
  s.value = String(v);
  s.dispatchEvent(new Event('change', { bubbles: true }));
  await tick();
}
describe('the card rows in each type\'s open card', () => {
  beforeEach(() => {
    for (const k of KEYS) saved[k] = P[k];
    document.body.innerHTML = DOM;
    editor = { _layers: [
      { id: '0', name: 'Lines', visible: true, carve: true, depth: 0.25, profile: 'vbit', angle: 90, blur: 0, suppression: 0.15, smoothing: 15 },
      { id: '1', name: 'Rails', visible: true, carve: true, depth: 0.15, profile: 'vbit', angle: 90, blur: 0, suppression: 0.15, pattern: { id: 'lat1', layers: { rails: '1' } } },
      { id: '3', name: 'Wall', visible: true, carve: true, depth: 0.125, brickKind: 'wall', suppression: 0.15 },
      { id: '4', name: 'Frame', visible: true, carve: true, depth: 0.125, brickKind: 'frame', suppression: 0.15 },
    ], _activeLayer: '0', _sketchLayer: null, pushState: vi.fn(), _notifyChange: vi.fn() };
    window.svgEditor = editor;
    Object.assign(P, { widthIn: 7, heightIn: 9, spacing: 0.1, layerOrder: null });
    P.stlLayers = [{ id: 's1', name: 'Lion', raise: true, position: { x: 0, y: 0, z: 0 }, softness: 0 }];
    P.heightLayers = [{ id: 'h1', name: 'Height 1', zOffset: 0 }];
    P.brickSettings = { ...(saved.brickSettings || {}) };
    for (const f of ['strength', 'zOffset', 'softness']) delete P.brickSettings[f];
    _resetStlPanelForTests(); _resetLayerStackForTests();
    renderStlPanel($('stlLayerBody')); bindStlPanel(); initLayerStack();
    commitBrickSetting.mockClear(); setInvert.mockClear();
  });
  afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete P[k]; else P[k] = saved[k]; } window.svgEditor = null; _resetLayerStackForTests(); });

  it('declared once, in order; every type declares all five; each open card shows the five rows in that order', () => {
    expect(LAYER_CARD_ROWS.map((r) => r.id)).toEqual(['relief', 'strength', 'zOffset', 'soften', 'ground']);
    for (const [type, key] of [['draw', 'layer:0'], ['lattice', 'layer:1'], ['brick', 'bricks'], ['height', 'height:h1'], ['stl', 'stl:s1']]) {
      expect(Object.keys(LAYER_TYPES[type].rows).sort(), type).toEqual(['ground', 'relief', 'soften', 'strength', 'zOffset']);
      openLayerStackItem(key);
      expect([...card(key).querySelectorAll('[data-card-row-wrap]')].map((r) => r.dataset.cardRowWrap), type).toEqual(LAYER_CARD_ROWS.map((r) => r.id));
    }
  });
  it('Raised / Carved: Draw flips the sign of its depth; Bricks the Brick panel\'s setInvert; Height and STL their raise', async () => {
    openLayerStackItem('layer:0');
    $(cardRowId('relief', 'layer:0') + '_carved').click(); await tick();
    expect(editor._layers[0].depth).toBe(-0.25);
    expect($(cardRowId('relief', 'layer:0') + '_carved').classList.contains('active')).toBe(true);
    openLayerStackItem('bricks');
    $(cardRowId('relief', 'bricks') + '_carved').click(); await tick();
    expect(setInvert).toHaveBeenCalledWith(true, 'auto');
    openLayerStackItem('height:h1');
    $(cardRowId('relief', 'height:h1') + '_carved').click();
    await vi.waitFor(() => expect(P.heightLayers[0].raise).toBe(false));
    openLayerStackItem('stl:s1');
    $(cardRowId('relief', 'stl:s1') + '_carved').click(); await tick();
    expect(P.stlLayers[0].raise).toBe(false);
  });
  it('Z offset: Draw layer.zOffset (0 removes it); STL position.z; Height rec.zOffset; Bricks P.brickSettings.zOffset (\'surface\')', async () => {
    openLayerStackItem('layer:0');
    await setRow('zOffset', 'layer:0', 0.1); expect(editor._layers[0].zOffset).toBe(0.1);
    await setRow('zOffset', 'layer:0', 0); expect(editor._layers[0]).not.toHaveProperty('zOffset');
    openLayerStackItem('stl:s1');
    await setRow('zOffset', 'stl:s1', 0.1); expect(P.stlLayers[0].position.z).toBe(0.1);
    openLayerStackItem('height:h1');
    await setRow('zOffset', 'height:h1', 0.1);
    await vi.waitFor(() => expect(P.heightLayers[0].zOffset).toBe(0.1));
    openLayerStackItem('bricks');
    await setRow('zOffset', 'bricks', 0.1); expect(P.brickSettings.zOffset).toBe(0.1);
    expect(commitBrickSetting).toHaveBeenLastCalledWith('surface');
    await setRow('zOffset', 'bricks', 0); expect(P.brickSettings).not.toHaveProperty('zOffset');
  });
  it('Soften edges: STL softness; Draw its Edge fillet (inches); Height and Bricks their new softness', async () => {
    openLayerStackItem('layer:0');
    await setRow('soften', 'layer:0', 0.2); expect(editor._layers[0].edgeFilletRadius).toBe(0.2);
    expect(editor._layers[0].blur).toBe(0); // its Blur untouched
    openLayerStackItem('stl:s1');
    await setRow('soften', 'stl:s1', 0.2); expect(P.stlLayers[0].softness).toBe(0.2);
    openLayerStackItem('height:h1');
    await setRow('soften', 'height:h1', 0.2);
    await vi.waitFor(() => expect(P.heightLayers[0].softness).toBe(0.2));
    openLayerStackItem('bricks');
    await setRow('soften', 'bricks', 0.2); expect(P.brickSettings.softness).toBe(0.2);
    await setRow('soften', 'bricks', 0); expect(P.brickSettings).not.toHaveProperty('softness');
  });
  it('Ground under it: Draw suppression; Bricks every brick layer\'s suppression in ONE step; STL / Height suppression (0 removes)', async () => {
    openLayerStackItem('layer:0');
    expect($(cardRowId('ground', 'layer:0')).value).toBe('15');
    await setRow('ground', 'layer:0', 40); expect(editor._layers[0].suppression).toBe(0.4);
    openLayerStackItem('bricks');
    editor.pushState.mockClear();
    await setRow('ground', 'bricks', 60);
    expect([editor._layers[2].suppression, editor._layers[3].suppression]).toEqual([0.6, 0.6]);
    expect(editor.pushState).toHaveBeenCalledTimes(1);
    openLayerStackItem('stl:s1');
    await setRow('ground', 'stl:s1', 50); expect(P.stlLayers[0].suppression).toBe(0.5);
    await setRow('ground', 'stl:s1', 0); expect(P.stlLayers[0]).not.toHaveProperty('suppression');
    openLayerStackItem('height:h1');
    await setRow('ground', 'height:h1', 50);
    await vi.waitFor(() => expect(P.heightLayers[0].suppression).toBe(0.5));
  });
});

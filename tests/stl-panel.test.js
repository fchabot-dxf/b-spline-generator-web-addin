/**
 * STL-RELIEF slice 1-2: the Surface > STL stamp panel (main/stl-panel.js) on the REAL palette markup, a real binary STL, the real P.
 * It is declared (SIDEBAR_TABS / SECTION_THEMES / the loading stage), rendered from STL_CONTROLS, writes only when the user moves a
 * control, stores a capped mesh, and never rewrites a loaded board.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { P, persistableP } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { SIDEBAR_TABS, branchSections } from '../bspline-frame-builder/b-spline-gen/html/main/sidebar-tabs.js';
import { SECTION_THEMES, SECTION_ICONS } from '../bspline-frame-builder/b-spline-gen/html/main/section-themes.js';
import { LOADING_STAGES } from '../bspline-frame-builder/b-spline-gen/html/core/loading-signal.js';
import {
  STL_CONTROLS, STL_GROUPS, renderStlPanel, bindStlPanel, syncStlPanel, addStlFromBuffer, setStlField, setStoredDetail, removeStlLayer,
  snapStlBase, centreStl, resetStlRotation, activeStlLayer, _resetStlPanelForTests,
} from '../bspline-frame-builder/b-spline-gen/html/main/stl-panel.js';
import { ghostState, STL_GHOST_COLOURS } from '../bspline-frame-builder/b-spline-gen/html/core/stl/ghost.js';
import { stlPass, stlPasses, STL_WARN_TOTAL_TRIS } from '../bspline-frame-builder/b-spline-gen/html/core/stl/layer.js';
import { _collectStampPasses } from '../bspline-frame-builder/b-spline-gen/html/core/engine/rebuild.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');

const tri = (a, b, c) => [...a, ...b, ...c];
function pyramidSoup({ base = true } = {}) {
  const A = [-5, -5, 0], B = [5, -5, 0], C = [5, 5, 0], D = [-5, 5, 0], T = [0, 0, 4];
  const t = [tri(A, B, T), tri(B, C, T), tri(C, D, T), tri(D, A, T)];
  if (base) t.push(tri(A, C, B), tri(A, D, C));
  return Float32Array.from(t.flat());
}
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
const $ = (id) => document.getElementById(id);
const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
const saved = {};

beforeEach(() => {
  Object.assign(saved, { stl: P.stlLayers, w: P.widthIn, h: P.heightIn });
  P.widthIn = 7; P.heightIn = 9; delete P.stlLayers;
  document.body.innerHTML = '<div id="stlLayerBody"></div>';
  _resetStlPanelForTests();
  ghostState.visible = true;
});
afterEach(() => {
  if (saved.stl === undefined) delete P.stlLayers; else P.stlLayers = saved.stl;
  P.widthIn = saved.w; P.heightIn = saved.h;
  vi.useRealTimers();
});
const setup = () => {
  const hooks = { onChange: vi.fn(), refreshGhosts: vi.fn() };
  renderStlPanel($('stlLayerBody'));
  bindStlPanel(hooks);
  return hooks;
};

describe('declared, not hand-built', () => {
  it('the section is in the real palette, in SIDEBAR_TABS (Surface, before Thicken), themed, with an icon and a loading stage', () => {
    expect(HTML).toContain('class="panel panel-stl"');
    expect(HTML).toContain('id="stlLayerBody"');
    const surface = branchSections(SIDEBAR_TABS.find((t) => t.id === 'surface'));
    expect(surface).toContain('panel-stl');
    expect(surface.indexOf('panel-stl')).toBeLessThan(surface.indexOf('panel-thicken'));
    expect(SECTION_THEMES.stl).toBeTruthy();
    expect(SECTION_ICONS.stl).toBeTruthy();
    expect(LOADING_STAGES.stl).toMatchObject({ group: 'computing', surface: 'card' });
  });
  it('every control belongs to a declared group and has its element rendered', () => {
    setup();
    const groups = new Set(STL_GROUPS.map((g) => g.id));
    for (const c of STL_CONTROLS) {
      expect(groups.has(c.group), c.id).toBe(true);
      if (c.kind === 'slider') { expect($(`stl_${c.id}Slider`), c.id).toBeTruthy(); expect($(`stl_${c.id}`), c.id).toBeTruthy(); }
      else expect(document.querySelectorAll(`#stl_${c.id} [data-stl-choice]`).length, c.id).toBe(c.options.length);
    }
  });
  it('no STL yet: a hint, the placement controls hidden, nothing written to P', () => {
    setup();
    expect($('stlList').textContent).toMatch(/No STL yet/);
    expect($('stlActive').hidden).toBe(true);
    expect(P.stlLayers).toBeUndefined();
  });
});

describe('importing', () => {
  it('a binary STL becomes a record at the board centre with the declared defaults, stored compactly, and the board is asked to rebuild', () => {
    const hooks = setup();
    const rec = addStlFromBuffer(binaryStl(pyramidSoup()), 'my pyramid.stl');
    expect(P.stlLayers).toHaveLength(1);
    expect(rec).toMatchObject({ name: 'my pyramid', blend: 'max', raise: true, placement: 'withSurface', origTris: 6, storedTris: 6, enabled: true });
    expect(rec.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(rec.mesh.v).toBe(1);
    // fitted: the longest side (10 mesh units) is half the SHORTER board side (7 in)
    expect(rec.unitIn).toBeCloseTo(0.35, 6);
    expect(hooks.onChange).toHaveBeenCalled();
    expect($('stlActive').hidden).toBe(false);
    expect($('stlList').querySelectorAll('.stl-row')).toHaveLength(1);
    expect($('stlStored').textContent).toMatch(/Stored 6 of 6 triangles/);
    expect($('stlHealth').textContent).toMatch(/closed mesh/);
  });
  it('an open mesh is reported (detection only), not repaired', () => {
    setup();
    const rec = addStlFromBuffer(binaryStl(pyramidSoup({ base: false })), 'open.stl');
    expect($('stlHealth').textContent).toMatch(/4 open edges in 1 outline/);
    expect($('stlHealth').textContent).toMatch(/nothing is repaired/);
    expect(rec.storedTris).toBe(4);
  });
  it('a file that is not an STL shows an error in the panel and adds nothing', async () => {
    setup();
    const input = $('stlFile');
    const file = { name: 'photo.png', arrayBuffer: async () => new Uint8Array(300).fill(9).buffer };
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fire(input, 'change');
    await new Promise((r) => setTimeout(r, 30));
    expect($('stlStatus').hidden).toBe(false);
    expect($('stlStatus').textContent).toMatch(/Could not read photo\.png/);
    expect(P.stlLayers).toBeUndefined();
  });
  it('several STLs are a list; picking one makes it the active one; removing falls back to the next', () => {
    setup();
    const a = addStlFromBuffer(binaryStl(pyramidSoup()), 'a.stl');
    const b = addStlFromBuffer(binaryStl(pyramidSoup()), 'b.stl');
    expect(activeStlLayer().id).toBe(b.id);
    document.querySelector(`[data-stl-pick="${a.id}"]`).click();
    expect(activeStlLayer().id).toBe(a.id);
    removeStlLayer(a.id);
    expect(P.stlLayers.map((l) => l.id)).toEqual([b.id]);
    expect(activeStlLayer().id).toBe(b.id);
  });
});

describe('the controls write the active record, only when the user moves them', () => {
  it('a slider writes its path, clamps to its range, and asks for a rebuild each time', () => {
    const hooks = setup();
    addStlFromBuffer(binaryStl(pyramidSoup()), 'p.stl');
    hooks.onChange.mockClear();
    const s = $('stl_posXSlider');
    s.value = '2.5'; fire(s, 'input');
    expect(activeStlLayer().position.x).toBe(2.5);
    expect($('stl_posX').value).toBe('2.5');
    expect(hooks.onChange).toHaveBeenCalledTimes(1);
    const n = $('stl_posY');
    n.value = '99'; fire(n, 'change'); // past the board: clamps to its declared range (the board's height)
    expect(activeStlLayer().position.y).toBe(9);
    n.value = 'abc'; fire(n, 'change');
    expect(activeStlLayer().position.y).toBe(9); // garbage writes nothing
    setStlField('rotZ', 45); setStlField('scale', 1.5); setStlField('compress', 0.5);
    expect(activeStlLayer()).toMatchObject({ scale: 1.5, compress: 0.5, rotation: { x: 0, y: 0, z: 45 } });
  });
  it('Max / Add and Raised / Carved are segmented choices; the buttons show the current one', () => {
    setup();
    addStlFromBuffer(binaryStl(pyramidSoup()), 'p.stl');
    expect(document.querySelector('[data-stl-choice="blend:max"]').classList.contains('active')).toBe(true);
    document.querySelector('[data-stl-choice="blend:add"]').click();
    expect(activeStlLayer().blend).toBe('add');
    expect(document.querySelector('[data-stl-choice="blend:add"]').classList.contains('active')).toBe(true);
    document.querySelector('[data-stl-choice="raise:false"]').click();
    expect(activeStlLayer().raise).toBe(false);
    expect(stlPass(activeStlLayer(), { nx: 15, nz: 19, widthIn: 7, heightIn: 9 }).depth).toBeLessThan(0); // carved = a negative depth
  });
  it('Base on surface, Centre and Reset rotation write 0', () => {
    setup();
    addStlFromBuffer(binaryStl(pyramidSoup()), 'p.stl');
    setStlField('posZ', -1.5); setStlField('posX', 2); setStlField('posY', -2); setStlField('rotX', 30); setStlField('rotY', 20);
    snapStlBase(); centreStl(); resetStlRotation();
    expect(activeStlLayer()).toMatchObject({ position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } });
  });
  it('the checkbox turns one STL off: it stamps no pass; the placement ghost toggle reaches the preview hook', () => {
    const hooks = setup();
    const rec = addStlFromBuffer(binaryStl(pyramidSoup()), 'p.stl');
    const box = document.querySelector(`[data-stl-enable="${rec.id}"]`);
    box.checked = false; fire(box, 'change');
    expect(rec.enabled).toBe(false);
    expect(stlPasses(P.stlLayers, { nx: 15, nz: 19, widthIn: 7, heightIn: 9 })).toEqual([]);
    hooks.refreshGhosts.mockClear();
    const g = $('stlGhost');
    g.checked = false; fire(g, 'change');
    expect(ghostState.visible).toBe(false);
    expect(hooks.refreshGhosts).toHaveBeenCalled();
  });
  it('the colour legend uses the ghost\'s own declared colours', () => {
    setup();
    addStlFromBuffer(binaryStl(pyramidSoup()), 'p.stl');
    const legend = $('stlLegend');
    expect(legend.querySelectorAll('.stl-legend-item')).toHaveLength(5);
    const [r, g, b] = STL_GHOST_COLOURS.shows.map((x) => Math.round(x * 255));
    expect(legend.querySelector('i').style.background).toContain(`${r}, ${g}, ${b}`);
  });
});

describe('Stored detail', () => {
  it('goes down and back up while the original is in memory; after a reload (original gone) it only goes down', () => {
    setup();
    const rec = addStlFromBuffer(binaryStl(gridSoup(60)), 'tile.stl'); // 7200 triangles, under the default cap: all stored
    expect(rec.storedTris).toBe(7200);
    setStoredDetail(1000);
    const low = activeStlLayer().storedTris;
    expect(low).toBeLessThanOrEqual(1000);
    setStoredDetail(4000);
    const mid = activeStlLayer().storedTris;
    expect(mid).toBeGreaterThan(low);
    expect(mid).toBeLessThanOrEqual(4000);
    expect($('stlStored').textContent).toMatch(/the detail can go up or down/);
    _resetStlPanelForTests(); // a reload: the in-memory original is gone
    setStoredDetail(7000);
    expect(activeStlLayer().storedTris).toBeLessThanOrEqual(mid); // cannot invent triangles it no longer has
    syncStlPanel();
    expect($('stlStored').textContent).toMatch(/can only go down/);
    expect($('stlReimport').hidden).toBe(false);
  });
  it('a project over the triangle budget shows a warning (no hard stop)', () => {
    setup();
    P.stlLayers = [{ id: 'big', name: 'big', storedTris: STL_WARN_TOTAL_TRIS + 1, mesh: { v: 1, nv: 1, nt: 1, pos: '', idx: '', min: [0, 0, 0], size: [1, 1, 1], idxBits: 16 } }];
    syncStlPanel();
    expect($('stlTotal').textContent).toMatch(/⚠/);
    expect($('stlTotal').classList.contains('stl-error')).toBe(true);
  });
});

describe('a loaded board is never rewritten (AGENTS.md rule 3)', () => {
  it('a saved record with fields missing renders with the declared defaults and the record is untouched', () => {
    setup();
    const a = addStlFromBuffer(binaryStl(pyramidSoup()), 'p.stl');
    const sparse = { id: a.id, name: a.name, mesh: a.mesh, unitIn: a.unitIn, storedTris: a.storedTris, origTris: a.origTris };
    P.stlLayers = [sparse];
    const before = JSON.stringify(P.stlLayers);
    syncStlPanel();
    expect(JSON.stringify(P.stlLayers)).toBe(before);
    expect($('stl_scale').value).toBe('1');
    expect(document.querySelector('[data-stl-choice="blend:max"]').classList.contains('active')).toBe(true);
  });
  it('save and load: the record survives the project JSON round trip and stamps the same pass', () => {
    setup();
    const rec = addStlFromBuffer(binaryStl(pyramidSoup()), 'p.stl');
    setStlField('posX', 1.25); setStlField('scale', 1.2);
    const grid = { nx: 15, nz: 19, widthIn: 7, heightIn: 9 };
    const direct = stlPass(rec, grid);
    const loaded = JSON.parse(JSON.stringify(persistableP(P))).stlLayers[0];
    const again = stlPass(loaded, grid);
    expect(Array.from(again.mask.body)).toEqual(Array.from(direct.mask.body));
    expect(again.depth).toBe(direct.depth);
  });
  it('the STL pass joins the build only through the grid-aware collect, after the editor layers', () => {
    setup();
    addStlFromBuffer(binaryStl(pyramidSoup()), 'p.stl');
    expect(_collectStampPasses().length).toBe(0);
    const passes = _collectStampPasses(15, 19);
    expect(passes).toHaveLength(1);
    expect(passes[0]).toMatchObject({ kind: 'stl', blend: 'max' });
    expect(Math.max(...passes[0].mask.body)).toBeGreaterThan(0.9);
  });
});

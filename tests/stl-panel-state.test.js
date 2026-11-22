/**
 * STL-RELIEF panel: the state rules the first review found broken. Every test here runs on the REAL boot alias
 * (core/state.js `P = { ...DEFAULT }`: P.stlLayers IS DEFAULT.stlLayers until something replaces it) and on the real history.
 *  - copy-on-write: Add STL must never write into DEFAULT (a later old-project load fills missing keys from DEFAULT), and an
 *    Undo restores keys BY REFERENCE (main/snapshot-manager.js), so a later edit must not touch the snapshot's own objects;
 *  - no clamp (owner: floating Z allowed); a bad Stored-detail box changes nothing; a bad layer's error is shown;
 *  - a re-import replaces the layer that was active when the file was chosen; the coarse-pointer touch targets are declared.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { takeSnapshot, unifiedUndo, globalHistoryLog, globalRedoLog } from '../bspline-frame-builder/b-spline-gen/html/core/history.js';
import {
  renderStlPanel, bindStlPanel, syncStlPanel, addStlFromBuffer, setStlField, setStoredDetail, removeStlLayer, setStlEnabled,
  activeStlLayer, _resetStlPanelForTests,
} from '../bspline-frame-builder/b-spline-gen/html/main/stl-panel.js';
import { ghostState } from '../bspline-frame-builder/b-spline-gen/html/core/stl/ghost.js';
import { _resetStlCachesForTests } from '../bspline-frame-builder/b-spline-gen/html/core/stl/layer.js';
import { _collectStampPasses } from '../bspline-frame-builder/b-spline-gen/html/core/engine/rebuild.js';

const CSS = readFileSync('bspline-frame-builder/styles/layout-app.css', 'utf8');

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
const later = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const saved = {};

beforeEach(() => {
  Object.assign(saved, { stl: P.stlLayers, w: P.widthIn, h: P.heightIn });
  P.widthIn = 7; P.heightIn = 9;
  P.stlLayers = DEFAULT.stlLayers; // the REAL boot state: the very same array
  document.body.innerHTML = '<div id="stlLayerBody"></div>';
  _resetStlPanelForTests();
  _resetStlCachesForTests();
  ghostState.visible = true;
  globalHistoryLog.length = 0; globalRedoLog.length = 0;
});
afterEach(() => {
  DEFAULT.stlLayers.length = 0; // belt and braces: never leak into another test of this file
  if (saved.stl === undefined) delete P.stlLayers; else P.stlLayers = saved.stl;
  P.widthIn = saved.w; P.heightIn = saved.h;
  globalHistoryLog.length = 0; globalRedoLog.length = 0;
  vi.useRealTimers();
});
const setup = () => {
  const hooks = { onChange: vi.fn(), refreshGhosts: vi.fn() };
  renderStlPanel($('stlLayerBody'));
  bindStlPanel(hooks);
  return hooks;
};
const add = (name = 'p.stl', soup = pyramidSoup()) => addStlFromBuffer(binaryStl(soup), name);

describe('copy-on-write: nothing is written into the shared default or a snapshot', () => {
  it('Add STL leaves DEFAULT.stlLayers empty and P.stlLayers a different array', () => {
    setup();
    expect(P.stlLayers).toBe(DEFAULT.stlLayers); // the boot alias this test stands on
    add();
    expect(DEFAULT.stlLayers).toEqual([]);
    expect(P.stlLayers).not.toBe(DEFAULT.stlLayers);
    expect(P.stlLayers).toHaveLength(1);
  });
  it('the load path (an older project fills missing keys from DEFAULT) never gets an STL', () => {
    setup();
    add();
    expect(JSON.parse(JSON.stringify(DEFAULT.stlLayers))).toEqual([]);
  });
  it('remove, enable and a field edit each build a new list and a new record; the old ones are untouched', () => {
    setup();
    const a = add('a.stl'); const b = add('b.stl');
    const list1 = P.stlLayers, aBefore = JSON.stringify(list1.find((r) => r.id === a.id));
    setStlField('posX', 3); // edits b (the active one)
    expect(P.stlLayers).not.toBe(list1);
    expect(list1.find((r) => r.id === b.id).position.x).toBe(0);
    const list2 = P.stlLayers;
    setStlEnabled(a.id, false);
    expect(P.stlLayers).not.toBe(list2);
    expect(list2.find((r) => r.id === a.id).enabled).toBe(true);
    const list3 = P.stlLayers;
    removeStlLayer(a.id);
    expect(list3).toHaveLength(2);
    expect(P.stlLayers).toHaveLength(1);
    expect(JSON.stringify(list1.find((r) => r.id === a.id))).toBe(aBefore);
  });
  it('Undo (keys restored BY REFERENCE, as main/snapshot-manager.js does) then a new edit does not corrupt the history snapshot', () => {
    setup();
    add();
    takeSnapshot('add');
    setStlField('posX', 2);
    takeSnapshot('x');
    // main/snapshot-manager.js _applySnapshot, the 'undo' restore loop (lines 57-66): `P[k] = snap.P[k]` -- by reference.
    // Replicated here because the real applySnapshot drags in the whole app (editor, engine, palette DOM).
    const applySnapshot = (snap) => { for (const k of Object.keys(snap.P)) P[k] = snap.P[k]; };
    unifiedUndo(applySnapshot);
    expect(activeStlLayer().position.x).toBe(0);
    const target = globalHistoryLog[globalHistoryLog.length - 1];
    expect(target.label).toBe('add');
    setStlField('posX', 5);
    expect(activeStlLayer().position.x).toBe(5);
    expect(target.P.stlLayers[0].position.x).toBe(0); // the snapshot we undid to still says 0
  });
});

describe('no clamp: the slider range is travel, not a rule', () => {
  it('any finite number is stored as typed (X far past the board, Z floating, size 10); a non-number writes nothing', () => {
    setup();
    add();
    expect(setStlField('posX', 99)).toBe(true);
    expect(setStlField('posZ', 5)).toBe(true);
    expect(setStlField('scale', 10)).toBe(true);
    expect(setStlField('rotZ', 400)).toBe(true);
    expect(setStlField('compress', 3)).toBe(true);
    expect(activeStlLayer()).toMatchObject({ position: { x: 99, y: 0, z: 5 }, scale: 10, rotation: { x: 0, y: 0, z: 400 }, compress: 3 });
    expect(setStlField('posX', 'abc')).toBe(false);
    expect(activeStlLayer().position.x).toBe(99);
  });
  it('the number box shows what the record holds after a typed value, and the slider keeps its declared travel', () => {
    setup();
    add();
    const n = $('stl_posZ');
    n.value = '12.5'; fire(n, 'change');
    expect(activeStlLayer().position.z).toBe(12.5);
    expect($('stl_posZ').value).toBe('12.5');
    expect($('stl_posZSlider').max).toBe('3'); // the slider's own travel is unchanged
  });
});

describe('Stored detail box', () => {
  it('an empty box, 0, a negative number or text changes nothing (the record is deep-equal before and after)', () => {
    setup();
    add('tile.stl', gridSoup(60));
    for (const bad of ['', '   ', 0, -5, 'abc', null, undefined, NaN]) {
      const before = JSON.parse(JSON.stringify(activeStlLayer()));
      setStoredDetail(bad);
      expect(JSON.parse(JSON.stringify(activeStlLayer())), String(bad)).toEqual(before);
    }
  });
  it('typing in the real box re-syncs it to the record when it is not a number', () => {
    setup();
    add('tile.stl', gridSoup(60));
    const box = $('stlDetail');
    const shown = box.value;
    box.value = ''; fire(box, 'change');
    expect(box.value).toBe(shown);
    expect(activeStlLayer().storedTris).toBe(7200);
  });
  it('a small number is honoured (no floor of 100)', () => {
    setup();
    add('tile.stl', gridSoup(60));
    setStoredDetail(30);
    expect(activeStlLayer().storedDetail).toBe(30);
    expect(activeStlLayer().storedTris).toBeLessThanOrEqual(30);
  });
  it('after a reload (no original) asking for more than is stored leaves the mesh exactly as it is', () => {
    setup();
    add('tile.stl', gridSoup(60));
    setStoredDetail(1000);
    const before = JSON.parse(JSON.stringify(activeStlLayer()));
    _resetStlPanelForTests(); // the in-memory original is gone
    setStoredDetail(5000);
    expect(activeStlLayer().mesh).toEqual(before.mesh);
    expect(activeStlLayer().mesh.h).toBe(before.mesh.h);
    expect(JSON.parse(JSON.stringify(activeStlLayer()))).toEqual(before);
  });
});

describe('errors are shown, not swallowed', () => {
  it('a layer whose stored mesh cannot be read is named in the errors line; the healthy one still stamps; removing it clears the line', () => {
    setup();
    const good = add('good.stl');
    const bad = { ...good, id: 'stlbad', name: 'broken one', mesh: { v: 99 } };
    P.stlLayers = [...P.stlLayers, bad];
    const passes = _collectStampPasses(15, 19);
    expect(passes.map((p) => p.id)).toEqual([`stl:${good.id}`]); // the healthy layer still stamps
    syncStlPanel();
    const box = $('stlErrors');
    expect(box.getAttribute('role')).toBe('status');
    expect(box.classList.contains('stl-error')).toBe(true);
    expect(box.hidden).toBe(false);
    expect(box.textContent).toContain('broken one');
    expect(box.textContent).not.toContain('good');
    removeStlLayer('stlbad');
    expect(box.hidden).toBe(true);
    expect(box.textContent).toBe('');
  });
  it('a stored mesh whose health cannot be measured shows the error text in the health line', () => {
    setup();
    const good = add('good.stl');
    const { health, ...noHealth } = good;
    P.stlLayers = [{ ...noHealth, mesh: { v: 99 } }];
    syncStlPanel();
    expect($('stlHealth').textContent).toMatch(/cannot be read/);
    expect($('stlHealth').textContent.length).toBeGreaterThan('The stored mesh cannot be read: '.length);
  });
});

describe('re-import', () => {
  it('replaces the layer that was active when the file was chosen, even if another row is picked while it reads; health is the new file\'s', async () => {
    setup();
    const a = add('a.stl'); const b = add('b.stl');
    expect(activeStlLayer().id).toBe(b.id);
    document.querySelector(`[data-stl-pick="${a.id}"]`).click();
    expect(a.health.openEdges).toBe(0);
    let finish;
    const file = { name: 'a-more.stl', arrayBuffer: () => new Promise((r) => { finish = r; }) };
    const input = $('stlReimportFile');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fire(input, 'change');
    await later(); // the loading stage paints, then the file starts reading
    document.querySelector(`[data-stl-pick="${b.id}"]`).click(); // the user picks another row while the file reads
    finish(binaryStl(pyramidSoup({ base: false })));
    await later();
    const ra = P.stlLayers.find((r) => r.id === a.id), rb = P.stlLayers.find((r) => r.id === b.id);
    expect(ra.origTris).toBe(4);
    expect(ra.health.openEdges).toBe(4); // the new (open) file's health, not the old closed mesh's
    expect(ra).not.toBe(a);
    expect(rb.origTris).toBe(6);
    expect(rb.health.openEdges).toBe(0);
    expect(ra.unitIn).toBe(a.unitIn);
  });
  it('a target that is gone after the read shows a message and changes nothing', async () => {
    setup();
    const a = add('a.stl');
    let finish;
    const file = { name: 'x.stl', arrayBuffer: () => new Promise((r) => { finish = r; }) };
    const input = $('stlReimportFile');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fire(input, 'change');
    await later();
    removeStlLayer(a.id);
    finish(binaryStl(pyramidSoup()));
    await later();
    expect(P.stlLayers).toEqual([]);
    expect($('stlStatus').hidden).toBe(false);
    expect($('stlStatus').textContent).toMatch(/gone/);
  });
});

describe('an STL with no usable triangles', () => {
  it('through the real file input shows the reason in the status line and adds no layer', async () => {
    setup();
    const v = [1, 1, 1];
    const soup = Float32Array.from([...tri(v, v, v), ...tri(v, v, v), ...tri([2, 2, 2], [2, 2, 2], [2, 2, 2])]);
    const input = $('stlFile');
    const file = { name: 'flat.stl', arrayBuffer: async () => binaryStl(soup) };
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fire(input, 'change');
    await later();
    expect($('stlStatus').hidden).toBe(false);
    expect($('stlStatus').textContent).toMatch(/no usable triangles/);
    expect($('stlStatus').classList.contains('stl-error')).toBe(true);
    expect(P.stlLayers).toEqual([]);
  });
});

describe('touch targets (AGENTS.md: >= 28 px on a coarse pointer)', () => {
  it('the row checkbox is >= 28 px and the row name / add / remove buttons >= 32 px in a (pointer: coarse) block', () => {
    const blocks = [...CSS.matchAll(/@media \(pointer: coarse\) \{([\s\S]*?\n\})/g)].map((m) => m[1]);
    const mine = blocks.find((b) => b.includes('.stl-row input'));
    expect(mine).toBeTruthy();
    expect(mine).toMatch(/\.stl-row input \{[^}]*min-width: 28px[^}]*min-height: 28px/);
    expect(mine).toMatch(/\.stl-row-name[^{]*\{[^}]*min-height: 32px/);
    expect(mine).toMatch(/\.stl-add-row \.cad-btn[^{]*\{[^}]*min-height: 32px/);
    expect(mine).toMatch(/#stlRemove[^{]*\{[^}]*min-height: 32px/);
  });
});

/**
 * STL-RELIEF, Fred 2026-11-22 ("undo should store the instruction, not the model"). Measured before: takeSnapshot deep-copied P
 * with JSON.parse(JSON.stringify(persistableP())), so every undo step copied every STL mesh string (~0.5 MB at 50k triangles),
 * even a step that only moved an STL. core/history.js keeps each mesh ONCE in a content-addressed store (mesh.h -> the mesh
 * object) and a snapshot holds `{ ref: h }` in its place; the restore hands back the SAME mesh objects. Saved files / sessions
 * never see a ref (the store is for undo only). Real history, real panel writes, real stamp passes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { P, DEFAULT, persistableP } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  takeSnapshot, unifiedUndo, unifiedRedo, ensureUndoBaseline, startHistoryAt, globalHistoryLog, globalRedoLog, historyMeshStoreSize,
} from '../bspline-frame-builder/b-spline-gen/html/core/history.js';
import {
  renderStlPanel, bindStlPanel, addStlFromSoup, setStlField, setStoredDetail, activeStlLayer, _resetStlPanelForTests,
} from '../bspline-frame-builder/b-spline-gen/html/main/stl-panel.js';
import { _resetStlCachesForTests } from '../bspline-frame-builder/b-spline-gen/html/core/stl/layer.js';
import { _collectStampPasses } from '../bspline-frame-builder/b-spline-gen/html/core/engine/rebuild.js';
import { applyStampLayers } from '../bspline-frame-builder/b-spline-gen/html/core/engine/apply-stamp-layers.js';

const tri = (a, b, c) => [...a, ...b, ...c];
function gridSoup(n) { // a bumpy tile: n x n quads, z varies (a real relief)
  const t = [], z = (i, j) => 0.3 * Math.sin(i * 0.7) * Math.cos(j * 0.5) + 0.02 * i;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    t.push(tri([i, j, z(i, j)], [i + 1, j, z(i + 1, j)], [i + 1, j + 1, z(i + 1, j + 1)]), tri([i, j, z(i, j)], [i + 1, j + 1, z(i + 1, j + 1)], [i, j + 1, z(i, j + 1)]));
  }
  return Float32Array.from(t.flat());
}
const $ = (id) => document.getElementById(id);
// main/snapshot-manager.js _applySnapshot's undo loop restores keys BY REFERENCE: `P[k] = snap.P[k]` (UNDO_KEEPS skipped)
const applySnapshot = (snap) => { for (const k of Object.keys(snap.P)) if (k !== 'editorSvg' && k !== 'frame') P[k] = snap.P[k]; };
const sha = (a) => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex').slice(0, 16);
const NX = 36, NZ = 46;
const stampedHash = () => sha(applyStampLayers(new Float32Array(NX * NZ).fill(0.4), _collectStampPasses(NX, NZ), NX, NZ));
const saved = {};

beforeEach(() => {
  vi.useFakeTimers(); // the panel's own debounced undo step never fires into another test
  Object.assign(saved, { stl: P.stlLayers, w: P.widthIn, h: P.heightIn });
  P.widthIn = 7; P.heightIn = 9;
  P.stlLayers = DEFAULT.stlLayers;
  document.body.innerHTML = '<div id="stlLayerBody"></div>';
  _resetStlPanelForTests();
  _resetStlCachesForTests();
  renderStlPanel($('stlLayerBody'));
  bindStlPanel({});
  globalHistoryLog.length = 0; globalRedoLog.length = 0;
});
afterEach(() => {
  DEFAULT.stlLayers.length = 0;
  P.stlLayers = saved.stl; P.widthIn = saved.w; P.heightIn = saved.h;
  globalHistoryLog.length = 0; globalRedoLog.length = 0;
  vi.useRealTimers();
});

describe('position-only steps keep ONE mesh copy', () => {
  it('40 X moves: a snapshot is far smaller than the mesh text, and the store holds one mesh', () => {
    const rec = addStlFromSoup(gridSoup(60), 'tile');
    const meshLen = rec.mesh.pos.length + rec.mesh.idx.length;
    expect(meshLen).toBeGreaterThan(20000);
    takeSnapshot('add');
    for (let i = 1; i <= 40; i++) { setStlField('posX', i * 0.05); takeSnapshot(`x${i}`); }
    const top = globalHistoryLog[globalHistoryLog.length - 1];
    expect(JSON.stringify(top.P).length).toBeLessThan(meshLen / 4);
    expect(top.P.stlLayers[0].mesh).toEqual({ ref: rec.mesh.h });
    expect(historyMeshStoreSize()).toBe(1);
    expect(top.P.stlLayers[0].position.x).toBeCloseTo(2, 9); // the instruction is all there
  });
  it('the live P is never changed by a snapshot (its mesh keeps its text)', () => {
    const rec = addStlFromSoup(gridSoup(20), 'tile');
    const text = rec.mesh.pos;
    takeSnapshot('add');
    expect(P.stlLayers[0].mesh).toBe(rec.mesh);
    expect(P.stlLayers[0].mesh.pos).toBe(text);
  });
});

describe('undo / redo restore the exact mesh', () => {
  it('across a Stored-detail change: the SAME mesh objects come back (same text, same h), both ways', () => {
    const rec = addStlFromSoup(gridSoup(60), 'tile');
    const full = activeStlLayer().mesh;
    takeSnapshot('add');
    setStoredDetail(1000);
    const coarse = activeStlLayer().mesh;
    expect(coarse.h).not.toBe(full.h);
    takeSnapshot('detail');
    unifiedUndo(applySnapshot);
    expect(activeStlLayer().id).toBe(rec.id);
    expect(activeStlLayer().mesh).toBe(full);
    expect(activeStlLayer().mesh.pos).toBe(full.pos);
    unifiedRedo(applySnapshot);
    expect(activeStlLayer().mesh).toBe(coarse);
    expect(activeStlLayer().mesh.h).toBe(coarse.h);
  });
  it('a restored board stamps byte-identically (heights hash through _collectStampPasses + applyStampLayers)', () => {
    addStlFromSoup(gridSoup(40), 'tile');
    setStlField('zScale', 2.5);
    takeSnapshot('before');
    const pinned = stampedHash();
    setStlField('posX', 1.3);
    setStlField('rotZ', 30);
    takeSnapshot('moved');
    expect(stampedHash()).not.toBe(pinned);
    unifiedUndo(applySnapshot);
    _resetStlCachesForTests(); // decoded from the restored record, not a cached raster
    expect(stampedHash()).toBe(pinned);
  });
  it('an old record without h stays inline in the snapshot and round-trips', () => {
    const rec = addStlFromSoup(gridSoup(20), 'tile');
    const { h, ...meshNoH } = rec.mesh;
    P.stlLayers = [{ ...rec, mesh: meshNoH }];
    takeSnapshot('old');
    expect(globalHistoryLog[0].P.stlLayers[0].mesh.pos).toBe(meshNoH.pos);
    setStlField('posX', 2);
    takeSnapshot('x');
    unifiedUndo(applySnapshot);
    expect(activeStlLayer().mesh).toEqual(meshNoH);
    expect(activeStlLayer().position.x).toBe(0);
  });
  it('ensureUndoBaseline compares by h: the same board (a JSON copy of the mesh) records no new baseline', () => {
    addStlFromSoup(gridSoup(20), 'tile');
    takeSnapshot('add');
    P.stlLayers = JSON.parse(JSON.stringify(P.stlLayers)); // another mesh object, same content and h
    expect(ensureUndoBaseline('x')).toBe(false);
    setStlField('posX', 1);
    expect(ensureUndoBaseline('x')).toBe(true);
  });
});

describe('no unbounded growth, and nothing saved holds a ref', () => {
  it('meshes no snapshot references any more are dropped when snapshots are trimmed / cleared', () => {
    addStlFromSoup(gridSoup(60), 'tile');
    takeSnapshot('add');
    for (let i = 0; i < 45; i++) { setStoredDetail(1000 + 100 * i); takeSnapshot(`d${i}`); } // 46 distinct meshes, 40 kept
    expect(globalHistoryLog.length).toBe(40);
    const refs = new Set(globalHistoryLog.map((s) => s.P.stlLayers[0].mesh.ref));
    expect(refs.size).toBeGreaterThan(10);
    expect(historyMeshStoreSize()).toBe(refs.size);
    startHistoryAt('Loaded project');
    expect(historyMeshStoreSize()).toBe(1);
  });
  it('persistableP and the session payload carry the full mesh, never a ref', () => {
    const rec = addStlFromSoup(gridSoup(20), 'tile');
    takeSnapshot('add');
    setStlField('posX', 1);
    takeSnapshot('x');
    unifiedUndo(applySnapshot);
    const json = JSON.stringify(persistableP());
    expect(json).not.toMatch(/"ref"/);
    expect(persistableP().stlLayers[0].mesh.pos).toBe(rec.mesh.pos);
  });
});

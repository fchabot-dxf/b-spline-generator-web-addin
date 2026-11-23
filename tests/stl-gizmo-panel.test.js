/**
 * STL-RELIEF gizmo -> panel: the release of a 3D drag is ONE copy-on-write write (main/stl-panel.js applyStlTransform: one undo
 * step, one rebuild, the panel re-synced); a press on another STL's ghost picks it (pickStlLayer: UI state only, P untouched).
 * The history module is the real one except scheduleUndoSnapshot, counted (its own timer coalesces, so a count of the scheduled
 * snapshots is the only way to see "exactly one").
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { scheduleUndoSnapshot } from '../bspline-frame-builder/b-spline-gen/html/core/history.js';
import {
  renderStlPanel, bindStlPanel, addStlFromBuffer, activeStlLayer, applyStlTransform, pickStlLayer, _resetStlPanelForTests,
} from '../bspline-frame-builder/b-spline-gen/html/main/stl-panel.js';
import { mountLayerStack } from './helpers/layer-stack-mount.js'; // the STL cards are the layer stack's (main/layer-stack.js)
import { ghostState } from '../bspline-frame-builder/b-spline-gen/html/core/stl/ghost.js';
import { _resetStlCachesForTests } from '../bspline-frame-builder/b-spline-gen/html/core/stl/layer.js';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/history.js', async (importOriginal) => ({
  ...(await importOriginal()),
  scheduleUndoSnapshot: vi.fn(),
}));

const tri = (a, b, c) => [...a, ...b, ...c];
function pyramidSoup() {
  const A = [-5, -5, 0], B = [5, -5, 0], C = [5, 5, 0], D = [-5, 5, 0], T = [0, 0, 4];
  return Float32Array.from([tri(A, B, T), tri(B, C, T), tri(C, D, T), tri(D, A, T), tri(A, C, B), tri(A, D, C)].flat());
}
function binaryStl(soup) {
  const n = soup.length / 9, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) dv.setFloat32(84 + t * 50 + 12 + k * 4, soup[t * 9 + k], true);
  return buf;
}
const $ = (id) => document.getElementById(id);
const saved = {};
let hooks;

beforeEach(() => {
  Object.assign(saved, { stl: P.stlLayers, w: P.widthIn, h: P.heightIn });
  P.widthIn = 7; P.heightIn = 9;
  P.stlLayers = DEFAULT.stlLayers;
  document.body.innerHTML = '<div id="stlLayerBody"></div>';
  _resetStlPanelForTests();
  _resetStlCachesForTests();
  ghostState.visible = true;
  hooks = { onChange: vi.fn(), refreshGhosts: vi.fn() };
  renderStlPanel($('stlLayerBody'));
  bindStlPanel(hooks); mountLayerStack();
});
afterEach(() => {
  DEFAULT.stlLayers.length = 0;
  if (saved.stl === undefined) delete P.stlLayers; else P.stlLayers = saved.stl;
  P.widthIn = saved.w; P.heightIn = saved.h;
});
const add = (name) => addStlFromBuffer(binaryStl(pyramidSoup()), name);
const reset = () => { scheduleUndoSnapshot.mockClear(); hooks.onChange.mockClear(); hooks.refreshGhosts.mockClear(); };

describe('applyStlTransform: the gizmo release', () => {
  it('one copy-on-write write of position: the old list and record are untouched, ONE undo step, ONE rebuild, the panel shows it', () => {
    const r = add('a.stl');
    reset();
    const list0 = P.stlLayers, rec0 = list0[0], json0 = JSON.stringify(rec0);
    expect(applyStlTransform(r.id, { x: 1.5, y: -2 })).toBe(true);
    expect(P.stlLayers).not.toBe(list0);
    expect(list0[0]).toBe(rec0);
    expect(JSON.stringify(rec0)).toBe(json0);           // the record the undo history may hold is not mutated
    const now = P.stlLayers[0];
    expect(now).not.toBe(rec0);
    expect(now.position).toEqual({ x: 1.5, y: -2, z: 0 });
    expect(now.position).not.toBe(rec0.position);
    expect(now.rotation).toEqual(rec0.rotation);
    expect(scheduleUndoSnapshot).toHaveBeenCalledTimes(1);
    expect(hooks.onChange).toHaveBeenCalledTimes(1);
    expect($('stl_posX').value).toBe('1.5');
    expect($('stl_posY').value).toBe('-2');
    expect($('stl_posXSlider').value).toBe('1.5');
  });
  it('Z and the turn: {z} and {rotZ} write only those keys (no clamp: a floating Z is kept as dropped)', () => {
    const r = add('a.stl');
    applyStlTransform(r.id, { x: 0.5 });
    reset();
    expect(applyStlTransform(r.id, { z: 4.25 })).toBe(true);
    expect(activeStlLayer().position).toEqual({ x: 0.5, y: 0, z: 4.25 });
    expect(applyStlTransform(r.id, { rotZ: 200 })).toBe(true);
    expect(activeStlLayer().rotation).toEqual({ x: 0, y: 0, z: 200 });
    expect($('stl_rotZ').value).toBe('200');
    expect($('stl_posZ').value).toBe('4.25');
    expect(scheduleUndoSnapshot).toHaveBeenCalledTimes(2);
  });
  it('nothing to write, a non-number or an unknown layer: false, nothing written, no undo step, no rebuild', () => {
    const r = add('a.stl');
    reset();
    const list0 = P.stlLayers;
    expect(applyStlTransform(r.id, {})).toBe(false);
    expect(applyStlTransform(r.id, { x: NaN, rotZ: 'abc' })).toBe(false);
    expect(applyStlTransform('nope', { x: 1 })).toBe(false);
    expect(P.stlLayers).toBe(list0);
    expect(scheduleUndoSnapshot).not.toHaveBeenCalled();
    expect(hooks.onChange).not.toHaveBeenCalled();
  });
  it('writes the layer it names, even when another one is active', () => {
    const a = add('a.stl'); const b = add('b.stl');
    expect(activeStlLayer().id).toBe(b.id);
    applyStlTransform(a.id, { y: 3 });
    expect(P.stlLayers.find((x) => x.id === a.id).position.y).toBe(3);
    expect(P.stlLayers.find((x) => x.id === b.id).position.y).toBe(0);
  });
});

describe('pickStlLayer: a press on another ghost', () => {
  it('makes that layer active and re-syncs the panel without writing P (no undo step, no rebuild)', () => {
    const a = add('a.stl'); const b = add('b.stl');
    applyStlTransform(a.id, { x: 2 });
    reset();
    expect(activeStlLayer().id).toBe(b.id);
    expect($('stl_posX').value).toBe('0');
    const list0 = P.stlLayers, json0 = JSON.stringify(list0);
    expect(pickStlLayer(a.id)).toBe(true);
    expect(activeStlLayer().id).toBe(a.id);
    expect(P.stlLayers).toBe(list0);
    expect(JSON.stringify(P.stlLayers)).toBe(json0);
    expect(scheduleUndoSnapshot).not.toHaveBeenCalled();
    expect(hooks.onChange).not.toHaveBeenCalled();
    expect($('stl_posX').value).toBe('2');
    expect(document.querySelector('.stl-row-active [data-stl-pick]').getAttribute('data-stl-pick')).toBe(a.id);
    expect(pickStlLayer('gone')).toBe(false);
    expect(activeStlLayer().id).toBe(a.id);
  });
});

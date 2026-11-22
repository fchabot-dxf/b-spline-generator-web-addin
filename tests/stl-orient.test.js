/**
 * STL-RELIEF, Fred 2026-11-22: 'Lay flat' (the STL's THINNEST dimension up: the usual best relief view, the shallowest stamp) and
 * six quick turns (-90 / +90 about the BOARD's X, Y, Z). Both write the record's rotation {x, y, z} in degrees, in core/stl/raster.js
 * rotationMatrix's own convention (R = Rz * Ry * Rx), each wrapped to [-180, 180). The Smithsonian pose stays the default at insert:
 * these act only when pressed. Real meshes, the real rotationMatrix / placeMesh, the real panel.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { P, DEFAULT } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { rotationMatrix, placeMesh } from '../bspline-frame-builder/b-spline-gen/html/core/stl/raster.js';
import { indexMesh, decodeMesh } from '../bspline-frame-builder/b-spline-gen/html/core/stl/mesh.js';
import {
  eulerFromMatrix, layFlatFrame, quickTurnRotation, axisTurnMatrix, wrapDeg,
} from '../bspline-frame-builder/b-spline-gen/html/core/stl/orient.js';
import { globalHistoryLog, globalRedoLog } from '../bspline-frame-builder/b-spline-gen/html/core/history.js';
import {
  renderStlPanel, bindStlPanel, addStlFromSoup, activeStlLayer, setStlField, STL_ACTIONS, _resetStlPanelForTests,
} from '../bspline-frame-builder/b-spline-gen/html/main/stl-panel.js';

const CSS = readFileSync('bspline-frame-builder/styles/layout-app.css', 'utf8');
const tri = (a, b, c) => [...a, ...b, ...c];
/** A closed box [x0,x1] x [y0,y1] x [z0,z1] as a triangle soup (12 triangles). */
function boxSoup(x0, x1, y0, y1, z0, z1) {
  const v = (i) => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  return quads.flatMap(([a, b, c, d]) => [tri(v(a), v(b), v(c)), tri(v(a), v(c), v(d))]).flat();
}
const mesh = (soup) => indexMesh(Float32Array.from(soup));
/** The placed mesh's extent along each scene axis (placeMesh: the app's own placement). */
function extents(m, rotation) {
  const { xyz } = placeMesh(m, { unitIn: 1, scale: 1, zScale: 1, rotation, position: { x: 0, y: 0 } });
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < xyz.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], xyz[i + a]); hi[a] = Math.max(hi[a], xyz[i + a]); }
  return hi.map((h, a) => h - lo[a]);
}
const expectMatrix = (a, b, digits = 9) => { expect(a).toHaveLength(9); for (let i = 0; i < 9; i++) expect(a[i], `m[${i}]`).toBeCloseTo(b[i], digits); };
const mul = (A, B) => Array.from({ length: 9 }, (_, k) => { const r = Math.floor(k / 3), c = k % 3; return A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]; });
const R = (rot) => rotationMatrix(rot.x, rot.y, rot.z);
const inRange = (rot) => { for (const a of ['x', 'y', 'z']) { expect(rot[a]).toBeGreaterThanOrEqual(-180); expect(rot[a]).toBeLessThan(180); } };

describe('eulerFromMatrix: rotationMatrix\'s own convention, wrapped to [-180, 180)', () => {
  it('round-trips the matrix for general angles, and past +-90 Y', () => {
    for (const rot of [{ x: 20, y: -35, z: 110 }, { x: -170, y: 80, z: 5 }, { x: 179, y: -10, z: -179 }, { x: 45, y: 120, z: -60 }]) {
      const e = eulerFromMatrix(R(rot));
      inRange(e);
      expectMatrix(R(e), R(rot));
    }
  });
  it('gimbal lock (Y = +-90) is resolved deterministically: X = 0, the turn goes into Z', () => {
    const e = eulerFromMatrix(R({ x: 30, y: 90, z: 10 }));
    expect(e.x).toBe(0);
    expect(e.y).toBeCloseTo(90, 9);
    expectMatrix(R(e), R({ x: 30, y: 90, z: 10 }));
    const f = eulerFromMatrix(R({ x: -40, y: -90, z: 70 }));
    expect(f.x).toBe(0);
    expectMatrix(R(f), R({ x: -40, y: -90, z: 70 }));
  });
  it('wrapDeg: 180 -> -180, 540 -> -180, -190 -> 170', () => {
    expect(wrapDeg(180)).toBe(-180);
    expect(wrapDeg(540)).toBe(-180);
    expect(wrapDeg(-190)).toBe(170);
    expect(wrapDeg(12.5)).toBe(12.5);
  });
});

describe('quick turns: 90 degrees about the BOARD\'s axis (world frame: new = R(axis, d) * current)', () => {
  const start = { x: 20, y: -35, z: 110 };
  it('+90 then -90 about board X returns the original matrix', () => {
    const back = quickTurnRotation(quickTurnRotation(start, 'x', 90), 'x', -90);
    expectMatrix(R(back), R(start));
  });
  it('four +90 about Z return the original matrix', () => {
    let r = start;
    for (let i = 0; i < 4; i++) { r = quickTurnRotation(r, 'z', 90); inRange(r); }
    expectMatrix(R(r), R(start));
  });
  it('+90 about board Y on a rotated record = R_y(90) * R_before (not about the STL\'s own Y)', () => {
    const r = quickTurnRotation(start, 'y', 90);
    expectMatrix(R(r), mul(axisTurnMatrix('y', 90), R(start)));
    expectMatrix(axisTurnMatrix('y', 90), rotationMatrix(0, 90, 0));
  });
  it('from no rotation, +90 about Y (the gimbal case) is { x: 0, y: 90, z: 0 }', () => {
    const r = quickTurnRotation({ x: 0, y: 0, z: 0 }, 'y', 90);
    expect(r.x).toBe(0); expect(r.y).toBeCloseTo(90, 9); expect(Math.abs(r.z)).toBeLessThan(1e-9);
  });
});

describe('lay flat: the thinnest dimension up, the longest along X', () => {
  it('a slab on its side (thin along X, long along Y) lies flat: Z extent the smallest, X the largest', () => {
    const m = mesh(boxSoup(0, 1, 0, 10, 0, 6));
    expect(extents(m, { x: 0, y: 0, z: 0 })[0]).toBeCloseTo(1, 6); // before: thin along X
    const { rotation } = layFlatFrame(m);
    inRange(rotation);
    const [ex, ey, ez] = extents(m, rotation);
    expect(ez).toBeCloseTo(1, 5);
    expect(ex).toBeCloseTo(10, 5);
    expect(ey).toBeCloseTo(6, 5);
  });
  it('an already-flat slab (longest along X) gets (near) the identity', () => {
    const { rotation } = layFlatFrame(mesh(boxSoup(-5, 5, -3, 3, 0, 1)));
    for (const a of ['x', 'y', 'z']) expect(Math.abs(rotation[a]), a).toBeLessThan(1e-6);
  });
  it('the angles round-trip through rotationMatrix exactly (the frame\'s matrix re-derived from them)', () => {
    const m = mesh(boxSoup(0, 1, 0, 10, 0, 6).concat(boxSoup(0.2, 0.6, 1, 3, 4, 5.5))); // not a symmetric box
    const { R: frame, rotation } = layFlatFrame(m);
    expectMatrix(R(rotation), frame);
    let det = frame[0] * (frame[4] * frame[8] - frame[5] * frame[7]) - frame[1] * (frame[3] * frame[8] - frame[5] * frame[6]) + frame[2] * (frame[3] * frame[7] - frame[4] * frame[6]);
    expect(det).toBeCloseTo(1, 9);
  });
  it('a relief plaque lying on its side with its bump facing -X: the bump ends up facing UP (+Z)', () => {
    // a 10 x 10 plate thin along X, with a pyramid sticking out of its x = 0 face to x = -3
    const A = [0, 2, 2], B = [0, 8, 2], C = [0, 8, 8], D = [0, 2, 8], T = [-3, 5, 5];
    const m = mesh(boxSoup(0, 1, 0, 10, 0, 10).concat(tri(A, T, B), tri(B, T, C), tri(C, T, D), tri(D, T, A)));
    const { rotation } = layFlatFrame(m);
    const { xyz } = placeMesh(m, { unitIn: 1, scale: 1, zScale: 1, rotation, position: { x: 0, y: 0 } });
    const apex = m.positions.findIndex((v, i) => i % 3 === 0 && v === -3) / 3;
    let top = -Infinity; for (let i = 2; i < xyz.length; i += 3) top = Math.max(top, xyz[i]);
    expect(xyz[apex * 3 + 2]).toBeCloseTo(top, 6);
  });
});

// ── the panel ───────────────────────────────────────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const saved = {};
beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(saved, { stl: P.stlLayers, w: P.widthIn, h: P.heightIn });
  P.widthIn = 7; P.heightIn = 9; P.stlLayers = DEFAULT.stlLayers;
  document.body.innerHTML = '<div id="stlLayerBody"></div>';
  _resetStlPanelForTests();
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

describe('the panel: declared buttons, one copy-on-write write + one undo step each', () => {
  it('Lay flat and the six turns are declared in STL_ACTIONS (Rotate group) and rendered as panel buttons (>= 32 px rows)', () => {
    const rot = STL_ACTIONS.filter((a) => a.group === 'rotate');
    expect(rot.map((a) => a.id)).toEqual(['stlLayFlat', 'stlTurnXMinus', 'stlTurnXPlus', 'stlTurnYMinus', 'stlTurnYPlus', 'stlTurnZMinus', 'stlTurnZPlus']);
    for (const a of rot) {
      const b = $(a.id);
      expect(b && b.tagName, a.id).toBe('BUTTON');
      expect(b.classList.contains('cad-btn')).toBe(true);
      expect(b.closest('.photo-layer-buttons'), a.id).toBeTruthy();
    }
    expect(CSS).toMatch(/\.photo-layer-buttons \.cad-btn \{[^}]*min-height: 32px/);
  });
  it('+90 about X writes ONLY the rotation, into a new record; one undo step', () => {
    addStlFromSoup(Float32Array.from(boxSoup(0, 1, 0, 10, 0, 6)), 'slab');
    setStlField('rotZ', 30);
    vi.advanceTimersByTime(500);
    const before = activeStlLayer(), n = globalHistoryLog.length;
    $('stlTurnXPlus').click();
    vi.advanceTimersByTime(500);
    const after = activeStlLayer();
    expect(after).not.toBe(before);
    expect(before.rotation).toEqual({ x: 0, y: 0, z: 30 });
    const { rotation, ...rest } = after, { rotation: r0, ...restBefore } = before;
    expect(rest).toEqual(restBefore);
    expectMatrix(R(rotation), mul(axisTurnMatrix('x', 90), R(r0)));
    expect(globalHistoryLog.length).toBe(n + 1);
  });
  it('Lay flat replaces the rotation (absolute) from the stored mesh, nothing else', () => {
    addStlFromSoup(Float32Array.from(boxSoup(0, 1, 0, 10, 0, 6)), 'slab');
    setStlField('rotX', 33);
    vi.advanceTimersByTime(500);
    const before = activeStlLayer(), n = globalHistoryLog.length;
    $('stlLayFlat').click();
    vi.advanceTimersByTime(500);
    const after = activeStlLayer();
    expect(after.rotation).toEqual(layFlatFrame(decodeMesh(before.mesh)).rotation);
    const { rotation, ...rest } = after, { rotation: r0, ...restBefore } = before;
    expect(rest).toEqual(restBefore);
    const [ex, , ez] = extents(decodeMesh(after.mesh), after.rotation);
    expect(ez).toBeLessThan(ex);
    expect(globalHistoryLog.length).toBe(n + 1);
  });
});

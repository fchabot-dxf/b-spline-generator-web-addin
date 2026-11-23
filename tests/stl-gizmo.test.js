/**
 * STL-RELIEF slice 2: the in-viewport placement gizmo (core/preview/stl-gizmo.js), the intersection line (core/stl/ghost.js
 * meetLine) and the ghost ids the gizmo picks by. THREE is not available here: the math is pure, the controller runs on an
 * injected pick / ray and a recording view, and setStlGhosts runs on the REAL TerrainPreview prototype with a minimal THREE.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { indexMesh, encodeMesh } from '../bspline-frame-builder/b-spline-gen/html/core/stl/mesh.js';
import { normaliseStlLayer } from '../bspline-frame-builder/b-spline-gen/html/core/stl/layer.js';
import {
  ghostGeometry, updateStlGhosts, ghostState, meetLine,
} from '../bspline-frame-builder/b-spline-gen/html/core/stl/ghost.js';
import {
  STL_GIZMO, StlGizmoController, StlGizmoThreeView, wrapDeg, rayPlane, xyDelta, zDelta, pickHandle, previewTransform, commitValues,
} from '../bspline-frame-builder/b-spline-gen/html/core/preview/stl-gizmo.js';
import { TerrainPreview } from '../bspline-frame-builder/b-spline-gen/html/core/preview/index.js';

const tri = (a, b, c) => [...a, ...b, ...c];
function pyramid({ base = true } = {}) {
  const A = [-5, -5, 0], B = [5, -5, 0], C = [5, 5, 0], D = [-5, 5, 0], T = [0, 0, 4];
  const t = [tri(A, B, T), tri(B, C, T), tri(C, D, T), tri(D, A, T)];
  if (base) t.push(tri(A, C, B), tri(A, D, C));
  return Float32Array.from(t.flat());
}
const GRID = { nx: 41, nz: 41, widthIn: 20, heightIn: 20 };
const FLAT = (z) => new Float32Array(GRID.nx * GRID.nz).fill(z);
const rec = (extra = {}, soup = pyramid()) => ({ ...normaliseStlLayer({ id: 'g', unitIn: 1, mesh: encodeMesh(indexMesh(soup)) }), ...extra });
const S2 = Math.SQRT1_2;

// ── the math ───────────────────────────────────────────────────────────────────────────────────────────────────────
describe('gizmo math: pointer rays to exact deltas', () => {
  it('MOVE: a known oblique ray pair on the plane z = 1 gives the exact X / Y travel', () => {
    const dir = [0, S2, -S2]; // looking toward +y and down at 45 degrees
    // origin (1, 0, 3) reaches z = 1 after 2 along y: (1, 2, 1); origin (4, -1, 3): (4, 1, 1)
    expect(rayPlane({ origin: [1, 0, 3], dir }, [0, 0, 1], [0, 0, 1]).map((v) => +v.toFixed(9))).toEqual([1, 2, 1]);
    const d = xyDelta({ origin: [1, 0, 3], dir }, { origin: [4, -1, 3], dir }, 1);
    expect(d.dx).toBeCloseTo(3, 9);
    expect(d.dy).toBeCloseTo(-1, 9);
  });
  it('Z: on the vertical plane through the pivot facing the camera, the exact vertical travel', () => {
    const dir = [0, S2, -S2];
    // plane y = 3 (pivot (2, 3), normal = the view's horizontal part (0, 1, 0)): origin z 5 lands at z 2, origin z 6.5 at 3.5
    expect(zDelta({ origin: [2, 0, 5], dir }, { origin: [2, 0, 6.5], dir }, [2, 3])).toBeCloseTo(1.5, 9);
    // a sideways pointer move (along the plane, not up) gives no Z
    expect(zDelta({ origin: [2, 0, 5], dir }, { origin: [7, 0, 5], dir }, [2, 3])).toBeCloseTo(0, 9);
    // looking straight down there is no vertical plane facing the camera: no delta (never NaN / Infinity)
    expect(zDelta({ origin: [0, 0, 5], dir: [0, 0, -1] }, { origin: [1, 0, 5], dir: [0, 0, -1] }, [0, 0])).toBe(null);
  });
  // Fred 2026-11-22: no ring -- the ring's angle math is gone; wrapDeg stays (an angle wrapped to [-180, 180))
  it('wrapDeg: an angle wrapped to [-180, 180)', () => {
    expect(wrapDeg(-170 - 170)).toBeCloseTo(20, 9);  // 170 -> -170 across the seam is +20, not -340
    expect(wrapDeg(170 - -170)).toBeCloseTo(-20, 9);
    expect(wrapDeg(180)).toBe(-180);
    expect(wrapDeg(-180)).toBe(-180);
    expect(wrapDeg(540)).toBe(-180);
    expect(wrapDeg(359)).toBeCloseTo(-1, 9);
  });
  it('a drag that did not move commits nothing; one that did gives absolute values from the start', () => {
    const place = { x: 1, y: 2, z: -0.5, rotZ: 30, baseZ: 0 };
    expect(commitValues('body', place, null)).toBe(null);
    expect(commitValues('body', place, { dx: 0, dy: 0 })).toBe(null);
    expect(commitValues('z', place, 0)).toBe(null);
    expect(commitValues('body', place, { dx: 0.5, dy: -1 })).toEqual({ x: 1.5, y: 1 });
    expect(commitValues('z', place, 0.75)).toEqual({ z: 0.25 });
  });
  it('the drag preview shifts the scene-space ghost (a move in X / Y, the arrow in Z)', () => {
    expect(previewTransform('body', { dx: 1, dy: 2 }).position).toEqual([1, 2, 0]);
    expect(previewTransform('z', -0.5).position).toEqual([0, 0, -0.5]);
  });
  it('handle picking is in screen pixels: a coarse pointer grabs 17 px from the arrow, a fine one does not', () => {
    const screen = { z: [[100, 200], [100, 140]] };
    expect(pickHandle([117, 170], screen, STL_GIZMO.pickPx.coarse)).toBe('z');
    expect(pickHandle([117, 170], screen, STL_GIZMO.pickPx.fine)).toBe(null);
    expect(2 * STL_GIZMO.pickPx.coarse).toBeGreaterThanOrEqual(28);              // AGENTS.md: a finger's target
  });
  // Fred 2026-11-22: "no need for the orange ring" -- the gizmo has no rotate ring: none declared, drawn, picked or committed
  it('no ring: nothing declared for it, a ring-shaped screen loop is never picked, a turn is never committed', () => {
    expect(Object.keys(STL_GIZMO).filter((k) => /ring/i.test(k))).toEqual([]);
    expect(Object.keys(STL_GIZMO.colours)).toEqual(['z', 'drag']);
    const loop = Array.from({ length: 64 }, (_, i) => [300 + 50 * Math.cos(i / 64 * 2 * Math.PI), 300 + 50 * Math.sin(i / 64 * 2 * Math.PI)]);
    expect(pickHandle([300, 350], { z: [[100, 200], [100, 140]], ring: loop }, STL_GIZMO.pickPx.coarse)).toBe(null);
    expect(commitValues('ring', { x: 0, y: 0, z: 0, rotZ: 30 }, -45)).toBe(null);
    expect(previewTransform('ring', 90, [2, 1])).toBe(null);
  });
});

// ── the controller ─────────────────────────────────────────────────────────────────────────────────────────────────
const ghost = (id, place) => ({ id, place, positions: Float32Array.from([place.x - 1, place.y - 1, 0, place.x + 1, place.y + 1, 1]) });
function rig({ locked = false, active = 'a', ray } = {}) {
  const view = { drawn: [], previews: [], draw(g, k) { this.drawn.push(g ? { id: g.id, kind: k } : null); }, preview(id, xf) { this.previews.push({ id, xf }); }, setObjects() {}, wpp: () => 0.01 };
  const state = { hit: null };
  const handlers = { commit: vi.fn(() => true), pick: vi.fn(), isLocked: vi.fn(() => locked), activeId: vi.fn(() => active) };
  // a straight-down orthographic view: client pixel (cx, cy) -> scene (cx / 10, -cy / 10)
  const topRay = (cx, cy) => ({ origin: [cx * 0.1, -cy * 0.1, 50], dir: [0, 0, -1] });
  const pick = vi.fn(() => state.hit);
  const ctrl = new StlGizmoController({ view, pick, ray: ray || topRay, isCoarse: () => false });
  ctrl.setHandlers(handlers);
  ctrl.setGhosts([ghost('a', { x: 1, y: 2, z: 0, rotZ: 10, baseZ: 0 }), ghost('b', { x: -4, y: -4, z: 0, rotZ: 0, baseZ: 0 })], {});
  return { ctrl, view, state, handlers, pick };
}
const mouse = (clientX, clientY, extra = {}) => ({ button: 0, clientX, clientY, preventDefault: vi.fn(), ...extra });
const lastXf = (view) => view.previews.at(-1).xf;

describe('StlGizmoController: the pointer chain link', () => {
  beforeEach(() => { ghostState.visible = true; });
  afterEach(() => { ghostState.visible = true; });

  it('down on the body, moves, up: the ghost alone moves during the drag and the release commits ONCE with {x, y}', () => {
    const { ctrl, view, state, handlers } = rig();
    state.hit = { kind: 'body', id: 'a', point: [10, -10, 0.5] };
    const down = mouse(100, 100);
    expect(ctrl.tryHandleCanvasMousedown(down)).toBe(true);
    expect(down.preventDefault).toHaveBeenCalled();
    expect(ctrl.tryHandleWindowMousemove(mouse(120, 80))).toBe(true);
    expect(ctrl.tryHandleWindowMousemove(mouse(130, 60))).toBe(true);
    expect(lastXf(view).position.map((v) => +v.toFixed(9))).toEqual([3, 4, 0]);
    expect(handlers.commit).not.toHaveBeenCalled(); // nothing written while dragging
    expect(ctrl.handleWindowMouseup()).toBe(true);
    expect(handlers.commit).toHaveBeenCalledTimes(1);
    const [id, values] = handlers.commit.mock.calls[0];
    expect(id).toBe('a');
    expect(Object.keys(values).sort()).toEqual(['x', 'y']);
    expect(values.x).toBeCloseTo(1 + 3, 9);
    expect(values.y).toBeCloseTo(2 + 4, 9);
    expect(ctrl.handleWindowMouseup()).toBe(false); // a second mouseup is not a second commit
    expect(handlers.commit).toHaveBeenCalledTimes(1);
    expect(handlers.pick).not.toHaveBeenCalled();   // it was already the active STL
  });

  // Fred 2026-11-22: no ring -- a 'ring' hit starts no drag and commits nothing (the turn is set in the STL card)
  it('a ring hit is not a handle: the press is not consumed (orbit gets it), nothing turns or commits', () => {
    const { ctrl, view, state, handlers } = rig();
    state.hit = { kind: 'ring', id: 'a' };
    expect(ctrl.tryHandleCanvasMousedown(mouse(30, -20))).toBe(false);
    expect(ctrl.tryHandleWindowMousemove(mouse(10, -40))).toBe(false);
    expect(ctrl.handleWindowMouseup()).toBe(false);
    expect(view.previews).toHaveLength(0);
    expect(handlers.commit).not.toHaveBeenCalled();
  });

  it('down on the arrow: Z on the vertical plane facing the camera commits {z}', () => {
    const dir = [0, S2, -S2];
    const { ctrl, state, handlers } = rig({ ray: (cx, cy) => ({ origin: [cx * 0.1, -10, -cy * 0.1], dir }) });
    state.hit = { kind: 'z', id: 'a' };
    expect(ctrl.tryHandleCanvasMousedown(mouse(10, 0))).toBe(true);
    ctrl.tryHandleWindowMousemove(mouse(10, -15));
    ctrl.handleWindowMouseup();
    expect(Object.keys(handlers.commit.mock.calls[0][1])).toEqual(['z']);
    expect(handlers.commit.mock.calls[0][1].z).toBeCloseTo(1.5, 9);
  });

  it('down on empty space returns false (the orbit gets the event) and starts nothing', () => {
    const { ctrl, state, handlers } = rig();
    state.hit = null;
    const down = mouse(5, 5);
    expect(ctrl.tryHandleCanvasMousedown(down)).toBe(false);
    expect(down.preventDefault).not.toHaveBeenCalled();
    expect(ctrl.tryHandleWindowMousemove(mouse(50, 50))).toBe(false);
    expect(ctrl.handleWindowMouseup()).toBe(false);
    expect(handlers.commit).not.toHaveBeenCalled();
    expect(ctrl.tryHandleCanvasMousedown(mouse(5, 5, { button: 2 }))).toBe(false); // right button: always the orbit's
  });

  it('locked by the job timeline: no handles drawn, no event consumed, even on the body', () => {
    const { ctrl, view, state, handlers, pick } = rig({ locked: true });
    state.hit = { kind: 'body', id: 'a', point: [0, 0, 0] };
    ctrl.sync();
    expect(view.drawn.filter(Boolean)).toEqual([]);
    expect(ctrl.tryHandleCanvasMousedown(mouse(100, 100))).toBe(false);
    expect(ctrl.tryHandleTouchstart({ clientX: 100, clientY: 100 })).toBe(false);
    expect(pick).not.toHaveBeenCalled();
    expect(handlers.commit).not.toHaveBeenCalled();
  });

  it('unlocked: sync draws the ACTIVE ghost\'s handles; hiding the ghosts or the sculpt tool turns it off', () => {
    const { ctrl, view, state } = rig();
    expect(ctrl.sync()).toBe(true);
    expect(view.drawn.at(-1)).toEqual({ id: 'a', kind: null });
    expect(ctrl.sync()).toBe(false); // nothing changed: nothing redrawn
    ghostState.visible = false;
    ctrl.sync();
    expect(view.drawn.at(-1)).toBe(null);
    state.hit = { kind: 'body', id: 'a', point: [0, 0, 0] };
    expect(ctrl.tryHandleCanvasMousedown(mouse(100, 100))).toBe(false);
    ghostState.visible = true;
    const sculpting = new StlGizmoController({ view, pick: () => state.hit, ray: () => ({ origin: [0, 0, 9], dir: [0, 0, -1] }), isSuppressed: () => true });
    sculpting.setHandlers({ commit: vi.fn(), isLocked: () => false, activeId: () => 'a' });
    sculpting.setGhosts([ghost('a', { x: 0, y: 0, z: 0, rotZ: 0, baseZ: 0 })], {});
    expect(sculpting.tryHandleCanvasMousedown(mouse(1, 1))).toBe(false);
  });

  it('Escape cancels: the ghost goes back (preview cleared) and nothing is committed; so does a window blur', () => {
    const { ctrl, view, state, handlers } = rig();
    state.hit = { kind: 'body', id: 'a', point: [10, -10, 0] };
    ctrl.tryHandleCanvasMousedown(mouse(100, 100));
    ctrl.tryHandleWindowMousemove(mouse(140, 100));
    expect(lastXf(view)).not.toBe(null);
    expect(ctrl.handleKeydown({ key: 'Enter' })).toBe(false);
    expect(ctrl.handleKeydown({ key: 'Escape' })).toBe(true);
    expect(view.previews.at(-1)).toEqual({ id: 'a', xf: null });
    expect(ctrl.handleWindowMouseup()).toBe(false);
    ctrl.tryHandleCanvasMousedown(mouse(100, 100));
    ctrl.tryHandleWindowMousemove(mouse(140, 100));
    expect(ctrl.handleBlur()).toBe(true);
    expect(view.previews.at(-1)).toEqual({ id: 'a', xf: null });
    ctrl.handleWindowMouseup();
    expect(handlers.commit).not.toHaveBeenCalled();
  });

  it('a press and release without movement (or back to the start) commits nothing', () => {
    const { ctrl, state, handlers } = rig();
    state.hit = { kind: 'body', id: 'a', point: [10, -10, 0] };
    ctrl.tryHandleCanvasMousedown(mouse(100, 100));
    ctrl.handleWindowMouseup();
    ctrl.tryHandleCanvasMousedown(mouse(100, 100));
    ctrl.tryHandleWindowMousemove(mouse(100, 100));
    ctrl.handleWindowMouseup();
    expect(handlers.commit).not.toHaveBeenCalled();
  });

  it('a press on another STL\'s ghost makes it the active one (pick) and drags THAT one', () => {
    const { ctrl, state, handlers } = rig();
    state.hit = { kind: 'body', id: 'b', point: [-40, 40, 0] };
    expect(ctrl.tryHandleCanvasMousedown(mouse(-400, 400))).toBe(true);
    expect(handlers.pick).toHaveBeenCalledWith('b');
    ctrl.tryHandleWindowMousemove(mouse(-390, 400));
    ctrl.handleWindowMouseup();
    expect(handlers.commit.mock.calls[0][0]).toBe('b');
    expect(handlers.commit.mock.calls[0][1].x).toBeCloseTo(-4 + 1, 9);
  });

  it('touch: start / move / end commits once (a coarse tolerance is asked for); a mouseup does not end a touch drag', () => {
    const { ctrl, state, handlers, pick } = rig();
    state.hit = { kind: 'body', id: 'a', point: [10, -10, 0] };
    expect(ctrl.tryHandleTouchstart({ clientX: 100, clientY: 100 })).toBe(true);
    expect(pick.mock.calls[0][2]).toBe(STL_GIZMO.pickPx.coarse);
    expect(ctrl.tryHandleTouchmove({ clientX: 100, clientY: 120 })).toBe(true);
    expect(ctrl.handleWindowMouseup()).toBe(false);
    expect(ctrl.handleTouchend()).toBe(true);
    expect(handlers.commit).toHaveBeenCalledTimes(1);
    expect(handlers.commit.mock.calls[0][1].y).toBeCloseTo(2 - 2, 9);
  });

  it('the ghosts redrawn mid-drag (a rebuild landed) keep showing the drag; its STL removed ends it without a commit', () => {
    const { ctrl, view, state, handlers } = rig();
    state.hit = { kind: 'body', id: 'a', point: [10, -10, 0] };
    ctrl.tryHandleCanvasMousedown(mouse(100, 100));
    ctrl.tryHandleWindowMousemove(mouse(110, 100));
    view.previews.length = 0;
    ctrl.setGhosts([ghost('a', { x: 1, y: 2, z: 0, rotZ: 10, baseZ: 0 })], {});
    expect(view.previews).toHaveLength(1);
    expect(view.previews[0].xf.position[0]).toBeCloseTo(1, 9);
    ctrl.setGhosts([ghost('b', { x: -4, y: -4, z: 0, rotZ: 0, baseZ: 0 })], {});
    expect(ctrl.hasDrag()).toBe(false);
    ctrl.handleWindowMouseup();
    expect(handlers.commit).not.toHaveBeenCalled();
  });

  // Fred 2026-11-22 (question 1 of 4): "Ignore tiny wobbles" -- a press that moves less than STL_GIZMO.slopPx does nothing
  it('a wobble inside STL_GIZMO.slopPx neither moves the ghost nor commits; past it the drag follows from the PRESS point', () => {
    expect(STL_GIZMO.slopPx.fine).toBeGreaterThan(0);
    expect(STL_GIZMO.slopPx.coarse).toBeGreaterThan(STL_GIZMO.slopPx.fine); // a finger wobbles more than a mouse
    const { ctrl, view, state, handlers } = rig();
    state.hit = { kind: 'body', id: 'a', point: [10, -10, 0] };
    const w = STL_GIZMO.slopPx.fine - 0.5;
    ctrl.tryHandleCanvasMousedown(mouse(100, 100));
    expect(ctrl.tryHandleWindowMousemove(mouse(100 + w, 100))).toBe(true); // still the gizmo's event (no orbit)
    expect(view.previews).toHaveLength(0);
    expect(ctrl.handleWindowMouseup()).toBe(true);
    expect(handlers.commit).not.toHaveBeenCalled();
    // a real drag after an early wobble: measured from the press, not from where the wobble ended
    ctrl.tryHandleCanvasMousedown(mouse(100, 100));
    ctrl.tryHandleWindowMousemove(mouse(100 + w, 100));
    ctrl.tryHandleWindowMousemove(mouse(130, 60));
    ctrl.handleWindowMouseup();
    expect(handlers.commit).toHaveBeenCalledTimes(1);
    expect(handlers.commit.mock.calls[0][1].x).toBeCloseTo(1 + 3, 9);
    expect(handlers.commit.mock.calls[0][1].y).toBeCloseTo(2 + 4, 9);
  });

  // Fred 2026-11-22: no ring -- the wobble check runs on the body (the ring's half is gone)
  it('touch uses the coarse wobble allowance: a finger wobble under it on the body commits nothing', () => {
    const { ctrl, state, handlers } = rig();
    const w = STL_GIZMO.slopPx.coarse - 0.5;
    state.hit = { kind: 'body', id: 'a', point: [10, -10, 0] };
    ctrl.tryHandleTouchstart({ clientX: 100, clientY: 100 });
    ctrl.tryHandleTouchmove({ clientX: 100 + w, clientY: 100 });
    ctrl.handleTouchend();
    expect(handlers.commit).not.toHaveBeenCalled();
  });

  // Fred 2026-11-22 (question 3 of 4, "Wrap to -180..180") pinned the ring's commit; Fred 2026-11-22: no ring, so it is gone
});

// Fred 2026-11-22: "no need for the orange ring" -- the THREE side draws the Z arrow only, and its screen handles have no ring
describe('StlGizmoThreeView (a minimal THREE): no ring drawn', () => {
  function threeStub() {
    class Obj { constructor(geometry, material) { this.geometry = geometry; this.material = material; this.userData = {}; this.rotation = { x: 0, y: 0, z: 0, set() {} }; this.position = { set() {} }; } }
    const geo = (kind) => class { constructor(...a) { this.kind = kind; this.args = a; } dispose() {} };
    return {
      Raycaster: class { constructor() { this.ray = { origin: {}, direction: {} }; } },
      Group: class { constructor() { this.children = []; this.position = { set() {} }; this.rotation = { set() {} }; } add(c) { this.children.push(c); } },
      Mesh: Obj,
      CylinderGeometry: geo('cylinder'), ConeGeometry: geo('cone'), TorusGeometry: geo('torus'),
      MeshBasicMaterial: class { dispose() {} },
      Color: class {},
      Vector3: class { constructor(x, y, z) { Object.assign(this, { x, y, z }); } project() { return this; } },
    };
  }
  it('draw adds the arrow (shaft + head, handle z) and nothing else; handleScreen lists the arrow only', () => {
    const THREE = threeStub();
    const added = [];
    const view = new StlGizmoThreeView({ THREE, scene: { add: (o) => added.push(o), remove() {} },
      camera: { top: 5, bottom: -5, zoom: 1 }, canvas: { clientHeight: 500, getBoundingClientRect: () => ({ left: 0, top: 0, width: 500, height: 500 }) } });
    const g = { id: 'a', place: { x: 1, y: 2, z: 0, rotZ: 0, baseZ: 0 }, top: 1 };
    view.draw(g, null);
    const kids = added[0].children;
    expect(kids.map((m) => m.geometry.kind)).toEqual(['cylinder', 'cone']);
    expect(kids.map((m) => m.userData.stlHandle)).toEqual(['z', 'z']);
    expect(Object.keys(view.handleScreen(g))).toEqual(['z']);
  });
});

// ── the intersection line ──────────────────────────────────────────────────────────────────────────────────────────
/** segments as [[x0, y0, z0], [x1, y1, z1]] */
const segs = (line) => { const out = []; for (let i = 0; i < line.length; i += 6) out.push([Array.from(line.slice(i, i + 3)), Array.from(line.slice(i + 3, i + 6))]); return out; };
const key = (p) => p.map((v) => v.toFixed(3)).join(',');

describe('meetLine: where the ghost meets the surface', () => {
  it('a 10-wide, 4-high pyramid sunk by 2 meets the surface in a closed square at half its height: sides x / y = +-2.5', () => {
    const g = ghostGeometry(rec({ position: { x: 0, y: 0, z: -2 } }), FLAT(3), GRID);
    expect(g.meetLine).toBeInstanceOf(Float32Array);
    const s = segs(g.meetLine);
    expect(s).toHaveLength(4);
    const lowest = Math.min(...Array.from({ length: g.positions.length / 3 }, (_, v) => g.positions[v * 3 + 2]));
    for (const [a, b] of s) {
      for (const p of [a, b]) {
        expect(p[2]).toBeCloseTo(3, 5);              // rel = 0: at the surface (height 3) ...
        expect(p[2] - lowest).toBeCloseTo(2, 5);     // ... = 2 above the sunk base
        expect(Math.max(Math.abs(p[0]), Math.abs(p[1]))).toBeCloseTo(2.5, 3); // the stored mesh is quantised
      }
    }
    const side = ([a, b]) => (Math.abs(a[0] - b[0]) < 1e-4 ? `x${Math.sign(a[0])}` : Math.abs(a[1] - b[1]) < 1e-4 ? `y${Math.sign(a[1])}` : 'diagonal');
    expect(s.map(side).sort()).toEqual(['x-1', 'x1', 'y-1', 'y1']);
    // closed: every corner is shared by exactly two segments
    const count = new Map();
    for (const [a, b] of s) for (const p of [a, b]) count.set(key(p), (count.get(key(p)) || 0) + 1);
    expect([...count.values()]).toEqual([2, 2, 2, 2]);
  });
  it('resting on the surface (z = 0) gives the base outline (the corners +-5)', () => {
    const s = segs(ghostGeometry(rec(), FLAT(0), GRID).meetLine);
    expect(s).toHaveLength(4);
    for (const [a, b] of s) for (const p of [a, b]) {
      expect(Math.abs(p[0])).toBeCloseTo(5, 3);
      expect(Math.abs(p[1])).toBeCloseTo(5, 3);
      expect(p[2]).toBeCloseTo(0, 6);
    }
  });
  it('fully buried or fully floating: no line', () => {
    expect(ghostGeometry(rec({ position: { x: 0, y: 0, z: -5 } }), FLAT(0), GRID).meetLine).toHaveLength(0);
    expect(ghostGeometry(rec({ position: { x: 0, y: 0, z: 0.5 } }), FLAT(0), GRID).meetLine).toHaveLength(0);
  });
  it('the pure function: one straddling triangle gives one segment by linear interpolation; a single touching vertex gives none', () => {
    const pos = Float32Array.from([0, 0, -1, 4, 0, 3, 0, 4, 3]);
    expect(Array.from(meetLine(pos, [-1, 3, 3], [0, 1, 2])).map((v) => +v.toFixed(6))).toEqual([1, 0, 0, 0, 1, 0]);
    expect(meetLine(pos, [0, 3, 3], [0, 1, 2])).toHaveLength(0);
  });
});

// ── ghost ids + the preview's ghost objects ────────────────────────────────────────────────────────────────────────
describe('ghost ids', () => {
  it('updateStlGhosts hands the preview each enabled ghost WITH its record id and placement', () => {
    const p = { setStlGhosts(l) { this.list = l; } };
    updateStlGhosts(p, [rec({ id: 'one', position: { x: 1, y: -2, z: -0.25 }, rotation: { x: 0, y: 0, z: 30 } }), rec({ id: 'off', enabled: false }), rec({ id: 'two' })], FLAT(0.5), GRID);
    expect(p.list.map((g) => g.id)).toEqual(['one', 'two']);
    expect(p.list[0].place).toEqual({ x: 1, y: -2, z: -0.25, rotZ: 30, baseZ: 0.5 });
  });
});

function miniTHREE() {
  class Obj { constructor(geometry, material) { this.geometry = geometry; this.material = material; this.userData = {}; this.visible = true; } }
  return {
    BufferGeometry: class { setAttribute(k, v) { this[k] = v; } setIndex(i) { this.index = i; } computeVertexNormals() {} dispose() {} },
    BufferAttribute: class { constructor(array, size) { this.array = array; this.itemSize = size; } },
    MeshLambertMaterial: class { constructor(o) { Object.assign(this, o); } dispose() {} },
    LineBasicMaterial: class { constructor(o) { Object.assign(this, o); } dispose() {} },
    Color: class { constructor(r, g, b) { Object.assign(this, { r, g, b }); } },
    Mesh: class extends Obj {},
    LineSegments: class extends Obj {},
    DoubleSide: 2,
  };
}

describe('TerrainPreview.setStlGhosts (the real method, a minimal THREE)', () => {
  const host = () => {
    const scene = { objs: new Set(), add(o) { this.objs.add(o); }, remove(o) { this.objs.delete(o); } };
    const seen = [];
    return {
      _THREE: miniTHREE(), _scene: scene, _needsRender: false, seen,
      _canvas: { width: 10, height: 10 }, _camera: { aspect: 1, updateProjectionMatrix() {} },
      _renderer: { setSize() {}, render: () => seen.push([...scene.objs].map((o) => o.visible)), domElement: { toDataURL: () => 'data:x' } },
    };
  };
  // Fred 2026-11-22 ("only keep red"): the meet line is no longer drawn (ghost.js meetLine stays computed)
  it('each ghost mesh carries its layer id; no meet line is drawn', () => {
    const h = host();
    const sunk = ghostGeometry(rec({ id: 'sunk', position: { x: 0, y: 0, z: -2 } }), FLAT(0), GRID);
    const floating = ghostGeometry(rec({ id: 'up', position: { x: 0, y: 0, z: 1 } }), FLAT(0), GRID);
    TerrainPreview.prototype.setStlGhosts.call(h, [sunk, floating]);
    expect(h._stlGhosts.map((m) => m.userData.stlId)).toEqual(['sunk', 'up']);
    expect(sunk.meetLine.length).toBeGreaterThan(0);
    expect(h._stlMeetLines).toHaveLength(0);
    expect(h._scene.objs.size).toBe(2);
    TerrainPreview.prototype.setStlGhosts.call(h, []);
    expect(h._scene.objs.size).toBe(0); // the old ghosts AND lines are removed
  });
  it('getSnapshot hides the ghost for the picture and shows it again after (no meet line since Fred 2026-11-22)', () => {
    const h = host();
    TerrainPreview.prototype.setStlGhosts.call(h, [ghostGeometry(rec({ id: 's', position: { x: 0, y: 0, z: -2 } }), FLAT(0), GRID)]);
    TerrainPreview.prototype.getSnapshot.call(h, 20, 20);
    expect(h.seen[0]).toEqual([false]);
    expect([...h._scene.objs].map((o) => o.visible)).toEqual([true]);
  });
});

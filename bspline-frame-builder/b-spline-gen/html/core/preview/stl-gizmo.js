/**
 * STL-RELIEF placement gizmo (STL-RELIEF-DESIGN.md section 4): drag the ACTIVE STL's ghost in the 3D view.
 *
 *   body   the ghost itself          MOVE in X / Y   (the pointer on the horizontal plane through the grab point)
 *   arrow  a vertical arrow above it  Z               (the pointer on the vertical plane through the pivot, facing the camera)
 * No rotate ring (Fred 2026-11-22: "no need for the orange ring"): the turn is set in the STL card (its Rotate fields and
 * the +-90 quick turns).
 *
 * A link of the preview's ONE pointer chain (core/preview/index.js _bindEvents): sculpt first, then this, then orbit. Every
 * tryHandle* returns true when it consumed the event. During a drag only the THREE objects move (nothing is written, no
 * rebuild per tick); the release commits ONCE through the host's handler (main/stl-panel.js applyStlTransform: one write, one
 * undo step, one rebuild). No movement, or a wobble within STL_GIZMO.slopPx, = no commit. Escape, a lost pointer (window blur, touchcancel) or a second finger cancel:
 * the ghost goes back, nothing is written. Locked (the job timeline holds the STL section), ghosts hidden, no handlers, or the
 * sculpt tool on: no handles are drawn and no event is consumed (orbit works as before).
 *
 * The math is pure (rays are { origin: [x,y,z], dir: [x,y,z] }) and the controller takes its picking / ray / drawing from
 * injectable deps, so it runs without THREE; StlGizmoThreeView is the only part that touches THREE (r128, window.THREE).
 *
 * Pick tolerance: the arrow is picked in SCREEN space, by the pointer's distance in CSS px to its projected
 * axis, within STL_GIZMO.pickPx (coarse pointer or any touch: 18 px each side = a 36 px wide band >= 28 px,
 * AGENTS.md); their drawn size is fixed in CSS px too (rescaled with the zoom), so the target is the same at every zoom. The
 * body is picked by a THREE.Raycaster hit on the ghost mesh itself (the ghost is fitted to half the board at import, far larger
 * than any tolerance).
 */
import { ghostState } from '../stl/ghost.js';

/** Every size, colour and tolerance of the gizmo, once. Sizes in CSS px (converted with the view's world-per-pixel). */
export const STL_GIZMO = Object.freeze({
  pickPx: Object.freeze({ fine: 8, coarse: 18 }), // half-width of a handle's grab band; coarse (and every touch) = 36 px wide
  // Fred 2026-11-22 ("Ignore tiny wobbles"): a press whose pointer stays within this many CSS px of where it went down moves
  // nothing and commits nothing; past it the drag counts from the press point. Coarse = every touch and a coarse mouse.
  slopPx: Object.freeze({ fine: 3, coarse: 8 }),
  arrowGapPx: 12,          // between the ghost's top and the arrow's foot
  arrowShaftPx: 40,
  arrowHeadPx: 18,
  arrowShaftRadiusPx: 2.5,
  arrowHeadRadiusPx: 8,
  rescaleRatio: 0.01,      // the handles are rebuilt when the zoom changes the world-per-pixel by more than this
  renderOrder: 7,          // drawn over the ghost (5) and the meet line (6), depth test off: never hidden by the surface
  colours: Object.freeze({
    z: Object.freeze([0.15, 0.45, 0.95]),
    drag: Object.freeze([1.0, 0.9, 0.2]), // the handle being dragged (the old meet-line yellow)
  }),
});

// ── pure math ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** An angle in degrees wrapped to [-180, 180). */
export const wrapDeg = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

/** Where `ray` meets the plane through `point` with normal `normal`; null when parallel (or behind nothing: any t). */
export function rayPlane(ray, point, normal) {
  const [ox, oy, oz] = ray.origin, [dx, dy, dz] = ray.dir;
  const den = dx * normal[0] + dy * normal[1] + dz * normal[2];
  if (Math.abs(den) < 1e-9) return null; // numerics: a ray in the plane has no single crossing
  const t = ((point[0] - ox) * normal[0] + (point[1] - oy) * normal[1] + (point[2] - oz) * normal[2]) / den;
  return [ox + t * dx, oy + t * dy, oz + t * dz];
}

/** MOVE: the X / Y travel between two pointer rays on the horizontal plane z = `z`. */
export function xyDelta(rayA, rayB, z) {
  const a = rayPlane(rayA, [0, 0, z], [0, 0, 1]), b = rayPlane(rayB, [0, 0, z], [0, 0, 1]);
  return a && b ? { dx: b[0] - a[0], dy: b[1] - a[1] } : null;
}

/** The vertical plane through the pivot that faces the camera: its normal is the view direction's horizontal part. */
export function verticalPlaneNormal(dir) {
  const len = Math.hypot(dir[0], dir[1]);
  return len < 1e-9 ? null : [dir[0] / len, dir[1] / len, 0]; // looking straight down: no such plane
}

/** Z: the vertical travel between two pointer rays on the vertical plane through `pivot` facing the camera. */
export function zDelta(rayA, rayB, pivot) {
  const n = verticalPlaneNormal(rayB.dir);
  if (!n) return null;
  const p = [pivot[0], pivot[1], 0];
  const a = rayPlane(rayA, p, n), b = rayPlane(rayB, p, n);
  return a && b ? b[2] - a[2] : null;
}

/** Distance from screen point p to segment ab (all [x, y]). */
export function distToSegment(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * vx), p[1] - (a[1] + t * vy));
}

/**
 * Which handle a screen point grabs: `screen` = { z: [foot, tip] } in the same pixels as `p`; 'z' within `tolPx`, else null
 * (the body or the orbit get the event). There is no ring (Fred 2026-11-22).
 */
export function pickHandle(p, screen, tolPx) {
  const dz = screen && screen.z ? distToSegment(p, screen.z[0], screen.z[1]) : Infinity;
  return dz <= tolPx ? 'z' : null;
}

/** The ghost's top z, from its scene positions. */
export function ghostExtent(positions) {
  let top = -Infinity;
  for (let i = 2; i < positions.length; i += 3) if (positions[i] > top) top = positions[i];
  return { top: Number.isFinite(top) ? top : 0 };
}

/** Where the handles are, in scene inches, for a ghost `g` = { place, top } at `wpp` inches per CSS px. */
export function handleLayout(g, wpp, T = STL_GIZMO) {
  const { x, y } = g.place;
  const foot = g.top + T.arrowGapPx * wpp;
  return {
    pivot: [x, y],
    arrow: {
      foot: [x, y, foot], tip: [x, y, foot + (T.arrowShaftPx + T.arrowHeadPx) * wpp],
      shaftLen: T.arrowShaftPx * wpp, headLen: T.arrowHeadPx * wpp,
      shaftR: T.arrowShaftRadiusPx * wpp, headR: T.arrowHeadRadiusPx * wpp,
    },
  };
}

/** The transform that shows a drag on the THREE objects (whose geometry is already in scene coordinates): a shift. */
export function previewTransform(kind, delta) {
  if (kind === 'body') return { position: [delta.dx, delta.dy, 0], rotationZ: 0 };
  if (kind === 'z') return { position: [0, 0, delta], rotationZ: 0 };
  return null;
}

/** What a finished drag writes (absolute values from the start `place`), or null when it did not move. */
export function commitValues(kind, place, delta) {
  if (kind === 'body') return delta && (delta.dx !== 0 || delta.dy !== 0) ? { x: place.x + delta.dx, y: place.y + delta.dy } : null;
  if (kind === 'z') return delta ? { z: place.z + delta } : null;
  return null;
}

const isCoarsePointer = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

// ── the controller (no THREE) ───────────────────────────────────────────────────────────────────────────────────────

export class StlGizmoController {
  /**
   * @param {object} deps
   * @param {object} deps.view           drawing + hit testing (StlGizmoThreeView, or a stand-in): draw(g|null, dragKind),
   *                                     preview(id, xf|null), setObjects(objects), wpp(), handleScreen(g), pickBody(cx, cy),
   *                                     ray(cx, cy), bodyCandidates(id), sceneObjects(), dispose()
   * @param {Function} [deps.pick]       (clientX, clientY, tolPx) -> { kind: 'body'|'z', id, point? } | null
   * @param {Function} [deps.ray]        (clientX, clientY) -> { origin, dir } | null
   * @param {Function} [deps.isCoarse]   true on a coarse pointer (mouse events); a touch always uses the coarse tolerance
   * @param {Function} [deps.isSuppressed] true while another tool owns the pointer (the sculpt tool)
   * @param {Function} [deps.requestRender]
   */
  constructor({ view, pick, ray, isCoarse = isCoarsePointer, isSuppressed = () => false, requestRender = () => {} } = {}) {
    this._view = view;
    this._pick = pick || ((x, y, tol) => this._defaultPick(x, y, tol));
    this._ray = ray || ((x, y) => this._view.ray(x, y));
    this._isCoarse = isCoarse;
    this._isSuppressed = isSuppressed;
    this._requestRender = requestRender;
    this._handlers = null;
    this._ghosts = [];          // { id, place, top }
    this._drag = null;
    this._drawn = { id: undefined, wpp: 0, kind: null };
    /** the last commit handed to the host (a debug / check aid: { id, values }) */
    this.lastCommit = null;
  }

  /** { commit(id, values) -> truthy when written, pick(id), isLocked() -> bool, activeId() -> id | null } (main/main.js). */
  setHandlers(h) { this._handlers = h || null; this._drawn.id = undefined; }

  /** The ghosts just drawn (core/stl/ghost.js entries: id, positions, place) and their THREE objects. */
  setGhosts(entries, objects) {
    this._ghosts = (entries || []).filter((e) => e && e.place).map((e) => ({ id: e.id, place: e.place, ...ghostExtent(e.positions || []) }));
    this._view?.setObjects?.(objects);
    this._drawn.id = undefined;
    const d = this._drag;
    if (d) {
      if (this._ghosts.some((g) => g.id === d.id)) this._view?.preview?.(d.id, d.xf); // a rebuild landed mid-drag: keep showing it
      else this._drag = null;                                                        // its STL is gone: nothing to drag
    }
  }

  hasDrag() { return !!this._drag; }

  isActive() {
    const h = this._handlers;
    if (!h || !ghostState.visible || !this._ghosts.length) return false;
    if (h.isLocked && h.isLocked()) return false;
    return !this._isSuppressed();
  }

  activeGhost() {
    const id = this._handlers?.activeId?.();
    return this._ghosts.find((g) => g.id === id) || null;
  }

  /** Per frame (the preview's loop): draw / hide / rescale the handles. True when something changed (render again). */
  sync() {
    const g = this.isActive() ? this.activeGhost() : null;
    const wpp = g && this._view?.wpp ? this._view.wpp() : 0;
    const kind = this._drag ? this._drag.kind : null;
    const d = this._drawn;
    const rescale = g && d.wpp > 0 && Math.abs(wpp / d.wpp - 1) > STL_GIZMO.rescaleRatio;
    if ((g ? g.id : null) === d.id && !rescale && kind === d.kind) return false;
    this._view?.draw?.(g, kind);
    this._drawn = { id: g ? g.id : null, wpp, kind };
    return true;
  }

  // ── pointer chain links ──────────────────────────────────────────────────────────────────────────────────────────
  tryHandleCanvasMousedown(e) {
    if (e.button !== 0) return false;
    if (!this._begin(e.clientX, e.clientY, this._isCoarse() ? 'coarse' : 'fine', 'mouse')) return false;
    e.preventDefault?.();
    return true;
  }
  tryHandleWindowMousemove(e) { return this._drag?.src === 'mouse' ? this._move(e.clientX, e.clientY) : false; }
  handleWindowMouseup() { return this._drag?.src === 'mouse' ? this._end() : false; }
  tryHandleTouchstart(touch) { return this._begin(touch.clientX, touch.clientY, 'coarse', 'touch'); }
  tryHandleTouchmove(touch) { return this._drag?.src === 'touch' ? this._move(touch.clientX, touch.clientY) : false; }
  handleTouchend() { return this._drag?.src === 'touch' ? this._end() : false; }
  handleKeydown(e) { return e && e.key === 'Escape' ? this.cancel() : false; }
  handleBlur() { return this.cancel(); }

  /** Drop the drag: the ghost goes back to where it was, nothing is written. True when there was one. */
  cancel() {
    const d = this._drag;
    if (!d) return false;
    this._drag = null;
    this._view?.preview?.(d.id, null);
    this._requestRender();
    return true;
  }

  /** The handles' THREE objects in the scene (getSnapshot hides them for a thumbnail / export). */
  sceneObjects() { return this._view?.sceneObjects?.() || []; }

  dispose() { this._drag = null; this._view?.dispose?.(); }

  // ── debug / check accessors (the advisor's CDP check; window.__preview._stlGizmo) ─────────────────────────────────
  /** What a press at (clientX, clientY) would grab: { kind, id } | null (null also when the gizmo is inactive). */
  pickAt(clientX, clientY, coarse = false) {
    if (!this.isActive()) return null;
    const hit = this._pick(clientX, clientY, STL_GIZMO.pickPx[coarse ? 'coarse' : 'fine']);
    return hit ? { kind: hit.kind, id: hit.id } : null;
  }

  /** Client-pixel points to press for each handle of the active ghost: { id, body, z } (body: null if none found). */
  handleScreenPoints() {
    const g = this.isActive() ? this.activeGhost() : null;
    if (!g || !this._view?.handleScreen) return null;
    const s = this._view.handleScreen(g);
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let body = null;
    for (const p of this._view.bodyCandidates?.(g.id) || []) {
      const hit = this.pickAt(p[0], p[1], true);
      if (hit && hit.kind === 'body' && hit.id === g.id) { body = p; break; }
    }
    return { id: g.id, body, z: mid(s.z[0], s.z[1]) };
  }

  // ── private ──────────────────────────────────────────────────────────────────────────────────────────────────────
  _defaultPick(cx, cy, tolPx) {
    const g = this.activeGhost();
    if (g) {
      const s = this._view.handleScreen(g);
      const kind = s && pickHandle([cx, cy], s, tolPx);
      if (kind) return { kind, id: g.id };
    }
    const b = this._view.pickBody(cx, cy);
    return b ? { kind: 'body', id: b.id, point: b.point } : null;
  }

  _begin(cx, cy, tolKind, src) {
    if (this._drag || !this.isActive()) return false;
    const hit = this._pick(cx, cy, STL_GIZMO.pickPx[tolKind]);
    if (!hit) return false;
    const g = this._ghosts.find((x) => x.id === hit.id);
    if (!g) return false;
    const ray = this._ray(cx, cy);
    if (!ray) return false;
    const pivot = [g.place.x, g.place.y];
    const d = { kind: hit.kind, id: g.id, src, start: g.place, pivot, ray0: ray, delta: null, xf: null,
      x0: cx, y0: cy, slop: STL_GIZMO.slopPx[tolKind], armed: false };
    if (hit.kind === 'body') {
      d.grabZ = hit.point ? hit.point[2] : g.place.baseZ;
      if (!xyDelta(ray, ray, d.grabZ)) return false;
    } else if (hit.kind === 'z') {
      if (zDelta(ray, ray, pivot) === null) return false;
    } else return false; // no other handle (no ring since Fred 2026-11-22)
    if (g.id !== this._handlers.activeId?.()) this._handlers.pick?.(g.id); // a press on another STL's ghost makes it the active one
    this._drag = d;
    this._requestRender();
    return true;
  }

  _move(cx, cy) {
    const d = this._drag;
    if (!d) return false;
    if (!d.armed) { // a wobble inside slopPx: still this drag's event (no orbit), but nothing moves
      if (Math.hypot(cx - d.x0, cy - d.y0) < d.slop) return true;
      d.armed = true;
    }
    const ray = this._ray(cx, cy);
    if (!ray) return true;
    let delta = null;
    if (d.kind === 'body') delta = xyDelta(d.ray0, ray, d.grabZ);
    else if (d.kind === 'z') delta = zDelta(d.ray0, ray, d.pivot);
    if (delta === null) return true; // a ray parallel to the drag plane: keep the last position
    d.delta = delta;
    d.xf = previewTransform(d.kind, delta);
    this._view?.preview?.(d.id, d.xf);
    this._requestRender();
    return true;
  }

  _end() {
    const d = this._drag;
    if (!d) return false;
    this._drag = null;
    const values = commitValues(d.kind, d.start, d.delta);
    if (!values) { this._view?.preview?.(d.id, null); this._requestRender(); return true; }
    this.lastCommit = { id: d.id, values };
    // written: the ghost stays where it was dropped until the rebuild replaces it (no jump back and forth)
    if (!this._handlers?.commit?.(d.id, values)) this._view?.preview?.(d.id, null);
    this._requestRender();
    return true;
  }
}

// ── the THREE side ──────────────────────────────────────────────────────────────────────────────────────────────────

export class StlGizmoThreeView {
  constructor({ THREE, scene, camera, canvas, table = STL_GIZMO }) {
    this._THREE = THREE;
    this._scene = scene;
    this._camera = camera;
    this._canvas = canvas;
    this._T = table;
    this._meshes = [];
    this._lines = [];
    this._group = null;
    this._groupId = null;
    this._xf = null;            // { id, xf } the drag shown right now
    this._raycaster = new THREE.Raycaster();
  }

  setObjects(objects) {
    this._meshes = (objects && objects.meshes) || [];
    this._lines = (objects && objects.lines) || [];
    this._xf = null;
  }

  sceneObjects() { return this._group ? [this._group] : []; }

  /** Scene inches per CSS pixel (orthographic: the same at every depth). */
  wpp() {
    const c = this._camera, h = this._canvas.clientHeight || this._canvas.getBoundingClientRect().height || 1;
    return (c.top - c.bottom) / (c.zoom || 1) / h;
  }

  _ndc(cx, cy) {
    const r = this._canvas.getBoundingClientRect();
    return new this._THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  }

  _toClient(p) {
    const v = new this._THREE.Vector3(p[0], p[1], p[2]).project(this._camera);
    const r = this._canvas.getBoundingClientRect();
    return [r.left + (v.x * 0.5 + 0.5) * r.width, r.top + (-v.y * 0.5 + 0.5) * r.height];
  }

  ray(cx, cy) {
    this._raycaster.setFromCamera(this._ndc(cx, cy), this._camera);
    const { origin: o, direction: d } = this._raycaster.ray;
    return { origin: [o.x, o.y, o.z], dir: [d.x, d.y, d.z] };
  }

  pickBody(cx, cy) {
    this._raycaster.setFromCamera(this._ndc(cx, cy), this._camera);
    const hit = this._raycaster.intersectObjects(this._meshes.filter((m) => m.visible), false)[0];
    return hit ? { id: hit.object.userData.stlId, point: [hit.point.x, hit.point.y, hit.point.z] } : null;
  }

  handleScreen(g) {
    const L = handleLayout(g, this.wpp(), this._T);
    return { z: [this._toClient(L.arrow.foot), this._toClient(L.arrow.tip)] };
  }

  /** Screen points of (up to 300) triangle centroids of ghost `id` (handleScreenPoints keeps the first one the raycast confirms). */
  bodyCandidates(id) {
    const m = this._meshes.find((x) => x.userData.stlId === id);
    if (!m) return [];
    const pos = m.geometry.getAttribute('position').array, idx = m.geometry.index.array;
    const nt = idx.length / 3, step = Math.max(1, Math.floor(nt / 300)), out = [];
    for (let t = 0; t < nt; t += step) {
      const c = [0, 1, 2].map((k) => (pos[idx[t * 3] * 3 + k] + pos[idx[t * 3 + 1] * 3 + k] + pos[idx[t * 3 + 2] * 3 + k]) / 3);
      out.push(this._toClient(c));
    }
    return out;
  }

  draw(g, dragKind) {
    const THREE = this._THREE, T = this._T;
    this._clearGroup();
    if (!g) return;
    const L = handleLayout(g, this.wpp(), T);
    const mat = (rgb) => new THREE.MeshBasicMaterial({ color: new THREE.Color(rgb[0], rgb[1], rgb[2]), depthTest: false, transparent: true, opacity: 0.95 });
    const zCol = dragKind === 'z' ? T.colours.drag : T.colours.z;
    const group = new THREE.Group();
    const a = L.arrow;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(a.shaftR, a.shaftR, a.shaftLen, 12), mat(zCol));
    shaft.rotation.x = Math.PI / 2; // the cylinder's axis is +Y: turn it to +Z
    shaft.position.set(a.foot[0], a.foot[1], a.foot[2] + a.shaftLen / 2);
    const head = new THREE.Mesh(new THREE.ConeGeometry(a.headR, a.headLen, 16), mat(zCol));
    head.rotation.x = Math.PI / 2;
    head.position.set(a.foot[0], a.foot[1], a.foot[2] + a.shaftLen + a.headLen / 2);
    shaft.userData.stlHandle = head.userData.stlHandle = 'z';
    for (const m of [shaft, head]) { m.renderOrder = T.renderOrder; group.add(m); }
    this._group = group;
    this._groupId = g.id;
    this._scene.add(group);
    if (this._xf && this._xf.id === g.id) this._applyXf(group, this._xf.xf);
  }

  preview(id, xf) {
    this._xf = xf ? { id, xf } : null;
    const mesh = this._meshes.find((m) => m.userData.stlId === id);
    if (mesh) this._applyXf(mesh, xf);
    // the meet line is where the ghost met the surface BEFORE the drag: hidden while dragging, back on cancel (a commit's
    // rebuild draws the new one)
    for (const l of this._lines) if (l.userData.stlId === id) l.visible = !xf;
    if (this._group && this._groupId === id) this._applyXf(this._group, xf);
  }

  _applyXf(obj, xf) {
    if (xf) { obj.position.set(xf.position[0], xf.position[1], xf.position[2]); obj.rotation.set(0, 0, xf.rotationZ); }
    else { obj.position.set(0, 0, 0); obj.rotation.set(0, 0, 0); }
  }

  _clearGroup() {
    if (!this._group) return;
    this._scene.remove(this._group);
    for (const c of this._group.children) { c.geometry.dispose(); c.material.dispose(); }
    this._group = null;
    this._groupId = null;
  }

  dispose() { this._clearGroup(); this._meshes = []; this._lines = []; }
}

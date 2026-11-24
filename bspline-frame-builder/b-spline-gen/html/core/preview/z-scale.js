/**
 * Z scale -- a vertical inch ruler beside the model, shown ONLY in the four exact side views (Front / Back /
 * Left / Right). A display rule, not a guard: orbit off the exact view (or go iso / top / bottom) and it hides.
 *
 * Scene axes: X right, Y away, Z up. The camera looks along its world direction; a side view is that direction
 * lying along +-X or +-Y with no vertical part. `screenRight` is the scene direction that points to the right of
 * the screen in that view, so the ruler stands at X 0 / Y 0 and is drawn ON TOP of the model (depthTest off, high renderOrder); its ticks and
 * labels lie on the screen-left of the line.
 */

/** How far off an exact side view the camera may be and still count as it (degrees). */
export const SIDE_VIEW_TOLERANCE_DEG = 0.5;

/**
 * The four exact side views. `dir` = camera view direction (world); `rot` = Z rotation taking the ruler's local
 * +X (screen right) onto the scene direction that is screen-right in that view; `origin` = where the ruler
 * stands: the grid's zero (X 0, Y 0), through the middle of the model, so it is drawn on top.
 */
export const SIDE_VIEWS = {
  front: { dir: [0, 1, 0],  rot: 0,             origin: [0, 0] },
  back:  { dir: [0, -1, 0], rot: Math.PI,       origin: [0, 0] },
  right: { dir: [-1, 0, 0], rot: Math.PI / 2,   origin: [0, 0] },
  left:  { dir: [1, 0, 0],  rot: -Math.PI / 2,  origin: [0, 0] },
};

/** Draw order of the ruler's line, ticks and labels: after everything else. */
export const Z_SCALE_RENDER_ORDER = 1000;

/** Tick step by the ruler's span (inches): the first row whose upTo is >= span. A number goes on every `labelEvery`-th
 *  tick, so two labels are never closer than ~0.2" (the label is ~0.17" tall in the scene). */
export const Z_STEPS = [
  { upTo: 1,        step: 0.1,  labelEvery: 2 },
  { upTo: 2.5,      step: 0.25, labelEvery: 2 },
  { upTo: 5,        step: 0.5,  labelEvery: 1 },
  { upTo: Infinity, step: 1,    labelEvery: 1 },
];

/** The camera's world view direction from its quaternion {x,y,z,w} (the camera looks down its local -Z). */
export function viewDirOf(q) {
  return { x: -2 * (q.x * q.z + q.w * q.y), y: -2 * (q.y * q.z - q.w * q.x), z: -(1 - 2 * (q.x * q.x + q.y * q.y)) };
}

/** @param {{x:number,y:number,z:number}} d camera view direction (need not be unit)
 *  @returns {'front'|'back'|'left'|'right'|null} */
export function exactSideView(d) {
  if (!d) return null;
  const len = Math.hypot(d.x, d.y, d.z);
  if (!(len > 0)) return null;
  const cosTol = Math.cos(SIDE_VIEW_TOLERANCE_DEG * Math.PI / 180);
  for (const [name, v] of Object.entries(SIDE_VIEWS)) {
    if ((d.x * v.dir[0] + d.y * v.dir[1] + d.z * v.dir[2]) / len >= cosTol) return name;
  }
  return null;
}

export function zStepFor(span) {
  return Z_STEPS.find(r => span <= r.upTo).step;
}

/** The ticks that carry a number: every labelEvery-th multiple of the step (0 is always one). */
export function zLabelled(minZ, maxZ) {
  const lo = Math.min(minZ, 0), hi = Math.max(maxZ, 0);
  const row = Z_STEPS.find(r => hi - lo <= r.upTo);
  return zTicks(minZ, maxZ).filter(t => Math.abs(Math.round(t / row.step)) % row.labelEvery === 0);
}

/** Tick values (inches) covering [min,max] and always 0. */
export function zTicks(minZ, maxZ) {
  const lo = Math.min(minZ, 0), hi = Math.max(maxZ, 0);
  const step = zStepFor(hi - lo);
  const out = [];
  for (let k = Math.ceil(lo / step - 1e-9); k <= Math.floor(hi / step + 1e-9); k++) out.push(Math.round(k * step * 1e4) / 1e4 + 0);
  return out;
}

export const zLabel = v => String(Number(v.toFixed(3)));

export class ZScale {
  /** @param makeSprite (text) => THREE.Sprite  -- the ground grid's axis-number sprite, so the look is the same */
  constructor(THREE, scene, makeSprite) {
    this._THREE = THREE; this._makeSprite = makeSprite;
    this._group = new THREE.Group();
    this._group.visible = false;
    scene.add(this._group);
    this._W = 0; this._H = 0; this._min = 0; this._max = 0; this._built = null;
  }

  get group() { return this._group; }

  /** The board's size and Z extent (call on every rebuild); rebuilds the ruler only when they change. */
  setExtent(W, H, minZ, maxZ) {
    this._W = W; this._H = H; this._min = minZ; this._max = maxZ;
    const key = `${minZ}|${maxZ}`;
    if (this._built === key) return;
    this._built = key;
    this._clear();
    const THREE = this._THREE;
    const ticks = zTicks(minZ, maxZ);
    const lo = Math.min(minZ, 0), hi = Math.max(maxZ, 0);
    const X = 0; // the ruler line at the origin; ticks + labels go to local -X = screen left
    const v = [X, 0, lo, X, 0, hi];
    for (const t of ticks) v.push(X - 0.15, 0, t, X, 0, t);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    this._group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x7a7a7a, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false })));
    for (const t of zLabelled(minZ, maxZ)) {
      const s = this._makeSprite(zLabel(t));
      s.position.set(X - 0.5, 0, t);
      s.scale.set(0.6, 0.3, 1);
      this._group.add(s);
    }
    for (const c of this._group.children) c.renderOrder = Z_SCALE_RENDER_ORDER; // on top of the model
  }

  /** Show for an exact side view (and place the ruler for it), hide otherwise. @returns the view name or null */
  setView(dir) {
    const name = exactSideView(dir);
    const g = this._group;
    g.visible = !!name && this._built !== null;
    if (name) {
      const sv = SIDE_VIEWS[name];
      const [cx, cy] = sv.origin;
      g.position.set(cx, cy, 0);
      g.rotation.z = sv.rot;
    }
    return name;
  }

  dispose() {
    this._clear();
    if (this._group.parent) this._group.parent.remove(this._group);
  }

  _clear() {
    const g = this._group;
    while (g.children.length) {
      const c = g.children[0];
      c.geometry?.dispose?.();
      if (c.material) { c.material.map?.dispose?.(); c.material.dispose?.(); }
      g.remove(c);
    }
  }
}

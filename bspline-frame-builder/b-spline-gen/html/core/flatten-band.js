/**
 * core/flatten-band.js -- the FLATTEN BAND (Fred 2026-11-25): a flat strip that follows the wood frame's OUTLINE loop (the
 * frame template's outer cut profile -- editor/editor-frame-profile.js frameCutProfile, the one outline source; the board
 * rectangle with no frame) and feathers back into the terrain on BOTH sides of it (inside and outside).
 *
 * Pure and resolution-independent: the outline is a list of line / arc primitives in board inches (the editor's frame:
 * origin top-left, y down); outlineField() is its exact SIGNED DISTANCE (inches, negative inside, positive outside), read at
 * each heightmap point -- two grids agree wherever they share a point. bandWeightGrid() caches one grid's weights per
 * outline / band geometry / grid (like the terrain fit's memo), so a slider tick on any other setting reuses them.
 *
 * The profile across the loop (d = the signed distance):
 *   |d| <= width / 2                 -> 1 (the flat)
 *   inside,  width/2 .. + innerFeather -> 1 - smoothstep (the feather into the terrain), outside the same with outerFeather
 *   beyond                           -> 0 (the terrain untouched, to the bit)
 * core/terrain.js generateHeightmap applies the weight w at each point, AFTER the terrain fit (the fit's range is measured
 * on the band-free terrain, so the band never rescales the board outside it):
 *   TEXTURE: the fine grain is flattened toward neutral by w (w = 1 = Texture Strength 0 at that point);
 *   SHAPE:   the height is blended by w toward the band's flat -- exactly what 'Flat (no hills)' builds with the surface
 *            height = the band's Flat height: bandHeight + the grain at its valley amplitude (none where TEXTURE is
 *            flattened too). Both = exactly the Flat height on the loop.
 * P keys (core/state.js; absent on every board saved before = the band off = the heights bit for bit as before):
 *   bandEnabled, bandAppliesTo ('shape' | 'texture' | 'both'), bandWidthIn, bandInnerFeatherIn, bandOuterFeatherIn,
 *   bandHeightIn (null = the board's fill floor -- the terrain's own lowest level -- until the user sets a value).
 */
import { distToPrimitive, arcPointAtFraction } from '../editor/editor-primitives.js';
import { polygonPointTester } from './bricks/geometry.js';

/** 'Applies to' (the band panel's segmented choice): which part of the terrain the band flattens. */
export const BAND_APPLIES_TO = Object.freeze({
  shape: Object.freeze({ label: 'Shape', shape: true, texture: false }),
  texture: Object.freeze({ label: 'Texture', shape: false, texture: true }),
  both: Object.freeze({ label: 'Both', shape: true, texture: true }),
});
export const BAND_APPLIES_DEFAULT = 'both';

/** The arc chord used for the inside / outside test only (the distance itself is exact): <= this long (inches). */
export const BAND_SIGN_CHORD_IN = 0.02;

/** Is the band on for these heightmap params (the caller resolved the outline into params.bandOutline)? */
export const bandActive = (params) => !!params && params.bandEnabled === true && Array.isArray(params.bandOutline) && params.bandOutline.length > 0;

/** The band's flat height (inches from the stock bottom): the user's value, else the fill floor the heightmap was handed. */
export function bandLevelIn(params) {
  const v = params ? params.bandHeightIn : null;
  if (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) return Number(v);
  return Number(params && params.terrainFloorIn) || 0;
}

/** The board rectangle as an outline (no frame): editor frame, clockwise on screen. */
export function rectOutline(widthIn, heightIn) {
  const W = widthIn, H = heightIn;
  return [
    { type: 'L', p0: { x: 0, y: 0 }, p1: { x: W, y: 0 } },
    { type: 'L', p0: { x: W, y: 0 }, p1: { x: W, y: H } },
    { type: 'L', p0: { x: W, y: H }, p1: { x: 0, y: H } },
    { type: 'L', p0: { x: 0, y: H }, p1: { x: 0, y: 0 } },
  ];
}

const _primBox = (p) => {
  if (p.type === 'L') return [Math.min(p.p0.x, p.p1.x), Math.min(p.p0.y, p.p1.y), Math.max(p.p0.x, p.p1.x), Math.max(p.p0.y, p.p1.y)];
  const r = Math.max(p.rx, p.ry ?? p.rx); // the arc's whole circle: a safe box
  return [p.cx - r, p.cy - r, p.cx + r, p.cy + r];
};

let _fieldMemo = null; // { key, field }
/** The outline's signed distance field: { at(x, y), within(x, y, reach) }. `at` = exact distance to the nearest primitive,
 *  negative inside the loop. `within` = the same, or +Infinity when the point is farther than `reach` from every primitive
 *  (a box test first: the grid's far points cost no distance at all). Memoised on the outline. */
export function outlineField(primitives) {
  const key = JSON.stringify(primitives);
  if (_fieldMemo && _fieldMemo.key === key) return _fieldMemo.field;
  const poly = [];
  for (const p of primitives) {
    if (p.type === 'L') { poly.push({ x: p.p0.x, y: p.p0.y }); continue; }
    const len = Math.abs(p.dTheta) * Math.max(p.rx, p.ry ?? p.rx);
    const steps = Math.max(8, Math.min(512, Math.ceil(len / BAND_SIGN_CHORD_IN)));
    for (let k = 0; k < steps; k++) poly.push(arcPointAtFraction(p, k / steps));
  }
  const inside = polygonPointTester(poly);
  const boxes = primitives.map(_primBox);
  const pt = { x: 0, y: 0 };
  const dist = (x, y, reach) => {
    pt.x = x; pt.y = y;
    let d = Infinity;
    for (let i = 0; i < primitives.length; i++) {
      const b = boxes[i];
      if (x < b[0] - reach || x > b[2] + reach || y < b[1] - reach || y > b[3] + reach) continue;
      const di = distToPrimitive(pt, primitives[i]);
      if (di < d) d = di;
    }
    return d;
  };
  const field = {
    at: (x, y) => { const d = dist(x, y, Infinity); return inside(x, y) ? -d : d; },
    within: (x, y, reach) => { const d = dist(x, y, reach); if (!(d <= reach)) return Infinity; return inside(x, y) ? -d : d; },
  };
  _fieldMemo = { key, field };
  return field;
}

/** The band's geometry from params (inches; a negative / missing value reads 0). */
export function bandGeometry(params) {
  const n = (v) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : 0; };
  return { half: n(params.bandWidthIn) / 2, inner: n(params.bandInnerFeatherIn), outer: n(params.bandOuterFeatherIn) };
}

/** The band's weight (0..1) at signed distance `d` (inches) from the outline. */
export function bandWeightAt(d, g) {
  if (!Number.isFinite(d)) return 0;
  const a = Math.abs(d);
  if (a <= g.half) return 1;
  const f = d < 0 ? g.inner : g.outer;
  if (!(f > 0)) return 0;
  const t = (a - g.half) / f;
  if (t >= 1) return 0;
  return 1 - t * t * (3 - 2 * t); // smoothstep, the Flat Border's own feather shape
}

const _gridMemo = []; // [{ key, w }], the last few grids (the preview, the editor backdrop, the Send grid)
const GRID_MEMO_SIZE = 4;
/** Per grid point (k = j * nx + i, u = i / (nx - 1), editor y = H * (1 - j / (nz - 1)) -- the height grid's own layout,
 *  core/bricks/mask-edge.js), the band's weight; null when the band is off or touches no point. Memoised. */
export function bandWeightGrid(params, nx, nz) {
  if (!bandActive(params) || !(nx > 1) || !(nz > 1)) return null;
  const W = Number(params.widthIn) || 9, H = Number(params.heightIn) || 7;
  const g = bandGeometry(params);
  const key = JSON.stringify([params.bandOutline, g, W, H, nx, nz]);
  const hit = _gridMemo.find((m) => m.key === key);
  if (hit) return hit.w;
  const field = outlineField(params.bandOutline);
  const reach = g.half + Math.max(g.inner, g.outer);
  const w = new Float32Array(nx * nz);
  let any = false;
  for (let j = 0; j < nz; j++) {
    const y = H * (1 - j / (nz - 1));
    for (let i = 0; i < nx; i++) {
      const x = (i / (nx - 1)) * W;
      const wk = bandWeightAt(field.within(x, y, reach), g);
      if (wk > 0) { w[j * nx + i] = wk; any = true; }
    }
  }
  const out = any ? w : null;
  _gridMemo.unshift({ key, w: out });
  if (_gridMemo.length > GRID_MEMO_SIZE) _gridMemo.pop();
  return out;
}

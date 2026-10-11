/**
 * main/photo-footprint.js — 2026-10-10 (Fred's picks, via the advisor): the photo's FOOTPRINT on the editor's board while
 * the editor's Photo tab is open. Drag inside it to move, a corner to scale, the knob to rotate (snapping to the declared
 * angles within PHOTO_GIZMO.snapDeg). It writes the photo's placement tweaks (P.filterTweaks.photo scale / offsetX /
 * offsetY / rotation: the values Surface > Photo's Placement rows show). A drag's ticks move only the outline; its
 * release is ONE editor undo step and one repaint (main/photo-panel.js commitPhotoPlacement).
 *
 * The footprint is the sampler's own mapping inverted, never a copy of it (core/noise/photo.js photoSampleOf,
 * core/terrain.js unfoldUV / photoSampleAspect / photoMirrors). Under Symmetry the SOURCE copy carries the handles,
 * clipped at the axis; each mirror copy is a dotted ghost clipped to its own side; the axis is drawn; the part of the image
 * past the axis (not sampled) is a faint grey outline. It is drawn in full past the board edge (Fred: "sample is still
 * visible even outside board"): only the carve is limited to the board.
 */
import { P } from '../core/state.js';
import { getProcessedPhotoImage } from '../core/photo/state.js';
import { photoSampleOf, tweaks as PHOTO_TWEAKS } from '../core/noise/photo.js';
import { foldSpecOf, unfoldUV, photoSampleAspect, photoMirrors } from '../core/terrain.js';
import { getEditorTab } from './editor-tabs.js';
import { isFittedView } from '../editor/editor-view.js';
import { clearSnapCursor, clearGridHover } from '../editor/editor-grid.js';

/** The tweaks the footprint edits (one editor undo step carries them: photo-panel.js photoUndoState). */
export const PLACEMENT_KEYS = Object.freeze(['scale', 'offsetX', 'offsetY', 'rotation']);

export const PHOTO_GIZMO = Object.freeze({
  snapDeg: 3, // a rotation within this many degrees of a snapTo angle lands on it (Fred: yes, 3 degrees)
  snapTo: Object.freeze([-90, 0, 90, 180]),
  handlePx: Object.freeze({ fine: 14, coarse: 28 }), // a corner handle's side, CSS px (>= 28 for a finger)
  knobPx: 30, // the rotate knob's distance past the image's top edge, CSS px
  stroke: '#ff7a1a', halo: '#000', ghost: '#ff7a1a', hidden: '#888', axis: '#2b6cb0',
});

const IMAGE_CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]]; // fractions of the (cropped) image: top-left, clockwise
const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const tweakRange = (key) => { const s = PHOTO_TWEAKS.find((t) => t.key === key); return [s.min, s.max]; };

/** Pure: where photo `img`, placed by `tweaks`, lands on board `state` (P's shape), in editor coordinates (inches, y down:
 *  x = u * widthIn, y = (1 - v) * heightIn, core/coords.js). `copies[0]` is the source copy; every copy's `pts` are the
 *  image's 4 corners (top-left, clockwise). `centre` / `top`: the image's centre and top-edge middle on the source copy.
 *  `axisX` / `axisY`: the mirror axes (null when that axis is not folded). */
export function photoFootprint(state, tweaks, img) {
  const st = { ...state }; // the fold / sample-aspect constants are cached per params object: a fresh one per call
  const W = st.widthIn, H = st.heightIn;
  const params = { ...st, tweaks: tweaks || {} };
  const aspect = photoSampleAspect(st, W / H), mirror = photoMirrors(st), f = foldSpecOf(st);
  const at = (iu, iv, sx = 1, sy = 1) => {
    const s = photoSampleOf(iu, iv, aspect, params, img);
    const b = unfoldUV(s.su, s.sv, st, sx, sy, mirror);
    return [b.u * W, (1 - b.v) * H];
  };
  const copies = [];
  for (const sx of f.fx ? [1, -1] : [1]) for (const sy of f.fy ? [1, -1] : [1]) {
    copies.push({ sx, sy, source: sx === 1 && sy === 1, pts: IMAGE_CORNERS.map(([iu, iv]) => at(iu, iv, sx, sy)) });
  }
  const ax = unfoldUV(0, 0, st, 1, 1, false); // a folded sample coordinate of 0 is the axis
  return { copies, centre: at(0.5, 0.5), top: at(0.5, 0), axisX: f.fx ? ax.u * W : null, axisY: f.fy ? (1 - ax.v) * H : null };
}

/** Pure: a rotation (degrees) on a snapTo angle when within snapDeg of it, else wrapped into -180..180. */
export function snapRotation(deg, g = PHOTO_GIZMO) {
  const d = wrap180(deg);
  for (const a of g.snapTo) if (Math.abs(wrap180(d - a)) <= g.snapDeg) return a;
  return d;
}

/** Pure: the offsets that put the footprint's centre at `target` (editor coordinates), the other tweaks unchanged. The
 *  centre is affine in the offsets, so one 2 x 2 solve is exact. */
export function offsetsForCentre(state, tweaks, img, target) {
  const t = { ...tweaks, offsetX: tweaks.offsetX ?? 0, offsetY: tweaks.offsetY ?? 0 };
  const c = (dx, dy) => photoFootprint(state, { ...t, offsetX: t.offsetX + dx, offsetY: t.offsetY + dy }, img).centre;
  const c0 = c(0, 0), cx = c(1, 0), cy = c(0, 1);
  const a = cx[0] - c0[0], b = cy[0] - c0[0], cc = cx[1] - c0[1], d = cy[1] - c0[1];
  const det = a * d - b * cc, ex = target[0] - c0[0], ey = target[1] - c0[1];
  return { offsetX: t.offsetX + (d * ex - b * ey) / det, offsetY: t.offsetY + (a * ey - cc * ex) / det };
}

/** Pure: +1 when a larger rotation tweak turns the footprint clockwise on screen, else -1 (it depends on the photo's
 *  orientation and the mirror copy, so it is measured, not assumed). */
function screenTurnSign(state, tweaks, img) {
  const ang = (r) => { const fp = photoFootprint(state, { ...tweaks, rotation: r }, img); return Math.atan2(fp.top[1] - fp.centre[1], fp.top[0] - fp.centre[0]) * 180 / Math.PI; };
  const r = tweaks.rotation ?? 0;
  return wrap180(ang(r + 1) - ang(r)) >= 0 ? 1 : -1; // screen y is down: a growing atan2 angle turns clockwise
}

/** Pure: the placement after dragging `part` -- 'move' (inside), 'corner' (scale about the centre) or 'rotate' (the
 *  knob, about the centre, snapped) -- from editor point `p0` to `p`, starting from tweaks `t0`. Scale stays in the photo's
 *  declared Scale range (the slider's); the centre stays put for a scale or a rotation. */
export function dragPlacement(state, t0, img, part, p0, p) {
  const C = photoFootprint(state, t0, img).centre;
  if (part === 'move') return { ...t0, ...offsetsForCentre(state, t0, img, [C[0] + p[0] - p0[0], C[1] + p[1] - p0[1]]) };
  const t = { ...t0 };
  if (part === 'corner') {
    const r0 = Math.hypot(p0[0] - C[0], p0[1] - C[1]), r = Math.hypot(p[0] - C[0], p[1] - C[1]);
    const [lo, hi] = tweakRange('scale');
    if (r0 > 0) t.scale = Math.max(lo, Math.min(hi, (t0.scale ?? 1) * r / r0));
  } else if (part === 'rotate') {
    const turned = (Math.atan2(p[1] - C[1], p[0] - C[0]) - Math.atan2(p0[1] - C[1], p0[0] - C[0])) * 180 / Math.PI;
    t.rotation = snapRotation((t0.rotation ?? 0) + screenTurnSign(state, t0, img) * wrap180(turned));
  }
  return { ...t, ...offsetsForCentre(state, t, img, C) };
}

// ---- the overlay (DOM) ----------------------------------------------------------------------------------------------

const NS = 'http://www.w3.org/2000/svg';
let _g = null;
let _drag = null; // { part, p0, t0, t, img }
let _commit = null;

const placementOf = () => {
  const t = (P.filterTweaks && P.filterTweaks.photo) || {};
  return Object.fromEntries(PLACEMENT_KEYS.filter((k) => t[k] !== undefined).map((k) => [k, t[k]]));
};
const editor = () => (typeof window !== 'undefined' ? window.svgEditor : null);
const handlePx = () => PHOTO_GIZMO.handlePx[typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine'];

/** The image the footprint is for: the photo layer's processed photo, while the editor's Photo tab shows. */
function shownImage() {
  if (getEditorTab() !== 'photo' || !P.photoLayer || !P.photoImageDataUrl) return null;
  return getProcessedPhotoImage({ ...P, tweaks: (P.filterTweaks && P.filterTweaks.photo) || {} });
}

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent.appendChild(e);
  return e;
}

function modelPoint(e) {
  const svg = _g && _g.ownerSVGElement;
  const ctm = _g && _g.getScreenCTM && _g.getScreenCTM();
  if (!svg || !ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const m = pt.matrixTransform(ctm.inverse());
  return [m.x, m.y];
}

function draw(fp) {
  while (_g.firstChild) _g.removeChild(_g.firstChild);
  const ctm = _g.getScreenCTM && _g.getScreenCTM();
  const px = ctm && ctm.a ? 1 / Math.abs(ctm.a) : 0.01; // one CSS px in inches
  const G = PHOTO_GIZMO, BIG = 1000;
  const pts = (p) => p.map((q) => q.join(',')).join(' ');
  // the side of the axis a copy shows on (+1 = the source side: right of a vertical axis, above a horizontal one)
  const side = (c) => ({
    x: fp.axisX == null ? -BIG : (c.sx === 1 ? fp.axisX : -BIG), y: fp.axisY == null ? -BIG : (c.sy === 1 ? -BIG : fp.axisY),
    x1: fp.axisX == null ? BIG : (c.sx === 1 ? BIG : fp.axisX), y1: fp.axisY == null ? BIG : (c.sy === 1 ? fp.axisY : BIG),
  });
  const defs = el('defs', {}, _g);
  fp.copies.forEach((c, k) => {
    const r = side(c), cp = el('clipPath', { id: `photoFootprintClip${k}` }, defs);
    el('rect', { x: r.x, y: r.y, width: r.x1 - r.x, height: r.y1 - r.y }, cp);
    c.clip = `url(#photoFootprintClip${k})`;
  });
  const src = fp.copies[0], folded = fp.axisX != null || fp.axisY != null;
  if (folded) el('polygon', { points: pts(src.pts), fill: 'none', stroke: G.hidden, 'stroke-opacity': 0.6, 'stroke-width': px, 'stroke-dasharray': `${2 * px} ${3 * px}`, 'pointer-events': 'none' }, _g);
  for (const c of fp.copies.slice(1)) {
    el('polygon', { points: pts(c.pts), 'clip-path': c.clip, fill: 'none', stroke: G.ghost, 'stroke-opacity': 0.7, 'stroke-width': 1.5 * px, 'stroke-dasharray': `${2 * px} ${4 * px}`, 'pointer-events': 'none' }, _g);
  }
  el('polygon', { points: pts(src.pts), 'clip-path': folded ? src.clip : 'none', fill: 'none', stroke: G.halo, 'stroke-opacity': 0.55, 'stroke-width': 4 * px, 'pointer-events': 'none' }, _g);
  el('polygon', { points: pts(src.pts), 'clip-path': folded ? src.clip : 'none', fill: 'rgba(255,122,26,0.08)', stroke: G.stroke, 'stroke-width': 2 * px, 'data-part': 'move', style: 'cursor:move' }, _g);
  if (fp.axisX != null) el('line', { x1: fp.axisX, y1: -BIG, x2: fp.axisX, y2: BIG, stroke: G.axis, 'stroke-width': 1.5 * px, 'stroke-dasharray': `${8 * px} ${4 * px}`, 'pointer-events': 'none' }, _g);
  if (fp.axisY != null) el('line', { x1: -BIG, y1: fp.axisY, x2: BIG, y2: fp.axisY, stroke: G.axis, 'stroke-width': 1.5 * px, 'stroke-dasharray': `${8 * px} ${4 * px}`, 'pointer-events': 'none' }, _g);
  const [cx, cy] = fp.centre, [tx, ty] = fp.top;
  const len = Math.hypot(tx - cx, ty - cy) || 1, kx = tx + (tx - cx) / len * G.knobPx * px, ky = ty + (ty - cy) / len * G.knobPx * px;
  const h = handlePx() * px;
  el('line', { x1: tx, y1: ty, x2: kx, y2: ky, stroke: G.stroke, 'stroke-width': 2 * px, 'pointer-events': 'none' }, _g);
  el('circle', { cx: kx, cy: ky, r: h / 2, fill: '#fff', stroke: G.stroke, 'stroke-width': 2 * px, 'data-part': 'rotate', style: 'cursor:grab' }, _g);
  src.pts.forEach(([x, y], k) => el('rect', {
    x: x - h / 2, y: y - h / 2, width: h, height: h, rx: h / 7, fill: '#fff', stroke: G.stroke, 'stroke-width': 2 * px,
    'data-part': 'corner', style: `cursor:${k % 2 ? 'nesw' : 'nwse'}-resize`,
  }, _g));
  el('path', { d: `M ${cx - h / 3} ${cy} H ${cx + h / 3} M ${cx} ${cy - h / 3} V ${cy + h / 3}`, stroke: G.stroke, 'stroke-width': 2 * px, 'pointer-events': 'none' }, _g);
}

/** Pure: what Fit must also show on the Photo tab -- the source copy in full (its handles) plus the rotate knob's reach. */
export function fitRegionOf(fp) {
  const xs = fp.copies[0].pts.map((q) => q[0]), ys = fp.copies[0].pts.map((q) => q[1]);
  const pad = 0.1 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
}

/** Show / hide / redraw the footprint from the state (a photo change, a tab change, the board or the view changed). */
export function syncPhotoFootprint() {
  const ed = editor();
  const host = ed && ed._sketchLayer && ed._sketchLayer.node && ed._sketchLayer.node.parentNode;
  const img = host ? shownImage() : null;
  // the footprint appearing / going (the Photo tab entered or left, the photo loaded or cleared): a view still at Fit
  // re-fits, to hold it (or the board again); a view the user zoomed or panned is left alone. A drag never re-fits (the
  // view would jump under the finger).
  const refit = !!ed && !!ed._draw && !!ed._fitExtraRegion !== !!img && isFittedView(ed);
  if (ed) ed._fitExtraRegion = img ? fitRegionOf(photoFootprint(P, placementOf(), img)) : null;
  if (refit && typeof ed.fitView === 'function') ed.fitView(); // its editorViewChanged redraws the footprint
  if (!img) { if (_g) _g.style.display = 'none'; return; }
  if (!_g || _g.parentNode !== host) {
    if (_g) _g.remove();
    _g = document.createElementNS(NS, 'g');
    _g.id = 'photoFootprint';
    _g.style.touchAction = 'none';
    _g.addEventListener('pointerdown', onDown);
    _g.addEventListener('pointermove', onMove);
    _g.addEventListener('pointerup', onUp);
    _g.addEventListener('pointercancel', onUp);
  }
  if (_g.parentNode !== host || host.lastChild !== _g) host.appendChild(_g); // on top of the drawing
  _g.style.display = '';
  draw(photoFootprint(P, _drag ? _drag.t : placementOf(), img));
}

function onDown(e) {
  const part = e.target && e.target.getAttribute && e.target.getAttribute('data-part');
  const p0 = part ? modelPoint(e) : null;
  const img = p0 ? shownImage() : null;
  if (!img) return;
  e.stopPropagation(); e.preventDefault(); // the gizmo's, not the editor's select / marquee
  _g.setPointerCapture(e.pointerId);
  // the editor's hover cursor would stay frozen at the grab point (its moves are the gizmo's now): cleared as on leave
  clearSnapCursor(editor()); clearGridHover(editor());
  const t0 = placementOf();
  _drag = { part, p0, t0, t: t0, img, id: e.pointerId };
}
function onMove(e) {
  if (!_drag || e.pointerId !== _drag.id) return;
  e.stopPropagation();
  const p = modelPoint(e);
  if (!p) return;
  _drag.t = dragPlacement(P, _drag.t0, _drag.img, _drag.part, _drag.p0, p);
  draw(photoFootprint(P, _drag.t, _drag.img)); // the outline only: the backdrop repaints on release
}
function onUp(e) {
  if (!_drag || e.pointerId !== _drag.id) return;
  e.stopPropagation();
  const { t, t0 } = _drag;
  _drag = null;
  const moved = PLACEMENT_KEYS.some((k) => t[k] !== t0[k]);
  if (moved && _commit) _commit(Object.fromEntries(PLACEMENT_KEYS.filter((k) => t[k] !== undefined).map((k) => [k, t[k]])));
  syncPhotoFootprint();
}

/** Wire the footprint (main.js, after the Photo tab): `commit(placement)` writes a drag's result as one step. */
export function initPhotoFootprint({ commit }) {
  _commit = commit;
  for (const ev of ['editorTabChanged', 'editorBoardResized', 'editorViewChanged']) document.addEventListener(ev, () => syncPhotoFootprint());
  syncPhotoFootprint();
}

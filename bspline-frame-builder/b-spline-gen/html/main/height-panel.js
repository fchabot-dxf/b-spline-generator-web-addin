/**
 * main/height-panel.js -- HEIGHT-PAINTER slice 1 (HEIGHT-PAINTER-DESIGN.md): the editor's Height tab. Paint height patches
 * -- placeable rectangles of heights in inches (core/height/layer.js) -- ON the shared editor canvas (the advisor's
 * amendment 2, Fred: "tabs content carry over visually"): each patch is a hill-shaded image in the editor's own coordinate
 * space, in the same group the photo footprint draws in, visible in every tab (faded outside this one). The brush is the
 * editor gesture mode 'heightBrush' (editor/editor-height-tool.js); this module is its `editor._heightTool`.
 *
 * The panel and the rail are RENDERED from one declared table, HEIGHT_CONTROLS (a new setting is one entry). The brush
 * settings are UI state (this session); every patch setting lives in its own record, P.heightLayers[i]. COPY-ON-WRITE like
 * the STL panel: a write builds a new list holding a new record and assigns it to P.heightLayers (the history and the
 * editor's undo part hold the old list by reference). A stroke commits ONCE on release: encode (core/height/raster.js),
 * then the new record, then ONE editor undo step (the 'heightLayers' undo part rides in it) and the session save.
 * Nothing here rewrites a loaded board (AGENTS.md rule 3): a control writes only when the user moves it.
 */
import { P, scheduleSessionSave } from '../core/state.js';
import { scheduleUndoSnapshot } from '../core/history.js';
import { withLoadingStage } from '../core/loading-signal.js';
import { encodeRaster, decodedRaster, ensureRasterDecoded } from '../core/height/raster.js';
import { BRUSH_DEFAULTS, BRUSH_MODES, BRUSH_FALLOFFS, createStroke } from '../core/height/brush.js';
import { newHeightLayer, normaliseHeightLayer, boardToPatchPixel, sampleRaster, HEIGHT_PX_PER_IN } from '../core/height/layer.js';
import { shadeRaster, shadeSize } from '../core/height/shade.js';
import { registerUndoPart } from '../editor/undo-parts.js';
import { commitEdit } from '../editor/editor-commit.js';
import { EDITOR_TAB_FOCUS } from '../editor/editor-frame-profile.js';
import { setEditorTab, getEditorTab } from './editor-tabs.js';

/** The canvas view: the shaded picture's longest side in pixels (display only; the raster keeps its 100 px/in). */
export const HEIGHT_VIEW = Object.freeze({
  maxImagePx: 512,
  outline: '#7a4fd6', ring: '#7a4fd6', halo: '#ffffff',
});

export const HEIGHT_GROUPS = Object.freeze([
  Object.freeze({ id: 'brush', label: 'Brush' }),
  Object.freeze({ id: 'patch', label: 'Patch', note: 'inches from the board centre; +Y is up the screen' }),
  Object.freeze({ id: 'stamp', label: 'Stamp' }),
]);

const MODE_LABELS = Object.freeze({ raise: ['▲', 'Raise', 'Add height'], lower: ['▼', 'Lower', 'Take height away'], set: ['＝', 'Set', 'Move toward the target height'], smooth: ['≈', 'Smooth', 'Blur the heights under the brush'], erase: ['⌫', 'Erase', 'Back to 0 (no effect on the board)'] });

/**
 * Every control, once. target 'brush' = the brush (UI state, key `path[0]`), 'patch' = the ACTIVE patch's record (`path`).
 * kind 'slider' (range + number), 'choice' (segmented buttons) or 'check'. `range(P)` is only the slider's travel, NOT a
 * rule: a typed value outside it is stored as typed (no clamp; AGENTS.md "ask before any clamp").
 */
export const HEIGHT_CONTROLS = Object.freeze([
  { id: 'mode', group: 'brush', target: 'brush', kind: 'choice', path: ['mode'], label: 'Mode', rail: true,
    options: BRUSH_MODES.map((m) => [m, MODE_LABELS[m][1], MODE_LABELS[m][2]]) },
  { id: 'sizeIn', group: 'brush', target: 'brush', kind: 'slider', path: ['sizeIn'], label: 'Size (in)', step: 0.01, range: () => [0.02, 4] },
  { id: 'hardness', group: 'brush', target: 'brush', kind: 'slider', path: ['hardness'], label: 'Hardness', step: 0.01, range: () => [0, 1], note: '1 = a hard edge, 0 = all soft' },
  // Fred 2026-11-22: the shape of the roll-off outside the hard core (core/height/brush.js BRUSH_FALLOFFS)
  { id: 'falloff', group: 'brush', target: 'brush', kind: 'choice', path: ['falloff'], label: 'Falloff',
    options: Object.entries(BRUSH_FALLOFFS).map(([k, p]) => [k, p.label, p.title]) },
  { id: 'opacity', group: 'brush', target: 'brush', kind: 'slider', path: ['opacity'], label: 'Opacity', step: 0.01, range: () => [0, 1], note: 'the most one stroke can do' },
  { id: 'flow', group: 'brush', target: 'brush', kind: 'slider', path: ['flow'], label: 'Flow', step: 0.01, range: () => [0, 1], note: 'how fast a stroke builds up to its opacity' },
  { id: 'spacing', group: 'brush', target: 'brush', kind: 'slider', path: ['spacing'], label: 'Spacing (x size)', step: 0.01, range: () => [0.01, 1] },
  { id: 'amountIn', group: 'brush', target: 'brush', kind: 'slider', path: ['amountIn'], label: 'Amount (in, raise / lower)', step: 0.005, range: () => [0, 1] },
  { id: 'targetIn', group: 'brush', target: 'brush', kind: 'slider', path: ['targetIn'], label: 'Set to height (in)', step: 0.005, range: () => [-1, 1.5],
    note: '0 = transparent (no effect on the board)' },
  { id: 'pressureSize', group: 'brush', target: 'brush', kind: 'check', path: ['pressureSize'], label: 'Pen pressure → size' },
  { id: 'pressureOpacity', group: 'brush', target: 'brush', kind: 'check', path: ['pressureOpacity'], label: 'Pen pressure → opacity' },
  { id: 'posX', group: 'patch', target: 'patch', kind: 'slider', path: ['position', 'x'], label: 'X', step: 0.05, range: (p) => [-p.widthIn, p.widthIn] },
  { id: 'posY', group: 'patch', target: 'patch', kind: 'slider', path: ['position', 'y'], label: 'Y', step: 0.05, range: (p) => [-p.heightIn, p.heightIn] },
  { id: 'rotation', group: 'patch', target: 'patch', kind: 'slider', path: ['rotation'], label: 'Turn (degrees)', step: 1, range: () => [-180, 180] },
  { id: 'sizeW', group: 'patch', target: 'patch', kind: 'slider', path: ['sizeIn', 'w'], label: 'Width (in)', step: 0.05, range: (p) => [0.1, 2 * p.widthIn],
    note: 'a new size stretches the painting' },
  { id: 'sizeH', group: 'patch', target: 'patch', kind: 'slider', path: ['sizeIn', 'h'], label: 'Height (in)', step: 0.05, range: (p) => [0.1, 2 * p.heightIn] },
  { id: 'raise', group: 'stamp', target: 'patch', kind: 'choice', path: ['raise'], label: 'Relief',
    options: [[true, 'Raised', 'The painted heights stand out of the surface'], [false, 'Carved', 'The painted heights are cut into the surface']] },
  { id: 'blend', group: 'stamp', target: 'patch', kind: 'choice', path: ['blend'], label: 'Blend',
    options: [['add', 'Add', 'The painted height is added to the surface'], ['max', 'Max', 'Only what stands above the surface shows; nothing is dug']] },
  { id: 'zOffset', group: 'stamp', target: 'patch', kind: 'slider', path: ['zOffset'], label: 'Z offset (in)', step: 0.005, range: () => [-1, 1],
    note: 'added where the patch is painted' },
  // no "On the terrain" choice: a height patch always follows the terrain, like an SVG layer (Fred 2026-11-22, "No rigid")
  { id: 'placement', group: 'stamp', target: 'patch', kind: 'choice', path: ['placement'], label: 'Thicken',
    options: [['withSurface', 'Before thicken', 'The back follows the patch'], ['afterBack', 'After thicken', 'Top only: the back stays as it is without this patch']] },
]);

// ── state (UI only; the data is P.heightLayers) ─────────────────────────────────────────────────────────────────────
let _active = null;          // the active record's id
let _brush = { ...BRUSH_DEFAULTS };
let _work = null;            // { id, h, cols, rows, data } the active patch's working heights (the painter's own copy)
let _stroke = null;          // { s, id } the stroke being painted
let _pending = 0;            // commits not finished yet (their encode is async)
let _strokeSeq = 0;
let _chain = Promise.resolve();
let _hooks = { onChange: () => {} };
let _hover = null;           // the last pointer point (editor coordinates)

const list = () => (Array.isArray(P.heightLayers) ? P.heightLayers : []);
const find = (id) => list().find((l) => l && l.id === id) || null;
export function activeHeightLayer() { return find(_active) || list()[0] || null; }
const byId = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);
const editor = () => (typeof window !== 'undefined' ? window.svgEditor : null);
const board = () => ({ widthIn: P.widthIn, heightIn: P.heightIn });
const getPath = (obj, path) => path.reduce((o, k) => (o == null ? o : o[k]), obj);
function withPath(rec, path, v) {
  const [k, ...rest] = path;
  if (!rest.length) return { ...rec, [k]: v };
  const inner = rec[k] != null && typeof rec[k] === 'object' ? rec[k] : {};
  return { ...rec, [k]: withPath(inner, rest, v) };
}
function updateRecord(id, change) { P.heightLayers = list().map((r) => (r && r.id === id ? change(r) : r)); }
/** A record as the editor sees it: its size given (an absent one reads as the board's). */
const placed = (rec) => ({ ...normaliseHeightLayer(rec), sizeIn: rec.sizeIn || { w: P.widthIn, h: P.heightIn } });
/** Editor point (inches, y down) -> board point (inches from the centre, +Y up). */
const toBoard = (pt) => [pt.x - P.widthIn / 2, P.heightIn / 2 - pt.y];
const status = (text, isError = false) => {
  const s = byId('heightStatus');
  if (!s) return;
  s.textContent = text || '';
  s.hidden = !text;
  s.classList.toggle('stl-error', !!isError);
};

/** ONE step: the editor's own undo entry (the 'heightLayers' part rides in it) + its persist; outside the editor the
 *  global history. Then the host's onChange (main.js: the rebuild, which waits for the editor to close -- Fred's "no 3D
 *  while editing", core/in-editor-3d.js). */
function commitStep(what) {
  const ed = editor();
  if (ed && typeof ed.pushState === 'function') commitEdit(ed);
  else scheduleUndoSnapshot(`height:${what}`, 'Height');
  scheduleSessionSave();
  _hooks.onChange();
}

// ── the working copy + the stroke ───────────────────────────────────────────────────────────────────────────────────
/** The active patch's working heights (sync), or null while its raster is being decoded (the decode then redraws). */
function workingCopy(rec) {
  if (!rec || !rec.raster) return null;
  if (_work && _work.id === rec.id && (_work.h === rec.raster.h || _pending > 0)) return _work;
  const d = decodedRaster(rec.raster);
  if (!d) {
    ensureRasterDecoded(rec.raster).then(() => syncHeightOverlay(), (e) => status(`Could not read the height patch: ${e && e.message ? e.message : e}`, true));
    return null;
  }
  _work = { id: rec.id, h: rec.raster.h, cols: rec.raster.cols, rows: rec.raster.rows, data: Float32Array.from(d) };
  return _work;
}
const pressureOf = (e) => (e && e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 1); // a mouse reports 0.5 while pressed
function pixelOf(rec, pt) { const [X, Y] = toBoard(pt); return boardToPatchPixel(placed(rec), X, Y); }

function cancelStroke() {
  if (!_stroke) return;
  _stroke.s.cancel();
  _stroke = null;
  syncHeightOverlay();
}
function beginStroke(pt, pressure) {
  cancelStroke(); // a stroke the editor abandoned (a pinch, a tool switch) is put back, never half-committed
  const rec = activeHeightLayer();
  const work = workingCopy(rec);
  if (!work) return false;
  const size = placed(rec).sizeIn;
  const s = createStroke(work, _brush, { pxPerInX: work.cols / size.w, pxPerInY: work.rows / size.h });
  _stroke = { s, id: rec.id };
  const q = pixelOf(rec, pt);
  s.addPoint(q.c, q.r, pressure);
  liveRedraw();
  return true;
}
function moveStroke(pt, pressure) {
  _hover = pt;
  if (!_stroke) return;
  const rec = find(_stroke.id);
  if (!rec) return;
  const q = pixelOf(rec, pt);
  _stroke.s.addPoint(q.c, q.r, pressure);
  liveRedraw();
}
/** The stroke's release: one commit (or nothing, when it touched no pixel). Resolves when it is stored. */
function endStroke() {
  const st = _stroke;
  _stroke = null;
  if (!st || !st.s.bbox) return _chain;
  return commitWorking(st.id, 'stroke');
}

/** Store the working heights of patch `id` as its new raster, then the step. Commits run one after the other. */
function commitWorking(id, what) {
  const work = _work;
  if (!work || work.id !== id) return _chain;
  const snap = Float32Array.from(work.data);
  const seq = ++_strokeSeq;
  _pending++;
  _chain = _chain.then(() => withLoadingStage('heightPatch', async () => {
    const raster = await encodeRaster(snap, work.cols, work.rows);
    if (!find(id)) return; // the patch was deleted meanwhile
    updateRecord(id, (r) => ({ ...r, raster }));
    if (_work === work) {
      _work.h = raster.h;
      if (seq === _strokeSeq && !_stroke) _work.data.set(decodedRaster(raster)); // the painter shows what is stored
    }
    commitStep(what);
  })).catch((e) => status(`Could not store the stroke: ${e && e.message ? e.message : e}`, true))
    .finally(() => { _pending--; syncHeightPanel(); syncHeightOverlay(); });
  return _chain;
}
/** Resolves once every stroke commit so far is stored. */
export const whenHeightIdle = () => _chain;

/** `editor._heightTool` (editor/editor-height-tool.js): paints only in the Height tab. */
const TOOL = Object.freeze({
  start: (pt, e) => (getEditorTab() === 'height' ? beginStroke(pt, pressureOf(e)) : false),
  move: (pt, e) => moveStroke(pt, pressureOf(e)),
  end: () => endStroke(),
  hover: (pt) => { _hover = pt; drawCursor(); },
  cancel: () => cancelStroke(),
});
function ensureTool() { const ed = editor(); if (ed && ed._heightTool !== TOOL) ed._heightTool = TOOL; }

/** A whole stroke through the same path as the pointer: `points` = [[X, Y, pressure?], ...] in board inches (+Y up),
 *  `brush` over the current one for this stroke only. Resolves when it is stored. (Tests, probes.) */
export function paintHeightStroke(points, brush = {}) {
  const was = _brush;
  _brush = { ..._brush, ...brush };
  try {
    const pt = ([X, Y]) => ({ x: X + P.widthIn / 2, y: P.heightIn / 2 - Y });
    if (!points.length || !beginStroke(pt(points[0]), points[0][2] ?? 1)) return _chain;
    for (const q of points.slice(1)) moveStroke(pt(q), q[2] ?? 1);
    return endStroke();
  } finally { _brush = was; }
}

// ── patches ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** 'New height patch': an unpainted patch over the whole board, made active. One step. */
export async function newHeightPatch() {
  let rec = null;
  await withLoadingStage('heightPatch', async () => { rec = await newHeightLayer(board(), `Height ${list().length + 1}`); });
  P.heightLayers = [...list(), rec];
  _active = rec.id;
  commitStep('add');
  syncHeightPanel();
  syncHeightOverlay();
  return rec;
}
export function removeHeightPatch(id) {
  if (!find(id)) return;
  if (_stroke && _stroke.id === id) cancelStroke();
  P.heightLayers = list().filter((l) => !(l && l.id === id));
  if (_work && _work.id === id) _work = null;
  if (_active === id) _active = list()[0]?.id ?? null;
  commitStep('remove');
  syncHeightPanel();
  syncHeightOverlay();
}
export function setHeightEnabled(id, on) {
  if (!find(id)) return;
  updateRecord(id, (r) => ({ ...r, enabled: !!on }));
  commitStep('enabled');
  syncHeightPanel();
  syncHeightOverlay();
}

/** One control's value: a brush setting (UI state), or the ACTIVE patch's field (`commit` false: a slider's drag tick --
 *  written and drawn, the step comes with its release). */
export function setHeightField(controlId, value, { commit = true } = {}) {
  const c = HEIGHT_CONTROLS.find((x) => x.id === controlId);
  if (!c) return false;
  let v = value;
  if (c.kind === 'slider') { v = parseFloat(value); if (!Number.isFinite(v)) return false; }
  if (c.kind === 'choice') v = c.options.find(([k]) => String(k) === String(value))?.[0];
  if (c.kind === 'check') v = !!value;
  if (v === undefined) return false;
  if (c.target === 'brush') { _brush = { ..._brush, [c.path[0]]: v }; drawCursor(); return true; }
  const rec = activeHeightLayer();
  if (!rec) return false;
  if (c.path[0] === 'sizeIn' && !rec.sizeIn) updateRecord(rec.id, (r) => ({ ...r, sizeIn: placed(r).sizeIn }));
  updateRecord(rec.id, (r) => withPath(r, c.path, v));
  if (commit) commitStep(c.id);
  syncHeightOverlay();
  return true;
}
export const heightBrush = () => ({ ..._brush });

// ── the canvas overlay (the shared editor canvas) ───────────────────────────────────────────────────────────────────
const NS = 'http://www.w3.org/2000/svg';
let _g = null;
const _images = new Map(); // raster h -> data URL (LRU 16)
const _live = { id: null, canvas: null, frame: 0 };
const svgEl = (tag, attrs, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (parent) parent.appendChild(e);
  return e;
};
function canvas2d(w, h) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  let ctx = null;
  try { ctx = c.getContext && c.getContext('2d'); } catch (_) { ctx = null; }
  return ctx && typeof ctx.createImageData === 'function' ? { c, ctx } : null;
}
/** The shaded picture of `data` (a patch's heights) as a data URL, or null where there is no 2D canvas. */
function pictureOf(rec, data, reuse = null) {
  const { cols, rows } = rec.raster;
  const size = placed(rec).sizeIn;
  const { w, h } = shadeSize(cols, rows, HEIGHT_VIEW.maxImagePx);
  const cv = reuse && reuse.c.width === w && reuse.c.height === h ? reuse : canvas2d(w, h);
  if (!cv) return null;
  const img = cv.ctx.createImageData(w, h);
  shadeRaster(data, cols, rows, w, h, cols / size.w, rows / size.h, img.data);
  cv.ctx.putImageData(img, 0, 0);
  return { url: cv.c.toDataURL('image/png'), cv };
}
function stillImageOf(rec) {
  const h = rec.raster && rec.raster.h;
  if (!h) return null;
  if (_images.has(h)) { const u = _images.get(h); _images.delete(h); _images.set(h, u); return u; }
  const d = decodedRaster(rec.raster);
  if (!d) { ensureRasterDecoded(rec.raster).then(() => syncHeightOverlay(), () => {}); return null; }
  const p = pictureOf(rec, d);
  if (!p) return null;
  _images.set(h, p.url);
  while (_images.size > 16) _images.delete(_images.keys().next().value);
  return p.url;
}
/** During a stroke: the active patch's picture from the working heights, once per animation frame. */
function liveRedraw() {
  if (_live.frame) return;
  const run = () => {
    _live.frame = 0;
    const rec = _work && find(_work.id);
    if (!rec || !_g) return;
    const p = pictureOf(rec, _work.data, _live.id === rec.id ? _live.canvas : null);
    _live.id = rec.id;
    _live.canvas = p ? p.cv : null;
    const img = _g.querySelector(`[data-height-patch="${rec.id}"] image`);
    if (p && img) img.setAttribute('href', p.url);
    drawCursor();
  };
  if (typeof requestAnimationFrame === 'function') _live.frame = requestAnimationFrame(run); else run();
}
const fmt = (n) => String(Math.round(n * 1e6) / 1e6);
/** One CSS pixel in editor inches (the stroke widths), from the canvas's own transform. */
function cssPx() {
  const ctm = _g && _g.getScreenCTM && _g.getScreenCTM();
  return ctm && ctm.a ? 1 / Math.abs(ctm.a) : 0.01;
}

/** Draw every patch on the shared editor canvas, in the editor's coordinates (inches, y down), for the current tab: on top
 *  of the drawing and in full in the Height tab (with the active patch's outline), under it and faded elsewhere. */
export function syncHeightOverlay() {
  ensureTool();
  const ed = editor();
  const sketch = ed && ed._sketchLayer && ed._sketchLayer.node;
  const host = sketch && sketch.parentNode;
  if (!host) return;
  if (!_g) {
    _g = svgEl('g', { id: 'heightPatches', 'pointer-events': 'none' });
  }
  const inTab = getEditorTab() === 'height';
  const anchor = inTab ? sketch.nextSibling : sketch;
  if (_g.parentNode !== host || (inTab ? _g.previousSibling !== sketch : _g.nextSibling !== sketch)) host.insertBefore(_g, anchor);
  // the fade is the focus table's (editor/editor-frame-profile.js EDITOR_TAB_FOCUS heightPatches), never a rule of its own
  const fade = (EDITOR_TAB_FOCUS[getEditorTab()] || EDITOR_TAB_FOCUS.artwork).heightPatches;
  if (fade >= 1) _g.removeAttribute('opacity'); else _g.setAttribute('opacity', String(fade));
  const recs = list().filter((r) => r && r.enabled !== false && r.raster);
  const keep = new Set(recs.map((r) => String(r.id)));
  for (const n of [..._g.querySelectorAll('[data-height-patch]')]) if (!keep.has(n.getAttribute('data-height-patch'))) n.remove();
  const px = cssPx();
  const active = activeHeightLayer();
  for (const rec of recs) {
    const p = placed(rec);
    let node = _g.querySelector(`[data-height-patch="${rec.id}"]`);
    if (!node) {
      node = svgEl('g', { 'data-height-patch': rec.id }, _g);
      svgEl('image', { preserveAspectRatio: 'none' }, node);
      svgEl('rect', { fill: 'none', class: 'height-patch-outline' }, node);
    }
    node.setAttribute('transform', `translate(${fmt(P.widthIn / 2 + p.position.x)} ${fmt(P.heightIn / 2 - p.position.y)}) rotate(${fmt(-p.rotation)})`);
    const img = node.querySelector('image');
    for (const [k, v] of [['x', -p.sizeIn.w / 2], ['y', -p.sizeIn.h / 2], ['width', p.sizeIn.w], ['height', p.sizeIn.h]]) img.setAttribute(k, fmt(v));
    const live = _work && _work.id === rec.id && (_stroke || _pending > 0 || _work.h !== rec.raster.h);
    const url = live ? null : stillImageOf(rec);
    if (url) img.setAttribute('href', url);
    else if (live) liveRedraw();
    const box = node.querySelector('rect');
    for (const [k, v] of [['x', -p.sizeIn.w / 2], ['y', -p.sizeIn.h / 2], ['width', p.sizeIn.w], ['height', p.sizeIn.h]]) box.setAttribute(k, fmt(v));
    box.setAttribute('stroke', HEIGHT_VIEW.outline);
    box.setAttribute('stroke-width', fmt(1.5 * px));
    box.setAttribute('stroke-dasharray', `${fmt(4 * px)} ${fmt(3 * px)}`);
    box.style.display = inTab && active && rec.id === active.id ? '' : 'none';
  }
  drawCursor();
}

/** The brush ring under the pointer and the height readout, in the Height tab only. */
function drawCursor() {
  if (!_g) return;
  let ring = _g.querySelector('#heightBrushRing');
  const inTab = getEditorTab() === 'height';
  const readout = byId('heightReadout');
  if (!inTab || !_hover) {
    if (ring) ring.style.display = 'none';
    if (readout) readout.hidden = true;
    return;
  }
  if (!ring) ring = svgEl('circle', { id: 'heightBrushRing', fill: 'none' }, _g);
  if (ring !== _g.lastChild) _g.appendChild(ring);
  const px = cssPx();
  ring.setAttribute('cx', fmt(_hover.x)); ring.setAttribute('cy', fmt(_hover.y));
  ring.setAttribute('r', fmt(_brush.sizeIn / 2));
  ring.setAttribute('stroke', HEIGHT_VIEW.ring);
  ring.setAttribute('stroke-width', fmt(1.5 * px));
  ring.style.display = '';
  if (readout) {
    const rec = activeHeightLayer();
    const work = rec ? workingCopy(rec) : null;
    let text = '';
    if (rec && work) {
      const q = pixelOf(rec, _hover);
      if (q.inside) text = `height ${sampleRaster(work.data, work.cols, work.rows, q.c, q.r).toFixed(3)} in`;
    }
    readout.textContent = text;
    readout.hidden = !text;
  }
}

// ── the panel ───────────────────────────────────────────────────────────────────────────────────────────────────────
const el = (tag, attrs = {}, kids = []) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'style') e.style.cssText = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v); }
  for (const k of kids) if (k) e.appendChild(k);
  return e;
};
const cad = (text) => el('label', { class: 'cad-label', text });
function renderControl(c) {
  if (c.kind === 'choice') {
    return el('div', {}, [cad(c.label), el('div', { class: 'relief-toggle', id: `height_${c.id}`, style: 'margin-bottom:10px; flex-wrap:wrap;' },
      c.options.map(([key, text, title]) => el('button', { type: 'button', class: 'relief-toggle-btn', 'data-height-choice': `${c.id}:${key}`, title, text })))]);
  }
  if (c.kind === 'check') {
    return el('label', { class: 'cad-label photo-layer-check' }, [el('input', { type: 'checkbox', id: `height_${c.id}` }), el('span', { text: c.label })]);
  }
  const [min, max] = c.range(P);
  const s = el('input', { type: 'range', id: `height_${c.id}Slider`, class: 'cad-slider', min: String(min), max: String(max), step: String(c.step) });
  const n = el('input', { type: 'number', id: `height_${c.id}`, min: String(min), max: String(max), step: String(c.step) });
  return el('div', {}, [cad(c.label), el('div', { class: 'cad-slider-row', style: 'margin-bottom:10px;' }, [s, el('div', { class: 'cad-stepper', style: 'width:66px;' }, [n])]),
    c.note ? el('div', { class: 'photo-layer-note', text: c.note }) : null]);
}

/** Build the panel from HEIGHT_CONTROLS into `body`, and the brush modes into the rail. */
export function renderHeightPanel(body, rail = byId('editorToolbarHeight')) {
  if (rail) {
    rail.innerHTML = '';
    for (const c of HEIGHT_CONTROLS.filter((x) => x.rail)) {
      for (const [key, text, title] of c.options) {
        rail.appendChild(el('button', { type: 'button', class: 'tool-btn', 'data-height-choice': `${c.id}:${key}`, title: `${text}: ${title}`, 'aria-label': text, text: MODE_LABELS[key] ? MODE_LABELS[key][0] : text }));
      }
    }
  }
  if (!body) return;
  body.innerHTML = '';
  body.appendChild(el('div', { class: 'photo-layer-buttons' }, [
    el('button', { type: 'button', id: 'heightNew', class: 'cad-btn cad-btn-secondary', text: '＋ New height patch', title: 'An unpainted patch over the whole board (100 pixels per inch)' }),
    el('button', { type: 'button', id: 'heightRemove', class: 'cad-btn cad-btn-secondary', text: '🗑 Delete' }),
  ]));
  body.appendChild(el('div', { id: 'heightStatus', class: 'photo-layer-note', role: 'status', hidden: '' }));
  body.appendChild(el('div', { id: 'heightList', class: 'stl-list' }));
  for (const g of HEIGHT_GROUPS) {
    const box = el('div', { id: `heightGroup_${g.id}` });
    box.appendChild(el('label', { class: 'cad-label photo-layer-group' }, [el('span', { text: g.label }), g.note ? el('span', { class: 'photo-layer-group-note', text: ` ${g.note}` }) : null]));
    for (const c of HEIGHT_CONTROLS.filter((x) => x.group === g.id)) box.appendChild(renderControl(c));
    body.appendChild(box);
  }
  body.appendChild(el('div', { id: 'heightStored', class: 'photo-layer-note' }));
}

const KIB = 1024;
/** Reflect the state on the panel. Safe any time (a load, an undo, a stroke). */
export function syncHeightPanel() {
  const recs = list();
  if (!find(_active)) _active = recs[0]?.id ?? null;
  const listEl = byId('heightList');
  if (listEl) {
    listEl.innerHTML = '';
    if (!recs.length) listEl.appendChild(el('div', { class: 'photo-layer-note', text: 'No height patch yet. Add one, then paint on the board.' }));
    for (const r of recs) {
      const on = r.enabled !== false;
      const row = el('div', { class: `stl-row${r.id === _active ? ' stl-row-active' : ''}` }, [
        el('input', { type: 'checkbox', 'data-height-enable': r.id, title: 'Stamp this patch' }),
        el('button', { type: 'button', class: 'stl-row-name', 'data-height-pick': r.id, text: r.name || 'Height' }),
      ]);
      row.querySelector('input').checked = on;
      listEl.appendChild(row);
    }
  }
  const rec = activeHeightLayer();
  const n = rec ? placed(rec) : null;
  for (const c of HEIGHT_CONTROLS) {
    const src = c.target === 'brush' ? _brush : n;
    const v = src ? getPath(src, c.path) : undefined;
    if (c.kind === 'slider') {
      const [min, max] = c.range(P);
      for (const id of [`height_${c.id}Slider`, `height_${c.id}`]) { const x = byId(id); if (x) { x.min = String(min); x.max = String(max); if (v !== undefined) x.value = String(v); x.disabled = !src; } }
    } else if (c.kind === 'check') {
      const x = byId(`height_${c.id}`); if (x) x.checked = !!v;
    } else if (typeof document !== 'undefined') {
      for (const b of document.querySelectorAll(`[data-height-choice^="${c.id}:"]`)) b.classList.toggle('active', b.getAttribute('data-height-choice') === `${c.id}:${v}`);
    }
  }
  for (const g of ['patch', 'stamp']) { const box = byId(`heightGroup_${g}`); if (box) box.hidden = !rec; }
  const rm = byId('heightRemove'); if (rm) rm.disabled = !rec;
  const stored = byId('heightStored');
  if (stored) {
    const bytes = recs.reduce((s, r) => s + ((r && r.raster && r.raster.data && r.raster.data.length) || 0), 0);
    stored.hidden = !recs.length;
    stored.textContent = rec ? `${rec.raster.cols} x ${rec.raster.rows} pixels (${HEIGHT_PX_PER_IN} per inch when made). Stored in the project: ${(bytes / KIB).toFixed(0)} KB.` : '';
  }
}

function onTabChanged(e) {
  const tab = e && e.detail ? e.detail.tab : getEditorTab();
  ensureTool();
  if (tab !== 'height') cancelStroke();
  const ed = editor();
  // the Height tab's own tool: its brush is armed on entry (global-events.js drops it again on a switch away)
  if (tab === 'height' && ed && typeof ed.setMode === 'function' && ed._currentMode !== 'heightBrush') ed.setMode('heightBrush');
  const readout = byId('heightReadout'); if (readout && tab !== 'height') readout.hidden = true;
  syncHeightOverlay();
}
const onViewChanged = () => syncHeightOverlay();

/** Wire the tab (main.js). `hooks.onChange`: a committed change (main.js rebuilds once the editor is closed). */
export function initHeightPanel(hooks = {}) {
  _hooks = { onChange: hooks.onChange || (() => {}) };
  renderHeightPanel(byId('heightPanelBody'));
  registerUndoPart('heightLayers', {
    take: () => P.heightLayers, // the copy-on-write list itself: an entry costs a reference
    restore: (v) => { if (v === P.heightLayers) return; cancelStroke(); P.heightLayers = v; syncHeightPanel(); syncHeightOverlay(); },
  });
  byId('editorTabHeight')?.addEventListener('click', () => setEditorTab('height'));
  byId('heightNew')?.addEventListener('click', () => { newHeightPatch().catch((e) => status(`Could not make the patch: ${e && e.message ? e.message : e}`, true)); });
  byId('heightRemove')?.addEventListener('click', () => { const r = activeHeightLayer(); if (r) removeHeightPatch(r.id); });
  byId('heightList')?.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-height-pick]');
    if (pick) { _active = pick.getAttribute('data-height-pick'); syncHeightPanel(); syncHeightOverlay(); }
  });
  byId('heightList')?.addEventListener('change', (e) => {
    const box = e.target.closest('[data-height-enable]');
    if (box) setHeightEnabled(box.getAttribute('data-height-enable'), box.checked);
  });
  for (const c of HEIGHT_CONTROLS) {
    if (c.kind === 'slider') {
      const s = byId(`height_${c.id}Slider`), n = byId(`height_${c.id}`);
      s?.addEventListener('input', (e) => { if (n) n.value = e.target.value; setHeightField(c.id, e.target.value, { commit: false }); });
      s?.addEventListener('change', (e) => { setHeightField(c.id, e.target.value); syncHeightPanel(); });
      n?.addEventListener('change', (e) => { setHeightField(c.id, e.target.value); syncHeightPanel(); });
    } else if (c.kind === 'check') {
      byId(`height_${c.id}`)?.addEventListener('change', (e) => setHeightField(c.id, e.target.checked));
    } else if (typeof document !== 'undefined') {
      for (const b of document.querySelectorAll(`[data-height-choice^="${c.id}:"]`)) {
        b.addEventListener('click', () => {
          setHeightField(c.id, b.getAttribute('data-height-choice').slice(c.id.length + 1));
          if (c.rail) { const ed = editor(); if (ed && typeof ed.setMode === 'function' && getEditorTab() === 'height') ed.setMode('heightBrush'); }
          syncHeightPanel();
        });
      }
    }
  }
  if (typeof document !== 'undefined') {
    const container = byId('editorCanvasContainer');
    if (container && !byId('heightReadout')) {
      container.appendChild(el('div', { id: 'heightReadout', class: 'heights-hud', hidden: '', style: 'position:absolute; top:12px; right:12px; z-index:10; pointer-events:none;' }));
    }
    document.addEventListener('editorTabChanged', onTabChanged); // the same function: one listener however often init runs
    for (const ev of ['editorBoardResized', 'editorViewChanged', 'editorTopViewUpdated']) document.addEventListener(ev, onViewChanged);
  }
  ensureTool();
  syncHeightPanel();
  syncHeightOverlay();
}

/** A load / a global undo replaced P.heightLayers (main/snapshot-manager.js): an open stroke is dropped, the panel and
 *  the pictures follow the restored records (the working copy reloads from the restored raster on the next use). */
export function syncHeightTab() {
  cancelStroke();
  syncHeightPanel();
  syncHeightOverlay();
}

/** Test / host hook. */
export function _resetHeightPanelForTests() {
  _active = null; _brush = { ...BRUSH_DEFAULTS }; _work = null; _stroke = null; _pending = 0; _chain = Promise.resolve(); _hover = null;
  _hooks = { onChange: () => {} };
  if (_g) _g.remove();
  _g = null; _images.clear(); _live.id = null; _live.canvas = null; _live.frame = 0;
}

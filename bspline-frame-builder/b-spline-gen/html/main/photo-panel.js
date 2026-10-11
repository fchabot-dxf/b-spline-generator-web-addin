/**
 * main/photo-panel.js — F34 item 1: the Photo filter's own top-level tab
 * (pattern row + "Load my own" + crop/rotate/flip/levels/brightness/
 * contrast/blur/invert + undo) -- Fred: its own tab next to Filter etc.,
 * not nested inside Filter, and ALWAYS visible/clickable (unlike the old
 * Filter-nested sub-panel it replaced). Picking a built-in pattern or
 * loading your own photo here turns the photo LAYER on (2026-10-10, Fred: the
 * photo is its own layer over the board's filter -- switchOnPhotoLayer()).
 *
 * This tab EDITS THE IMAGE; every 3D setting of the photo (its effect params
 * depth/scale/offset/rotation/repeat, the layer on/off, "Filter shows
 * through", Max Height) lives in Surface > Photo, declared in
 * main/photo-layer-section.js's PHOTO_CONTROLS -- which also mirrors some of
 * this tab's edits (photoEditApi below: the same state, the same steps).
 *
 * Edit-step bookkeeping rule (undo-able, ordered list, per the dispatch):
 * crop/rotate90/flip/invert are DISCRETE actions -- each click always
 * APPENDS its own new step, so "Undo" (pop the last step) does something
 * sensible for each one. levels/brightnessContrast/blur are CONTINUOUS
 * (slider-driven) -- dragging mutates the LAST step in place if it's
 * already that op (so a drag doesn't flood the list with one entry per
 * tick); the first touch of a fresh photo still appends a new step.
 *
 * DOM/canvas code only (not unit-tested -- this repo's own test env has no
 * real Canvas 2D context, see core/photo/codec.js's own header comment);
 * the one pure, testable piece this panel uses is core/photo/mirror-dim.js.
 */
import { P, saveLastSession } from '../core/state.js';
import {
  loadPhotoPatterns, settingsToPhotoEdits, settingsToTweaks, editsToSettings,
} from '../core/photo/patterns.js';
import { fileToDataUrl, downscalePhotoDataUrl } from '../core/photo/codec.js';
import { ensurePhotoDecoded, getRawPhotoImage, isPhotoReady } from '../core/photo/state.js';
import { applyPhotoEdits } from '../core/photo/ops.js';
import { withLoadingStage, withLoadingStageShownFirst } from '../core/loading-signal.js';
import { computeMirrorDimRects } from '../core/photo/mirror-dim.js';
import { applyParam } from './param-manager.js';
import { setEditorTab } from './editor-tabs.js';
import { renderToolRegistry, syncToolRegistryButtons } from '../editor/editor-tool-registry.js';
import { renderTabStrip } from '../editor/tab-strip.js';
import { photoToolIconSvg } from '../editor/photo-tool-icons.js';
import { registerUndoPart } from '../editor/undo-parts.js';
import { commitEdit } from '../editor/editor-commit.js';
import { PLACEMENT_KEYS, syncPhotoFootprint } from './photo-footprint.js';

/** F35 item 10 (advisor, Fred's own reasoning: "each tab uses a completely different toolbar"):
 *  Photo's own left-rail toolbar, moved here from the old sidebar panel's single always-visible
 *  column -- picking a tool shows just that tool's own settings (its own `photoToolSection_<id>` div
 *  in #editorPhotoPanel), everything else (pattern/load/preview/relief/height/tweaks/save) stays
 *  visible regardless, the SAME "common controls every tool shares" split main/brick-panel.js's own
 *  BRICK_TOOLS already established -- not a new mechanism. */
const PHOTO_TOOLS = [
  { id: 'crop', buttonId: 'photoTool_crop', iconSvg: () => photoToolIconSvg('crop'), label: 'Crop', icon: '⬚', hint: 'Crop the photo to a region before it becomes the terrain.' },
  { id: 'straighten', buttonId: 'photoTool_straighten', iconSvg: () => photoToolIconSvg('straighten'), label: 'Straighten', icon: '📐', hint: 'Rotate by a small angle to level a tilted photo.' },
  { id: 'rotateFlip', buttonId: 'photoTool_rotateFlip', iconSvg: () => photoToolIconSvg('rotateFlip'), label: 'Rotate/Flip', icon: '🔄', hint: 'Rotate 90° or flip the photo horizontally/vertically.' },
  { id: 'levels', buttonId: 'photoTool_levels', iconSvg: () => photoToolIconSvg('levels'), label: 'Levels', icon: '🎚️', hint: 'Black/white/mid points plus brightness and contrast.' },
  { id: 'blur', buttonId: 'photoTool_blur', iconSvg: () => photoToolIconSvg('blur'), label: 'Blur', icon: '🌫️', hint: 'Smooth the photo before it becomes height.' },
];

/** The Photo TABS (Fred's OK on mockup v2): Source | Adjust | Relief at the top of the Photo panel. A tab shows its own
 *  blocks and EVERY section of its tools at once (Photo's tools are settings switches, not canvas gestures); the left
 *  rail stays (its icons are Fred's picks) and a tool pick opens that tool's tab. Every tool sits in exactly one tab; the
 *  blocks no tab lists (the preview, Save) show on every tab. */
export const PHOTO_TABS = Object.freeze([
  Object.freeze({ id: 'source', label: 'Source', tools: Object.freeze(['crop', 'straighten', 'rotateFlip']), blocks: Object.freeze(['photoSourceBlock']) }),
  Object.freeze({ id: 'adjust', label: 'Adjust', tools: Object.freeze(['levels', 'blur']), blocks: Object.freeze([]) }),
  Object.freeze({ id: 'relief', label: 'Relief', tools: Object.freeze([]), blocks: Object.freeze(['photoReliefBlock']) }),
]);
export const photoTabOfTool = (toolId) => (PHOTO_TABS.find((t) => t.tools.includes(toolId)) || {}).id || null;

let _activePhotoTool = PHOTO_TOOLS[0].id;
let _photoTab = photoTabOfTool(PHOTO_TOOLS[0].id);
let _syncPhotoTabs = null;
export const activePhotoTab = () => _photoTab;
let _onChange = null;
let _patterns = [];

/** F35 (advisor, UX unification): rendering + the active-class toggle are the shared
 *  editor-tool-registry.js mechanism now, the same one Brick uses -- this file no longer carries
 *  its own copy of either loop. */
function renderPhotoToolbar(container) {
  renderToolRegistry(container, PHOTO_TOOLS, selectPhotoTool);
}

function syncPhotoToolButtons() {
  syncToolRegistryButtons(PHOTO_TOOLS, _activePhotoTool);
  const tab = PHOTO_TABS.find((t) => t.id === _photoTab);
  for (const tool of PHOTO_TOOLS) {
    const section = document.getElementById(`photoToolSection_${tool.id}`);
    if (section) section.style.display = tab && tab.tools.includes(tool.id) ? '' : 'none';
  }
  for (const t of PHOTO_TABS) {
    for (const id of t.blocks) { const el = document.getElementById(id); if (el) el.style.display = t === tab ? 'flex' : 'none'; }
  }
  if (_syncPhotoTabs) _syncPhotoTabs(_photoTab);
  // the crop box comes and goes with the Crop tab: the preview redraws, and a finger drag on it is the box's, not a scroll
  const preview = document.getElementById('photoPreviewCanvas');
  if (preview) { preview.style.touchAction = cropBoxShown() ? 'none' : ''; drawPreview(); }
  const caption = document.getElementById('photoPreviewCaption');
  if (caption) caption.textContent = PREVIEW_CAPTION[cropBoxShown() ? 'crop' : 'mirror'];
  syncPhotoFootprint(); // the footprint on the board comes and goes with the Photo tab (main/photo-footprint.js)
}
/** What the preview's dimming means, per what it shows (the crop box dims the outside of the crop). */
export const PREVIEW_CAPTION = Object.freeze({
  mirror: 'dimmed = mirrored by Symmetry, not sampled directly',
  crop: 'dimmed = outside the crop',
});

function selectPhotoTool(id) {
  _activePhotoTool = id;
  _photoTab = photoTabOfTool(id) || _photoTab; // the Photo tabs: a rail pick opens its tool's tab
  syncPhotoToolButtons();
}

/** A tab pick: its blocks + its tools' sections; the rail highlights the tab's first tool (none for Relief). */
export function setPhotoTab(id) {
  const tab = PHOTO_TABS.find((t) => t.id === id);
  if (!tab) return;
  _photoTab = id;
  _activePhotoTool = tab.tools[0] || null;
  syncPhotoToolButtons();
}

/** F35 (advisor: "Esc = back to the select tool in every tab"): Photo's own tools are settings-
 *  section switches, not canvas gesture modes -- "back to select" here means returning the
 *  editor's underlying interaction mode to plain Select (the same real effect everywhere else),
 *  Photo's own tool selection has no section to fall back to otherwise. */
export function deselectPhotoTool() {
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  if (editor && typeof editor.setMode === 'function') editor.setMode('select');
}

/** `opts.drag`: a slider's drag tick (core/in-editor-3d.js inEditorDrag); its release calls this again without it. */
function notifyChange(opts) {
  saveLastSession();
  if (_onChange) _onChange(opts);
  syncPhotoFootprint();
}

/** Item 74f (advisor; seat D's Photo audit, measured: crop / levels / brightness / blur / relief changed the 3D but the
 *  editor's Undo did not take them back -- only the panel's own Undo button did): the photo (its source, edit list,
 *  pattern and relief height) rides in every editor undo entry (item 38's parts), and each photo gesture is ONE editor
 *  step -- a slider on release ('change'), a button on click, a load / pattern / clear when it lands. Once the photo is in
 *  every entry, every photo change must be a step, or an Undo of something else would take the photo back with it.
 *  The panel's own Undo button keeps working as before (and is a step too). */
// 2026-10-10: the photo LAYER's on/off rides in the step too -- a pattern pick turns the layer on, and its Undo turns it
// back off with the photo it took back.
// 2026-10-10: + the photo's PLACEMENT (scale / offsets / rotation): the on-board footprint (main/photo-footprint.js) edits it
// inside the editor, where the global undo is off -- so a footprint drag is an editor step like any photo gesture.
const placementState = () => {
  const t = (P.filterTweaks && P.filterTweaks.photo) || {};
  return Object.fromEntries(PLACEMENT_KEYS.filter((k) => t[k] !== undefined).map((k) => [k, t[k]]));
};
// the board Z is not the photo's (Fred, 2026-10-10)
const photoUndoState = () => ({ ...photoState(), layer: !!P.photoLayer, placement: placementState() });
const samePlacement = (a, b) => !a || !b || PLACEMENT_KEYS.every((k) => a[k] === b[k]); // an entry without one: not compared
const samePhoto = (a, b) => !!a && !!b && a.url === b.url && a.patternId === b.patternId
  && !!a.layer === !!b.layer && JSON.stringify(a.edits) === JSON.stringify(b.edits) && samePlacement(a.placement, b.placement);
/** Put a placement back: the keys it has, the others back to their defaults (removed). */
function writePlacement(placement) {
  if (!P.filterTweaks) P.filterTweaks = {};
  const t = { ...(P.filterTweaks.photo || {}) };
  for (const k of PLACEMENT_KEYS) { if (placement[k] === undefined) delete t[k]; else t[k] = placement[k]; }
  P.filterTweaks.photo = t;
}
/** A footprint drag's release (main/photo-footprint.js): the placement written, one repaint, one editor undo step. */
export function commitPhotoPlacement(placement) {
  writePlacement(placement);
  if (_syncMirrors) _syncMirrors();
  notifyChange();
  photoStep();
}
/** Seat D 2026-10-09: the step's commit (the editor's commit pipeline, ~100 ms on a phone at 4x CPU) runs behind the
 *  'backdrop' stage too -- a slider release or a rotate tap shows the pill first, then commits and repaints under it. */
function photoStep() {
  return withLoadingStageShownFirst('backdrop', photoStepNow);
}
function photoStepNow() {
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  if (!editor || !Array.isArray(editor._undoStack)) return;
  const top = editor._undoStack[editor._undoStack.length - 1];
  if (top && top.parts && samePhoto(top.parts.photo, photoUndoState())) return; // nothing new: no step
  commitEdit(editor);
}
function restorePhotoUndo(state) {
  if (!state || samePhoto(state, photoUndoState())) return; // an Undo of something else: the photo stays, no rebuild
  if (state.layer !== undefined && !!state.layer !== !!P.photoLayer) applyParam('photoLayer', !!state.layer, { rebuild: false });
  if (state.placement && !samePlacement(state.placement, placementState())) { writePlacement(state.placement); if (_syncMirrors) _syncMirrors(); }
  restorePhoto(state);
}

// 2026-10-10: Surface > Photo (main/photo-layer-section.js) mirrors some of this tab's image edits -- the SAME state and
// the SAME steps (one undo step per change); both views follow each other through this hook.
let _syncMirrors = null;
export function onPhotoControlsSynced(fn) { _syncMirrors = fn; }
export const photoEditApi = Object.freeze({
  flip: (axis) => appendDiscreteOp('flip', { axis }),
  setInvert: (on) => setInvert(on),
  isInverted: () => isInverted(),
  opValue: (opName, key, fallback) => currentOpParams(opName, fallback)[key],
  setOpValue: (opName, key, value, fallback, opts) => {
    const params = currentOpParams(opName, fallback);
    params[key] = value;
    setAdjustableOp(opName, params, opts);
    syncControlsFromState();
  },
  release: () => { notifyChange(); photoStep(); }, // a slider's release: the drag's one repaint + its one undo step
});

/** The params of the LAST step of `opName` in P.photoEdits, merged onto
 * `fallback` -- so touching one slider (e.g. levels black) doesn't clobber
 * the others (white/mid) already set by this same step. */
function currentOpParams(opName, fallback) {
  const steps = P.photoEdits || [];
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].op === opName) return { ...fallback, ...steps[i].params };
  }
  return { ...fallback };
}

function setAdjustableOp(opName, params, opts) {
  const steps = (P.photoEdits || []).slice();
  if (steps.length && steps[steps.length - 1].op === opName) {
    steps[steps.length - 1] = { op: opName, params };
  } else {
    steps.push({ op: opName, params });
  }
  P.photoEdits = steps;
  if (_syncMirrors) _syncMirrors();
  notifyChange(opts);
}

// Straighten is declared to always come FIRST (advisor/Fred: "edit order:
// straighten -> crop -> the rest") -- unlike the other adjustable ops
// (setAdjustableOp above), re-adjusting it must find and update its own
// step WHEREVER it sits, never append a second one after crop.
function setStraighten(degrees, opts) {
  const steps = (P.photoEdits || []).slice();
  const idx = steps.findIndex((s) => s.op === 'straighten');
  const step = { op: 'straighten', params: { degrees } };
  if (idx >= 0) steps[idx] = step;
  else steps.unshift(step);
  P.photoEdits = steps;
  notifyChange(opts);
}

// Fred 2026-10-10 (live crop; "keep the original so we can uncrop"): crop is ONE op at its declared place in the edit
// order (straighten -> crop -> the rest), upserted -- never appended (each "Apply crop" used to add one more, so crops
// compounded). The stored photo is always the ORIGINAL; the crop is only a step of the pipeline, so it can be widened
// back to the full image. A saved project is never rewritten on load (a legacy list of appended crops renders exactly
// as before); only an EDIT replaces its crops with the one op.
export const CROP_FULL = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });
const CROP_GEOMETRY_OPS = new Set(['rotate90', 'flip']); // a crop after one of these is in a turned / mirrored frame
const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
const cropRect = (p = {}) => ({ x: clamp01(p.x ?? 0), y: clamp01(p.y ?? 0), w: clamp01(p.w ?? 1), h: clamp01(p.h ?? 1) });
export const isFullCrop = (r) => r.x <= 0 && r.y <= 0 && r.w >= 1 && r.h >= 1;

/** Pure: the crop the panel edits, as fractions of the (straightened) original. One crop op: its rect. A legacy list of
 *  appended crops: composed exactly (each crops the previous result) when no rotate / flip comes before any of them;
 *  otherwise the full image (an edit then starts from the whole photo). */
export function editableCrop(steps = []) {
  let r = { ...CROP_FULL }, turned = false;
  for (const s of steps) {
    if (CROP_GEOMETRY_OPS.has(s.op)) turned = true;
    if (s.op !== 'crop') continue;
    if (turned) return { ...CROP_FULL };
    const c = cropRect(s.params);
    r = { x: r.x + c.x * r.w, y: r.y + c.y * r.h, w: c.w * r.w, h: c.h * r.h };
  }
  return r;
}

/** Pure: `steps` with ONE crop `rect` at its declared place (right after straighten, else first), every other crop op
 *  removed; the full image = no crop op at all. */
export function withCrop(steps = [], rect) {
  const rest = steps.filter((s) => s.op !== 'crop');
  const r = cropRect(rect);
  if (isFullCrop(r)) return rest;
  const at = rest.findIndex((s) => s.op === 'straighten') + 1; // 0 when there is no straighten
  return [...rest.slice(0, at), { op: 'crop', params: r }, ...rest.slice(at)];
}

/** The crop fields (in %) <- the state. */
function syncCropFields() {
  const r = editableCrop(P.photoEdits || []);
  const set = (id, v) => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.value = String(Math.round(v * 1000) / 10); };
  set('photoCropX', r.x); set('photoCropY', r.y); set('photoCropW', r.w); set('photoCropH', r.h);
}
/** The crop -> the state, previewed at once (the box on the preview canvas; the editor's backdrop, except per drag tick
 *  -- core/in-editor-3d.js inEditorDrag); the gesture's end commits it (photoStep). */
function setCrop(rect, opts) {
  P.photoEdits = withCrop(P.photoEdits || [], rect);
  drawPreview();
  notifyChange(opts);
}

// The CROP BOX (advisor + Fred 2026-10-10, option 2): on the Photo panel's own preview canvas, while the tab that holds
// Crop is open, the photo is shown UNCROPPED (only straightened -- the crop's own frame) with the crop as a box over it:
// 4 corner handles + the body to move, finger-sized on a coarse pointer. It drives the same setCrop as the fields
// (synced both ways); a drag's ticks redraw the box only, its release is ONE step.
export const CROP_BOX = Object.freeze({
  handlePx: Object.freeze({ fine: 16, coarse: 28 }), // the grab target's side, CSS px (>= 28 for a finger)
  minFrac: 0.02, // the smallest crop side, as a fraction of the photo
});
/** The box's LOOK (Fred 2026-10-10: "not very visible") -- it reads on a light AND a dark photo: a yellow frame inside a
 *  dark outline, solid handles with a dark border, a strong dim outside, rule-of-thirds lines while dragging. Sizes in
 *  CSS px (scaled to the canvas). The grab size stays CROP_BOX.handlePx. */
export const CROP_BOX_STYLE = Object.freeze({
  framePx: 2.5, frame: '#ffd54f',
  outlinePx: 1, outline: 'rgba(0,0,0,0.85)', // just outside the frame, so it reads on a light photo
  handleDrawPx: 12, handleFill: '#ffd54f', handleBorderPx: 1.5, handleBorder: '#1a1a1a',
  dim: 'rgba(0,0,0,0.58)',
  thirds: 'rgba(255,255,255,0.65)', thirdsPx: 1, // while dragging
});
/** Fred 2026-10-10 (desktop: "there's no cursor"): the cursor per zone -- keyed by what cropHit returns, so the cursor
 *  always names what a drag there would do (no zone = the default). */
export const CROP_BOX_CURSOR = Object.freeze({ nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', move: 'move' });
const cropHandlePx = () => CROP_BOX.handlePx[typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine'];
const clampTo = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Pure: what a pointer at (u, v) -- fractions of the photo -- grabs on `rect`: a corner ('nw' | 'ne' | 'sw' | 'se')
 *  within (hu, hv) of it (corners win), 'move' inside the box, null outside. */
export function cropHit(rect, u, v, hu, hv) {
  const x1 = rect.x + rect.w, y1 = rect.y + rect.h;
  const near = (a, b, h) => Math.abs(a - b) <= h;
  for (const [id, cx, cy] of [['nw', rect.x, rect.y], ['ne', x1, rect.y], ['sw', rect.x, y1], ['se', x1, y1]]) {
    if (near(u, cx, hu) && near(v, cy, hv)) return id;
  }
  return u >= rect.x && u <= x1 && v >= rect.y && v <= y1 ? 'move' : null;
}

/** Pure: the rect after the grab `part` (from cropHit) of `r` moved by (du, dv) fractions -- inside the photo, each side
 *  at least `min`; a corner moves only its own two edges, 'move' keeps the size. */
export function cropDrag(r, part, du, dv, min = CROP_BOX.minFrac) {
  if (part === 'move') return { x: clampTo(r.x + du, 0, 1 - r.w), y: clampTo(r.y + dv, 0, 1 - r.h), w: r.w, h: r.h };
  let x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
  if (part === 'nw' || part === 'sw') x0 = clampTo(x0 + du, 0, x1 - min); else x1 = clampTo(x1 + du, x0 + min, 1);
  if (part === 'nw' || part === 'ne') y0 = clampTo(y0 + dv, 0, y1 - min); else y1 = clampTo(y1 + dv, y0 + min, 1);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The box is shown while the Photo tab that holds Crop is open. */
const cropBoxShown = () => (PHOTO_TABS.find((t) => t.id === _photoTab)?.tools || []).includes('crop');

let _straightened = null; // { raw, degrees, img }: the preview's photo in the crop's own frame, computed once per change
function straightenedPhoto(raw) {
  const st = (P.photoEdits || []).filter((s) => s.op === 'straighten');
  const degrees = st.length ? st[st.length - 1].params?.degrees || 0 : 0;
  if (!degrees) return raw;
  if (!_straightened || _straightened.raw !== raw || _straightened.degrees !== degrees) _straightened = { raw, degrees, img: applyPhotoEdits(raw, st) };
  return _straightened.img;
}

let _cropDragging = false; // the thirds show while a box drag is under way
/** The box over the preview (CROP_BOX_STYLE): the outside dimmed, the frame in its dark outline, thirds while dragging, the
 *  4 solid corner handles. */
function drawCropBox(ctx, canvas) {
  const st = CROP_BOX_STYLE;
  const r = editableCrop(P.photoEdits || []);
  const W = canvas.width, H = canvas.height;
  const bx = r.x * W, by = r.y * H, bw = r.w * W, bh = r.h * H;
  const box = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
  const s = box && box.width ? W / box.width : 1; // canvas px per CSS px
  ctx.fillStyle = st.dim;
  ctx.fillRect(0, 0, W, by); ctx.fillRect(0, by + bh, W, H - by - bh);
  ctx.fillRect(0, by, bx, bh); ctx.fillRect(bx + bw, by, W - bx - bw, bh);
  if (_cropDragging) {
    ctx.strokeStyle = st.thirds; ctx.lineWidth = st.thirdsPx * s;
    ctx.beginPath();
    for (const k of [1, 2]) { ctx.moveTo(bx + (bw * k) / 3, by); ctx.lineTo(bx + (bw * k) / 3, by + bh); ctx.moveTo(bx, by + (bh * k) / 3); ctx.lineTo(bx + bw, by + (bh * k) / 3); }
    ctx.stroke();
  }
  ctx.strokeStyle = st.outline; ctx.lineWidth = (st.framePx + 2 * st.outlinePx) * s; // the dark edge around the frame
  ctx.strokeRect(bx, by, bw, bh);
  ctx.strokeStyle = st.frame; ctx.lineWidth = st.framePx * s;
  ctx.strokeRect(bx, by, bw, bh);
  const hs = st.handleDrawPx * s;
  for (const [cx, cy] of [[bx, by], [bx + bw, by], [bx, by + bh], [bx + bw, by + bh]]) {
    ctx.fillStyle = st.handleFill; ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
    ctx.strokeStyle = st.handleBorder; ctx.lineWidth = st.handleBorderPx * s; ctx.strokeRect(cx - hs / 2, cy - hs / 2, hs, hs);
  }
}
/** The cursor for a pointer at (u, v) over the box (CROP_BOX_CURSOR by cropHit's zone; '' = the default). */
export function cropCursorAt(rect, u, v, hu, hv) {
  return CROP_BOX_CURSOR[cropHit(rect, u, v, hu, hv)] || '';
}

/** The box's pointer gestures on the preview canvas: a grab (a corner or the body), drag ticks (the box and the fields
 *  follow; the board waits), the release = one step. */
function bindCropBox(canvas) {
  if (!canvas || !canvas.addEventListener) return;
  let grab = null; // { part, rect0, u0, v0, id }
  const at = (e) => { const b = canvas.getBoundingClientRect(); return { u: (e.clientX - b.left) / b.width, v: (e.clientY - b.top) / b.height, b }; };
  canvas.addEventListener('pointerdown', (e) => {
    if (!cropBoxShown() || !P.photoImageDataUrl) return;
    const { u, v, b } = at(e);
    const rect0 = editableCrop(P.photoEdits || []);
    const part = cropHit(rect0, u, v, cropHandlePx() / 2 / b.width, cropHandlePx() / 2 / b.height);
    if (!part) return;
    grab = { part, rect0, u0: u, v0: v, id: e.pointerId };
    _cropDragging = true;
    canvas.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!grab) { // a hover (desktop): the cursor names what a drag there would do
      const shown = cropBoxShown() && !!P.photoImageDataUrl;
      const { u, v, b } = at(e);
      canvas.style.cursor = shown ? cropCursorAt(editableCrop(P.photoEdits || []), u, v, cropHandlePx() / 2 / b.width, cropHandlePx() / 2 / b.height) : '';
      return;
    }
    if (e.pointerId !== grab.id) return;
    const { u, v } = at(e);
    setCrop(cropDrag(grab.rect0, grab.part, u - grab.u0, v - grab.v0), { drag: true });
    syncCropFields();
  });
  const release = (e) => {
    if (!grab || e.pointerId !== grab.id) return;
    grab = null;
    _cropDragging = false;
    notifyChange(); // the drag's one repaint of the board
    photoStep(); // ONE step
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
}

function appendDiscreteOp(opName, params) {
  P.photoEdits = [...(P.photoEdits || []), { op: opName, params }];
  notifyChange();
  photoStep();
}

// Relief toggle (Raised/Carved): a 2-state control over the SAME `invert`
// op, so it's idempotent and removable rather than append-only like the
// other discrete ops -- clicking "Raised" repeatedly must not pile up
// invert steps, and clicking back must actually remove the effect.
function isInverted() {
  return (P.photoEdits || []).some((s) => s.op === 'invert');
}

function setInvert(on) {
  const steps = (P.photoEdits || []).filter((s) => s.op !== 'invert');
  if (on) steps.push({ op: 'invert', params: {} });
  P.photoEdits = steps;
  syncReliefToggle();
  notifyChange();
  photoStep();
}

function syncReliefToggle() {
  const raised = document.getElementById('photoBtnReliefRaised');
  const carved = document.getElementById('photoBtnReliefCarved');
  const inverted = isInverted();
  raised?.classList.toggle('active', !inverted);
  carved?.classList.toggle('active', inverted);
  if (_syncMirrors) _syncMirrors();
}

// 2026-10-10 (Fred): a pattern pick no longer touches the board's Z (P.carveZ, Board > Carve Depth) -- it squashed
// the filter under the photo (MEASURED: 1.5 -> 0.125 in, the filter's relief 0.66 -> 0.055 in). Saved boards keep their
// stored Z; a pattern's own `relief` setting is legacy data, read by nothing now.


function undo() {
  const steps = P.photoEdits || [];
  if (!steps.length) return;
  P.photoEdits = steps.slice(0, -1);
  syncControlsFromState();
  notifyChange();
  photoStep();
}

function setPair(sliderId, numberId, v) {
  const s = document.getElementById(sliderId);
  const n = document.getElementById(numberId);
  if (s) s.value = String(v);
  if (n) n.value = String(v);
}

/** Reflect P.photoEdits' own current levels/brightnessContrast/blur values
 * onto their sliders -- needed after loading a pattern/file or undoing, so
 * the controls don't show stale values from whatever was edited before. */
function syncControlsFromState() {
  const straighten = currentOpParams('straighten', { degrees: 0 });
  const levels = currentOpParams('levels', { black: 0, white: 1, mid: 1 });
  const bc = currentOpParams('brightnessContrast', { brightness: 0, contrast: 0 });
  const blur = currentOpParams('blur', { radius: 0 });
  setPair('photoStraightenSlider', 'photoStraighten', straighten.degrees);
  setPair('photoLevelsBlackSlider', 'photoLevelsBlack', levels.black);
  setPair('photoLevelsWhiteSlider', 'photoLevelsWhite', levels.white);
  setPair('photoLevelsMidSlider', 'photoLevelsMid', levels.mid);
  setPair('photoBrightnessSlider', 'photoBrightness', bc.brightness);
  setPair('photoContrastSlider', 'photoContrast', bc.contrast);
  setPair('photoBlurSlider', 'photoBlur', blur.radius);
  syncCropFields();
  syncReliefToggle();
  if (_syncMirrors) _syncMirrors();
}

// Picking a pattern or loading your own photo turns the photo LAYER on (2026-10-10, Fred: the photo is its own layer over
// the board's filter, which stays as it was -- it used to switch the filter to 'photo'). Its checkbox (Surface > Photo)
// follows through applyParam; the rebuild comes with the photo's own change below.
function switchOnPhotoLayer() {
  if (!P.photoLayer) applyParam('photoLayer', true, { rebuild: false });
}

function loadImage(urlOrDataUrl, edits, tweaks) {
  switchOnPhotoLayer();
  P.photoImageDataUrl = urlOrDataUrl;
  P.photoEdits = edits;
  if (!P.filterTweaks) P.filterTweaks = {};
  P.filterTweaks.photo = { ...tweaks };
  syncControlsFromState();
  syncSaveButtonState();
  // the 'photo' stage on screen first and up until the decode is done (MEASURED, a phone at CPU x4: the decode blocked
  // ~1 s with nothing on screen before the rebuild's own card came up); the rebuild's card follows on
  withLoadingStage('photo', () => ensurePhotoDecoded(urlOrDataUrl).then(() => {
    drawPreview();
    notifyChange();
  }));
  // Seat D 2026-10-08 (matrix BLIND_BUDGET, 390 px, real touch, CPU x4): this commit (the step, and the brick panel's
  // control-requires sync it triggers -- the corner facts, ~70 ms cold) ran in the tap before the 'photo' card could
  // paint: 59-166 ms blind. It runs once the card is on screen now.
  withLoadingStageShownFirst('photo', () => {
    notifyChange();
    photoStep(); // a new photo (a file or a pattern) is one step
  });
}

/** Item 74a: a photo that came back from a SAVE (the session restore, a project load, a global undo) -- nothing else
 *  decodes it (measured on main: after a reload the restored photo stayed undecoded and the terrain was flat). One read
 *  point: a session saved before the upload downscale holds the full-size photo, so it is downscaled here and the small
 *  copy saved (the terrain is unchanged: the decode samples at the same size either way); then it is decoded and the
 *  terrain rebuilt with it. A no-op when there is no photo or it is already decoded. */
export function adoptStoredPhoto() {
  const stored = P.photoImageDataUrl;
  if (!stored || isPhotoReady(stored)) return Promise.resolve();
  return downscalePhotoDataUrl(stored).catch(() => stored).then((url) => {
    if (P.photoImageDataUrl !== stored) return null; // replaced meanwhile: that photo has its own follow-through
    const swapped = url !== stored;
    if (swapped) P.photoImageDataUrl = url;
    return ensurePhotoDecoded(url).then(() => {
      if (P.photoImageDataUrl !== url) return;
      syncControlsFromState();
      drawPreview();
      if (swapped) saveLastSession();
      if (_onChange) _onChange();
    });
  });
}

/** F35 item 28: the editor's Clear > Photo -- no photo, as on a new board (core/state.js defaults: no image,
 *  no edits, no pattern); the controls, the preview and the terrain follow through the usual change. */
/** F35 item 28: the photo's own state (for the Clear's one-step undo). */
export function photoState() {
  return { url: P.photoImageDataUrl ?? null, edits: JSON.parse(JSON.stringify(P.photoEdits || [])), patternId: P.photoPatternId ?? null };
}
/** Put a photoState() back (the Clear's undo), with the same follow-through as a clear. */
export function restorePhoto(state) {
  P.photoImageDataUrl = state.url;
  P.photoEdits = JSON.parse(JSON.stringify(state.edits || []));
  P.photoPatternId = state.patternId;
  syncControlsFromState();
  syncSaveButtonState();
  if (state.url) ensurePhotoDecoded(state.url).then(() => { drawPreview(); notifyChange(); });
  drawPreview();
  notifyChange();
}

export function clearPhoto() {
  P.photoImageDataUrl = null;
  P.photoEdits = [];
  P.photoPatternId = null;
  syncControlsFromState();
  syncSaveButtonState();
  drawPreview();
  notifyChange();
  photoStep();
}

function syncSaveButtonState() {
  const btn = document.getElementById('photoBtnSaveToPattern');
  if (!btn) return;
  btn.disabled = !P.photoPatternId;
  btn.title = P.photoPatternId ? '' : 'Load a built-in pattern first -- a photo you loaded yourself has no pattern entry to save into';
}

function saveSettingsToCurrentPattern() {
  if (!P.photoPatternId) return; // nothing to save into -- button is disabled in this state too
  const settings = editsToSettings(P.photoEdits, P.filterTweaks?.photo); // no relief: a pick no longer sets the board Z
  _patterns = _patterns.map((p) => (p.id === P.photoPatternId ? { ...p, settings } : p));
  const text = JSON.stringify(_patterns, null, 2);
  downloadTextFile(text, 'photo-patterns.json');
}

// Mirrors main/copy-log.js's own tiny "Save log" download idiom (FileSaver if
// loaded, else a plain <a download> fallback) -- not imported from there
// since that module's helper is private, and this is a few lines either way.
function downloadTextFile(text, name) {
  try {
    const blob = new Blob([text], { type: 'application/json' });
    if (typeof saveAs === 'function') { saveAs(blob, name); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (e) {
    console.warn('downloadTextFile failed:', e);
  }
}

function renderPatternRow(container) {
  if (!container) return;
  container.innerHTML = '';
  for (const pattern of _patterns) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = pattern.name;
    btn.className = 'photo-pattern-thumb';
    const img = document.createElement('img');
    img.src = pattern.thumb || pattern.image;
    img.alt = pattern.name;
    btn.appendChild(img);
    // seat D 2026-10-09 (matrix BLIND_BUDGET, MEASURED on main too): the pick's own sync work (the Photo filter switch, the
    // relief height, the controls sync) is ~50 ms in the tap with bricks laid -- at the long-task floor, so the row read
    // 0 or 50-80 ms blind by run. The 'photo' stage is on screen first now.
    btn.addEventListener('click', () => withLoadingStageShownFirst('photo', () => {
      P.photoPatternId = pattern.id;
      loadImage(
        pattern.image,
        settingsToPhotoEdits(pattern.settings),
        settingsToTweaks(pattern.settings),
      );
      syncSaveButtonState();
    }));
    container.appendChild(btn);
  }
}

// one native-size grey bitmap per photo image (a crop drag redraws the preview every tick)
let _bitmap = null;
function previewBitmap(img) {
  if (_bitmap && _bitmap.img === img) return _bitmap.canvas;
  if (typeof document === 'undefined') return null;
  const off = document.createElement('canvas');
  off.width = img.w; off.height = img.h;
  const octx = off.getContext && off.getContext('2d');
  if (!octx) return null;
  const imageData = octx.createImageData(img.w, img.h);
  for (let k = 0; k < img.w * img.h; k++) {
    const v = Math.max(0, Math.min(255, Math.round(img.data[k] * 255)));
    imageData.data[k * 4] = v; imageData.data[k * 4 + 1] = v; imageData.data[k * 4 + 2] = v; imageData.data[k * 4 + 3] = 255;
  }
  octx.putImageData(imageData, 0, 0); // putImageData can't be scaled -- native size offscreen, then blit scaled
  _bitmap = { img, canvas: off };
  return off;
}

/** Draws the RAW (unedited) source image plus the mirror-dim overlay -- or, while the Crop tab is open, the crop box
 *  over the photo in the crop's own frame (CROP_BOX) --
 * this canvas's one declared job (Fred: "show which half/quadrant ... is
 * used"), not a live preview of crop/levels/etc. (the 3D terrain preview,
 * already wired via notifyChange -> onChange -> scheduleRebuild, is the
 * "live" feedback for the EDITS themselves). */
function drawPreview() {
  const canvas = document.getElementById('photoPreviewCanvas');
  const ctx = canvas && canvas.getContext && canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#222';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const raw = getRawPhotoImage(P.photoImageDataUrl);
  const cropping = cropBoxShown() && !!(raw && raw.w && raw.h);
  const img = cropping ? straightenedPhoto(raw) : raw; // the crop box: the photo in the crop's own frame, uncropped
  if (img && img.w && img.h) {
    const off = previewBitmap(img);
    if (off) ctx.drawImage(off, 0, 0, img.w, img.h, 0, 0, canvas.width, canvas.height);
  }
  if (cropping) { drawCropBox(ctx, canvas); return; }

  const rects = computeMirrorDimRects(P.symmetry, P.symOffsetX, P.symOffsetY);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  for (const r of rects) {
    ctx.fillRect(r.x * canvas.width, r.y * canvas.height, r.w * canvas.width, r.h * canvas.height);
  }
}

function bindSlider(sliderId, numberId, opName, paramKey, fallback) {
  const slider = document.getElementById(sliderId);
  const number = document.getElementById(numberId);
  const apply = (raw, opts) => {
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return;
    if (slider) slider.value = String(v);
    if (number) number.value = String(v);
    const params = currentOpParams(opName, fallback);
    params[paramKey] = v;
    setAdjustableOp(opName, params, opts);
  };
  slider?.addEventListener('input', (e) => apply(e.target.value, { drag: true }));
  number?.addEventListener('input', (e) => apply(e.target.value));
  slider?.addEventListener('change', () => { notifyChange(); photoStep(); }); // the drag's one repaint + item 74f: one step, on release
  number?.addEventListener('change', photoStep);
}

export function initPhotoPanel({ onChange }) {
  _onChange = onChange;
  registerUndoPart('photo', { take: photoUndoState, restore: restorePhotoUndo }); // item 74f

  document.getElementById('editorTabPhoto')?.addEventListener('click', () => setEditorTab('photo'));
  renderPhotoToolbar(document.getElementById('editorToolbarPhoto'));
  _syncPhotoTabs = renderTabStrip(document.getElementById('photoTabStrip'), PHOTO_TABS, setPhotoTab, { idPrefix: 'photoTab_' });
  bindCropBox(document.getElementById('photoPreviewCanvas'));
  syncPhotoToolButtons();

  // 2026-10-10: the photo's effect params (depth / scale / offset / rotation / repeat) moved to Surface > Photo
  // (main/photo-layer-section.js, PHOTO_CONTROLS): every 3D setting there, this tab edits the image.

  loadPhotoPatterns().then((patterns) => {
    _patterns = patterns;
    renderPatternRow(document.getElementById('photoPatternRow'));
  });

  document.getElementById('photoFileInput')?.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const dataUrl = await downscalePhotoDataUrl(await fileToDataUrl(file)); // item 74a: stored downscaled
    P.photoPatternId = null; // a user's own upload has no pattern entry to save back into
    loadImage(dataUrl, [], {});
    syncSaveButtonState();
  });

  document.getElementById('photoBtnRotate')?.addEventListener('click', () => appendDiscreteOp('rotate90', { dir: 1 }));
  document.getElementById('photoBtnFlipH')?.addEventListener('click', () => appendDiscreteOp('flip', { axis: 'h' }));
  document.getElementById('photoBtnFlipV')?.addEventListener('click', () => appendDiscreteOp('flip', { axis: 'v' }));
  document.getElementById('photoBtnReliefRaised')?.addEventListener('click', () => setInvert(false));
  document.getElementById('photoBtnReliefCarved')?.addEventListener('click', () => setInvert(true));
  document.getElementById('photoBtnUndo')?.addEventListener('click', undo);

  // the crop is LIVE (Fred 2026-10-10: no Apply): a field's input previews it, its change (or a Reset) is one step
  const CROP_FIELDS = ['photoCropX', 'photoCropY', 'photoCropW', 'photoCropH'];
  const cropFromFields = () => {
    const pct = (id) => Math.max(0, Math.min(100, parseFloat(document.getElementById(id)?.value) || 0)) / 100;
    return { x: pct('photoCropX'), y: pct('photoCropY'), w: Math.max(0.01, pct('photoCropW')), h: Math.max(0.01, pct('photoCropH')) };
  };
  for (const id of CROP_FIELDS) {
    document.getElementById(id)?.addEventListener('input', () => setCrop(cropFromFields()));
    document.getElementById(id)?.addEventListener('change', photoStep);
  }
  document.getElementById('photoBtnResetCrop')?.addEventListener('click', () => { setCrop(CROP_FULL); syncCropFields(); photoStep(); });

  const straightenSlider = document.getElementById('photoStraightenSlider');
  const straightenNumber = document.getElementById('photoStraighten');
  const applyStraighten = (raw, opts) => {
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return;
    if (straightenSlider) straightenSlider.value = String(v);
    if (straightenNumber) straightenNumber.value = String(v);
    setStraighten(v, opts);
  };
  straightenSlider?.addEventListener('input', (e) => applyStraighten(e.target.value, { drag: true }));
  straightenNumber?.addEventListener('input', (e) => applyStraighten(e.target.value));
  straightenSlider?.addEventListener('change', () => { notifyChange(); photoStep(); }); // the drag's one repaint
  straightenNumber?.addEventListener('change', photoStep);

  bindSlider('photoLevelsBlackSlider', 'photoLevelsBlack', 'levels', 'black', { black: 0, white: 1, mid: 1 });
  bindSlider('photoLevelsWhiteSlider', 'photoLevelsWhite', 'levels', 'white', { black: 0, white: 1, mid: 1 });
  bindSlider('photoLevelsMidSlider', 'photoLevelsMid', 'levels', 'mid', { black: 0, white: 1, mid: 1 });
  bindSlider('photoBrightnessSlider', 'photoBrightness', 'brightnessContrast', 'brightness', { brightness: 0, contrast: 0 });
  bindSlider('photoContrastSlider', 'photoContrast', 'brightnessContrast', 'contrast', { brightness: 0, contrast: 0 });
  bindSlider('photoBlurSlider', 'photoBlur', 'blur', 'radius', { radius: 0 });

  document.getElementById('photoBtnSaveToPattern')?.addEventListener('click', saveSettingsToCurrentPattern);
  syncSaveButtonState();

  // Keep the mirror-dim overlay honest if Symmetry changes while this panel is visible.
  ['symmetry', 'symOffsetXSlider', 'symOffsetYSlider'].forEach((id) => {
    const el = document.getElementById(id);
    el?.addEventListener('input', drawPreview);
    el?.addEventListener('change', drawPreview);
  });

  if (P.photoImageDataUrl) {
    syncControlsFromState();
    adoptStoredPhoto();
  }
}

/** The Photo tab is ALWAYS visible now (its own top-level tab) -- this re-syncs the controls/preview when the photo
 * layer is on, so stale values don't linger. Called once on init (main.js). */
export function syncPhotoPanel() {
  if (P.photoLayer) {
    syncControlsFromState();
    drawPreview();
  }
}

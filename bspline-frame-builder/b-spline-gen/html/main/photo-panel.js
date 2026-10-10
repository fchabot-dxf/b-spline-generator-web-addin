/**
 * main/photo-panel.js — F34 item 1: the Photo filter's own top-level tab
 * (pattern row + "Load my own" + crop/rotate/flip/levels/brightness/
 * contrast/blur/invert + undo) -- Fred: its own tab next to Filter etc.,
 * not nested inside Filter, and ALWAYS visible/clickable (unlike the old
 * Filter-nested sub-panel it replaced). Picking a built-in pattern or
 * loading your own photo here switches noiseType to 'photo' itself
 * (switchToPhotoFilter() below), the same as picking "Photo" from the
 * Filter panel's own dropdown would.
 *
 * The filter's own EFFECT params (depth/scale/offsetX/offsetY/rotation/
 * repeat) need NO custom UI here -- they're declared via the generic
 * `tweaks` schema (core/noise/photo.js), so the EXISTING Edit-Filter panel
 * (inside the Filter tab, shared by every filter) already renders sliders
 * for them; this tab is only the image + its own prepare/edit steps.
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
  loadPhotoPatterns, settingsToPhotoEdits, settingsToTweaks, settingsToRelief, editsToSettings,
  DEFAULT_PHOTO_RELIEF_IN, MAX_PHOTO_RELIEF_IN,
} from '../core/photo/patterns.js';
import { fileToDataUrl, downscalePhotoDataUrl } from '../core/photo/codec.js';
import { ensurePhotoDecoded, getRawPhotoImage, isPhotoReady } from '../core/photo/state.js';
import { withLoadingStage, withLoadingStageShownFirst } from '../core/loading-signal.js';
import { computeMirrorDimRects } from '../core/photo/mirror-dim.js';
import { registerTweaksTarget, renderTweaksPanel } from '../core/noise/tweaks-ui.js';
import { applyParam } from './param-manager.js';
import { inEditor3dAction } from '../core/in-editor-3d.js';
import { refreshEditorTopView } from '../core/render-topview.js';
import { setEditorTab } from './editor-tabs.js';
import { renderToolRegistry, syncToolRegistryButtons } from '../editor/editor-tool-registry.js';
import { renderTabStrip } from '../editor/tab-strip.js';
import { photoToolIconSvg } from '../editor/photo-tool-icons.js';
import { registerUndoPart } from '../editor/undo-parts.js';
import { commitEdit } from '../editor/editor-commit.js';

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
}

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
}

/** Item 74f (advisor; seat D's Photo audit, measured: crop / levels / brightness / blur / relief changed the 3D but the
 *  editor's Undo did not take them back -- only the panel's own Undo button did): the photo (its source, edit list,
 *  pattern and relief height) rides in every editor undo entry (item 38's parts), and each photo gesture is ONE editor
 *  step -- a slider on release ('change'), a button on click, a load / pattern / clear when it lands. Once the photo is in
 *  every entry, every photo change must be a step, or an Undo of something else would take the photo back with it.
 *  The panel's own Undo button keeps working as before (and is a step too). */
const photoUndoState = () => ({ ...photoState(), reliefIn: P.carveZ ?? null });
const samePhoto = (a, b) => !!a && !!b && a.url === b.url && a.patternId === b.patternId && a.reliefIn === b.reliefIn
  && JSON.stringify(a.edits) === JSON.stringify(b.edits);
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
  restorePhoto(state);
  if (state.reliefIn != null && state.reliefIn !== P.carveZ) { setReliefHeight(state.reliefIn, { raw: true }); syncReliefHeightDisplay(); }
}

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
}

const clampReliefIn = (v) => Math.min(MAX_PHOTO_RELIEF_IN, Math.max(0.01, v));

// F34 item 3 (Fred: "height wouldn't ever be more than 1/4 for now"): the
// Photo tab's own Max Height control, bound to the SAME real `carveZ` param
// every other filter already uses downstream (Send/thicken/CAM) -- just
// presented here with photo-appropriate bounds/default instead of the
// generic Skeleton tab's 0.1-20in Carve Depth slider.
/** `raw`: an UNDO puts the saved value back as it was (seat D 2026-10-08, undo map: P.carveZ is the board's own carve
 *  depth too -- 1.5 in on a fresh board -- and the photo clamp turned an undo of a pattern pick into 0.25). */
function setReliefHeight(v, { raw = false, drag = false } = {}) {
  const z = raw ? v : clampReliefIn(v);
  // core/in-editor-3d.js 'relief': with the editor open the value lands without a rebuild, the backdrop shows it (a drag
  // tick: not yet -- its release repaints)
  const action = inEditor3dAction('relief', { drag });
  if (action === 'rebuild') applyParam('carveZ', z);
  else {
    applyParam('carveZ', z, { rebuild: false });
    if (action === 'backdrop') refreshEditorTopView();
  }
}

function syncReliefHeightDisplay() {
  setPair('photoReliefHeightSlider', 'photoReliefHeight', clampReliefIn(P.carveZ ?? DEFAULT_PHOTO_RELIEF_IN));
}

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
  syncReliefToggle();
  syncReliefHeightDisplay();
}

// Picking a pattern or loading your own photo IS choosing the Photo filter
// -- the Photo tab is its own top-level tab now (not nested inside Filter),
// so there is no other moment where the user "selects Photo" first. Mirrors
// exactly what the Filter panel's own #noiseType <select> change already
// does (dispatching a real 'change' event, not calling internals directly,
// so every existing listener -- applyParam's rebuild, renderTweaksPanel,
// this module's own) fires the normal way, once.
function switchToPhotoFilter() {
  const select = document.getElementById('noiseType');
  if (select && select.value !== 'photo') {
    select.value = 'photo';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function loadImage(urlOrDataUrl, edits, tweaks, reliefIn = DEFAULT_PHOTO_RELIEF_IN) {
  switchToPhotoFilter();
  P.photoImageDataUrl = urlOrDataUrl;
  P.photoEdits = edits;
  if (!P.filterTweaks) P.filterTweaks = {};
  P.filterTweaks.photo = { ...tweaks };
  setReliefHeight(reliefIn);
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
  const settings = editsToSettings(P.photoEdits, P.filterTweaks?.photo, P.carveZ);
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
        settingsToRelief(pattern.settings),
      );
      syncSaveButtonState();
    }));
    container.appendChild(btn);
  }
}

/** Draws the RAW (unedited) source image plus the mirror-dim overlay --
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
  if (raw && raw.w && raw.h) {
    const imageData = ctx.createImageData(raw.w, raw.h);
    for (let k = 0; k < raw.w * raw.h; k++) {
      const v = Math.max(0, Math.min(255, Math.round(raw.data[k] * 255)));
      imageData.data[k * 4] = v;
      imageData.data[k * 4 + 1] = v;
      imageData.data[k * 4 + 2] = v;
      imageData.data[k * 4 + 3] = 255;
    }
    // putImageData can't be scaled directly -- render native-size offscreen, then blit scaled.
    const off = document.createElement('canvas');
    off.width = raw.w;
    off.height = raw.h;
    off.getContext('2d').putImageData(imageData, 0, 0);
    ctx.drawImage(off, 0, 0, raw.w, raw.h, 0, 0, canvas.width, canvas.height);
  }

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
  syncPhotoToolButtons();

  // F34 item 1 (Fred: "show the photo's effect params inside the Photo tab
  // too ... reuse the same generic Edit Filter control rendering, not a
  // copy"): a second render target for the SAME tweaks schema/state the
  // Filter panel's own "Edit Filter" panel uses.
  const photoTweaksBody = document.getElementById('photoTweaksBody');
  if (photoTweaksBody) {
    registerTweaksTarget(null, photoTweaksBody);
    renderTweaksPanel(document.getElementById('noiseType')?.value || 'simplex');
  }

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

  document.getElementById('photoBtnApplyCrop')?.addEventListener('click', () => {
    const pct = (id) => Math.max(0, Math.min(100, parseFloat(document.getElementById(id)?.value) || 0)) / 100;
    appendDiscreteOp('crop', {
      x: pct('photoCropX'), y: pct('photoCropY'),
      w: Math.max(0.01, pct('photoCropW')), h: Math.max(0.01, pct('photoCropH')),
    });
  });

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

  const reliefSlider = document.getElementById('photoReliefHeightSlider');
  const reliefNumber = document.getElementById('photoReliefHeight');
  const applyRelief = (raw, opts) => {
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return;
    setReliefHeight(v, opts);
    syncReliefHeightDisplay();
  };
  reliefSlider?.addEventListener('input', (e) => applyRelief(e.target.value, { drag: true }));
  reliefNumber?.addEventListener('input', (e) => applyRelief(e.target.value));
  reliefSlider?.addEventListener('change', (e) => { applyRelief(e.target.value); photoStep(); }); // the drag's one repaint
  reliefNumber?.addEventListener('change', photoStep);

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

/** The Photo tab is ALWAYS visible now (its own top-level tab, not a
 * Filter-nested sub-panel that hides for other filters) -- this just
 * re-syncs the controls/preview when switching TO photo, so stale values
 * from whatever filter was active before don't linger. Called once on init
 * and on every noiseType change (main.js), same call sites core/noise/
 * tweaks-ui.js's own renderTweaksPanel uses. */
export function syncPhotoPanel(noiseType) {
  if (noiseType === 'photo') {
    syncControlsFromState();
    drawPreview();
  }
}

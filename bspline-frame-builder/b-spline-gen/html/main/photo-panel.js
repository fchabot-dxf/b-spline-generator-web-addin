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
import { fileToDataUrl } from '../core/photo/codec.js';
import { ensurePhotoDecoded, getRawPhotoImage } from '../core/photo/state.js';
import { computeMirrorDimRects } from '../core/photo/mirror-dim.js';
import { registerTweaksTarget, renderTweaksPanel } from '../core/noise/tweaks-ui.js';
import { applyParam } from './param-manager.js';
import { setEditorTab } from './editor-tabs.js';
import { renderToolRegistry, syncToolRegistryButtons } from '../editor/editor-tool-registry.js';
import { photoToolIconSvg } from '../editor/photo-tool-icons.js';

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

let _activePhotoTool = PHOTO_TOOLS[0].id;
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
  for (const tool of PHOTO_TOOLS) {
    const section = document.getElementById(`photoToolSection_${tool.id}`);
    if (section) section.style.display = tool.id === _activePhotoTool ? '' : 'none';
  }
}

function selectPhotoTool(id) {
  _activePhotoTool = id;
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

function notifyChange() {
  saveLastSession();
  if (_onChange) _onChange();
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

function setAdjustableOp(opName, params) {
  const steps = (P.photoEdits || []).slice();
  if (steps.length && steps[steps.length - 1].op === opName) {
    steps[steps.length - 1] = { op: opName, params };
  } else {
    steps.push({ op: opName, params });
  }
  P.photoEdits = steps;
  notifyChange();
}

// Straighten is declared to always come FIRST (advisor/Fred: "edit order:
// straighten -> crop -> the rest") -- unlike the other adjustable ops
// (setAdjustableOp above), re-adjusting it must find and update its own
// step WHEREVER it sits, never append a second one after crop.
function setStraighten(degrees) {
  const steps = (P.photoEdits || []).slice();
  const idx = steps.findIndex((s) => s.op === 'straighten');
  const step = { op: 'straighten', params: { degrees } };
  if (idx >= 0) steps[idx] = step;
  else steps.unshift(step);
  P.photoEdits = steps;
  notifyChange();
}

function appendDiscreteOp(opName, params) {
  P.photoEdits = [...(P.photoEdits || []), { op: opName, params }];
  notifyChange();
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
function setReliefHeight(v) {
  applyParam('carveZ', clampReliefIn(v));
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
  ensurePhotoDecoded(urlOrDataUrl).then(() => {
    drawPreview();
    notifyChange();
  });
  notifyChange();
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
    btn.addEventListener('click', () => {
      P.photoPatternId = pattern.id;
      loadImage(
        pattern.image,
        settingsToPhotoEdits(pattern.settings),
        settingsToTweaks(pattern.settings),
        settingsToRelief(pattern.settings),
      );
      syncSaveButtonState();
    });
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
  const apply = (raw) => {
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return;
    if (slider) slider.value = String(v);
    if (number) number.value = String(v);
    const params = currentOpParams(opName, fallback);
    params[paramKey] = v;
    setAdjustableOp(opName, params);
  };
  slider?.addEventListener('input', (e) => apply(e.target.value));
  number?.addEventListener('input', (e) => apply(e.target.value));
}

export function initPhotoPanel({ onChange }) {
  _onChange = onChange;

  document.getElementById('editorTabPhoto')?.addEventListener('click', () => setEditorTab('photo'));
  renderPhotoToolbar(document.getElementById('editorToolbarPhoto'));
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
    const dataUrl = await fileToDataUrl(file);
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
  const applyStraighten = (raw) => {
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return;
    if (straightenSlider) straightenSlider.value = String(v);
    if (straightenNumber) straightenNumber.value = String(v);
    setStraighten(v);
  };
  straightenSlider?.addEventListener('input', (e) => applyStraighten(e.target.value));
  straightenNumber?.addEventListener('input', (e) => applyStraighten(e.target.value));

  bindSlider('photoLevelsBlackSlider', 'photoLevelsBlack', 'levels', 'black', { black: 0, white: 1, mid: 1 });
  bindSlider('photoLevelsWhiteSlider', 'photoLevelsWhite', 'levels', 'white', { black: 0, white: 1, mid: 1 });
  bindSlider('photoLevelsMidSlider', 'photoLevelsMid', 'levels', 'mid', { black: 0, white: 1, mid: 1 });
  bindSlider('photoBrightnessSlider', 'photoBrightness', 'brightnessContrast', 'brightness', { brightness: 0, contrast: 0 });
  bindSlider('photoContrastSlider', 'photoContrast', 'brightnessContrast', 'contrast', { brightness: 0, contrast: 0 });
  bindSlider('photoBlurSlider', 'photoBlur', 'blur', 'radius', { radius: 0 });

  const reliefSlider = document.getElementById('photoReliefHeightSlider');
  const reliefNumber = document.getElementById('photoReliefHeight');
  const applyRelief = (raw) => {
    const v = parseFloat(raw);
    if (!Number.isFinite(v)) return;
    setReliefHeight(v);
    syncReliefHeightDisplay();
  };
  reliefSlider?.addEventListener('input', (e) => applyRelief(e.target.value));
  reliefNumber?.addEventListener('input', (e) => applyRelief(e.target.value));

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
    ensurePhotoDecoded(P.photoImageDataUrl).then(drawPreview);
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

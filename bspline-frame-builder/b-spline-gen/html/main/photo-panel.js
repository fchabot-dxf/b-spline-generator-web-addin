/**
 * main/photo-panel.js — F34 item 1: the Photo filter's own small editor
 * sub-panel (pattern row + "Load my own" + crop/rotate/flip/levels/
 * brightness/contrast/blur/invert + undo), shown only when noiseType ===
 * 'photo' (same show/hide convention core/noise/tweaks-ui.js's own
 * Edit-Filter sub-panel uses for #filterTweaksPanel).
 *
 * The filter's own EFFECT params (depth/scale/offsetX/offsetY/rotation/
 * repeat) need NO custom UI here -- they're declared via the generic
 * `tweaks` schema (core/noise/photo.js), so the EXISTING Edit-Filter panel
 * already renders sliders for them.
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
import { loadPhotoPatterns, settingsToPhotoEdits, settingsToTweaks } from '../core/photo/patterns.js';
import { fileToDataUrl } from '../core/photo/codec.js';
import { ensurePhotoDecoded, getRawPhotoImage } from '../core/photo/state.js';
import { computeMirrorDimRects } from '../core/photo/mirror-dim.js';

let _onChange = null;
let _patterns = [];

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

function appendDiscreteOp(opName, params) {
  P.photoEdits = [...(P.photoEdits || []), { op: opName, params }];
  notifyChange();
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
  const levels = currentOpParams('levels', { black: 0, white: 1, mid: 1 });
  const bc = currentOpParams('brightnessContrast', { brightness: 0, contrast: 0 });
  const blur = currentOpParams('blur', { radius: 0 });
  setPair('photoLevelsBlackSlider', 'photoLevelsBlack', levels.black);
  setPair('photoLevelsWhiteSlider', 'photoLevelsWhite', levels.white);
  setPair('photoLevelsMidSlider', 'photoLevelsMid', levels.mid);
  setPair('photoBrightnessSlider', 'photoBrightness', bc.brightness);
  setPair('photoContrastSlider', 'photoContrast', bc.contrast);
  setPair('photoBlurSlider', 'photoBlur', blur.radius);
}

function loadImage(urlOrDataUrl, edits, tweaks) {
  P.photoImageDataUrl = urlOrDataUrl;
  P.photoEdits = edits;
  if (!P.filterTweaks) P.filterTweaks = {};
  P.filterTweaks.photo = { ...tweaks };
  syncControlsFromState();
  ensurePhotoDecoded(urlOrDataUrl).then(() => {
    drawPreview();
    notifyChange();
  });
  notifyChange();
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
      loadImage(pattern.image, settingsToPhotoEdits(pattern.settings), settingsToTweaks(pattern.settings));
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

  loadPhotoPatterns().then((patterns) => {
    _patterns = patterns;
    renderPatternRow(document.getElementById('photoPatternRow'));
  });

  document.getElementById('photoFileInput')?.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    loadImage(dataUrl, [], {});
  });

  document.getElementById('photoBtnRotate')?.addEventListener('click', () => appendDiscreteOp('rotate90', { dir: 1 }));
  document.getElementById('photoBtnFlipH')?.addEventListener('click', () => appendDiscreteOp('flip', { axis: 'h' }));
  document.getElementById('photoBtnFlipV')?.addEventListener('click', () => appendDiscreteOp('flip', { axis: 'v' }));
  document.getElementById('photoBtnInvert')?.addEventListener('click', () => appendDiscreteOp('invert', {}));
  document.getElementById('photoBtnUndo')?.addEventListener('click', undo);

  document.getElementById('photoBtnApplyCrop')?.addEventListener('click', () => {
    const pct = (id) => Math.max(0, Math.min(100, parseFloat(document.getElementById(id)?.value) || 0)) / 100;
    appendDiscreteOp('crop', {
      x: pct('photoCropX'), y: pct('photoCropY'),
      w: Math.max(0.01, pct('photoCropW')), h: Math.max(0.01, pct('photoCropH')),
    });
  });

  bindSlider('photoLevelsBlackSlider', 'photoLevelsBlack', 'levels', 'black', { black: 0, white: 1, mid: 1 });
  bindSlider('photoLevelsWhiteSlider', 'photoLevelsWhite', 'levels', 'white', { black: 0, white: 1, mid: 1 });
  bindSlider('photoLevelsMidSlider', 'photoLevelsMid', 'levels', 'mid', { black: 0, white: 1, mid: 1 });
  bindSlider('photoBrightnessSlider', 'photoBrightness', 'brightnessContrast', 'brightness', { brightness: 0, contrast: 0 });
  bindSlider('photoContrastSlider', 'photoContrast', 'brightnessContrast', 'contrast', { brightness: 0, contrast: 0 });
  bindSlider('photoBlurSlider', 'photoBlur', 'blur', 'radius', { radius: 0 });

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

/** Show/hide the whole sub-panel based on the active filter (main.js calls
 * this once on init and on every noiseType change, same call sites
 * core/noise/tweaks-ui.js's own renderTweaksPanel uses). */
export function syncPhotoPanel(noiseType) {
  const panel = document.getElementById('photoEditorPanel');
  if (panel) panel.style.display = noiseType === 'photo' ? '' : 'none';
  if (noiseType === 'photo') {
    syncControlsFromState();
    drawPreview();
  }
}

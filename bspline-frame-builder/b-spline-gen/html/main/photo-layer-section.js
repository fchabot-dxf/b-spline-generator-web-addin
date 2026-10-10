/**
 * main/photo-layer-section.js — 2026-10-10 (Fred: the photo as its own LAYER on top of the chosen filter): the
 * Surface > Photo section. Fred's placement rule: the editor's Photo tab EDITS THE IMAGE; every 3D setting of the photo
 * lives here -- and some image edits are offered here too, MIRRORED (the same state, the same undo steps as the tab's
 * own controls: main/photo-panel.js photoEditApi). One declaration says where each control shows: PHOTO_CONTROLS,
 * `home` '2d' (the Photo tab only), '3d' (this section only) or 'both'. This section is rendered from it; the Photo tab's
 * own widgets are its existing markup, listed here by id (`ids2d`) so the split stays one fact (tests check every id).
 *
 * State, one source per setting (no new copies): the layer on/off and "Filter shows through" are P keys (bound the
 * generic way, ui-bindings.js); the photo's effect params are P.filterTweaks.photo (the same rows as any filter's
 * Edit-Filter panel, core/noise/tweaks-ui.js buildRow); the image edits are P.photoEdits. No Max Height here (Fred,
 * 2026-10-10): it is the board's Z, edited in Board > Carve Depth only.
 */
import { P } from '../core/state.js';
import { NoiseTweaks } from '../core/noise/index.js';
import { buildRow, setTweak } from '../core/noise/tweaks-ui.js';
import { photoEditApi, onPhotoControlsSynced } from './photo-panel.js';
import { openEditorOn } from './frame-panel.js';

/** The section's groups, in order (a control with no group sits above them). */
export const PHOTO_GROUPS = Object.freeze([
  Object.freeze({ id: 'relief', label: 'Relief' }),
  Object.freeze({ id: 'placement', label: 'Placement', note: 'on the board' }),
  Object.freeze({ id: 'image', label: 'Image', note: '⇄ same as the Photo tab' }),
]);

/** Every photo control, once. kind: what renders it here (none for a '2d' one). Fred's picks (2026-10-10): Rotation is
 *  ONE slider here with -90 / +90 steps (the image-edit Rotate 90 stays in the Photo tab); mirrored: flip, brightness, contrast, blur, relief raised / carved; levels, straighten and crop stay 2D. */
export const PHOTO_CONTROLS = Object.freeze([
  { id: 'layer', home: '3d', kind: 'param-check', param: 'photoLayer', label: 'Photo layer on' },
  { id: 'source', home: '3d', kind: 'source' },
  { id: 'filterAmount', needsLayer: true, home: '3d', kind: 'param-slider', param: 'photoFilterAmount', slider: 'photoFilterAmountSlider',
    label: 'Filter shows through (%)', min: 0, max: 100, step: 1,
    note: '0% = the photo only; the Filter section\'s terrain adds its relief on top' },
  { id: 'relief', needsLayer: true, home: 'both', group: 'relief', kind: 'relief', label: 'Relief',
    ids2d: ['photoBtnReliefRaised', 'photoBtnReliefCarved'], ids3d: ['photo3dReliefRaised', 'photo3dReliefCarved'] },
  { id: 'depth', needsLayer: true, home: '3d', group: 'relief', kind: 'tweak', tweak: 'depth' },
  { id: 'scale', needsLayer: true, home: '3d', group: 'placement', kind: 'tweak', tweak: 'scale' },
  { id: 'offsetX', needsLayer: true, home: '3d', group: 'placement', kind: 'tweak', tweak: 'offsetX' },
  { id: 'offsetY', needsLayer: true, home: '3d', group: 'placement', kind: 'tweak', tweak: 'offsetY' },
  { id: 'rotation', needsLayer: true, home: '3d', group: 'placement', kind: 'tweak', tweak: 'rotation', steps: [-90, 90] },
  { id: 'repeat', needsLayer: true, home: '3d', group: 'placement', kind: 'tweak-check', tweak: 'repeat', label: 'Repeat (tile the photo)' },
  { id: 'flip', needsLayer: true, home: 'both', group: 'image', kind: 'flip', ids2d: ['photoBtnFlipH', 'photoBtnFlipV'], ids3d: ['photo3dFlipH', 'photo3dFlipV'] },
  { id: 'blur', needsLayer: true, home: 'both', group: 'image', kind: 'edit-slider', label: 'Blur', op: 'blur', key: 'radius', fallback: { radius: 0 },
    ids2d: ['photoBlurSlider', 'photoBlur'], ids3d: ['photo3dBlurSlider', 'photo3dBlur'] },
  { id: 'brightness', needsLayer: true, home: 'both', group: 'image', kind: 'edit-slider', label: 'Brightness', op: 'brightnessContrast', key: 'brightness',
    fallback: { brightness: 0, contrast: 0 }, ids2d: ['photoBrightnessSlider', 'photoBrightness'], ids3d: ['photo3dBrightnessSlider', 'photo3dBrightness'] },
  { id: 'contrast', needsLayer: true, home: 'both', group: 'image', kind: 'edit-slider', label: 'Contrast', op: 'brightnessContrast', key: 'contrast',
    fallback: { brightness: 0, contrast: 0 }, ids2d: ['photoContrastSlider', 'photoContrast'], ids3d: ['photo3dContrastSlider', 'photo3dContrast'] },
  // the Photo tab only
  { id: 'source2d', home: '2d', ids2d: ['photoPatternRow', 'photoFileInput'] },
  { id: 'crop', home: '2d', ids2d: ['photoCropX', 'photoCropY', 'photoCropW', 'photoCropH'] },
  { id: 'straighten', home: '2d', ids2d: ['photoStraightenSlider', 'photoStraighten'] },
  { id: 'rotate90', home: '2d', ids2d: ['photoBtnRotate'] },
  { id: 'levels', home: '2d', ids2d: ['photoLevelsBlackSlider', 'photoLevelsBlack', 'photoLevelsWhiteSlider', 'photoLevelsWhite', 'photoLevelsMidSlider', 'photoLevelsMid'] },
  { id: 'undo', home: '2d', ids2d: ['photoBtnUndo'] },
  { id: 'savePattern', home: '2d', ids2d: ['photoBtnSaveToPattern'] },
]);

const el = (tag, attrs = {}, kids = []) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style') e.style.cssText = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
  }
  for (const k of kids) if (k) e.appendChild(k);
  return e;
};
const label = (text) => el('label', { class: 'cad-label', text });
/** A slider + stepper pair, ranged like `like` (the Photo tab's own twin, one declared range) or from `c`. */
function sliderRow(sliderId, numberId, c, like) {
  const range = (k) => String(like?.getAttribute(k) ?? c[k]);
  const s = el('input', { type: 'range', id: sliderId, class: 'cad-slider', min: range('min'), max: range('max'), step: range('step') });
  const n = el('input', { type: 'number', id: numberId, min: range('min'), max: range('max'), step: range('step') });
  // the unit is in the label ("Filter shows through (%)"): inside the stepper it sat
  // cramped against its + button on the phone
  const stepper = el('div', { class: 'cad-stepper', style: 'width:66px;' }, [n]);
  return el('div', { class: 'cad-slider-row', style: 'margin-bottom:10px;' }, [s, stepper]);
}
const checkRow = (id, text) => el('label', { class: 'cad-label photo-layer-check' }, [el('input', { type: 'checkbox', id }), el('span', { text })]);

const _tweakHosts = new Map(); // tweak key -> its row's host element (re-rendered on sync)
function renderTweak(host, key) {
  const schema = (NoiseTweaks.photo || []).find((t) => t.key === key);
  host.innerHTML = '';
  if (schema) host.appendChild(buildRow('photo', schema));
}

const RENDER = {
  'param-check': (c) => checkRow(c.param, c.label),
  source: () => el('div', { class: 'photo-layer-source' }, [
    el('span', { id: 'photoLayerSourceName', class: 'photo-layer-source-name' }),
    el('button', { type: 'button', id: 'photoLayerEditImage', class: 'cad-btn cad-btn-secondary', text: '✏️ Edit image…' }),
  ]),
  'param-slider': (c) => el('div', {}, [label(c.label), sliderRow(c.slider, c.param, c), c.note ? el('div', { class: 'photo-layer-note', text: c.note }) : null]),
  relief: (c) => el('div', { class: 'relief-toggle', style: 'margin-bottom:8px;' }, [
    el('button', { type: 'button', class: 'relief-toggle-btn', id: c.ids3d[0], text: 'Raised' }),
    el('button', { type: 'button', class: 'relief-toggle-btn', id: c.ids3d[1], text: 'Carved' }),
  ]),
  tweak: (c) => {
    const host = el('div', { class: 'photo-layer-tweak' });
    _tweakHosts.set(c.tweak, host);
    renderTweak(host, c.tweak);
    if (!c.steps) return host;
    const steps = el('div', { class: 'photo-layer-buttons' }, c.steps.map((d) => el('button', {
      type: 'button', class: 'cad-btn cad-btn-secondary', 'data-photo-step': `${c.tweak}:${d}`, text: d < 0 ? `⟲ ${d}°` : `⟳ +${d}°`,
    })));
    return el('div', {}, [host, steps]);
  },
  'tweak-check': (c) => checkRow(`photoLayerTweak_${c.tweak}`, c.label),
  flip: (c) => el('div', { class: 'photo-layer-buttons' }, [
    el('button', { type: 'button', class: 'cad-btn cad-btn-secondary', id: c.ids3d[0], text: '⇋ Flip H' }),
    el('button', { type: 'button', class: 'cad-btn cad-btn-secondary', id: c.ids3d[1], text: '⇵ Flip V' }),
  ]),
  'edit-slider': (c) => el('div', {}, [label(c.label), sliderRow(c.ids3d[0], c.ids3d[1], c, document.getElementById(c.ids2d[0]))]),
};

/** Build the section from PHOTO_CONTROLS into `body` (main.js: before the Photo tab and the generic binder run). */
export function renderPhotoLayerSection(body) {
  if (!body) return;
  body.innerHTML = '';
  _tweakHosts.clear();
  const shown = PHOTO_CONTROLS.filter((c) => c.home !== '2d');
  const add = (c) => { const n = RENDER[c.kind](c); if (c.needsLayer) n.setAttribute('data-needs-layer', '1'); body.appendChild(n); };
  for (const c of shown.filter((x) => !x.group)) add(c);
  // the line that says why the rest is greyed while the layer is off
  body.appendChild(el('div', { id: 'photoLayerOffNote', class: 'photo-layer-note', text: 'Turn the photo layer on to use these settings.' }));
  for (const g of PHOTO_GROUPS) {
    const mine = shown.filter((c) => c.group === g.id);
    if (!mine.length) continue;
    body.appendChild(el('label', { class: 'cad-label photo-layer-group' }, [
      el('span', { text: g.label }), g.note ? el('span', { class: 'photo-layer-group-note', text: ` ${g.note}` }) : null]));
    for (const c of mine) add(c);
  }
}

const byId = (id) => document.getElementById(id);
const setPair = (sliderId, numberId, v) => { const s = byId(sliderId), n = byId(numberId); if (s) s.value = String(v); if (n) n.value = String(v); };

/** Reflect the state on every control of this section (both views follow each other through photo-panel.js). */
export function syncPhotoLayerSection() {
  for (const [key, host] of _tweakHosts) renderTweak(host, key);
  const t = (P.filterTweaks && P.filterTweaks.photo) || {};
  for (const c of PHOTO_CONTROLS) {
    if (c.kind === 'edit-slider') setPair(c.ids3d[0], c.ids3d[1], photoEditApi.opValue(c.op, c.key, c.fallback));
    else if (c.kind === 'relief') {
      const inv = photoEditApi.isInverted();
      byId(c.ids3d[0])?.classList.toggle('active', !inv);
      byId(c.ids3d[1])?.classList.toggle('active', inv);
    } else if (c.kind === 'tweak-check') {
      const box = byId(`photoLayerTweak_${c.tweak}`);
      if (box) box.checked = (t[c.tweak] ?? 0) >= 0.5;
    }
  }
  // 2026-10-10 (Fred: with the layer off, "Filter shows through" at 99 % looked live and did nothing -- MEASURED: the
  // heights equal a board that never had a photo): every photo-only control (needsLayer) is greyed while the layer is off
  const off = !P.photoLayer;
  for (const n of document.querySelectorAll('#photoLayerBody [data-needs-layer]')) {
    n.classList.toggle('photo-layer-needs-on', off);
    for (const x of n.querySelectorAll('input, button')) x.disabled = off;
  }
  const note = byId('photoLayerOffNote');
  if (note) note.hidden = !off;
  const name = byId('photoLayerSourceName');
  if (name) name.textContent = !P.photoImageDataUrl ? 'No photo yet' : (P.photoPatternId ? `Pattern: ${P.photoPatternId.replace(/_/g, ' ')}` : 'Your photo');
}

/** Wire the section (main.js, after the Photo tab's own wiring): the mirrored edits through the tab's own steps. */
export function bindPhotoLayerSection() {
  onPhotoControlsSynced(syncPhotoLayerSection);
  // the layer switch greys / ungreys the rest -- after the generic binder (ui-bindings.js) has written P.photoLayer
  byId('photoLayer')?.addEventListener('change', () => queueMicrotask(syncPhotoLayerSection));
  byId('photoLayerEditImage')?.addEventListener('click', () => openEditorOn('photo'));
  for (const c of PHOTO_CONTROLS) {
    if (c.kind === 'relief') {
      byId(c.ids3d[0])?.addEventListener('click', () => photoEditApi.setInvert(false));
      byId(c.ids3d[1])?.addEventListener('click', () => photoEditApi.setInvert(true));
    } else if (c.kind === 'flip') {
      byId(c.ids3d[0])?.addEventListener('click', () => photoEditApi.flip('h'));
      byId(c.ids3d[1])?.addEventListener('click', () => photoEditApi.flip('v'));
    } else if (c.kind === 'edit-slider') {
      const apply = (raw, opts) => { const v = parseFloat(raw); if (Number.isFinite(v)) photoEditApi.setOpValue(c.op, c.key, v, c.fallback, opts); };
      byId(c.ids3d[0])?.addEventListener('input', (e) => apply(e.target.value, { drag: true }));
      byId(c.ids3d[0])?.addEventListener('change', () => photoEditApi.release());
      byId(c.ids3d[1])?.addEventListener('input', (e) => apply(e.target.value));
      byId(c.ids3d[1])?.addEventListener('change', () => photoEditApi.release());
    } else if (c.kind === 'tweak-check') {
      byId(`photoLayerTweak_${c.tweak}`)?.addEventListener('change', (e) => setTweak('photo', c.tweak, e.target.checked ? 1 : 0));
    } else if (c.kind === 'tweak' && c.steps) {
      for (const b of document.querySelectorAll(`[data-photo-step^="${c.tweak}:"]`)) {
        b.addEventListener('click', () => {
          const schema = (NoiseTweaks.photo || []).find((t) => t.key === c.tweak);
          const cur = P.filterTweaks?.photo?.[c.tweak] ?? schema?.default ?? 0;
          let v = cur + Number(b.getAttribute('data-photo-step').split(':')[1]);
          if (c.tweak === 'rotation') v = ((v + 180) % 360 + 360) % 360 - 180; // stays in the slider's -180..180
          setTweak('photo', c.tweak, v);
          syncPhotoLayerSection();
        });
      }
    }
  }
  syncPhotoLayerSection();
}

/**
 * main/stl-crop-controls.js -- STL-CROP (STL-RELIEF-DESIGN.md section 14): the crop box's SIX sliders (X / Y / Z min and max, as % of
 * the model's own bounding box, in the frame of the mesh that is stored), declared once and rendered by one function for BOTH
 * places: the library sheet's Crop mode and the STL panel's Crop group (Fred: sliders first, handles in a later slice).
 * The travel is 0..100 %; nothing is clamped or re-ordered (a min past its max keeps nothing, which the caller reports).
 */
import { CROP_AXES, normaliseCropBox, isFullCropBox } from '../core/stl/crop.js';

/** The six sliders, in order: [axis, end (0 = min, 1 = max), label]. */
export const CROP_SLIDERS = Object.freeze(CROP_AXES.flatMap((a) => [
  Object.freeze({ axis: a, end: 0, label: `${a.toUpperCase()} min` }),
  Object.freeze({ axis: a, end: 1, label: `${a.toUpperCase()} max` }),
]));
/** The sliders' travel (attributes only, not a rule). */
export const CROP_SLIDER_TRAVEL = Object.freeze({ min: 0, max: 100, step: 1 });

const el = (tag, attrs = {}, kids = []) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'text') e.textContent = v; else e.setAttribute(k, v); }
  for (const k of kids) if (k) e.appendChild(k);
  return e;
};
/** The id of one slider ('<prefix>XMin'); its number box adds 'Num'. */
export const cropSliderId = (prefix, s) => `${prefix}${s.axis.toUpperCase()}${s.end ? 'Max' : 'Min'}`;
const pct = (f) => String(Math.round(f * 1000) / 10);

/**
 * Render the six sliders into `host`. `onInput(box)` runs on every move (box = fractions, normaliseCropBox's shape).
 * Returns { get() -> box, set(box), isFull() }.
 */
export function renderCropSliders(host, { idPrefix, onInput = () => {} }) {
  const rows = CROP_SLIDERS.map((s) => {
    const t = CROP_SLIDER_TRAVEL;
    const id = cropSliderId(idPrefix, s);
    const range = el('input', { type: 'range', id, class: 'cad-slider', min: String(t.min), max: String(t.max), step: String(t.step), 'aria-label': `${s.label} (%)` });
    const num = el('input', { type: 'number', id: `${id}Num`, min: String(t.min), max: String(t.max), step: String(t.step), 'aria-label': `${s.label} (%)` });
    host.appendChild(el('div', { class: 'stl-crop-row' }, [
      el('label', { class: 'cad-label stl-crop-label', for: id, text: s.label }),
      el('div', { class: 'cad-slider-row' }, [range, el('div', { class: 'cad-stepper', style: 'width:62px;' }, [num]), el('span', { class: 'stl-unit', text: '%' })]),
    ]));
    return { s, range, num };
  });
  let box = normaliseCropBox(null);
  const show = () => { for (const r of rows) { const v = pct(box[r.s.axis][r.s.end]); r.range.value = v; r.num.value = v; } };
  for (const r of rows) {
    const take = (from) => {
      const v = parseFloat(from.value);
      if (!Number.isFinite(v)) return;
      (from === r.range ? r.num : r.range).value = from.value;
      box = { ...box, [r.s.axis]: r.s.end ? [box[r.s.axis][0], v / 100] : [v / 100, box[r.s.axis][1]] };
      onInput(box);
    };
    r.range.addEventListener('input', () => take(r.range));
    r.num.addEventListener('change', () => take(r.num));
  }
  show();
  return {
    get: () => normaliseCropBox(box),
    set(b) { box = normaliseCropBox(b); show(); },
    isFull: () => isFullCropBox(box),
  };
}

/** The panel / pane note for cut edges that could not be capped (information, not a block); '' when every cut closed. */
export const openLoopsNote = (n) => (n > 0 ? `${n} cut edge${n === 1 ? '' : 's'} could not be capped (the model is open there).` : '');

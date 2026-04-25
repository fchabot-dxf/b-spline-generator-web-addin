/**
 * tweaks-ui.js — Edit-Filter slider panel.
 *
 * Renders a per-filter slider list driven by the active mode's `tweaks`
 * schema (declared inside each module under core/noise/<mode>.js).
 *
 * Values are session-only — they live in `P.filterTweaks[filterId][key]`.
 * Defaults are NOT seeded into state; the engine and each mode fn read
 * `params.tweaks?.<key> ?? <default>`, so an empty store reproduces the
 * pre-tweaks behavior exactly.
 *
 * Public API:
 *   renderTweaksPanel(filterId)          — populate the panel for a filter
 *   resetAllTweaks(filterId)             — clear that filter's overrides
 *   resetOneTweak(filterId, key)         — clear a single override
 *   bindTweaksUI({ panelEl, bodyEl, resetBtnEl, getActiveFilterId,
 *                  onChange })           — one-time wire-up
 *
 * The host (main.js) is responsible for:
 *   - calling renderTweaksPanel() once on init and on noise-type change;
 *   - providing onChange() which schedules a rebuild.
 */

import { NoiseTweaks } from './index.js';
import { P } from '../state.js';

// Module-private references resolved by bindTweaksUI().
let _panelEl       = null;
let _bodyEl        = null;
let _resetBtnEl    = null;
let _getFilterId   = null;
let _onChange      = null;

/** Read the live override for (filterId, key), or undefined. */
function readOverride(filterId, key) {
  const bucket = P.filterTweaks && P.filterTweaks[filterId];
  return bucket ? bucket[key] : undefined;
}

/** Write a value into the live state and notify the host. */
function writeOverride(filterId, key, value) {
  if (!P.filterTweaks) P.filterTweaks = {};
  if (!P.filterTweaks[filterId]) P.filterTweaks[filterId] = {};
  P.filterTweaks[filterId][key] = value;
  if (_onChange) _onChange();
}

/** Drop a single key (revert to schema default). */
export function resetOneTweak(filterId, key) {
  const bucket = P.filterTweaks && P.filterTweaks[filterId];
  if (!bucket) return;
  delete bucket[key];
  // If the bucket is empty, drop the parent key too — keeps state tidy.
  if (Object.keys(bucket).length === 0) delete P.filterTweaks[filterId];
  if (_onChange) _onChange();
}

/** Drop every override for a filter (revert all to schema defaults). */
export function resetAllTweaks(filterId) {
  if (!P.filterTweaks) return;
  delete P.filterTweaks[filterId];
  if (_onChange) _onChange();
}

/**
 * Build a single tweak row: [label] [range slider] [number input] [↺]
 * Each control writes back to P.filterTweaks via writeOverride().
 */
function buildRow(filterId, schema) {
  const { key, label, default: def, min, max, step, desc } = schema;
  const cur = readOverride(filterId, key);
  const value = (typeof cur === 'number') ? cur : def;

  const wrap = document.createElement('label');
  wrap.className = 'tweak-row';
  wrap.dataset.tweakKey = key;
  if (desc) wrap.title = desc;

  const lbl = document.createElement('span');
  lbl.textContent = label;
  wrap.appendChild(lbl);

  const sliderRow = document.createElement('div');
  sliderRow.className = 'slider-row';

  const range = document.createElement('input');
  range.type = 'range';
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = String(value);

  const num = document.createElement('input');
  num.type = 'number';
  num.min = String(min);
  num.max = String(max);
  num.step = String(step);
  num.value = String(value);

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'tweak-reset';
  reset.title = `Reset to default (${def})`;
  reset.textContent = '↺';

  // Slider/number stay in sync; either one writes back.
  const apply = (raw) => {
    let v = parseFloat(raw);
    if (!Number.isFinite(v)) return;
    // Clamp into schema range — paranoia for direct number-input typing.
    v = Math.max(min, Math.min(max, v));
    range.value = String(v);
    num.value = String(v);
    writeOverride(filterId, key, v);
    // Visual "modified" hint when value diverges from default.
    wrap.classList.toggle('tweak-modified', Math.abs(v - def) > 1e-9);
  };

  range.addEventListener('input', (e) => apply(e.target.value));
  num.addEventListener('input', (e) => apply(e.target.value));
  num.addEventListener('change', (e) => apply(e.target.value));

  reset.addEventListener('click', () => {
    resetOneTweak(filterId, key);
    range.value = String(def);
    num.value = String(def);
    wrap.classList.remove('tweak-modified');
  });

  // Initial modified state.
  if (typeof cur === 'number' && Math.abs(cur - def) > 1e-9) {
    wrap.classList.add('tweak-modified');
  }

  sliderRow.appendChild(range);
  sliderRow.appendChild(num);
  sliderRow.appendChild(reset);
  wrap.appendChild(sliderRow);

  return wrap;
}

/**
 * Populate the panel body for a given filter. Hides the whole panel
 * if the filter declares no tweaks.
 */
export function renderTweaksPanel(filterId) {
  if (!_panelEl || !_bodyEl) return;

  const schema = NoiseTweaks[filterId] ?? [];
  _bodyEl.innerHTML = '';

  if (schema.length === 0) {
    // No tweaks for this filter — collapse and hide entirely.
    _panelEl.style.display = 'none';
    return;
  }

  _panelEl.style.display = '';
  for (const t of schema) {
    _bodyEl.appendChild(buildRow(filterId, t));
  }
}

/**
 * One-time setup. Called from main.js after DOMContentLoaded.
 *
 * @param {object} cfg
 * @param {HTMLElement} cfg.panelEl              — wrapping .panel-sub
 * @param {HTMLElement} cfg.bodyEl               — .panel-body that holds rows
 * @param {HTMLElement} cfg.resetBtnEl           — "Reset all" button
 * @param {() => string} cfg.getActiveFilterId   — returns the current noiseType
 * @param {() => void}   cfg.onChange            — called on any value change
 */
export function bindTweaksUI({ panelEl, bodyEl, resetBtnEl, getActiveFilterId, onChange }) {
  _panelEl     = panelEl;
  _bodyEl      = bodyEl;
  _resetBtnEl  = resetBtnEl;
  _getFilterId = getActiveFilterId;
  _onChange    = onChange;

  if (_resetBtnEl) {
    _resetBtnEl.addEventListener('click', (e) => {
      // Don't bubble up into a panel-header collapse-toggle.
      e.stopPropagation();
      const id = _getFilterId();
      if (!id) return;
      resetAllTweaks(id);
      renderTweaksPanel(id);
    });
  }
}

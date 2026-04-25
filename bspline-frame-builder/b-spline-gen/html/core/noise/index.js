/**
 * noise/index.js — Composition root for noise modes.
 *
 * Each mode lives in its own file and exports:
 *   - id            : string key (used by the UI dropdown)
 *   - label         : human-readable name
 *   - cMultiplier   : C-axis multiplier metadata
 *   - fn(su, sv, aspect, params, noiseRefs) → number
 *
 * This file collects them and re-exports the shapes that terrain.js
 * and the rest of the app expect:
 *
 *   NoiseModes    { id → fn }
 *   NoiseMetadata { id → { cMultiplier } }
 *   NoiseLabels   { id → label }
 *   NoiseList     [ { id, label } ]   — dropdown order, single source of truth
 *
 * To add a new mode: drop a new file in this folder, then add it to
 * the `_all` array below in the position you want it to appear in
 * the dropdown. The HTML dropdowns are populated from NoiseList at
 * runtime, so no other file needs to change.
 */

import * as simplex    from './simplex.js';
import * as sculptural from './sculptural.js';
import * as hetero     from './hetero.js';
import * as basalt     from './basalt.js';
import * as artifact   from './artifact.js';
import * as cracked    from './cracked.js';
import * as chest      from './chest.js';
import * as xeno       from './xeno.js';
import * as magma      from './magma.js';
import * as reef       from './reef.js';
import * as glacier    from './glacier.js';
import * as planet     from './planet.js';
import * as damask     from './damask.js';
import * as mycelium   from './mycelium.js';
import * as caustic    from './caustic.js';
import * as woven      from './woven.js';
import * as dunes      from './dunes.js';

// Order here = dropdown order.
const _all = [
  simplex, sculptural, hetero, basalt, artifact, cracked,
  chest, xeno, magma, reef, glacier, planet,
  damask, mycelium, caustic, woven, dunes,
];

export const NoiseModes    = Object.fromEntries(_all.map(m => [m.id, m.fn]));
export const NoiseMetadata = Object.fromEntries(_all.map(m => [m.id, { cMultiplier: m.cMultiplier }]));
export const NoiseLabels   = Object.fromEntries(_all.map(m => [m.id, m.label]));
export const NoiseList     = _all.map(m => ({ id: m.id, label: m.label }));

// Per-filter UI-tweak schemas: id → array of { key, label, default, min, max, step, desc? }.
// Empty array if a filter exposes no tweaks. Used by the Edit-Filter panel.
export const NoiseTweaks   = Object.fromEntries(_all.map(m => [m.id, m.tweaks ?? []]));

/**
 * Return a {key:value} object filled with each tweak's default value
 * for the given filter id. Useful for "reset all" in the UI.
 */
export function getTweakDefaults(id) {
  const schema = NoiseTweaks[id] ?? [];
  return Object.fromEntries(schema.map(t => [t.key, t.default]));
}

/**
 * Populate a <select> element with one <option> per noise mode in
 * dropdown order. Preserves any `data-default` attribute as the
 * initially-selected option; falls back to the first entry.
 *
 * Idempotent — calling twice replaces the existing options.
 *
 * @param {HTMLSelectElement} selectEl
 * @param {string} [selectedId] — id to preselect (default: current value or first entry)
 */
export function populateNoiseDropdown(selectEl, selectedId) {
  if (!selectEl) return;
  const want = selectedId ?? selectEl.value ?? selectEl.dataset.default ?? _all[0].id;
  selectEl.innerHTML = '';
  for (const m of _all) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    if (m.id === want) opt.selected = true;
    selectEl.appendChild(opt);
  }
}

/**
 * seed/index.js — Composition root for SEED types.
 *
 * Mirrors core/noise/index.js. Each seed mode lives in its own file and
 * exports:
 *   - id           : string key (used by the SEED dropdown)
 *   - label        : human-readable name
 *   - description  : one-line character hint shown under the dropdown
 *   - sample(x, y, seedRefs) → number ∈ [0..1]
 *
 * The seed produces the raw coarse field. Skeleton transforms (peak shape,
 * clustering, density, edge fade, smoothing) and the FILTER (fine detail)
 * are applied downstream by terrain.js — seeds do NOT shape the final
 * output directly.
 *
 * To add a new seed: drop a new file in this folder, then add it to the
 * `_all` array below. The SEED panel dropdown is populated from SeedList
 * at runtime, so no other file needs to change.
 */

import * as perlin  from './perlin.js';
import * as ridged  from './ridged.js';
import * as billow  from './billow.js';
import * as voronoi from './voronoi.js';

// Order here = dropdown order.
const _all = [perlin, ridged, billow, voronoi];

export const SeedTypes  = Object.fromEntries(_all.map(s => [s.id, s.sample]));
export const SeedLabels = Object.fromEntries(_all.map(s => [s.id, s.label]));
export const SeedDescriptions = Object.fromEntries(_all.map(s => [s.id, s.description ?? '']));
export const SeedList   = _all.map(s => ({ id: s.id, label: s.label, description: s.description ?? '' }));

/**
 * Populate a <select> with one <option> per seed type in dropdown order.
 * Mirrors populateNoiseDropdown() — idempotent.
 *
 * @param {HTMLSelectElement} selectEl
 * @param {string} [selectedId]
 */
export function populateSeedDropdown(selectEl, selectedId) {
  if (!selectEl) return;
  const want = selectedId ?? selectEl.value ?? selectEl.dataset.default ?? _all[0].id;
  selectEl.innerHTML = '';
  for (const s of _all) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.label;
    if (s.id === want) opt.selected = true;
    selectEl.appendChild(opt);
  }
}

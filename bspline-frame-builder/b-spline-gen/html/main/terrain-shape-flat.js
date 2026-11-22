/**
 * main/terrain-shape-flat.js -- TERRAIN SHAPE's 'Flat (no hills)' switch in the sidebar (Fred 2026-11-22,
 * TERRAIN-FLAT-DESIGN.md). The switch (P.shapeFlat) and the surface height (P.surfaceHeightIn) bind the generic way
 * (main/ui-bindings.js); this module only reflects the switch on the panel:
 *   - SHAPE_FLAT_ROWS declares the rows it greys: a row greys while P.shapeFlat === greysWhen -- the rows Flat no longer
 *     reads (core/terrain.js skips the coarse pass: Region Scale, Peak Shape, Density, Clustering) while it is on, the
 *     surface height while it is off. Greyed = the photo section's own greyed style, still shown and still editable (the
 *     values act again once the switch flips; never disabled, so the job timeline's lock stays the one owner of
 *     `disabled`). Markup hook: data-shape-flat-row="<row>" on the row (bspline_gen_palette.html).
 *   - the surface height's slider travels 0..carveZ (the typed field has no min / max: a typed value is kept as typed).
 * tests/terrain-flat.test.js checks the greyed rows against the real heightmap (each key moved alone).
 */
import { P } from '../core/state.js';

export const SHAPE_FLAT_ROWS = Object.freeze([
  Object.freeze({ row: 'surfaceHeight', greysWhen: false, params: Object.freeze(['surfaceHeightIn']) }),
  Object.freeze({ row: 'regionScale', greysWhen: true, params: Object.freeze(['macroScale']) }),
  Object.freeze({ row: 'peaks', greysWhen: true, params: Object.freeze(['peakShape', 'density', 'clustering']) }),
]);
export const SHAPE_FLAT_GREYED_CLASS = 'shape-flat-greyed';

/** Reflect P.shapeFlat / P.carveZ / P.surfaceHeightIn on the Shape panel. */
export function syncShapeFlatUI(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return;
  const on = P.shapeFlat === true;
  for (const r of SHAPE_FLAT_ROWS) {
    for (const n of doc.querySelectorAll(`[data-shape-flat-row="${r.row}"]`)) n.classList.toggle(SHAPE_FLAT_GREYED_CLASS, on === r.greysWhen);
  }
  const slider = doc.getElementById('surfaceHeightInSlider');
  if (slider) {
    const top = Number(P.carveZ);
    if (Number.isFinite(top) && top > 0) slider.max = String(top);
    slider.min = '0';
    // a range input clips its value to the max it had: put the stored value back once the travel is right
    if (Number.isFinite(Number(P.surfaceHeightIn))) slider.value = String(P.surfaceHeightIn);
  }
}

/** Wire it (main.js, after bindControls): the switch, and the carve depth that sets the slider's travel. A load / an undo
 *  re-syncs the checkbox through core/ui-utils.js syncUItoParam, which fires its 'change' -- this listener included. */
export function bindShapeFlat(doc = document) {
  const sync = () => syncShapeFlatUI(doc);
  doc.getElementById('shapeFlat')?.addEventListener('change', sync);
  for (const id of ['carveZ', 'carveZSlider']) {
    doc.getElementById(id)?.addEventListener('input', sync);
    doc.getElementById(id)?.addEventListener('change', sync);
  }
  sync();
}

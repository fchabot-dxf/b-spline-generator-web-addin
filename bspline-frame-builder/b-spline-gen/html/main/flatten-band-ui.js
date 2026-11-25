/**
 * main/flatten-band-ui.js -- Surface > FLATTEN BAND (Fred 2026-11-25, core/flatten-band.js) on the sidebar, and the retiring
 * Flat Border's row.
 *
 * The number + slider pairs and the switch bind the generic way (main/ui-bindings.js; core/state.js SLIDER_PAIRS); this
 * module owns what the generic binder cannot:
 *   - BAND_ROWS: the rows SHOWN only while the band is on (data-band-row="<row>", bspline_gen_palette.html) -- the panel
 *     stays one line on a phone while it is off;
 *   - 'Applies to' (P.bandAppliesTo): the segmented buttons of #bandAppliesToGroup, one per core/flatten-band.js
 *     BAND_APPLIES_TO key (data-value);
 *   - the Flat height: its slider travels 0..carveZ; with no value set (P.bandHeightIn null) the field and the slider show
 *     the height the band uses -- the board's fill floor (bandLevelIn);
 *   - the frame: a frame change rebuilds the heights while the band is on (the band follows its outline);
 *   - FLAT_BORDER_RETIREMENT: the Flat Border's row (data-legacy-row="flatBorder") shows only on a board that uses it --
 *     decided when a board is LOADED (the session restore, a project load, an undo, a New project), never while its own
 *     slider moves, so a board with a border keeps its slider through any edit.
 * syncFlattenBandUI() runs on a band write (main/param-manager.js applyParam, BAND_UI_KEYS) and, with { boardLoaded: true },
 * after every load (main/app-init.js initApp, main/snapshot-manager.js applySnapshot).
 */
import { P } from '../core/state.js';
import { fillFloorIn } from '../core/engine/build-thicken-data.js';
import { BAND_APPLIES_TO, BAND_APPLIES_DEFAULT, bandLevelIn } from '../core/flatten-band.js';

export const BAND_ROWS = Object.freeze([
  Object.freeze({ row: 'settings', shows: (p) => p.bandEnabled === true }),
]);
/** The Flat Border (P.edgeMarginIn) retires into the band: its row shows only on a board that uses it. */
export const FLAT_BORDER_RETIREMENT = Object.freeze({ row: 'flatBorder', shows: (p) => Number(p.edgeMarginIn) > 0 });
/** The P keys whose write re-syncs the band panel (the band's own; the carve depth and the fill floor's inputs). */
export const BAND_UI_KEYS = Object.freeze([
  'bandEnabled', 'bandAppliesTo', 'bandHeightIn',
  'carveZ', 'terrainFit', 'thickness', 'thickenEnabled', 'thickenDir',
]);

/** The band's flat height as the panel shows it (inches): the user's value, else the board's fill floor. */
export const bandHeightShown = (p = P) => bandLevelIn({ bandHeightIn: p.bandHeightIn, terrainFloorIn: fillFloorIn(p) });

export function syncFlattenBandUI({ boardLoaded = false } = {}, doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return;
  for (const r of BAND_ROWS) for (const n of doc.querySelectorAll(`[data-band-row="${r.row}"]`)) n.hidden = !r.shows(P);
  const applies = BAND_APPLIES_TO[P.bandAppliesTo] ? P.bandAppliesTo : BAND_APPLIES_DEFAULT;
  for (const b of doc.querySelectorAll('#bandAppliesToGroup > button')) {
    const on = b.dataset.value === applies;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  }
  const slider = doc.getElementById('bandHeightInSlider');
  const shown = bandHeightShown(P);
  if (slider) {
    const top = Number(P.carveZ);
    if (Number.isFinite(top) && top > 0) slider.max = String(top);
    slider.min = '0';
    slider.value = String(shown); // a range input clips its value to the max it had: set it once the travel is right
  }
  const field = doc.getElementById('bandHeightIn');
  if (field && doc.activeElement !== field) field.value = String(Number(shown.toFixed(4)));
  if (boardLoaded) {
    const r = FLAT_BORDER_RETIREMENT;
    for (const n of doc.querySelectorAll(`[data-legacy-row="${r.row}"]`)) n.hidden = !r.shows(P);
  }
}

/** Wire it (main.js, after bindControls). `applyParam` / `scheduleHeights` are the app's own (passed in: no import cycle). */
export function bindFlattenBand({ applyParam, scheduleHeights, snapshot } = {}, doc = document) {
  for (const b of doc.querySelectorAll('#bandAppliesToGroup > button')) {
    b.addEventListener('click', () => {
      if (!BAND_APPLIES_TO[b.dataset.value] || P.bandAppliesTo === b.dataset.value) return;
      applyParam('bandAppliesTo', b.dataset.value);
      if (snapshot) snapshot('bandAppliesTo', 'Flatten band: applies to');
    });
  }
  // the band follows the frame's outline: a frame edit rebuilds the heights while it is on (else the frame is no input)
  doc.addEventListener('frameRecordChanged', () => { if (P.bandEnabled === true && scheduleHeights) scheduleHeights(); });
  syncFlattenBandUI({ boardLoaded: true }, doc);
}

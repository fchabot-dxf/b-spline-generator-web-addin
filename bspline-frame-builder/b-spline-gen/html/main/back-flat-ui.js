/**
 * main/back-flat-ui.js -- the Thicken settings' Back: Shell / Flat (P.backMode, Fred 2026-11-23) reflected on the panels.
 * DISPLAY ONLY: a row greys (Terrain Shape's own greyed style, main/terrain-shape-flat.js) while it has no effect; it stays
 * shown and editable -- never disabled (the job timeline's lock stays the one owner of `disabled`), its values act again
 * once they matter. BACK_FLAT_ROWS declares the rows; markup hooks: data-back-flat-row="<row>" on each greyed element,
 * data-back-flat-note="<row>" on a row's one-line note (bspline_gen_palette.html).
 *   - sculptBottom: a flat back reads no sculpted bottom (core/engine/build-thicken-data.js) -- its strokes are kept and
 *     act again on Shell.
 *   - thickenOffset: the thickness has no effect on a flat back whose fill floor is 0 (a legacy board, a tiny carve depth);
 *     on a 'fill' board it is the wood left under the deepest valley (fillFloorIn), so it stays live there.
 * syncBackFlatUI() runs on every write of these settings -- a tap (param-manager.js applyParam), an undo / a project load
 * (snapshot-manager.js applySnapshot), the session restore (app-init.js initApp) -- and announces THICKEN_SETTINGS_SYNCED,
 * which the Thicken line's label follows (main/layer-stack.js, its one label function).
 */
import { P } from '../core/state.js';
import { fillFloorIn } from '../core/engine/build-thicken-data.js';
import { SHAPE_FLAT_GREYED_CLASS } from './terrain-shape-flat.js';

export const BACK_FLAT_ROWS = Object.freeze([
  Object.freeze({ row: 'sculptBottom', greys: (p) => p.backMode === 'flat', note: 'No effect with a flat back' }),
  Object.freeze({ row: 'thickenOffset', greys: (p) => p.backMode === 'flat' && fillFloorIn(p) === 0, note: null }),
]);
export const THICKEN_SETTINGS_SYNCED = 'thickenSettingsSynced';
/** The P keys whose write re-syncs it (main/param-manager.js applyParam). */
export const BACK_FLAT_KEYS = Object.freeze(['backMode', 'thickness', 'thickenEnabled', 'thickenDir', 'carveZ', 'terrainFit']);

export function syncBackFlatUI(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return;
  for (const r of BACK_FLAT_ROWS) {
    const on = !!r.greys(P);
    for (const n of doc.querySelectorAll(`[data-back-flat-row="${r.row}"]`)) n.classList.toggle(SHAPE_FLAT_GREYED_CLASS, on);
    for (const n of doc.querySelectorAll(`[data-back-flat-note="${r.row}"]`)) { n.hidden = !on; if (r.note) n.textContent = r.note; }
  }
  doc.dispatchEvent(new CustomEvent(THICKEN_SETTINGS_SYNCED));
}

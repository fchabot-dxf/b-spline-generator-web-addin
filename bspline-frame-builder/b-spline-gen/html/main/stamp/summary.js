/**
 * main/stamp/summary.js -- DRAW-STAMP worker U (Fred 2026-11-22: per-layer stamp settings are EDITED IN THE EDITOR,
 * SUMMARISED IN THE SIDEBAR). Each row of the sidebar's layer list gets ONE read-only line under its name, "Raised
 * 0.25 in · V-bit 90°" / "Carved 0.1 in · Ballnose" / "Flat" -- core/stamp/target.js stampSummaryText over that row's
 * stamp target (the same target the editor's Stamp settings read and write).
 *
 * The rows are editor/layers.js renderLayerList's (it re-renders them on every roster change, then fires
 * 'editorLayersChanged'); this module only adds / refreshes the line in them: on that event, and on every edit inside
 * the moved settings (#stampLayerSettings: input / change / click bubble up after the control's own handlers have
 * written the layer). Then STAMP_TARGET_CHANGED, so the Draw tree's Stamp header (main/draw-tree.js) follows.
 */
import { stampTarget, stampSummaryText } from '../../core/stamp/target.js';

/** The layer lists that carry the summary line. None now: the sidebar's VECTOR STAMPING list moved into the LAYERS stack
 *  (Fred 2026-11-23), whose open Draw / Lattice card shows the same stampSummaryText (main/layer-stack.js LAYER_TYPES) and
 *  re-reads it on STAMP_TARGET_CHANGED. */
export const STAMP_SUMMARY_LISTS = Object.freeze([]);
/** Fired after the summaries are fresh (a layer switch or a settings edit). */
export const STAMP_TARGET_CHANGED = 'stampTargetChanged';
const SETTINGS_ROOT = 'stampLayerSettings';
const LINE_CLASS = 'layer-stamp-summary';

/** Adds / refreshes the summary line of every row in the declared lists. */
export function refreshStampSummaries(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return;
  const ed = typeof window !== 'undefined' ? window.svgEditor : null;
  const layers = ed && Array.isArray(ed._layers) ? ed._layers : [];
  for (const listId of STAMP_SUMMARY_LISTS) {
    const list = doc.getElementById(listId);
    if (!list) continue;
    for (const row of list.querySelectorAll('.layer-row[data-layer-id]')) {
      const idx = layers.findIndex((l) => String(l.id) === row.dataset.layerId);
      if (idx < 0) continue;
      // the row's own last child: a full-width second line (styles/editor.css wraps these rows), so the narrow
      // sidebar shows the whole summary instead of an ellipsis after the name
      let line = row.querySelector(`:scope > .${LINE_CLASS}`);
      if (!line) {
        line = doc.createElement('div');
        line.className = LINE_CLASS;
        row.appendChild(line);
      }
      line.textContent = stampSummaryText(stampTarget(idx));
      line.classList.toggle('not-carved', layers[idx].carve === false); // dimmed like the row's own tool summary
    }
  }
  doc.dispatchEvent(new CustomEvent(STAMP_TARGET_CHANGED));
}

export function initSummary(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return;
  const refresh = () => refreshStampSummaries(doc);
  doc.addEventListener('editorLayersChanged', refresh);
  const root = doc.getElementById(SETTINGS_ROOT);
  if (root) for (const ev of ['input', 'change', 'click']) root.addEventListener(ev, refresh);
  refresh();
}

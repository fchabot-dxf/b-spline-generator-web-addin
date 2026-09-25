/**
 * Fusion Geometry — per-layer pick of what a Fusion export/carve should
 * use for this layer: the line's Centerline, its true offset Outline, or
 * Both. SE12 T36 (Slice 2) recorded the choice (persisted on the layer,
 * undoable, restored on layer switch); T37 (Slice 3) makes it visible —
 * a click here also refreshes the editor's outline preview directly
 * (refreshOutlinePreview, not the full _notifyChange('commit') cascade,
 * which would also re-persist/remask/re-drape for a field the mask/
 * export still don't read — that's Slice 4). window.svgEditor may not
 * exist yet if the editor has never been opened this session; the
 * optional-chained call is a no-op then, same as every other call site
 * that reaches into the editor from outside it. No remask on the field
 * write itself either, same reasoning.
 *
 * Renders its 3-way button group + hint text from FUSION_GEOMETRY
 * (editor/layers.js) rather than hand-listing the 3 values here too —
 * adding a 4th choice later is one entry in that table plus one <button>
 * in the HTML, not a second place to keep in sync.
 */
import { FUSION_GEOMETRY } from '../../editor/layers.js';
import { refreshOutlinePreview } from '../../editor/editor-outline-preview.js';

const HINT_ID = 'stampFusionGeometryHint';

export function initFusionGeometry(ctx) {
  const buttonMap = {};
  for (const { value } of FUSION_GEOMETRY) buttonMap[value] = `stampFusionGeometry-${value}`;

  const hintEl = document.getElementById(HINT_ID);
  const syncHint = (layer) => {
    if (!hintEl) return;
    const value = (layer && layer.fusionGeometry) || FUSION_GEOMETRY[0].value;
    const entry = FUSION_GEOMETRY.find((g) => g.value === value);
    hintEl.textContent = entry ? entry.hint : '';
  };

  const syncButtons = ctx.bindLayerOnlySegmented(buttonMap, 'fusionGeometry', {
    triggerRemask: false, // nothing reads this field yet (Slice 3/4)
    undoLabel: 'Fusion geometry',
  });

  // The binder above only flips .active and writes the layer field —
  // hint text and the outline preview both need their own follow-up on
  // every click (not just a layer switch).
  for (const { value } of FUSION_GEOMETRY) {
    const btn = document.getElementById(buttonMap[value]);
    if (btn) btn.addEventListener('click', () => {
      syncHint({ fusionGeometry: value });
      if (typeof window !== 'undefined' && window.svgEditor) refreshOutlinePreview(window.svgEditor);
    });
  }

  return ctx.registerModule({
    id: 'fusion-geometry',
    syncFromLayer(layer) {
      syncButtons(layer);
      syncHint(layer);
    },
  });
}

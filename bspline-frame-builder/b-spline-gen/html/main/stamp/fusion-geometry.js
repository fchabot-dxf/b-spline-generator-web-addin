/**
 * Fusion Geometry — per-layer pick of what a Fusion export/carve should
 * use for this layer: the line's Centerline, its true offset Outline, or
 * Both. SE12 T36 (Slice 2): this module only lets the user RECORD the
 * choice (persisted on the layer, undoable, restored on layer switch) —
 * nothing reads `layer.fusionGeometry` yet. The derived outline preview
 * is Slice 3; the actual export swap (getLayerSvg, per the SE12 design
 * doc) is Slice 4. No remask on change either, for the same reason: the
 * mask/relief doesn't depend on this field until a later slice teaches
 * it to.
 *
 * Renders its 3-way button group + hint text from FUSION_GEOMETRY
 * (editor/layers.js) rather than hand-listing the 3 values here too —
 * adding a 4th choice later is one entry in that table plus one <button>
 * in the HTML, not a second place to keep in sync.
 */
import { FUSION_GEOMETRY } from '../../editor/layers.js';

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

  // The binder above only flips .active — hint text needs its own sync,
  // and needs to follow every button click too (not just a layer switch).
  for (const { value } of FUSION_GEOMETRY) {
    const btn = document.getElementById(buttonMap[value]);
    if (btn) btn.addEventListener('click', () => syncHint({ fusionGeometry: value }));
  }

  return ctx.registerModule({
    id: 'fusion-geometry',
    syncFromLayer(layer) {
      syncButtons(layer);
      syncHint(layer);
    },
  });
}

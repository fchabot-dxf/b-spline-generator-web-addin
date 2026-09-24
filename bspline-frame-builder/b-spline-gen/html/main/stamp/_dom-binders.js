/**
 * DOM binding helpers for stamp-panel modules. Two flavors:
 *
 *   - "Bind*" (no listeners attached): the param dispatch (input →
 *     applyParam → updateP → P-write + layerSpecific-sync) is wired
 *     elsewhere by ui-bindings.bindControls, and the input ↔ slider
 *     pair-sync is wired by SLIDER_PAIRS / syncPair. These helpers
 *     just return a syncFromLayer fn that pushes layer[field] into the
 *     inputs when the active layer changes. Adding listeners here would
 *     fire applyParam twice per slider tick.
 *
 *   - "BindLayerOnly*" (listeners attached): for fields that live on
 *     the layer itself and aren't in P (e.g., transform tx/ty/rotation/
 *     scale/mirror). bindControls doesn't know about them, so we wire
 *     the input → layer.field write directly here and trigger a remask
 *     on change.
 *
 * UX-UNDO: bindLayerOnlyNumber/Checkbox also call scheduleUndoSnapshot on
 * `change` (never on the live `input` write above) — these per-layer
 * tooling fields are exactly what SE5c added to takeSnapshot/
 * applySnapshot, so they're undoable through the SAME global mechanism
 * as every other sidebar control, not a bespoke one for layer fields.
 */
import { scheduleUndoSnapshot } from '../../core/history.js';

export function createDomBinders({ activeLayer, activeEditorLayer, requestRemask }) {
  // Defensive default so older callers that don't supply activeEditorLayer
  // still work (returns null = "no editor layer to mirror into").
  const _editorLayer = typeof activeEditorLayer === 'function' ? activeEditorLayer : () => null;
  return {
    bindNumberSlider(inputId, sliderId, layerField) {
      const num = document.getElementById(inputId);
      const sld = sliderId ? document.getElementById(sliderId) : null;
      return (layer) => {
        if (!layer || layer[layerField] == null) return;
        const v = layer[layerField];
        if (num) num.value = v;
        if (sld) sld.value = v;
      };
    },

    bindSelect(selectId, layerField) {
      const sel = document.getElementById(selectId);
      return (layer) => {
        if (!layer || !sel) return;
        const v = layer[layerField];
        if (v != null) sel.value = String(v);
      };
    },

    bindCheckbox(checkboxId, layerField) {
      const cb = document.getElementById(checkboxId);
      return (layer) => {
        if (!layer || !cb) return;
        cb.checked = !!layer[layerField];
      };
    },

    bindLayerOnlyNumber(inputId, sliderId, layerField, opts = {}) {
      const num = document.getElementById(inputId);
      const sld = sliderId ? document.getElementById(sliderId) : null;
      const triggerRemask = opts.triggerRemask !== false;
      const writeAndRefresh = (v) => {
        const layer = activeLayer();
        const value = Number.isFinite(v) ? v : 0;
        if (layer) layer[layerField] = value;
        // Mirror to the matching editor layer so the rasterizer/compositor
        // see the change immediately when they read from editor._layers
        // (Step 2 of stamp-layer → editor-layer unification).
        const eLayer = _editorLayer();
        if (eLayer) eLayer[layerField] = value;
        if (triggerRemask) requestRemask();
      };
      if (num) {
        num.addEventListener('input', () => {
          if (sld) sld.value = num.value;
          writeAndRefresh(parseFloat(num.value));
        });
        num.addEventListener('change', () => scheduleUndoSnapshot(inputId));
      }
      if (sld) {
        sld.addEventListener('input', () => {
          if (num) num.value = sld.value;
          writeAndRefresh(parseFloat(sld.value));
        });
        sld.addEventListener('change', () => scheduleUndoSnapshot(inputId));
      }
      return (layer) => {
        if (!layer) return;
        const v = layer[layerField] ?? 0;
        if (num) num.value = v;
        if (sld) sld.value = v;
      };
    },

    bindLayerOnlyCheckbox(checkboxId, layerField, opts = {}) {
      const cb = document.getElementById(checkboxId);
      const triggerRemask = opts.triggerRemask !== false;
      if (cb) {
        cb.addEventListener('change', () => {
          const layer = activeLayer();
          if (layer) layer[layerField] = cb.checked;
          // Mirror to editor layer (Step 2 unification).
          const eLayer = _editorLayer();
          if (eLayer) eLayer[layerField] = cb.checked;
          if (triggerRemask) requestRemask();
          scheduleUndoSnapshot(checkboxId);
        });
      }
      return (layer) => {
        if (!layer || !cb) return;
        cb.checked = !!layer[layerField];
      };
    },
  };
}

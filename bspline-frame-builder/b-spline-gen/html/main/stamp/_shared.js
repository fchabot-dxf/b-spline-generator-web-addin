/**
 * Shared services for the stamp-panel modules. One ctx is created per
 * panel init and passed to every per-control module — modules use it
 * to read the active layer, schedule rebuilds, and bind controls.
 *
 * The ctx is also a small registry: each module returns an object with
 * `{ syncFromLayer(layer) }`, ctx tracks them, and the layer-switch
 * handler broadcasts to all of them at once. This replaces the giant
 * `syncUItoParam(...)` block that used to live in ui-bindings.js.
 */
import { P } from '../../core/state.js';
import { resolveGrid } from '../../core/terrain.js';
import { scheduleRebuild, rebuild } from '../../core/engine.js';
import { updateStampMasks, refreshAllStampMasks } from '../stamp-mask-manager.js';
import { updatePreviewSculptMode } from '../../core/sculpt-interaction.js';
import { AppState } from '../app-state.js';

export function createStampCtx(preview) {
  const modules = [];   // each: { syncFromLayer?: (layer) => void }
  let _debouncedMaskTimer = null;

  const ctx = {
    preview,
    P,

    /** Returns the currently active stamp layer (or undefined). */
    activeLayer() {
      return P.stampLayers ? P.stampLayers[P.activeLayerIdx] : undefined;
    },

    /** Resolves nx/nz from current size + spacing. */
    grid() {
      return resolveGrid(P.widthIn, P.heightIn, P.spacing);
    },

    /** Whether ANY enabled layer has a fillet > 0. Used to decide whether
     *  the depth slider needs a per-tick re-rasterize. */
    isFilletActive() {
      if ((P.stampEdgeFilletRadius || 0) > 0) return true;
      if (!Array.isArray(P.stampLayers)) return false;
      return P.stampLayers.some((L) =>
        L && (L.edgeFilletRadius || 0) > 0 && L.enabled !== false);
    },

    /** Module-side hook for the existing bindControls → applyParam path:
     *  modules register themselves so the layer-switch handler can refresh
     *  every UI control from the newly-active layer in one shot. */
    registerModule(mod) {
      if (mod) modules.push(mod);
      return mod;
    },

    /** Push the active layer's values out to every registered module's UI. */
    broadcastSyncFromLayer() {
      const layer = ctx.activeLayer();
      modules.forEach((m) => {
        if (m && typeof m.syncFromLayer === 'function') m.syncFromLayer(layer);
      });
    },

    // ─── Update-request shortcuts ────────────────────────────────────────
    // Each kind of UI change maps to one of these. Modules call them by
    // name instead of knowing about scheduleRebuild / refreshAllStampMasks.

    /** Just rebuild the mesh from the current mask. Cheapest option. */
    requestRebuild() {
      scheduleRebuild(() => rebuild(preview, updateStampMasks, updatePreviewSculptMode), 0);
    },

    /** Re-rasterize all masks AND rebuild. Use when the mask shape changed
     *  (profile, blur, fillet radius/power, vbit angle, depth shape). */
    requestRemask() {
      const { nx, nz } = ctx.grid();
      refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode);
      AppState.lastNx = nx;
      AppState.lastNz = nz;
    },

    /** Depth change special case: instant rebuild for visual feedback
     *  PLUS re-rasterize. Re-rasterize is immediate when fillet is active
     *  (fillet zone needs the up-to-date mask), debounced 180ms otherwise
     *  so dragging the slider feels smooth. */
    requestDepthChange() {
      const { nx, nz } = ctx.grid();
      ctx.requestRebuild();
      if (ctx.isFilletActive()) {
        refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode);
      } else {
        clearTimeout(_debouncedMaskTimer);
        _debouncedMaskTimer = setTimeout(() => {
          refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode);
        }, 180);
      }
      AppState.lastNx = nx;
      AppState.lastNz = nz;
    },

    // ─── DOM binding helpers (slider ↔ number input pairing) ────────────
    // The actual param dispatch (applyParam → updateP → P-write +
    // layerSpecific-sync) still lives in param-manager / state. These
    // helpers just keep the slider and number input in sync with each
    // other, and return a sync-from-layer fn the active-layer handler
    // calls when a different layer becomes active.

    /** Returns a syncFromLayer fn that pushes layer[layerField] into both
     *  the number input and slider with the given ids. The actual input ↔
     *  slider sync is wired separately by SLIDER_PAIRS / syncPair (in
     *  ui-bindings.bindControls), and the basic input → applyParam
     *  dispatch is wired by the same function — so we DON'T add listeners
     *  here, or applyParam would fire twice per slider tick. */
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

    /** Wire a select. Returns a sync fn. */
    bindSelect(selectId, layerField) {
      const sel = document.getElementById(selectId);
      return (layer) => {
        if (!layer || !sel) return;
        const v = layer[layerField];
        if (v != null) sel.value = String(v);
      };
    },

    /** Wire a checkbox. Returns a sync fn. */
    bindCheckbox(checkboxId, layerField) {
      const cb = document.getElementById(checkboxId);
      return (layer) => {
        if (!layer || !cb) return;
        cb.checked = !!layer[layerField];
      };
    },

    /** For inputs that are LAYER-ONLY (not in P) — e.g. transform fields.
     *  We wire the input ↔ layer.field directly here since bindControls
     *  doesn't know about them, and we trigger a remask on change. */
    bindLayerOnlyNumber(inputId, sliderId, layerField, opts = {}) {
      const num = document.getElementById(inputId);
      const sld = sliderId ? document.getElementById(sliderId) : null;
      const triggerRemask = opts.triggerRemask !== false;
      const writeAndRefresh = (v) => {
        const layer = ctx.activeLayer();
        if (layer) layer[layerField] = Number.isFinite(v) ? v : 0;
        if (triggerRemask) ctx.requestRemask();
      };
      if (num) {
        num.addEventListener('input', () => {
          if (sld) sld.value = num.value;
          writeAndRefresh(parseFloat(num.value));
        });
      }
      if (sld) {
        sld.addEventListener('input', () => {
          if (num) num.value = sld.value;
          writeAndRefresh(parseFloat(sld.value));
        });
      }
      return (layer) => {
        if (!layer) return;
        const v = layer[layerField] ?? 0;
        if (num) num.value = v;
        if (sld) sld.value = v;
      };
    },

    /** For layer-only checkboxes (e.g. mirror toggles). */
    bindLayerOnlyCheckbox(checkboxId, layerField, opts = {}) {
      const cb = document.getElementById(checkboxId);
      const triggerRemask = opts.triggerRemask !== false;
      if (cb) {
        cb.addEventListener('change', () => {
          const layer = ctx.activeLayer();
          if (layer) layer[layerField] = cb.checked;
          if (triggerRemask) ctx.requestRemask();
        });
      }
      return (layer) => {
        if (!layer || !cb) return;
        cb.checked = !!layer[layerField];
      };
    },
  };

  return ctx;
}

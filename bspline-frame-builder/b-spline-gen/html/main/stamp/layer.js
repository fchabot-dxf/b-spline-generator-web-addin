/**
 * Active Layer + Enabled checkbox — which layer the Vector Stamping
 * panel is currently editing, and whether that layer participates in
 * the rebuild.
 *
 * Step 3 of the stamp-layer → editor-layer unification: the dropdown
 * now reads its options from the SVG editor's layer roster
 * (window.svgEditor._layers) instead of P.stampLayers. Selecting an
 * option sets editor._activeLayer (the source of truth) and mirrors
 * P.activeLayerIdx for any legacy code path that still consults it.
 *
 * The dropdown refreshes whenever the editor dispatches its
 * `editorLayersChanged` CustomEvent (fired by renderLayersPanel after
 * any add/remove/rename/reorder/visibility change).
 */
import { P, updateP, setStampLayerEnabled } from '../../core/state.js';
import { setLayerVisible } from '../../editor/layers.js';
import { scheduleRebuild, rebuild } from '../../core/engine.js';
import { updateStampMasks } from '../stamp-mask-manager.js';
import { updatePreviewSculptMode } from '../../core/sculpt-interaction.js';

export function initLayer(ctx) {
  const sel = document.getElementById('stampActiveLayer');
  const enabledCb = document.getElementById('stampLayerEnabled');
  const fileNameSpan = document.getElementById('stampFileName');
  const vBitAngleContainer = document.getElementById('vBitAngleContainer');

  // Helpers -----------------------------------------------------------

  /** Read the editor's layer roster, or null if the editor isn't ready. */
  const editorLayers = () => {
    const ed = (typeof window !== 'undefined') ? window.svgEditor : null;
    return (ed && Array.isArray(ed._layers)) ? ed._layers : null;
  };

  /** Map an editor layer id → index in editor._layers, or -1. */
  const idxOfEditorLayer = (id) => {
    const layers = editorLayers();
    if (!layers) return -1;
    return layers.findIndex((L) => String(L.id) === String(id));
  };

  /** Build the dropdown options from the current source of truth.
   *  Falls back to P.stampLayers when the editor hasn't loaded yet
   *  (very early init). Stays a no-op if the <select> element is
   *  missing (defensive for headless tests). */
  const populateDropdown = () => {
    if (!sel) return;
    const layers = editorLayers();
    const useEditor = Array.isArray(layers) && layers.length > 0;
    const source = useEditor ? layers : (P.stampLayers || []);

    const prevValue = sel.value;
    sel.innerHTML = '';
    source.forEach((layer, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = layer.name || `Layer ${i + 1}`;
      sel.appendChild(opt);
    });

    // Sync the displayed value to the canonical active layer.
    let activeIdx = 0;
    if (useEditor) {
      const editor = window.svgEditor;
      const activeId = editor._activeLayer;
      const found = activeId != null ? idxOfEditorLayer(activeId) : -1;
      activeIdx = found >= 0 ? found : 0;
    } else {
      activeIdx = P.activeLayerIdx || 0;
    }
    if (activeIdx >= 0 && activeIdx < source.length) {
      sel.value = String(activeIdx);
    } else if (prevValue && source[Number(prevValue)]) {
      // Preserve user's previous choice when possible.
      sel.value = prevValue;
    }
  };

  // Initial paint ------------------------------------------------------

  populateDropdown();

  // Refresh whenever the editor's layer roster changes (add/remove/
  // rename/reorder/visibility). The editor's renderLayersPanel
  // dispatches the event after every change.
  if (typeof document !== 'undefined') {
    document.addEventListener('editorLayersChanged', populateDropdown);
  }

  const syncEnabledCheckbox = () => {
    if (!enabledCb) return;
    const layers = editorLayers();
    if (Array.isArray(layers) && layers.length > 0) {
      const idx = parseInt(sel?.value, 10) || 0;
      const layer = layers[idx];
      enabledCb.checked = !!(layer && layer.visible !== false);
    } else {
      const layer = ctx.activeLayer();
      enabledCb.checked = !!(layer && layer.enabled);
    }
  };

  // Active-layer change: set editor's active layer (canonical) AND
  // mirror P.activeLayerIdx so any legacy reader still works.
  if (sel) {
    sel.addEventListener('change', () => {
      const idx = parseInt(sel.value, 10);
      if (Number.isNaN(idx)) return;
      updateP('activeLayerIdx', idx);

      // Set the editor's active layer (source of truth).
      const layers = editorLayers();
      if (Array.isArray(layers) && layers[idx] && window.svgEditor) {
        try { window.svgEditor.setActiveLayer(layers[idx].id); }
        catch (_) { /* setActiveLayer is defined on VectorEditor — defensive */ }
      }

      // Broadcast to all per-control modules so they refresh from this
      // layer's values. Each module's syncFromLayer handles its own
      // input ↔ slider sync.
      ctx.broadcastSyncFromLayer();

      // Layer-level UI bits this module owns:
      syncEnabledCheckbox();
      const activeLayer = (Array.isArray(layers) && layers[idx])
        ? layers[idx]
        : P.stampLayers?.[idx];
      if (activeLayer && vBitAngleContainer) {
        vBitAngleContainer.style.display = (activeLayer.profile === 'vbit' || activeLayer.profile === 'adaptive')
          ? 'block' : 'none';
      }
      // The "file chosen" label is meaningful only for the legacy
      // per-layer SVG model. In the unified model the editor owns all
      // content, so we just show whether the editor's active layer has
      // any shapes.
      if (fileNameSpan) {
        const editor = window.svgEditor;
        if (editor && editor._sketchLayer && layers && layers[idx]) {
          const layerId = String(layers[idx].id);
          const hasContent = editor._sketchLayer.children().toArray()
            .some((ch) => String(ch.attr('data-layer')) === layerId);
          fileNameSpan.textContent = hasContent ? 'In editor' : 'Empty';
        } else if (activeLayer?.svg) {
          fileNameSpan.textContent = 'Loaded';
        } else {
          fileNameSpan.textContent = 'No file chosen';
        }
      }
    });
  }

  // Enabled checkbox: flips the active layer's enabled/visible flag.
  // For editor layers, this maps to `visible` and goes through the
  // editor's setLayerVisible so the layers panel + canvas stay in sync.
  // For legacy stamp layers (no editor coverage), keeps the old
  // setStampLayerEnabled path.
  if (enabledCb) {
    enabledCb.addEventListener('change', () => {
      const idx = parseInt(sel?.value, 10) || 0;
      const layers = editorLayers();
      if (Array.isArray(layers) && layers[idx]) {
        const editor = window.svgEditor;
        const layer = layers[idx];
        // Route through the canonical setLayerVisible so the eye icon
        // in the layers panel AND the layer-hidden / inactive-layer CSS
        // classes on SVG elements are properly updated (applyLayerState).
        if (editor) {
          try { setLayerVisible(editor, layer.id, enabledCb.checked); } catch (_) {}
        } else {
          // No editor yet — just mutate the flag so the stamp rebuild
          // picks up the new value; the panel will sync when it opens.
          layer.visible = enabledCb.checked;
        }
        // Trigger a rebuild — visibility affects which passes are applied.
        scheduleRebuild(() => rebuild(ctx.preview, updateStampMasks, updatePreviewSculptMode), 0);
      } else {
        const layer = ctx.activeLayer();
        if (!layer) return;
        setStampLayerEnabled(P.activeLayerIdx, enabledCb.checked);
        scheduleRebuild(() => rebuild(ctx.preview, updateStampMasks, updatePreviewSculptMode), 0);
      }
    });
  }

  // Initial sync
  syncEnabledCheckbox();

  return ctx.registerModule({
    id: 'layer',
    syncFromLayer(_layer) {
      // We're the orchestrator, not orchestrated. The enabled-checkbox
      // sync happens in the active-layer change handler above; we also
      // re-sync it whenever the editor layer roster changes.
    },
    /** Public so other modules (svg-source) can poke this when they
     *  flip the layer's `enabled` flag indirectly (Browse/Clear). */
    syncEnabled: syncEnabledCheckbox,
  });
}

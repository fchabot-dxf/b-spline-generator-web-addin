/**
 * Layer-change side effects for the Vector Stamping sidebar.
 *
 * SE10 / T26: the #stampActiveLayer dropdown + #stampLayerEnabled
 * checkbox are gone — the sidebar now shows a real layer list
 * (editor/layers.js's renderLayerList, rendered into #stampLayersList by
 * renderLayersPanel itself, compact:true). This module no longer owns
 * any layer-PICKING UI; it owns keeping the rest of the sidebar in sync
 * with whichever layer the list (or the editor's own Layers panel — same
 * shared render, same setActiveLayer) makes active:
 *   - P.activeLayerIdx, the index-based accessor ctx.activeLayer() /
 *     _shared.js's activeEditorLayer() still read (index into
 *     window.svgEditor._layers, not the canonical id) — kept in sync so
 *     the Plunge Depth / Tool Profile / V-Bit Angle controls keep editing
 *     whatever layer is actually active, exactly as before.
 *   - the V-Bit Angle row's visibility (profile-dependent).
 *   - the "file chosen" status label.
 * All three used to live in the dropdown's own 'change' handler; now
 * they run off `editorLayersChanged` (already existed — layers.js
 * dispatches it after every layer-roster change, add/remove/rename/
 * reorder/visibility/active-switch, from EITHER list, since both funnel
 * through the one renderLayersPanel), same unconditional-refresh shape
 * the old populateDropdown() had.
 */
import { updateP } from '../../core/state.js';
import { addLayer, setActiveLayer } from '../../editor/layers.js';

export function initLayer(ctx) {
  const fileNameSpan = document.getElementById('stampFileName');
  const vBitAngleContainer = document.getElementById('vBitAngleContainer');
  const addBtn = document.getElementById('stampAddLayer');

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

  const syncFromEditor = () => {
    const editor = (typeof window !== 'undefined') ? window.svgEditor : null;
    const layers = editorLayers();
    if (!editor || !layers) return;

    const activeId = editor._activeLayer;
    const idx = activeId != null ? idxOfEditorLayer(activeId) : -1;
    if (idx >= 0) updateP('activeLayerIdx', idx);
    const activeLayer = idx >= 0 ? layers[idx] : null;

    // Broadcast to all per-control modules so they refresh from this
    // layer's values. Each module's syncFromLayer handles its own
    // input ↔ slider sync.
    ctx.broadcastSyncFromLayer();

    if (activeLayer && vBitAngleContainer) {
      vBitAngleContainer.style.display = (activeLayer.profile === 'vbit' || activeLayer.profile === 'adaptive')
        ? 'block' : 'none';
    }
    // The "file chosen" label is meaningful only for the legacy per-layer
    // SVG model. In the unified model the editor owns all content, so we
    // just show whether the editor's active layer has any shapes.
    if (fileNameSpan) {
      if (editor._sketchLayer && activeLayer) {
        const layerId = String(activeLayer.id);
        const hasContent = editor._sketchLayer.children().toArray()
          .some((ch) => String(ch.attr('data-layer')) === layerId);
        fileNameSpan.textContent = hasContent ? 'In editor' : 'Empty';
      } else {
        fileNameSpan.textContent = 'No file chosen';
      }
    }
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('editorLayersChanged', syncFromEditor);
  }

  // "+" — same addLayer + setActiveLayer the editor's own Layers panel
  // button (#editorAddLayer, editor/layers.js's initLayerControls) calls.
  // No-op if the editor hasn't been opened yet — there's no roster to add
  // to, and nothing in this panel lets you carve without it either.
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const editor = (typeof window !== 'undefined') ? window.svgEditor : null;
      if (!editor) return;
      const layer = addLayer(editor);
      setActiveLayer(editor, layer.id);
    });
  }

  // Initial sync, in case the editor already has a roster by the time
  // this module initializes.
  syncFromEditor();

  return ctx.registerModule({
    id: 'layer',
    syncFromLayer(_layer) {
      // We're the orchestrator, not orchestrated.
    },
    /** Public so other modules (svg-source) can poke this when they flip
     *  a layer's visible flag indirectly (Browse/Clear import/clear).
     *  setLayerVisible (editor/layers.js) already re-renders both layer
     *  lists itself — this is a defensive extra pass for the sidebar's
     *  own bits (V-Bit Angle, file-name label) in case that specific
     *  layer was the active one. */
    syncEnabled: syncFromEditor,
  });
}

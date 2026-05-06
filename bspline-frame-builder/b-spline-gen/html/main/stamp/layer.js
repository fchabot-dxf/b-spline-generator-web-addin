/**
 * Active Layer + Enabled checkbox — which stamp layer the panel is
 * currently editing, and whether that layer participates in the rebuild.
 *
 * The active-layer change handler is the orchestrator that pushes the
 * new layer's values out to every other module's UI in one shot, via
 * ctx.broadcastSyncFromLayer().
 */
import { P, updateP } from '../../core/state.js';
import { scheduleRebuild, rebuild } from '../../core/engine.js';
import { updateStampMasks } from '../stamp-mask-manager.js';
import { updatePreviewSculptMode } from '../../core/sculpt-interaction.js';

export function initLayer(ctx) {
  const sel = document.getElementById('stampActiveLayer');
  const enabledCb = document.getElementById('stampLayerEnabled');
  const fileNameSpan = document.getElementById('stampFileName');
  const vBitAngleContainer = document.getElementById('vBitAngleContainer');

  // Populate dropdown from layer names (data-driven so adding a layer
  // in state.js doesn't require touching HTML).
  if (sel && Array.isArray(P.stampLayers)) {
    sel.innerHTML = '';
    P.stampLayers.forEach((layer, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = layer.name || `Layer ${i + 1}`;
      sel.appendChild(opt);
    });
    sel.value = String(P.activeLayerIdx || 0);
  }

  const syncEnabledCheckbox = () => {
    if (!enabledCb) return;
    const layer = ctx.activeLayer();
    enabledCb.checked = !!(layer && layer.enabled);
  };

  // Active-layer change: read layer values into ALL modules' UIs.
  if (sel) {
    sel.addEventListener('change', () => {
      const idx = parseInt(sel.value, 10);
      updateP('activeLayerIdx', idx);
      const layer = P.stampLayers[idx];
      if (!layer) return;

      // Broadcast to all per-control modules so they refresh from this
      // layer's values. Each module's syncFromLayer handles its own
      // input ↔ slider sync.
      ctx.broadcastSyncFromLayer();

      // Layer-level UI bits this module owns:
      syncEnabledCheckbox();
      if (vBitAngleContainer) {
        vBitAngleContainer.style.display = (layer.profile === 'vbit' || layer.profile === 'adaptive')
          ? 'block' : 'none';
      }
      if (fileNameSpan) fileNameSpan.textContent = layer.svg ? 'Loaded' : 'No file chosen';

      // Reload the SVG editor's content for the new layer (if it's open).
      if (window.svgEditor) {
        window.svgEditor.open(layer.svg || '', P.widthIn, P.heightIn);
      }
    });
  }

  // Enabled checkbox: just flips the layer flag and rebuilds (no remask
  // — engine reads .enabled directly when applying the existing mask).
  if (enabledCb) {
    enabledCb.addEventListener('change', () => {
      const layer = ctx.activeLayer();
      if (!layer) return;
      layer.enabled = enabledCb.checked;
      scheduleRebuild(() => rebuild(ctx.preview, updateStampMasks, updatePreviewSculptMode), 0);
    });
  }

  // Initial sync
  syncEnabledCheckbox();

  return ctx.registerModule({
    id: 'layer',
    syncFromLayer(_layer) {
      // We're the orchestrator, not orchestrated; nothing to do.
      // (We DO sync our own enabled-checkbox, separately, in the
      //  active-layer change handler above.)
    },
    /** Public so other modules (svg-source) can poke this when they
     *  flip the layer's `enabled` flag indirectly (Browse/Clear). */
    syncEnabled: syncEnabledCheckbox,
  });
}

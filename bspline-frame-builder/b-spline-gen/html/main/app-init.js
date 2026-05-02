import { P, loadLastSession, lastResult, setStampLayerSvg } from '../core/state.js';
import { syncUItoParam, updateSpacingLabels } from '../core/ui-utils.js';
import { resolveGrid } from '../core/terrain.js';
import { rebuild } from '../core/engine.js';
import { updatePreviewSculptMode } from '../core/sculpt-interaction.js';
import { updateGlobalButtons } from '../core/history.js';
import { AppState } from './app-state.js';
import { refreshAllStampMasks, updateStampMasks } from './stamp-mask-manager.js';
import { VectorEditor } from '../editor/index.js';

export async function initApp(preview, wireGlobalEvents) {
  AppState.isInitializing = true;
  loadLastSession();

  if (!isNaN(P.seed)) {
    P.seed = Math.floor(Math.random() * 99999);
  }

  Object.keys(P).forEach(k => syncUItoParam(k, P[k]));
  updateSpacingLabels(P.widthIn, P.heightIn);

  if (preview) preview.setCurvesVisible(P.showMesh);

  AppState.isInitializing = false;

  let grid = lastResult ?? resolveGrid(P.widthIn, P.heightIn, P.spacing);
  if (!grid.nx || grid.nx < 4 || !grid.nz || grid.nz < 4) {
    grid = resolveGrid(P.widthIn, P.heightIn, P.spacing);
  }
  const { nx, nz } = grid;

  if (P.stampLayers && P.stampLayers.some(l => l.svg)) {
    await refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode);
  } else {
    rebuild(preview, updateStampMasks, updatePreviewSculptMode);
  }

  updateGlobalButtons();
  wireGlobalEvents();
}

export function initSvgEditor(preview) {
  if (!window.svgEditor) window.svgEditor = new VectorEditor();

  window.svgEditor.initEditor(
    'editorSVGContainer',
    'svgEditorTopView',
    // onChange — fires after every edit. Use saveForRasterization (async)
    // so the SVG handed to stamp.js carries embedded @font-face for every
    // text element. Without this, iOS rasterizes Symbol/Wingdings/Webdings
    // text as plain Latin glyphs (no document-level @font-face reaches a
    // detached data: URL render context).
    async () => {
      const svg = await window.svgEditor.saveForRasterization();
      if (svg) {
        setStampLayerSvg(P.activeLayerIdx, svg);
        const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
        refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode);
      }
    },
    // onCommit — same rationale: re-build with embedded fonts so the
    // committed stamp matches the on-screen rendering.
    async (svg) => {
      if (svg === 'push') return;
      // Ignore the sync svg arg; rebuild with embedded fonts for the stamp.
      const fontEmbeddedSvg = svg ? await window.svgEditor.saveForRasterization() : null;
      if (fontEmbeddedSvg) {
        setStampLayerSvg(P.activeLayerIdx, fontEmbeddedSvg);
        const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
        refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode);
      }
      const modal = document.getElementById('svgEditorModal');
      if (modal) modal.style.display = 'none';
    }
  );
}

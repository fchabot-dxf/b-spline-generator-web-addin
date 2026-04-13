import { P, loadLastSession, lastResult, setStampLayerSvg } from '../core/state.js';
import { syncUItoParam, updateSpacingLabels } from '../core/ui-utils.js';
import { resolveGrid } from '../core/terrain.js';
import { rebuild, updateEditorTopView } from '../core/engine.js';
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
    await refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode, updateEditorTopView);
  } else {
    rebuild(preview, updateStampMasks, updatePreviewSculptMode, updateEditorTopView);
  }

  updateGlobalButtons();
  wireGlobalEvents();
}

export function initSvgEditor(preview) {
  if (!window.svgEditor) window.svgEditor = new VectorEditor();

  window.svgEditor.initEditor(
    'editorSVGContainer',
    'svgEditorTopView',
    () => {
      const svg = window.svgEditor.save();
      if (svg) {
        setStampLayerSvg(P.activeLayerIdx, svg);
        const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
        refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode, updateEditorTopView);
      }
    },
    (svg) => {
      if (svg === 'push') return;
      if (svg) {
        setStampLayerSvg(P.activeLayerIdx, svg);
        const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
        refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode, updateEditorTopView);
      }
      const modal = document.getElementById('svgEditorModal');
      if (modal) modal.style.display = 'none';
    }
  );
}

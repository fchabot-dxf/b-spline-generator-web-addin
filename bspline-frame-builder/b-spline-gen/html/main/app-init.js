import { P, isFusionMode, loadLastSession, saveLastSession, lastResult, setStampLayerSvg, setStampLayerMask, setStampLayerEnabled } from '../core/state.js';
import { syncUItoParam, updateSpacingLabels } from '../core/ui-utils.js';
import { resolveGrid } from '../core/terrain.js';
import { rebuild } from '../core/engine.js';
import { updatePreviewSculptMode } from '../core/sculpt-interaction.js';
import { updateGlobalButtons } from '../core/history.js';
import { AppState } from './app-state.js';
import { refreshAllStampMasks, updateStampMasks } from './stamp-mask-manager.js';
import { VectorEditor } from '../editor/index.js';
import { getLayerSvg } from '../editor/editor-io.js';
import { fusLog } from '../core/fusion-bridge.js';

// Snapshot of the active stamp layer captured when the SVG editor modal
// opens. The Cancel button restores from this so closing without applying
// genuinely undoes the in-flight edits (instead of silently keeping them
// because onChange already wrote to the layer during typing).
export const SvgEditorSnapshot = { active: false, layerIdx: -1, svg: null, mask: null, enabled: false };

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
        // Step 3 unification: the editor's full document is the source
        // of truth. Persist to P.editorSvg so a page reload restores it.
        P.editorSvg = svg;
        // Legacy: also mirror to P.stampLayers[active].svg so any code
        // path still consulting it (Cancel-snapshot restore, etc.) sees
        // a consistent value during the transition.
        setStampLayerSvg(P.activeLayerIdx, svg);
        saveLastSession();
        const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
        refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode);
      }
    },
    // onCommit — fires from Apply (svg=truthy) or Cancel (svg=null).
    // Apply: rebuild with font-embedded SVG and close.
    // Cancel: restore the snapshot we captured when the modal opened so
    // the in-flight edits (already written by onChange while typing)
    // really go away — otherwise "Cancel" silently keeps changes.
    async (svg) => {
      if (svg === 'push') return;
      if (svg) {
        // Apply path
        const fontEmbeddedSvg = await window.svgEditor.saveForRasterization();
        if (fontEmbeddedSvg) {
          // Step 3 unification: editor is source of truth.
          P.editorSvg = fontEmbeddedSvg;
          setStampLayerSvg(P.activeLayerIdx, fontEmbeddedSvg);
          saveLastSession();
          const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
          refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode);
        }
      } else if (SvgEditorSnapshot.active && SvgEditorSnapshot.layerIdx >= 0) {
        // Cancel path — restore pre-edit state for the layer that was being edited.
        const idx = SvgEditorSnapshot.layerIdx;
        if (P.stampLayers[idx]) {
          // Restore raw fields directly: setStampLayerSvg auto-enables the
          // layer when svg is non-null, which we don't want here — we're
          // restoring whatever enabled state existed pre-edit.
          P.stampLayers[idx].svg = SvgEditorSnapshot.svg;
          P.stampLayers[idx].mask = SvgEditorSnapshot.mask;
          setStampLayerEnabled(idx, SvgEditorSnapshot.enabled);
        }
        const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
        refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode);
      }
      SvgEditorSnapshot.active = false;
      const modal = document.getElementById('svgEditorModal');
      if (modal) modal.style.display = 'none';
    }
  );

  // Step 3 unification: restore the saved editor SVG so a reload picks
  // up the in-flight drawing instead of a blank canvas. Falls back to
  // P.stampLayers[0].svg as a one-time migration aid for sessions saved
  // before P.editorSvg existed.
  try {
    const restoreSvg = P.editorSvg
      || (P.stampLayers && P.stampLayers.find && P.stampLayers.find(l => l && l.svg)?.svg)
      || null;
    if (restoreSvg) {
      window.svgEditor.open(restoreSvg, P.widthIn, P.heightIn);
    }
  } catch (e) {
    console.warn('[initSvgEditor] editor SVG restore failed:', e);
  }

  // BUG-23: Send-to-Fusion button. Only meaningful when the page is
  // running inside Fusion 360. Sends one sketch per visible editor
  // layer to the active component (bypassing the STEP export path).
  // Python add-in side will handle the 'import_svg_sketches' channel.
  initSendToFusionButton();
}

function initSendToFusionButton() {
  const btn = document.getElementById('editorSendToFusion');
  if (!btn) return;
  // Show only inside Fusion. isFusionMode is set by pollMode() in
  // fusion-bridge.js — at the time initSvgEditor runs that detection
  // may still be in-flight, so we recheck on click too.
  const refreshVisibility = () => {
    btn.style.display = isFusionMode ? 'inline-flex' : 'none';
  };
  refreshVisibility();
  // Cheap polling — pollMode finishes in <=400ms during normal init,
  // and once Fusion mode flips on it stays on for the session.
  let ticks = 0;
  const visTimer = setInterval(() => {
    refreshVisibility();
    if (isFusionMode || ++ticks > 20) clearInterval(visTimer);
  }, 250);

  btn.addEventListener('click', () => {
    try {
      const editor = window.svgEditor;
      if (!editor || !Array.isArray(editor._layers)) return;
      const sketches = [];
      for (const layer of editor._layers) {
        if (!layer || layer.visible === false) continue;
        const svg = getLayerSvg(editor, layer.id);
        if (!svg) continue;
        sketches.push({
          id: String(layer.id),
          name: layer.name || `Layer ${layer.id}`,
          // Per-pass tooling — Python side may use these to label the
          // sketch / drive a downstream CAM op.
          depth: layer.depth,
          profile: layer.profile,
          tx: layer.tx, ty: layer.ty,
          rotation: layer.rotation,
          scale: layer.scale,
          mirrorX: !!layer.mirrorX, mirrorY: !!layer.mirrorY,
          svg,
        });
      }
      if (sketches.length === 0) {
        fusLog('[SendToFusion] no visible layers with content — nothing to send');
        return;
      }
      const payload = JSON.stringify({
        sketches,
        widthIn: P.widthIn,
        heightIn: P.heightIn,
      });
      try {
        adsk.fusionSendData('import_svg_sketches', payload);
        fusLog(`[SendToFusion] sent ${sketches.length} sketch(es) (${payload.length} chars)`);
      } catch (e) {
        fusLog(`[SendToFusion] adsk.fusionSendData failed: ${e.message}`);
        console.error('[SendToFusion] failed:', e);
      }
    } catch (e) {
      console.error('[SendToFusion] click handler crashed:', e);
    }
  });
}

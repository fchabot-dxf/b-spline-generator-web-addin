import { P, setPreDelta, setPostDelta, setExtraThickenThinMask } from '../core/state.js';
import { syncUItoParam } from '../core/ui-utils.js';
import { updateGlobalButtons } from '../core/history.js';
import { scheduleRebuild, rebuild } from '../core/engine.js';
import { updateStampMasks } from './stamp-mask-manager.js';
import { updatePreviewSculptMode } from '../core/sculpt-interaction.js';
import { resolveGrid } from '../core/terrain.js';
import { AppState } from './app-state.js';

export async function applySnapshot(snap, preview) {
  if (!snap) return;
  AppState.isInitializing = true;
  Object.keys(snap.P).forEach(k => {
    P[k] = snap.P[k];
    syncUItoParam(k, P[k]);
  });
  AppState.isInitializing = false;
  if (snap.preDelta) setPreDelta(new Float32Array(snap.preDelta));
  if (snap.postDelta) setPostDelta(new Float32Array(snap.postDelta));
  // extraThickenThinMask is written by takeSnapshot (history.js) and the
  // preset save path. Restoring it here keeps undo/redo and preset load
  // consistent with the in-memory state at snapshot time. If absent or
  // null, clear the current mask so we don't carry over a stale one from
  // a previous state.
  if (snap.extraThickenThinMask) {
    setExtraThickenThinMask(new Float32Array(snap.extraThickenThinMask));
  } else {
    setExtraThickenThinMask(null);
  }
  if (snap.stampSvgText !== undefined && P.stampLayers && P.stampLayers[0]) {
    P.stampLayers[0].svg = snap.stampSvgText;
  }
  updateGlobalButtons();

  // Stamp masks are stripped on save (typed-array JSON corruption: a
  // Float32Array round-trips as {"0":..., "1":...} which fails downstream
  // instanceof / .length checks). The save path relies on
  // updateStampMasks() to regenerate masks from .svg before any rebuild
  // reads them. rebuild() in engine/rebuild.js silently skips any layer
  // whose .mask is null:
  //   if (layer && layer.svg && layer.mask && layer.mask.length === nx*nz)
  // so without regen, the SVG is loaded but never imprinted.
  // Regenerate masks here before scheduling the rebuild.
  const hasStampSvg = (P.stampLayers || []).some(L => L && L.svg && L.enabled !== false);
  if (hasStampSvg) {
    try {
      const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
      await updateStampMasks(nx, nz);
    } catch (e) {
      console.warn('[applySnapshot] stamp mask regen failed:', e);
    }
  }

  scheduleRebuild(() => rebuild(preview, updateStampMasks, updatePreviewSculptMode), 0);
}

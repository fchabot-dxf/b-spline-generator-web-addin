import { P, setPreDelta, setPostDelta, setExtraThickenThinMask } from '../core/state.js';
import { syncUItoParam } from '../core/ui-utils.js';
import { updateGlobalButtons } from '../core/history.js';
import { scheduleRebuild, rebuild } from '../core/engine.js';
import { updateStampMasks } from './stamp-mask-manager.js';
import { updatePreviewSculptMode } from '../core/sculpt-interaction.js';
import { AppState } from './app-state.js';

export function applySnapshot(snap, preview) {
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
  scheduleRebuild(() => rebuild(preview, updateStampMasks, updatePreviewSculptMode), 0);
}

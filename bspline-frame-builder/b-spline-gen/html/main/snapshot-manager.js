import { P, setPreDelta, setPostDelta } from '../core/state.js';
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
  if (snap.stampSvgText !== undefined && P.stampLayers && P.stampLayers[0]) {
    P.stampLayers[0].svg = snap.stampSvgText;
  }
  updateGlobalButtons();
  scheduleRebuild(() => rebuild(preview, updateStampMasks, updatePreviewSculptMode), 0);
}

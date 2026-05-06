import { P, setPreDelta, setPostDelta, setExtraThickenThinMask, setStrokeCache } from '../core/state.js';
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

  // Always (re)set preDelta and postDelta — including to null when the
  // snapshot doesn't have one. Previously we only assigned when truthy,
  // which let a STALE delta from the previous project leak across loads.
  // If that previous delta's length didn't match the new grid, rebuild's
  // `cleanHeights[k] += preDelta[k]` read past the end and produced NaN
  // heights — the "broken model on first load" symptom. The user "fixed"
  // it by loading again (often masking the issue once the second load
  // got the previous-load-induced state into a consistent shape).
  setPreDelta(snap.preDelta ? new Float32Array(snap.preDelta) : null);
  setPostDelta(snap.postDelta ? new Float32Array(snap.postDelta) : null);
  if (snap.extraThickenThinMask) {
    setExtraThickenThinMask(new Float32Array(snap.extraThickenThinMask));
  } else {
    setExtraThickenThinMask(null);
  }

  // strokeCache is the in-progress sculpt-stroke fast-path cache. If a
  // stroke ended in a non-clean way before the load, rebuild will short
  // out to the cached `baseStamped` heights from the OLD project and
  // never touch the freshly-loaded P. Clear it on every load.
  setStrokeCache(null);

  if (snap.stampSvgText !== undefined && P.stampLayers && P.stampLayers[0]) {
    P.stampLayers[0].svg = snap.stampSvgText;
  }
  updateGlobalButtons();

  // Stamp masks are stripped on save (typed-array JSON corruption: a
  // Float32Array round-trips as {"0":..., "1":...} which fails the
  // downstream instanceof / .length checks). The save path relies on
  // updateStampMasks() to regenerate masks from .svg before any rebuild
  // reads them. rebuild() in engine/rebuild.js silently skips any layer
  // whose .mask is null or whose body channel is missing/wrong length,
  // so without regen the SVG is loaded but never imprinted.
  // Regenerate masks here before scheduling the rebuild.
  const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
  const hasStampSvg = (P.stampLayers || []).some(L => L && L.svg && L.enabled !== false);
  if (hasStampSvg) {
    try {
      await updateStampMasks(nx, nz);
    } catch (e) {
      console.warn('[applySnapshot] stamp mask regen failed:', e);
    }
  }

  // Sync the param-manager's grid-change tracker so the NEXT slider
  // tweak doesn't see "(nx, nz) differs from last applyParam" and fire
  // a redundant full-mask refresh on top of the load.
  AppState.lastNx = nx;
  AppState.lastNz = nz;

  scheduleRebuild(() => rebuild(preview, updateStampMasks, updatePreviewSculptMode), 0);
}

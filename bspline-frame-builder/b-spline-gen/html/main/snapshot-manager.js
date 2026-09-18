import { P, setPreDelta, setPostDelta, setExtraThickenThinMask, setStrokeCache } from '../core/state.js';
import { syncUItoParam } from '../core/ui-utils.js';
import { updateGlobalButtons } from '../core/history.js';
import { scheduleRebuild, rebuild } from '../core/engine.js';
import { updateStampMasks } from './stamp-mask-manager.js';
import { updatePreviewSculptMode } from '../core/sculpt-interaction.js';
import { resolveGrid } from '../core/terrain.js';
import { AppState } from './app-state.js';
import { runMigrations } from './app-init.js';

export async function applySnapshot(snap, preview) {
  if (!snap) return;
  AppState.isInitializing = true;
  Object.keys(snap.P).forEach(k => {
    P[k] = snap.P[k];
    syncUItoParam(k, P[k]);
  });
  AppState.isInitializing = false;

  // SE4c: this is also the cloud-project-load apply step (cloud-project-
  // manager.js's _loadFrom), so a project saved before the migration
  // needs it run here too, not just after loadLastSession(). Idempotent —
  // a no-op once P.editorSvg exists, so re-running it on every undo/redo
  // that also flows through this function costs nothing.
  runMigrations();

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

  updateGlobalButtons();

  // SE4c (product decision): global undo/redo is for the heightfield
  // (sculpt, seed, filters) — the drawing has the editor's OWN undo stack
  // and is intentionally left untouched here, including on cloud project
  // load (this function is also _loadFrom's apply step). Tooling fields
  // (depth/profile/blur/etc.) ARE restored above as part of P.stampLayers,
  // and rasterizeSvg bakes them into the mask at rasterize time, so the
  // mask still needs a refresh against the (unchanged) editor content —
  // unconditional now that there's no `.svg` field left on P.stampLayers
  // to gate on.
  const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
  try {
    await updateStampMasks(nx, nz);
  } catch (e) {
    console.warn('[applySnapshot] stamp mask regen failed:', e);
  }

  // Sync the param-manager's grid-change tracker so the NEXT slider
  // tweak doesn't see "(nx, nz) differs from last applyParam" and fire
  // a redundant full-mask refresh on top of the load.
  AppState.lastNx = nx;
  AppState.lastNz = nz;

  scheduleRebuild(() => rebuild(preview, updateStampMasks, updatePreviewSculptMode), 0);
}

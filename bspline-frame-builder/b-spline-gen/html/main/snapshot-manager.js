import { P, setPreDelta, setPostDelta, setExtraThickenThinMask, setStrokeCache } from '../core/state.js';
import { syncUItoParam } from '../core/ui-utils.js';
import { updateGlobalButtons, restoreLayerTooling, setUndoRestoring } from '../core/history.js';
import { scheduleRebuild, rebuild } from '../core/engine.js';
import { updateStampMasks } from './stamp-mask-manager.js';
import { updatePreviewSculptMode } from '../core/sculpt-interaction.js';
import { resolveGrid } from '../core/terrain.js';
import { AppState } from './app-state.js';
import { runMigrations, editorRestoreSvg, refreshDrape } from './app-init.js';

/**
 * T45 (Fred: "on open, a loaded project doesn't have the SVG until I open
 * the editor and Apply Stencils"): `source` names WHICH of this
 * function's two meanings a call is — 'undo' (global heightfield
 * undo/redo; the drawing has its OWN undo stack and stays untouched here,
 * SE4c's own ruling) or 'load' (a project load — cloud load today;
 * loading REPLACES the drawing too, not just P.editorSvg). No default:
 * every caller must name itself explicitly, since a silent default here
 * is exactly the shape of bug that shipped originally — one function,
 * one behavior, reused for two meanings that needed to differ.
 */
export async function applySnapshot(snap, preview, { source } = {}) {
  if (!snap) return;
  if (source !== 'undo' && source !== 'load') {
    throw new Error(`applySnapshot: source must be 'undo' or 'load' (got ${JSON.stringify(source)})`);
  }
  AppState.isInitializing = true;
  // UX-UNDO: syncUItoParam deliberately dispatches a real 'change' on
  // checkboxes (see its own comment) so dependent panels re-sync — but
  // that's the SAME event bind() listens on to schedule an undo step.
  // Without this guard, restoring a snapshot would immediately schedule
  // ANOTHER one as a side effect of the restore itself.
  setUndoRestoring(true);
  Object.keys(snap.P).forEach(k => {
    P[k] = snap.P[k];
    syncUItoParam(k, P[k]);
  });
  setUndoRestoring(false);
  AppState.isInitializing = false;

  // SE5c: restore per-layer TOOLING (not content — editorSvg/_mask stay
  // untouched, per SE4c) from editor._layers, then push the restored
  // values out to the stamp panel's own inputs (the same refresh a
  // layer-switch does via ctx.broadcastSyncFromLayer) so e.g. the Plunge
  // Depth field visibly snaps back on undo instead of only the model
  // reverting underneath a stale-looking number.
  const editorForTooling = (typeof window !== 'undefined') ? window.svgEditor : null;
  if (editorForTooling) restoreLayerTooling(editorForTooling._layers, snap.layerTooling);
  AppState.stampCtx?.broadcastSyncFromLayer?.();

  // SE4c: this is also the cloud-project-load apply step (cloud-project-
  // manager.js's _loadFrom), so a project saved before the migration
  // needs it run here too, not just after loadLastSession(). Idempotent —
  // a no-op once P.editorSvg exists, so re-running it on every undo/redo
  // that also flows through this function costs nothing.
  runMigrations();

  // T45: 'load' also replaces the LIVE editor's own document — P.editorSvg
  // was already overwritten above (part of the P-restore loop), but
  // window.svgEditor's own _sketchLayer is a SEPARATE store this function
  // never touched before (that's the whole bug). editor.open()
  // (editor-io.js) also: clears the whole sketch layer and rebuilds the
  // layer roster from THIS document (never a stale mix with the previous
  // project's own layers), resets the editor's own undo stack, and — via
  // its own last step, setActiveLayer() — refreshes the sidebar Layers
  // panel AND the outline preview. One call covers 3 of this task's 4
  // "must refresh on load" items; only stamp masks (below, already
  // unconditional so it just needs fresh content to read) and drape
  // (added below) need an explicit call of their own.
  if (source === 'load') {
    const editorForLoad = (typeof window !== 'undefined') ? window.svgEditor : null;
    if (editorForLoad) editorForLoad.open(editorRestoreSvg(), P.widthIn, P.heightIn);
  }

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
  // and is intentionally left untouched on 'undo' (T45: 'load' DOES
  // replace it now, above — this mask refresh runs unconditionally for
  // both, so 'load' picks up the freshly-loaded content for free here).
  // Tooling fields (depth/profile/blur/etc.) ARE restored above as part
  // of P.stampLayers, and rasterizeSvg bakes them into the mask at
  // rasterize time, so the mask still needs a refresh regardless.
  const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
  try {
    await updateStampMasks(nx, nz);
  } catch (e) {
    console.warn('[applySnapshot] stamp mask regen failed:', e);
  }
  // T45: the drape texture is DERIVED from the editor's own drawing —
  // 'undo' never changes the drawing (see above), so it never needs a
  // drape refresh; 'load' does, same as editor-io.js's open() itself
  // needing a drape refresh wherever it's called (app-init.js's own
  // Apply/Cancel/boot-restore paths already pair every open() with one).
  if (source === 'load') {
    try {
      await refreshDrape(preview);
    } catch (e) {
      console.warn('[applySnapshot] drape refresh failed:', e);
    }
  }

  // Sync the param-manager's grid-change tracker so the NEXT slider
  // tweak doesn't see "(nx, nz) differs from last applyParam" and fire
  // a redundant full-mask refresh on top of the load.
  AppState.lastNx = nx;
  AppState.lastNz = nz;

  scheduleRebuild(() => rebuild(preview, updateStampMasks, updatePreviewSculptMode), 0);
}

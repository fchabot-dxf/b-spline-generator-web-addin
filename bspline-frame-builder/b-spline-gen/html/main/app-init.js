import { P, loadLastSession, saveLastSession, lastResult } from '../core/state.js';
import { syncUItoParam, updateSpacingLabels } from '../core/ui-utils.js';
import { resolveGrid } from '../core/terrain.js';
import { rebuild } from '../core/engine.js';
import { updatePreviewSculptMode } from '../core/sculpt-interaction.js';
import { updateGlobalButtons, takeSnapshot, globalHistoryLog } from '../core/history.js';
import { AppState } from './app-state.js';
import { refreshAllStampMasks, updateStampMasks } from './stamp-mask-manager.js';
import { VectorEditor } from '../editor/index.js';
import { buildDrapeSvg } from '../core/preview/drape-svg.js';
import { dbg, isDebugEnabled } from '../core/debug.js';
import { fusLog } from '../core/fusion-bridge.js';

// SE3a: snapshot of the unified editor document (P.editorSvg) captured
// when the SVG editor modal opens. The Cancel button restores it — reloads
// the editor from this document and remasks — so closing without applying
// genuinely undoes the in-flight edits (instead of silently keeping them
// because onChange already wrote P.editorSvg + remasked after every edit
// while the user was still typing).
export const SvgEditorSnapshot = { active: false, editorSvg: null };

/**
 * SE8b-2: what editor._onChange(kind) actually runs, declared once — the
 * dispatch's own point: the step that must never run during a drag is
 * `persist` (saveLastSession, a localStorage write), so THAT'S what's
 * conditional, not a scattered `if (kind === 'live')` guard buried in the
 * pipeline body. `_notifyChange`'s two kinds (editor.js): 'live' (at most
 * once per animation frame during a drag) and 'commit' (once per
 * gesture, or the default for any other caller). Every step still runs
 * in the SAME order it always did — nothing about WHAT runs changes.
 */
export const CHANGE_PIPELINE = {
    live:   ['serialize', 'remask'],
    commit: ['serialize', 'persist', 'remask'],
};

/** PERF category timing — off by default (core/debug.js's own gate), so
 *  this costs nothing until switched on. Goes through THREE channels when
 *  on: `dbg()` (site devtools console), `fusLog` (the add-in's log file —
 *  a no-op outside Fusion, see fusion-log.js), and `window.__perfLog`
 *  (SE8b-3: a plain array of `{kind, step, ms}` records) — the structured
 *  one a headless measurement tool (scripts/smoke-editor.mjs's `perf`
 *  mode) reads back directly via CDP, rather than scraping/parsing
 *  formatted console text. Takes the pieces structured (not a
 *  pre-formatted string) so the array entry and the human-readable line
 *  can't drift apart. Exported (despite the underscore — same convention
 *  as SE8a's stripRasterizationFontDefs) for direct testing without
 *  needing a real drag/pipeline run. */
export function _perfLog(kind, step, ms) {
    if (!isDebugEnabled('PERF')) return;
    const msg = `${kind} ${step} ${ms.toFixed(1)}ms`;
    dbg('PERF', msg);
    try { fusLog('[PERF] ' + msg); } catch (_) {}
    if (typeof window !== 'undefined') {
        if (!Array.isArray(window.__perfLog)) window.__perfLog = [];
        window.__perfLog.push({ kind, step, ms });
    }
}

/**
 * Run the CHANGE_PIPELINE for `kind`, timing each step that actually
 * executes. Takes its steps as plain callbacks (`serialize`/`persist`/
 * `remask`) rather than reaching for `window.svgEditor`/`P`/`resolveGrid`
 * directly, so the ORCHESTRATION (which steps run, in what order, timed
 * how) is testable with plain mock functions — no live editor, DOM, or
 * 3D preview needed. `serialize` returning falsy stops the pipeline
 * there (mirrors the ORIGINAL code's `if (svg) { persist; remask }`
 * guard exactly: an editor that isn't drawn yet has nothing to persist
 * or remask either).
 */
export async function runChangePipeline(kind, { serialize, persist, remask }) {
    const steps = CHANGE_PIPELINE[kind] || CHANGE_PIPELINE.commit;
    const frameStart = performance.now();
    for (const step of steps) {
        const stepStart = performance.now();
        if (step === 'serialize') {
            const svg = await serialize();
            if (!svg) break;
        } else if (step === 'persist') {
            persist();
        } else if (step === 'remask') {
            await remask();
        }
        _perfLog(kind, step, performance.now() - stepStart);
    }
    _perfLog(kind, 'total', performance.now() - frameStart);
}

/**
 * Resolve the SVG to restore the editor with: the unified source of truth,
 * P.editorSvg. SE4c: the legacy per-stamp-layer `.svg` fallback that used
 * to live here is folded into MIGRATIONS' `legacy-stamp-svg` entry — by the
 * time this is called, a legacy-shaped save has already been migrated into
 * P.editorSvg once, so there's nothing left to fall back to.
 *
 * Shared by BOTH the initial palette-load restore and the modal-reopen path
 * so they can't drift. Reopen used to read `.svg` off ctx.activeLayer(),
 * which in the unified model returns an EDITOR layer (id/name/tooling — no
 * `.svg`), so it passed undefined to open() and reopened blank (RO1).
 */
export function editorRestoreSvg() {
  return P.editorSvg || null;
}

/** Does this serialized editor document have any drawn content at all?
 *  Used at boot, before window.svgEditor exists, to decide whether the
 *  first rebuild needs a mask refresh — a lightweight parse of the
 *  string, not a live editor._layers query (which isn't available yet). */
function _editorSvgHasContent(svgText) {
  if (!svgText) return false;
  try {
    const root = new DOMParser().parseFromString(svgText, 'image/svg+xml').documentElement;
    return !!(root && root.children && root.children.length > 0);
  } catch (_) {
    return false;
  }
}

/**
 * Declared one-time migrations, run by `runMigrations(P)` right after P is
 * populated from a save (loadLastSession, or applySnapshot's cloud-project-
 * load path). Each entry's `when` gates on P's CURRENT shape rather than a
 * version number, so running the list twice (e.g. undo/redo going through
 * applySnapshot too) is a no-op once a migration's own `when` stops matching.
 */
export const MIGRATIONS = [
  {
    id: 'legacy-stamp-svg',
    // Pre-SE4 saves carried each layer's drawing as a field on its own
    // P.stampLayers entry; content now lives only in the editor document
    // (P.editorSvg).
    when: (p) => !p.editorSvg && Array.isArray(p.stampLayers) && p.stampLayers.some(l => l && l.svg),
    apply: (p) => {
      const layers = p.stampLayers;
      const bodies = [];
      // One loop over every legacy layer with content, not a .find() —
      // a multi-layer legacy save must land each layer's drawing under
      // its own data-layer group, not just the first.
      layers.forEach((layer, idx) => {
        if (!layer || !layer.svg) return;
        try {
          const parsed = new DOMParser().parseFromString(layer.svg, 'image/svg+xml');
          const root = parsed.documentElement;
          if (!root || root.nodeName.toLowerCase() !== 'svg') return;
          const metadata = root.querySelector('.editor-metadata');
          if (metadata) metadata.remove();
          Array.from(root.children).forEach((ch) => {
            ch.setAttribute('data-layer', String(idx));
            bodies.push(ch.outerHTML);
          });
        } catch (e) {
          console.warn(`[migration] legacy-stamp-svg: layer ${idx} failed to parse:`, e);
        }
      });

      // Roster entry per P.stampLayers position (not just the ones with
      // content) so editor._layers stays position-aligned with
      // P.stampLayers on the next open() — an empty legacy layer becomes
      // an empty editor layer, not a missing one.
      const toolingFields = [
        'depth', 'profile', 'angle', 'tx', 'ty', 'rotation', 'scale',
        'mirrorX', 'mirrorY', 'blur', 'smoothing', 'suppression',
        'edgeFilletRadius', 'filletPower',
      ];
      const roster = layers.map((layer, idx) => {
        const entry = { id: String(idx), name: layer?.name || `Layer ${idx + 1}`, visible: true };
        for (const f of toolingFields) {
          if (layer && layer[f] !== undefined) entry[f] = layer[f];
        }
        return entry;
      });
      const layersAttr = JSON.stringify(roster).replace(/"/g, '&quot;');

      p.editorSvg = `<svg xmlns="http://www.w3.org/2000/svg" data-editor-layers="${layersAttr}">${bodies.join('')}</svg>`;

      layers.forEach((layer) => {
        if (!layer) return;
        delete layer.svg;
        delete layer.mask;
      });
    },
  },
];

export function runMigrations(p = P) {
  for (const m of MIGRATIONS) {
    try {
      if (m.when(p)) m.apply(p);
    } catch (e) {
      console.warn(`[migration] ${m.id} failed:`, e);
    }
  }
}

export async function initApp(preview, wireGlobalEvents) {
  AppState.isInitializing = true;
  loadLastSession();
  runMigrations();

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

  // SE4c: content check via the editor document, not the old per-layer
  // content field (retired). window.svgEditor doesn't exist yet at this
  // point in boot (initSvgEditor runs right after initApp returns —
  // main.js), so this
  // parses the serialized P.editorSvg directly rather than querying a
  // live editor._layers roster.
  if (_editorSvgHasContent(P.editorSvg)) {
    await refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode);
  } else {
    rebuild(preview, updateStampMasks, updatePreviewSculptMode);
  }

  // Seed a baseline snapshot so the FIRST user action is undoable. Undo
  // requires a prior state to revert to (globalHistoryLog.length > 1);
  // without this floor, the first sculpt/clear leaves the log at length 1
  // and the Undo button never enables. Guard against double-seeding on
  // re-init (e.g. loading a session), which would push a duplicate floor.
  if (globalHistoryLog.length === 0) takeSnapshot("Initial");
  updateGlobalButtons();
  wireGlobalEvents();
}

/**
 * SE11: rebuild the 3D-drape texture from the current editor content and
 * layer roster (buildDrapeSvg, core/preview/drape-svg.js) and apply it to
 * the preview's top surface. Hooked into the SAME three places that
 * already call refreshAllStampMasks after a real content change below —
 * commit-only inside the CHANGE_PIPELINE remask step (never 'live', per
 * the dispatch's own "not per drag frame" rule), plus Apply and Cancel.
 * Seat B's real visible/carve/showColor fields (T26/SE10) aren't landed
 * yet — buildDrapeSvg already treats a missing field as true, so nothing
 * here needs to change when they land.
 */
async function refreshDrape(preview) {
    if (!preview || !window.svgEditor) return;
    const svg = window.svgEditor.save();
    const drapeSvg = buildDrapeSvg(window.svgEditor._layers, svg);
    if (!drapeSvg) { preview.setDrapeTexture(null); return; }
    const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
    const texW = Math.min(1024, Math.max(256, nx * 4));
    const texH = Math.min(1024, Math.max(256, nz * 4));
    const texture = await preview.buildDrapeTexture(drapeSvg, texW, texH);
    preview.setDrapeTexture(texture);
}

export function initSvgEditor(preview) {
  if (!window.svgEditor) window.svgEditor = new VectorEditor();

  window.svgEditor.initEditor(
    'editorSVGContainer',
    'svgEditorTopView',
    // onChange — fires after every edit, now via CHANGE_PIPELINE (SE8b-2):
    // `kind` ('live', at most once per animation frame during a drag, or
    // 'commit', once per gesture / any other discrete edit — see
    // editor._notifyChange) picks which steps run; only their ORDER and
    // wiring live here, the run-and-time loop is runChangePipeline, above.
    // Use saveForRasterization (async) so the SVG handed to stamp.js
    // carries embedded @font-face for every text element. Without this,
    // iOS rasterizes Symbol/Wingdings/Webdings text as plain Latin glyphs
    // (no document-level @font-face reaches a detached data: URL render
    // context).
    async (kind = 'commit') => {
      await runChangePipeline(kind, {
        serialize: async () => {
          const svg = await window.svgEditor.saveForRasterization();
          // Step 3 unification: the editor's full document is the source
          // of truth. Persist to P.editorSvg so a page reload restores it.
          if (svg) P.editorSvg = svg;
          return svg;
        },
        persist: saveLastSession,
        remask: async () => {
          const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
          await refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode);
          // SE11: commit-only — 'kind' is this callback's own closure
          // variable from the enclosing (kind = 'commit') => {...}, so a
          // 'live' drag frame (which also runs this same remask step)
          // never rebuilds the drape texture mid-gesture.
          if (kind === 'commit') await refreshDrape(preview);
        },
      });
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
          saveLastSession();
          const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
          refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode);
          await refreshDrape(preview);
        }
      } else if (SvgEditorSnapshot.active) {
        // Cancel path — restore the pre-edit DOCUMENT (onChange already
        // wrote P.editorSvg + remasked live while the user was typing, so
        // restoring a per-layer field can't undo it — the edits are
        // already the live state by the time Cancel runs). Reload the
        // editor from the restored document with the SAME call the opener
        // uses, then remask. open() only manipulates DOM/SVG attributes
        // and reads the top-view canvas's pixel buffer (sync3DBackground)
        // — neither depends on the modal's visibility, checked by reading
        // both, so this is safe regardless of exactly when the modal
        // hides relative to this call.
        P.editorSvg = SvgEditorSnapshot.editorSvg;
        saveLastSession();
        window.svgEditor.open(editorRestoreSvg(), P.widthIn, P.heightIn);
        const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
        refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode);
        await refreshDrape(preview);
      }
      SvgEditorSnapshot.active = false;
      const modal = document.getElementById('svgEditorModal');
      if (modal) modal.style.display = 'none';
    }
  );

  // Step 3 unification: restore the saved editor SVG so a reload picks
  // up the in-flight drawing instead of a blank canvas. A legacy-shaped
  // save (pre-P.editorSvg) has already been migrated by runMigrations()
  // in initApp, which runs before this — see MIGRATIONS above.
  try {
    const restoreSvg = editorRestoreSvg();
    if (restoreSvg) {
      window.svgEditor.open(restoreSvg, P.widthIn, P.heightIn);
    }
  } catch (e) {
    console.warn('[initSvgEditor] editor SVG restore failed:', e);
  }

}

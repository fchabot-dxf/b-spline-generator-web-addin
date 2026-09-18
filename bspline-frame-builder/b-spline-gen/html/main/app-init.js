import { P, loadLastSession, saveLastSession, lastResult } from '../core/state.js';
import { syncUItoParam, updateSpacingLabels } from '../core/ui-utils.js';
import { resolveGrid } from '../core/terrain.js';
import { rebuild } from '../core/engine.js';
import { updatePreviewSculptMode } from '../core/sculpt-interaction.js';
import { updateGlobalButtons, takeSnapshot, globalHistoryLog } from '../core/history.js';
import { AppState } from './app-state.js';
import { refreshAllStampMasks, updateStampMasks } from './stamp-mask-manager.js';
import { VectorEditor } from '../editor/index.js';

// SE3a: snapshot of the unified editor document (P.editorSvg) captured
// when the SVG editor modal opens. The Cancel button restores it — reloads
// the editor from this document and remasks — so closing without applying
// genuinely undoes the in-flight edits (instead of silently keeping them
// because onChange already wrote P.editorSvg + remasked after every edit
// while the user was still typing).
export const SvgEditorSnapshot = { active: false, editorSvg: null };

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
          saveLastSession();
          const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
          refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode);
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

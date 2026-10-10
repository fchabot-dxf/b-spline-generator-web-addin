import { P, DEFAULT, loadLastSession, saveLastSession, markBootRestoreComplete } from '../core/state.js';
import { encodeLayersAttr, decodeLayersAttr } from '../editor/layers-attr.js';
import { NoiseModes } from '../core/noise/index.js';
import { syncUItoParam, updateSpacingLabels } from '../core/ui-utils.js';
import { resolveGrid } from '../core/terrain.js';
import { rebuild, whenRebuildIdle } from '../core/engine.js';
import { beginLoadingSequence, withLoadingStage } from '../core/loading-signal.js';
import { openRebuildHold, joinRebuildHold, isRebuildHeld, deferToHold } from '../core/engine/scheduler.js';
import { updatePreviewSculptMode } from '../core/sculpt-interaction.js';
import { updateGlobalButtons, takeSnapshot, globalHistoryLog, setUndoRestoring, isEditorOpen, ensureUndoBaseline } from '../core/history.js';
import { AppState } from './app-state.js';
import { markDirty } from '../core/dirty.js';
import { showToast } from '../core/toast.js';

// save audit: the change pipeline's serialize order (see the editor change handler)
let _serializeSeq = 0;
import { refreshAllStampMasks, updateStampMasks } from './stamp-mask-manager.js';
import { VectorEditor } from '../editor/index.js';
import { buildDrapeSvg, nextPow2 } from '../core/preview/drape-svg.js';
import { dbg, isDebugEnabled } from '../core/debug.js';
import { fusLog } from '../core/fusion-bridge.js';
import { buildSketchManifest } from '../editor/editor-sketch-manifest.js';
import { frameContext, drawFrameProfile } from '../editor/editor-frame-profile.js';
import { isFittedView, applyView } from '../editor/editor-view.js';
import { boardRegion } from '../editor/editor-shape-lattice-interaction.js';
import { FRAME_DEFS, frameParam, normalizeFrameRecord, setFrameRecord } from '../core/frame-record.js';
import { syncFramePanel } from './frame-panel.js';
import { adoptStoredPhoto } from './photo-panel.js';
import { endEditorSession } from '../editor/editor-text-session.js';
import { brickSetById, FRAME_PRESETS } from '../core/bricks/library.js';
import { ROCK_SET_ID, BRICK_SET_IDS, FOLDED_FRAME_PRESETS } from '../editor/editor-brick-tool.js';

/** The frame a fresh start opens on (data/frame-defs: "Template 1 - Hourglass"). */
const FRESH_START_FRAME_TEMPLATE = 'template_1';

// SE3a: snapshot of the unified editor document (P.editorSvg) captured
// when the SVG editor modal opens. The Cancel button restores it — reloads
// the editor from this document and remasks — so closing without applying
// genuinely undoes the in-flight edits (instead of silently keeping them
// because onChange already wrote P.editorSvg + remasked after every edit
// while the user was still typing).
// Audit B1: the brick settings are app state the editor's own undo stack never holds, but every
// Brick-tab change saves them at once -- so Cancel must put them back too, or the panel shows the
// discarded settings over the restored bricks (and the next Generate re-lays them).
// Blind-spot audit B9: the FRAME record likewise (the Frame tab edits it live): Cancel puts it back, or the
// restored bricks sit on the session's new frame.
export const SvgEditorSnapshot = { active: false, editorSvg: null, brickSettings: null, frame: null, fingerprint: null };

/** F35 item 25: what an editor session can change, as one comparable string -- the drawing, the frame record,
 *  the brick settings and the photo. Taken when the editor opens (SvgEditorSnapshot.fingerprint); the viewport's
 *  [3D] closes without the Apply rebuild when nothing in it changed. */
export function editorSessionFingerprint() {
  return JSON.stringify({
    svg: P.editorSvg ?? null, frame: P.frame ?? null, bricks: P.brickSettings ?? null,
    photo: [P.photoImageDataUrl ?? null, P.photoEdits ?? []],
    relief: P.carveZ ?? null, // in-editor-3d.js 'relief': its slider builds no 3D in the editor, so [3D] must see it
  });
}

/** Cancel's app-state half: put back what the editor session changed outside the drawing's own undo -- the
 *  document, the brick settings and (blind-spot audit B9) the frame record. The frame goes back FIRST: the
 *  restored bricks' laid key names that frame, so its re-lay finds them current and lays nothing. */
export function restoreEditorSnapshotState() {
  P.editorSvg = SvgEditorSnapshot.editorSvg;
  restoreBrickSettings(SvgEditorSnapshot.brickSettings);
  if (SvgEditorSnapshot.frame && JSON.stringify(SvgEditorSnapshot.frame) !== JSON.stringify(P.frame ?? null)) {
    setFrameRecord(SvgEditorSnapshot.frame);
  }
}

/** F35 item 25: close the editor when nothing changed -- Cancel's close without its restore + remask + drape
 *  (there is nothing to restore). */
export function closeEditorUnchanged() {
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  SvgEditorSnapshot.active = false; // onCommit's Cancel branch restores only an active snapshot
  if (editor) endEditorSession(editor, { commit: false });
  else document.getElementById('svgEditorModal')?.style.setProperty('display', 'none');
}

/** Put P.brickSettings back IN PLACE (other modules hold the same object, e.g. editor._brickSettings). */
export function restoreBrickSettings(saved) {
  if (!saved || !P.brickSettings) return;
  for (const k of Object.keys(P.brickSettings)) delete P.brickSettings[k];
  Object.assign(P.brickSettings, JSON.parse(JSON.stringify(saved)));
  announceBrickSettingsRestored();
}

/** Audit v2 N2: P.brickSettings was REPLACED from outside the brick panel -- Cancel (above), the session
 *  restore (initApp), a project load or a global undo (snapshot-manager.js applySnapshot). The panel
 *  (main/brick-panel.js) re-syncs every control, editor and sidebar, and the pending state from it. Before
 *  this, only Cancel announced it: after a reload or a load the panels showed the DEFAULTS. */
export function announceBrickSettingsRestored() {
  if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('brickSettingsRestored'));
}

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
    // item 69: a sidebar write to a layer's tooling field (core/state.js layerToolingChanged) -- re-serialize the
    // roster (data-editor-layers) into P.editorSvg and save it; the sidebar already remasks on its own
    tooling: ['serialize', 'persist'],
};

/** 2026-10-10 (seat A, advisor: one correct update behind the loading stage, never a wrong intermediate one): a board
 *  size change (the sidebar, or an undo / redo of it) is ONE 3D build. Its stages, declared once -- each joins the
 *  rebuild hold (core/engine/scheduler.js) when it starts and closes when done; the build runs after the last:
 *  'editor-resync' (_resyncEditorToStock, below), 'brick-relay' (main/brick-panel.js, the re-lay on the new board),
 *  'change-pipeline' (every editor onChange that runs meanwhile, its remask included). */
export const STOCK_CHANGE_STAGES = ['editor-resync', 'brick-relay', 'change-pipeline'];
/** The boot's restore (initSvgEditor): its one build waits for the drape, which follows the mask pass (see there). */
export const BOOT_RESTORE_STAGES = ['boot-drape'];
/** ...and the work it postpones to its end (deferToHold). MEASURED (phone rig, CPU 4, loaded board):
 *  'stamp-masks': three mask passes per nudge -- the param's own on the OLD editor (2.1 s wall), the resync's, the
 *  re-lay's -- and only the last one's masks reach the build; deferred, the latest pass runs once, on the final editor.
 *  'frame-3d': the Frame panel's sync re-meshed the 3D frame on the OLD terrain (~0.6 s) before the build applies the
 *  frame again on the new one -- dropped when the hold ends in a build (supersededByBuild). */
export const STOCK_CHANGE_DEFERS = ['stamp-masks', 'frame-3d'];

/**
 * F35 item 18 (4), the editor's STATIC backdrop (Fred: the editor loads fast, Apply builds the 3D):
 * the SAME table for a change made while the SVG editor is OPEN (core/history.js isEditorOpen) -- no
 * `remask`, so an in-editor edit never re-masks + rebuilds the 3D (and so never redraws the editor's
 * backdrop, which only follows a rebuild). The document is still serialized + persisted on every
 * commit, exactly as before. The 3D is built once when the session ends: Apply and Cancel are the
 * only ways the modal closes and both already remask (initSvgEditor's onCommit). MEASURED before:
 * one Brick-tab Generate at 0.015 in spacing kept the app busy 8.1 s (2 remasks + a full rebuild).
 */
export const CHANGE_PIPELINE_IN_EDITOR = {
    live:   ['serialize'],
    commit: ['serialize', 'persist'],
    tooling: ['serialize', 'persist'],
};

// The same rule for the changes that do not come through the editor's onChange (the Photo tab, its relief height,
// the Frame tab's record writes): core/in-editor-3d.js IN_EDITOR_3D, one row per kind.

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
export async function runChangePipeline(kind, { serialize, persist, remask }, pipeline = CHANGE_PIPELINE) {
    const steps = pipeline[kind] || pipeline.commit;
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

/** Item 37: who builds the 3D at boot -- ONE owner, so a reload never shows an intermediate surface.
 *  'initSvgEditor': a saved drawing exists; the editor's restore masks it (its layers exist only there) and builds.
 *  'initApp': no drawing; initApp builds the plain surface itself (the editor restore does nothing then). */
export function bootBuildOwner() {
  return editorRestoreSvg() ? 'initSvgEditor' : 'initApp';
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
    id: 'photo-filter-to-layer',
    // 2026-10-10 (Fred: the photo as its own LAYER on top of the chosen filter): a save on the old Photo FILTER becomes
    // the photo layer over a plain filter, showing through at 0 % -- the SAME heights: at 0 % the fine value is the
    // photo's own (core/terrain.js), and 'simplex' has the photo's coarse multiplier (2.5). A save that hid the filter
    // texture showed no photo at all (isolateSkeleton flattened it): its layer stays off. The photo's own settings
    // (photoImageDataUrl, photoEdits, filterTweaks.photo) stay where they are.
    when: (p) => p.noiseType === 'photo',
    apply: (p) => {
      p.noiseType = 'simplex';
      p.photoLayer = !p.isolateSkeleton;
      p.photoFilterAmount = 0;
    },
  },
  {
    id: 'removed-noise-type-to-default',
    // T78 item 10 (Fred: "Remove the filter"): the Biomechanical filter was
    // removed after two rejected reworks. A save naming a filter that is no
    // longer in the registry loads with the default filter, and that
    // filter's leftover tweak settings are dropped. Covers any future
    // removal the same way.
    when: (p) => typeof p.noiseType === 'string' && !(p.noiseType in NoiseModes),
    apply: (p) => {
      if (p.filterTweaks) delete p.filterTweaks[p.noiseType];
      p.noiseType = DEFAULT.noiseType;
    },
  },
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
      const layersAttr = encodeLayersAttr(roster);

      p.editorSvg = `<svg xmlns="http://www.w3.org/2000/svg" data-editor-layers="${layersAttr}">${bodies.join('')}</svg>`;

      layers.forEach((layer) => {
        if (!layer) return;
        delete layer.svg;
        delete layer.mask;
      });
    },
  },
  {
    id: 'layer-carve-flag',
    // SE10 AMEND: `carve` is new and independent of `visible` — but every
    // save from BEFORE this turn only ever had `visible`, and back then
    // `visible === false` ALSO meant "don't carve" (there was no other
    // switch). editor/layers.js's own applyToolingDefaults already fills
    // a MISSING `carve` with a flat TOOLING_DEFAULTS.carve (true) on
    // restore — which would silently start carving a layer the user had
    // deliberately hidden pre-SE10. This migration gives every
    // already-saved layer its correct HISTORICAL carve value
    // (carve = it was visible) before that flat default ever gets a
    // chance to apply, so old documents carve exactly as before.
    when: (p) => {
      if (!p.editorSvg) return false;
      const m = p.editorSvg.match(/data-editor-layers="([^"]*)"/);
      if (!m) return false;
      try {
        const layers = decodeLayersAttr(m[1]);
        return Array.isArray(layers) && layers.some((l) => l && l.carve === undefined);
      } catch (_) {
        return false;
      }
    },
    apply: (p) => {
      const m = p.editorSvg.match(/data-editor-layers="([^"]*)"/);
      if (!m) return;
      try {
        const layers = decodeLayersAttr(m[1]);
        if (!Array.isArray(layers)) return;
        layers.forEach((l) => {
          if (l && l.carve === undefined) l.carve = l.visible !== false;
        });
        const newAttr = encodeLayersAttr(layers);
        p.editorSvg = p.editorSvg.replace(m[0], `data-editor-layers="${newAttr}"`);
      } catch (e) {
        console.warn('[migration] layer-carve-flag failed:', e);
      }
    },
  },
  {
    id: 'node-radius-to-diameter',
    // NODE-D (Fred: "node size should be entered as diameter not
    // radius"): every layer's own `.pattern.widths.nodeRadius` (a lattice
    // layer's own node size, OLD meaning: a radius) is now
    // `.pattern.widths.nodeDiameter` (NEW meaning: a diameter — the
    // PATTERN_DEFAULTS.widths merge every reader already does would
    // otherwise silently substitute the NEW default for a custom OLD
    // value instead of converting it, since the merge has no `nodeRadius`
    // key to find). Same "gate on current shape, not a version number"
    // convention as layer-carve-flag above, and the SAME data-editor-
    // layers JSON round-trip, since that's where `.pattern` actually
    // lives (editor-io.js's own `open()`, not this file).
    when: (p) => {
      if (!p.editorSvg) return false;
      const m = p.editorSvg.match(/data-editor-layers="([^"]*)"/);
      if (!m) return false;
      try {
        const layers = decodeLayersAttr(m[1]);
        return Array.isArray(layers) && layers.some((l) => l && l.pattern && l.pattern.widths
          && l.pattern.widths.nodeRadius !== undefined && l.pattern.widths.nodeDiameter === undefined);
      } catch (_) {
        return false;
      }
    },
    apply: (p) => {
      const m = p.editorSvg.match(/data-editor-layers="([^"]*)"/);
      if (!m) return;
      try {
        const layers = decodeLayersAttr(m[1]);
        if (!Array.isArray(layers)) return;
        layers.forEach((l) => {
          const w = l && l.pattern && l.pattern.widths;
          if (w && w.nodeRadius !== undefined && w.nodeDiameter === undefined) {
            w.nodeDiameter = w.nodeRadius * 2;
            delete w.nodeRadius;
          }
        });
        const newAttr = encodeLayersAttr(layers);
        p.editorSvg = p.editorSvg.replace(m[0], `data-editor-layers="${newAttr}"`);
      } catch (e) {
        console.warn('[migration] node-radius-to-diameter failed:', e);
      }
    },
  },
  {
    id: 'border-to-contour-width',
    // T74 AMEND 1 (Fred: "if draw boundary is off I shouldn't see it at
    // all"): the separate "Border" clone feature (`pattern.boundary.border
    // = {enabled, width, color}`) is retired — its ONE surviving concept,
    // width, moves to `pattern.contour.width` (colour was already
    // redundant with `pattern.colors.contour`, dropped here, never
    // migrated). The old "show contour" checkbox (`contour.show`) and
    // Border's own "draw boundary" checkbox (`border.enabled`) become the
    // ONE `contour.show` — since Border's clone was "the thing actually
    // drawn" whenever it was on (even if the SE14b contour segments
    // themselves were hidden), an enabled Border wins the merge so a
    // saved document that used to show something visually keeps showing
    // it. Same "gate on current shape" / data-editor-layers JSON
    // round-trip convention as node-radius-to-diameter above.
    when: (p) => {
      if (!p.editorSvg) return false;
      const m = p.editorSvg.match(/data-editor-layers="([^"]*)"/);
      if (!m) return false;
      try {
        const layers = decodeLayersAttr(m[1]);
        return Array.isArray(layers) && layers.some((l) => l && l.pattern && l.pattern.boundary
          && l.pattern.boundary.border !== undefined);
      } catch (_) {
        return false;
      }
    },
    apply: (p) => {
      const m = p.editorSvg.match(/data-editor-layers="([^"]*)"/);
      if (!m) return;
      try {
        const layers = decodeLayersAttr(m[1]);
        if (!Array.isArray(layers)) return;
        layers.forEach((l) => {
          const pat = l && l.pattern;
          if (!pat || !pat.boundary || pat.boundary.border === undefined) return;
          const border = pat.boundary.border || {};
          const contour = pat.contour || {};
          const mergedShow = !!border.enabled || contour.show !== false;
          const mergedWidth = contour.width !== undefined
            ? contour.width
            : (border.width != null ? border.width : null);
          pat.contour = { ...contour, show: mergedShow, width: mergedWidth };
          delete pat.boundary.border;
        });
        const newAttr = encodeLayersAttr(layers);
        p.editorSvg = p.editorSvg.replace(m[0], `data-editor-layers="${newAttr}"`);
      } catch (e) {
        console.warn('[migration] border-to-contour-width failed:', e);
      }
    },
  },
  {
    id: 'box-lattice-margin-to-size',
    // T75 (LAT-SIZE, advisor's own decision: ONE shared size concept for
    // both lattice tools): `PATTERN.margin` (lattice CELLS) is retired as
    // the box Lattice's own fill-area driver, replaced by `PATTERN.size`
    // (real inches, shared with the Shape Lattice tool's own field).
    // An already-saved BOX LATTICE pattern (never a Shape Lattice one --
    // `extent.mode === 'boundary'` uses a completely different, UNAFFECTED
    // region mechanism, `sizedBoardRegion` there already falls back to
    // its own pre-existing default exactly as before) converts its own
    // margin+spacing into an EQUIVALENT explicit `size`, LOSSLESSLY:
    // margin (cells) * spacing (in/cell) = the exact same real-inches
    // inset `_resolveExtent`'s own OLD formula already produced, so this
    // never changes what an existing save actually renders. `margin`/
    // `spacing`'s own HISTORICAL defaults (1 cell, 0.25in) are hardcoded
    // here deliberately -- margin's own live default no longer exists
    // (retired from PATTERN_DEFAULTS this SAME turn), so this is the one
    // place its old value is preserved. `margin` itself is deleted after
    // conversion, matching node-radius-to-diameter's own "delete the
    // retired key" convention.
    when: (p) => {
      if (!p.editorSvg) return false;
      const m = p.editorSvg.match(/data-editor-layers="([^"]*)"/);
      if (!m) return false;
      try {
        const layers = decodeLayersAttr(m[1]);
        return Array.isArray(layers) && layers.some((l) => l && l.pattern
          && !(l.pattern.extent && l.pattern.extent.mode === 'boundary')
          && l.pattern.size === undefined);
      } catch (_) {
        return false;
      }
    },
    apply: (p) => {
      const m = p.editorSvg.match(/data-editor-layers="([^"]*)"/);
      if (!m) return;
      try {
        const layers = decodeLayersAttr(m[1]);
        if (!Array.isArray(layers)) return;
        const boardW = p.widthIn || 7, boardH = p.heightIn || 9;
        layers.forEach((l) => {
          const pat = l && l.pattern;
          if (!pat || (pat.extent && pat.extent.mode === 'boundary') || pat.size !== undefined) return;
          const spacing = pat.spacing ?? 0.25;
          const margin = pat.margin ?? 1;
          const marginIn = margin * spacing;
          pat.size = { width: boardW - 2 * marginIn, height: boardH - 2 * marginIn };
          delete pat.margin;
        });
        const newAttr = encodeLayersAttr(layers);
        p.editorSvg = p.editorSvg.replace(m[0], `data-editor-layers="${newAttr}"`);
      } catch (e) {
        console.warn('[migration] box-lattice-margin-to-size failed:', e);
      }
    },
  },
  {
    id: 'contour-from-frame-outer-edge',
    // F26 (Fred, screenshot: "offset from frame at 0 is clamped to the
    // inside of frame rather than outside, and doesn't accept negative
    // value"): `pattern.contour.fromFrame.distance`'s reference point moved
    // from the frame's INNER edge (the cut profile offset inward by
    // `frame_thickness`) to its OUTER edge directly -- `distance=0` used to
    // sit `frame_thickness` inward of the outline, now it sits ON the
    // outline. `distanceRef: 'outer'` (contour-from-frame.js's own
    // CONTOUR_FROM_FRAME_DEFAULTS, and editor-lattice-pattern.js's
    // PATTERN_DEFAULTS) is the declared marker: present -> already in the
    // new scheme (a fresh pattern, or already migrated); a `distance`
    // present WITHOUT it -> pre-F26, needs `+= frame_thickness` once so the
    // contour's ACTUAL drawn position does not move on load. `frame_thickness`
    // is read from the ONE project-wide frame record (`p.frame`, `core/
    // frame-record.js`'s own `frameParam`, the SAME helper every other frame
    // reader uses) -- not per-layer, since the frame itself isn't -- falling
    // back to T1/T2's own shared declared default (0.75) only if no frame is
    // on record at all (a saved distance with no frame ever chosen has
    // nothing more specific to convert against).
    when: (p) => {
      if (!p.editorSvg) return false;
      const m = p.editorSvg.match(/data-editor-layers="([^"]*)"/);
      if (!m) return false;
      try {
        const layers = decodeLayersAttr(m[1]);
        return Array.isArray(layers) && layers.some((l) => l && l.pattern && l.pattern.contour
          && l.pattern.contour.fromFrame && l.pattern.contour.fromFrame.distance !== undefined
          && l.pattern.contour.fromFrame.distanceRef !== 'outer');
      } catch (_) {
        return false;
      }
    },
    apply: (p) => {
      const m = p.editorSvg.match(/data-editor-layers="([^"]*)"/);
      if (!m) return;
      try {
        const layers = decodeLayersAttr(m[1]);
        if (!Array.isArray(layers)) return;
        const t = frameParam(FRAME_DEFS, p.frame, 'frame_thickness') ?? 0.75;
        layers.forEach((l) => {
          const ff = l && l.pattern && l.pattern.contour && l.pattern.contour.fromFrame;
          if (!ff || ff.distance === undefined || ff.distanceRef === 'outer') return;
          ff.distance = Number(ff.distance) + t;
          ff.distanceRef = 'outer';
        });
        const newAttr = encodeLayersAttr(layers);
        p.editorSvg = p.editorSvg.replace(m[0], `data-editor-layers="${newAttr}"`);
      } catch (e) {
        console.warn('[migration] contour-from-frame-outer-edge failed:', e);
      }
    },
  },
  {
    id: 'brick-scale-to-brickLengthIn',
    // F35 item 16 (Fred: "I'd rather they all have the same size"): the old per-element 0.5-2x
    // Scale multiplier (and the separate Frame-only frameBrickLengthIn override) are replaced by
    // ONE global brickLengthIn in real inches. A pre-item-16 save still carries `scale` (brickLengthIn
    // absent) -- convert it ONCE, relative to whichever brick SET was active, so an existing board's
    // own brick size on screen doesn't silently jump on the next load.
    when: (p) => p.brickSettings && p.brickSettings.brickLengthIn === undefined && typeof p.brickSettings.scale === 'number',
    apply: (p) => {
      const set = brickSetById(p.brickSettings.setId) || brickSetById(1);
      p.brickSettings.brickLengthIn = set.brickLengthIn * p.brickSettings.scale;
      delete p.brickSettings.scale;
      delete p.brickSettings.frameBrickLengthIn;
    },
  },
  {
    id: 'brick-set-per-element',
    // F35 item 23: one board-wide `setId` -> a set per element (`setIds`). A board that was on the ROCK set
    // (White Rocks, which leaves the Set row) becomes the Fieldstone pattern on its Wall and fieldstone bands on
    // its Frame -- the same stones, now implied by the pattern; its elements' brick set falls back to the first
    // brick set. Runs after the size migration above (which still reads the old `setId`).
    when: (p) => p.brickSettings && !p.brickSettings.setIds,
    apply: (p) => {
      const b = p.brickSettings;
      const old = b.setId ?? 1;
      const rock = old === ROCK_SET_ID;
      const base = rock || !BRICK_SET_IDS.includes(old) ? (BRICK_SET_IDS[0] ?? 1) : old;
      b.setIds = { wall: base, frame: base, brush: base, raisedBrush: base };
      if (rock) {
        b.pattern = 'fieldstone';
        b.frameBandPatterns = (FRAME_PRESETS[b.frameBandPreset] || []).map(() => 'fieldstone');
      }
      delete b.setId;
    },
  },
  {
    id: 'grout-per-element',
    // the one board-wide joint width -> a joint per element (groutByElement). A saved board keeps its exact width
    // on every element (it lays as before); a new board starts at each element's set's joint (null).
    when: (p) => p.brickSettings && !p.brickSettings.groutByElement,
    apply: (p) => {
      const b = p.brickSettings;
      const w = b.grout && Number.isFinite(b.grout.widthIn) ? b.grout.widthIn : null;
      b.groutByElement = { wall: w, frame: w, brush: w };
      if (b.grout) delete b.grout.widthIn;
    },
  },
  {
    id: 'frame-corner-presets',
    // item 33: a board on a folded corner-variant preset ('Soldier (butt corners)' / '(quoin corners)') becomes
    // Soldier + that corner on the Corners row -- the same bands, the same lay.
    when: (p) => p.brickSettings && !!FOLDED_FRAME_PRESETS[p.brickSettings.frameBandPreset],
    apply: (p) => {
      const f = FOLDED_FRAME_PRESETS[p.brickSettings.frameBandPreset];
      p.brickSettings.frameBandPreset = f.preset;
      p.brickSettings.frameCorner = f.corner;
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
  const restored = loadLastSession();
  runMigrations();
  if (restored) announceBrickSettingsRestored(); // audit v2 N2: the brick panel was built before this restore

  // Save audit #4: a restored session keeps its seed (a fresh one would change the terrain it was saved with);
  // only a fresh start rolls one
  if (!restored && !isNaN(P.seed)) {
    P.seed = Math.floor(Math.random() * 99999);
  }
  // Fred ("open on hourglass frame too"): a fresh start (no last session on this device) opens on the Hourglass
  // frame instead of no frame. A restored session keeps whatever frame it had (none included), and an old project
  // saved without a frame still loads as "no frame" (the record's own default stays no frame).
  if (!restored && !P.frame) P.frame = normalizeFrameRecord({ templateId: FRESH_START_FRAME_TEMPLATE });
  // the Frame panel was built before this ran (main.js initFramePanel): show the restored / fresh-start frame
  syncFramePanel();
  adoptStoredPhoto(); // item 74a: likewise the Photo panel -- the restored photo is decoded (and a full-size one downscaled)

  // syncUItoParam fires a real 'change' on checkboxes, which schedules an undo step -- and that step marked a fresh,
  // untouched start as "unsaved" (the leave-page warning then fired for nothing). The same guard applySnapshot uses.
  setUndoRestoring(true);
  Object.keys(P).forEach(k => syncUItoParam(k, P[k]));
  setUndoRestoring(false);
  updateSpacingLabels(P.widthIn, P.heightIn);
  updateSpacingLabels(P.widthIn, P.heightIn, 'exportSpacing');

  if (preview) preview.setCurvesVisible(P.showMesh);

  AppState.isInitializing = false;

  // Item 37 (seat E, measured): the boot build has ONE owner (bootBuildOwner). A saved drawing is masked + built by
  // initSvgEditor's restore, the first point where the editor's layers exist; masking it here too (before the editor
  // existed) built an UNMASKED surface first -- 17 k of 25.5 k cells off by up to 0.37 in, on screen 1.4-5 s at x4.
  if (bootBuildOwner() === 'initApp') {
    beginLoadingSequence('sessionRestore');
    rebuild(preview, updateStampMasks, updatePreviewSculptMode).then(whenRebuildIdle).then(markBootRestoreComplete);
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
// SE11b: unconditional fusLog (like _ioLog/_sLog) — the advisor's live-
// Fusion log capture must show this on the very next natural test, with
// no debug flag to remember to set first; dbg() stays gated behind DRAPE
// for optional console noise on the web build.
function _drapeLog(msg) {
    dbg('DRAPE', msg);
    try { fusLog('[DRAPE] ' + msg); } catch (_) {}
}

// T45: exported so snapshot-manager.js's applySnapshot (its 'load' source —
// a project load, not undo/redo) can refresh the drape after loading the
// new document into the live editor, the same way this file's own
// Apply/Cancel/boot-restore call sites already do below.
export async function refreshDrape(preview) {
    if (!preview || !window.svgEditor) {
        _drapeLog(`skip: preview=${!!preview} svgEditor=${!!window.svgEditor}`);
        return;
    }
    const svg = window.svgEditor.save();
    const layers = window.svgEditor._layers || [];
    _drapeLog(`called: layers=${layers.length} savedSvgLen=${svg ? svg.length : 0}`);
    const drapeSvg = buildDrapeSvg(layers, svg);
    _drapeLog(`buildDrapeSvg returned length=${drapeSvg.length}`);
    if (!drapeSvg) {
        _drapeLog('no qualifying/coloured elements - clearing drape texture');
        preview.setDrapeTexture(null);
        return;
    }
    const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
    // SE11e amend (Fred): bumped from x4 to x8 of the grid resolution
    // (still capped, now higher) and rounded to a power of two — see
    // nextPow2's own comment for why the power-of-two rounding is the
    // part that actually matters here (mipmap generation, not raw pixel
    // count alone).
    const texW = nextPow2(Math.min(2048, Math.max(512, nx * 8)));
    const texH = nextPow2(Math.min(2048, Math.max(512, nz * 8)));
    _drapeLog(`rasterizing to ${texW}x${texH} (grid ${nx}x${nz})`);
    let texture = null;
    try {
        texture = await preview.buildDrapeTexture(drapeSvg, texW, texH);
    } catch (e) {
        _drapeLog('buildDrapeTexture threw: ' + (e && e.message ? e.message : e));
    }
    _drapeLog(`buildDrapeTexture returned ${texture ? 'a texture' : 'null'}`);
    preview.setDrapeTexture(texture);
    // SE11e: the drape is a separate overlay mesh now (_drapeMesh), not a
    // material property on the terrain mesh itself — log THAT instead of
    // the terrain material's own emissiveMap, which SE11e stopped setting
    // entirely (this line used to check it and would always read false
    // now, which isn't a bug, just a stale question).
    const drapeMesh = preview._drapeMesh;
    const drapeMat = drapeMesh && drapeMesh.material;
    _drapeLog(`setDrapeTexture done: drapeMesh=${drapeMesh ? drapeMesh.type : 'none'} ` +
        `material=${drapeMat ? drapeMat.type : 'none'} mapSet=${!!(drapeMat && drapeMat.map)} ` +
        `transparent=${drapeMat ? drapeMat.transparent : 'n/a'}`);
}

/**
 * Fred ("after making a lattice on a given stock size, if i resize the stock the art gets squished"): the saved
 * drawing (P.editorSvg) kept the OLD board size in its viewBox, and the stamp / drape renderers stretch that viewBox
 * over the board -- the art was squished until the editor was opened again (which refits). Now a stock-size change
 * (the editor closed) does what opening it does, invisibly: reopen the drawing at the new size (pieces keep their
 * inch positions), redraw the frame (frame-linked contours refit), and commit -- the change pipeline re-saves the
 * drawing at the new size, refills a boundary lattice when its inputs moved, remasks and redraws the drape.
 * Debounced: a stepper burst resyncs once. With the editor open, its own open/Apply handles it.
 */
let _stockResyncTimer = null;
let _resyncHoldClose = null; // the 'editor-resync' stage's close while a resync is pending
/** The editor follows the board (stockSizeChanged). 2026-10-07 (seat A, measured): at phone width the sidebar's board
 *  size stays reachable WHILE the editor is open -- this used to skip the open editor, which then kept the old board
 *  (outline, grid, the SVG download's size, the Shape Lattice's extent, the bricks' board) until it was reopened. An
 *  OPEN editor now follows in place (setModelMetrics: view, grid, outline, guides -- no reload, so undo and selection
 *  stay); a closed one reloads as before. Then, either way, the frame profile, one commit, and 'editorBoardResized'
 *  -- what else depends on the board inside the editor follows THAT (the Brick re-lay, main/brick-panel.js), so it
 *  always runs on the new size. */
function _resyncEditorToStock() {
  const close = _resyncHoldClose;
  _resyncHoldClose = null;
  try { _resyncEditorToStockNow(); } finally { if (close) close(); } // every exit closes the stage
}
const _editorModalOpen = () => {
  const modal = document.getElementById('svgEditorModal');
  return !!(modal && modal.style.display && modal.style.display !== 'none');
};
/** The resync will change the editor: it is drawn, on another board, and open or holding a drawing. One test for both
 *  the resync and the hold below. 2026-10-10 (MEASURED, phone rig, CPU 1): a global undo dispatches stockSizeChanged on
 *  EVERY undo, and the hold opened for each one -- an undo of Offset X built 428 ms after the tap, waiting out the 350 ms
 *  debounce of a resync that had nothing to do. */
function _resyncWillChange() {
  const ed = window.svgEditor;
  if (!ed || !ed._draw || (ed._mW === P.widthIn && ed._mH === P.heightIn)) return false;
  return _editorModalOpen() || !!P.editorSvg;
}
function _resyncEditorToStockNow() {
  if (!_resyncWillChange()) return;
  const ed = window.svgEditor;
  const editorOpen = _editorModalOpen();
  if (editorOpen) {
    // the WHOLE new board in view, as a fresh open shows it -- unless the user had zoomed / panned on purpose: their
    // view stays. The fit runs AFTER the frame profile is redrawn (a framed board fits its frame's region).
    const wasFitted = isFittedView(ed);
    const userView = ed._view ? { ...ed._view } : null;
    ed.setModelMetrics(P.widthIn, P.heightIn);
    drawFrameProfile(ed);
    if (wasFitted || !userView) ed.fitView();
    else { ed._view = userView; applyView(ed); }
  } else {
    ed.open(editorRestoreSvg(), P.widthIn, P.heightIn);
    drawFrameProfile(ed);
  }
  if (typeof ed._notifyChange === 'function') ed._notifyChange('commit');
  document.dispatchEvent(new CustomEvent('editorBoardResized', { detail: { w: P.widthIn, h: P.heightIn, editorOpen } }));
}
if (typeof document !== 'undefined') {
  document.addEventListener('stockSizeChanged', () => {
    // the card is up for the whole hold (a burst keeps the first one's); no hold when the resync has nothing to change
    // (an undo of anything but the size: the event comes with every global undo)
    if (_resyncWillChange()) {
      const holdSpec = { defers: STOCK_CHANGE_DEFERS };
      if (!isRebuildHeld()) { const held = openRebuildHold(STOCK_CHANGE_STAGES, holdSpec); withLoadingStage('rebuild', () => held, { spacing: P.spacing }); }
      else openRebuildHold(STOCK_CHANGE_STAGES, holdSpec);
      if (!_resyncHoldClose) _resyncHoldClose = joinRebuildHold('editor-resync');
    }
    clearTimeout(_stockResyncTimer);
    _stockResyncTimer = setTimeout(_resyncEditorToStock, 350);
  });
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
      // Save audit #3: a drawing edit is an unsaved change (the Save button and the "unsaved changes" guard on
      // Load read this); a restore/load running with AppState.isInitializing set is not one
      if (kind === 'commit' && !AppState.isInitializing) markDirty();
      // Save audit (race): two quick edits serialize concurrently (font embedding is async) -- only the LATEST
      // one may write P.editorSvg, so an older one finishing last can't put back a stale drawing
      const seq = ++_serializeSeq;
      const closeHoldStage = joinRebuildHold('change-pipeline'); // a no-op unless a board size change is holding the 3D
      try {
        await runChangePipeline(kind, {
          serialize: async () => {
            const svg = await window.svgEditor.saveForRasterization();
            // Step 3 unification: the editor's full document is the source
            // of truth. Persist to P.editorSvg so a page reload restores it.
            if (svg && seq === _serializeSeq) P.editorSvg = svg;
            return svg;
          },
          persist: saveLastSession,
          remask: async () => {
            const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
            const remaskNow = async () => {
              await refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode);
              // SE11: commit-only — 'kind' is this callback's own closure
              // variable from the enclosing (kind = 'commit') => {...}, so a
              // 'live' drag frame (which also runs this same remask step)
              // never rebuilds the drape texture mid-gesture.
              if (kind === 'commit') await refreshDrape(preview);
            };
            // a board size change holding the 3D defers the masks -- and the drape with them: it renders the editor's
            // SVG, whose brick height greys the masks paint (MEASURED: a drape drawn before the deferred masks left the
            // frame walls, which sample it, in the old greys)
            if (deferToHold('stamp-masks', remaskNow)) return;
            await remaskNow();
          },
        }, isEditorOpen() ? CHANGE_PIPELINE_IN_EDITOR : CHANGE_PIPELINE); // F35 item 18 (4): no 3D while editing
      } finally { closeHoldStage(); }
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
          _serializeSeq++; // Apply's own copy is the latest -- an in-flight change save must not overwrite it
          P.editorSvg = fontEmbeddedSvg;
          saveLastSession();
          const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
          refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode);
          await refreshDrape(preview);
          showToast('✓ Applied'); // workflow audit #12: Apply used to close with no confirmation
          // item 69 (seat E, measured: after a brick lay + Apply the global history's newest snapshot predated the lay,
          // so a sidebar step undone next -- a layer's carve toggle, Delete frame -- restored an older board, or nothing
          // for a layer the lay created): the applied board is the global history's baseline
          ensureUndoBaseline('Apply');
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
        restoreEditorSnapshotState();
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
  //
  // T45 (Fred: "on open, a loaded project doesn't have the SVG until I
  // open the editor and Apply Stencils"): this block's own OLD comment
  // claimed refreshAllStampMasks ran here "same as the other call sites
  // above" — it never actually did. initApp's own earlier
  // refreshAllStampMasks call (this file, ~line 262) runs BEFORE
  // window.svgEditor exists at all (see that call site's own comment),
  // so it's a no-op; this restore call is the FIRST point in boot where
  // the editor has both a document AND real content to mask from. Without
  // this, only the DRAPE (a flat color texture) refreshed at boot — the
  // actual stamp MASKS (the 3D heightfield's own carved geometry) stayed
  // whatever initApp's own no-op left them (typically empty), invisible
  // until the user manually opened the editor and hit Apply Stencils
  // (which does call refreshAllStampMasks, in the onCommit callback
  // above) — exactly Fred's own reported symptom.
  try {
    const restoreSvg = editorRestoreSvg();
    if (restoreSvg) {
      window.svgEditor.open(restoreSvg, P.widthIn, P.heightIn);
      const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
      // Not awaited (initSvgEditor itself isn't async). Item 37: this is the boot build's owner (bootBuildOwner) --
      // the loading card covers it end to end, and its landed build is the declared restore end (bootRestore).
      beginLoadingSequence('sessionRestore');
      // SE11b: a restored drawing's colours should drape immediately, not
      // only after the next edit — "editor only... survives save/reopen"
      // (SE9) means drape survives reopen too.
      // 2026-10-10 (seat A, MEASURED with the order-free scene digest: a reload's frame walls came back in the colours
      // of the drape BEFORE the boot's mask pass -- the drape renders the editor SVG, whose brick greys that pass paints,
      // and the build's frame pass samples the drape): the drape follows the masks, and the boot's one build waits for
      // it -- BOOT_RESTORE_STAGES, the same rebuild hold a board size change uses.
      openRebuildHold(BOOT_RESTORE_STAGES);
      const closeBootDrape = joinRebuildHold('boot-drape');
      refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode)
        .then(() => refreshDrape(preview))
        .finally(closeBootDrape)
        .then(whenRebuildIdle).then(markBootRestoreComplete);
    }
  } catch (e) {
    console.warn('[initSvgEditor] editor SVG restore failed:', e);
    // item 37: initApp left the boot build to this restore -- a failed restore still builds the board (unmasked)
    rebuild(preview, updateStampMasks, updatePreviewSculptMode).then(whenRebuildIdle).then(markBootRestoreComplete);
  }

  // T61 (SE15 Slice 1, dev-only): window.__se15Manifest(layerId?) pulls a
  // real sketch manifest (SE15-CONSTRAINED-SKETCH-DESIGN.md §1) out of the
  // live page, built from a real layer's own PATTERN — the one way to get
  // real JSON for the add-in build routine's own test fixtures (Slice 3,
  // NOT built this turn — NO FUSION). Gated the SAME way every other
  // console-only hook in this codebase is (core/debug.js's own
  // window.__editorDebug), not always-on. To use: in devtools, run
  // `window.__editorDebug = 'SE15'`, then `window.__se15Manifest()` (the
  // active layer) or `window.__se15Manifest('3')` (layer id '3'); wrap in
  // `JSON.stringify(..., null, 2)` for a copy-pasteable string. Declared
  // here rather than inside editor-sketch-manifest.js itself — that
  // module's own contract is "no DOM, no editor object" (its header
  // comment), so the window/editor-reading glue lives at this boundary.
  window.__se15Manifest = (layerId) => {
    if (!isDebugEnabled('SE15')) {
      console.warn("[SE15] set window.__editorDebug = 'SE15' first, then call window.__se15Manifest() again.");
      return null;
    }
    const editor = window.svgEditor;
    const layers = Array.isArray(editor._layers) ? editor._layers : [];
    const layer = layerId != null ? layers.find((l) => l.id === layerId) : layers.find((l) => l.id === editor._activeLayer);
    if (!layer) {
      console.warn(`[SE15] no layer found for id=${layerId ?? '(active)'}`);
      return null;
    }
    const manifest = buildSketchManifest(layer.pattern || {}, boardRegion(editor), {
      layerId: layer.id, sketchName: `Layer ${layer.id}`, frame: frameContext(editor),
    });
    console.log(`[SE15] manifest for layer ${layer.id}:`, manifest);
    return manifest;
  };
}

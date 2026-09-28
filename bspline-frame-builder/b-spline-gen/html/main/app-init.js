import { P, DEFAULT, loadLastSession, saveLastSession, lastResult } from '../core/state.js';
import { encodeLayersAttr, decodeLayersAttr } from '../editor/layers-attr.js';
import { NoiseModes } from '../core/noise/index.js';
import { syncUItoParam, updateSpacingLabels } from '../core/ui-utils.js';
import { resolveGrid } from '../core/terrain.js';
import { rebuild } from '../core/engine.js';
import { updatePreviewSculptMode } from '../core/sculpt-interaction.js';
import { updateGlobalButtons, takeSnapshot, globalHistoryLog, setUndoRestoring } from '../core/history.js';
import { AppState } from './app-state.js';
import { markDirty } from '../core/dirty.js';

// save audit: the change pipeline's serialize order (see the editor change handler)
let _serializeSeq = 0;
import { refreshAllStampMasks, updateStampMasks } from './stamp-mask-manager.js';
import { VectorEditor } from '../editor/index.js';
import { buildDrapeSvg, nextPow2 } from '../core/preview/drape-svg.js';
import { dbg, isDebugEnabled } from '../core/debug.js';
import { fusLog } from '../core/fusion-bridge.js';
import { buildSketchManifest } from '../editor/editor-sketch-manifest.js';
import { frameContext } from '../editor/editor-frame-profile.js';
import { boardRegion } from '../editor/editor-shape-lattice-interaction.js';
import { FRAME_DEFS, frameParam, normalizeFrameRecord } from '../core/frame-record.js';
import { syncFramePanel } from './frame-panel.js';

/** The frame a fresh start opens on (data/frame-defs: "Template 1 - Hourglass"). */
const FRESH_START_FRAME_TEMPLATE = 'template_1';

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

  // syncUItoParam fires a real 'change' on checkboxes, which schedules an undo step -- and that step marked a fresh,
  // untouched start as "unsaved" (the leave-page warning then fired for nothing). The same guard applySnapshot uses.
  setUndoRestoring(true);
  Object.keys(P).forEach(k => syncUItoParam(k, P[k]));
  setUndoRestoring(false);
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
          _serializeSeq++; // Apply's own copy is the latest -- an in-flight change save must not overwrite it
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
      // Not awaited (initSvgEditor itself isn't async) — fire-and-forget,
      // same as the Apply/Cancel paths above.
      refreshAllStampMasks(nx, nz, preview, updatePreviewSculptMode);
      // SE11b: a restored drawing's colours should drape immediately, not
      // only after the next edit — "editor only... survives save/reopen"
      // (SE9) means drape survives reopen too.
      refreshDrape(preview);
    }
  } catch (e) {
    console.warn('[initSvgEditor] editor SVG restore failed:', e);
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

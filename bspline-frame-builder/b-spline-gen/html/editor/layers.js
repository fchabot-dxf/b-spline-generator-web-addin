/**
 * Layers — unlimited layers panel for the SVG editor.
 *
 * Data model: editor._layers is an array of layer objects. The minimal
 * shape is { id, name, visible }; every layer also carries a set of
 * per-pass CNC tooling fields (see TOOLING_DEFAULTS below). These came
 * from the old P.stampLayers model and now live on editor layers so the
 * two layer systems can collapse into one (each editor layer = one
 * stamp pass). See Step 1 of the stamp-layer → editor-layer unification.
 *
 *   - id: stable string used as data-layer on SVG elements
 *   - name: user-editable display name (defaults to "Layer N")
 *   - visible: bool (default true); the MASTER switch — off, the layer is
 *              off everywhere: hidden in the editor, not carved, not
 *              draped, not exported. `carve`/`showColor` keep their
 *              stored values while hidden, so turning it back on restores
 *              exactly what was there before (T27 FINAL — replaces SE10's
 *              independent-axes design; see isCarved/isExported/showsColor
 *              below, the one place these three fields' effective rules
 *              live).
 *   - carve: bool (default true); this layer's presence in the 3D relief
 *            (mask generation + heightfield), gated by visible too — see
 *            isCarved. There is no separate drape3d field; "3D" IS this
 *            toggle (T27 dropped the earlier standalone drape tag).
 *   - showColor: bool (default true); whether the layer draws in its own
 *                elements' colors or one neutral color, in the editor
 *                canvas (display-only override, a CSS class, never a
 *                rewrite of elements' stored stroke/fill) and, gated by
 *                visible too, painted on the 3D mesh (seat A's drape).
 *                Never disabled in the UI. See showsColor below.
 *   - depth, profile, angle: tool + plunge for this pass
 *   - tx/ty/rotation/scale/mirrorX/mirrorY: per-pass transform
 *   - blur, smoothing, suppression, edgeFilletRadius, filletPower:
 *     rasterizer knobs
 *   - pattern (SE7i, optional): this layer's own Lattice generator
 *     settings (see editor-lattice-pattern.js's PATTERN_DEFAULTS shape),
 *     set the first time Generate/Regenerate runs on this layer. Absent
 *     on every layer that has never used the Lattice tool — read via
 *     that file's own getLayerPattern(editor), never a raw field access,
 *     so a missing pattern reads as PATTERN_DEFAULTS everywhere
 *     consistently. Per-layer (not once per file) so two layers can each
 *     run their own independent lattice with their own seed/orientation/
 *     colors/widths.
 *
 * editor._activeLayer is the id of the active (editable) layer.
 *
 * Compatibility (SA-DEAD-6, corrected): a hidden <select
 * id="editorLayerSelect"> is kept in sync (`_syncLegacySelect` below) —
 * checked directly, no read/write of it remains in editor-ui.js,
 * editor-text-session.js, or editor-io.js today (editor-ui.js reaches
 * the active layer through `_setActiveLayer` instead; see its own
 * comment at editor-ui.js:356-359). The shim is self-contained inside
 * this file now. Kept rather than removed because an external
 * (Fusion-side/devtools) consumer of `#editorLayerSelect`'s `.value`/
 * `.options` can't be ruled out from this repo alone.
 */
import { el, on } from './dom.js';
import { refreshOutlinePreview } from './editor-outline-preview.js';
import { dbg } from '../core/debug.js';
import { commitEdit } from './editor-commit.js';

/**
 * SE12 T36: which geometry a layer's Fusion export uses — an EXPLICIT
 * per-layer pick, never inferred from the geometry itself (Fred: "Don't
 * choose automatically"). Declared as data (value/label/hint) rather than
 * three hand-written buttons, so the sidebar picker renders from this
 * table and a future value is one entry here, not a UI rewrite.
 * 'centerline' is the default — today's only behavior, so a document
 * saved before this field existed needs no migration (see
 * applyToolingDefaults below). Nothing reads this field yet: the derived
 * outline preview is Slice 3 and the export swap is Slice 4 — this slice
 * only lets the user record the choice.
 */
export const FUSION_GEOMETRY = Object.freeze([
  { value: 'centerline', label: 'Centerline', hint: "The line's path — V-bit / engraving." },
  { value: 'outline', label: 'Outline', hint: "The stroke's true edge — pockets & resin inlay." },
  { value: 'both', label: 'Both', hint: 'Centerline and outline together.' },
]);

/**
 * Default per-pass CNC tooling values applied to every new editor layer.
 * Mirrors the historical P.stampLayers[0] defaults from state.js so
 * existing behavior is preserved while the new model is rolled out.
 *
 * Each field here MUST stay in sync with what the rasterizer + apply-
 * stamp-layers pipeline reads. When migrating those readers from
 * P.stampLayers to editor._layers, update both sides together.
 *
 * SE10 / T27: carve/showColor live here too, despite not being CNC
 * tooling in the depth/profile/angle sense — `applyToolingDefaults`
 * (below) is the one mechanism that back-fills a MISSING field on every
 * layer-creation and every restore path (addLayer, editor-io.js's open()
 * and _reconcileLayersFromSvg), and duplicating that fill-in logic
 * bespoke for three more fields (the way `visible` gets, elsewhere) would
 * be more code for the same result. `visible` itself stays special-cased
 * (addLayer's own literal, editor-io.js's own restore line) rather than
 * moved here — not broken, not this turn's to touch.
 */
export const TOOLING_DEFAULTS = Object.freeze({
  depth: 0.25,
  profile: 'vbit',
  angle: 90,
  tx: 0,
  ty: 0,
  rotation: 0,
  scale: 1,
  mirrorX: false,
  mirrorY: false,
  blur: 0,
  smoothing: 15,
  suppression: 0.15,
  edgeFilletRadius: 0,
  filletPower: 2.2,
  carve: true,
  showColor: true,
  fusionGeometry: 'centerline',
});

/** Apply TOOLING_DEFAULTS to a partial layer object — fills only the
 *  fields that aren't already set. Lets the caller pass in overrides
 *  (e.g. when restoring a saved layer that had its own depth/profile)
 *  without losing them. Returns the same object for chaining. */
export function applyToolingDefaults(layer) {
  for (const key in TOOLING_DEFAULTS) {
    if (layer[key] === undefined) layer[key] = TOOLING_DEFAULTS[key];
  }
  return layer;
}

// ----------- Public read helpers (used elsewhere) -----------

/** T27 FINAL: the one place the three fields' EFFECTIVE rules live —
 *  every gate (mask generation, heightfield, Fusion sketch, SVG download,
 *  canvas coloring, seat A's drape) reads a layer through these, never a
 *  raw `layer.carve`/`layer.showColor` check of its own, so the rule
 *  can't drift between call sites.
 *  Blind-spot audit B6 (Fred turn 207, "hidden is DISPLAY-ONLY", now fully): `visible` no longer gates carving.
 *  A hidden layer keeps its own carve setting -- it still carves the 3D and goes to the Carved component on Send,
 *  exactly as when shown; hiding only takes it off the CANVAS (isShown, below). */
export function isCarved(l) {
  return !!l && l.carve !== false;
}
/** Fred (turn 207): hidden is DISPLAY-ONLY -- every art layer ships on Send, visible or hidden (a carved one
 *  to the Carved component, the rest to root, by isCarved above, which ignores `visible`). The SVG download
 *  reads the same gate. */
export function isExported(l) {
  return !!l;
}
/** Turn 207: is the layer SHOWN on the canvas (display only -- the outline preview, the boundary guide)?
 *  Export no longer reads `visible` (isExported, above); display still does. */
export function isShown(l) {
  return !!l && l.visible !== false;
}
export function showsColor(l) {
  return !!l && l.visible !== false && l.showColor !== false;
}
/** SE12 T36: whether a layer's export should include its OUTLINE geometry
 *  (the derived offset shape — Slice 3's preview and Slice 4's export swap
 *  are what will actually READ this; neither is built yet). Gated the
 *  same shape as the three above: the layer is SHOWN (isShown -- this gate drives the canvas preview),
 *  and the layer's own pick must not be the default 'centerline'
 *  (which means "no outline," same as every document saved before this
 *  field existed). `l.fusionGeometry || 'centerline'`, not a bare field
 *  read: every REAL layer has already been through applyToolingDefaults
 *  by the time anything calls this, but isCarved/showsColor both default
 *  safely on a missing key too (`!== false` reads undefined as "on," the
 *  same historical default) — matching that defensiveness here means a
 *  layer-shaped object that HASN'T been through applyToolingDefaults yet
 *  (a test mock, a future call site) reads as "no outline," the field's
 *  own declared default, not the opposite. */
export function showsOutline(l) {
  return isShown(l) && (l.fusionGeometry || 'centerline') !== 'centerline';
}

export function getElementLayer(node) {
  if (!node) return '0';
  const layer = node.attr('data-layer');
  return layer == null ? '0' : String(layer);
}

export function getActiveLayer(editor) {
  return editor._activeLayer === undefined || editor._activeLayer === null
    ? '0'
    : String(editor._activeLayer);
}

/** Auto-create a layer when the user starts drawing/typing on an empty
 *  editor (or when the active layer id points at nothing). Returns the
 *  id of the layer that should receive the new element. Called from
 *  drawing/text entry points so the user never has to click "+ Add"
 *  before starting to draw. skipUndo:true so the layer-creation
 *  collapses into the same undo step as the first stroke. */
export function ensureActiveLayer(editor) {
  const layers = Array.isArray(editor._layers) ? editor._layers : [];
  const activeOk = layers.some(l => l.id === getActiveLayer(editor));
  if (layers.length > 0 && activeOk) return getActiveLayer(editor);

  // Either no layers exist yet, or the active id is stale (e.g. after
  // a delete left no replacement). Create a fresh "Layer 1" and make
  // it active. Bundle into the next user action's undo step.
  const created = addLayer(editor, { skipUndo: true });
  setActiveLayer(editor, created.id);
  return created.id;
}

/** Audit (batch 2): an element hidden on its own (display:none -- a Shape Lattice contour with Show contour off)
 *  is not there for picking or snapping, same as one on a hidden layer. The scissors, the Stripe tool and Select
 *  used to cut / stripe / select an invisible contour piece. */
function _hiddenItself(node) {
  const n = node && (node.node || node);
  return !!(n && typeof n.getAttribute === 'function' && n.getAttribute('display') === 'none');
}

export function isEditableByLayer(editor, node) {
  return getElementLayer(node) === getActiveLayer(editor) && !_hiddenItself(node);
}

/** SE7h add-on (Fred: generated Rails/Ties/Nodes pieces were unclickable
 *  in Select/Node modes — generatePattern restores whatever layer was
 *  active BEFORE Generate ran, so its own new layers are never the
 *  active one, and isEditableByLayer above only ever allows the active
 *  layer through). Is `node`'s own layer simply VISIBLE — not
 *  necessarily the active one? Used ONLY by hit-testing/marquee in
 *  'select'/'node' modes (editor-hit.js's getNearbyElement,
 *  editor-marquee.js's finalizeMarquee) — drawing modes keep
 *  isEditableByLayer's active-layer-only rule unchanged, so you still
 *  draw onto the layer you're on, never accidentally onto whatever
 *  happens to be under the cursor. A node whose data-layer names no
 *  layer record at all (legacy/pre-layers content, or a test fixture
 *  with no _layers array) is always testable — the same "missing =
 *  true" default isCarved/isExported/showsColor above already use. */
export function isOnVisibleLayer(editor, node) {
  const layerId = getElementLayer(node);
  const layers = Array.isArray(editor._layers) ? editor._layers : [];
  const layer = layers.find((l) => String(l.id) === layerId);
  return (!layer || layer.visible !== false) && !_hiddenItself(node);
}

// ----------- Data ops -----------

function _nextLayerId(editor) {
  // Use a monotonic counter so deleted ids never collide with a re-added
  // layer. Stored on the editor so it persists for the session.
  if (typeof editor._nextLayerId !== 'number') {
    // Bootstrap from existing layer ids (handles loaded state).
    const existing = (editor._layers || []).map(l => Number(l.id)).filter(n => !isNaN(n));
    editor._nextLayerId = existing.length ? Math.max(...existing) + 1 : 0;
  }
  return String(editor._nextLayerId++);
}

export function addLayer(editor, opts = {}) {
  if (!Array.isArray(editor._layers)) editor._layers = [];
  const id = opts.id != null ? String(opts.id) : _nextLayerId(editor);
  const name = opts.name || `Layer ${editor._layers.length + 1}`;
  const visible = opts.visible !== false;
  // Build the layer with identity fields first, then layer-in any
  // caller-supplied tooling overrides, then fill in unspecified tooling
  // fields from TOOLING_DEFAULTS. This lets future call sites override
  // depth/profile/etc. via opts without us having to enumerate them.
  const layer = { id, name, visible };
  for (const key in TOOLING_DEFAULTS) {
    if (Object.prototype.hasOwnProperty.call(opts, key)) layer[key] = opts[key];
  }
  applyToolingDefaults(layer);
  editor._layers.push(layer);
  if (!editor._activeLayer) editor._activeLayer = id;
  renderLayersPanel(editor);
  applyLayerState(editor);
  // Caller may pass {skipUndo:true} when this add is bundled with
  // another action (e.g. auto-create-on-first-draw — task 2) so the two
  // collapse into one undo step. Default is a discrete undo entry.
  // Audit (batch 3): skipUndo = BUNDLED -- no step AND no commit here; the calling operation (Generate, the first
  // draw, "move to new layer", a reset) commits once itself. The commit used to fire here anyway, persisting and
  // remasking a half-built state up to 3-4 times per first Generate.
  if (opts.skipUndo) return layer;
  if (typeof editor.pushState === 'function') editor.pushState();
  // UI4 item 6 (Fred, live: a layer added from the main sidebar vanished
  // when the editor reopened): every OTHER roster mutator below
  // (removeLayer/reorderLayer/setLayerVisible/setLayerCarve/
  // setLayerShowColor) calls this — addLayer was the one that didn't,
  // so a freshly-added EMPTY layer lived only in the in-memory
  // editor._layers, never reached P.editorSvg's persisted
  // data-editor-layers roster (editor-io.js's _serializeLayersAttr,
  // which already handles empty layers correctly — this was a missing
  // WRITE, not a missing read), and open()'s unconditional rebuild-
  // from-persisted-roster silently dropped it on the editor's next open.
  if (editor._onChange) editor._onChange();
  return layer;
}

// H20 item 6 (Fred: "after a few layers they just come back"): layers.js
// stays the lower-level module (editor-lattice-pattern.js already imports
// FROM it) — rather than reaching back UP into lattice-pattern concepts
// here (a circular import), this declares a generic "a layer is about to
// be removed" hook that any higher-level module can subscribe to. The
// Lattice/Shape-Lattice pattern system registers ITS OWN handler (see
// editor-lattice-pattern.js's own onLayerRemoved(...) call) to mark that
// kind permanently removed from its pattern, rather than layers.js needing
// to know anything about kinds/patterns at all.
const _removeHooks = [];
export function onLayerRemoved(fn) { _removeHooks.push(fn); }

/**
 * H20 item 5 (Fred: "selecting a layer should signal or highlight what
 * geometry it is momentarily but not forever, since it is distracting if
 * I'm working on the canvas"). Checked for a persistent active-layer
 * highlight/dim to remove first: NONE exists — `applyLayerState`'s own
 * `.inactive-layer` class (below) has carried no opacity/dimming since
 * Fred 2026-09-24 (`styles/editor.css`'s own comment: "shown layers keep
 * FULL opacity even when not active — no dimming; the active layer is
 * marked in the layer list instead"); today it's `pointer-events: none`
 * only. So this is a pure addition, not a replacement of anything.
 *
 * Declared once — duration, colour and the prefers-reduced-motion rule
 * all live HERE, in the one function any caller (today: the row click
 * handler, below) uses. Deliberately does NOT reuse editor-ui.js's own
 * `_renderHighlight` (the element-selection halo) — that module already
 * imports FROM this one (`getElementLayer`/`setActiveLayer`), so pulling
 * its private helper back in here would be a circular import; this is a
 * small, self-contained clone-and-thicken-the-stroke routine instead,
 * using the SAME `#ffcc00` selection colour for visual consistency.
 */
export const LAYER_FLASH_COLOR = '#ffcc00';
export const LAYER_FLASH_DURATION_MS = 1000;
const LAYER_FLASH_EXTRA_STROKE_IN = 0.05;

export function flashLayerGeometry(editor, layerId) {
  if (!editor || !editor._sketchLayer || !editor._highlightLayer || layerId == null) return;

  // Re-clicking the SAME layer restarts the flash; clicking a DIFFERENT
  // one mid-flash cancels the old one first — both are just "always tear
  // down whatever's currently flashing before starting the new one."
  if (editor._layerFlashTimer) {
    clearTimeout(editor._layerFlashTimer);
    editor._layerFlashTimer = null;
  }
  for (const h of editor._layerFlashHighlights || []) {
    try { h.remove(); } catch (_) {}
  }
  editor._layerFlashHighlights = [];

  const key = String(layerId);
  const targets = editor._sketchLayer.children().toArray()
    .filter((el) => el && el.node && el.node.getAttribute && el.node.getAttribute('data-layer') === key);
  if (!targets.length) return;

  const reduceMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  for (const el of targets) {
    let clone;
    try { clone = el.clone(); } catch (_) { continue; }
    if (!clone) continue;
    const sw = (el.attr && parseFloat(el.attr('stroke-width'))) || 0.02;
    clone
      .fill('none')
      .stroke({ color: LAYER_FLASH_COLOR, width: sw + LAYER_FLASH_EXTRA_STROKE_IN * 2, opacity: 0.6 })
      .attr('pointer-events', 'none');
    editor._highlightLayer.add(clone);
    if (typeof clone.back === 'function') clone.back();
    editor._layerFlashHighlights.push(clone);

    // Fade over the flash duration — skipped for prefers-reduced-motion,
    // which per the dispatch shows briefly then disappears abruptly
    // instead of animating out.
    if (!reduceMotion && clone.node && clone.node.style) {
      clone.node.style.transition = `opacity ${LAYER_FLASH_DURATION_MS}ms ease-out`;
      const raf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : (fn) => setTimeout(fn, 0);
      raf(() => { clone.node.style.opacity = '0'; });
    }
  }

  editor._layerFlashTimer = setTimeout(() => {
    for (const h of editor._layerFlashHighlights || []) {
      try { h.remove(); } catch (_) {}
    }
    editor._layerFlashHighlights = [];
    editor._layerFlashTimer = null;
  }, LAYER_FLASH_DURATION_MS);
}

function removeLayer(editor, id) {
  if (!Array.isArray(editor._layers)) return;
  const idx = editor._layers.findIndex(l => String(l.id) === String(id));
  if (idx === -1) return;

  // Fired BEFORE the splice below, so a hook can still see the full roster
  // (including whichever OTHER layer owns this one's pattern, if any).
  for (const fn of _removeHooks) fn(editor, id);

  // Remove SVG elements on this layer.
  if (editor._sketchLayer) {
    const doomed = editor._sketchLayer.children().toArray().filter(c => getElementLayer(c) === String(id));
    doomed.forEach(c => c.remove());
  }

  editor._layers.splice(idx, 1);

  if (getActiveLayer(editor) === String(id)) {
    // Activate a neighbor, or none if list is now empty.
    editor._activeLayer = editor._layers.length
      ? editor._layers[Math.max(0, idx - 1)].id
      : null;
  }
  renderLayersPanel(editor);
  applyLayerState(editor);
  commitEdit(editor); // audit batch 3: the one commit
}

function renameLayer(editor, id, newName) {
  if (!Array.isArray(editor._layers)) return;
  const layer = editor._layers.find(l => String(l.id) === String(id));
  if (!layer) return;
  const trimmed = (newName || '').trim();
  layer.name = trimmed || layer.name;
  renderLayersPanel(editor);
  if (typeof editor.pushState === 'function') editor.pushState();
  // UI4 item 6: same missing-persist gap addLayer had (see its own
  // comment) -- a rename otherwise doesn't survive the editor being
  // closed and reopened either.
  if (editor._onChange) editor._onChange();
}

const _KIND_RANK = { rail: 0, tie: 1, node: 2 };

/**
 * The drawing's z-order, from the roster: earlier layers in _layers render first (bottom of the z-stack), and
 * within one layer lattice pieces go rails, then ties, then nodes (Fred: "how are these nodes under the rail" --
 * hand-drawn ties/nodes on the Rails layer ended up under the rails the next Generate appended after them). Other
 * pieces keep their order (rank 0, with the rails). Children whose layer is not in the roster stay where they are.
 * Moves DOM nodes only when the order actually differs. Called by a layer reorder, every commit (editor-commit.js)
 * and Generate.
 */
export function syncLayerZOrder(editor) {
  if (!editor || !editor._sketchLayer || !Array.isArray(editor._layers)) return;
  const sketchNode = editor._sketchLayer.node;
  if (!sketchNode || !sketchNode.children || typeof sketchNode.appendChild !== 'function') return;
  const kids = [...sketchNode.children];
  const layerIdx = new Map(editor._layers.map((l, i) => [String(l.id), i]));
  const keyed = [];
  kids.forEach((node, pos) => {
    const li = layerIdx.get(node.getAttribute('data-layer'));
    if (li == null) return;
    keyed.push({ node, pos, li, rank: _KIND_RANK[node.getAttribute('data-lattice')] || 0 });
  });
  const sorted = keyed.slice().sort((a, b) => (a.li - b.li) || (a.rank - b.rank) || (a.pos - b.pos));
  if (sorted.every((k, i) => k === keyed[i])) return;
  sorted.forEach((k) => sketchNode.appendChild(k.node));
}

/** Move sourceId to be just before/after targetId in render order. The
 *  display list shows _layers in reverse (top of list = on top of
 *  z-stack). 'before' in display terms means HIGHER in z-order =
 *  AFTER in the array. 'after' = LOWER = BEFORE in the array. */
function reorderLayer(editor, sourceId, targetId, displaySide /* 'before' | 'after' */) {
  if (!Array.isArray(editor._layers)) return;
  const sIdx = editor._layers.findIndex(l => l.id === String(sourceId));
  const tIdx = editor._layers.findIndex(l => l.id === String(targetId));
  if (sIdx === -1 || tIdx === -1 || sIdx === tIdx) return;

  const [moved] = editor._layers.splice(sIdx, 1);
  // After removing source, the target's index may have shifted by -1 if
  // source was before target. Recompute.
  const newTIdx = editor._layers.findIndex(l => l.id === String(targetId));
  // displaySide='before' means moved should appear ABOVE target in the
  // panel = AFTER target in the array. 'after' = BELOW in panel =
  // BEFORE target in the array.
  const insertAt = displaySide === 'before' ? newTIdx + 1 : newTIdx;
  editor._layers.splice(insertAt, 0, moved);

  syncLayerZOrder(editor);

  renderLayersPanel(editor);
  applyLayerState(editor);
  commitEdit(editor); // audit batch 3: the one commit
}

/** UX-UNDO: these three toggles are per-layer TOOLING (SE5c's
 *  LAYER_TOOLING_FIELDS, core/history.js) — undoable through the global
 *  mechanism like any other sidebar control, on whichever surface they're
 *  clicked from (this row renders in both the sidebar AND the SVG
 *  editor's own Layers panel). A plain DOM CustomEvent, not a direct
 *  import of core/history.js's scheduleUndoSnapshot: core/history.js
 *  already imports TOOLING_DEFAULTS FROM this file, so importing back
 *  would be a circular import (risky at module-init time, since
 *  LAYER_TOOLING_FIELDS reads TOOLING_DEFAULTS at its own top level).
 *  main/ui-bindings.js listens and calls scheduleUndoSnapshot — the
 *  same DOM-event decoupling this codebase already uses for cross-
 *  cutting notifications (e.g. bindTogglePanel's dispatched 'change').
 *  scheduleUndoSnapshot's own isEditorOpen() gate suppresses this while
 *  the SVG editor modal is open, so a toggle clicked from the EDITOR's
 *  own Layers panel still goes through the editor's stack only
 *  (editor.pushState() above), not the global one. */
function _notifyLayerToolingCommit(field) {
  document.dispatchEvent(new CustomEvent('layer-tooling-commit', { detail: { field } }));
}

export function setLayerVisible(editor, id, visible) {
  if (!Array.isArray(editor._layers)) return;
  const layer = editor._layers.find(l => String(l.id) === String(id));
  if (!layer) return;
  layer.visible = !!visible;
  renderLayersPanel(editor);
  applyLayerState(editor);
  if (typeof editor.pushState === 'function') editor.pushState();
  // SE12 T38: was `editor._onChange()` directly — a bypass of
  // _notifyChange (widespread pre-existing pattern across this file and
  // several others, not something to sweep in this turn's scope; flagged
  // in WORK-LOG). Fixed HERE specifically because visibility is the one
  // field that actually changes showsOutline's result (isShown gates
  // on it) — routing through _notifyChange('commit') keeps the exact
  // same onChange-triggered pipeline this already ran, and additionally
  // refreshes the outline preview through the same mechanism edits use.
  if (typeof editor._notifyChange === 'function') editor._notifyChange('commit');
  else if (editor._onChange) editor._onChange();
  _notifyLayerToolingCommit('visible');
}

/** T27: CARVE ("3D") — stored independent of `visible`, but every gate
 *  reads the compound isCarved(layer) (above), not this raw field alone,
 *  so a hidden layer never carves even with carve:true. */
export function setLayerCarve(editor, id, carve) {
  if (!Array.isArray(editor._layers)) return;
  const layer = editor._layers.find(l => String(l.id) === String(id));
  if (!layer) return;
  layer.carve = !!carve;
  renderLayersPanel(editor);
  commitEdit(editor); // audit batch 3: the one commit
  _notifyLayerToolingCommit('carve');
}

/** T27: the palette (showColor) toggle — never disabled. Applies as a
 *  display-only class via applyLayerState (never rewrites an element's
 *  own stored stroke/fill), so turning it back on always restores every
 *  element's own color exactly. */
export function setLayerShowColor(editor, id, showColor) {
  if (!Array.isArray(editor._layers)) return;
  const layer = editor._layers.find(l => String(l.id) === String(id));
  if (!layer) return;
  layer.showColor = !!showColor;
  renderLayersPanel(editor);
  applyLayerState(editor);
  commitEdit(editor); // audit batch 3: the one commit
  _notifyLayerToolingCommit('showColor');
}

// ----------- Active layer -----------

export function setActiveLayer(editor, layerId) {
  // Accept null/undefined to mean "no active layer".
  let normalized = layerId == null ? null : String(layerId);

  // If the requested layer doesn't exist (e.g. legacy saved value), fall
  // back to the first available layer, or null.
  if (normalized != null && Array.isArray(editor._layers) && editor._layers.length) {
    if (!editor._layers.some(l => l.id === normalized)) {
      normalized = editor._layers[0].id;
    }
  }
  editor._activeLayer = normalized;

  _syncLegacySelect(editor);
  renderLayersPanel(editor);
  applyLayerState(editor);
  // SE12 T38: covers BOTH "layer switch" and "document open/restore" —
  // editor-io.js's open() calls editor.setActiveLayer(...) as its own
  // last roster-restore step, so a document load refreshes the preview
  // through this same one hook, no separate call needed there. A direct
  // call, not editor._notifyChange('commit') (which setLayerVisible below
  // uses) — switching the ACTIVE layer doesn't itself change any layer's
  // visible/fusionGeometry, so the heavier remask+redrape pipeline that
  // 'commit' would also trigger has nothing to actually do here.
  refreshOutlinePreview(editor);
  return normalized;
}

/** Update the dimming/hiding state of every SVG child based on layer
 *  active/visibility. Also deselects the current selection if it's no
 *  longer editable. */
export function applyLayerState(editor) {
  if (!editor._sketchLayer) return;
  const state = _layerStateMaps(editor);
  editor._sketchLayer.children().forEach(child => _applyLayerClasses(child, state));

  // BUG-28 cross-layer multi-select: only deselect when the selection is
  // a SINGLE non-editable element. Multi-selection across layers is now
  // a legitimate state (shift-click / marquee can pick from any visible
  // layer), so we don't auto-strip it on layer changes.
  const selArr = editor._selectedElements || [];
  if (selArr.length === 1 && !isEditableByLayer(editor, selArr[0])) {
    editor._deselect();
  }
}

/** The same per-element step for ONE element that was just drawn onto a layer (audit follow-up: bricks
 *  re-laid onto a HIDDEN Bricks layer showed, because new elements never got the layer's classes until
 *  the next full applyLayerState). One declared step, shared with applyLayerState above. */
export function applyLayerStateTo(editor, child) {
  if (!child) return;
  _applyLayerClasses(child, _layerStateMaps(editor));
}

function _layerStateMaps(editor) {
  const activeLayer = getActiveLayer(editor);
  const layers = Array.isArray(editor._layers) ? editor._layers : [];
  const visById = new Map(layers.map(l => [l.id, l.visible !== false]));
  // T27: showsColor(l) — visible is the master here too, so a hidden
  // layer's color state is moot (layer-hidden already drops it from view)
  // and never disagrees with the row's own showColor stored value once
  // shown again. Display-only override (this class alone), never a
  // rewrite of the element's own stored stroke/fill attrs; the CSS rule
  // lives in styles/editor.css next to .layer-hidden/.inactive-layer, the
  // two classes this same loop already manages the same way.
  const colorById = new Map(layers.map(l => [l.id, showsColor(l)]));
  return { activeLayer, visById, colorById };
}

function _applyLayerClasses(child, { activeLayer, visById, colorById }) {
    const layerId = getElementLayer(child);
    const isActive = layerId === activeLayer;
    const isVisible = visById.has(layerId) ? visById.get(layerId) : true;
    const showColor = colorById.has(layerId) ? colorById.get(layerId) : true;

    // NOTE: do NOT use svg.js's toggleClass(name, force) here. In this
    // version of svg.js the second argument is ignored — the class just
    // gets flipped, so calling applyLayerState twice undoes the previous
    // call. That blew up undo (B1): after _restoreState injected SVG
    // markup that already carried the layer classes, applyLayerState
    // would flip them off when they should stay on, hiding every
    // restored child. Use explicit add/remove so the final class state
    // matches the data regardless of what was serialized.
    if (!isActive) child.addClass('inactive-layer');
    else           child.removeClass('inactive-layer');
    if (!isVisible) child.addClass('layer-hidden');
    else            child.removeClass('layer-hidden');
    if (!showColor) child.addClass('layer-no-color');
    else            child.removeClass('layer-no-color');
}

// ----------- Panel rendering -----------

function _eyeOpenSVG() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
}
function _eyeClosedSVG() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-6.5 0-10-7-10-7a18.27 18.27 0 0 1 4.06-5.06"/><path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c6.5 0 10 7 10 7a18.27 18.27 0 0 1-2.16 3.19"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`;
}
/** T27: the showColor toggle's icon — a paint palette, same stroke style
 *  as the eye icons above, so the row's three toggles read as one family
 *  rather than a glyph-text button (■) sitting next to two SVG ones. One
 *  icon regardless of on/off state; `.active` carries the state, same as
 *  the carve button. */
function _paletteSVG() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path class="pal-body" d="M12 2a10 10 0 1 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.3-.5-.8-.5-1.2 0-1.1.9-2 2-2h2.3c2.1 0 3.7-1.7 3.7-3.7C21 6.6 17 2 12 2z"/><circle class="pal-d1" cx="7" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle class="pal-d2" cx="9.5" cy="7.5" r="1.6" fill="currentColor" stroke="none"/><circle class="pal-d3" cx="14.5" cy="7.5" r="1.6" fill="currentColor" stroke="none"/><circle class="pal-d4" cx="17" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>`;
}

/** SE10 / T26: one row renderer, two call sites — the editor's own Layers
 *  panel (#editorLayersList) and the Vector Stamping sidebar's layer
 *  browser (#stampLayersList). Same data, same handlers (select, eye,
 *  add, rename, delete, reorder). MOB4 layer-row AMEND ("C1 — soft
 *  segmented"): the row itself now looks identical at every call site and
 *  width (Fred: desktop and phone should match) — `compact` today only
 *  changes the empty-state copy (a shorter "No layers yet." with no
 *  "click + to add" hint, since the sidebar's own + button is right
 *  above the list already). Exported so a container that isn't wired
 *  through renderLayersPanel's two fixed ids can still render the same
 *  list (kept minimal — no caller needs that today, but the shape is the
 *  one this codebase already declares things at: a container + editor +
 *  options, not a hardcoded id). */
export function renderLayerList(container, editor, { compact = false } = {}) {
  if (!container) return;
  const layers = Array.isArray(editor._layers) ? editor._layers : [];

  container.innerHTML = '';
  if (layers.length === 0) {
    const e = document.createElement('div');
    e.className = 'layers-empty';
    e.innerHTML = compact
      ? 'No layers yet.'
      : 'No layers yet.<br>Click + to add one, or just start drawing.';
    container.appendChild(e);
    return;
  }

  // Render rows top-to-bottom = top-of-z-order first. The _layers array's
  // last element is on top of the SVG (added last), so reverse for display.
  const activeId = getActiveLayer(editor);
  [...layers].reverse().forEach(layer => {
    container.appendChild(_makeLayerRow(editor, layer, layer.id === activeId, { compact }));
  });
}

export function renderLayersPanel(editor) {
  const list = document.getElementById('editorLayersList');
  if (list) renderLayerList(list, editor, { compact: false });

  // SE10: the Vector Stamping sidebar's layer browser — same data, same
  // renderLayerList, compact presentation. A no-op (renderLayerList's own
  // `if (!container) return`) on any page/state where #stampLayersList
  // doesn't exist, e.g. before the editor modal has ever been opened.
  const stampList = document.getElementById('stampLayersList');
  if (stampList) renderLayerList(stampList, editor, { compact: true });

  _syncLegacySelect(editor);

  // Notify other UI (main/stamp/layer.js keeps P.activeLayerIdx and a
  // couple of sidebar-owned bits — the V-Bit Angle row, the file-name
  // label — in sync from this) that the layer roster changed. Step 3 of
  // the stamp-layer → editor-layer unification; T26 reuses this same
  // event rather than declaring a second one, since it already fires on
  // every add/remove/rename/reorder/visibility/active-switch from either
  // list (both funnel through this one function).
  try {
    if (typeof document !== 'undefined' && typeof CustomEvent !== 'undefined') {
      document.dispatchEvent(new CustomEvent('editorLayersChanged', {
        detail: {
          editor,
          layers: editor._layers,
          activeId: editor._activeLayer,
        },
      }));
    }
  } catch (_) { /* defensive: rendering must not crash if listeners throw */ }
}

// SE10: profile → short label for the sidebar's compact tool-summary
// ("V .25"", "Ball .12""). Declared next to TOOLING_DEFAULTS' own profile
// values rather than inferred from the <select>'s option text, which
// lives in bspline_gen_palette.html and says something longer
// ("V-Bit (Linear)") that wouldn't fit a 44px row.
const PROFILE_LABELS = { vbit: 'V', adaptive: 'Adapt', ballnose: 'Ball', flat: 'Flat' };

/** The Bricks layer (editor-brick-tool.js ensureBricksLayer), by NAME: the stamp-mask pipeline
 *  (main/stamp-mask-manager.js) routes it through the brick-aware height mask
 *  (editor-brick-height-mask.js), matching ensureBricksLayer's own lookup (no reserved id scheme). */
export const BRICKS_LAYER_NAME = 'Bricks';
export function isBricksLayer(layer) {
  return !!layer && layer.name === BRICKS_LAYER_NAME;
}

/** Audit K7: the Bricks layer's carve profile is never read (its height comes from the brick mask), so
 *  its row reads "Raised .13"" / "Carved .13"" (the depth sign) instead of the misleading "Flat .13"",
 *  which also clashed with the Flat | Organic brick-top setting. Every other layer: profile + depth. */
function _summaryLabel(layer) {
  if (isBricksLayer(layer)) return (typeof layer.depth === 'number' && layer.depth < 0) ? 'Carved' : 'Raised';
  return PROFILE_LABELS[layer.profile] || layer.profile || '';
}

function _formatToolSummary(layer) {
  const label = _summaryLabel(layer);
  const depth = typeof layer.depth === 'number' ? layer.depth : 0;
  const abs = Math.abs(depth).toFixed(2).replace(/^0\./, '.');
  const sign = depth < 0 && !isBricksLayer(layer) ? '-' : ''; // Bricks: the word already says it
  return `${label} ${sign}${abs}"`;
}

/** T27: small factory for a fixed-glyph toggle button — same shape (a
 *  real <button>, `.active` + `aria-pressed` for on/off, click stops
 *  propagation and calls the setter). Only the carve ("3D") button uses
 *  this now; the eye and palette buttons are bespoke just below — they
 *  render an SVG icon (innerHTML), not glyph textContent. */
function _makeToggleButton({ className, glyph, active, onTitle, offTitle, onClick }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className + (active ? ' active' : '');
  btn.textContent = glyph;
  btn.title = active ? onTitle : offTitle;
  btn.setAttribute('aria-pressed', String(active));
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

function _makeLayerRow(editor, layer, isActive, { compact = false } = {}) {
  const row = document.createElement('div');
  row.className = 'layer-row' + (compact ? ' compact' : '') + (isActive ? ' active' : '');
  row.dataset.layerId = layer.id;

  const handle = document.createElement('span');
  handle.className = 'layer-handle';
  handle.textContent = '⋮⋮';
  handle.title = 'Drag to reorder';

  // Drag-to-reorder, via Pointer Events (not native HTML5 draggable/
  // dragstart/drop): matches editor-interaction.js's own one-pointer-path
  // convention for canvas gestures, and — unlike native drag-and-drop —
  // actually fires from touch input. H22 item 1 (Fred: "can't drag a layer
  // into an order I choose"): native drag never initiated from touch at
  // all (no browser support without a polyfill) and was unreliable from
  // mouse too; reorderLayer() itself was always correct (order survives
  // Regenerate and reopen) so only the gesture is replaced here.
  //
  // Top of the list = top of z-order = rendered last in the SVG (which
  // renders later children on top). _layers stores layers in render order
  // (first = bottom), so the display list reverses it; reorderLayer()
  // itself accounts for that.
  handle.style.touchAction = 'none';
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    const pointerId = e.pointerId;
    try { handle.setPointerCapture(pointerId); } catch (_) { /* defensive: capture can fail on some UAs/synthetic events */ }
    row.classList.add('dragging');
    dbg('LAYER-DRAG', 'start', { layerId: layer.id, pointerType: e.pointerType, pointerId });

    const clearDropMarkers = () => {
      document.querySelectorAll('.layer-row.drop-before, .layer-row.drop-after')
        .forEach(r => r.classList.remove('drop-before', 'drop-after'));
    };

    const onMove = (ev) => {
      if (ev.pointerId !== pointerId) return;
      clearDropMarkers();
      const target = document.elementFromPoint(ev.clientX, ev.clientY);
      const targetRow = target ? target.closest('.layer-row') : null;
      if (!targetRow || targetRow === row) return;
      const rect = targetRow.getBoundingClientRect();
      const isAbove = (ev.clientY - rect.top) < rect.height / 2;
      targetRow.classList.toggle('drop-before', isAbove);
      targetRow.classList.toggle('drop-after', !isAbove);
      dbg('LAYER-DRAG', 'over', { targetLayerId: targetRow.dataset.layerId, side: isAbove ? 'before' : 'after' });
    };

    const finish = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
      try { handle.releasePointerCapture(pointerId); } catch (_) { /* see setPointerCapture above */ }
      row.classList.remove('dragging');
    };

    const onUp = (ev) => {
      if (ev.pointerId !== pointerId) return;
      const dropBeforeRow = document.querySelector('.layer-row.drop-before');
      const dropAfterRow = document.querySelector('.layer-row.drop-after');
      clearDropMarkers();
      finish();
      const targetRow = dropBeforeRow || dropAfterRow;
      if (targetRow) {
        const targetId = targetRow.dataset.layerId;
        if (targetId && targetId !== String(layer.id)) {
          dbg('LAYER-DRAG', 'drop', { sourceLayerId: layer.id, targetLayerId: targetId, side: dropBeforeRow ? 'before' : 'after' });
          reorderLayer(editor, layer.id, targetId, dropBeforeRow ? 'before' : 'after');
        } else {
          dbg('LAYER-DRAG', 'drop onto self — no-op', { layerId: layer.id });
        }
      } else {
        dbg('LAYER-DRAG', 'drop with no target row under the pointer — no-op', { layerId: layer.id });
      }
    };

    const onCancel = (ev) => {
      if (ev.pointerId !== pointerId) return;
      dbg('LAYER-DRAG', 'cancel', { layerId: layer.id });
      clearDropMarkers();
      finish();
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onCancel);
  });

  const vis = document.createElement('button');
  vis.type = 'button';
  vis.className = 'editor-fillmode-btn layer-visibility' + (layer.visible === false ? ' is-hidden' : '');
  vis.innerHTML = layer.visible === false ? _eyeClosedSVG() : _eyeOpenSVG();
  vis.title = layer.visible === false ? 'Show layer (it still exports and carves)' : 'Hide layer (still exports)'; // audit B6
  vis.setAttribute('aria-pressed', String(layer.visible !== false));
  vis.addEventListener('click', (e) => {
    e.stopPropagation();
    setLayerVisible(editor, layer.id, !layer.visible);
  });

  // T27: "3D" — the carve toggle, stored independent of visible (👁 above)
  // but every GATE reads the compound isCarved(layer), not this raw
  // button state — see that helper's own doc comment. The button itself
  // reflects the raw stored value so a hidden layer's carve setting still
  // shows what it'll do once shown again (the eye already communicates
  // "hidden" on its own).
  const carveActive = layer.carve !== false;
  const carveBtn = _makeToggleButton({
    className: 'editor-fillmode-btn layer-carve',
    glyph: '3D',
    active: carveActive,
    onTitle: 'Carved into the relief (click to stop carving)',
    offTitle: 'Not carved (click to carve)',
    onClick: () => setLayerCarve(editor, layer.id, !carveActive),
  });

  // T27: palette — element colors, NEVER disabled. Same raw-value-display
  // reasoning as carveBtn above; showsColor(layer) (the compound gate) is
  // what the canvas/drape actually read.
  const colorActive = layer.showColor !== false;
  const colorBtn = document.createElement('button');
  colorBtn.type = 'button';
  colorBtn.className = 'editor-fillmode-btn layer-showcolor' + (colorActive ? ' active' : '');
  colorBtn.innerHTML = _paletteSVG();
  colorBtn.title = colorActive
    ? 'Shows this layer\'s own colors (click for one neutral color)'
    : 'Drawn in one neutral color (click to show its own colors)';
  colorBtn.setAttribute('aria-pressed', String(colorActive));
  colorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setLayerShowColor(editor, layer.id, !colorActive);
  });

  // MOB4/UI1: the three toggles render as ONE outlined segmented group
  // (the shared app-wide .segmented-group/.editor-fillmode-btn look,
  // styles/base.css — this row's own "C1" look is what that shared
  // component was generalized FROM), right of the name, instead of three
  // separate square buttons to its left.
  const toggleGroup = document.createElement('div');
  toggleGroup.setAttribute('role', 'group');
  toggleGroup.className = 'segmented-group';
  toggleGroup.appendChild(vis);
  toggleGroup.appendChild(carveBtn);
  toggleGroup.appendChild(colorBtn);

  const name = document.createElement('span');
  name.className = 'layer-name';
  name.textContent = layer.name;
  name.title = layer.name;

  // MOB4 layer-row AMEND: the tool summary now renders inline right
  // after the name ("Layer 1 · V .25\"") in EVERY row, sidebar and
  // editor panel alike, at all widths — previously compact-only (the
  // editor's own panel had "no room or need for" it; the redesign's
  // whole point is that both now share one identical look). SE10 AMEND's
  // dimming rule (not hidden) when the layer isn't carved is unchanged.
  const toolSummary = document.createElement('span');
  toolSummary.className = 'layer-tool-summary' + (carveActive ? '' : ' not-carved');
  toolSummary.textContent = ` · ${_formatToolSummary(layer)}`;
  toolSummary.title = `${_summaryLabel(layer) || 'tool'}, depth ${layer.depth ?? 0}"${carveActive ? '' : ' (not carved)'}`;
  name.appendChild(toolSummary);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'layer-delete';
  del.textContent = '×';
  // Disable delete when this is the only layer — removing the last layer
  // would leave the editor in an invalid state with no editable target
  // until the user manually adds one back. See BUG-12.
  const isOnlyLayer = (Array.isArray(editor._layers) && editor._layers.length <= 1);
  if (isOnlyLayer) {
    del.disabled = true;
    del.title = 'Cannot delete the only remaining layer';
    del.style.opacity = '0.4';
    del.style.cursor = 'not-allowed';
  } else {
    del.title = 'Delete layer';
  }
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    if (del.disabled) return;
    // H20 item 4 (Fred, screenshot of the "Delete... and its N elements?"
    // confirm: "dont ask"): removed. removeLayer() already calls
    // pushState() AFTER the removal, capturing the post-delete state on
    // the undo stack the same way every other mutator here does — Ctrl+Z
    // pops back to the PRE-delete snapshot, restoring the layer, its
    // elements, its order and its per-layer settings in one step.
    removeLayer(editor, layer.id);
  });

  // MOB4 layer-row AMEND ("C1"): grip, then the editable name (with its
  // tool summary inline), then the segmented 👁·3D·palette group, then
  // delete — reverses T27's old left-of-name toggle order.
  row.appendChild(handle);
  row.appendChild(name);
  row.appendChild(toggleGroup);
  row.appendChild(del);

  // Click row → activate layer.
  row.addEventListener('click', () => {
    if (getActiveLayer(editor) !== String(layer.id)) {
      setActiveLayer(editor, layer.id);
    }
    // H20 item 5: fires on EVERY click, including re-selecting the
    // already-active layer (setActiveLayer above is skipped then, but the
    // flash itself is a separate, always-re-triggerable signal).
    flashLayerGeometry(editor, layer.id);
  });

  // Double-click name → inline rename.
  name.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    _startRename(editor, row, name, layer);
  });

  return row;
}

function _startRename(editor, row, nameEl, layer) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'layer-name-input';
  input.value = layer.name;
  input.maxLength = 40;

  const commit = (save) => {
    if (save) renameLayer(editor, layer.id, input.value);
    else      renderLayersPanel(editor);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(true); }
    else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
  });
  input.addEventListener('blur', () => commit(true));
  input.addEventListener('click', (e) => e.stopPropagation());

  row.replaceChild(input, nameEl);
  input.focus();
  input.select();
}

// ----------- Compat shims -----------

/** Keep the hidden legacy <select id="editorLayerSelect"> in sync with
 *  editor._layers so old call sites (editor-ui.js line 161, etc.) keep
 *  reading the right .value. Migrating those is task 2. */
function _syncLegacySelect(editor) {
  const sel = document.getElementById('editorLayerSelect');
  if (!sel) return;
  const layers = Array.isArray(editor._layers) ? editor._layers : [];
  const activeId = getActiveLayer(editor);

  sel.innerHTML = '';
  layers.forEach(layer => {
    const opt = document.createElement('option');
    opt.value = layer.id;
    opt.textContent = layer.name;
    sel.appendChild(opt);
  });
  if (layers.some(l => l.id === activeId)) {
    sel.value = activeId;
  } else if (layers.length) {
    sel.value = layers[0].id;
  }
}

// ----------- Init -----------

export function initLayerControls(editor) {
  if (!Array.isArray(editor._layers)) editor._layers = [];
  if (editor._activeLayer === undefined) editor._activeLayer = null;

  // Pre-create "Layer 1" synchronously so the legacy <select
  // id="editorLayerSelect"> has an option from the moment the editor
  // opens. Without this, callers (incl. external tooling) that read
  // .options on the first DOM tick saw an empty list — the previous
  // design lazily added Layer 1 on first draw via ensureActiveLayer().
  // See BUG-10.
  //
  // Safe alongside open()/restore: editor-io.js explicitly resets
  // `_layers = []` and rebuilds the roster from the loaded SVG, so this
  // placeholder is simply replaced when a saved project is opened.
  // skipUndo:true prevents the auto-create from polluting the undo stack
  // with a noop snapshot before the user has done anything.
  if (editor._layers.length === 0) {
    const layer = addLayer(editor, { skipUndo: true });
    editor._activeLayer = layer.id;
  }

  const addBtn = document.getElementById('editorAddLayer');
  if (addBtn) {
    on(addBtn, 'click', () => {
      const layer = addLayer(editor);
      setActiveLayer(editor, layer.id);
    });
  }

  // Keep legacy <select> change events working if anything still dispatches
  // them (some IO/restore code does).
  const legacySel = document.getElementById('editorLayerSelect');
  if (legacySel) {
    on(legacySel, 'change', () => setActiveLayer(editor, legacySel.value));
  }

  renderLayersPanel(editor);
  _syncLegacySelect(editor);
}

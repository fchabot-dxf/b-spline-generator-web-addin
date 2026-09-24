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
 *  can't drift between call sites. `visible` is the master: off collapses
 *  all three to false regardless of the layer's own carve/showColor
 *  values (which stay stored, unchanged, for when it's shown again). */
export function isCarved(l) {
  return !!l && l.visible !== false && l.carve !== false;
}
export function isExported(l) {
  return !!l && l.visible !== false;
}
export function showsColor(l) {
  return !!l && l.visible !== false && l.showColor !== false;
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

export function isEditableByLayer(editor, node) {
  return getElementLayer(node) === getActiveLayer(editor);
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
  if (!opts.skipUndo && typeof editor.pushState === 'function') editor.pushState();
  return layer;
}

function removeLayer(editor, id) {
  if (!Array.isArray(editor._layers)) return;
  const idx = editor._layers.findIndex(l => String(l.id) === String(id));
  if (idx === -1) return;

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
  if (typeof editor.pushState === 'function') editor.pushState();
  if (editor._onChange) editor._onChange();
}

function renameLayer(editor, id, newName) {
  if (!Array.isArray(editor._layers)) return;
  const layer = editor._layers.find(l => String(l.id) === String(id));
  if (!layer) return;
  const trimmed = (newName || '').trim();
  layer.name = trimmed || layer.name;
  renderLayersPanel(editor);
  if (typeof editor.pushState === 'function') editor.pushState();
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

  // Sync SVG DOM z-order: re-append children in the new layer order so
  // earlier layers in _layers render first (bottom of z-stack).
  if (editor._sketchLayer) {
    const sketchNode = editor._sketchLayer.node;
    const byLayer = new Map(editor._layers.map(l => [l.id, []]));
    editor._sketchLayer.children().toArray().forEach(ch => {
      const lid = getElementLayer(ch);
      if (byLayer.has(lid)) byLayer.get(lid).push(ch);
      // children with a layer id not in the roster stay where they are
      // (orphans; shouldn't happen post-reconcile, but defend against it)
    });
    editor._layers.forEach(layer => {
      byLayer.get(layer.id).forEach(ch => sketchNode.appendChild(ch.node));
    });
  }

  renderLayersPanel(editor);
  applyLayerState(editor);
  if (typeof editor.pushState === 'function') editor.pushState();
  if (editor._onChange) editor._onChange();
}

export function setLayerVisible(editor, id, visible) {
  if (!Array.isArray(editor._layers)) return;
  const layer = editor._layers.find(l => String(l.id) === String(id));
  if (!layer) return;
  layer.visible = !!visible;
  renderLayersPanel(editor);
  applyLayerState(editor);
  if (typeof editor.pushState === 'function') editor.pushState();
  if (editor._onChange) editor._onChange();
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
  if (typeof editor.pushState === 'function') editor.pushState();
  if (editor._onChange) editor._onChange();
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
  if (typeof editor.pushState === 'function') editor.pushState();
  if (editor._onChange) editor._onChange();
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
  _syncActiveLabel(editor);
  renderLayersPanel(editor);
  applyLayerState(editor);
  return normalized;
}

/** Update the dimming/hiding state of every SVG child based on layer
 *  active/visibility. Also deselects the current selection if it's no
 *  longer editable. */
export function applyLayerState(editor) {
  if (!editor._sketchLayer) return;
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

  editor._sketchLayer.children().forEach(child => {
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
  });

  // BUG-28 cross-layer multi-select: only deselect when the selection is
  // a SINGLE non-editable element. Multi-selection across layers is now
  // a legitimate state (shift-click / marquee can pick from any visible
  // layer), so we don't auto-strip it on layer changes.
  const selArr = editor._selectedElements || [];
  if (selArr.length === 1 && !isEditableByLayer(editor, selArr[0])) {
    editor._deselect();
  }
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
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.3-.5-.8-.5-1.2 0-1.1.9-2 2-2h2.3c2.1 0 3.7-1.7 3.7-3.7C21 6.6 17 2 12 2z"/><circle cx="7" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="9.5" cy="7.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="14.5" cy="7.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="17" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>`;
}

/** SE10 / T26: one row renderer, two call sites — the editor's own Layers
 *  panel (#editorLayersList) and the Vector Stamping sidebar's layer
 *  browser (#stampLayersList). Same data, same handlers (select, eye,
 *  add, rename, delete, reorder); `compact` only changes presentation
 *  (row sizing, and an extra tool-summary read-out the sidebar wants that
 *  the editor's own panel has no room or need for). Exported so a
 *  container that isn't wired through renderLayersPanel's two fixed ids
 *  can still render the same list (kept minimal — no caller needs that
 *  today, but the shape is the one this codebase already declares
 *  things at: a container + editor + options, not a hardcoded id). */
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
  _syncActiveLabel(editor);

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

function _formatToolSummary(layer) {
  const label = PROFILE_LABELS[layer.profile] || layer.profile || '';
  const depth = typeof layer.depth === 'number' ? layer.depth : 0;
  const abs = Math.abs(depth).toFixed(2).replace(/^0\./, '.');
  return `${label} ${depth < 0 ? '-' : ''}${abs}"`;
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
  row.draggable = true;

  // Drag-to-reorder. Top of the list = top of z-order = rendered last in
  // the SVG (which renders later children on top). _layers stores layers
  // in render order (first = bottom), so the display list reverses it.
  // A drag from display position D_from to D_to maps to array indices
  // (n-1-D_from) and (n-1-D_to).
  row.addEventListener('dragstart', (e) => {
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(layer.id));
  });
  row.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    document.querySelectorAll('.layer-row.drop-before, .layer-row.drop-after')
      .forEach(r => r.classList.remove('drop-before', 'drop-after'));
  });
  row.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = row.getBoundingClientRect();
    const isAbove = (e.clientY - rect.top) < rect.height / 2;
    row.classList.toggle('drop-before', isAbove);
    row.classList.toggle('drop-after', !isAbove);
  });
  row.addEventListener('dragleave', () => {
    row.classList.remove('drop-before', 'drop-after');
  });
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData('text/plain');
    const rect = row.getBoundingClientRect();
    const isAbove = (e.clientY - rect.top) < rect.height / 2;
    row.classList.remove('drop-before', 'drop-after');
    if (sourceId && sourceId !== String(layer.id)) {
      reorderLayer(editor, sourceId, layer.id, isAbove ? 'before' : 'after');
    }
  });

  const handle = document.createElement('span');
  handle.className = 'layer-handle';
  handle.textContent = '⋮⋮';
  handle.title = 'Drag to reorder';

  const vis = document.createElement('button');
  vis.type = 'button';
  vis.className = 'layer-visibility' + (layer.visible === false ? ' is-hidden' : '');
  vis.innerHTML = layer.visible === false ? _eyeClosedSVG() : _eyeOpenSVG();
  vis.title = layer.visible === false ? 'Show layer' : 'Hide layer';
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
    className: 'layer-carve',
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
  colorBtn.className = 'layer-showcolor' + (colorActive ? ' active' : '');
  colorBtn.innerHTML = _paletteSVG();
  colorBtn.title = colorActive
    ? 'Shows this layer\'s own colors (click for one neutral color)'
    : 'Drawn in one neutral color (click to show its own colors)';
  colorBtn.setAttribute('aria-pressed', String(colorActive));
  colorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setLayerShowColor(editor, layer.id, !colorActive);
  });

  const name = document.createElement('span');
  name.className = 'layer-name';
  name.textContent = layer.name;
  name.title = layer.name;

  // SE10: compact-only — the editor's own panel has no tooling context to
  // show (and no room); the sidebar row is the one place a user picks a
  // layer WITHOUT the Plunge Depth / Tool Profile controls already in
  // view, so it gets an at-a-glance summary of what it'll carve with.
  // SE10 AMEND: dimmed (not hidden) when the layer isn't carved — its
  // tool spec still exists, it's just not currently cutting.
  let toolSummary = null;
  if (compact) {
    toolSummary = document.createElement('span');
    toolSummary.className = 'layer-tool-summary' + (carveActive ? '' : ' not-carved');
    toolSummary.textContent = _formatToolSummary(layer);
    toolSummary.title = `${PROFILE_LABELS[layer.profile] || layer.profile || 'tool'}, depth ${layer.depth ?? 0}"${carveActive ? '' : ' (not carved)'}`;
  }

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
    _confirmAndRemove(editor, layer);
  });

  // T27: the three toggles grouped left-to-right — 👁 · 3D · palette —
  // per the dispatch's own row spec, ahead of the editable name.
  row.appendChild(handle);
  row.appendChild(vis);
  row.appendChild(carveBtn);
  row.appendChild(colorBtn);
  row.appendChild(name);
  if (toolSummary) row.appendChild(toolSummary);
  row.appendChild(del);

  // Click row → activate layer.
  row.addEventListener('click', () => {
    if (getActiveLayer(editor) !== String(layer.id)) {
      setActiveLayer(editor, layer.id);
    }
  });

  // Double-click name → inline rename.
  name.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    _startRename(editor, row, name, layer);
  });

  return row;
}

function _confirmAndRemove(editor, layer) {
  // Count elements that will be deleted.
  let count = 0;
  if (editor._sketchLayer) {
    count = editor._sketchLayer.children().toArray().filter(c => getElementLayer(c) === String(layer.id)).length;
  }
  const msg = count > 0
    ? `Delete "${layer.name}" and its ${count} element${count === 1 ? '' : 's'}?`
    : `Delete "${layer.name}"?`;
  if (!window.confirm(msg)) return;
  removeLayer(editor, layer.id);
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

/** Update the small "Active Layer" pill in the editor header. */
function _syncActiveLabel(editor) {
  const label = document.getElementById('editorActiveLayerLabel');
  if (!label) return;
  const layers = Array.isArray(editor._layers) ? editor._layers : [];
  const active = layers.find(l => l.id === getActiveLayer(editor));
  label.textContent = active ? active.name : '—';
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
  _syncActiveLabel(editor);
}

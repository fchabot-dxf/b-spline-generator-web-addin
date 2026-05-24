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
 *   - visible: bool; hidden layers are dimmed via CSS and excluded
 *              from the stamp expand pipeline (task 4)
 *   - depth, profile, angle: tool + plunge for this pass
 *   - tx/ty/rotation/scale/mirrorX/mirrorY: per-pass transform
 *   - blur, smoothing, suppression, edgeFilletRadius, filletPower:
 *     rasterizer knobs
 *
 * editor._activeLayer is the id of the active (editable) layer.
 *
 * Compatibility: a hidden <select id="editorLayerSelect"> is kept in sync
 * for legacy callers (editor-ui.js, editor-text-session.js, editor-io.js)
 * that still read/write .value. Migrating those is task 2.
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

export function removeLayer(editor, id) {
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

export function renameLayer(editor, id, newName) {
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
export function reorderLayer(editor, sourceId, targetId, displaySide /* 'before' | 'after' */) {
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

  editor._sketchLayer.children().forEach(child => {
    const layerId = getElementLayer(child);
    const isActive = layerId === activeLayer;
    const isVisible = visById.has(layerId) ? visById.get(layerId) : true;

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
  });

  if (editor._selectedElement && !isEditableByLayer(editor, editor._selectedElement)) {
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

export function renderLayersPanel(editor) {
  const list = document.getElementById('editorLayersList');
  if (!list) return;

  const layers = Array.isArray(editor._layers) ? editor._layers : [];
  const empty = document.getElementById('editorLayersEmpty');

  // Render rows top-to-bottom = top-of-z-order first. The _layers array's
  // last element is on top of the SVG (added last), so reverse for display.
  list.innerHTML = '';
  if (layers.length === 0) {
    if (empty) {
      list.appendChild(empty);
      empty.style.display = '';
    } else {
      const e = document.createElement('div');
      e.className = 'layers-empty';
      e.id = 'editorLayersEmpty';
      e.innerHTML = 'No layers yet.<br>Click + to add one, or just start drawing.';
      list.appendChild(e);
    }
  } else {
    const activeId = getActiveLayer(editor);
    [...layers].reverse().forEach(layer => {
      list.appendChild(_makeLayerRow(editor, layer, layer.id === activeId));
    });
  }

  _syncLegacySelect(editor);
  _syncActiveLabel(editor);
}

function _makeLayerRow(editor, layer, isActive) {
  const row = document.createElement('div');
  row.className = 'layer-row' + (isActive ? ' active' : '');
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
  vis.addEventListener('click', (e) => {
    e.stopPropagation();
    setLayerVisible(editor, layer.id, !layer.visible);
  });

  const name = document.createElement('span');
  name.className = 'layer-name';
  name.textContent = layer.name;
  name.title = layer.name;

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

  row.appendChild(handle);
  row.appendChild(vis);
  row.appendChild(name);
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

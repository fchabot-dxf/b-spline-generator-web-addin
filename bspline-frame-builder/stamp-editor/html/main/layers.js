/**
 * layers.js — stamp-editor's layer model + UI.
 *
 * Each layer is an independent SVG document with its own tool profile.
 * The engine iterates over enabled layers and accumulates displacements
 * per grid cell before triangulating, so a single Fusion face can host
 * multiple motifs at different depths / tool shapes.
 *
 * Layer shape:
 *   {
 *     id:      string,           // stable id for DOM keying
 *     name:    string,           // user-editable label
 *     enabled: bool,              // skipped by the engine when false
 *     svg:     string,            // <svg>…</svg> document
 *     profile: { kind, depth, vbitAngle },
 *     fillet:  number (mm),
 *     blur:    number (mm),
 *     raise:   bool               // push out instead of carve in
 *   }
 *
 * Public API:
 *   initLayerManager(state, scheduleEngine, openEditorFor)
 *   getLayers(state)
 *   addLayer(state, opts?)
 *   removeLayer(state, id)
 *   updateLayer(state, id, patch)
 *   renderLayerList(state)
 */

import { pyLog } from '../core/runtime.js';

const DEFAULT_SVG = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">'
                  + '<circle cx="50" cy="50" r="30" fill="black"/></svg>';

let _onEditRequest   = null;   // (layer) => void, set by initLayerManager
let _scheduleEngine  = null;

let _nextLayerNum = 1;

/* ────────────────────────────────────────────────────────────────────
 * Lifecycle
 * ──────────────────────────────────────────────────────────────────── */

export function initLayerManager(state, scheduleEngine, openEditorFor) {
  _scheduleEngine  = scheduleEngine;
  _onEditRequest   = openEditorFor;
  if (!state.layers) state.layers = [];

  const addBtn = document.getElementById('btnAddLayer');
  if (addBtn) addBtn.addEventListener('click', () => {
    addLayer(state);
    renderLayerList(state);
    _scheduleEngine();
  });

  // Always start with one default layer so the user has something to
  // edit out of the box.
  if (state.layers.length === 0) addLayer(state);
  renderLayerList(state);
}

export function getLayers(state) { return state.layers || []; }

/* ────────────────────────────────────────────────────────────────────
 * Mutations
 * ──────────────────────────────────────────────────────────────────── */

export function addLayer(state, opts) {
  const layer = {
    id:      `l-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name:    opts?.name    || `Layer ${_nextLayerNum++}`,
    enabled: true,
    svg:     opts?.svg     || DEFAULT_SVG,
    profile: {
      kind:      opts?.profileKind   || 'vbit',
      depth:     opts?.depth         ?? 1.0,
      vbitAngle: opts?.vbitAngle     ?? 60,
    },
    fillet: opts?.fillet ?? 0,
    blur:   opts?.blur   ?? 0,
    raise:  !!opts?.raise,
  };
  state.layers.push(layer);
  pyLog(`layer added: ${layer.id} (${state.layers.length} total)`);
  return layer;
}

export function removeLayer(state, id) {
  const idx = state.layers.findIndex(l => l.id === id);
  if (idx < 0) return;
  state.layers.splice(idx, 1);
  pyLog(`layer removed: ${id} (${state.layers.length} remaining)`);
}

export function updateLayer(state, id, patch) {
  const layer = state.layers.find(l => l.id === id);
  if (!layer) return null;
  Object.assign(layer, patch);
  if (patch.profile) Object.assign(layer.profile, patch.profile);
  return layer;
}

/* ────────────────────────────────────────────────────────────────────
 * Rendering
 * ──────────────────────────────────────────────────────────────────── */

export function renderLayerList(state) {
  const container = document.getElementById('layerList');
  if (!container) return;
  container.innerHTML = '';

  state.layers.forEach((layer) => {
    container.appendChild(buildLayerRow(state, layer));
  });
}

function buildLayerRow(state, layer) {
  const row = document.createElement('div');
  row.className = 'layer-row';
  row.dataset.layerId = layer.id;

  // ── Header: enabled toggle + name + delete ──────────────────────
  const head = document.createElement('div');
  head.className = 'layer-row-head';

  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = layer.enabled;
  enabled.title = 'Enable / disable this layer';
  enabled.addEventListener('change', () => {
    updateLayer(state, layer.id, { enabled: enabled.checked });
    _scheduleEngine();
  });
  head.appendChild(enabled);

  const name = document.createElement('input');
  name.type = 'text';
  name.value = layer.name;
  name.className = 'layer-name';
  name.spellcheck = false;
  name.addEventListener('change', () => {
    updateLayer(state, layer.id, { name: name.value });
  });
  head.appendChild(name);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'layer-del';
  del.title = 'Delete layer';
  del.textContent = '×';
  del.addEventListener('click', () => {
    if (!confirm(`Delete "${layer.name}"?`)) return;
    removeLayer(state, layer.id);
    renderLayerList(state);
    _scheduleEngine();
  });
  head.appendChild(del);

  row.appendChild(head);

  // ── Params grid ─────────────────────────────────────────────────
  const grid = document.createElement('div');
  grid.className = 'layer-params';

  grid.appendChild(makeSelect('Tool', layer.profile.kind, [
    ['vbit',     'V-bit'],
    ['flat',     'Flat'],
    ['ballnose', 'Ballnose'],
  ], (v) => {
    updateLayer(state, layer.id, { profile: { kind: v } });
    renderLayerList(state);                // toggles V-angle visibility
    _scheduleEngine();
  }));

  if (layer.profile.kind === 'vbit') {
    grid.appendChild(makeNumber('V° angle', layer.profile.vbitAngle, 5, (v) => {
      updateLayer(state, layer.id, { profile: { vbitAngle: v } });
      _scheduleEngine();
    }));
  }

  grid.appendChild(makeNumber('Depth (mm)',  layer.profile.depth, 0.1, (v) => {
    updateLayer(state, layer.id, { profile: { depth: v } });
    _scheduleEngine();
  }));
  grid.appendChild(makeNumber('Fillet (mm)', layer.fillet, 0.1, (v) => {
    updateLayer(state, layer.id, { fillet: v }); _scheduleEngine();
  }));
  grid.appendChild(makeNumber('Blur (mm)',   layer.blur, 0.1, (v) => {
    updateLayer(state, layer.id, { blur: v }); _scheduleEngine();
  }));

  const raiseLabel = document.createElement('label');
  raiseLabel.className = 'layer-raise';
  const raiseInput = document.createElement('input');
  raiseInput.type = 'checkbox';
  raiseInput.checked = layer.raise;
  raiseInput.addEventListener('change', () => {
    updateLayer(state, layer.id, { raise: raiseInput.checked });
    _scheduleEngine();
  });
  raiseLabel.appendChild(raiseInput);
  raiseLabel.appendChild(document.createTextNode(' Raised (push out)'));
  grid.appendChild(raiseLabel);

  row.appendChild(grid);

  // ── Edit button (opens VectorEditor) ────────────────────────────
  const editBar = document.createElement('div');
  editBar.className = 'layer-edit-bar';
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'primary';
  editBtn.textContent = 'Edit SVG…';
  editBtn.addEventListener('click', () => {
    if (_onEditRequest) _onEditRequest(layer);
  });
  editBar.appendChild(editBtn);
  row.appendChild(editBar);

  return row;
}

/* Small helpers ─ keep parameter rows visually consistent. */

function makeSelect(label, value, options, onChange) {
  const row = document.createElement('div');
  row.className = 'param-row';
  const lab = document.createElement('label');
  lab.textContent = label;
  row.appendChild(lab);
  const sel = document.createElement('select');
  for (const [v, t] of options) {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = t;
    if (v === value) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  row.appendChild(sel);
  return row;
}

function makeNumber(label, value, step, onChange) {
  const row = document.createElement('div');
  row.className = 'param-row';
  const lab = document.createElement('label');
  lab.textContent = label;
  row.appendChild(lab);
  const input = document.createElement('input');
  input.type = 'number';
  input.step = step;
  input.value = value;
  input.addEventListener('change', () => onChange(Number(input.value)));
  input.addEventListener('input',  () => onChange(Number(input.value)));
  row.appendChild(input);
  return row;
}

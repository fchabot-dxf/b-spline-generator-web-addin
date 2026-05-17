/**
 * main.js — Stamp Editor boot.
 *
 * Routes from Python:
 *   pong               — bridge ping reply
 *   face_count_update  — live count of BRepFaces currently selected
 *                        in the Fusion canvas
 *   faces_picked       — { faces:[…], count } captured snapshot
 *   face_grid          — { faceIndex, positions, normals, nx, nz, ok }
 *                        result of request_face_grid; held in
 *                        state.grids[faceIndex]
 *   error              — { msg } surfaced to the status line
 */

import { isFusion, sendToPython, pyLog } from '../core/runtime.js';
import { setStatus, wireButtons, setSelectionCount, showFaceState,
         runEngine } from './ui-bindings.js';
import { initLayerManager, renderLayerList } from './layers.js';

// Global error sink — if any imported module throws while parsing, the
// catch in DOMContentLoaded won't fire because module-load happens
// before the listener runs. This top-level listener catches those.
window.addEventListener('error',  (e) => pyLog(`uncaught: ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`));
window.addEventListener('unhandledrejection', (e) => pyLog(`unhandled promise: ${e.reason && e.reason.message ? e.reason.message : e.reason}`));
pyLog('main.js parsed');

// editor-bridge is imported lazily so a fault in the editor tree
// (missing dep, syntax error, missing globalThis.SVG) doesn't stop the
// palette from booting. If the import fails we log the error and the
// "Edit SVG…" button becomes a no-op — everything else still works.
let _openEditorFor = null;
async function loadEditorBridge(state, scheduleEngine) {
  try {
    const mod = await import('./editor-bridge.js');
    mod.initEditorBridge(state, scheduleEngine);
    _openEditorFor = mod.openEditorFor;
    pyLog('editor-bridge loaded');
  } catch (e) {
    pyLog(`editor-bridge load failed: ${e && e.message ? e.message : e}\n${e && e.stack ? e.stack : ''}`);
  }
}

const state = {
  liveCount: 0,        // updated by face_count_update
  faces:     [],       // captured face metadata (from faces_picked)
  grids:     [],       // [faceIndex] → { positions, normals, nx, nz }
  layers:    [],       // stamp layers — see layers.js for shape
  scheduled: false,    // rAF debounce flag for engine runs
};

const GRID_NX = 64;
const GRID_NZ = 64;

const routes = {
  pong: () => pyLog('pong'),

  face_count_update: (data) => {
    const n = (data && Number.isFinite(data.count)) ? data.count : 0;
    state.liveCount = n;
    setSelectionCount(n);
  },

  faces_picked: (data) => {
    const faces = (data && Array.isArray(data.faces)) ? data.faces : [];
    state.faces = faces;
    state.grids = new Array(faces.length).fill(null);
    showFaceState(faces);
    // The face state contains the layer list container — re-render it
    // so layers initialised before capture stay visible.
    renderLayerList(state);

    // Request a CP grid for each captured face so the engine has
    // sample data to modulate. We run them sequentially via the
    // bridge — Python ships back one face_grid response per request.
    for (let i = 0; i < faces.length; i++) {
      sendToPython('request_face_grid', { faceIndex: i, nx: GRID_NX, nz: GRID_NZ });
    }
  },

  face_grid: (data) => {
    if (!data || data.ok !== true) {
      pyLog(`face_grid: bad response idx=${data?.faceIndex} msg=${data?.msg}`);
      return;
    }
    const idx = data.faceIndex;
    state.grids[idx] = {
      faceIndex: idx,
      positions: new Float32Array(data.positions),
      normals:   new Float32Array(data.normals),
      nx:        data.nx,
      nz:        data.nz,
    };
    pyLog(`face_grid received idx=${idx} nx=${data.nx} nz=${data.nz}`);
    scheduleEngine();
  },

  commit_result: (data) => {
    if (!data) { setStatus('Commit: no response'); return; }
    if (!data.ok) {
      setStatus(`Commit failed${data.msg ? ': ' + data.msg : ''}`);
      pyLog(`commit_result: ${JSON.stringify(data)}`);
      return;
    }
    const n = data.meshBodies || 0;
    const parts = [];
    if (n) parts.push(`${n} mesh bod${n === 1 ? 'y' : 'ies'} created`);
    if (data.errors && data.errors.length) parts.push(`${data.errors.length} error(s)`);
    setStatus(parts.length ? `Sent to Fusion: ${parts.join(', ')}` : 'Sent to Fusion OK');
    if (data.errors && data.errors.length) pyLog(`commit errors: ${JSON.stringify(data.errors)}`);
  },

  error: (data) => setStatus(`Error: ${(data && data.msg) || 'unknown'}`),
};

window.addEventListener('DOMContentLoaded', () => {
  try {
    pyLog('boot: DOMContentLoaded — wiring core UI');
    setStatus(isFusion() ? 'Ready.' : 'Standalone (no Fusion).');
    wireButtons(state);

    // Layer manager's Edit button calls openEditorFor — a thin shim
    // that defers to the lazily-loaded editor bridge.
    const openEditorShim = (layer) => {
      if (_openEditorFor) { _openEditorFor(layer); return; }
      pyLog('Edit clicked but editor bridge not loaded yet — ignoring');
    };
    initLayerManager(state, scheduleEngine, openEditorShim);
    pyLog('boot: layer manager wired');

    // Kick off the editor bridge load in the background so the rest of
    // the UI is responsive even while the editor module tree parses.
    loadEditorBridge(state, scheduleEngine);

    if (isFusion()) sendToPython('ping', {});
    pyLog('boot: complete');
  } catch (e) {
    pyLog(`boot threw: ${e && e.message ? e.message : e}\n${e && e.stack ? e.stack : ''}`);
    setStatus('Boot error — see log');
  }
});

window.fusionJavaScriptHandler = {
  handle(action, dataJson) {
    let data = null;
    try { data = dataJson ? JSON.parse(dataJson) : null; }
    catch (_) { /* malformed — ignore */ }
    const route = routes[action];
    if (route) {
      try { route(data); } catch (e) { pyLog(`handler '${action}' threw: ${e.message}`); }
    } else {
      pyLog(`unrouted action: ${action}`);
    }
    return 'OK';
  },
};

/** rAF-debounced engine rebuild. UI inputs and incoming face_grid
 *  responses both call this; multiple calls within one frame collapse
 *  to a single runEngine. */
function scheduleEngine() {
  if (state.scheduled) return;
  state.scheduled = true;
  requestAnimationFrame(() => {
    state.scheduled = false;
    runEngine(state).catch((e) => pyLog(`engine threw: ${e.message}`));
  });
}

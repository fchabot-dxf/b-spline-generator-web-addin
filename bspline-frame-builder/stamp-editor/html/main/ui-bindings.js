/**
 * ui-bindings.js — DOM wiring, state-to-UI helpers, and the engine
 * orchestration entry point.
 *
 * View states:
 *   pickState  — empty/selection state. Live count of canvas-selected
 *                faces; "Use selected" captures the current set.
 *   faceState  — populated after capture. Lists each captured face;
 *                contains the motif + profile inputs that drive the
 *                stamp engine.
 */

import { sendToPython, pyLog } from '../core/runtime.js';
import { buildStampMesh }      from '../core/engine.js';
import { getLayers }            from './layers.js';

const MM_TO_CM = 0.1;

export function setStatus(msg) {
  const el = document.getElementById('statusLine');
  if (el) el.textContent = msg;
}

function setEngineStatus(msg) {
  const el = document.getElementById('engineStatus');
  if (el) el.textContent = msg || '';
}

export function setSelectionCount(n) {
  const el  = document.getElementById('selCount');
  if (el) el.textContent = String(n);
  const btn = document.getElementById('btnPickFace');
  if (btn) {
    btn.disabled = (n === 0);
    btn.textContent = n === 1
      ? 'Use selected face'
      : `Use ${n || 0} selected face${n === 1 ? '' : 's'}`;
  }
}

export function showFaceState(faces) {
  const pick  = document.getElementById('pickState');
  const face  = document.getElementById('faceState');
  if (!faces || !faces.length) {
    if (pick) pick.hidden = false;
    if (face) face.hidden = true;
    return;
  }
  if (pick) pick.hidden = true;
  if (face) face.hidden = false;

  const heading = document.getElementById('faceStateHeading');
  if (heading) {
    heading.textContent = faces.length === 1
      ? 'Picked face'
      : `Picked faces (${faces.length})`;
  }

  const list = document.getElementById('faceList');
  if (list) {
    list.innerHTML = '';
    faces.forEach((f, idx) => {
      const item = document.createElement('div');
      item.className = 'face-item';
      const head = document.createElement('div');
      head.className = 'face-item-head';
      head.textContent = `#${idx + 1}  ${f.surfaceKind || ''}`;
      item.appendChild(head);
      const dl = document.createElement('dl');
      dl.className = 'face-meta';
      const rows = [
        ['Body', f.bodyName || '?'],
        ['Area', Number.isFinite(f.faceArea) ? `${f.faceArea.toFixed(1)} mm²` : '—'],
      ];
      for (const [k, v] of rows) {
        const dt = document.createElement('dt'); dt.textContent = k;
        const dd = document.createElement('dd'); dd.textContent = v;
        dl.appendChild(dt); dl.appendChild(dd);
      }
      item.appendChild(dl);
      list.appendChild(item);
    });
  }
  setStatus(`${faces.length} face(s) captured.`);
}

export function wireButtons(state) {
  on('btnPickFace',   () => requestCapture());
  on('btnRepickFace', () => {
    state.faces = [];
    state.grids = [];
    state.lastDeformed = null;
    sendToPython('preview_clear', {});
    showFaceState([]);
    refreshCommitButton(state);
  });
  on('btnCancel', () => sendToPython('cancel', {}));
  on('btnCommit', () => {
    const dg = state.lastDeformed;
    if (!dg || !dg.length) {
      setEngineStatus('Nothing to commit — add a layer with a motif first.');
      return;
    }
    // Ship plain JS arrays for positions so the bridge can JSON-encode
    // them. Float32Array doesn't survive JSON.stringify.
    const payload = dg.map(g => ({
      faceIndex: g.faceIndex,
      nx:        g.nx,
      nz:        g.nz,
      positions: Array.from(g.positions),
    }));
    pyLog(`commit: shipping ${payload.length} face(s) to Python`);
    setEngineStatus(`Sending ${payload.length} face(s) to Fusion…`);
    sendToPython('commit', { grids: payload });
  });
}

/** Toggle the Send-to-Fusion button based on whether we have any
 *  deformed face grids ready to bake. */
export function refreshCommitButton(state) {
  const btn = document.getElementById('btnCommit');
  if (!btn) return;
  const has = !!(state.lastDeformed && state.lastDeformed.length);
  btn.disabled = !has;
}


function requestCapture() {
  pyLog('capture requested');
  setStatus('Capturing selected face(s)…');
  sendToPython('pick_face', {});
}

/* ────────────────────────────────────────────────────────────────────
 * Engine entry — called by main.js's rAF-debounced scheduler. Reads
 * the motif + profile inputs, builds the stamped mesh against the
 * cached face grids, ships the result to Python as a CG preview.
 * ──────────────────────────────────────────────────────────────────── */

export async function runEngine(state) {
  if (!state.grids || !state.grids.length) {
    setEngineStatus('No face grids yet.');
    return;
  }
  const usable = state.grids.filter(g => g && g.positions && g.normals);
  if (!usable.length) {
    setEngineStatus('Waiting for face grid…');
    return;
  }

  // Pull the layer model from state. Drop disabled layers and any
  // layer whose SVG is empty — the engine treats those as no-ops.
  const layers = getLayers(state)
    .filter(l => l && l.enabled && l.svg && l.svg.trim().length > 0);
  if (!layers.length) {
    setEngineStatus('Add a layer + draw something to see the preview.');
    sendToPython('preview_clear', {});
    return;
  }

  setEngineStatus(
    `Building ${usable.length} face mesh${usable.length === 1 ? '' : 'es'} `
    + `from ${layers.length} layer${layers.length === 1 ? '' : 's'}…`
  );
  let res;
  try {
    res = await buildStampMesh(usable, layers);
  } catch (e) {
    setEngineStatus(`Engine error: ${e.message}`);
    pyLog(`runEngine threw: ${e.message}\n${e.stack || ''}`);
    return;
  }
  if (!res || !res.positions) {
    setEngineStatus('Engine returned no mesh (mask empty?).');
    sendToPython('preview_clear', {});
    return;
  }
  const v = res.positions.length / 3;
  const t = res.indices.length   / 3;
  setEngineStatus(
    `Preview: ${v.toLocaleString()} verts, ${t.toLocaleString()} tris `
    + `(${res.stats.nonZeroPx.toLocaleString()} of `
    + `${res.stats.totalPx.toLocaleString()} px carved).`
  );
  shipMeshAsPreview(res);

  // Cache the per-face deformed grids for the commit path.
  state.lastDeformed = res.perFace || [];
  refreshCommitButton(state);
}

/** Engine mesh is in physical mm; Fusion CG wants cm. Convert + send. */
function shipMeshAsPreview(mesh) {
  const verts   = new Array(mesh.positions.length);
  const normals = new Array(mesh.normals.length);
  const indices = new Array(mesh.indices.length);
  for (let i = 0; i < mesh.positions.length; i++) verts[i]   = mesh.positions[i] * MM_TO_CM;
  for (let i = 0; i < mesh.normals.length;   i++) normals[i] = mesh.normals[i];
  for (let i = 0; i < mesh.indices.length;   i++) indices[i] = mesh.indices[i];
  sendToPython('preview_mesh', { verts, indices, normals });
}

function on(id, fn, type = 'click') {
  const el = document.getElementById(id);
  if (el) el.addEventListener(type, fn);
}

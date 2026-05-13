/**
 * ui-bindings.js — DOM event wiring + post-parse stats rendering.
 *
 * SELF-CONTAINED: imports only from sibling modules under
 * `step-editor/html/`. No path outside the step-editor folder is touched.
 *
 * After Open we render a stats panel (#statsPanel) showing the parsed
 * header fields and a top-N table of entity types. Verify round-trip
 * re-parses the writer's output and checks counts.
 */

import { sendToPython, pyLog } from '../core/runtime.js';
import {
  parseStep, writeStep, emptyHeader, countByType,
} from '../core/stp-parser.js';
import { isCloudEnabled, listFiles, saveFile } from '../core/cloud-sync.js';
import { sendStepToFusion } from '../core/fusion-bridge.js';
import {
  findBodies, scaleBody, scaleBodyAxes, translateBody, getBounds,
  rotateBody, mirrorBody, resizeBody, getBodyBounds,
} from '../core/stp-bodies.js';
import { regridBody, listBSplineSurfaces } from '../core/stp-regrid.js';
import { listFonts, loadFont, layoutText } from '../core/text-glyphs.js';
import { setText as setTextPreview, clear as clearTextPreview } from '../core/three-text.js';
import { tessellate as occtTessellate, isAvailable as occtAvailable } from '../core/occt-bridge.js';
import { setMeshes, highlightByName } from '../core/three-viewer.js';

/** Show a one-line message in the footer. Safe if the element is missing. */
export function setStatus(msg) {
  const el = document.getElementById('statusLine');
  if (el) el.textContent = msg;
}

/** File picker → resolves with `{name, text}` or null on cancel. */
export function pickFile(accept = '.stp,.step') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) { resolve(null); return; }
      const r = new FileReader();
      r.onload  = () => resolve({ name: f.name, text: String(r.result || '') });
      r.onerror = () => resolve(null);
      r.readAsText(f);
    };
    input.click();
  });
}

/** Trigger a browser-side download for the supplied STEP text. */
export function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'application/step' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Install every button click handler. Called once during boot.
 *
 * @param {object} state  shared editor state (mutated as files load/save)
 */
export function wireButtons(state) {
  on('btnOpen',         () => handleOpen(state));
  on('btnSave',         () => handleSave(state));
  on('btnNew',          () => handleNew(state));
  on('btnCancel',       () => sendToPython('cancel'));
  on('btnSendToFusion', () => handleSendToFusion(state));

  on('btnCloudList', () => handleCloudList());
  on('btnCloudSave', () => handleCloudSave(state));

  const saveBtn = document.getElementById('btnCloudSave');
  if (saveBtn && !isCloudEnabled()) saveBtn.title = 'Set window.STEP_EDITOR_API_URL';

  // Transform-panel apply buttons. These mutate state.parsed in place
  // and trigger a re-tessellate so the viewer follows along.
  on('btnApplyUniform',   () => handleApplyUniform(state));
  on('btnApplyAxes',      () => handleApplyAxes(state));
  on('btnApplyTranslate', () => handleApplyTranslate(state));
  on('btnApplyRotate',    () => handleApplyRotate(state));
  on('btnApplyMirror',    () => handleApplyMirror(state));
  on('btnApplyResize',    () => handleApplyResize(state));
  on('btnApplyRegrid',    () => handleApplyRegrid(state));

  // Regrid simplify presets: one click pre-fills Nu/Nv with the
  // preset value, then triggers Apply.  The Smp (sample density)
  // input stays where the user left it.
  for (const btn of document.querySelectorAll('.preset-btn[data-regrid-preset]')) {
    btn.addEventListener('click', () => {
      const n = Number(btn.dataset.regridPreset) | 0;
      const nu = document.getElementById('regridNu');
      const nv = document.getElementById('regridNv');
      if (nu) nu.value = String(n);
      if (nv) nv.value = String(n);
      handleApplyRegrid(state);
    });
  }

  // Text tool — populate the font dropdown once at boot, then wire the
  // Apply / Symbols / Close handlers.
  populateFontDropdown();
  on('btnApplyText',     () => handleApplyText(state));
  on('btnTextSymbols',   () => toggleSymbolPanel());
  on('textSymbolClose',  () => toggleSymbolPanel(false));

  // Re-populate the symbol grid when the font changes.
  const fontSelect = document.getElementById('textFont');
  if (fontSelect) fontSelect.addEventListener('change', () => {
    const panel = document.getElementById('textSymbolPanel');
    if (panel && !panel.hidden) populateSymbolGrid();
  });

  // Toolbar — each .tool-btn carries its tool ID in data-tool.  Click
  // routes through activateTool() which manages the active state and
  // panel visibility.  Verify is a stateless action (no panel, just
  // run-and-report), so we special-case it here.
  for (const btn of document.querySelectorAll('.tool-btn')) {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const id = btn.dataset.tool;
      if (id === 'verify') { handleVerify(state); return; }
      activateTool(state, id);
    });
  }
}

function on(id, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', fn);
}

/* ────────────────────────────────────────────────────────────────────
 * File handlers
 * ──────────────────────────────────────────────────────────────────── */

async function handleOpen(state) {
  const picked = await pickFile();
  if (!picked) return;

  setStatus(`Parsing "${picked.name}" (${formatBytes(picked.text.length)})…`);
  // Yield once so the UI repaints the status before a multi-second parse.
  await microtaskTick();

  const t0 = performance.now();
  let parsed;
  try {
    parsed = parseStep(picked.text);
  } catch (e) {
    setStatus(`Parse failed: ${e.message}`);
    pyLog(`parse fail ${picked.name}: ${e.message}`);
    return;
  }
  const dtMs = performance.now() - t0;

  state.filename = picked.name;
  state.parsed   = parsed;
  state.selectedBodyId = null;
  state.originalText   = picked.text;  // cached so re-tessellation after edit is straightforward

  renderStats(state, { parseMs: dtMs, sourceBytes: picked.text.length });
  populateBodyList(state);
  enableLoadedButtons(true);

  // Kick off tessellation in the background. Open returns as soon as
  // parsing is done; the viewer fills in when occt finishes (typically
  // ~1-3 s on a 14 MB canoe). Status line updates during the wait.
  retessellate(state, picked.text).catch((e) => {
    setStatus(`Viewer: ${e.message}`);
    pyLog(`viewer fail: ${e.message}`);
  });

  setStatus(
    `Loaded "${picked.name}" — ${parsed.entities.size.toLocaleString()} entities, `
    + `${dtMs.toFixed(0)} ms parse, ${parsed.warnings.length} warning(s).`
  );
  pyLog(`opened ${picked.name}: ${parsed.entities.size} entities in ${dtMs.toFixed(0)}ms`);
}

function handleNew(state) {
  state.filename = 'untitled.stp';
  state.parsed   = { header: emptyHeader(), entities: new Map(), warnings: [], rawText: '' };
  state.selectedBodyId = null;
  renderStats(state, { parseMs: 0, sourceBytes: 0 });
  populateBodyList(state);
  enableLoadedButtons(true);
  setStatus('New empty STEP file created.');
}

/* ────────────────────────────────────────────────────────────────────
 * Bodies — list + selection + transforms
 * ──────────────────────────────────────────────────────────────────── */

/**
 * Scan the parsed graph for body roots and render them into the
 * sidebar's #bodyList. Each <li> stores its body-id in data-body-id so
 * the click handler can resolve back to the entity without re-scanning.
 *
 * @param {object} state  shared editor state
 */
export function populateBodyList(state) {
  const section = document.getElementById('bodiesSection');
  const ul      = document.getElementById('bodyList');
  if (!section || !ul) return;

  ul.innerHTML = '';

  const bodies = state.parsed ? findBodies(state.parsed) : [];
  state._bodies = bodies;  // cache so transform handlers don't re-scan

  if (!bodies.length) {
    section.hidden = true;
    // Also clear the transform panel since there's nothing to edit.
    showTransformPanel(null);
    return;
  }

  section.hidden = false;
  for (const b of bodies) {
    const li = document.createElement('li');
    li.dataset.bodyId = String(b.id);

    const nameSpan = document.createElement('span');
    nameSpan.textContent = b.name;
    nameSpan.title = `#${b.id}  ${b.type}`;

    const typeSpan = document.createElement('span');
    typeSpan.className = 'body-type';
    typeSpan.textContent = shortType(b.type);

    li.appendChild(nameSpan);
    li.appendChild(typeSpan);
    li.addEventListener('click', () => selectBody(state, b.id));
    ul.appendChild(li);
  }

  // If a body was previously selected and is still present, keep it
  // highlighted across reloads. Otherwise reset the selection.
  if (state.selectedBodyId && bodies.some(b => b.id === state.selectedBodyId)) {
    selectBody(state, state.selectedBodyId);
  } else {
    state.selectedBodyId = null;
    showTransformPanel(null);
  }
}

/** Mark a body as selected, mirror its name into every tool panel
 *  header, and highlight the matching mesh in the 3D viewer. */
function selectBody(state, bodyId) {
  state.selectedBodyId = bodyId;
  const ul = document.getElementById('bodyList');
  if (ul) {
    for (const li of ul.children) {
      li.classList.toggle('selected', Number(li.dataset.bodyId) === bodyId);
    }
  }
  const body = (state._bodies || []).find(b => b.id === bodyId);

  // Each tool panel has a `<span class="tool-target">` we stamp with
  // the selected body's name so the user sees what they're editing.
  for (const span of document.querySelectorAll('.tool-target')) {
    span.textContent = body ? `— ${body.name}` : '';
  }

  // Try to highlight the matching mesh in the 3D viewer by name. occt
  // names meshes from PRODUCT labels, not from MANIFOLD_SOLID_BREP /
  // SHELL_BASED_SURFACE_MODEL — they overlap often but not always.
  highlightByName(body ? body.name : null);

  // Refresh the Resize panel's "Current:" line so the user sees the
  // body's current dimensions before they type a target.
  updateResizeCurrent(state);

  // Refresh the Regrid surface dropdown so it lists this body's
  // B-spline surfaces.  Empty (no surfaces) collapses to the
  // "All surfaces" entry only.
  populateRegridSurfaces(state);

  setStatus(body ? `Selected body "${body.name}".` : 'Body selection cleared.');
}

/** Fill the Regrid panel's Surface dropdown with this body's B-spline
 *  surfaces. The first option stays "All surfaces in this body" so
 *  the legacy bulk behaviour remains the default click. */
function populateRegridSurfaces(state) {
  const sel = document.getElementById('regridSurface');
  if (!sel) return;
  // Remember whatever the user had picked so we can restore it.
  const prior = sel.value;
  sel.innerHTML = '';

  const allOpt = document.createElement('option');
  allOpt.value = '';
  allOpt.textContent = 'All B-spline surfaces in this body';
  sel.appendChild(allOpt);

  if (!state.parsed || !state.selectedBodyId) return;

  const surfaces = listBSplineSurfaces(state.parsed, state.selectedBodyId);
  for (const s of surfaces) {
    const opt = document.createElement('option');
    opt.value = String(s.id);
    const dims = (s.nu != null && s.nv != null) ? ` (${s.nu}×${s.nv})` : '';
    const rat = s.rational ? ' [NURBS]' : '';
    opt.textContent = `Surface #${s.id}${dims}${rat}`;
    sel.appendChild(opt);
  }
  // Restore prior selection if it's still present (otherwise default
  // to "All").
  if (prior && [...sel.options].some(o => o.value === prior)) {
    sel.value = prior;
  }
}

/** Update the "Current: …" readout in the Resize panel from the
 *  currently selected body's bounding box. Cheap — just reads cached
 *  CARTESIAN_POINTs. Called on body selection and after each Resize. */
function updateResizeCurrent(state) {
  const el = document.getElementById('resizeCurrent');
  if (!el) return;
  if (!state.parsed || !state.selectedBodyId) {
    el.textContent = 'Current: —';
    return;
  }
  const bbox = getBodyBounds(state.parsed, state.selectedBodyId);
  if (!bbox) { el.textContent = 'Current: —'; return; }
  const [sx, sy, sz] = bbox.size;
  el.textContent = `Current: ${sx.toFixed(2)} × ${sy.toFixed(2)} × ${sz.toFixed(2)}`;
}

/**
 * Activate a tool by id.  Hides every tool-panel, shows the matching
 * one, and marks the toolbar button as active.  Clicking the active
 * tool again deactivates it (toggle behaviour).
 *
 * Tool-id → panel-id mapping is direct: id `scale` → `#scaleSection`,
 * `translate` → `#translateSection`, etc.  Tools that don't have a
 * panel yet (rotate, numeric, etc.) are wired as disabled buttons in
 * the HTML and never reach here.
 *
 * @param {object} state
 * @param {string} toolId
 */
export function activateTool(state, toolId) {
  const sameAsCurrent = (state.activeTool === toolId);
  state.activeTool = sameAsCurrent ? null : toolId;

  // Toolbar button active state.
  for (const btn of document.querySelectorAll('.tool-btn')) {
    btn.classList.toggle('active', btn.dataset.tool === state.activeTool);
  }

  // Tool panel visibility — only one visible at a time.
  for (const panel of document.querySelectorAll('.tool-panel')) {
    panel.hidden = (panel.id !== toolPanelId(state.activeTool));
  }
}

/** Map a tool id to its panel element id. */
function toolPanelId(toolId) {
  switch (toolId) {
    case 'scale':     return 'scaleSection';
    case 'translate': return 'translateSection';
    case 'rotate':    return 'rotateSection';
    case 'mirror':    return 'mirrorSection';
    case 'resize':    return 'resizeSection';
    case 'regrid':    return 'regridSection';
    case 'text':      return 'textSection';
    default:          return null;
  }
}

/** Drop the AUTOMOTIVE_DESIGN_ noise from a type for compact display. */
function shortType(t) {
  if (!t) return '';
  return t.replace('SHELL_BASED_SURFACE_MODEL', 'surface')
          .replace('MANIFOLD_SOLID_BREP',      'solid')
          .replace('BREP_WITH_VOIDS',          'solid+void')
          .replace('FACETED_BREP',             'mesh');
}

async function handleApplyUniform(state) {
  if (!requireSelectedBody(state)) return;
  const factor = readNumber('xformUniform', 1);
  if (factor === 1) { setStatus('Scale factor is 1 — no change.'); return; }

  await applyAndRefresh(state, 'Scaling…', () =>
    scaleBody(state.parsed, state.selectedBodyId, factor),
    (res) => `Scaled "${currentBodyName(state)}" by ${factor}× (${res.scaled.toLocaleString()} points).`
  );
}

async function handleApplyAxes(state) {
  if (!requireSelectedBody(state)) return;
  const factors = {
    x: readNumber('xformSX', 1),
    y: readNumber('xformSY', 1),
    z: readNumber('xformSZ', 1),
  };
  if (factors.x === 1 && factors.y === 1 && factors.z === 1) {
    setStatus('All axes are 1 — no change.');
    return;
  }
  await applyAndRefresh(state, 'Per-axis scaling…', () =>
    scaleBodyAxes(state.parsed, state.selectedBodyId, factors),
    (res) => `Scaled "${currentBodyName(state)}" by (${factors.x}, ${factors.y}, ${factors.z}) ` +
             `(${res.scaled.toLocaleString()} points).`
  );
}

async function handleApplyTranslate(state) {
  if (!requireSelectedBody(state)) return;
  const delta = {
    x: readNumber('xformTX', 0),
    y: readNumber('xformTY', 0),
    z: readNumber('xformTZ', 0),
  };
  if (delta.x === 0 && delta.y === 0 && delta.z === 0) {
    setStatus('Delta is zero — no change.');
    return;
  }
  await applyAndRefresh(state, 'Translating…', () =>
    translateBody(state.parsed, state.selectedBodyId, delta),
    (res) => `Translated "${currentBodyName(state)}" by (${delta.x}, ${delta.y}, ${delta.z}) ` +
             `(${res.scaled.toLocaleString()} points).`
  );
}

async function handleApplyRotate(state) {
  if (!requireSelectedBody(state)) return;
  const axis  = (document.getElementById('rotateAxis') || {}).value || 'z';
  const angle = readNumber('rotateAngle', 0);
  if (angle === 0) { setStatus('Angle is 0° — no change.'); return; }
  await applyAndRefresh(state, `Rotating ${angle}° around ${axis.toUpperCase()}…`, () =>
    rotateBody(state.parsed, state.selectedBodyId, axis, angle),
    (res) => `Rotated "${currentBodyName(state)}" by ${angle}° around ${axis.toUpperCase()} ` +
             `(${res.scaled.toLocaleString()} points).`
  );
}

async function handleApplyMirror(state) {
  if (!requireSelectedBody(state)) return;
  const plane = (document.getElementById('mirrorPlane') || {}).value || 'xy';
  const planeLabel = plane.toUpperCase();
  await applyAndRefresh(state, `Mirroring across ${planeLabel} plane…`, () =>
    mirrorBody(state.parsed, state.selectedBodyId, plane),
    (res) => `Mirrored "${currentBodyName(state)}" across ${planeLabel} ` +
             `(${res.scaled.toLocaleString()} points). ` +
             `Note: face orientation flips; Fusion auto-corrects via SAME_SENSE.`
  );
}

async function handleApplyResize(state) {
  if (!requireSelectedBody(state)) return;
  const target = {
    x: readNumber('resizeX', 0),
    y: readNumber('resizeY', 0),
    z: readNumber('resizeZ', 0),
  };
  if (target.x <= 0 && target.y <= 0 && target.z <= 0) {
    setStatus('Set at least one axis to a positive size.');
    return;
  }
  // Snapshot the bbox before so we can show before→after dimensions.
  const before = getBodyBounds(state.parsed, state.selectedBodyId);
  await applyAndRefresh(state, 'Resizing…', () =>
    resizeBody(state.parsed, state.selectedBodyId, target),
    (res) => {
      const after = getBodyBounds(state.parsed, state.selectedBodyId);
      const dims = after ? `${after.size[0].toFixed(1)} × ${after.size[1].toFixed(1)} × ${after.size[2].toFixed(1)}` : '?';
      return `Resized "${currentBodyName(state)}" to ${dims} ` +
             `(${(res.scaled || 0).toLocaleString()} points).`;
    }
  );
  // Refresh the "Current:" readout in the Resize panel.
  updateResizeCurrent(state);
}

async function handleApplyRegrid(state) {
  if (!requireSelectedBody(state)) return;
  const nu        = readNumber('regridNu', 8) | 0;
  const nv        = readNumber('regridNv', 8) | 0;
  const sample    = readNumber('regridSample', 32) | 0;
  const surfRaw   = (document.getElementById('regridSurface') || {}).value || '';
  const knotMode  = (document.getElementById('regridKnotMode') || {}).value || 'uniform';
  if (nu < 2 || nv < 2) { setStatus('Nu and Nv must be ≥ 2.'); return; }

  // Empty string → bulk mode (current default behaviour). Anything
  // else parses to an entity id pointing at a single B-spline surface.
  const targetSurfaceId = surfRaw === '' ? null : Number(surfRaw);
  const scopeLabel = targetSurfaceId == null
    ? `all surfaces in "${currentBodyName(state)}"`
    : `surface #${targetSurfaceId}`;

  await applyAndRefresh(state, `Regridding ${scopeLabel} to ${nu}×${nv} (${knotMode})…`, () =>
    regridBody(state.parsed, state.selectedBodyId, {
      targetNu: nu, targetNv: nv, sampleRes: sample,
      targetSurfaceId, knotMode,
    }),
    (res) => {
      if (res.error) return `Regrid failed: ${res.error}`;
      if (!res.surfaces) {
        return `Regrid: no matching B-spline surface in ${scopeLabel} (${res.skipped} skipped).`;
      }
      return `Regridded ${scopeLabel} — ${res.surfaces} surface(s) to ${nu}×${nv} ` +
             `via ${knotMode} (${res.newPoints.toLocaleString()} new points, ${res.skipped} skipped).`;
    }
  );

  // Surface ids change for some entities after regrid (the surface
  // itself keeps its id, but the dropdown should reflect the updated
  // Nu × Nv labels). Repopulate so the user sees the new dimensions.
  populateRegridSurfaces(state);
}

/** Run a transform fn, yield to the event loop so the status updates,
 *  then refresh the stats panel + body list + 3D viewer. */
async function applyAndRefresh(state, pendingMsg, op, successFn) {
  setStatus(pendingMsg);
  await microtaskTick();
  const t0 = performance.now();
  let res;
  try {
    res = op();
  } catch (e) {
    setStatus(`Transform failed: ${e.message}`);
    return;
  }
  const dt = performance.now() - t0;

  // Re-render stats and body list so the user sees the updated counts.
  // The source size will be wrong (it reflects the original parse), so
  // we pass 0 for parseMs to mean "transform-only refresh".
  renderStats(state, { parseMs: 0, sourceBytes: state.parsed.rawText.length });
  populateBodyList(state);
  setStatus(`${successFn(res)} (${dt.toFixed(0)} ms)`);
  pyLog(`xform: ${res.scaled} points, ${res.skipped} skipped`);

  // Serialize the edited graph and re-tessellate so the 3D view
  // catches up. Done in the background; no UI block. For the canoe
  // this re-tessellate is the slow step (~2-3 s) — milestone work
  // to optimise later by per-body tessellation.
  retessellate(state, null).catch((e) => {
    setStatus(`Viewer refresh failed: ${e.message}`);
  });
}

/**
 * Tessellate the current state and push the meshes into the viewer.
 *
 * If `sourceText` is provided, use it verbatim (faster — no writeStep
 * cost). Otherwise serialize state.parsed first. Updates the status
 * line during the long occt call.
 */
async function retessellate(state, sourceText) {
  pyLog(`retessellate: occtAvailable=${occtAvailable()}, hasParsed=${!!state.parsed}`);

  if (!occtAvailable()) {
    setStatus('Viewer disabled — occt-import-js not loaded (network/CDN issue?).');
    pyLog('retessellate: occtAvailable=false — window.occtimportjs not defined');
    return;
  }
  setStatus('Tessellating geometry…');
  await microtaskTick();

  const text = sourceText != null ? sourceText : writeStep(state.parsed);
  pyLog(`retessellate: payload ${text.length} bytes, kicking occt`);

  const t0 = performance.now();
  let result;
  try {
    result = await occtTessellate(text);
  } catch (e) {
    setStatus(`Tessellation failed: ${e.message}`);
    pyLog(`occt threw: ${e.message}`);
    return;
  }
  const dt = performance.now() - t0;

  if (!result.success) {
    setStatus(`Tessellation failed: ${result.message || 'unknown'}`);
    pyLog(`occt unsuccess: ${result.message || 'unknown'}`);
    return;
  }

  setMeshes(result.meshes);
  const sel = state._bodies?.find(b => b.id === state.selectedBodyId);
  if (sel) highlightByName(sel.name);

  setStatus(`Viewer: ${result.meshes.length} mesh(es) tessellated in ${dt.toFixed(0)} ms.`);
  pyLog(`occt ok: ${result.meshes.length} meshes in ${dt.toFixed(0)}ms`);
}

function requireSelectedBody(state) {
  if (!state.parsed)            { setStatus('Open or create a file first.'); return false; }
  if (!state.selectedBodyId)    { setStatus('Click a body in the list first.'); return false; }
  return true;
}

function currentBodyName(state) {
  const b = (state._bodies || []).find(x => x.id === state.selectedBodyId);
  return b ? b.name : '(unknown)';
}

function readNumber(id, fallback) {
  const el = document.getElementById(id);
  if (!el) return fallback;
  const n = Number(el.value);
  return Number.isFinite(n) ? n : fallback;
}

async function handleSave(state) {
  if (!state.parsed) { setStatus('Nothing to save — open or create a file first.'); return; }
  const text = writeStep(state.parsed);
  // For now, browser-side download. The Fusion-tunnel path (chunked
  // transfer to Python → importManager) lands when send-to-Fusion is wired.
  downloadText(state.filename || 'edited.stp', text);
  setStatus(`Downloaded "${state.filename || 'edited.stp'}" (${formatBytes(text.length)}).`);
}

/**
 * Round-trip check: write the current state back out, re-parse the result,
 * and confirm the entity count + per-type distribution survive intact.
 */
async function handleVerify(state) {
  if (!state.parsed) { setStatus('Open or create a file first.'); return; }

  setStatus('Round-tripping…');
  await microtaskTick();

  const t0   = performance.now();
  const text = writeStep(state.parsed);
  const t1   = performance.now();
  const reparsed = parseStep(text);
  const t2   = performance.now();

  const before = countByType(state.parsed);
  const after  = countByType(reparsed);

  // Diff the per-type counts.
  const diffs = [];
  const allTypes = new Set([...before.keys(), ...after.keys()]);
  for (const t of allTypes) {
    const a = before.get(t) || 0;
    const b = after.get(t)  || 0;
    if (a !== b) diffs.push(`${t}: ${a} → ${b}`);
  }

  const sizeBefore = state.parsed.rawText.length;
  const sizeAfter  = text.length;
  const matches    = diffs.length === 0 && state.parsed.entities.size === reparsed.entities.size;

  const lines = [
    matches ? '✓ Round-trip OK' : '✗ Round-trip mismatch',
    `Entities: ${state.parsed.entities.size} → ${reparsed.entities.size}`,
    `Types: ${before.size} → ${after.size}`,
    `Bytes: ${formatBytes(sizeBefore)} → ${formatBytes(sizeAfter)}`,
    `write: ${(t1 - t0).toFixed(0)} ms, re-parse: ${(t2 - t1).toFixed(0)} ms`,
  ];
  if (diffs.length) {
    lines.push('');
    lines.push('Per-type diffs:');
    for (const d of diffs.slice(0, 20)) lines.push(`  ${d}`);
    if (diffs.length > 20) lines.push(`  …and ${diffs.length - 20} more`);
  }

  showWarnings(lines.join('\n'));
  setStatus(matches
    ? `Round-trip OK (${reparsed.entities.size.toLocaleString()} entities preserved).`
    : `Round-trip mismatch — see panel.`);
  pyLog(`verify: ${matches ? 'OK' : 'MISMATCH'} (${diffs.length} diffs)`);
}

async function handleSendToFusion(state) {
  if (!state.parsed) { setStatus('Open or create a file first.'); return; }

  const btn = document.getElementById('btnSendToFusion');
  if (btn) btn.disabled = true;

  setStatus('Serializing STEP…');
  await microtaskTick();

  const t0 = performance.now();
  const text = writeStep(state.parsed);
  const t1 = performance.now();
  pyLog(`send: serialized ${text.length} bytes in ${(t1 - t0).toFixed(0)}ms`);

  // Derive a component name from the filename. The Python side uses this
  // to name the import group; falls back to "Imported STEP" if absent.
  const filename = state.filename || 'edited.stp';
  const groupName = filename.replace(/\.(stp|step)$/i, '').replace(/[^A-Za-z0-9_\-]+/g, '_') || 'Imported_STEP';

  try {
    setStatus(`Sending ${formatBytes(text.length)} to Fusion…`);
    await sendStepToFusion(text, { filename, groupName }, ({ percent, total, msg }) => {
      if (msg) setStatus(msg);
      else if (percent >= 0) setStatus(`Sending to Fusion… ${percent}% (${total} chunks)`);
    });
    setStatus(`Imported "${filename}" into the active Fusion design.`);
    pyLog('send: import_success');
  } catch (e) {
    setStatus(`Send to Fusion failed: ${e.message}`);
    pyLog(`send: FAILED — ${e.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ────────────────────────────────────────────────────────────────────
 * Cloud handlers
 * ──────────────────────────────────────────────────────────────────── */

async function handleCloudList() {
  if (!isCloudEnabled()) {
    setStatus('Cloud sync disabled — set window.STEP_EDITOR_API_URL.');
    return;
  }
  try {
    const { items } = await listFiles();
    setStatus(`Cloud: ${items.length} saved file(s). Picker UI lands next milestone.`);
    pyLog(`cloud list: ${items.length} items`);
  } catch (e) {
    setStatus(`Cloud list failed: ${e.message}`);
  }
}

async function handleCloudSave(state) {
  if (!isCloudEnabled()) {
    setStatus('Cloud sync disabled — set window.STEP_EDITOR_API_URL.');
    return;
  }
  if (!state.parsed) { setStatus('Open or create a file first.'); return; }
  const name = state.filename || 'untitled.stp';
  try {
    const text = writeStep(state.parsed);
    const res  = await saveFile(name, text);
    setStatus(`Saved "${name}" to cloud (${new Date(res.savedAt).toLocaleString()}).`);
    pyLog(`cloud save: ${name} (${text.length} bytes)`);
  } catch (e) {
    setStatus(`Cloud save failed: ${e.message}`);
  }
}

/* ────────────────────────────────────────────────────────────────────
 * Stats rendering
 * ──────────────────────────────────────────────────────────────────── */

/**
 * Called whenever a file is loaded, replaced, or transformed.
 *
 *   - Hides the "No STEP file loaded" placeholder
 *   - Stamps the file name into the header bar
 *   - Reveals the Tools toolbar
 *
 * That's it.  Detailed entity stats are intentionally NOT surfaced —
 * the status bar at the bottom of the palette covers the at-a-glance
 * counts (entities, parse time, warnings) and anything deeper lives
 * in the parser's API for programmatic use, not screen real estate.
 *
 * The function name stays `renderStats` so existing call sites
 * (handleOpen, handleNew, applyAndRefresh) keep working without churn.
 */
export function renderStats(state /* , meta */) {
  const placeholder = document.getElementById('placeholder');
  if (placeholder) placeholder.hidden = true;

  const header = document.getElementById('headerFilename');
  if (header) header.textContent = state.filename || '';

  const tools = document.getElementById('toolsSection');
  if (tools) tools.hidden = !state.parsed;
}

/** Display free-form text in the warnings band, or clear it when null. */
function showWarnings(text) {
  const el = document.getElementById('statsWarnings');
  if (!el) return;
  if (text == null) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.textContent = text;
}

/** Enable buttons that only make sense after a file is loaded. */
function enableLoadedButtons(on) {
  for (const id of ['btnSendToFusion', 'btnCloudSave']) {
    const el = document.getElementById(id);
    if (!el) continue;
    // Cloud save stays disabled when the worker URL is unset, regardless.
    if (id === 'btnCloudSave' && !isCloudEnabled()) { el.disabled = true; continue; }
    el.disabled = !on;
  }
}

/* ────────────────────────────────────────────────────────────────────
 * Small helpers
 * ──────────────────────────────────────────────────────────────────── */

function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024)             return `${n} B`;
  if (n < 1024 * 1024)      return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function microtaskTick() { return new Promise((r) => setTimeout(r, 0)); }

/* ────────────────────────────────────────────────────────────────────
 * Text tool — font picker, symbol keyboard, preview generation
 * ──────────────────────────────────────────────────────────────────── */

// Mapping from `text-glyphs.js` family names to the @font-face family
// names we declared in step-editor.css. Lets the symbol-grid buttons
// render each glyph in the right typeface. Falls back to the system
// default when an entry is missing.
const HTML_FONT_FAMILY = {
  'Cascadia Code': 'SE Cascadia Code',
  'Cascadia Mono': 'SE Cascadia Mono',
  'Wingdings':     'SE Wingdings',
  'Webdings':      'SE Webdings',
  'Symbol':        'SE Symbol',
  'Bahnschrift':   'SE Bahnschrift',
  'Impact':        'SE Impact',
  'Georgia':       'SE Georgia',
  'Verdana':       'SE Verdana',
  'Tahoma':        'SE Tahoma',
};

/** Fill the `#textFont` <select> from the static font catalogue. Called
 *  once during wireButtons. The first family becomes the default. */
function populateFontDropdown() {
  const sel = document.getElementById('textFont');
  if (!sel) return;
  sel.innerHTML = '';
  for (const f of listFonts()) {
    const opt = document.createElement('option');
    opt.value = f.file;
    opt.textContent = f.label;
    opt.dataset.family = f.family;
    sel.appendChild(opt);
  }
}

/** Toggle the symbol-picker popover. With no argument it flips the
 *  current state; pass `false` to force-close. */
function toggleSymbolPanel(show) {
  const panel = document.getElementById('textSymbolPanel');
  if (!panel) return;
  const willShow = (show === undefined) ? panel.hidden : !!show;
  panel.hidden = !willShow;
  if (willShow) populateSymbolGrid();
}

/** Fill the symbol grid with one button per ASCII printable in the
 *  current font.  For symbol fonts (Wingdings/Webdings/Symbol) those
 *  codepoints render as icons; for regular fonts they're just the
 *  ASCII alphabet — also useful as a one-click insert. */
function populateSymbolGrid() {
  const grid  = document.getElementById('textSymbolGrid');
  const label = document.getElementById('textSymbolFontLabel');
  const sel   = document.getElementById('textFont');
  if (!grid || !sel) return;

  const opt    = sel.options[sel.selectedIndex];
  const family = opt && opt.dataset.family || 'Arial';
  const htmlFam = HTML_FONT_FAMILY[family] || family;

  if (label) label.textContent = opt ? opt.textContent : family;

  grid.innerHTML = '';
  // Range: printable ASCII. Some symbol fonts only fill part of this
  // range — empty cells just render a blank button, which is fine.
  for (let code = 33; code <= 126; code++) {
    const ch  = String.fromCharCode(code);
    const btn = document.createElement('button');
    btn.type  = 'button';
    btn.title = `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
    btn.textContent = ch;
    btn.style.fontFamily = `'${htmlFam}', sans-serif`;
    btn.addEventListener('click', () => insertIntoTextInput(ch));
    grid.appendChild(btn);
  }
}

/** Append a character to the active text input. Cursor placement
 *  respects whatever the user had highlighted (replace selection). */
function insertIntoTextInput(ch) {
  const ta = document.getElementById('textInput');
  if (!ta) return;
  const start = ta.selectionStart ?? ta.value.length;
  const end   = ta.selectionEnd   ?? ta.value.length;
  const newVal = ta.value.slice(0, start) + ch + ta.value.slice(end);
  ta.value = newVal;
  ta.selectionStart = ta.selectionEnd = start + ch.length;
  ta.focus();
}

/** Parse the user's input through opentype.js, build the layout, and
 *  push the preview into the Three.js scene. Async because the font
 *  fetch + parse is non-blocking — show a status while it works. */
async function handleApplyText(/* state */) {
  const ta    = document.getElementById('textInput');
  const sel   = document.getElementById('textFont');
  const sizeI = document.getElementById('textSize');
  const depthI = document.getElementById('textDepth');
  if (!ta || !sel) { setStatus('Text panel not loaded.'); return; }

  const text  = ta.value;
  const file  = sel.value;
  const size  = Number(sizeI && sizeI.value) || 10;
  const depth = Number(depthI && depthI.value) || 0;

  if (!text.trim()) {
    clearTextPreview();
    setStatus('Text empty — preview cleared.');
    return;
  }

  setStatus(`Rendering "${text}" in ${sel.options[sel.selectedIndex]?.textContent}…`);
  await microtaskTick();

  let font;
  try {
    font = await loadFont(file);
  } catch (e) {
    setStatus(`Font load failed: ${e.message}`);
    pyLog(`text font fail: ${file}: ${e.message}`);
    return;
  }

  const t0 = performance.now();
  const layout = layoutText(text, font, { size, flatness: Math.max(size / 80, 0.05) });
  setTextPreview(layout, depth);
  const dt = performance.now() - t0;

  const w = layout.bbox.max[0] - layout.bbox.min[0];
  const h = layout.bbox.max[1] - layout.bbox.min[1];
  setStatus(`Text preview: ${layout.glyphs.length} glyph(s), ${w.toFixed(1)} × ${h.toFixed(1)} units (${dt.toFixed(0)} ms). STEP emission lands in milestone B.`);
  pyLog(`text preview: ${text.length} chars, ${layout.glyphs.length} glyphs, ${dt.toFixed(0)}ms`);
}

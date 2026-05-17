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

import { sendToPython, pyLog, isFusion } from '../core/runtime.js';
import {
  parseStep, writeStep, emptyHeader, countByType,
} from '../core/stp-parser.js';
import { isCloudEnabled, listFiles, saveFile } from '../core/cloud-sync.js';
import { sendStepToFusion } from '../core/fusion-bridge.js';
import {
  findBodies, scaleBody, scaleBodyAxes, translateBody, getBounds,
  rotateBody, mirrorBody, resizeBody, getBodyBounds, arrayBody,
} from '../core/stp-bodies.js';
import { regridBody, listBSplineSurfaces } from '../core/stp-regrid.js';
import { tessellate as occtTessellate, isAvailable as occtAvailable,
         tessellateViaFusion, isFusionTessAvailable } from '../core/occt-bridge.js';
import { attachScrubAll } from '../core/scrub.js';
import { setMeshes, highlightByName, previewByName, enableFaceSelectMode, disableFaceSelectMode, getScene } from '../core/three-viewer.js';

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

  // Transform-panel Apply buttons used to live here. They were removed
  // for every tool — every panel now drives live preview from its inputs
  // (see wireLivePreview below, plus the per-tool change wirings in
  // wireLiveExtras: Mirror runs on plane select, Resize/Regrid live-
  // scrub their fields, Text auto-re-renders on text/font/size/depth
  // change). The handleApply* functions are retained as private commit
  // primitives that the live-preview pipeline calls.
  // Pattern tool was removed from the palette entirely.

  // Regrid simplify presets: clicking a preset stamps Nu/Nv with the
  // common value, then the live-preview input listener (wireLiveExtras)
  // re-runs regrid as those fields change.
  for (const btn of document.querySelectorAll('.preset-btn[data-regrid-preset]')) {
    btn.addEventListener('click', () => {
      const n = Number(btn.dataset.regridPreset) | 0;
      const nu = document.getElementById('regridNu');
      const nv = document.getElementById('regridNv');
      if (nu) { nu.value = String(n); nu.dispatchEvent(new Event('input', { bubbles: true })); }
      if (nv) { nv.value = String(n); nv.dispatchEvent(new Event('input', { bubbles: true })); }
    });
  }

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

  // ── SVG Fill tool wiring ───────────────────────────────────────────
  // Stamp moved to its own add-in (stamp-editor). Step-editor is
  // transforms-only now.

  // ── Live preview wiring ────────────────────────────────────────────
  // Each transform input drives a delta-applier that mutates state.parsed
  // and debounce-retessellates. Baselines are reset per-tool-activation
  // in activateTool() below.
  wireLivePreview(state);
  // Mirror / Resize / Regrid / Text — no Apply button, drive their
  // commit handler off DOM events with a short debounce.
  wireLiveExtras(state);

  // ── Deselection: Esc anywhere in the palette clears the active body.
  // Use keydown on the document so it fires regardless of which input
  // currently has focus. We deliberately don't preventDefault so the
  // browser's native Esc-to-blur on a focused input still runs.
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && state.selectedBodyId != null) {
      selectBody(state, null);
    }
  });
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
  await loadStepText(state, picked.name, picked.text);
}

/**
 * Parse a STEP-text payload (already in memory) into state.parsed, populate
 * the body list, and kick a tessellation. Same effect as picking the file
 * through the dialog; exported so:
 *   - main.js can react to a 'preload_step' route from Python (used for
 *     dropping sample files in without a dialog round-trip),
 *   - tests / harnesses can drive the editor without simulating clicks.
 *
 * Returns a Promise that resolves when parsing+populate finish; tessellation
 * runs in the background after the resolve.
 *
 * @param {object} state
 * @param {string} name   filename for status + state.filename
 * @param {string} text   raw STEP text
 */
export async function loadStepText(state, name, text) {
  setStatus(`Parsing "${name}" (${formatBytes(text.length)})…`);
  await microtaskTick();

  const t0 = performance.now();
  let parsed;
  try {
    parsed = parseStep(text);
  } catch (e) {
    setStatus(`Parse failed: ${e.message}`);
    pyLog(`parse fail ${name}: ${e.message}`);
    return;
  }
  const dtMs = performance.now() - t0;

  state.filename = name;
  state.parsed   = parsed;
  state.selectedBodyId = null;
  state.originalText   = text;

  renderStats(state, { parseMs: dtMs, sourceBytes: text.length });
  populateBodyList(state);
  enableLoadedButtons(true);

  retessellate(state, text).catch((e) => {
    setStatus(`Viewer: ${e.message}`);
    pyLog(`viewer fail: ${e.message}`);
  });

  setStatus(
    `Loaded "${name}" — ${parsed.entities.size.toLocaleString()} entities, `
    + `${dtMs.toFixed(0)} ms parse, ${parsed.warnings.length} warning(s).`
  );
  pyLog(`opened ${name}: ${parsed.entities.size} entities in ${dtMs.toFixed(0)}ms`);
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
 * Reset the transform tool panel state. Called when no body is selected
 * (e.g. fresh file load with no bodies, or selection cleared). Was
 * previously a missing reference — every call site below passes `null`
 * to mean "no active body", which is the only invocation pattern in use.
 *
 * Best-effort: hide every `.tool-panel` block, drop any active
 * `.tool-btn[aria-pressed]` state, clear the per-tool body-name target.
 * Silent if the DOM nodes aren't there yet (e.g. during a hot reload
 * before the sidebar is built).
 */
function showTransformPanel(/* unused — kept for the legacy call sites */) {
  try {
    for (const panel of document.querySelectorAll('.tool-panel')) {
      panel.hidden = true;
    }
    for (const btn of document.querySelectorAll('.tool-btn[aria-pressed="true"]')) {
      btn.setAttribute('aria-pressed', 'false');
    }
    for (const t of document.querySelectorAll('.tool-target')) {
      t.textContent = '';
    }
  } catch (_) {
    // DOM not ready / element missing — non-fatal, ignore.
  }
}

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
    // Clicking the already-selected row toggles selection off. This pairs
    // with the Esc shortcut so users have a discoverable deselect path.
    li.addEventListener('click', () => {
      const next = (state.selectedBodyId === b.id) ? null : b.id;
      selectBody(state, next);
    });
    // Hover preview — soft emissive boost on the matching 3D mesh so the
    // user can see what they're about to select before committing. Clears
    // on leave; the *selected* highlight (outline + colour) overrides.
    li.addEventListener('mouseenter', () => {
      if (state.selectedBodyId !== b.id) previewByName(b.name);
    });
    li.addEventListener('mouseleave', () => previewByName(null));
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
 *  header, highlight the matching mesh in the 3D viewer, and push a
 *  compact selection summary (name + bbox size) into the status line.
 *
 *  Pass `bodyId = null` to clear the selection entirely — used by the
 *  Esc shortcut and the click-on-already-selected-row toggle. */
function selectBody(state, bodyId) {
  state.selectedBodyId = bodyId;
  const ul = document.getElementById('bodyList');
  if (ul) {
    let selectedLi = null;
    for (const li of ul.children) {
      const isSel = bodyId != null && Number(li.dataset.bodyId) === bodyId;
      li.classList.toggle('selected', isSel);
      if (isSel) selectedLi = li;
    }
    // Make sure the selected row is visible — long body lists scroll, and
    // a click-elsewhere selection (e.g. from the 3D picker) shouldn't
    // leave the user hunting for the active row.
    if (selectedLi && typeof selectedLi.scrollIntoView === 'function') {
      try { selectedLi.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      catch (_) {}
    }
  }
  const body = bodyId == null ? null : (state._bodies || []).find(b => b.id === bodyId);

  // Each tool panel has a `<span class="tool-target">` we stamp with
  // the selected body's name so the user sees what they're editing.
  for (const span of document.querySelectorAll('.tool-target')) {
    span.textContent = body ? `— ${body.name}` : '';
  }

  // Try to highlight the matching mesh in the 3D viewer by name. occt
  // names meshes from PRODUCT labels, not from MANIFOLD_SOLID_BREP /
  // SHELL_BASED_SURFACE_MODEL — they overlap often but not always.
  highlightByName(body ? body.name : null);

  // Compact selection summary into the status line. Done last so it
  // doesn't get clobbered by transient retessellate messages.
  if (body && state.parsed) {
    try {
      const bb = getBodyBounds(state.parsed, body.id);
      if (bb) {
        // getBodyBounds returns file units (which can mean inches even
        // when the header declares mm — see retessellate's unitScale
        // capture). Multiply through so the displayed mm match
        // Fusion's imported physical size.
        const scale = Number.isFinite(state.unitScale) ? state.unitScale : 1;
        const w = Math.round(bb.size[0] * scale);
        const h = Math.round(bb.size[1] * scale);
        const d = Math.round(bb.size[2] * scale);
        setStatus(`◆ Selected: ${body.name} — ${w} × ${h} × ${d} mm`);
      } else {
        setStatus(`◆ Selected: ${body.name}`);
      }
    } catch (_) {
      setStatus(`◆ Selected: ${body.name}`);
    }
  }

  // Refresh the Resize panel's "Current:" line so the user sees the
  // body's current dimensions before they type a target.
  updateResizeCurrent(state);

  // Refresh the Regrid surface dropdown so it lists this body's
  // B-spline surfaces.  Empty (no surfaces) collapses to the
  // "All surfaces" entry only.
  populateRegridSurfaces(state);

  // Note: an earlier version of this function ended with a redundant
  // setStatus('Selected body "Body1".') here, which clobbered the
  // richer "◆ Selected: name — W×H×D mm" message we set above. Removed.
  if (!body) setStatus('Body selection cleared.');
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

  // Newly-revealed panels may contain <input type="number"> elements that
  // haven't been seen yet — wire drag-to-scrub on them now. attachScrubAll
  // is idempotent so it's safe to call every time.
  attachScrubAll(document);

  // Re-anchor live-preview baselines so the current input values become
  // the new "unit" point. Without this the next scrub of e.g. xformUniform
  // (which still shows 1.0 after we last left it at 1.5) would treat
  // 1.0→1.2 as a 1.2× delta from 1.5, doubling-up the scale.
  resetLiveBaselines(state);
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
// case 'pattern' — Pattern tool removed (linear-array semantic unhelpful).
    //   The patternSection HTML is gone; this branch left commented as a
    //   marker so the dispatcher's structure is still readable.
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

/* ────────────────────────────────────────────────────────────────────
 * Live preview — scrub a number input and see the model update without
 * clicking Apply. Each input is bound to a delta-applier: it reads the
 * current value, compares to `state.lastApplied[inputId]`, computes the
 * delta (ratio for scale, difference for translate/rotate), applies it
 * in place to state.parsed, and debounces a retessellate.
 *
 * Baseline is reset every time a tool panel opens — see activateTool —
 * so the user always knows what "1.0 / 0.0" means in the current panel.
 * ──────────────────────────────────────────────────────────────────── */

const LIVE_RETESS_DEBOUNCE_MS = 180;
let _liveRetessTimer = null;

/** Debounced retessellate for live preview — coalesces a burst of scrub
 *  events into a single re-tessellation.
 *
 *  IMPORTANT: forces the WASM/OCCT path (`forceWasm: true`) so each scrub
 *  doesn't pop a temp document open in Fusion's main canvas. The
 *  Fusion-native path stays for the initial file load and any explicit
 *  Apply, where the doc-switch cost is paid once and the speedup is real.
 *
 *  Trade-off: WASM is slower per call (1–3 s on a 14 MB STEP), so on
 *  very large files the preview will lag a frame or two. For scale-of-a-
 *  rectangle workloads it feels instant. A future iteration could
 *  bypass tessellation entirely during scrub by transforming the Three.js
 *  buffer-geometry in place — sufficient for affine transforms, but a
 *  bigger refactor than we want right now. */
function retessellateLive(state) {
  clearTimeout(_liveRetessTimer);
  _liveRetessTimer = setTimeout(() => {
    retessellate(state, null, { forceWasm: true })
      .catch((e) => setStatus(`Preview: ${e.message}`));
  }, LIVE_RETESS_DEBOUNCE_MS);
}

/** Bind delta-style live preview to a single number input.
 *
 * @param {object} state
 * @param {string} inputId          DOM element id of the <input type="number">
 * @param {'mul'|'add'} kind        'mul' for scale (delta = cur/last),
 *                                  'add' for translate/rotate (delta = cur-last)
 * @param {(s:object, delta:number)=>void} applyDelta
 *     Mutates state.parsed in place with the supplied delta. Caller is
 *     responsible for the bodyId / axis lookups.
 */
function bindLivePreview(state, inputId, kind, applyDelta) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const ident = kind === 'mul' ? 1 : 0;
  state.lastApplied = state.lastApplied || {};
  if (state.lastApplied[inputId] === undefined) {
    state.lastApplied[inputId] = parseFloat(input.value) || ident;
  }
  input.addEventListener('input', () => {
    if (!state.parsed || !state.selectedBodyId) return;
    const cur  = parseFloat(input.value);
    if (!Number.isFinite(cur)) return;
    const last = state.lastApplied[inputId] ?? ident;
    const delta = kind === 'mul' ? (cur / last) : (cur - last);
    const isNoOp = kind === 'mul' ? Math.abs(delta - 1) < 1e-9 : Math.abs(delta) < 1e-9;
    if (isNoOp) return;
    try {
      applyDelta(state, delta);
    } catch (e) {
      setStatus(`Preview failed: ${e.message}`);
      return;
    }
    state.lastApplied[inputId] = cur;
    retessellateLive(state);
  });
}

/** Reset every tool's baseline tracking to the current values shown in
 *  the inputs. Called by activateTool so each newly-opened tool's
 *  baseline is anchored at whatever's in the field at that moment. */
function resetLiveBaselines(state) {
  state.lastApplied = state.lastApplied || {};
  const ids = [
    'xformUniform', 'xformSX', 'xformSY', 'xformSZ',
    'xformTX', 'xformTY', 'xformTZ',
    'rotateAngle',
  ];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    const v = parseFloat(el.value);
    state.lastApplied[id] = Number.isFinite(v) ? v : (id === 'xformUniform' || id.startsWith('xformS') ? 1 : 0);
  }
}

/** Install live-preview listeners on every supported tool input.
 *  Called once during boot. */
function wireLivePreview(state) {
  // Scale — uniform and per-axis. Multiplicative delta.
  bindLivePreview(state, 'xformUniform', 'mul', (s, k) =>
    scaleBody(s.parsed, s.selectedBodyId, k));
  bindLivePreview(state, 'xformSX', 'mul', (s, k) =>
    scaleBodyAxes(s.parsed, s.selectedBodyId, { x: k, y: 1, z: 1 }));
  bindLivePreview(state, 'xformSY', 'mul', (s, k) =>
    scaleBodyAxes(s.parsed, s.selectedBodyId, { x: 1, y: k, z: 1 }));
  bindLivePreview(state, 'xformSZ', 'mul', (s, k) =>
    scaleBodyAxes(s.parsed, s.selectedBodyId, { x: 1, y: 1, z: k }));
  // Translate — additive delta on a single axis at a time.
  bindLivePreview(state, 'xformTX', 'add', (s, d) =>
    translateBody(s.parsed, s.selectedBodyId, { x: d, y: 0, z: 0 }));
  bindLivePreview(state, 'xformTY', 'add', (s, d) =>
    translateBody(s.parsed, s.selectedBodyId, { x: 0, y: d, z: 0 }));
  bindLivePreview(state, 'xformTZ', 'add', (s, d) =>
    translateBody(s.parsed, s.selectedBodyId, { x: 0, y: 0, z: d }));
  // Rotate — additive degrees around the currently-selected axis.
  bindLivePreview(state, 'rotateAngle', 'add', (s, dDeg) => {
    const axis = (document.getElementById('rotateAxis') || {}).value || 'z';
    rotateBody(s.parsed, s.selectedBodyId, axis, dDeg);
  });
}


/** Live-preview wiring for the panels that don't use the delta-based
 *  scrub pattern (Scale/Move/Rotate). Each of these tools either has a
 *  discrete trigger (Mirror's plane select) or absolute-value inputs
 *  (Resize target dims, Regrid Nu/Nv, Text string/size). They reuse
 *  the existing handleApply* commit functions; the only thing this
 *  function adds is a DOM-event → debounced-commit wiring. */
function wireLiveExtras(state) {
  // ── Mirror: re-run on plane select ────────────────────────────────
  // The plane dropdown starts on an empty option so the very first
  // tool-panel open doesn't immediately mirror. Pick a plane and the
  // mirror fires. Picking the same plane twice un-mirrors (Fusion's
  // mirror is involutive). Selecting the empty option is a no-op.
  const mirrorSelect = document.getElementById('mirrorPlane');
  if (mirrorSelect) {
    mirrorSelect.addEventListener('change', () => {
      if (!mirrorSelect.value) return;
      handleApplyMirror(state);
    });
  }

  // ── Resize: live-scrub W/H/D inputs ───────────────────────────────
  // Resize is an ABSOLUTE-value op (target bbox dimension), not a
  // delta. To keep live preview sane:
  //   - on first input event, snapshot the body's pre-resize bbox into
  //     state.resizeBaseline (a dict per body id).
  //   - each move resets state.parsed from the baseline (re-resize at
  //     the new target) so successive scrubs don't compound.
  //
  // We don't have a cheap "restore body shape" primitive, so the easier
  // path: call handleApplyResize on a short debounce — it reads the
  // current input values and resizes the body to them. The body's stored
  // bbox in state.parsed gets larger on each call, but resizeBody scales
  // to ABSOLUTE target — so the second call is "resize-to-100" rather
  // than "double-then-double" so it works correctly.
  const debounce = (fn, ms) => {
    let t = null;
    return () => {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  };
  for (const id of ('resizeX resizeY resizeZ').split(' ')) {
    const el = document.getElementById(id);
    if (!el) continue;
    const trigger = debounce(() => handleApplyResize(state), 220);
    el.addEventListener('input', trigger);
  }

  // ── Regrid: live-run on Nu/Nv/Smp/surface/knot change ─────────────
  // Heavier op (B-spline least-squares fit) so we debounce more.
  const regridIds = ['regridNu', 'regridNv', 'regridSample', 'regridSurface', 'regridKnotMode'];
  const regridTrigger = debounce(() => handleApplyRegrid(state), 350);
  for (const id of regridIds) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('input',  regridTrigger);
    el.addEventListener('change', regridTrigger);
  }
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
async function retessellate(state, sourceText, options = {}) {
  // `forceWasm` skips the Fusion-native path. Used by live preview to
  // avoid opening/closing a temp document on every scrub move (which
  // briefly flashes the main Fusion canvas). The Fusion-native path
  // stays for initial file load + Apply, where the doc-switch is paid
  // once and the speedup is real.
  const fusionFast = !options.forceWasm && isFusionTessAvailable();
  pyLog(`retessellate: fusionFast=${fusionFast}, occtAvailable=${occtAvailable()}, hasParsed=${!!state.parsed}`);

  // Bail only when BOTH paths are unavailable (e.g. standalone web page
  // that failed to load the WASM module).
  if (!fusionFast && !occtAvailable()) {
    setStatus('Viewer disabled — neither Fusion bridge nor occt-import-js available.');
    pyLog('retessellate: no tessellator available');
    return;
  }

  setStatus('Tessellating geometry…');
  await microtaskTick();

  const text = sourceText != null ? sourceText : writeStep(state.parsed);
  pyLog(`retessellate: payload ${text.length} bytes, path=${fusionFast ? 'fusion-native' : 'wasm-occt'}`);

  const t0 = performance.now();
  let result;
  try {
    if (fusionFast) {
      result = await tessellateViaFusion(text, ({ msg }) => setStatus(msg));
      // Fall back to WASM if the Fusion path failed (e.g. Python add-in
      // not running, or temp-doc import threw for this particular STEP).
      if (!result.success && occtAvailable()) {
        pyLog(`fusion-native failed: ${result.message} — falling back to WASM`);
        setStatus(`Fusion path failed (${result.message}). Falling back to WASM…`);
        await microtaskTick();
        result = await occtTessellate(text);
      }
    } else {
      result = await occtTessellate(text);
    }
  } catch (e) {
    setStatus(`Tessellation failed: ${e.message}`);
    pyLog(`tessellate threw: ${e.message}`);
    return;
  }
  const dt = performance.now() - t0;

  if (!result.success) {
    setStatus(`Tessellation failed: ${result.message || 'unknown'}`);
    pyLog(`tessellate unsuccess: ${result.message || 'unknown'}`);
    return;
  }

  setMeshes(result.meshes);
  const sel = state._bodies?.find(b => b.id === state.selectedBodyId);
  if (sel) highlightByName(sel.name);

  const pathLabel = fusionFast ? 'Fusion native' : 'WASM OCCT';
  setStatus(`Viewer: ${result.meshes.length} mesh(es) tessellated in ${dt.toFixed(0)} ms (${pathLabel}).`);
  pyLog(`tessellate ok: ${result.meshes.length} meshes in ${dt.toFixed(0)}ms via ${pathLabel}`);

  // Compute the file-unit → physical-mm scale by comparing the parsed
  // STEP's body bbox (file units) to the tessellated mesh's bbox
  // (already in mm — Fusion-native delivers mm, WASM-OCCT likewise).
  // Stamp / V-carve / future tools use state.unitScale to ship their
  // mesh in physical mm regardless of whether the file was authored
  // in inches but declared mm (or any similar mismatch).
  state.unitScale = computeFileToPhysicalScale(state, result.meshes);
  pyLog(`unit scale (file → physical mm) = ${state.unitScale.toFixed(4)}`);

  // ── CustomGraphics ghost preview in Fusion's main canvas ──────────
  // After every retessellate, also push the merged mesh to Python so it
  // can draw a transient CustomGraphics group on the active design's
  // root component. Mirrors b-spline-gen — gives the user a preview in
  // Fusion's canvas without creating real BRep until Send-to-Fusion.
  // Skipped when not in Fusion (standalone web build).
  try {
    if (typeof sendToPython === 'function') sendPreviewMeshToFusion(result.meshes);
  } catch (e) {
    pyLog(`preview_mesh push failed: ${e.message}`);
  }
}

/* Merge all visible meshes into one flat verts+indices payload and ship
 * it as a `preview_mesh` action. Heavy meshes are dropped — a million
 * triangles through sendToPython would jam the bridge. Mesh positions
 * are in millimetres (Three.js scene units); CustomGraphicsCoordinates
 * expects centimetres (Fusion internal), so we divide by 10. */
function sendPreviewMeshToFusion(meshes) {
  if (!meshes || !meshes.length) {
    sendToPython('preview_clear', {});
    return;
  }
  const MM_TO_CM = 0.1;
  const MAX_TRIS_FOR_PREVIEW = 80000;   // ~240 K verts × 8 bytes = 2 MB, well under the bridge ceiling
  const verts = [];
  const indices = [];
  const normals = [];
  let totalTris = 0;
  let vertOffset = 0;
  for (const m of meshes) {
    if (!m || !m.position || !m.index) continue;
    totalTris += m.index.length / 3;
    if (totalTris > MAX_TRIS_FOR_PREVIEW) {
      pyLog(`preview_mesh: skipping remaining meshes (>${MAX_TRIS_FOR_PREVIEW} tris cap)`);
      break;
    }
    const vcount = m.position.length / 3;
    for (let i = 0; i < m.position.length; i++) verts.push(m.position[i] * MM_TO_CM);
    if (m.normal && m.normal.length === m.position.length) {
      for (let i = 0; i < m.normal.length; i++) normals.push(m.normal[i]);
    }
    for (let i = 0; i < m.index.length; i++) indices.push(m.index[i] + vertOffset);
    vertOffset += vcount;
  }
  sendToPython('preview_mesh', { verts, indices, normals });
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


/* ────────────────────────────────────────────────────────────────────
 * Pattern tool
 * ──────────────────────────────────────────────────────────────────── */

async function handleApplyPattern(state) {
  if (!requireSelectedBody(state)) return;

  const axis    = (document.getElementById('patternAxis')    || {}).value || 'z';
  const count   = readNumber('patternCount', 3) | 0;
  const spacing = readNumber('patternSpacing', 50);

  if (count < 2) { setStatus('Count must be ≥ 2.'); return; }
  if (spacing === 0) { setStatus('Spacing must be non-zero.'); return; }

  const bodyName = currentBodyName(state);

  setStatus(`Arraying "${bodyName}" × ${count} along ${axis.toUpperCase()} at ${spacing} mm…`);
  await microtaskTick();

  const t0 = performance.now();
  try {
    arrayBody(state.parsed, bodyName, axis, count, spacing);
  } catch (e) {
    setStatus(`Pattern failed: ${e.message}`);
    return;
  }
  const dt = performance.now() - t0;

  renderStats(state, { parseMs: 0, sourceBytes: state.parsed.rawText.length });
  populateBodyList(state);
  setStatus(`Pattern: ${count} copies of "${bodyName}" along ${axis.toUpperCase()}, spacing ${spacing} mm (${dt.toFixed(0)} ms).`);
  pyLog(`pattern: ${count} copies along ${axis} spacing ${spacing}`);

  retessellate(state, null).catch((e) => {
    setStatus(`Viewer refresh failed: ${e.message}`);
  });
}

/* Stamp tool & legacy SVG-fill removed — both moved to the new
 * stamp-editor add-in (sibling under bspline-frame-builder/).
 * Step-editor is transforms-only from here on. */



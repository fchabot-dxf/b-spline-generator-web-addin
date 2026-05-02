// cloud-project-manager.js — fullscreen Project Manager panel backed by
// Cloudflare Worker KV. Replaces both preset-manager.js (localStorage)
// and cloud-preset-manager.js (inline cloud UI).
//
// Terminology: "projects" everywhere (was "presets").
//
// API (Worker at window.BSPLINE_PRESETS_API_URL):
//   GET    /projects              -> { names: [...] }
//   GET    /projects/:name        -> snapshot JSON
//   PUT    /projects/:name        -> save snapshot
//   DELETE /projects/:name        -> delete
//
// One-time localStorage migration: on first open, if localStorage contains
// 'splineGenPresets' (old local preset store), offers to upload them to cloud.
// Marks completion with 'splineGenProjectsMigrated' so the prompt never repeats.

import { P, preDelta, postDelta, extraThickenThinMask } from '../core/state.js';
import { COORD_SYSTEM } from '../core/coords.js';
import { applySnapshot } from './snapshot-manager.js';

// ─── Config ───────────────────────────────────────────────────────────────────
function getApiUrl() {
  const url = (typeof window !== 'undefined' && window.BSPLINE_PRESETS_API_URL) || null;
  return url ? url.replace(/\/+$/, '') : null;
}

// ─── Snapshot helpers (same logic as the old managers) ────────────────────────
function buildSnapshot() {
  const cleanLayers = (P.stampLayers || []).map((L) => ({ ...L, mask: null }));
  const cleanP = { ...P, stampLayers: cleanLayers };
  if (cleanP.points && Array.isArray(cleanP.points)) {
    cleanP.points = cleanP.points.map((pt) => {
      const phys = COORD_SYSTEM.toPhysical(pt[0], pt[1]);
      return [phys.x, phys.y];
    });
  }
  return {
    P: cleanP,
    preDelta:             preDelta             ? Array.from(preDelta)             : null,
    postDelta:            postDelta            ? Array.from(postDelta)            : null,
    extraThickenThinMask: extraThickenThinMask ? Array.from(extraThickenThinMask) : null,
  };
}

function unpackPoints(snap) {
  if (snap?.P && Array.isArray(snap.P.points)) {
    snap.P.points = snap.P.points.map((pt) => {
      const ui = COORD_SYSTEM.toUI(pt[0], pt[1]);
      return [ui.x, ui.y];
    });
  }
  return snap;
}

// ─── Module state ─────────────────────────────────────────────────────────────
let _preview  = null;
let _API_URL  = null;
let _projects = [];    // sorted list from last fetch
let _selected = null;  // currently highlighted project name

// DOM refs (populated once the modal is first opened)
let _modal, _fmList, _fmSearch, _fmName;
let _btnSave, _btnLoad, _btnRename, _btnDelete;
let _statusEl, _msgEl;
let _listenersWired = false;  // guard so we only wire listener once per modal

// ─── Public entry point ───────────────────────────────────────────────────────
export function bindProjectManager(preview) {
  _preview = preview;
  _API_URL  = getApiUrl();

  if (!_API_URL) {
    console.info('[project-manager] BSPLINE_PRESETS_API_URL not set — cloud disabled');
  }

  // Wire all trigger buttons (navbar + any data-attr ones in sidebar)
  document.querySelectorAll('#btnOpenProjectManager, [data-open-projects]')
    .forEach((el) => el.addEventListener('click', openModal));

  // Globals used by inline onclick in rendered list items (set once here)
  window._pmSelect = selectProject;
  window._pmLoad   = (name) => { selectProject(name); onLoad(name); };
}

// ─── Open / Close ─────────────────────────────────────────────────────────────
function openModal() {
  _modal = document.getElementById('projectManagerModal');
  if (!_modal) { console.warn('[project-manager] #projectManagerModal not found'); return; }

  _modal.style.display = 'flex';
  _modal.setAttribute('aria-hidden', 'false');

  grabDomRefs();
  wireModalListeners();

  // Migration check first, then refresh the list
  checkMigration().then(() => refreshList());

  // Focus search for keyboard navigation
  setTimeout(() => _fmSearch?.focus(), 50);
}

function closeModal() {
  if (_modal) {
    _modal.style.display = 'none';
    _modal.setAttribute('aria-hidden', 'true');
  }
  document.removeEventListener('keydown', onModalKey);
}

function grabDomRefs() {
  _fmList    = document.getElementById('fmProjectList');
  _fmSearch  = document.getElementById('fmProjectSearch');
  _fmName    = document.getElementById('fmProjectName');
  _btnSave   = document.getElementById('fmBtnSave');
  _btnLoad   = document.getElementById('fmBtnLoad');
  _btnRename = document.getElementById('fmBtnRename');
  _btnDelete = document.getElementById('fmBtnDelete');
  _statusEl  = document.getElementById('fmProjectStatus');
  _msgEl     = document.getElementById('fmProjectMsg');
}

function wireModalListeners() {
  // ESC handler re-registered on every open (it removes itself on close)
  document.addEventListener('keydown', onModalKey);

  if (_listenersWired) return; // all other listeners wired only once
  _listenersWired = true;

  document.getElementById('fmCloseBtn')?.addEventListener('click', closeModal);
  _modal.addEventListener('click', (e) => { if (e.target === _modal) closeModal(); });

  _fmSearch?.addEventListener('input', renderList);

  _btnSave?.addEventListener('click',   onSave);
  _btnLoad?.addEventListener('click',   () => onLoad(_selected));
  _btnRename?.addEventListener('click', onRename);
  _btnDelete?.addEventListener('click', onDelete);
}

function onModalKey(e) {
  if (e.key === 'Escape') { closeModal(); return; }
  // Enter on a selected item (but not when typing in the name field) = load
  if (e.key === 'Enter' && _selected && document.activeElement !== _fmName) {
    e.preventDefault();
    onLoad(_selected);
  }
}

// ─── Project list ─────────────────────────────────────────────────────────────
async function refreshList() {
  if (!_API_URL) {
    setStatus('⚠ No API configured');
    _projects = [];
    renderList();
    return;
  }
  setStatus('Loading…');
  try {
    const r = await fetch(`${_API_URL}/projects`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    _projects = (data.names || []).slice().sort((a, b) => a.localeCompare(b));
    setStatus(`${_projects.length} project${_projects.length !== 1 ? 's' : ''}`);
  } catch (e) {
    console.warn('[project-manager] list failed:', e);
    _projects = [];
    setStatus('⚠ Offline — check connection');
  }
  renderList();
}

function renderList() {
  if (!_fmList) return;
  const q     = (_fmSearch?.value || '').toLowerCase().trim();
  const items = _projects.filter((n) => !q || n.toLowerCase().includes(q));

  if (!items.length) {
    _fmList.innerHTML = `<div style="padding:24px 12px; color:#bbb; font-size:12px; text-align:center;">
      ${_projects.length === 0 ? 'No projects saved yet' : 'No matches for "' + escapeText(q) + '"'}
    </div>`;
    return;
  }

  _fmList.innerHTML = items.map((n) => {
    const sel = n === _selected;
    const ea  = escapeAttr(n);
    const et  = escapeText(n);
    return `<div class="fm-project-item${sel ? ' fm-selected' : ''}"
        role="option" aria-selected="${sel}"
        data-name="${ea}"
        onclick="window._pmSelect(${JSON.stringify(n)})"
        ondblclick="window._pmLoad(${JSON.stringify(n)})"
        title="${ea}">${et}</div>`;
  }).join('');
}

function selectProject(name) {
  _selected = name;
  // Only auto-fill name field if user hasn't started typing something custom
  if (_fmName && !_fmName.dataset.pmDirty) _fmName.value = name;
  updateButtons();
  renderList();
}

function updateButtons() {
  const has = !!_selected;
  if (_btnLoad)   _btnLoad.disabled   = !has;
  if (_btnRename) _btnRename.disabled = !has;
  if (_btnDelete) _btnDelete.disabled = !has;
}

// ─── Save ─────────────────────────────────────────────────────────────────────
async function onSave() {
  const name = (_fmName?.value || '').trim();
  if (!name)     { setMsg('Enter a project name first.', 'warn'); return; }
  if (!_API_URL) { setMsg('No cloud API configured.', 'warn'); return; }

  _btnSave.disabled = true;
  setMsg('Saving…');
  try {
    const r = await fetch(`${_API_URL}/projects/${encodeURIComponent(name)}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(buildSnapshot()),
    });
    if (!r.ok) throw new Error((await safeJson(r)).error || `HTTP ${r.status}`);
    setMsg(`✓ Saved "${name}"`, 'ok');
    await refreshList();
    _selected = name;
    updateButtons();
    renderList();
  } catch (e) {
    setMsg(`Save failed: ${e.message}`, 'error');
  } finally {
    if (_btnSave) _btnSave.disabled = false;
  }
}

// ─── Load ─────────────────────────────────────────────────────────────────────
async function onLoad(name) {
  if (!name)     return;
  if (!_API_URL) { setMsg('No cloud API configured.', 'warn'); return; }

  setMsg('Loading…');
  try {
    const r    = await fetch(`${_API_URL}/projects/${encodeURIComponent(name)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const snap = await r.json();
    applySnapshot(unpackPoints(snap), _preview);
    setMsg(`✓ Loaded "${name}"`, 'ok');
    setTimeout(closeModal, 400);
  } catch (e) {
    setMsg(`Load failed: ${e.message}`, 'error');
  }
}

// ─── Rename ───────────────────────────────────────────────────────────────────
async function onRename() {
  if (!_selected) return;
  const newName = (_fmName?.value || '').trim();
  if (!newName || newName === _selected) { setMsg('Enter a different name to rename.', 'warn'); return; }
  if (!_API_URL)                         { setMsg('No cloud API configured.', 'warn'); return; }

  setMsg('Renaming…');
  try {
    // Read old → write new → delete old
    const r1 = await fetch(`${_API_URL}/projects/${encodeURIComponent(_selected)}`);
    if (!r1.ok) throw new Error(`HTTP ${r1.status}`);
    const body = await r1.text();

    const r2 = await fetch(`${_API_URL}/projects/${encodeURIComponent(newName)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body,
    });
    if (!r2.ok) throw new Error(`HTTP ${r2.status}`);

    await fetch(`${_API_URL}/projects/${encodeURIComponent(_selected)}`, { method: 'DELETE' });

    setMsg(`✓ Renamed to "${newName}"`, 'ok');
    _selected = newName;
    if (_fmName) delete _fmName.dataset.pmDirty;
    await refreshList();
    updateButtons();
    renderList();
  } catch (e) {
    setMsg(`Rename failed: ${e.message}`, 'error');
  }
}

// ─── Delete ───────────────────────────────────────────────────────────────────
async function onDelete() {
  if (!_selected) return;
  if (!confirm(`Delete project "${_selected}"?\nThis cannot be undone.`)) return;
  if (!_API_URL) { setMsg('No cloud API configured.', 'warn'); return; }

  setMsg('Deleting…');
  try {
    const r = await fetch(`${_API_URL}/projects/${encodeURIComponent(_selected)}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setMsg(`✓ Deleted "${_selected}"`, 'ok');
    _selected = null;
    if (_fmName) { _fmName.value = ''; delete _fmName.dataset.pmDirty; }
    await refreshList();
    updateButtons();
  } catch (e) {
    setMsg(`Delete failed: ${e.message}`, 'error');
  }
}

// ─── One-time localStorage → cloud migration ──────────────────────────────────
async function checkMigration() {
  if (localStorage.getItem('splineGenProjectsMigrated')) return;

  let store = null;
  try { store = JSON.parse(localStorage.getItem('splineGenPresets') || 'null'); } catch { /* ignore */ }

  // No old data — just mark as done
  if (!store || !Object.keys(store).length) {
    localStorage.setItem('splineGenProjectsMigrated', '1');
    return;
  }

  const names  = Object.keys(store);
  const plural = names.length !== 1;
  if (!confirm(
    `Found ${names.length} local project${plural ? 's' : ''} saved in this browser:\n` +
    `  ${names.join(', ')}\n\n` +
    `Migrate ${plural ? 'them' : 'it'} to the cloud now?`
  )) {
    localStorage.setItem('splineGenProjectsMigrated', '1');
    return;
  }

  if (!_API_URL) {
    setMsg('No API URL — cannot migrate. Configure BSPLINE_PRESETS_API_URL first.', 'warn');
    localStorage.setItem('splineGenProjectsMigrated', '1');
    return;
  }

  setMsg('Migrating local projects to cloud…');
  let ok = 0, fail = 0;
  for (const [name, snap] of Object.entries(store)) {
    try {
      const r = await fetch(`${_API_URL}/projects/${encodeURIComponent(name)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snap),
      });
      r.ok ? ok++ : fail++;
    } catch { fail++; }
  }

  localStorage.removeItem('splineGenPresets');
  localStorage.setItem('splineGenProjectsMigrated', '1');
  setMsg(
    `Migration done: ${ok} uploaded${fail ? `, ${fail} failed` : ''}.`,
    ok > 0 ? 'ok' : 'warn'
  );
}

// ─── Tiny helpers ─────────────────────────────────────────────────────────────
function setStatus(text) { if (_statusEl) _statusEl.textContent = text; }

function setMsg(text, type = '') {
  if (!_msgEl) return;
  _msgEl.textContent  = text;
  _msgEl.style.color  = { ok: '#2a7', warn: '#a60', error: '#c00' }[type] || '#666';
  if (type === 'ok') setTimeout(() => { if (_msgEl?.textContent === text) _msgEl.textContent = ''; }, 3000);
}

async function safeJson(r) { try { return await r.json(); } catch { return {}; } }

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

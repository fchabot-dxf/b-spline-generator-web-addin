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

/**
 * Capture a small JPEG of the current Three.js viewport for use as a
 * project thumbnail. Synchronously triggers a fresh render so the WebGL
 * buffer has content (the renderer is created without
 * preserveDrawingBuffer, so we must read in the same execution as the
 * render call). Downscales to 256×192 to keep the data URL ~15-30 KB.
 * Returns a data URL string, or null if anything goes wrong (capture is
 * non-essential — never block a save because of it).
 */
function captureThumbnail(preview, w = 256, h = 192, quality = 0.7) {
  try {
    if (!preview || !preview._renderer || !preview._scene || !preview._camera) {
      return null;
    }
    // Force a fresh render so the canvas has a current frame.
    preview._renderer.render(preview._scene, preview._camera);
    const src = preview._renderer.domElement;
    if (!src || !src.width || !src.height) return null;

    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const ctx = off.getContext('2d');
    // White background so transparent corners don't bleed black on dark UI
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0, w, h);
    return off.toDataURL('image/jpeg', quality);
  } catch (err) {
    console.warn('[project-manager] thumbnail capture failed:', err);
    return null;
  }
}

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
    thumbnail:            captureThumbnail(_preview),
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
// _projects: array of { name, savedAt?, size? } sorted by name. The `name`
// is the FULL slash-separated path ("MyFolder/Sub/Project1"). Folder
// hierarchy is virtual — derived from the path, not stored separately.
let _projects = [];
let _selected = null;        // currently highlighted full project path
let _selectedKind = null;    // 'project' | 'folder' | null
let _currentFolder = '';     // '' = root, otherwise 'A/B/C' (no trailing slash)

// _currentFile: the project the current editing session is "associated with"
// — set after a successful Save or Load. Save button silently overwrites
// this; Save As… always prompts for a new name. Cleared on delete of the
// matching project; rewritten on rename. Mirrors how every desktop app
// distinguishes Save (Ctrl+S) from Save As (Ctrl+Shift+S).
let _currentFile = null;
const CURFILE_LS_KEY = 'splineGenProjectMgrCurrentFile';
let _viewMode = 'tiles';     // 'tiles' | 'list' (persisted in localStorage)
const VIEW_LS_KEY = 'splineGenProjectMgrView';

// _virtualFolders: explicit folder paths created via "New Folder" before
// any project lives in them. Persisted in localStorage so they survive
// reloads. Removed when the folder becomes non-empty (project saved into
// it makes the folder real) or when the user deletes the empty folder.
let _virtualFolders = new Set();
const VFOLDERS_LS_KEY = 'splineGenProjectMgrEmptyFolders';

// _metaCache: full snapshot metadata fetched lazily for list-view columns
// (and tile thumbnails). Keyed by full project path. Each entry is
// { thumbnail, sizeBytes, stockW, stockH, resolution, noiseType, hasStamps }
// or { error: true } if the fetch failed (so we don't retry indefinitely).
const _metaCache = new Map();
let _metaIO = null;  // IntersectionObserver, lazily created

// DOM refs (populated once the modal is first opened)
let _modal, _fmList, _fmName;
let _btnSave, _btnSaveAs, _btnLoad, _btnRename, _btnDelete, _btnNewFolder;
let _viewBtnTiles, _viewBtnList;
let _breadcrumbEl, _selbarInfoEl;
let _statusEl, _msgEl;
let _listenersWired = false;  // guard so we only wire listener once per modal

// ─── Public entry point ───────────────────────────────────────────────────────
export function bindProjectManager(preview) {
  _preview = preview;
  _API_URL  = getApiUrl();

  // Restore persisted view mode + virtual folders + current file association.
  try {
    const v = localStorage.getItem(VIEW_LS_KEY);
    if (v === 'tiles' || v === 'list') _viewMode = v;
    const f = JSON.parse(localStorage.getItem(VFOLDERS_LS_KEY) || '[]');
    if (Array.isArray(f)) _virtualFolders = new Set(f);
    const cf = localStorage.getItem(CURFILE_LS_KEY);
    if (cf) _currentFile = cf;
  } catch { /* corrupted prefs — ignore */ }

  if (!_API_URL) {
    console.info('[project-manager] BSPLINE_PRESETS_API_URL not set — cloud disabled');
  }

  // Wire all trigger buttons (navbar + any data-attr ones in sidebar)
  document.querySelectorAll('#btnOpenProjectManager, [data-open-projects]')
    .forEach((el) => el.addEventListener('click', openModal));

  // Navbar quick-save button: silent overwrite if a file is associated,
  // otherwise opens the modal and starts a Save As prompt.
  const btnQuickSave = document.getElementById('btnQuickSave');
  if (btnQuickSave) {
    btnQuickSave.addEventListener('click', () => quickSave());
    // Initial label reflects the restored _currentFile (if any)
    updateNavbarSaveLabel();
  }

  // Wire Ctrl+S / Cmd+S anywhere in the app for the same behavior.
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && !e.shiftKey) {
      e.preventDefault();
      quickSave();
    }
  });
}

function updateNavbarSaveLabel() {
  const labelEl = document.getElementById('btnQuickSaveLabel');
  const btn     = document.getElementById('btnQuickSave');
  if (!labelEl || !btn) return;
  if (_currentFile) {
    labelEl.textContent = _currentFile;
    btn.title = `Save (overwrite "${_currentFile}") · Ctrl+S`;
  } else {
    labelEl.textContent = 'Save…';
    btn.title = 'No file associated yet — click to choose a name';
  }
}

// ─── Open / Close ─────────────────────────────────────────────────────────────
function openModal() {
  _modal = document.getElementById('projectManagerModal');
  if (!_modal) { console.warn('[project-manager] #projectManagerModal not found'); return; }

  _modal.style.display = 'flex';
  _modal.setAttribute('aria-hidden', 'false');

  grabDomRefs();
  wireModalListeners();
  applyViewModeToToggle();
  renderBreadcrumb();
  setSelbarInfo();
  // Refresh the modal save-button label + the (optional) header file
  // indicator so they reflect the persisted _currentFile on first open.
  updateSaveButtonLabel();
  updateHeaderFileIndicator();

  // Migration check first, then refresh the list
  checkMigration().then(() => refreshList());
}

function closeModal() {
  if (_modal) {
    // Blur any descendant that still has focus before marking the modal
    // hidden from assistive tech — otherwise the browser warns that a
    // focused element is being hidden via aria-hidden on an ancestor.
    if (_modal.contains(document.activeElement) && document.activeElement.blur) {
      document.activeElement.blur();
    }
    _modal.style.display = 'none';
    _modal.setAttribute('aria-hidden', 'true');
  }
  document.removeEventListener('keydown', onModalKey);
}

function grabDomRefs() {
  _fmList         = document.getElementById('fmProjectList');
  _fmName         = document.getElementById('fmProjectName');
  _btnSave        = document.getElementById('fmBtnSave');
  _btnSaveAs      = document.getElementById('fmBtnSaveAs');
  _btnLoad        = document.getElementById('fmBtnLoad');
  _btnRename      = document.getElementById('fmBtnRename');
  _btnDelete      = document.getElementById('fmBtnDelete');
  _btnNewFolder   = document.getElementById('fmBtnNewFolder');
  _viewBtnTiles   = document.getElementById('fmViewToggleTiles');
  _viewBtnList    = document.getElementById('fmViewToggleList');
  _breadcrumbEl   = document.getElementById('fmBreadcrumb');
  _selbarInfoEl   = document.getElementById('fmSelbarInfo');
  _statusEl       = document.getElementById('fmProjectStatus');
  _msgEl          = document.getElementById('fmProjectMsg');
}

function wireModalListeners() {
  // ESC handler re-registered on every open (it removes itself on close)
  document.addEventListener('keydown', onModalKey);

  if (_listenersWired) return; // all other listeners wired only once
  _listenersWired = true;

  document.getElementById('fmCloseBtn')?.addEventListener('click', closeModal);
  _modal.addEventListener('click', (e) => { if (e.target === _modal) closeModal(); });

  _btnSave?.addEventListener('click',   onSave);
  _btnSaveAs?.addEventListener('click', onSaveAs);
  _btnLoad?.addEventListener('click',   () => onLoad(_selected));
  _btnRename?.addEventListener('click', onRename);
  _btnDelete?.addEventListener('click', onDelete);
  _btnNewFolder?.addEventListener('click', onNewFolder);

  // View toggle
  _viewBtnTiles?.addEventListener('click', () => setViewMode('tiles'));
  _viewBtnList?.addEventListener('click',  () => setViewMode('list'));

  // Breadcrumb delegation — clicking a crumb navigates there
  _breadcrumbEl?.addEventListener('click', (e) => {
    const crumb = e.target.closest('.pm-crumb');
    if (!crumb || crumb.classList.contains('pm-crumb-current')) return;
    const path = crumb.dataset.path || '';
    enterFolder(path);
  });

  // Delegated click/dblclick on the content area — handles tile, table row,
  // and any folder element (each carries data-path or data-name).
  _fmList?.addEventListener('click', (e) => {
    const folder = e.target.closest('[data-folder-path]');
    if (folder) {
      // Single-click on folder = select it; double handler enters
      selectFolder(folder.dataset.folderPath);
      return;
    }
    const item = e.target.closest('[data-name]');
    if (item) selectProject(item.dataset.name);
  });
  _fmList?.addEventListener('dblclick', (e) => {
    const folder = e.target.closest('[data-folder-path]');
    if (folder) { enterFolder(folder.dataset.folderPath); return; }
    const item = e.target.closest('[data-name]');
    if (item) onLoad(item.dataset.name);
  });
}

function onModalKey(e) {
  if (e.key === 'Escape') { closeModal(); return; }
  // Backspace navigates up a folder (when not typing in an input)
  if (e.key === 'Backspace' && _currentFolder &&
      !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) {
    e.preventDefault();
    enterFolder(parentFolder(_currentFolder));
    return;
  }
  // Enter on a selected project = load
  if (e.key === 'Enter' && _selected && _selectedKind === 'project' &&
      document.activeElement !== _fmName) {
    e.preventDefault();
    onLoad(_selected);
  }
}

function setViewMode(mode) {
  if (mode !== 'tiles' && mode !== 'list') return;
  _viewMode = mode;
  try { localStorage.setItem(VIEW_LS_KEY, mode); } catch {}
  applyViewModeToToggle();
  renderList();
}

function applyViewModeToToggle() {
  _viewBtnTiles?.classList.toggle('active', _viewMode === 'tiles');
  _viewBtnList?.classList.toggle('active',  _viewMode === 'list');
  _viewBtnTiles?.setAttribute('aria-selected', _viewMode === 'tiles' ? 'true' : 'false');
  _viewBtnList?.setAttribute('aria-selected',  _viewMode === 'list' ? 'true' : 'false');
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
    // Cache-bust + no-store so browser doesn't serve a stale list immediately
    // after a write. Cloudflare KV is eventually consistent, so even with this
    // a fresh GET right after a PUT/DELETE may still return old data — that's
    // why mutation handlers do an optimistic local update before/instead of
    // relying on this fetch.
    const r = await fetch(`${_API_URL}/projects?_=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    // Prefer items[] (with metadata), fall back to names[] for old Workers.
    const items = Array.isArray(data.items) && data.items.length
      ? data.items
      : (data.names || []).map((name) => ({ name }));
    // Reconcile against recent local mutations — without this, KV's
    // eventual consistency would resurrect just-deleted projects (and
    // hide just-saved ones) until propagation completes.
    _projects = _reconcileWithMutations(items);
    setStatus(`${_projects.length} project${_projects.length !== 1 ? 's' : ''}`);
  } catch (e) {
    console.warn('[project-manager] list failed:', e);
    _projects = [];
    setStatus('⚠ Offline — check connection');
  }
  renderList();
}

/**
 * Optimistic local mutation of _projects so the UI updates instantly after
 * a successful save/delete/rename, regardless of Cloudflare KV's eventual-
 * consistency lag on the next GET. Re-sorts to keep alphabetical order
 * stable. Caller is responsible for renderList() + a background refreshList
 * if it wants to reconcile with server state.
 *
 * IMPORTANT: optimistic mutations are also recorded in _recentMutations
 * so the next background refreshList can RESPECT them (filter out items
 * we just deleted, ensure items we just saved are present) — without this,
 * a stale GET arriving moments after a DELETE would resurrect the deleted
 * row, making delete look unreliable.
 */
const MUTATION_TTL_MS = 10000;  // longer than typical KV propagation
const _recentMutations = new Map();  // name -> { kind: 'added'|'removed', ts }

function _trackMutation(name, kind) {
  _recentMutations.set(name, { kind, ts: Date.now() });
}

function _reconcileWithMutations(serverItems) {
  const now = Date.now();
  // Expire old entries
  for (const [name, mut] of _recentMutations) {
    if (now - mut.ts > MUTATION_TTL_MS) _recentMutations.delete(name);
  }
  // Apply remaining mutations on top of server state
  let result = serverItems.slice();
  for (const [name, mut] of _recentMutations) {
    if (mut.kind === 'removed') {
      result = result.filter(p => p.name !== name);
    } else if (mut.kind === 'added') {
      if (!result.find(p => p.name === name)) {
        result.push({ name, savedAt: mut.ts });
      }
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

function _optimisticUpsert(name) {
  const entry = { name, savedAt: Date.now() };
  const idx = _projects.findIndex(p => p.name === name);
  if (idx >= 0) _projects[idx] = entry;
  else _projects.push(entry);
  _projects.sort((a, b) => a.name.localeCompare(b.name));
  _trackMutation(name, 'added');
}
function _optimisticRemove(name) {
  _projects = _projects.filter(p => p.name !== name);
  _trackMutation(name, 'removed');
}

// ─── Folder helpers ──────────────────────────────────────────────────────────

/** "A/B/C" -> "A/B" ; "A" -> "" ; "" -> "" */
function parentFolder(path) {
  if (!path) return '';
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** "A/B/Project1" inside folder "A" -> ['B', 'Project1'] */
function relativeTo(name, folder) {
  if (!folder) return name.split('/');
  const prefix = folder + '/';
  if (!name.startsWith(prefix)) return null;
  return name.slice(prefix.length).split('/');
}

/**
 * Compute what to display in the current folder: { folders: Set<path>,
 * projects: Array<{name, savedAt}> }. Folders are derived from any
 * project name that has a longer path AND from _virtualFolders entries
 * that fall under the current folder.
 */
function getCurrentFolderContents() {
  const folders = new Set();
  const projects = [];

  // From real projects
  for (const p of _projects) {
    const rel = relativeTo(p.name, _currentFolder);
    if (rel === null) continue;  // not in this folder
    if (rel.length === 1) {
      // direct child project
      projects.push(p);
    } else {
      // subfolder — first segment is the immediate child folder name
      folders.add(rel[0]);
    }
  }

  // From explicit virtual folders
  for (const vf of _virtualFolders) {
    const rel = relativeTo(vf, _currentFolder);
    if (rel === null) continue;
    if (rel.length >= 1 && rel[0]) folders.add(rel[0]);
  }

  return { folders, projects };
}

function enterFolder(path) {
  _currentFolder = path || '';
  _selected = null;
  _selectedKind = null;
  renderBreadcrumb();
  updateButtons();
  setSelbarInfo();
  renderList();
}

function selectFolder(folderName) {
  _selected = folderName;       // full path of the folder
  _selectedKind = 'folder';
  updateButtons();
  setSelbarInfo();
  applySelectionStyles();
}

/**
 * Update only the `fm-selected` CSS class on the existing tiles/rows in
 * place — no innerHTML rewrite. This keeps the original DOM nodes alive
 * so the browser's dblclick can fire reliably (it requires both clicks
 * to land on related/same nodes; a full re-render between them swaps
 * the node out from under the second click).
 */
function applySelectionStyles() {
  if (!_fmList) return;
  _fmList.querySelectorAll('.pm-tile, .pm-row').forEach((el) => {
    let isSelected = false;
    if (el.dataset.folderPath !== undefined) {
      isSelected = (_selectedKind === 'folder' && _selected === el.dataset.folderPath);
    } else if (el.dataset.name !== undefined) {
      isSelected = (_selectedKind === 'project' && _selected === el.dataset.name);
    }
    el.classList.toggle('fm-selected', isSelected);
  });
}

function renderBreadcrumb() {
  if (!_breadcrumbEl) return;
  const segs = _currentFolder ? _currentFolder.split('/') : [];
  let acc = '';
  const parts = [
    `<span class="pm-crumb${segs.length === 0 ? ' pm-crumb-current' : ''}" data-path="">📁</span>`,
  ];
  segs.forEach((seg, i) => {
    acc = acc ? acc + '/' + seg : seg;
    const isLast = i === segs.length - 1;
    parts.push(`<span class="pm-crumb-sep">/</span>`);
    parts.push(
      `<span class="pm-crumb${isLast ? ' pm-crumb-current' : ''}" data-path="${escapeAttr(acc)}">${escapeText(seg)}</span>`
    );
  });
  _breadcrumbEl.innerHTML = parts.join('');
}

// ─── Render dispatcher ───────────────────────────────────────────────────────

function renderList() {
  if (!_fmList) return;
  // Tear down any previous IntersectionObserver — new one will be created
  // when needed by the renderers.
  if (_metaIO) { _metaIO.disconnect(); _metaIO = null; }

  const { folders, projects } = getCurrentFolderContents();
  const folderArr = Array.from(folders).sort((a, b) => a.localeCompare(b));

  if (folderArr.length === 0 && projects.length === 0) {
    const isRoot = !_currentFolder;
    _fmList.innerHTML = `<div class="pm-empty">
      <span class="material-symbols-outlined">${isRoot ? 'inbox' : 'folder_off'}</span>
      <div>${isRoot ? 'No projects yet — click "Save Current" to add one.' : 'This folder is empty.'}</div>
    </div>`;
    return;
  }

  if (_viewMode === 'tiles') {
    renderTiles(folderArr, projects);
  } else {
    renderTable(folderArr, projects);
  }
}

function renderTiles(folderArr, projects) {
  const folderHtml = folderArr.map((name) => {
    const fullPath = _currentFolder ? `${_currentFolder}/${name}` : name;
    const sel = (_selected === fullPath && _selectedKind === 'folder') ? ' fm-selected' : '';
    return `<div class="pm-tile pm-tile-folder${sel}" data-folder-path="${escapeAttr(fullPath)}" title="${escapeAttr(fullPath)}">
      <div class="pm-tile-thumb"><span class="material-symbols-outlined">folder</span></div>
      <div class="pm-tile-name">${escapeText(name)}</div>
      <div class="pm-tile-date">folder</div>
    </div>`;
  }).join('');

  const projectHtml = projects.map((p) => {
    const sel = (p.name === _selected && _selectedKind === 'project') ? ' fm-selected' : '';
    const leafName = p.name.split('/').pop();
    const dateShort = p.savedAt ? formatRelativeDate(p.savedAt) : '—';
    const cached = _metaCache.get(p.name);
    const thumb = cached?.thumbnail
      ? `<img src="${escapeAttr(cached.thumbnail)}" alt="">`
      : `<span class="material-symbols-outlined">image</span>`;
    return `<div class="pm-tile${sel}" data-name="${escapeAttr(p.name)}" title="${escapeAttr(p.name)}">
      <div class="pm-tile-thumb">${thumb}</div>
      <div class="pm-tile-name">${escapeText(leafName)}</div>
      <div class="pm-tile-date">${escapeText(dateShort)}</div>
    </div>`;
  }).join('');

  _fmList.innerHTML = `<div class="pm-tile-grid">${folderHtml}${projectHtml}</div>`;

  // Lazy-fetch thumbnails for projects whose tiles scroll into view
  setupLazyMeta();
}

function renderTable(folderArr, projects) {
  const folderRows = folderArr.map((name) => {
    const fullPath = _currentFolder ? `${_currentFolder}/${name}` : name;
    const sel = (_selected === fullPath && _selectedKind === 'folder') ? ' fm-selected' : '';
    return `<tr class="fm-row pm-list-folder${sel}" data-folder-path="${escapeAttr(fullPath)}">
      <td><span class="material-symbols-outlined pm-list-icon">folder</span>${escapeText(name)}</td>
      <td colspan="5" style="color:#aaa;font-style:italic;">folder</td>
    </tr>`;
  }).join('');

  const projectRows = projects.map((p) => {
    const sel = (p.name === _selected && _selectedKind === 'project') ? ' fm-selected' : '';
    const leafName = p.name.split('/').pop();
    const dateShort = p.savedAt ? formatRelativeDate(p.savedAt) : '—';
    const m = _metaCache.get(p.name) || {};
    const stock = (m.stockW != null && m.stockH != null)
      ? `${formatStockDim(m.stockW)}×${formatStockDim(m.stockH)}`
      : '…';
    const res   = m.resolution != null ? String(m.resolution) : '…';
    const stamps = m.hasStamps == null ? '…' : (m.hasStamps ? '<span class="pm-col-yes">yes</span>' : '<span class="pm-col-no">no</span>');
    const noise = m.noiseType ? escapeText(m.noiseType) : (m.noiseType === '' ? '—' : '…');
    return `<tr class="fm-row${sel}" data-name="${escapeAttr(p.name)}" title="${escapeAttr(p.name)}">
      <td><span class="material-symbols-outlined pm-list-icon">description</span>${escapeText(leafName)}</td>
      <td class="pm-col-num">${escapeText(stock)}</td>
      <td class="pm-col-num pm-col-mobile-hide">${escapeText(res)}</td>
      <td>${stamps}</td>
      <td class="pm-col-mobile-hide">${noise}</td>
      <td class="pm-col-num">${escapeText(dateShort)}</td>
    </tr>`;
  }).join('');

  _fmList.innerHTML = `<table class="pm-list-table">
    <thead><tr>
      <th>Name</th>
      <th>Stock</th>
      <th class="pm-col-mobile-hide">Resolution</th>
      <th>Stamps</th>
      <th class="pm-col-mobile-hide">Noise</th>
      <th>Saved</th>
    </tr></thead>
    <tbody>${folderRows}${projectRows}</tbody>
  </table>`;

  setupLazyMeta();
}

// ─── Lazy metadata + thumbnail fetch ─────────────────────────────────────────

/** Set up an IntersectionObserver that fetches each project's full
 *  snapshot the first time its tile/row scrolls into view, then re-renders
 *  to surface the thumbnail / list-column data. */
function setupLazyMeta() {
  if (!_fmList) return;
  if (!('IntersectionObserver' in window)) {
    // Fallback: fetch everything immediately. Slow but correct.
    _fmList.querySelectorAll('[data-name]').forEach(el => fetchMeta(el.dataset.name));
    return;
  }
  if (_metaIO) _metaIO.disconnect();
  _metaIO = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const name = entry.target.dataset.name;
      if (name) {
        _metaIO.unobserve(entry.target);
        fetchMeta(name);
      }
    }
  }, { root: _fmList, rootMargin: '200px' });

  _fmList.querySelectorAll('[data-name]').forEach((el) => {
    if (!_metaCache.has(el.dataset.name)) _metaIO.observe(el);
  });
}

async function fetchMeta(name) {
  if (_metaCache.has(name)) return;
  if (!_API_URL) return;
  // Mark as in-flight so we don't double-fetch
  _metaCache.set(name, { loading: true });
  try {
    const r = await fetch(`${_API_URL}/projects/${encodeURIComponent(name)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    const sizeBytes = text.length;
    const snap = JSON.parse(text);
    const P = snap?.P || {};
    _metaCache.set(name, {
      thumbnail:  snap?.thumbnail || null,
      sizeBytes,
      stockW:     P.widthIn  ?? null,
      stockH:     P.heightIn ?? null,
      resolution: P.spacing  ?? null,
      noiseType:  P.noiseType ?? '',
      hasStamps:  Array.isArray(P.stampLayers) && P.stampLayers.some(L => L && L.enabled !== false),
    });
    // Re-render the single affected tile/row in place. Simplest approach:
    // re-render the whole list (cheap — only rebuilds the DOM for items
    // currently in view, since the meta cache provides instant data).
    renderList();
  } catch (err) {
    console.warn('[project-manager] meta fetch failed for', name, err);
    _metaCache.set(name, { error: true });
  }
}

// "10:42", "yesterday", "Mar 14", "Mar 14 2024" — short forms.
// Full timestamp lives in the title attribute (hover) and the dateFull span.
function formatRelativeDate(epoch) {
  const d   = new Date(epoch);
  const now = new Date();
  if (Number.isNaN(d.getTime())) return '—';

  // Same calendar day → time only
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Yesterday
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'yesterday';

  // Same year → "Mar 14"
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  // Older → "Mar 14 2024"
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function selectProject(name) {
  _selected = name;
  _selectedKind = 'project';
  if (_fmName) _fmName.value = name;
  updateButtons();
  setSelbarInfo();
  applySelectionStyles();
}

function updateButtons() {
  const isProject = _selectedKind === 'project';
  // Load only makes sense for projects, not folders
  if (_btnLoad)   _btnLoad.disabled   = !isProject;
  // Rename + Delete work on either projects or folders
  const has = !!_selected;
  if (_btnRename) _btnRename.disabled = !has;
  if (_btnDelete) _btnDelete.disabled = !has;
}

function setSelbarInfo() {
  if (!_selbarInfoEl) return;
  if (!_selected) {
    _selbarInfoEl.innerHTML = '<span class="pm-selbar-info-meta">No selection</span>';
    return;
  }
  const leafName = _selected.split('/').pop();
  if (_selectedKind === 'folder') {
    // Count direct children (projects + subfolders) for context
    const inside = _projects.filter(p => p.name.startsWith(_selected + '/')).length;
    _selbarInfoEl.innerHTML = `📁 <span class="pm-selbar-info-name">${escapeText(leafName)}</span>` +
      ` <span class="pm-selbar-info-meta">· ${inside} item${inside === 1 ? '' : 's'} inside</span>`;
    return;
  }
  // Project — show metadata if cached
  const m = _metaCache.get(_selected);
  const parts = [`<span class="pm-selbar-info-name">${escapeText(leafName)}</span>`];
  if (m && !m.loading && !m.error) {
    if (m.sizeBytes != null) parts.push(formatBytes(m.sizeBytes));
    if (m.stockW != null && m.stockH != null) parts.push(`${formatStockDim(m.stockW)}×${formatStockDim(m.stockH)}`);
    if (m.noiseType) parts.push(escapeText(m.noiseType));
    if (m.hasStamps) parts.push('stamps');
  }
  _selbarInfoEl.innerHTML = parts.join(' <span class="pm-selbar-info-meta">·</span> ');
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Format a stock dimension (inches) for display. Avoids exposing IEEE-754
 * float noise like "6.500000000000001" by rounding to 3 decimals and
 * trimming trailing zeros. See BUG-09.
 */
function formatStockDim(v) {
  if (v == null) return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  // Round to 3 dp, then strip trailing zeros and a trailing dot.
  return n.toFixed(3).replace(/\.?0+$/, '');
}

// ─── Save / Save As ──────────────────────────────────────────────────────────

/**
 * Save current state. Behavior depends on file association (_currentFile):
 *  - If set       → silent overwrite to that name (Ctrl+S behavior).
 *  - If not set   → prompt for a name (first save in session).
 * Use onSaveAs() to always prompt regardless.
 */
async function onSave() {
  if (_currentFile) return _saveTo(_currentFile);
  return onSaveAs();
}

/** Save As… — always prompts for a new name even if a file is associated. */
async function onSaveAs() {
  const leafSuggestion = _currentFile
    ? _currentFile.split('/').pop()
    : ((_selectedKind === 'project' && _selected) ? _selected.split('/').pop() : '');
  const raw = await promptForName(
    _currentFolder
      ? `Save into 📁 ${_currentFolder}/  —  enter a name (or full path with slashes):`
      : 'Save current state — enter a name (use / for subfolders):',
    leafSuggestion,
    'project name'
  );
  if (raw == null) return;  // cancelled
  const trimmed = raw.trim();
  if (!trimmed) { setMsg('Enter a project name first.', 'warn'); return; }
  // Sanitize: collapse multiple slashes, strip leading/trailing slashes.
  const cleaned = trimmed.replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
  if (!cleaned) { setMsg('Invalid name.', 'warn'); return; }
  // Absolute (contains slash) → use as-is. Bare name → prepend current folder.
  const fullName = (cleaned.includes('/') || !_currentFolder)
    ? cleaned : `${_currentFolder}/${cleaned}`;
  return _saveTo(fullName);
}

/** Quick Save from outside the modal (navbar button). Same Save behavior:
 *  silent if a file is associated, otherwise opens the modal and prompts. */
export async function quickSave() {
  if (_currentFile) {
    if (!_API_URL) { console.warn('[project-manager] quickSave: no API'); return; }
    return _saveTo(_currentFile);
  }
  // No association — open the modal and start the Save As flow
  document.getElementById('btnOpenProjectManager')?.click();
  // Wait a beat for the modal to wire up DOM refs, then prompt
  setTimeout(() => onSaveAs(), 100);
}

/** Inner save implementation. Takes a fully-qualified name. */
async function _saveTo(fullName) {
  if (!_API_URL) { setMsg('No cloud API configured.', 'warn'); return; }

  if (_btnSave) _btnSave.disabled = true;
  setMsg(`Saving "${fullName}"…`);
  try {
    const r = await fetch(`${_API_URL}/projects/${encodeURIComponent(fullName)}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(buildSnapshot()),
    });
    if (!r.ok) throw new Error((await safeJson(r)).error || `HTTP ${r.status}`);
    setMsg(`✓ Saved "${fullName}"`, 'ok');
    showToast(`✓ Saved "${fullName}"`);
    closeModal();
    // Optimistic UI update first — KV's eventual consistency means an
    // immediate refreshList() may return the pre-write list. Mutate
    // locally so the user sees the new entry instantly, then kick off a
    // background reconcile that will catch any other clients' changes.
    _optimisticUpsert(fullName);
    // Drop any virtual-folder entry that this save just made real.
    const parent = parentFolder(fullName);
    if (parent) {
      _virtualFolders.delete(parent);
      saveVirtualFolders();
    }
    // Bust the meta cache so the next render fetches fresh data (new
    // thumbnail, fresh size, etc.)
    _metaCache.delete(fullName);
    // Establish file association — subsequent quick-saves overwrite this.
    setCurrentFile(fullName);
    _selected = fullName;
    _selectedKind = 'project';
    setStatus(`${_projects.length} project${_projects.length !== 1 ? 's' : ''}`);
    updateButtons();
    setSelbarInfo();
    renderList();
    refreshList().catch(() => {});
  } catch (e) {
    setMsg(`Save failed: ${e.message}`, 'error');
  } finally {
    if (_btnSave) _btnSave.disabled = false;
  }
}

function saveVirtualFolders() {
  try {
    localStorage.setItem(VFOLDERS_LS_KEY, JSON.stringify(Array.from(_virtualFolders)));
  } catch {}
}

/** Update the file association ("currently editing X"). Persists so the
 *  association survives page reloads. Pass null to clear. */
function setCurrentFile(name) {
  _currentFile = name || null;
  try {
    if (_currentFile) localStorage.setItem(CURFILE_LS_KEY, _currentFile);
    else              localStorage.removeItem(CURFILE_LS_KEY);
  } catch {}
  updateHeaderFileIndicator();
  updateSaveButtonLabel();
  updateNavbarSaveLabel();
}

function updateHeaderFileIndicator() {
  const el = document.getElementById('fmCurrentFileLabel');
  if (!el) return;
  if (_currentFile) {
    el.textContent = '· ' + _currentFile;
    el.style.display = '';
  } else {
    el.textContent = '';
    el.style.display = 'none';
  }
}

function updateSaveButtonLabel() {
  if (!_btnSave) return;
  // Inside button there's a label span we can update; tooltip too.
  const labelEl = _btnSave.querySelector('.pm-save-label');
  if (labelEl) {
    labelEl.textContent = _currentFile ? 'Save' : 'Save…';
  }
  _btnSave.title = _currentFile
    ? `Save (overwrite "${_currentFile}")`
    : 'Save current state — prompts for a name';
}

// ─── New folder ──────────────────────────────────────────────────────────────
async function onNewFolder() {
  const raw = await promptForName(
    _currentFolder
      ? `Create folder inside 📁 ${_currentFolder}/`
      : 'Create folder at root',
    '',
    'folder name'
  );
  if (raw == null) return;
  const cleaned = raw.trim().replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
  if (!cleaned) { setMsg('Invalid folder name.', 'warn'); return; }
  const fullPath = _currentFolder ? `${_currentFolder}/${cleaned}` : cleaned;
  _virtualFolders.add(fullPath);
  saveVirtualFolders();
  setMsg(`✓ Folder "${fullPath}" created (empty)`, 'ok');
  enterFolder(fullPath);  // auto-navigate into it
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
    // Establish file association — subsequent quick-saves overwrite this.
    setCurrentFile(name);
    setMsg(`✓ Loaded "${name}"`, 'ok');
    setTimeout(closeModal, 400);
  } catch (e) {
    setMsg(`Load failed: ${e.message}`, 'error');
  }
}

// ─── Rename ───────────────────────────────────────────────────────────────────
async function onRename() {
  if (!_selected) return;

  if (_selectedKind === 'folder') {
    return renameFolder(_selected);
  }

  const oldLeaf = _selected.split('/').pop();
  const newLeaf = await promptForName(
    `Rename "${_selected}" — new name (or full path with slashes to move):`,
    oldLeaf,
    'new name'
  );
  if (newLeaf == null) return;
  const cleaned = newLeaf.trim().replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
  if (!cleaned) { setMsg('Invalid name.', 'warn'); return; }
  // If user typed a path, treat as absolute. Otherwise keep parent folder.
  const parent = parentFolder(_selected);
  const newName = cleaned.includes('/') ? cleaned : (parent ? `${parent}/${cleaned}` : cleaned);
  if (newName === _selected) return;
  if (!_API_URL) { setMsg('No cloud API configured.', 'warn'); return; }

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
    // Optimistic: drop the old name, add the new one, instant re-render.
    const oldName = _selected;
    _optimisticRemove(oldName);
    _optimisticUpsert(newName);
    _metaCache.delete(oldName);  // old key no longer valid
    // Update file association if this rename affects the active file
    if (_currentFile === oldName) setCurrentFile(newName);
    _selected = newName;
    _selectedKind = 'project';
    setStatus(`${_projects.length} project${_projects.length !== 1 ? 's' : ''}`);
    updateButtons();
    setSelbarInfo();
    renderList();
    refreshList().catch(() => {});
  } catch (e) {
    setMsg(`Rename failed: ${e.message}`, 'error');
  }
}

/** Rename a (virtual or real) folder. Real folders rename by re-keying
 *  every project underneath. */
async function renameFolder(oldPath) {
  const oldLeaf = oldPath.split('/').pop();
  const newLeaf = await promptForName(`Rename folder "${oldPath}" — new name:`, oldLeaf, 'folder name');
  if (newLeaf == null) return;
  const cleaned = newLeaf.trim().replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
  if (!cleaned || cleaned === oldLeaf) return;
  const parent = parentFolder(oldPath);
  const newPath = parent ? `${parent}/${cleaned}` : cleaned;

  // If the folder is purely virtual (no projects inside), just rename the entry
  const childrenInside = _projects.filter(p => p.name === oldPath || p.name.startsWith(oldPath + '/'));
  if (childrenInside.length === 0) {
    if (_virtualFolders.delete(oldPath)) {
      _virtualFolders.add(newPath);
      saveVirtualFolders();
      setMsg(`✓ Renamed empty folder to "${newPath}"`, 'ok');
      _selected = newPath;
      _selectedKind = 'folder';
      renderBreadcrumb();
      updateButtons();
      setSelbarInfo();
      renderList();
    }
    return;
  }

  if (!_API_URL) { setMsg('No cloud API configured.', 'warn'); return; }
  if (!(await confirmDialog(`Rename folder "${oldPath}" → "${newPath}"?\nAll ${childrenInside.length} project(s) inside will be re-keyed.`))) return;

  setMsg(`Renaming folder (${childrenInside.length} project${childrenInside.length === 1 ? '' : 's'})…`);
  let ok = 0, fail = 0;
  for (const p of childrenInside) {
    const newKey = newPath + p.name.slice(oldPath.length);
    try {
      const r1 = await fetch(`${_API_URL}/projects/${encodeURIComponent(p.name)}`);
      if (!r1.ok) throw new Error(`HTTP ${r1.status}`);
      const body = await r1.text();
      const r2 = await fetch(`${_API_URL}/projects/${encodeURIComponent(newKey)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body,
      });
      if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
      await fetch(`${_API_URL}/projects/${encodeURIComponent(p.name)}`, { method: 'DELETE' });
      _optimisticRemove(p.name);
      _optimisticUpsert(newKey);
      _metaCache.delete(p.name);
      ok++;
    } catch (e) {
      console.warn('rename child failed', p.name, e);
      fail++;
    }
  }
  setMsg(`Folder renamed: ${ok} moved${fail ? `, ${fail} failed` : ''}`, fail ? 'warn' : 'ok');
  // If the active file lived under the renamed folder, re-key it too.
  if (_currentFile && (_currentFile === oldPath || _currentFile.startsWith(oldPath + '/'))) {
    setCurrentFile(newPath + _currentFile.slice(oldPath.length));
  }
  _selected = newPath;
  _selectedKind = 'folder';
  setStatus(`${_projects.length} project${_projects.length !== 1 ? 's' : ''}`);
  updateButtons();
  setSelbarInfo();
  renderList();
  refreshList().catch(() => {});
}

// ─── Delete ───────────────────────────────────────────────────────────────────
async function onDelete() {
  if (!_selected) return;

  if (_selectedKind === 'folder') {
    return deleteFolder(_selected);
  }

  if (!(await confirmDialog(`Delete project "${_selected}"?\nThis cannot be undone.`))) return;
  if (!_API_URL) { setMsg('No cloud API configured.', 'warn'); return; }

  setMsg('Deleting…');
  try {
    const r = await fetch(`${_API_URL}/projects/${encodeURIComponent(_selected)}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setMsg(`✓ Deleted "${_selected}"`, 'ok');
    // Optimistic local removal so the row disappears instantly even if
    // KV's next list still includes it. Background refreshList catches up.
    const justDeleted = _selected;
    _optimisticRemove(justDeleted);
    _metaCache.delete(justDeleted);
    // If the deleted file was the active session file, clear the
    // association so the next quick-save prompts for a name.
    if (_currentFile === justDeleted) setCurrentFile(null);
    _selected = null;
    _selectedKind = null;
    if (_fmName) _fmName.value = '';
    setStatus(`${_projects.length} project${_projects.length !== 1 ? 's' : ''}`);
    updateButtons();
    setSelbarInfo();
    renderList();
    refreshList().catch(() => {});
  } catch (e) {
    setMsg(`Delete failed: ${e.message}`, 'error');
  }
}

/** Delete a folder. Empty (virtual-only) folders just remove the entry.
 *  Real folders need explicit confirmation since every project inside dies. */
async function deleteFolder(path) {
  const inside = _projects.filter(p => p.name === path || p.name.startsWith(path + '/'));
  if (inside.length === 0) {
    if (_virtualFolders.delete(path)) {
      saveVirtualFolders();
      setMsg(`✓ Removed empty folder "${path}"`, 'ok');
      _selected = null; _selectedKind = null;
      updateButtons(); setSelbarInfo(); renderList();
    }
    return;
  }

  if (!_API_URL) { setMsg('No cloud API configured.', 'warn'); return; }
  if (!(await confirmDialog(
    `Delete folder "${path}" AND all ${inside.length} project${inside.length === 1 ? '' : 's'} inside?\n\nThis cannot be undone.`
  ))) return;

  setMsg(`Deleting folder (${inside.length} project${inside.length === 1 ? '' : 's'})…`);
  let ok = 0, fail = 0;
  for (const p of inside) {
    try {
      const r = await fetch(`${_API_URL}/projects/${encodeURIComponent(p.name)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      _optimisticRemove(p.name);
      _metaCache.delete(p.name);
      ok++;
    } catch (e) {
      console.warn('delete child failed', p.name, e);
      fail++;
    }
  }
  _virtualFolders.delete(path);
  saveVirtualFolders();
  setMsg(`Folder deleted: ${ok} project${ok === 1 ? '' : 's'} removed${fail ? `, ${fail} failed` : ''}`, fail ? 'warn' : 'ok');
  // If the active file was inside this folder, clear the association.
  if (_currentFile && (_currentFile === path || _currentFile.startsWith(path + '/'))) {
    setCurrentFile(null);
  }
  _selected = null; _selectedKind = null;
  setStatus(`${_projects.length} project${_projects.length !== 1 ? 's' : ''}`);
  updateButtons();
  setSelbarInfo();
  renderList();
  refreshList().catch(() => {});
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
  if (!(await confirmDialog(
    `Found ${names.length} local project${plural ? 's' : ''} saved in this browser:\n` +
    `  ${names.join(', ')}\n\n` +
    `Migrate ${plural ? 'them' : 'it'} to the cloud now?`
  ))) {
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

/** Lightweight non-modal confirmation toast (bottom-right corner). */
function showToast(text, type = 'ok') {
  let host = document.getElementById('cpmToastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'cpmToastHost';
    host.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
    document.body.appendChild(host);
  }
  const colors = { ok: '#2a7', warn: '#a60', error: '#c00' };
  const el = document.createElement('div');
  el.style.cssText = `background:${colors[type] || '#444'};color:#fff;padding:10px 16px;border-radius:6px;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,0.25);opacity:0;transition:opacity 200ms ease;pointer-events:auto;max-width:320px;`;
  el.textContent = text;
  host.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; });
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 250);
  }, 2200);
}

async function safeJson(r) { try { return await r.json(); } catch { return {}; } }

/**
 * In-page prompt dialog. Replaces window.prompt() because CEF browsers
 * (Fusion 360's embedded browser) disable native prompt/confirm/alert by
 * default — calling them returns null silently, which made Save / Save
 * As / Rename / New Folder appear to do nothing inside Fusion.
 *
 * Renders a small overlay on top of whatever's already showing, with a
 * title, single text input (pre-filled with `defaultValue`), and OK /
 * Cancel buttons. Resolves to the trimmed value, or null if cancelled.
 * Enter = OK, Esc = cancel. Auto-focuses + selects the input.
 */
function promptForName(title, defaultValue = '', placeholder = '') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'pm-prompt-overlay';
    overlay.innerHTML = `
      <div class="pm-prompt-dialog" role="dialog" aria-modal="true">
        <div class="pm-prompt-title">${escapeText(title)}</div>
        <input type="text" class="pm-prompt-input" placeholder="${escapeAttr(placeholder)}">
        <div class="pm-prompt-actions">
          <button type="button" class="pm-prompt-btn pm-prompt-cancel">Cancel</button>
          <button type="button" class="pm-prompt-btn pm-prompt-ok">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input    = overlay.querySelector('.pm-prompt-input');
    const okBtn    = overlay.querySelector('.pm-prompt-ok');
    const cancelBtn = overlay.querySelector('.pm-prompt-cancel');
    input.value = defaultValue || '';

    const cleanup = (val) => {
      overlay.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(val);
    };
    const onOk     = () => cleanup(input.value);
    const onCancel = () => cleanup(null);
    const onKey = (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); e.stopPropagation(); onOk(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
    };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) onCancel(); });
    overlay.addEventListener('keydown', onKey);

    // Focus + select after the overlay paints
    setTimeout(() => { input.focus(); input.select(); }, 0);
  });
}

/** In-page confirm dialog — same rationale as promptForName. */
function confirmDialog(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'pm-prompt-overlay';
    overlay.innerHTML = `
      <div class="pm-prompt-dialog" role="alertdialog" aria-modal="true">
        <div class="pm-prompt-message">${escapeText(message).replace(/\n/g, '<br>')}</div>
        <div class="pm-prompt-actions">
          <button type="button" class="pm-prompt-btn pm-prompt-cancel">Cancel</button>
          <button type="button" class="pm-prompt-btn pm-prompt-ok pm-prompt-danger">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const okBtn = overlay.querySelector('.pm-prompt-ok');
    const cancelBtn = overlay.querySelector('.pm-prompt-cancel');
    const cleanup = (v) => { overlay.remove(); resolve(v); };
    okBtn.addEventListener('click', () => cleanup(true));
    cancelBtn.addEventListener('click', () => cleanup(false));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); cleanup(true); }
      if (e.key === 'Escape') { e.preventDefault(); cleanup(false); }
    });
    setTimeout(() => okBtn.focus(), 0);
  });
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

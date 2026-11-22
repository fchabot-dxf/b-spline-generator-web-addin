/**
 * main/stl-library-sheet.js -- SMITHSONIAN-BROWSER (SMITHSONIAN-BROWSER-DESIGN.md, Fred's answers in section 7): a FULL-SCREEN
 * sheet that pages the WHOLE collection straight away (24 at a time, "More results"), a search box and a MUSEUM PICKER (a native
 * <select>). Tapping a tile SELECTS it and fills the PREVIEW PANE (beside the grid; above it on a phone): a large picture at once,
 * "Turn in 3D" for a turnable view of the model's small preview GLB, and "Insert", which hands the tile to `onPick` and closes.
 * Built on the app's own dialog classes (cad-modal-overlay / -window / -header / -body / -footer, as pull-changelist.js and the
 * editor's full-screen #svgEditorModal); the tile size is the shared PICKER_TILE. Nothing here touches the board: the caller's
 * onPick does the import (main/stl-panel.js).
 */
import {
  SMITHSONIAN_SOURCE, fetchSmithsonianPage, fetchSmithsonianThumbGlb,
} from '../core/stl/smithsonian.js';
import { loadGlbScene, soupFromGltfScene, disposeGltfScene } from '../core/stl/gltf.js';
import { PICKER_TILE } from './icon-select.js';
import { createSoupView } from './stl-preview-3d.js';

const el = (tag, attrs = {}, kids = []) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'style') e.style.cssText = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v); }
  for (const k of kids) if (k) e.appendChild(k);
  return e;
};
const msgOf = (e) => (e && e.message ? e.message : String(e));
const fmt = (n) => Number(n).toLocaleString('en-US');

/**
 * Open the sheet. `fetchImpl` defaults to the page's fetch; `onPick(tile)` gets the chosen tile
 * ({ id, title, glbUrl, thumbUrl, previewUrl }). Returns { overlay, close }.
 */
export function openStlLibrarySheet({ source = SMITHSONIAN_SOURCE, fetchImpl, onPick } = {}) {
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  let closed = false;

  // ── the window ──
  const overlay = el('div', { class: 'cad-modal-overlay stl-lib-overlay', id: 'stlLibraryOverlay', style: 'display:flex;' });
  const win = el('div', { class: 'cad-modal-window stl-lib-window', role: 'dialog', 'aria-label': source.label,
    style: 'width:100vw; height:100vh; max-width:none; max-height:none; border-radius:0;' });
  const closeBtn = el('button', { type: 'button', class: 'cad-btn cad-btn-secondary stl-lib-close', 'aria-label': 'Close', title: 'Close', text: '✕',
    style: 'min-width:32px; min-height:32px;' });
  const header = el('div', { class: 'cad-modal-header stl-lib-header' }, [el('span', { text: source.label }), closeBtn]);

  // ── the search row ──
  const query = el('input', { type: 'search', id: 'stlLibQuery', class: 'stl-lib-query', placeholder: 'Search the collection', 'aria-label': 'Search' });
  const museum = el('select', { id: 'stlLibMuseum', class: 'stl-lib-museum', 'aria-label': 'Museum' },
    [el('option', { value: '', text: 'All museums' }), ...source.museums.map(([code, name]) => el('option', { value: code, text: name }))]);
  const searchBtn = el('button', { type: 'button', id: 'stlLibSearch', class: 'cad-btn cad-btn-primary', text: 'Search' });
  const statusEl = el('div', { id: 'stlLibStatus', class: 'photo-layer-note stl-lib-status', role: 'status' });
  const grid = el('div', { id: 'stlLibGrid', class: 'stl-lib-grid', style: `grid-template-columns: repeat(auto-fill, minmax(${PICKER_TILE.tilePx}px, 1fr));` });
  const more = el('button', { type: 'button', id: 'stlLibMore', class: 'cad-btn cad-btn-secondary stl-lib-more', text: 'More results' });
  more.hidden = true;

  // ── the preview pane ──
  const pane = el('div', { id: 'stlLibPane', class: 'stl-lib-pane' });
  pane.hidden = true;
  const media = el('div', { class: 'stl-lib-pane-media' });
  const paneTitle = el('div', { class: 'stl-lib-pane-title' });
  const turnBtn = el('button', { type: 'button', id: 'stlLibTurn', class: 'cad-btn cad-btn-secondary', text: 'Turn in 3D' });
  const insertBtn = el('button', { type: 'button', id: 'stlLibInsert', class: 'cad-btn cad-btn-primary', text: 'Insert' });
  const paneNote = el('div', { id: 'stlLibPaneNote', class: 'photo-layer-note stl-lib-pane-note', role: 'status' });
  paneNote.hidden = true;
  pane.append(media, paneTitle, el('div', { class: 'stl-lib-pane-buttons' }, [turnBtn, insertBtn]), paneNote);

  const results = el('div', { class: 'stl-lib-results' }, [statusEl, grid, more]);
  const body = el('div', { class: 'cad-modal-body stl-lib-body' }, [
    el('div', { class: 'stl-lib-search' }, [query, museum, searchBtn]),
    el('div', { class: 'stl-lib-main' }, [results, pane]),
  ]);
  const footer = el('div', { class: 'cad-modal-footer stl-lib-credit', text: source.credit });
  win.append(header, body, footer);
  overlay.appendChild(win);
  document.body.appendChild(overlay);

  // ── paging ──
  const st = { q: '', unit: '', page: 0, total: 0, seq: 0, shown: new Set() };
  const setStatus = (text, isError = false) => { statusEl.textContent = text; statusEl.classList.toggle('stl-error', !!isError); };

  function tileEl(t) {
    const b = el('button', { type: 'button', class: 'stl-lib-tile', 'data-model-id': t.id, title: t.title });
    const img = el('img', { class: 'stl-lib-thumb', loading: 'lazy', src: t.thumbUrl, alt: '' });
    img.addEventListener('error', () => { img.remove(); b.classList.add('stl-lib-tile-text'); }, { once: true });
    b.append(img, el('span', { class: 'stl-lib-title', text: t.title }));
    b.addEventListener('click', () => select(t, b));
    return b;
  }

  async function load(reset) {
    const my = ++st.seq;
    const page = reset ? 0 : st.page + 1;
    if (reset) { grid.textContent = ''; st.shown.clear(); st.total = 0; }
    more.hidden = true;
    setStatus('Loading…');
    try {
      const res = await fetchSmithsonianPage({ q: st.q, unit: st.unit, page }, doFetch, source);
      if (closed || my !== st.seq) return; // a newer search (or the close) won
      st.page = page;
      st.total = res.total;
      for (const t of res.tiles) {
        if (st.shown.has(t.id)) continue; // a model whose GLB rows straddle two pages shows once
        st.shown.add(t.id);
        grid.appendChild(tileEl(t));
      }
      const end = Math.min((page + 1) * source.pageSize, st.total);
      setStatus(st.total > 0 ? `1–${fmt(end)} of ${fmt(st.total)}` : 'No models found');
      more.hidden = end >= st.total;
    } catch (e) {
      if (closed || my !== st.seq) return;
      setStatus(msgOf(e), true);
      more.hidden = reset || !st.total; // a failed "More" can be tried again
    }
  }
  const search = () => { st.q = query.value.trim(); st.unit = museum.value; return load(true); };

  // ── the preview ──
  let selected = null;     // { tile, button }
  let view = null;         // the 3D view (createSoupView), or null
  let viewSeq = 0;         // bumps on every selection / close: a 3D load for an older one is dropped
  const setPaneNote = (text, isError = false) => { paneNote.textContent = text || ''; paneNote.hidden = !text; paneNote.classList.toggle('stl-error', !!isError); };
  const disposeView = () => { if (view) { view.dispose(); view = null; } };

  function showPicture(t) {
    media.textContent = '';
    const img = el('img', { class: 'stl-lib-preview', src: t.previewUrl || t.thumbUrl, alt: '' });
    let fellBack = !t.previewUrl;
    img.addEventListener('error', () => {
      if (!fellBack) { fellBack = true; img.setAttribute('src', t.thumbUrl); } else img.remove(); // the thumbnail, then the title alone
    });
    media.appendChild(img);
  }

  function select(t, button) {
    viewSeq++;
    disposeView();
    if (selected) selected.button.classList.remove('active');
    selected = { tile: t, button };
    button.classList.add('active');
    pane.hidden = false;
    paneTitle.textContent = t.title;
    setPaneNote('');
    turnBtn.disabled = false;
    showPicture(t);
  }

  async function turnIn3d() {
    if (!selected || view) return;
    const t = selected.tile;
    const my = ++viewSeq;
    turnBtn.disabled = true;
    setPaneNote('Loading the 3D preview…');
    let scene = null;
    try {
      let url = await fetchSmithsonianThumbGlb(t.id, doFetch, source);
      if (my !== viewSeq) return;
      if (!url) { url = t.glbUrl; setPaneNote('No small preview for this one: loading the full model (~0.8 MB)…'); }
      const res = await doFetch(url);
      if (!res || !res.ok) throw new Error(`the download answered ${res ? res.status : '?'}${res && res.statusText ? ` ${res.statusText}` : ''}`);
      const buf = await res.arrayBuffer();
      if (my !== viewSeq) return;
      scene = await loadGlbScene(buf);
      if (my !== viewSeq) return;
      const soup = soupFromGltfScene(scene);
      media.textContent = '';
      view = createSoupView(media, soup);
      setPaneNote('Drag to turn it.');
    } catch (e) {
      if (my !== viewSeq) return;
      setPaneNote(`Could not show it in 3D: ${msgOf(e)}`, true); // the picture stays
      turnBtn.disabled = false;
    } finally {
      disposeGltfScene(scene); // the view has its own copy (the soup)
    }
  }

  function insert() {
    if (!selected) return;
    const t = selected.tile;
    try { if (onPick) onPick(t); } finally { close(); }
  }

  // ── wiring ──
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() {
    if (closed) return;
    closed = true;
    viewSeq++;
    disposeView();
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  }
  closeBtn.addEventListener('click', close);
  searchBtn.addEventListener('click', search);
  query.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
  more.addEventListener('click', () => load(false));
  turnBtn.addEventListener('click', turnIn3d);
  insertBtn.addEventListener('click', insert);
  document.addEventListener('keydown', onKey);

  load(true); // the whole collection, page 0
  return { overlay, close };
}

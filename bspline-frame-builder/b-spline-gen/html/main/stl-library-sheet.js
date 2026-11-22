/**
 * main/stl-library-sheet.js -- SMITHSONIAN-BROWSER (SMITHSONIAN-BROWSER-DESIGN.md, Fred's answers in section 7): a FULL-SCREEN
 * sheet that pages the WHOLE collection straight away (24 at a time, "More results"), a search box and a MUSEUM PICKER (a native
 * <select>). Tapping a tile SELECTS it and fills the PREVIEW PANE (beside the grid; above it on a phone): a large picture at once,
 * "Turn in 3D" for a turnable view of the model's small preview GLB, and "Insert", which hands the tile to `onPick` and closes.
 * Built on the app's own dialog classes (cad-modal-overlay / -window / -header / -body / -footer, as pull-changelist.js and the
 * editor's full-screen #svgEditorModal); the tile size is the shared PICKER_TILE. Nothing here touches the board: the caller's
 * onPick does the import (main/stl-panel.js).
 * The SHAPE filter (design section 8, Fred 2026-11-22): a native <select> (Any shape / Flat / Rod / Flat or rod) and, when it is
 * not Any, a ratio slider + number. Any = the live API exactly as before; otherwise the source's mirrored catalog
 * (core/stl/catalog.js), fetched once on first use and filtered here with the words + museum, giving the SAME tiles.
 */
import { SMITHSONIAN_SOURCE, fetchSmithsonianPage, downloadSmithsonianModelSoup } from '../core/stl/smithsonian.js';
import { CATALOG_FILTER, CATALOG_SHAPES, filterCatalog, catalogTiles, fetchCatalog } from '../core/stl/catalog.js';
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
  // the Shape filter (Fred 2026-11-22): a native select; not Any = the mirrored catalog (core/stl/catalog.js), with the ratio
  const shapeSel = el('select', { id: 'stlLibShape', class: 'stl-lib-shape', 'aria-label': 'Shape' },
    CATALOG_SHAPES.map(([id, label]) => el('option', { value: id, text: label })));
  shapeSel.value = CATALOG_FILTER.shape;
  const ratioAttrs = { min: String(CATALOG_FILTER.ratioMin), max: String(CATALOG_FILTER.ratioMax), step: String(CATALOG_FILTER.ratioStep) };
  const ratioSlider = el('input', { type: 'range', id: 'stlLibRatio', class: 'stl-lib-ratio-slider', 'aria-label': 'Ratio', ...ratioAttrs });
  const ratioNum = el('input', { type: 'number', id: 'stlLibRatioNum', class: 'stl-lib-ratio-num', 'aria-label': 'Ratio', ...ratioAttrs });
  ratioSlider.value = ratioNum.value = String(CATALOG_FILTER.ratio);
  const ratioRow = el('div', { id: 'stlLibRatioRow', class: 'slider-row stl-lib-ratio',
    title: 'Flat: thickness / width at most this. Rod: width / length at most this.' },
  [el('label', { for: 'stlLibRatio', text: 'Ratio' }), ratioSlider, ratioNum]);
  ratioRow.hidden = shapeSel.value === 'any';
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
    el('div', { class: 'stl-lib-search' }, [query, museum, shapeSel, searchBtn]),
    ratioRow,
    el('div', { class: 'stl-lib-main' }, [results, pane]),
  ]);
  const footer = el('div', { class: 'cad-modal-footer stl-lib-credit', text: source.credit });
  win.append(header, body, footer);
  overlay.appendChild(win);
  document.body.appendChild(overlay);

  // ── paging ──
  const st = { q: '', unit: '', page: 0, total: 0, seq: 0, shown: new Set(),
    shape: shapeSel.value, ratio: CATALOG_FILTER.ratio, catalogLoad: null, list: [] }; // list: the catalog's filtered models
  const setStatus = (text, isError = false) => { statusEl.textContent = text; statusEl.classList.toggle('stl-error', !!isError); };
  // what is SHOWN: the API's rowCount counts FILES (a bust and its base are two rows of one model), not models
  const showCount = () => {
    const n = st.shown.size;
    setStatus(st.total > 0 ? `${fmt(n)} model${n === 1 ? '' : 's'} shown${more.hidden ? '' : ' · more available'}` : 'No models found');
  };
  const appendTiles = (list) => {
    for (const t of list) {
      if (st.shown.has(t.id)) continue; // a model whose GLB rows straddle two pages shows once
      st.shown.add(t.id);
      grid.appendChild(tileEl(t));
    }
  };

  function tileEl(t) {
    const b = el('button', { type: 'button', class: 'stl-lib-tile', 'data-model-id': t.id, title: t.title });
    const img = el('img', { class: 'stl-lib-thumb', loading: 'lazy', src: t.thumbUrl, alt: '' });
    img.addEventListener('error', () => { img.remove(); b.classList.add('stl-lib-tile-text'); }, { once: true });
    b.append(img, el('span', { class: 'stl-lib-title', text: t.title }));
    b.addEventListener('click', () => select(t, b));
    return b;
  }

  async function load(reset) {
    if (st.shape !== 'any') return loadCatalog(reset);
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
      appendTiles(res.tiles);
      const end = Math.min((page + 1) * source.pageSize, st.total);
      more.hidden = end >= st.total;
      showCount();
    } catch (e) {
      if (closed || my !== st.seq) return;
      setStatus(msgOf(e), true);
      more.hidden = reset || !st.total; // a failed "More" can be tried again
    }
  }

  /**
   * Shape not Any: the source's mirrored catalog, fetched once on first use (a failed fetch is tried again next time), filtered
   * by the words + museum + shape + ratio, paged like the API (pageSize, More results). No network after the first load.
   */
  async function loadCatalog(reset) {
    const my = ++st.seq;
    const page = reset ? 0 : st.page + 1;
    if (reset) { grid.textContent = ''; st.shown.clear(); st.total = 0; }
    more.hidden = true;
    if (!st.catalogLoad) {
      setStatus('Loading the catalog…');
      st.catalogLoad = fetchCatalog(doFetch, source);
    }
    try {
      const cat = await st.catalogLoad;
      if (closed || my !== st.seq) return;
      if (reset) st.list = filterCatalog(cat, { q: st.q, unit: st.unit, shape: st.shape, ratio: st.ratio });
      st.page = page;
      st.total = st.list.length;
      const end = Math.min((page + 1) * source.pageSize, st.total);
      appendTiles(catalogTiles(cat, st.list.slice(page * source.pageSize, end), source));
      more.hidden = end >= st.total;
      showCount();
    } catch (e) {
      st.catalogLoad = null;
      if (closed || my !== st.seq) return;
      setStatus(msgOf(e), true);
    }
  }
  const search = () => { st.q = query.value.trim(); st.unit = museum.value; return load(true); };

  // the ratio re-filters live (debounced, no network); the slider and the number box show the same value
  let ratioTimer = 0;
  const onRatio = (from, to) => {
    to.value = from.value;
    clearTimeout(ratioTimer);
    ratioTimer = setTimeout(() => { st.ratio = Number(from.value); if (!closed && st.shape !== 'any') load(true); }, CATALOG_FILTER.debounceMs);
  };
  const onShape = () => { st.shape = shapeSel.value; ratioRow.hidden = st.shape === 'any'; search(); };

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
    try {
      // the model's small preview GLB(s), upright from its Voyager scene (no scene: the Thumb lookup, then every Low part);
      // each loaded scene is freed once read: the view keeps the soup
      const onFullModel = () => { if (my === viewSeq) setPaneNote('No small preview for this one: loading the full model (~0.8 MB)…'); };
      const soup = await downloadSmithsonianModelSoup({ modelId: t.id, glbUri: t.glbUrl, preview: true, onFullModel }, doFetch, source);
      if (my !== viewSeq) return;
      media.textContent = '';
      view = createSoupView(media, soup);
      setPaneNote('Drag to turn it.');
    } catch (e) {
      if (my !== viewSeq) return;
      setPaneNote(`Could not show it in 3D: ${msgOf(e)}`, true); // the picture stays
      turnBtn.disabled = false;
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
    clearTimeout(ratioTimer);
    viewSeq++;
    disposeView();
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  }
  closeBtn.addEventListener('click', close);
  searchBtn.addEventListener('click', search);
  query.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
  more.addEventListener('click', () => load(false));
  shapeSel.addEventListener('change', onShape);
  ratioSlider.addEventListener('input', () => onRatio(ratioSlider, ratioNum));
  ratioNum.addEventListener('input', () => onRatio(ratioNum, ratioSlider));
  turnBtn.addEventListener('click', turnIn3d);
  insertBtn.addEventListener('click', insert);
  document.addEventListener('keydown', onKey);

  load(true); // the whole collection, page 0
  return { overlay, close };
}

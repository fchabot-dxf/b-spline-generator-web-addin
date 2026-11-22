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
 *
 * SEVERAL LIBRARIES (SMK-LIBRARY, design section 9; Fred 2026-11-22: "searching searches all libs at once and simply tells me
 * which libs they're from along their sizes etc"): given `libraries` (core/stl/libraries.js STL_LIBRARIES), a native Library
 * <select> heads the search row, ALL LIBRARIES by default. Every search runs as a list of FEEDS (one per library, or one per
 * object_name of an SMK Type), fetched in parallel (Promise.allSettled: a library that fails is one note line, the others still
 * show), merged ROUND-ROBIN into the one grid; "More results" asks every feed that has more for its next page. Each tile carries
 * a library badge and its size when the listing has it; the selected tile's pane names its library, licence and credit, and its
 * download size (asked for with a 1-byte Range request when not listed: the SELECTED tile only). A library's own filters
 * (the Smithsonian museum, SMK's Type) show only when that one library is picked; with All, the words + the Shape (a library
 * without shape data is left out of a Shape search, with a note). Opened with one source (no `libraries`), the sheet is the
 * Smithsonian sheet exactly as before (no Library picker, no badges).
 */
import { SMITHSONIAN_SOURCE } from '../core/stl/smithsonian.js';
import { CATALOG_FILTER, CATALOG_SHAPES, filterCatalog, catalogTiles, fetchCatalog, shapeOf } from '../core/stl/catalog.js';
import { ALL_LIBRARIES, LIBRARY_SHEET_LABEL, opsOf, downloadLibrarySoup, fetchDownloadSize, mbText, mbNumber } from '../core/stl/libraries.js';
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
/** The selected tile's size lookup (a 1-byte Range request) waits this long, so tapping through tiles sends nothing. */
export const SIZE_LOOKUP_DELAY_MS = 400;

/** The word a catalog box gives a tile ('flat', 'rod', 'flat, rod' at the ratio), or ''. */
const shapeWord = (d, ratio) => { const s = shapeOf(d, ratio); return [s.flat && 'flat', s.rod && 'rod'].filter(Boolean).join(', '); };

/**
 * Open the sheet. `fetchImpl` defaults to the page's fetch; `onPick(tile, library)` gets the chosen tile and the library it came
 * from. `libraries`: the declared list (several = the Library picker, All by default); none = the one `source`.
 * Returns { overlay, close }.
 */
export function openStlLibrarySheet({ source = SMITHSONIAN_SOURCE, libraries = null, fetchImpl, onPick } = {}) {
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const libs = Array.isArray(libraries) && libraries.length ? libraries : [source];
  const multi = libs.length > 1;
  const museumLib = libs.find((l) => Array.isArray(l.museums)) || null;
  const typeLib = libs.find((l) => Array.isArray(l.types)) || null;
  let closed = false;

  // ── the window ──
  const title = multi ? LIBRARY_SHEET_LABEL : libs[0].label;
  const overlay = el('div', { class: 'cad-modal-overlay stl-lib-overlay', id: 'stlLibraryOverlay', style: 'display:flex;' });
  const win = el('div', { class: 'cad-modal-window stl-lib-window', role: 'dialog', 'aria-label': title,
    style: 'width:100vw; height:100vh; max-width:none; max-height:none; border-radius:0;' });
  const closeBtn = el('button', { type: 'button', class: 'cad-btn cad-btn-secondary stl-lib-close', 'aria-label': 'Close', title: 'Close', text: '✕',
    style: 'min-width:32px; min-height:32px;' });
  const header = el('div', { class: 'cad-modal-header stl-lib-header' }, [el('span', { text: title }), closeBtn]);

  // ── the search row ──
  const librarySel = el('select', { id: 'stlLibLibrary', class: 'stl-lib-library', 'aria-label': 'Library' },
    [el('option', { value: ALL_LIBRARIES.id, text: ALL_LIBRARIES.label }), ...libs.map((l) => el('option', { value: l.id, text: l.label }))]);
  librarySel.value = multi ? ALL_LIBRARIES.id : libs[0].id;
  librarySel.hidden = !multi;
  const query = el('input', { type: 'search', id: 'stlLibQuery', class: 'stl-lib-query', placeholder: 'Search the collection', 'aria-label': 'Search' });
  const museum = museumLib ? el('select', { id: 'stlLibMuseum', class: 'stl-lib-museum', 'aria-label': 'Museum' },
    [el('option', { value: '', text: 'All museums' }), ...museumLib.museums.map(([code, name]) => el('option', { value: code, text: name }))]) : null;
  const typeSel = typeLib ? el('select', { id: 'stlLibType', class: 'stl-lib-type', 'aria-label': 'Type' },
    typeLib.types.map(([id, label]) => el('option', { value: id, text: label }))) : null;
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
  const searchBtn = el('button', { type: 'button', id: 'stlLibSearch', class: 'cad-btn cad-btn-primary', text: 'Search' });
  const statusEl = el('div', { id: 'stlLibStatus', class: 'photo-layer-note stl-lib-status', role: 'status' });
  const notesEl = el('div', { id: 'stlLibNotes', class: 'photo-layer-note stl-lib-notes', role: 'status' });
  notesEl.hidden = true;
  const grid = el('div', { id: 'stlLibGrid', class: 'stl-lib-grid', style: `grid-template-columns: repeat(auto-fill, minmax(${PICKER_TILE.tilePx}px, 1fr));` });
  const more = el('button', { type: 'button', id: 'stlLibMore', class: 'cad-btn cad-btn-secondary stl-lib-more', text: 'More results' });
  more.hidden = true;

  // ── the preview pane ──
  const pane = el('div', { id: 'stlLibPane', class: 'stl-lib-pane' });
  pane.hidden = true;
  const media = el('div', { class: 'stl-lib-pane-media' });
  const paneTitle = el('div', { class: 'stl-lib-pane-title' });
  const paneInfo = el('div', { id: 'stlLibPaneInfo', class: 'photo-layer-note stl-lib-pane-info' });
  paneInfo.hidden = true;
  const turnBtn = el('button', { type: 'button', id: 'stlLibTurn', class: 'cad-btn cad-btn-secondary', text: 'Turn in 3D' });
  const insertBtn = el('button', { type: 'button', id: 'stlLibInsert', class: 'cad-btn cad-btn-primary', text: 'Insert' });
  const paneNote = el('div', { id: 'stlLibPaneNote', class: 'photo-layer-note stl-lib-pane-note', role: 'status' });
  paneNote.hidden = true;
  pane.append(media, paneTitle, paneInfo, el('div', { class: 'stl-lib-pane-buttons' }, [turnBtn, insertBtn]), paneNote);

  const results = el('div', { class: 'stl-lib-results' }, [statusEl, notesEl, grid, more]);
  const body = el('div', { class: 'cad-modal-body stl-lib-body' }, [
    el('div', { class: 'stl-lib-search' }, [librarySel, query, museum, typeSel, shapeSel, searchBtn]),
    ratioRow,
    el('div', { class: 'stl-lib-main' }, [results, pane]),
  ]);
  const footer = el('div', { class: 'cad-modal-footer stl-lib-credit' });
  win.append(header, body, footer);
  overlay.appendChild(win);
  document.body.appendChild(overlay);

  // ── which libraries, which filters ──
  const st = { q: '', unit: '', type: 'all', seq: 0, shown: new Set(), feeds: [], notes: [],
    shape: shapeSel.value, ratio: CATALOG_FILTER.ratio, catalogLoads: new Map() }; // catalogLoads: library id -> its catalog's promise
  /** The ONE picked library, or null for All. */
  const only = () => (librarySel.value === ALL_LIBRARIES.id ? null : libs.find((l) => l.id === librarySel.value) || libs[0]);
  const activeLibs = () => (only() ? [only()] : libs);
  /** Show the filters of what is picked: a library's own only when it is the one; with All the common ones (words, Shape). */
  function refreshFilters() {
    const one = only();
    if (museum) museum.hidden = !(one && one.museums);
    if (typeSel) typeSel.hidden = !(one && one.types);
    shapeSel.hidden = !activeLibs().some((l) => l.shape !== false);
    ratioRow.hidden = shapeSel.hidden || st.shape === 'any';
    footer.textContent = activeLibs().map((l) => l.credit).join(' ');
  }
  refreshFilters();

  // ── the feeds: one paged search each (a library, or one object_name of an SMK Type) ──
  function buildFeeds() {
    const one = only();
    const shape = shapeSel.hidden ? 'any' : st.shape;
    const filters = { q: st.q, unit: one && one.museums ? st.unit : '', type: one && one.types ? st.type : 'all' };
    const feeds = [], notes = [];
    for (const lib of activeLibs()) {
      if (shape !== 'any') {
        if (lib.shape === false || !lib.catalogPath) { notes.push(`${lib.short || lib.label}: no shape data (left out of a Shape search).`); continue; }
        feeds.push({ lib, kind: 'catalog', filters: { ...filters, shape, ratio: st.ratio }, page: -1, total: 0, known: false, done: false, list: [] });
        continue;
      }
      for (const opts of opsOf(lib).queries(filters)) feeds.push({ lib, kind: 'api', opts, page: -1, total: 0, known: false, done: false });
    }
    return { feeds, notes };
  }
  const catalogOf = (lib) => {
    let load = st.catalogLoads.get(lib.id);
    if (!load) { load = fetchCatalog(doFetch, lib); st.catalogLoads.set(lib.id, load); }
    return load;
  };
  /** One page of one feed -> { total, items: [{ tile, meta }] }. meta = { size (bytes) | null, shape ('flat' ...) | '' }. */
  async function fetchFeed(f, page) {
    if (f.kind === 'catalog') {
      let cat;
      try { cat = await catalogOf(f.lib); } catch (e) { st.catalogLoads.delete(f.lib.id); throw e; } // a failed load is tried again next time
      if (page === 0) f.list = filterCatalog(cat, f.filters);
      const models = f.list.slice(page * f.lib.pageSize, Math.min((page + 1) * f.lib.pageSize, f.list.length));
      const tiles = catalogTiles(cat, models, f.lib);
      return { total: f.list.length, items: tiles.map((tile, i) => ({ tile, meta: { size: null, shape: shapeWord(models[i].d, f.filters.ratio) } })) };
    }
    const res = await opsOf(f.lib).fetchPage(f.lib, f.opts, page, doFetch);
    return { total: res.total, items: res.tiles.map((tile) => ({ tile, meta: { size: Number.isFinite(tile.sizeBytes) ? tile.sizeBytes : null, shape: '' } })) };
  }

  // ── paging ──
  const setStatus = (text, isError = false) => { statusEl.textContent = text; statusEl.classList.toggle('stl-error', !!isError); };
  const setNotes = (lines) => { notesEl.textContent = ''; for (const l of lines) notesEl.appendChild(el('div', { text: l })); notesEl.hidden = !lines.length; };
  // what is SHOWN: the API's rowCount counts FILES (a bust and its base are two rows of one model), not models
  const showCount = () => {
    const n = st.shown.size;
    const total = st.feeds.reduce((s, f) => s + (f.known ? f.total : 0), 0);
    setStatus(total > 0 ? `${fmt(n)} model${n === 1 ? '' : 's'} shown${more.hidden ? '' : ' · more available'}` : 'No models found');
  };
  const appendTiles = (items) => {
    for (const it of items) {
      const key = `${it.lib.id}|${it.tile.id}`;
      if (st.shown.has(key)) continue; // a model whose GLB rows straddle two pages shows once
      st.shown.add(key);
      grid.appendChild(tileEl(it.tile, it.lib, it.meta));
    }
  };
  /** The feeds' pages merged ROUND-ROBIN (one of each in turn), so one big library does not bury the others. */
  const roundRobin = (lists) => {
    const out = [];
    for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) out.push(l[i]);
    return out;
  };

  function tileEl(t, lib, meta) {
    const b = el('button', { type: 'button', class: 'stl-lib-tile', 'data-model-id': t.id, 'data-library': lib.id, title: t.title });
    if (t.thumbUrl) {
      const img = el('img', { class: 'stl-lib-thumb', loading: 'lazy', src: t.thumbUrl, alt: '' });
      img.addEventListener('error', () => { img.remove(); b.classList.add('stl-lib-tile-text'); }, { once: true });
      b.appendChild(img);
    } else b.classList.add('stl-lib-tile-text');
    b.appendChild(el('span', { class: 'stl-lib-title', text: t.title }));
    if (multi) { // which library, and its size / shape when the listing has them (no request per tile)
      b.appendChild(el('span', { class: 'stl-lib-meta' }, [
        el('span', { class: 'stl-lib-badge', text: lib.short || lib.label }),
        meta.size != null ? el('span', { class: 'stl-lib-size', text: mbText(meta.size) }) : null,
        meta.shape ? el('span', { class: 'stl-lib-shape-word', text: meta.shape }) : null,
      ]));
    }
    b.addEventListener('click', () => select(t, b, lib, meta));
    return b;
  }

  async function load(reset) {
    const my = ++st.seq;
    if (reset) {
      grid.textContent = '';
      st.shown.clear();
      Object.assign(st, buildFeeds());
    }
    more.hidden = true;
    const want = reset ? st.feeds : st.feeds.filter((f) => f.known && !f.done);
    setStatus(want.some((f) => f.kind === 'catalog' && !st.catalogLoads.has(f.lib.id)) ? 'Loading the catalog…' : 'Loading…');
    setNotes(st.notes);
    const res = await Promise.allSettled(want.map((f) => fetchFeed(f, f.page + 1)));
    if (closed || my !== st.seq) return; // a newer search (or the close) won
    const lists = [], failed = [];
    res.forEach((r, i) => {
      const f = want[i];
      if (r.status !== 'fulfilled') { failed.push([f, r.reason]); return; }
      f.page += 1;
      f.total = r.value.total;
      f.known = true;
      f.done = Math.min((f.page + 1) * f.lib.pageSize, f.total) >= f.total;
      lists.push(r.value.items.map((it) => ({ ...it, lib: f.lib })));
    });
    appendTiles(roundRobin(lists));
    more.hidden = !st.feeds.some((f) => f.known && !f.done); // a failed "More" can be tried again
    const failNotes = [...new Map(failed.map(([f, e]) => [f.lib.id, `${f.lib.short || f.lib.label}: ${msgOf(e)}`])).values()];
    if (failed.length && failed.length === want.length && !multi) setStatus(msgOf(failed[0][1]), true);
    else if (failed.length && failed.length === want.length && !st.feeds.some((f) => f.known)) setStatus(msgOf(failed[0][1]), true);
    else showCount();
    if (multi) setNotes([...st.notes, ...failNotes]);
  }
  const search = () => { st.q = query.value.trim(); st.unit = museum ? museum.value : ''; st.type = typeSel ? typeSel.value : 'all'; return load(true); };

  // the ratio re-filters live (debounced, no network); the slider and the number box show the same value
  let ratioTimer = 0;
  const onRatio = (from, to) => {
    to.value = from.value;
    clearTimeout(ratioTimer);
    ratioTimer = setTimeout(() => { st.ratio = Number(from.value); if (!closed && st.shape !== 'any') load(true); }, CATALOG_FILTER.debounceMs);
  };
  const onShape = () => { st.shape = shapeSel.value; refreshFilters(); search(); };
  const onLibrary = () => { refreshFilters(); search(); };

  // ── the preview ──
  let selected = null;     // { tile, button, lib }
  let view = null;         // the 3D view (createSoupView), or null
  let viewSeq = 0;         // bumps on every selection / close: a 3D load for an older one is dropped
  let selSeq = 0;          // bumps on every selection / close: a size lookup for an older selection is dropped
  let sizeTimer = 0;       // the pending size lookup of the selected tile
  const setPaneNote = (text, isError = false) => { paneNote.textContent = text || ''; paneNote.hidden = !text; paneNote.classList.toggle('stl-error', !!isError); };
  const disposeView = () => { if (view) { view.dispose(); view = null; } };
  /** What Turn in 3D will download for an STL library (the model itself), before it is pressed. */
  const stlTurnNote = (size) => (size != null ? `Turn in 3D downloads the model (~${mbText(size)}).` : 'Turn in 3D downloads the whole model.');

  function showPicture(t) {
    media.textContent = '';
    if (!t.previewUrl && !t.thumbUrl) return; // no picture at all: the title alone
    // Fred 2026-11-22 (the SMK pane looked empty: its large picture takes 1-2 s to arrive): the THUMBNAIL (already loaded by
    // the grid) sits BEHIND the picture as a placeholder, so the pane shows the model at once; the large picture covers it
    // when it has loaded. The picture itself is unchanged (src, fallbacks).
    const img = el('img', { class: 'stl-lib-preview', src: t.previewUrl || t.thumbUrl, alt: '' });
    if (t.thumbUrl && t.previewUrl) img.style.backgroundImage = `url("${t.thumbUrl}")`; // the placeholder (CSS: .stl-lib-preview)
    let fellBack = !t.previewUrl;
    img.addEventListener('error', () => {
      if (!fellBack) { fellBack = true; img.setAttribute('src', t.thumbUrl); } else img.remove(); // the thumbnail, then the title alone
    });
    media.appendChild(img);
  }

  /** The pane's library lines: its name + licence, the download size (asked for when not listed), the object's size, the credit. */
  function showInfo(t, lib, meta, my) {
    paneInfo.textContent = '';
    paneInfo.hidden = !multi;
    if (!multi) return;
    const sizeLine = el('div', { class: 'stl-lib-pane-size' });
    const fileWord = lib.format === 'stl' ? 'STL download' : 'GLB file';
    const setSize = (n) => {
      sizeLine.textContent = n != null ? `${fileWord}: ${mbText(n)}${lib.format === 'glb' ? ' (only its geometry downloads)' : ''}` : `${fileWord}: size unknown`;
    };
    const dims = t.dims ? ['w', 'h', 'd'].filter((k) => k in t.dims) : [];
    paneInfo.append(
      el('div', { text: `${lib.label} · ${t.licence || lib.licence || ''}` }),
      sizeLine,
      dims.length ? el('div', { text: `Object: ${dims.map((k) => t.dims[k]).join(' × ')} ${t.dims.unit} (${dims.map((k) => k.toUpperCase()).join(' × ')})` }) : null,
      el('div', { class: 'stl-lib-pane-credit', text: lib.credit }),
    );
    if (meta.size != null) { setSize(meta.size); return; }
    sizeLine.textContent = `${fileWord}: checking the size…`;
    // asked once the tile has stayed selected a moment: tapping through tiles (or Insert straight away) sends nothing
    clearTimeout(sizeTimer);
    sizeTimer = setTimeout(() => {
      if (my !== selSeq || closed) return;
      fetchDownloadSize(opsOf(lib).fileUrl(t), doFetch).then((n) => {
        if (my !== selSeq || closed) return;
        if (n != null) meta.size = n;
        setSize(n);
        if (lib.format === 'stl' && !view) setPaneNote(stlTurnNote(n));
      });
    }, SIZE_LOOKUP_DELAY_MS);
  }

  function select(t, button, lib, meta) {
    viewSeq++;
    const my = ++selSeq;
    disposeView();
    if (selected) selected.button.classList.remove('active');
    selected = { tile: t, button, lib, meta };
    button.classList.add('active');
    pane.hidden = false;
    paneTitle.textContent = t.title;
    setPaneNote(lib.format === 'stl' ? stlTurnNote(meta.size) : '');
    turnBtn.disabled = false;
    showPicture(t);
    showInfo(t, lib, meta, my);
  }

  async function turnIn3d() {
    if (!selected || view) return;
    const { tile: t, lib } = selected;
    const my = ++viewSeq;
    turnBtn.disabled = true;
    setPaneNote('Loading the 3D preview…');
    try {
      // Smithsonian: the model's small preview GLB(s), upright from its Voyager scene (no scene: the Thumb lookup, then every
      // Low part). SMK: the STL itself, shown upright. Each loaded scene is freed once read: the view keeps the soup.
      const onFullModel = () => { if (my === viewSeq) setPaneNote('No small preview for this one: loading the full model (~0.8 MB)…'); };
      const onProgress = (got, total) => { if (my === viewSeq) setPaneNote(`Loading the 3D preview… ${mbNumber(got)}${total ? ` of ${mbNumber(total)}` : ''} MB`); };
      const soup = await downloadLibrarySoup(lib, { id: t.id, uri: opsOf(lib).fileUrl(t) }, doFetch, { preview: true, onFullModel, onProgress });
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
    const { tile, lib } = selected;
    try { if (onPick) onPick(tile, lib); } finally { close(); }
  }

  // ── wiring ──
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(ratioTimer);
    clearTimeout(sizeTimer);
    viewSeq++;
    selSeq++;
    disposeView();
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  }
  closeBtn.addEventListener('click', close);
  searchBtn.addEventListener('click', search);
  query.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
  more.addEventListener('click', () => load(false));
  librarySel.addEventListener('change', onLibrary);
  typeSel?.addEventListener('change', search);
  shapeSel.addEventListener('change', onShape);
  ratioSlider.addEventListener('input', () => onRatio(ratioSlider, ratioNum));
  ratioNum.addEventListener('input', () => onRatio(ratioNum, ratioSlider));
  turnBtn.addEventListener('click', turnIn3d);
  insertBtn.addEventListener('click', insert);
  document.addEventListener('keydown', onKey);

  load(true); // the whole collection (every library), page 0
  return { overlay, close };
}

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
import { ALL_LIBRARIES, LIBRARY_SHEET_LABEL, opsOf, downloadLibrarySoup, fetchDownloadSize, mbText, mbNumber, libraryById } from '../core/stl/libraries.js';
import { transformSoup } from '../core/stl/gltf.js';
import { cropBoxIn, isFullCropBox, normaliseCropBox } from '../core/stl/crop.js';
import { RECENT_LIBRARY, LOCAL_LIBRARY, readRecent, localModels } from '../core/stl/recent.js';
import { PICKER_TILE } from './icon-select.js';
import { createSoupView } from './stl-preview-3d.js';
import { renderCropSliders } from './stl-crop-controls.js';

const el = (tag, attrs = {}, kids = []) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'style') e.style.cssText = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v); }
  for (const k of kids) if (k) e.appendChild(k);
  return e;
};
/** The neutral stand-in for a picture that is missing or would not load: an icon + 'no picture' (never an empty box). */
const noPicture = (cls) => el('div', { class: cls, role: 'img', 'aria-label': 'no picture' }, [el('span', { class: 'stl-lib-nopic-icon', text: '🖼' }), el('span', { text: 'no picture' })]);
const msgOf = (e) => (e && e.message ? e.message : String(e));
const fmt = (n) => Number(n).toLocaleString('en-US');
/** The selected tile's size lookup (a 1-byte Range request) waits this long, so tapping through tiles sends nothing. */
export const SIZE_LOOKUP_DELAY_MS = 400;

/** Box { min, max } turned by the unit quaternion `q` (null = as it is), as the axis-aligned box of its 8 turned corners: exact
 *  for the quarter turns a library's previewTurn is (core/stl/smk.js). */
function turnedBox(b, q) {
  if (!q) return b;
  const pts = [];
  for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) pts.push(x, y, z);
  const t = transformSoup(Float32Array.from(pts), { rotation: q });
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < t.length; i += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], t[i + a]); max[a] = Math.max(max[a], t[i + a]); }
  return { min, max };
}
const inverseTurn = (q) => (q ? [-q[0], -q[1], -q[2], q[3]] : null);

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
  // 'Recent' (core/stl/recent.js, Fred 2026-11-22) is the FIRST choice, listed when something was inserted lately (or an own
  // file is in memory); All libraries stays the default
  const hasRecent = multi && (readRecent().length > 0 || localModels().length > 0);
  const librarySel = el('select', { id: 'stlLibLibrary', class: 'stl-lib-library', 'aria-label': 'Library' },
    [hasRecent ? el('option', { value: RECENT_LIBRARY.id, text: RECENT_LIBRARY.label }) : null,
      el('option', { value: ALL_LIBRARIES.id, text: ALL_LIBRARIES.label }), ...libs.map((l) => el('option', { value: l.id, text: l.label }))]);
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
  const picHost = el('div', { class: 'stl-lib-pane-pic' });      // the 2D picture
  const viewHost = el('div', { class: 'stl-lib-pane-3d' });      // the 3D view (kept, hidden, while 2D shows)
  viewHost.hidden = true;
  const media = el('div', { class: 'stl-lib-pane-media' }, [picHost, viewHost]);
  const paneTitle = el('div', { class: 'stl-lib-pane-title' });
  const paneInfo = el('div', { id: 'stlLibPaneInfo', class: 'photo-layer-note stl-lib-pane-info' });
  paneInfo.hidden = true;
  // the 2D | 3D pill: the main view's own switch (main/view-mode-toggle.js renderPill: class view-mode-toggle, same look)
  const pill = el('div', { class: 'view-mode-toggle stl-lib-pill', role: 'group', 'aria-label': '2D / 3D view',
    style: 'display:flex; border-radius:14px; overflow:hidden; border:1px solid rgba(0,0,0,0.2); box-shadow:0 1px 4px rgba(0,0,0,0.18); background:#fff; font:600 11px sans-serif;' });
  const pillBtn = (id, text, title) => el('button', { type: 'button', id, text, title, 'aria-pressed': 'false' });
  const view2dBtn = pillBtn('stlLibView2d', '2D', 'The picture');
  const turnBtn = pillBtn('stlLibTurn', '3D', 'Turn the model in 3D');
  pill.append(view2dBtn, turnBtn);
  let mode = '2d';         // which half of the pill shows
  const stylePill = () => {
    for (const [b, on] of [[view2dBtn, mode === '2d'], [turnBtn, mode === '3d']]) {
      b.setAttribute('aria-pressed', String(on));
      b.style.cssText = `border:none; padding:5px 14px; cursor:${on ? 'default' : 'pointer'};`
        + (on ? ' background:var(--cad-accent-blue, #0078d4); color:#fff;' : ' background:#fff; color:#444;');
    }
  };
  stylePill();
  const insertBtn = el('button', { type: 'button', id: 'stlLibInsert', class: 'cad-btn cad-btn-primary', text: 'Insert' });
  const paneNote = el('div', { id: 'stlLibPaneNote', class: 'photo-layer-note stl-lib-pane-note', role: 'status' });
  paneNote.hidden = true;
  // CROP mode (STL-CROP, Fred 2026-11-22): the box in the 3D view (kept solid, the cut-away part faint) + the six shared sliders
  // (% of the model's own box, in the frame of the mesh that is stored); Insert cuts the downloaded model to it before it is stored
  const cropBtn = el('button', { type: 'button', id: 'stlLibCrop', class: 'cad-btn cad-btn-secondary stl-lib-crop-btn', text: '✂ Crop', 'aria-pressed': 'false',
    title: 'Cut the model to a box before it is inserted: only the kept part is stored' });
  const cropHost = el('div', { id: 'stlLibCropBox', class: 'stl-lib-crop' });
  cropHost.hidden = true;
  const cropSlidersHost = el('div', { class: 'stl-crop-sliders' });
  const cropReset = el('button', { type: 'button', id: 'stlLibCropReset', class: 'cad-btn cad-btn-secondary', text: '↺ Reset', title: 'The whole model again' });
  const cropNote = el('div', { id: 'stlLibCropNote', class: 'photo-layer-note', text: 'In the 3D view: kept = solid, cut away = faint. Insert stores only the kept part.' });
  cropHost.append(cropSlidersHost, el('div', { class: 'photo-layer-buttons' }, [cropReset]), cropNote);
  pane.append(media, paneTitle, paneInfo, el('div', { class: 'stl-lib-pane-buttons' }, [pill, cropBtn, insertBtn]), cropHost, paneNote);

  const totalsEl = el('div', { id: 'stlLibTotals', class: 'photo-layer-note stl-lib-totals' }); // each library's total, beside the status
  const sentinel = el('div', { id: 'stlLibSentinel', class: 'stl-lib-sentinel', 'aria-hidden': 'true' }); // endless scroll watches this
  const results = el('div', { class: 'stl-lib-results' }, [el('div', { class: 'stl-lib-statusrow' }, [statusEl, totalsEl]), notesEl, grid, sentinel, more]);
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
  const isRecent = () => librarySel.value === RECENT_LIBRARY.id;
  /** The ONE picked library, or null for All (and for Recent). */
  const only = () => (librarySel.value === ALL_LIBRARIES.id || isRecent() ? null : libs.find((l) => l.id === librarySel.value) || libs[0]);
  /** The libraries a search asks: none for Recent (its list is on this device). */
  const activeLibs = () => (isRecent() ? [] : only() ? [only()] : libs);
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
    if (isRecent()) return { feeds: [{ lib: RECENT_LIBRARY, kind: 'recent', page: -1, total: 0, known: false, done: false }], notes: [] };
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
    if (f.kind === 'recent') { // this device's Recent list + the own files still in memory, newest first; the words narrow it
      const words = st.q.toLowerCase().split(/\s+/).filter(Boolean);
      const hit = (title) => words.every((w) => String(title || '').toLowerCase().includes(w));
      const items = [];
      for (const m of localModels()) {
        if (hit(m.title)) items.push({ at: m.at, tile: { id: m.id, title: m.title, thumbUrl: '', previewUrl: '' }, lib: LOCAL_LIBRARY, meta: { size: null, shape: '', crop: null } });
      }
      for (const e of readRecent()) {
        const lib = libraryById(e.libraryId);
        if (lib && hit(e.title)) items.push({ at: e.insertedAt, tile: e.tile, lib, meta: { size: Number.isFinite(e.tile.sizeBytes) ? e.tile.sizeBytes : null, shape: '', crop: e.crop || null } });
      }
      items.sort((a, b) => (b.at || 0) - (a.at || 0));
      return { total: items.length, items };
    }
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
  /** Each library's total, from its answers ("Smithsonian 3,523 · SMK 373"); a library with no known total shows nothing. */
  const showTotals = () => {
    if (!multi) { totalsEl.textContent = ''; return; }
    const sums = new Map();
    for (const f of st.feeds) if (f.known) sums.set(f.lib, (sums.get(f.lib) || 0) + f.total);
    totalsEl.textContent = [...sums].map(([lib, n]) => `${lib.short || lib.label} ${fmt(n)}`).join(' · ');
  };
  const showCount = () => {
    showTotals();
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
      img.addEventListener('error', () => { img.replaceWith(noPicture('stl-lib-thumb stl-lib-nopic')); }, { once: true });
      b.appendChild(img);
    } else b.appendChild(noPicture('stl-lib-thumb stl-lib-nopic'));
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

  let pending = 0; // the seq of the page load in flight (0 = none): endless scroll never starts a second one
  async function load(reset) {
    const my = ++st.seq;
    pending = my;
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
    pending = 0;
    const lists = [], failed = [];
    res.forEach((r, i) => {
      const f = want[i];
      if (r.status !== 'fulfilled') { failed.push([f, r.reason]); return; }
      f.page += 1;
      f.total = r.value.total;
      f.known = true;
      f.done = Math.min((f.page + 1) * f.lib.pageSize, f.total) >= f.total;
      lists.push(r.value.items.map((it) => ({ ...it, lib: it.lib || f.lib }))); // a Recent item names its own library
    });
    appendTiles(roundRobin(lists));
    more.hidden = !st.feeds.some((f) => f.known && !f.done); // a failed "More" can be tried again
    const failNotes = [...new Map(failed.map(([f, e]) => [f.lib.id, `${f.lib.short || f.lib.label}: ${msgOf(e)}`])).values()];
    if (failed.length && failed.length === want.length && !multi) setStatus(msgOf(failed[0][1]), true);
    else if (failed.length && failed.length === want.length && !st.feeds.some((f) => f.known)) setStatus(msgOf(failed[0][1]), true);
    else showCount();
    if (multi) setNotes([...st.notes, ...failNotes]);
    showTotals();
    watchSentinel(); // still in view after this page (a short page): look again
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

  let pic = null;          // the 2D picture element (detached while the 3D half shows)
  let stay2d = false;      // 2D was pressed while the 3D view was still loading: it loads, but 2D stays
  let lightbox = null;     // the open lightbox: { box, close }

  // ── Crop mode: the box is FRACTIONS of the model's own box in the STORED mesh's frame (core/stl/crop.js). The 3D view shows
  // the preview soup, which a library may have turned for its camera (lib.previewTurn): the stored frame's box is its box turned
  // back, and the crop box is drawn turned the same way. ──
  let cropOn = false;
  const cropCtl = renderCropSliders(cropSlidersHost, { idPrefix: 'stlLibCrop', onInput: () => showCropInView() });
  const styleCrop = () => { cropBtn.setAttribute('aria-pressed', String(cropOn)); cropBtn.classList.toggle('active', cropOn); cropHost.hidden = !cropOn; };
  function showCropInView() {
    if (!view || typeof view.setCropBox !== 'function') return;
    if (!cropOn) { view.setCropBox(null); return; }
    const q = (selected && selected.lib.previewTurn) || null;
    const stored = turnedBox(view.bounds, inverseTurn(q));
    view.setCropBox(turnedBox(cropBoxIn(stored, cropCtl.get()), q));
  }
  async function toggleCrop() {
    if (!selected) return;
    cropOn = !cropOn;
    styleCrop();
    if (!cropOn) { showCropInView(); return; }
    if (view) { setMode('3d'); showCropInView(); setPaneNote('Drag to turn it.'); } else await turnIn3d(); // the view shows the box once loaded
  }
  /** Show the 2D or the 3D half. The picture is DETACHED while 3D shows (and put back on 2D); the 3D view is only hidden. */
  function setMode(m) {
    mode = m;
    if (m === '3d' && view) { picHost.textContent = ''; viewHost.hidden = false; } else { mode = '2d'; viewHost.hidden = true; if (pic) picHost.appendChild(pic); }
    stylePill();
  }
  function showPicture(t) {
    picHost.textContent = '';
    pic = null;
    if (!t.previewUrl && !t.thumbUrl) { picHost.appendChild(noPicture('stl-lib-preview stl-lib-nopic')); return; } // no picture at all: the placeholder
    // Fred 2026-11-22 (the SMK pane looked empty: its large picture takes 1-2 s to arrive): the THUMBNAIL (already loaded by
    // the grid) sits BEHIND the picture as a placeholder, so the pane shows the model at once; the large picture covers it
    // when it has loaded. The picture itself is unchanged (src, fallbacks).
    const img = el('img', { class: 'stl-lib-preview', src: t.previewUrl || t.thumbUrl, alt: '', title: 'Tap to enlarge' });
    if (t.thumbUrl && t.previewUrl) img.style.backgroundImage = `url("${t.thumbUrl}")`; // the placeholder (CSS: .stl-lib-preview)
    let fellBack = !t.previewUrl;
    img.addEventListener('error', () => {
      if (!fellBack) { fellBack = true; img.setAttribute('src', t.thumbUrl); } else { img.replaceWith(noPicture('stl-lib-preview stl-lib-nopic')); if (pic === img) pic = null; } // the thumbnail, then the placeholder
    });
    img.addEventListener('click', () => openLightbox());
    pic = img;
    picHost.appendChild(img);
  }

  /** The pane's library lines: its name + licence, the download size (asked for when not listed), the object's size, the credit. */
  function showInfo(t, lib, meta, my) {
    paneInfo.textContent = '';
    paneInfo.hidden = !multi;
    if (!multi) return;
    const sizeLine = el('div', { class: 'stl-lib-pane-size' });
    const fileWord = lib.format === 'stl' ? 'STL download' : 'GLB file';
    const setSize = (n) => {
      sizeLine.hidden = n == null; // an unknown value is not a line ('size unknown' is dropped)
      sizeLine.textContent = n != null ? `${fileWord}: ${mbText(n)}${lib.format === 'glb' ? ' (only its geometry downloads)' : ''}` : '';
    };
    const dims = t.dims ? ['w', 'h', 'd'].filter((k) => k in t.dims) : [];
    paneInfo.append(
      el('div', { text: `${lib.label} · ${t.licence || lib.licence || ''}` }),
      sizeLine,
      ...(dims.length ? [el('div', { text: `Object: ${dims.map((k) => t.dims[k]).join(' × ')} ${t.dims.unit || ''} (${dims.map((k) => k.toUpperCase()).join(' × ')})` })] : []), // Node.append(null) would print 'null'
      el('div', { class: 'stl-lib-pane-credit', text: lib.credit || '' }),
    );
    if (meta.size != null) { setSize(meta.size); return; }
    if (!opsOf(lib).fileUrl(t)) { sizeLine.textContent = 'In memory (this session)'; return; } // an own file (Recent): nothing to ask
    sizeLine.hidden = false;
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
    closeLightbox();
    mode = '2d';
    viewHost.hidden = true;
    stylePill();
    if (selected) selected.button.classList.remove('active');
    selected = { tile: t, button, lib, meta };
    button.classList.add('active');
    pane.hidden = false;
    // phone (one column, the pane ABOVE the grid in the scrolling body): bring the pane into view, else a tap far down the grid
    // leaves the preview scrolled off the top; wide layout: keep the tile in view
    try {
      const narrow = !!window.matchMedia?.('(max-width: 600px)').matches;
      if (!narrow) button.scrollIntoView?.({ block: 'nearest' });
      else { // the pane is pinned (sticky) at the top of the sheet; if it is not on screen anyway, bring it in
        const r = pane.getBoundingClientRect(), b = body.getBoundingClientRect();
        if (r.height && (r.top < b.top - 1 || r.bottom > b.bottom + 1)) pane.scrollIntoView?.({ block: 'start' });
      }
    } catch (_) { /* not scrollable here */ }
    paneTitle.textContent = t.title;
    setPaneNote(lib.format === 'stl' ? stlTurnNote(meta.size) : '');
    turnBtn.disabled = false;
    // a Recent model comes back with the crop it was inserted with (Insert re-applies it); any other starts uncropped
    cropCtl.set(meta.crop || null);
    cropOn = !!(meta.crop && !isFullCropBox(meta.crop));
    styleCrop();
    showPicture(t);
    showInfo(t, lib, meta, my);
  }

  async function turnIn3d() {
    if (!selected) return;
    if (view) { setMode('3d'); setPaneNote('Drag to turn it.'); return; } // already loaded: instant
    if (turnBtn.disabled) return;
    stay2d = false;
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
      viewHost.hidden = false; // visible while it measures its width
      picHost.textContent = '';
      view = createSoupView(viewHost, soup);
      showCropInView();
      turnBtn.disabled = false;
      setMode(stay2d ? '2d' : '3d');
      setPaneNote(stay2d ? '' : 'Drag to turn it.');
    } catch (e) {
      if (my !== viewSeq) return;
      setPaneNote(`Could not show it in 3D: ${msgOf(e)}`, true); // the picture stays
      turnBtn.disabled = false;
      setMode('2d');
    }
  }

  // ── the lightbox: the large picture over the sheet; wheel / pinch / double-tap zoom, drag pan, a close button, Esc ──
  const LIGHTBOX = Object.freeze({ maxScale: 8, wheelStep: 0.0015, doubleTapScale: 2.5, doubleTapMs: 300, tapSlopPx: 12 });
  function closeLightbox() { if (lightbox) { lightbox.box.remove(); lightbox = null; } }
  function openLightbox() {
    if (lightbox || !pic) return;
    const box = el('div', { class: 'cad-modal-overlay stl-lib-lightbox', role: 'dialog', 'aria-label': 'Enlarged picture', style: 'display:flex;' });
    const img = el('img', { class: 'stl-lib-lightbox-img', src: pic.getAttribute('src'), alt: '', draggable: 'false' });
    const x = el('button', { type: 'button', class: 'cad-btn cad-btn-secondary stl-lib-lightbox-close', 'aria-label': 'Close the picture', title: 'Close', text: '✕' });
    box.append(img, x);
    document.body.appendChild(box);
    const z = { s: 1, x: 0, y: 0 };
    const apply = () => { img.style.transform = `translate(${z.x}px, ${z.y}px) scale(${z.s})`; };
    /** Scale to `s2` keeping the screen point (px, py) still. */
    const zoomAt = (s2, px, py) => {
      s2 = Math.min(LIGHTBOX.maxScale, Math.max(1, s2));
      const r = box.getBoundingClientRect();
      const dx = px - (r.left + r.width / 2), dy = py - (r.top + r.height / 2);
      z.x = dx - (s2 / z.s) * (dx - z.x); z.y = dy - (s2 / z.s) * (dy - z.y);
      z.s = s2;
      if (z.s === 1) { z.x = 0; z.y = 0; }
      apply();
    };
    apply();
    box.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(z.s * Math.exp(-e.deltaY * LIGHTBOX.wheelStep), e.clientX, e.clientY); }, { passive: false });
    const ptrs = new Map(); // pointerId -> { x, y }
    let pinch = 0, lastTap = 0, moved = 0;
    const dist = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    img.addEventListener('pointerdown', (e) => {
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { img.setPointerCapture?.(e.pointerId); } catch (_) { /* not capturable */ }
      if (ptrs.size === 2) pinch = dist();
      moved = 0;
    });
    img.addEventListener('pointermove', (e) => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      if (ptrs.size === 2) {
        p.x = e.clientX; p.y = e.clientY;
        const d = dist(), [a, b] = [...ptrs.values()];
        if (pinch > 0) zoomAt(z.s * (d / pinch), (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinch = d; moved = LIGHTBOX.tapSlopPx + 1;
        return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      if (z.s > 1) { z.x += dx; z.y += dy; apply(); }
    });
    const end = (e) => {
      const had = ptrs.delete(e.pointerId);
      pinch = 0;
      if (!had || e.type === 'pointercancel' || moved > LIGHTBOX.tapSlopPx) return;
      const now = Date.now(); // a quick second tap: zoom in, or back out
      if (now - lastTap < LIGHTBOX.doubleTapMs) { zoomAt(z.s > 1 ? 1 : LIGHTBOX.doubleTapScale, e.clientX, e.clientY); lastTap = 0; } else lastTap = now;
    };
    img.addEventListener('pointerup', end);
    img.addEventListener('pointercancel', end);
    box.addEventListener('click', (e) => { if (e.target === box) closeLightbox(); });
    x.addEventListener('click', closeLightbox);
    lightbox = { box };
  }

  // ── the keyboard (nothing is taken while a field has focus) ──
  const gridTiles = () => [...grid.querySelectorAll('.stl-lib-tile')];
  /** The tile one step from the selected one: left / right = the previous / next, up / down = the one a row above / below. */
  function neighbour(dir) {
    const all = gridTiles();
    if (!all.length) return null;
    const cur = selected ? all.indexOf(selected.button) : -1;
    if (cur < 0) return all[0];
    if (dir === 'ArrowLeft') return all[Math.max(0, cur - 1)];
    if (dir === 'ArrowRight') return all[Math.min(all.length - 1, cur + 1)];
    const r = all[cur].getBoundingClientRect(), down = dir === 'ArrowDown';
    const rows = all.map((t) => [t, t.getBoundingClientRect()]).filter(([, b]) => (down ? b.top > r.top + 1 : b.top < r.top - 1));
    if (!rows.length) return all[cur];
    const rowTop = down ? Math.min(...rows.map(([, b]) => b.top)) : Math.max(...rows.map(([, b]) => b.top));
    return rows.filter(([, b]) => b.top === rowTop).sort((a, b) => Math.abs(a[1].left - r.left) - Math.abs(b[1].left - r.left))[0][0];
  }
  function onKey(e) {
    if (e.key === 'Escape') { if (lightbox) closeLightbox(); else close(); return; }
    const t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey || lightbox) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const n = neighbour(e.key);
      if (n) { e.preventDefault(); n.click(); }
    } else if (e.key === 'Enter' && selected && (tag !== 'BUTTON' || t.classList.contains('stl-lib-tile'))) {
      e.preventDefault();
      insert();
    }
  }

  // ── endless scroll: the sentinel after the last tile loads the next page like "More results" (where IntersectionObserver exists) ──
  const io = typeof globalThis.IntersectionObserver === 'function'
    ? new globalThis.IntersectionObserver((entries) => {
      if (closed || pending || more.hidden || !entries.some((en) => en.isIntersecting)) return;
      load(false);
    }, { rootMargin: '300px' })
    : null;
  if (io) io.observe(sentinel);
  function watchSentinel() { if (io && !closed) { io.unobserve(sentinel); io.observe(sentinel); } } // asks again whether it is still in view

  function insert() {
    if (!selected) return;
    const { tile, lib } = selected;
    // Crop on with a box that cuts: the panel cuts the downloaded model to it BEFORE it is stored (core/stl/crop.js)
    const crop = cropOn && !cropCtl.isFull() ? normaliseCropBox(cropCtl.get()) : null;
    try { if (onPick) { if (crop) onPick(tile, lib, { crop }); else onPick(tile, lib); } } finally { close(); }
  }

  // ── wiring ──
  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(ratioTimer);
    clearTimeout(sizeTimer);
    viewSeq++;
    selSeq++;
    disposeView();
    closeLightbox();
    if (io) io.disconnect();
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  }
  closeBtn.addEventListener('click', close);
  searchBtn.addEventListener('click', search);
  query.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } });
  more.addEventListener('click', () => { if (!pending) load(false); });
  librarySel.addEventListener('change', onLibrary);
  typeSel?.addEventListener('change', search);
  shapeSel.addEventListener('change', onShape);
  ratioSlider.addEventListener('input', () => onRatio(ratioSlider, ratioNum));
  ratioNum.addEventListener('input', () => onRatio(ratioNum, ratioSlider));
  turnBtn.addEventListener('click', turnIn3d);
  view2dBtn.addEventListener('click', () => { if (turnBtn.disabled) stay2d = true; setMode('2d'); if (view) setPaneNote(''); });
  insertBtn.addEventListener('click', insert);
  cropBtn.addEventListener('click', toggleCrop);
  cropReset.addEventListener('click', () => { cropCtl.set(null); showCropInView(); });
  document.addEventListener('keydown', onKey);

  load(true); // the whole collection (every library), page 0
  return { overlay, close };
}

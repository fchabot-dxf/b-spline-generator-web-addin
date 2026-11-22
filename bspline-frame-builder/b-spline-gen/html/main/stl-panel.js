/**
 * main/stl-panel.js -- STL-RELIEF (STL-RELIEF-DESIGN.md): Surface > STL stamp. Load an STL, place it (X / Y / Z, size, rotation) on
 * the surface and stamp it into the B-spline; several STLs per board. The panel is RENDERED from one declared table, STL_CONTROLS
 * (a new setting is one entry, never a new binding); every setting lives in its own record, P.stlLayers[i] (core/stl/layer.js
 * STL_LAYER_DEFAULTS), and reads none of the other stamp / brick / photo keys.
 *
 * Nothing here rewrites a loaded board: a control writes only when the user moves it (AGENTS.md rule 3); a record's absent field
 * reads as its declared default (normaliseStlLayer). The STL file itself is STORED in the project (a compact, capped copy:
 * "Stored detail"); the original stays in memory this session so the detail can go up as well as down.
 */
import { P, scheduleSessionSave } from '../core/state.js';
import { scheduleUndoSnapshot } from '../core/history.js';
import { withLoadingStage } from '../core/loading-signal.js';
import { parseStl } from '../core/stl/parse.js';
import { decodeMesh } from '../core/stl/mesh.js';
import {
  createStlLayer, restoreAtDetail, normaliseStlLayer, stlHealth, totalStoredTris,
  STL_LAYER_DEFAULTS, STL_WARN_TOTAL_TRIS, STL_STORED_DETAIL_DEFAULT,
} from '../core/stl/layer.js';
import { ghostState, STL_GHOST_COLOURS } from '../core/stl/ghost.js';

/** The controls' groups, in order. */
export const STL_GROUPS = Object.freeze([
  Object.freeze({ id: 'place', label: 'Place', note: 'inches from the board centre; +Y is up the screen' }),
  Object.freeze({ id: 'size', label: 'Size' }),
  Object.freeze({ id: 'rotate', label: 'Rotate', note: 'degrees' }),
  Object.freeze({ id: 'stamp', label: 'Stamp' }),
]);

/**
 * Every setting of the ACTIVE STL, once. kind: 'slider' (a range + number pair) or 'choice' (a segmented pair of buttons).
 * `path` is where it lives in the record. `range(P)` lets a limit follow the board (X / Y reach the board edge).
 */
export const STL_CONTROLS = Object.freeze([
  { id: 'posX', group: 'place', kind: 'slider', path: ['position', 'x'], label: 'X', step: 0.05, range: (p) => [-p.widthIn, p.widthIn] },
  { id: 'posY', group: 'place', kind: 'slider', path: ['position', 'y'], label: 'Y', step: 0.05, range: (p) => [-p.heightIn, p.heightIn] },
  { id: 'posZ', group: 'place', kind: 'slider', path: ['position', 'z'], label: 'Z (height above the surface)', step: 0.01, range: () => [-3, 3],
    note: 'below 0 it sinks into the surface; above 0 it floats' },
  { id: 'scale', group: 'size', kind: 'slider', path: ['scale'], label: 'Size', step: 0.01, range: () => [0.05, 4] },
  { id: 'zScale', group: 'size', kind: 'slider', path: ['zScale'], label: 'Depth (relief height)', step: 0.01, range: () => [0.05, 4] },
  { id: 'rotX', group: 'rotate', kind: 'slider', path: ['rotation', 'x'], label: 'Around X', step: 1, range: () => [-180, 180] },
  { id: 'rotY', group: 'rotate', kind: 'slider', path: ['rotation', 'y'], label: 'Around Y', step: 1, range: () => [-180, 180] },
  { id: 'rotZ', group: 'rotate', kind: 'slider', path: ['rotation', 'z'], label: 'Around Z (turn)', step: 1, range: () => [-180, 180] },
  { id: 'blend', group: 'stamp', kind: 'choice', path: ['blend'], label: 'Blend',
    options: [['max', 'Max', 'Only the part above the surface shows; nothing is dug'], ['add', 'Add', 'Its height is added to the surface everywhere it covers']] },
  { id: 'raise', group: 'stamp', kind: 'choice', path: ['raise'], label: 'Relief',
    options: [[true, 'Raised', 'The STL stands out of the surface'], [false, 'Carved', 'The STL is cut into the surface as a hollow']] },
  { id: 'compress', group: 'stamp', kind: 'slider', path: ['compress'], label: 'Compress (bas-relief)', step: 0.05, range: () => [0, 1],
    note: '0 = true heights; more lifts the low parts and flattens the tall ones' },
  { id: 'softness', group: 'stamp', kind: 'slider', path: ['softness'], label: 'Edge softness (in)', step: 0.05, range: () => [0, 2] },
]);

// ── state (UI only; the data is P.stlLayers) ────────────────────────────────────────────────────────────────────────
let _active = null;                 // the active record's id
const _originals = new Map();       // record id -> the full welded mesh, this session only (Stored detail can go back up)
let _hooks = { onChange: () => {}, refreshGhosts: () => {} };
const _health = new Map();          // `${id}:${mesh.h}` -> health report

const list = () => (Array.isArray(P.stlLayers) ? P.stlLayers : []);
const find = (id) => list().find((l) => l && l.id === id) || null;
export function activeStlLayer() { return find(_active) || list()[0] || null; }
const byId = (id) => document.getElementById(id);
const getPath = (obj, path) => path.reduce((o, k) => (o == null ? o : o[k]), obj);
function setPath(rec, path, v) {
  let o = rec;
  for (let i = 0; i < path.length - 1; i++) { if (o[path[i]] == null || typeof o[path[i]] !== 'object') o[path[i]] = {}; else o[path[i]] = { ...o[path[i]] }; o = o[path[i]]; }
  o[path[path.length - 1]] = v;
}
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

function commit(what) {
  scheduleSessionSave();
  scheduleUndoSnapshot(`stl:${what}`, 'STL');
  _hooks.onChange();
}

/** Write one control's value into the ACTIVE record (the user moved it). */
export function setStlField(controlId, value) {
  const c = STL_CONTROLS.find((x) => x.id === controlId);
  const rec = activeStlLayer();
  if (!c || !rec) return false;
  let v = value;
  if (c.kind === 'slider') { v = parseFloat(value); if (!Number.isFinite(v)) return false; v = clamp(v, c.range(P)); }
  if (c.kind === 'choice') v = c.options.find(([k]) => String(k) === String(value))?.[0];
  if (v === undefined) return false;
  setPath(rec, c.path, v);
  commit(c.id);
  return true;
}

// ── actions ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const board = () => ({ widthIn: P.widthIn, heightIn: P.heightIn });
const status = (text, isError = false) => {
  const s = byId('stlStatus');
  if (!s) return;
  s.textContent = text || '';
  s.hidden = !text;
  s.classList.toggle('stl-error', !!isError);
};
const fileBase = (name) => String(name || 'STL').replace(/\.[^.]+$/, '').slice(0, 40) || 'STL';

/** Add an STL (an ArrayBuffer of its bytes) as a new layer, placed at the board centre, fitted to half the board. */
export function addStlFromBuffer(buf, name) {
  const parsed = parseStl(buf);
  const { record, original } = createStlLayer({ soup: parsed.soup, name: fileBase(name), board: board() });
  if (!Array.isArray(P.stlLayers)) P.stlLayers = [];
  P.stlLayers.push(record);
  _originals.set(record.id, original);
  _active = record.id;
  commit('add');
  sync();
  return record;
}

/** Replace the active layer's mesh from a file (more detail after a reload): its place / size / settings are kept. */
export function reimportStlBuffer(buf, name) {
  const rec = activeStlLayer();
  if (!rec) return null;
  const parsed = parseStl(buf);
  const fresh = createStlLayer({ soup: parsed.soup, name: rec.name, board: board(), storedDetail: normaliseStlLayer(rec).storedDetail });
  Object.assign(rec, { mesh: fresh.record.mesh, origTris: fresh.record.origTris, storedTris: fresh.record.storedTris, unitIn: rec.unitIn });
  _originals.set(rec.id, fresh.original);
  commit('reimport');
  sync();
  return rec;
}

export function removeStlLayer(id) {
  const i = list().findIndex((l) => l && l.id === id);
  if (i < 0) return;
  P.stlLayers.splice(i, 1);
  _originals.delete(id);
  if (_active === id) _active = list()[0]?.id ?? null;
  commit('remove');
  sync();
}

export function setStlEnabled(id, on) {
  const rec = find(id);
  if (!rec) return;
  rec.enabled = !!on;
  commit('enabled');
  sync();
}

/** The Stored detail control: re-store the active mesh at `n` triangles (from the original while it is in memory; else the stored copy, lower only). */
export function setStoredDetail(n) {
  const rec = activeStlLayer();
  const want = Math.max(100, Math.round(Number(n)));
  if (!rec || !Number.isFinite(want)) return null;
  const source = _originals.get(rec.id) || decodeMesh(rec.mesh);
  const next = restoreAtDetail(rec, source, want);
  Object.assign(rec, { storedDetail: want, storedTris: next.storedTris, mesh: next.mesh });
  commit('detail');
  sync();
  return rec;
}

/** Z = 0: the base rests on the surface. */
export function snapStlBase() { return setStlField('posZ', 0); }
export function centreStl() { const a = setStlField('posX', 0), b = setStlField('posY', 0); return a && b; }
export function resetStlRotation() { return ['rotX', 'rotY', 'rotZ'].every((id) => setStlField(id, 0)); }

async function importFile(file, { reimport = false } = {}) {
  if (!file) return;
  try {
    await withLoadingStage('stl', async () => {
      const buf = await file.arrayBuffer();
      if (reimport) reimportStlBuffer(buf, file.name); else addStlFromBuffer(buf, file.name);
    });
    status('');
  } catch (e) {
    status(`Could not read ${file.name || 'that file'}: ${e && e.message ? e.message : e}`, true);
  }
}

// ── rendering ───────────────────────────────────────────────────────────────────────────────────────────────────────
const el = (tag, attrs = {}, kids = []) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'style') e.style.cssText = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v); }
  for (const k of kids) if (k) e.appendChild(k);
  return e;
};
const cad = (text) => el('label', { class: 'cad-label', text });

function renderControl(c) {
  if (c.kind === 'choice') {
    return el('div', {}, [cad(c.label), el('div', { class: 'relief-toggle', id: `stl_${c.id}`, style: 'margin-bottom:10px;' },
      c.options.map(([key, text, title]) => el('button', { type: 'button', class: 'relief-toggle-btn', 'data-stl-choice': `${c.id}:${key}`, title, text })))]);
  }
  const [min, max] = c.range(P);
  const s = el('input', { type: 'range', id: `stl_${c.id}Slider`, class: 'cad-slider', min: String(min), max: String(max), step: String(c.step) });
  const n = el('input', { type: 'number', id: `stl_${c.id}`, min: String(min), max: String(max), step: String(c.step) });
  return el('div', {}, [cad(c.label), el('div', { class: 'cad-slider-row', style: 'margin-bottom:10px;' }, [s, el('div', { class: 'cad-stepper', style: 'width:66px;' }, [n])]),
    c.note ? el('div', { class: 'photo-layer-note', text: c.note }) : null]);
}

/** Build the panel from STL_CONTROLS into `body` (main.js, before bindStlPanel). */
export function renderStlPanel(body) {
  if (!body) return;
  body.innerHTML = '';
  body.appendChild(el('div', { class: 'stl-add-row' }, [
    el('button', { type: 'button', id: 'stlAdd', class: 'cad-btn cad-btn-secondary', text: '＋ Add STL…' }),
    el('input', { type: 'file', id: 'stlFile', accept: '.stl,model/stl,application/sla,application/octet-stream', style: 'display:none;' }),
    el('input', { type: 'file', id: 'stlReimportFile', accept: '.stl,model/stl,application/sla,application/octet-stream', style: 'display:none;' }),
  ]));
  body.appendChild(el('div', { id: 'stlStatus', class: 'photo-layer-note', role: 'status', hidden: '' }));
  body.appendChild(el('div', { id: 'stlList', class: 'stl-list' }));
  const active = el('div', { id: 'stlActive' });
  for (const g of STL_GROUPS) {
    const mine = STL_CONTROLS.filter((c) => c.group === g.id);
    active.appendChild(el('label', { class: 'cad-label photo-layer-group' }, [el('span', { text: g.label }), g.note ? el('span', { class: 'photo-layer-group-note', text: ` ${g.note}` }) : null]));
    for (const c of mine) active.appendChild(renderControl(c));
    if (g.id === 'place') {
      active.appendChild(el('div', { class: 'photo-layer-buttons' }, [
        el('button', { type: 'button', id: 'stlSnap', class: 'cad-btn cad-btn-secondary', text: '⤓ Base on surface', title: 'Z = 0: the lowest point rests on the surface' }),
        el('button', { type: 'button', id: 'stlCentre', class: 'cad-btn cad-btn-secondary', text: '⌖ Centre' }),
      ]));
    }
    if (g.id === 'rotate') {
      active.appendChild(el('div', { class: 'photo-layer-buttons' }, [el('button', { type: 'button', id: 'stlRotReset', class: 'cad-btn cad-btn-secondary', text: '↺ Reset rotation' })]));
    }
  }
  // stored detail + health + the ghost
  active.appendChild(el('label', { class: 'cad-label photo-layer-group' }, [el('span', { text: 'Stored in the project' })]));
  active.appendChild(el('div', { class: 'cad-slider-row', style: 'margin-bottom:6px;' }, [
    el('div', { class: 'cad-stepper cad-stepper-wide' }, [el('input', { type: 'number', id: 'stlDetail', min: '100', max: '400000', step: '1000' })]),
    el('span', { class: 'stl-unit', text: 'triangles' })]));
  active.appendChild(el('div', { id: 'stlStored', class: 'photo-layer-note' }));
  active.appendChild(el('div', { id: 'stlHealth', class: 'photo-layer-note' }));
  active.appendChild(el('div', { class: 'photo-layer-buttons' }, [
    el('button', { type: 'button', id: 'stlReimport', class: 'cad-btn cad-btn-secondary', text: '⟳ Re-import for more detail…' }),
    el('button', { type: 'button', id: 'stlRemove', class: 'cad-btn cad-btn-secondary', text: '🗑 Remove' }),
  ]));
  active.appendChild(el('label', { class: 'cad-label photo-layer-check' }, [el('input', { type: 'checkbox', id: 'stlGhost' }), el('span', { text: 'Show the placement ghost' })]));
  active.appendChild(el('div', { id: 'stlLegend', class: 'stl-legend' }));
  body.appendChild(active);
  body.appendChild(el('div', { id: 'stlTotal', class: 'photo-layer-note' }));
}

const KIB = 1024;
const sizeOf = (rec) => ((rec.mesh?.pos?.length || 0) + (rec.mesh?.idx?.length || 0));
const mb = (bytes) => (bytes / (KIB * KIB)).toFixed(bytes < KIB * KIB ? 2 : 1);
const hex = (c) => `rgb(${c.map((x) => Math.round(x * 255)).join(',')})`;
const LEGEND = Object.freeze([['shows', 'will show in the relief'], ['buried', 'below the surface (hidden with Max)'], ['meets', 'where it meets the surface'], ['overhang', 'faces down (lost from above)'], ['open', 'open edge / hole']]);

function healthText(rec) {
  const key = `${rec.id}:${rec.mesh?.h}`;
  let h = _health.get(key);
  if (!h) { try { h = stlHealth(rec); } catch (_) { return 'The stored mesh cannot be read.'; } _health.set(key, h); }
  const bits = [h.openEdges === 0 ? 'closed mesh' : `${h.openEdges} open edges in ${h.boundaryLoops} outline${h.boundaryLoops === 1 ? '' : 's'}`];
  if (h.components > 1) bits.push(`${h.components} separate pieces`);
  if (h.nonManifoldEdges) bits.push(`${h.nonManifoldEdges} edges shared by 3+ faces`);
  return `Mesh: ${bits.join(', ')} (reported only; nothing is repaired)`;
}

/** Reflect the state on the whole panel. Safe to call any time (a load, an undo, a rebuild). */
export function syncStlPanel() {
  const listEl = byId('stlList');
  if (!listEl) return;
  const recs = list();
  if (!find(_active)) _active = recs[0]?.id ?? null;
  listEl.innerHTML = '';
  if (!recs.length) listEl.appendChild(el('div', { class: 'photo-layer-note', text: 'No STL yet. Add one: it is placed at the board centre and stamped into the surface.' }));
  for (const r of recs) {
    const on = r.enabled !== false;
    const row = el('div', { class: `stl-row${r.id === _active ? ' stl-row-active' : ''}` }, [
      el('input', { type: 'checkbox', 'data-stl-enable': r.id, title: 'Stamp this STL', ...(on ? { checked: '' } : {}) }),
      el('button', { type: 'button', class: 'stl-row-name', 'data-stl-pick': r.id, text: r.name || 'STL' }),
    ]);
    row.querySelector('input').checked = on;
    listEl.appendChild(row);
  }
  const rec = activeStlLayer();
  const activeEl = byId('stlActive');
  if (activeEl) activeEl.hidden = !rec;
  if (rec) {
    const n = normaliseStlLayer(rec);
    for (const c of STL_CONTROLS) {
      if (c.kind === 'slider') {
        const [min, max] = c.range(P);
        const v = getPath(n, c.path);
        for (const id of [`stl_${c.id}Slider`, `stl_${c.id}`]) { const x = byId(id); if (x) { x.min = String(min); x.max = String(max); x.value = String(v); } }
      } else {
        const v = getPath(n, c.path);
        for (const b of document.querySelectorAll(`#stl_${c.id} [data-stl-choice]`)) b.classList.toggle('active', b.getAttribute('data-stl-choice') === `${c.id}:${v}`);
      }
    }
    const detail = byId('stlDetail'); if (detail) detail.value = String(n.storedDetail);
    const stored = byId('stlStored');
    const can = _originals.has(rec.id);
    if (stored) stored.textContent = `Stored ${(rec.storedTris ?? rec.mesh?.nt ?? 0).toLocaleString()} of ${(rec.origTris ?? rec.mesh?.nt ?? 0).toLocaleString()} triangles, about ${mb(sizeOf(rec))} MB. ${can ? 'The original is loaded: the detail can go up or down.' : 'After a reload the detail can only go down; re-import the file for more.'}`;
    const h = byId('stlHealth'); if (h) h.textContent = healthText(rec);
    const re = byId('stlReimport'); if (re) re.hidden = can;
  }
  const g = byId('stlGhost'); if (g) g.checked = ghostState.visible;
  const legend = byId('stlLegend');
  if (legend && !legend.childElementCount) {
    for (const [k, text] of LEGEND) legend.appendChild(el('span', { class: 'stl-legend-item' }, [el('i', { style: `background:${hex(STL_GHOST_COLOURS[k])};` }), document.createTextNode(text)]));
  }
  const total = totalStoredTris(recs);
  const t = byId('stlTotal');
  if (t) {
    t.hidden = !recs.length;
    t.textContent = total > STL_WARN_TOTAL_TRIS
      ? `⚠ ${total.toLocaleString()} triangles stored in this project. A very large project may not fit the browser's storage: lower the Stored detail of some STLs.`
      : `${total.toLocaleString()} triangles stored in this project.`;
    t.classList.toggle('stl-error', total > STL_WARN_TOTAL_TRIS);
  }
}

/** Wire the panel. `hooks.onChange`: rebuild the surface; `hooks.refreshGhosts`: redraw the ghosts only. */
export function bindStlPanel(hooks = {}) {
  _hooks = { onChange: hooks.onChange || (() => {}), refreshGhosts: hooks.refreshGhosts || (() => {}) };
  byId('stlAdd')?.addEventListener('click', () => byId('stlFile')?.click());
  byId('stlFile')?.addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; importFile(f); });
  byId('stlReimport')?.addEventListener('click', () => byId('stlReimportFile')?.click());
  byId('stlReimportFile')?.addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; importFile(f, { reimport: true }); });
  byId('stlRemove')?.addEventListener('click', () => { const r = activeStlLayer(); if (r) removeStlLayer(r.id); });
  byId('stlSnap')?.addEventListener('click', () => { snapStlBase(); sync(); });
  byId('stlCentre')?.addEventListener('click', () => { centreStl(); sync(); });
  byId('stlRotReset')?.addEventListener('click', () => { resetStlRotation(); sync(); });
  byId('stlDetail')?.addEventListener('change', (e) => setStoredDetail(e.target.value));
  byId('stlGhost')?.addEventListener('change', (e) => { ghostState.visible = !!e.target.checked; _hooks.refreshGhosts(); });
  byId('stlList')?.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-stl-pick]');
    if (pick) { _active = pick.getAttribute('data-stl-pick'); sync(); _hooks.refreshGhosts(); }
  });
  byId('stlList')?.addEventListener('change', (e) => {
    const box = e.target.closest('[data-stl-enable]');
    if (box) setStlEnabled(box.getAttribute('data-stl-enable'), box.checked);
  });
  for (const c of STL_CONTROLS) {
    if (c.kind === 'slider') {
      const s = byId(`stl_${c.id}Slider`), n = byId(`stl_${c.id}`);
      s?.addEventListener('input', (e) => { if (n) n.value = e.target.value; setStlField(c.id, e.target.value); });
      n?.addEventListener('change', (e) => { setStlField(c.id, e.target.value); if (s) s.value = e.target.value; });
    } else {
      for (const b of document.querySelectorAll(`#stl_${c.id} [data-stl-choice]`)) {
        b.addEventListener('click', () => { setStlField(c.id, b.getAttribute('data-stl-choice').split(':')[1]); sync(); });
      }
    }
  }
  sync();
}

function sync() { syncStlPanel(); }

/** Test / host hook. */
export function _resetStlPanelForTests() { _active = null; _originals.clear(); _health.clear(); _hooks = { onChange: () => {}, refreshGhosts: () => {} }; }
export { STL_LAYER_DEFAULTS, STL_STORED_DETAIL_DEFAULT };

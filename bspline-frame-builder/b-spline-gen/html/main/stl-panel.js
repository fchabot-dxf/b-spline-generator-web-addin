/**
 * main/stl-panel.js -- STL-RELIEF (STL-RELIEF-DESIGN.md): Surface > STL stamp. Load an STL, place it (X / Y / Z, size, rotation) on
 * the surface and stamp it into the B-spline; several STLs per board. The panel is RENDERED from one declared table, STL_CONTROLS
 * (a new setting is one entry, never a new binding); every setting lives in its own record, P.stlLayers[i] (core/stl/layer.js
 * STL_LAYER_DEFAULTS), and reads none of the other stamp / brick / photo keys.
 *
 * Nothing here rewrites a loaded board: a control writes only when the user moves it (AGENTS.md rule 3); a record's absent field
 * reads as its declared default (normaliseStlLayer). COPY-ON-WRITE: P.stlLayers starts as the SAME array as DEFAULT.stlLayers and
 * a history snapshot restores keys by reference, so a write NEVER mutates the list or a record: it builds a new array holding a
 * new record (nested position / rotation copied) and assigns it to P.stlLayers. The STL file itself is STORED in the project (a compact, capped copy:
 * "Stored detail"); the original stays in memory this session so the detail can go up as well as down.
 */
import { P, scheduleSessionSave, lastResult } from '../core/state.js';
import { scheduleUndoSnapshot } from '../core/history.js';
import { setSectionReadOnly } from '../core/ui-utils.js';
import { withLoadingStage } from '../core/loading-signal.js';
import { parseStl } from '../core/stl/parse.js';
import { decodeMesh, indexMesh } from '../core/stl/mesh.js';
import { soupFromGlbBuffer, soupFromGlbUrls } from '../core/stl/gltf.js';
import { fetchSmithsonianModelGlbs } from '../core/stl/smithsonian.js';
import { openStlLibrarySheet } from './stl-library-sheet.js';
import {
  createStlLayer, restoreAtDetail, normaliseStlLayer, stlHealth, totalStoredTris, getStlErrors, STL_WARN_TOTAL_TRIS,
} from '../core/stl/layer.js';
import { ghostState, STL_GHOST_COLOURS } from '../core/stl/ghost.js';
import { stlPass } from '../core/stl/layer.js';
import { fitStlDepth, getStlStockReport, stlStockMessage } from '../core/stl/stock.js';
import { layFlatFrame, quickTurnRotation } from '../core/stl/orient.js';
import { resolveGrid } from '../core/terrain.js';

/** The controls' groups, in order. */
export const STL_GROUPS = Object.freeze([
  Object.freeze({ id: 'place', label: 'Place', note: 'inches from the board centre; +Y is up the screen' }),
  Object.freeze({ id: 'size', label: 'Size' }),
  Object.freeze({ id: 'rotate', label: 'Rotate', note: 'degrees' }),
  Object.freeze({ id: 'stamp', label: 'Stamp' }),
]);

/**
 * Every setting of the ACTIVE STL, once. kind: 'slider' (a range + number pair) or 'choice' (a segmented pair of buttons).
 * `path` is where it lives in the record. `range(P)` is only the slider's travel (X / Y reach the board edge): it is NOT a rule, a typed
 * value outside it is stored as typed (owner: floating Z allowed, no clamp).
 */
export const STL_CONTROLS = Object.freeze([
  { id: 'posX', group: 'place', kind: 'slider', path: ['position', 'x'], label: 'X', step: 0.05, range: (p) => [-p.widthIn, p.widthIn] },
  { id: 'posY', group: 'place', kind: 'slider', path: ['position', 'y'], label: 'Y', step: 0.05, range: (p) => [-p.heightIn, p.heightIn] },
  { id: 'posZ', group: 'place', kind: 'slider', path: ['position', 'z'], label: 'Z (height above the surface)', step: 0.01, range: () => [-3, 3],
    note: 'below 0 it sinks into the surface; above 0 it floats' },
  { id: 'surface', group: 'place', kind: 'choice', path: ['surface'], label: 'On the terrain',
    options: [['follow', 'Follow the terrain', 'Each point of the STL sits on the terrain under it (bends over hills)'], ['level', 'Level', 'One rigid object at the terrain height under its centre (+ Z): the terrain is filled or cut to it']] },
  { id: 'scale', group: 'size', kind: 'slider', path: ['scale'], label: 'Size', step: 0.01, range: () => [0.05, 4] },
  { id: 'zScale', group: 'size', kind: 'slider', path: ['zScale'], label: 'Depth (relief height)', step: 0.01, range: () => [0.05, 4] },
  { id: 'rotX', group: 'rotate', kind: 'slider', path: ['rotation', 'x'], label: 'Around X', step: 1, range: () => [-180, 180] },
  { id: 'rotY', group: 'rotate', kind: 'slider', path: ['rotation', 'y'], label: 'Around Y', step: 1, range: () => [-180, 180] },
  { id: 'rotZ', group: 'rotate', kind: 'slider', path: ['rotation', 'z'], label: 'Around Z (turn)', step: 1, range: () => [-180, 180] },
  { id: 'blend', group: 'stamp', kind: 'choice', path: ['blend'], label: 'Blend',
    options: [['max', 'Max', 'Only the part above the surface shows; nothing is dug'], ['add', 'Add', 'Its height is added to the surface everywhere it covers']] },
  { id: 'raise', group: 'stamp', kind: 'choice', path: ['raise'], label: 'Relief',
    options: [[true, 'Raised', 'The STL stands out of the surface'], [false, 'Carved', 'The STL is cut into the surface as a hollow']] },
  { id: 'placement', group: 'stamp', kind: 'choice', path: ['placement'], label: 'Thicken',
    options: [['withSurface', 'Before thicken', 'The back follows the STL: thicken offsets the surface with the STL in it'], ['afterBack', 'After thicken', 'Top only: the back stays as it is without this STL']] },
  { id: 'compress', group: 'stamp', kind: 'slider', path: ['compress'], label: 'Compress (bas-relief)', step: 0.05, range: () => [0, 1],
    note: '0 = true heights; more lifts the low parts and flattens the tall ones' },
  { id: 'softness', group: 'stamp', kind: 'slider', path: ['softness'], label: 'Edge softness (in)', step: 0.05, range: () => [0, 2] },
]);

/**
 * The panel's ACTION buttons on the active STL (Fred 2026-11-22), declared once: rendered in their `group` (in a row right after
 * the control `after` names, else after the group's controls) and bound by one loop. Each press is ONE copy-on-write write and
 * ONE undo step; nothing runs at insert except the Fit when P.stlFitOnInsert is on.
 */
const turn = (axis, deg) => Object.freeze({
  id: `stlTurn${axis.toUpperCase()}${deg < 0 ? 'Minus' : 'Plus'}`, group: 'rotate', after: `rot${axis.toUpperCase()}`,
  text: `${deg < 0 ? '−' : '+'}90° ${axis.toUpperCase()}`, title: `Turn it ${deg}° about the board's ${axis.toUpperCase()} axis`,
  run: () => turnStl(axis, deg),
});
export const STL_ACTIONS = Object.freeze([
  Object.freeze({ id: 'stlFit', group: 'size', text: '⇕ Fit to carve depth', title: 'Set the Depth so this STL just fits the stock (Board > Carve Depth): Raised peaks at the top, Carved reaches the bottom', run: () => fitStlToCarveDepth() }),
  Object.freeze({ id: 'stlLayFlat', group: 'rotate', text: '⤵ Lay flat', title: 'Turn it so its thinnest side points up and its longest runs along X (replaces the rotation)', run: () => layFlatStl() }),
  turn('x', -90), turn('x', 90), turn('y', -90), turn('y', 90), turn('z', -90), turn('z', 90),
]);

// ── state (UI only; the data is P.stlLayers) ────────────────────────────────────────────────────────────────────────
let _active = null;                 // the active record's id
const _originals = new Map();       // record id -> the full welded mesh, this session only (Stored detail can go back up)
let _hooks = { onChange: () => {}, refreshGhosts: () => {} };

const list = () => (Array.isArray(P.stlLayers) ? P.stlLayers : []);
const find = (id) => list().find((l) => l && l.id === id) || null;
export function activeStlLayer() { return find(_active) || list()[0] || null; }
const byId = (id) => document.getElementById(id);
const getPath = (obj, path) => path.reduce((o, k) => (o == null ? o : o[k]), obj);
/** A NEW record with `path` set to `v` (every object on the way is copied; `rec` is never touched). */
function withPath(rec, path, v) {
  const [k, ...rest] = path;
  if (!rest.length) return { ...rec, [k]: v };
  const inner = rec[k] != null && typeof rec[k] === 'object' ? rec[k] : {};
  return { ...rec, [k]: withPath(inner, rest, v) };
}
/** Copy-on-write: replace the record `id` by `change(record)` (a NEW record) in a NEW list. */
function updateRecord(id, change) {
  P.stlLayers = list().map((r) => (r && r.id === id ? change(r) : r));
}

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
  if (c.kind === 'slider') { v = parseFloat(value); if (!Number.isFinite(v)) return false; }
  if (c.kind === 'choice') v = c.options.find(([k]) => String(k) === String(value))?.[0];
  if (v === undefined) return false;
  updateRecord(rec.id, (r) => withPath(r, c.path, v));
  commit(c.id);
  return true;
}

/**
 * The 3D placement gizmo's release (core/preview/stl-gizmo.js): write the dragged position / turn of layer `id` in ONE
 * copy-on-write write and ONE commit (one undo step, one rebuild), then re-sync the panel. `t` = { x?, y?, z?, rotZ? }, absolute
 * values; a key that is not a finite number is left out (as setStlField writes nothing for a non-number). Nothing to write or
 * no such layer: false, nothing happens. No clamp (owner: floating Z allowed; X / Y may go past the board).
 */
export function applyStlTransform(id, t = {}) {
  const rec = find(id);
  if (!rec || !t) return false;
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  const pos = {};
  for (const k of ['x', 'y', 'z']) if (num(t[k])) pos[k] = t[k];
  const hasPos = Object.keys(pos).length > 0, hasRot = num(t.rotZ);
  if (!hasPos && !hasRot) return false;
  updateRecord(id, (r) => ({
    ...r,
    ...(hasPos ? { position: { ...(r.position || {}), ...pos } } : {}),
    ...(hasRot ? { rotation: { ...(r.rotation || {}), z: t.rotZ } } : {}),
  }));
  commit('gizmo');
  syncStlPanel();
  return true;
}

/** A press on another STL's ghost in the 3D view makes it the active layer: UI state only (P is not written), the panel re-synced. */
export function pickStlLayer(id) {
  if (!find(id)) return false;
  _active = id;
  syncStlPanel();
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

/** The STL list gained or lost a layer: the job-timeline strip declares this event (the 'stl' step exists only with a layer). */
const announceStlLayersChanged = () => { if (typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('stlLayersChanged')); };

/** A project load replaced the board (main/snapshot-manager.js applySnapshot): an STL file still being read must not join it. */
let _projectEpoch = 0;
export function noteStlProjectReplaced() { _projectEpoch++; }

/**
 * THE import path (an STL file, a GLB file, a library model all end here): a triangle soup (core/stl/parse.js parseStl's `.soup`
 * shape) becomes a new layer, placed at the board centre, fitted to half the board. `name` is shown as given (file callers pass
 * fileBase(file name)). `extra.source` ({ provider, modelUrl, title, uri }: where a library model came from) is stored on the
 * record when given; a record without it has no `source` key at all.
 */
export function addStlFromSoup(soup, name, extra = {}) {
  const { record: made, original } = createStlLayer({ soup, name: name || 'STL', board: board() });
  let record = extra && extra.source ? { ...made, source: { ...extra.source } } : made;
  // Fred 2026-11-22: fitting at insert is an OPTION (P.stlFitOnInsert, default off) -- fitted once, in this same write / undo
  // step, on the surface already built (the clean terrain an STL is stamped on does not depend on the STL); none built yet:
  // after the next build (onStlStockChanged)
  const fit = P.stlFitOnInsert === true ? stlFitFor(record) : null;
  if (fit && fit.zScale !== undefined) record = { ...record, zScale: fit.zScale };
  else if (fit && fit.reason === 'notBuilt') _fitAfterBuild.add(record.id);
  P.stlLayers = [...list(), record];
  _originals.set(record.id, original);
  _active = record.id;
  commit('add');
  syncStlPanel();
  announceStlLayersChanged();
  return record;
}

/** Add an STL (an ArrayBuffer of its bytes) as a new layer. */
export function addStlFromBuffer(buf, name) {
  return addStlFromSoup(parseStl(buf).soup, fileBase(name));
}

/** A GLB file starts with the 4 bytes 'glTF'. */
const isGlb = (buf) => {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return u8.byteLength >= 4 && u8[0] === 0x67 && u8[1] === 0x6c && u8[2] === 0x54 && u8[3] === 0x46;
};

/** A file's bytes -> its triangle soup: a GLB through the glTF loader, anything else as an STL. */
async function soupFromBuffer(buf) {
  return isGlb(buf) ? soupFromGlbBuffer(buf) : parseStl(buf).soup;
}

/** Download a library model as ONE soup: every Low part of model `modelId` (a bust and its base), or `uri` alone when the
 *  parts lookup fails or there is no model id. */
async function downloadModelSoup(modelId, uri) {
  const doFetch = (...a) => globalThis.fetch(...a);
  return soupFromGlbUrls(await fetchSmithsonianModelGlbs(modelId, uri, doFetch), doFetch);
}

/** Replace the mesh of layer `id` (default: the active one) from a file (more detail after a reload): its place / size / settings are kept. */
export function reimportStlBuffer(buf, name, id = activeStlLayer()?.id) {
  if (!find(id)) { status('That STL layer is gone, nothing was replaced.', true); return null; }
  return reimportStlSoup(parseStl(buf).soup, name, id);
}

function reimportStlSoup(soup, name, id) {
  const rec = find(id);
  if (!rec) { status('That STL layer is gone, nothing was replaced.', true); return null; }
  const fresh = createStlLayer({ soup, name: rec.name, board: board(), storedDetail: normaliseStlLayer(rec).storedDetail });
  const { mesh, origTris, storedTris, health } = fresh.record;
  updateRecord(rec.id, (r) => ({ ...r, mesh, origTris, storedTris, health }));
  _originals.set(rec.id, fresh.original);
  commit('reimport');
  syncStlPanel();
  return find(rec.id);
}

export function removeStlLayer(id) {
  if (!find(id)) return;
  P.stlLayers = list().filter((l) => !(l && l.id === id));
  _originals.delete(id);
  if (_active === id) _active = list()[0]?.id ?? null;
  commit('remove');
  syncStlPanel();
  announceStlLayersChanged();
}

export function setStlEnabled(id, on) {
  if (!find(id)) return;
  updateRecord(id, (r) => ({ ...r, enabled: !!on }));
  commit('enabled');
  syncStlPanel();
}

/**
 * The Stored detail control: re-store the active mesh at `n` triangles (from the original while it is in memory; else the stored
 * copy, lower only). Not a number >= 1 (an empty box, 0, text): nothing changes and the box shows the record's value again.
 * Without the original, a request at or above the stored count re-stores nothing (re-quantising the decoded copy drifts).
 */
export function setStoredDetail(n) {
  const rec = activeStlLayer();
  if (!rec) return null;
  const want = typeof n === 'string' && n.trim() === '' ? NaN : Math.round(Number(n));
  const original = _originals.get(rec.id);
  const storedNow = rec.storedTris ?? rec.mesh?.nt ?? 0;
  // a library model (source.uri) after a reload: going UP downloads it again (async; resolves to the record)
  if (Number.isFinite(want) && want > storedNow && !original && rec.source && rec.source.uri) return redownloadAndRestore(rec.id, want);
  if (!Number.isFinite(want) || want < 1 || (!original && want >= storedNow)) { syncStlPanel(); return rec; }
  restoreDetail(rec.id, original || decodeMesh(rec.mesh), want);
  return find(rec.id);
}

function restoreDetail(id, source, want) {
  const next = restoreAtDetail(find(id), source, want);
  updateRecord(id, (r) => ({ ...r, storedDetail: want, storedTris: next.storedTris, mesh: next.mesh }));
  commit('detail');
  syncStlPanel();
}

/** Download layer `id`'s model again (all its parts; its source.uri if the lookup fails), keep it as the in-memory original, then re-store at `want`. */
async function redownloadAndRestore(id, want) {
  const rec = find(id);
  const epoch = _projectEpoch;
  let original = null;
  try {
    await withLoadingStage('stl', async () => { original = indexMesh(await downloadModelSoup(rec.source.modelUrl, rec.source.uri)); });
  } catch (e) {
    status(`Could not download ${rec.name || 'the model'} again: ${e && e.message ? e.message : e}`, true);
    syncStlPanel();
    return find(id);
  }
  if (epoch !== _projectEpoch || !find(id)) { status('The project changed while the model was downloading: nothing changed.', true); syncStlPanel(); return find(id); }
  _originals.set(id, original);
  status('');
  restoreDetail(id, original, want);
  return find(id);
}

/** Z = 0: the base rests on the surface. */
export function snapStlBase() { return setStlField('posZ', 0); }
export function centreStl() { const a = setStlField('posX', 0), b = setStlField('posY', 0); return a && b; }
export function resetStlRotation() { return ['rotX', 'rotY', 'rotZ'].every((id) => setStlField(id, 0)); }

// ── fit to the stock, lay flat, quick turns (Fred 2026-11-22) ───────────────────────────────────────────────────────
/**
 * The Depth that fits record `rec` inside the stock on the LAST BUILT surface (core/stl/stock.js fitStlDepth, the one rule):
 * { zScale } or { reason }. The pass is the record's own at its current Depth (the build's cached raster; Depth 0 reads Depth 1);
 * the relief height per unit Depth is |pass.depth| / |zScale| (raster.js: the height is linear in zScale) and a negative Depth
 * keeps its sign. 'notBuilt' = no surface for the current board grid yet.
 */
function stlFitFor(rec) {
  const r = lastResult;
  const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
  if (!r || !r.cleanHeights || r.nx !== nx || r.nz !== nz || r.cleanHeights.length !== nx * nz) return { reason: 'notBuilt' };
  const zNow = normaliseStlLayer(rec).zScale;
  const zs = Number.isFinite(zNow) && zNow !== 0 ? zNow : 1;
  let pass;
  try { pass = stlPass({ ...rec, enabled: true, zScale: zs }, { nx, nz, widthIn: P.widthIn, heightIn: P.heightIn }); } catch (e) { return { reason: 'unreadable' }; }
  if (!pass) return { reason: 'empty' };
  const f = fitStlDepth(pass, r.cleanHeights, nx, nz, P.carveZ, Math.abs(pass.depth) / Math.abs(zs));
  return f.zScale !== undefined ? { zScale: Math.sign(zs) * f.zScale } : f;
}
/** Why the Fit changed nothing, one line per reason (the status line shows it). */
const FIT_NO_ROOM = Object.freeze({
  terrain: (top) => `Nothing changed: the terrain under this STL already reaches the stock ${top ? 'top' : 'bottom'} (Carve Depth ${P.carveZ} in).`,
  zOffset: (top) => `Nothing changed: its Z offset alone already takes it to the stock ${top ? 'top' : 'bottom'} (Carve Depth ${P.carveZ} in).`,
  flat: () => 'Nothing changed: this STL has no height to scale.',
  empty: () => 'Nothing changed: this STL covers no point of the board.',
  unreadable: () => 'Nothing changed: the stored mesh cannot be read.',
  notBuilt: () => 'The surface is not built yet: try again once it is.',
});

/** 'Fit to carve depth': set layer `id`'s Depth (zScale) -- and nothing else -- so its stamp just fits the stock. One write, one
 *  undo step (the zScale control's own copy-on-write path). No room: nothing changes and the status line says why. */
export function fitStlToCarveDepth(id = activeStlLayer()?.id) {
  const rec = find(id);
  if (!rec) return false;
  const f = stlFitFor(rec);
  if (f.zScale === undefined) { status((FIT_NO_ROOM[f.reason] || FIT_NO_ROOM.flat)(normaliseStlLayer(rec).raise), true); return false; }
  updateRecord(rec.id, (r) => withPath(r, ['zScale'], f.zScale));
  commit('zScale');
  syncStlPanel();
  status(`Depth set to ${f.zScale.toFixed(3)}: it fits the stock (Carve Depth ${P.carveZ} in).`);
  return true;
}

/** Layers added with P.stlFitOnInsert on before any surface was built: fitted once, after the next build (onStlStockChanged). */
const _fitAfterBuild = new Set();

/** 'Lay flat': the active STL's rotation REPLACED by the one that puts its thinnest side up (core/stl/orient.js layFlatFrame on
 *  the decoded stored mesh). One write, one undo step; nothing else changes. */
export function layFlatStl() {
  const rec = activeStlLayer();
  if (!rec) return false;
  let rotation;
  try { rotation = layFlatFrame(decodeMesh(rec.mesh)).rotation; } catch (e) { status(`Could not read the stored mesh: ${e && e.message ? e.message : e}`, true); return false; }
  updateRecord(rec.id, (r) => ({ ...r, rotation }));
  commit('layFlat');
  syncStlPanel();
  return true;
}

/** A quick turn: `deg` about the BOARD's `axis` (core/stl/orient.js quickTurnRotation). One write, one undo step. */
export function turnStl(axis, deg) {
  const rec = activeStlLayer();
  if (!rec) return false;
  const rotation = quickTurnRotation(normaliseStlLayer(rec).rotation, axis, deg);
  updateRecord(rec.id, (r) => ({ ...r, rotation }));
  commit(`turn${axis.toUpperCase()}`);
  syncStlPanel();
  return true;
}

/** The active STL against the stock, from the last build's report (core/stl/stock.js): one line, hidden when it fits. */
function showStlStock() {
  const line = byId('stlStock');
  if (!line) return;
  const rec = activeStlLayer();
  const text = rec && rec.id != null ? stlStockMessage(getStlStockReport()[String(rec.id)]) : '';
  line.textContent = text;
  line.hidden = !text;
}
/** A build just finished its heights (core/engine/rebuild.js -> setStlStockReport): the pending insert fits, then the line. */
function onStlStockChanged() {
  for (const id of [..._fitAfterBuild]) { _fitAfterBuild.delete(id); if (find(id)) fitStlToCarveDepth(id); }
  showStlStock();
}

async function importFile(file, { reimport = false } = {}) {
  if (!file) return;
  const target = reimport ? activeStlLayer()?.id : undefined; // the layer the user chose, captured BEFORE the file is read
  const epoch = _projectEpoch; // a project load during the read bumps it (noteStlProjectReplaced)
  try {
    let done = null;
    let stale = false;
    await withLoadingStage('stl', async () => {
      const buf = await file.arrayBuffer();
      if (epoch !== _projectEpoch) { stale = true; return; }
      if (reimport && !find(target)) { status('That STL layer is gone, nothing was replaced.', true); return; }
      const soup = await soupFromBuffer(buf);
      if (epoch !== _projectEpoch) { stale = true; return; } // a GLB decode is async too
      done = reimport ? reimportStlSoup(soup, file.name, target) : addStlFromSoup(soup, fileBase(file.name));
    });
    if (stale) status(STALE_IMPORT, true);
    else if (done) status('');
  } catch (e) {
    status(`Could not read ${file.name || 'that file'}: ${e && e.message ? e.message : e}`, true);
  }
}
const STALE_IMPORT = 'The project changed while the STL was being read: add it again.';

/** The library sheet's Insert: download the model (all its parts) and add it through the one import path, with where it came from. */
export async function addStlFromLibrary(tile) {
  const epoch = _projectEpoch; // a project load during the download drops it (as importFile)
  try {
    let done = null;
    let stale = false;
    await withLoadingStage('stl', async () => {
      const soup = await downloadModelSoup(tile.id, tile.glbUrl);
      if (epoch !== _projectEpoch) { stale = true; return; }
      done = addStlFromSoup(soup, tile.title, { source: { provider: 'smithsonian', modelUrl: tile.id, title: tile.title, uri: tile.glbUrl } });
    });
    if (stale) status(STALE_IMPORT, true);
    else if (done) status('');
    return done;
  } catch (e) {
    status(`Could not load ${tile.title || 'that model'}: ${e && e.message ? e.message : e}`, true);
    return null;
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
/** What the two file buttons take: STL, and GLB (the glTF loader is there for the library anyway). */
const STL_FILE_ACCEPT = '.stl,model/stl,application/sla,application/octet-stream,.glb,model/gltf-binary';
/** The Stored detail slider's travel (min / max attributes only, NOT a rule: a typed value is taken as setStoredDetail takes it). */
const DETAIL_SLIDER = Object.freeze({ min: 500, step: 500 });

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

/** A row of STL_ACTIONS buttons (the panel's own button row: .photo-layer-buttons, 32 px tall). */
const actionRow = (actions) => el('div', { class: 'photo-layer-buttons' },
  actions.map((a) => el('button', { type: 'button', id: a.id, class: 'cad-btn cad-btn-secondary', text: a.text, title: a.title })));

/** Build the panel from STL_CONTROLS into `body` (main.js, before bindStlPanel). */
export function renderStlPanel(body) {
  if (!body) return;
  body.innerHTML = '';
  body.appendChild(el('div', { class: 'stl-add-row' }, [
    el('button', { type: 'button', id: 'stlAdd', class: 'cad-btn cad-btn-secondary', text: '＋ Add STL…' }),
    el('button', { type: 'button', id: 'stlBrowseSi', class: 'cad-btn cad-btn-secondary', text: '🏛 Browse Smithsonian…', title: 'Pick a model from the Smithsonian\'s open 3D collection' }),
    el('input', { type: 'file', id: 'stlFile', accept: STL_FILE_ACCEPT, style: 'display:none;' }),
    el('input', { type: 'file', id: 'stlReimportFile', accept: STL_FILE_ACCEPT, style: 'display:none;' }),
  ]));
  // a board-wide P key (DEFAULT false): its id IS the key, so main/ui-bindings.js bindControls binds it the generic way
  body.appendChild(el('label', { class: 'cad-label photo-layer-check' }, [el('input', { type: 'checkbox', id: 'stlFitOnInsert' }), el('span', { text: 'Fit new STLs to the carve depth' })]));
  body.appendChild(el('div', { id: 'stlStatus', class: 'photo-layer-note', role: 'status', hidden: '' }));
  body.appendChild(el('div', { id: 'stlErrors', class: 'photo-layer-note stl-error', role: 'status', hidden: '' }));
  body.appendChild(el('div', { id: 'stlList', class: 'stl-list' }));
  const active = el('div', { id: 'stlActive' });
  for (const g of STL_GROUPS) {
    const mine = STL_CONTROLS.filter((c) => c.group === g.id);
    active.appendChild(el('label', { class: 'cad-label photo-layer-group' }, [el('span', { text: g.label }), g.note ? el('span', { class: 'photo-layer-group-note', text: ` ${g.note}` }) : null]));
    for (const c of mine) {
      active.appendChild(renderControl(c));
      const next = STL_ACTIONS.filter((a) => a.after === c.id); // e.g. the quick turns beside their Rotate slider
      if (next.length) active.appendChild(actionRow(next));
    }
    const own = STL_ACTIONS.filter((a) => a.group === g.id && !a.after);
    if (own.length) active.appendChild(actionRow(own));
    if (g.id === 'size') active.appendChild(el('div', { id: 'stlStock', class: 'photo-layer-note stl-error', role: 'status', hidden: '' })); // over the stock: detection only
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
    el('input', { type: 'range', id: 'stlDetailSlider', class: 'cad-slider', min: String(DETAIL_SLIDER.min), max: String(DETAIL_SLIDER.min), step: String(DETAIL_SLIDER.step) }),
    el('div', { class: 'cad-stepper cad-stepper-wide' }, [el('input', { type: 'number', id: 'stlDetail', min: '100', max: '400000', step: '1000' })]),
    el('span', { class: 'stl-unit', text: 'triangles' })]));
  active.appendChild(el('div', { id: 'stlStored', class: 'photo-layer-note' }));
  active.appendChild(el('div', { id: 'stlSource', class: 'photo-layer-note', hidden: '' }));
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
  let h;
  try { h = stlHealth(rec); } catch (e) { return `The stored mesh cannot be read: ${e && e.message ? e.message : e}`; } // shown, not swallowed
  const bits = [h.openEdges === 0 ? 'closed mesh' : `${h.openEdges} open edges in ${h.boundaryLoops} outline${h.boundaryLoops === 1 ? '' : 's'}`];
  if (h.components > 1) bits.push(`${h.components} separate pieces`);
  if (h.nonManifoldEdges) bits.push(`${h.nonManifoldEdges} edges shared by 3+ faces`);
  return `Mesh: ${bits.join(', ')} (reported only; nothing is repaired)`;
}

/** One line per layer the last build could not use (getStlErrors), for the layers still in the project. */
function showStlErrors(recs) {
  const box = byId('stlErrors');
  if (!box) return;
  const lines = [];
  for (const [key, msg] of Object.entries(getStlErrors())) {
    const r = key.startsWith('#') ? recs[Number(key.slice(1))] : recs.find((x) => x && String(x.id) === key);
    if (r) lines.push(`${r.name || 'STL'}: ${msg}`);
  }
  box.textContent = '';
  for (const l of lines) box.appendChild(el('div', { text: l }));
  box.hidden = !lines.length;
}

/** True while the job timeline holds the STL section read-only (the class core/ui-utils.js setSectionReadOnly wrote). */
export function isStlLocked() { return !!byId('stlLayerBody')?.classList.contains('job-readonly'); }

/** The slider's top: the in-memory original's count; else a library model's origTris (it can be downloaded again); else the stored count (down only). */
function detailSliderMax(rec) {
  const original = _originals.get(rec.id);
  if (original && original.indices) return original.indices.length / 3;
  if (rec.source && rec.source.uri && rec.origTris) return rec.origTris;
  return rec.storedTris ?? rec.mesh?.nt ?? 0;
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
    const slider = byId('stlDetailSlider');
    if (slider) {
      const max = detailSliderMax(rec);
      slider.min = String(Math.min(DETAIL_SLIDER.min, max)); // a mesh under 500 triangles still gets a usable travel
      slider.max = String(max);
      slider.value = String(n.storedDetail);
    }
    const stored = byId('stlStored');
    const can = _originals.has(rec.id);
    const refetch = !can && !!(rec.source && rec.source.uri);
    if (stored) stored.textContent = `Stored ${(rec.storedTris ?? rec.mesh?.nt ?? 0).toLocaleString()} of ${(rec.origTris ?? rec.mesh?.nt ?? 0).toLocaleString()} triangles, about ${mb(sizeOf(rec))} MB. ${can ? 'The original is loaded: the detail can go up or down.' : refetch ? 'After a reload, more detail downloads the model again.' : 'After a reload the detail can only go down; re-import the file for more.'}`;
    const src = byId('stlSource');
    if (src) { src.hidden = !rec.source; src.textContent = rec.source ? `From the Smithsonian (CC0): ${rec.source.title || rec.name || ''}` : ''; }
    const h = byId('stlHealth'); if (h) h.textContent = healthText(rec);
    const re = byId('stlReimport'); if (re) re.hidden = can;
  }
  showStlErrors(recs);
  showStlStock();
  const fitBox = byId('stlFitOnInsert'); if (fitBox) fitBox.checked = P.stlFitOnInsert === true;
  if (isStlLocked()) setSectionReadOnly('stl', true); // the rows were rebuilt enabled: put the job-timeline lock back (the one mechanism)
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
  byId('stlSnap')?.addEventListener('click', () => { snapStlBase(); syncStlPanel(); });
  byId('stlCentre')?.addEventListener('click', () => { centreStl(); syncStlPanel(); });
  byId('stlRotReset')?.addEventListener('click', () => { resetStlRotation(); syncStlPanel(); });
  byId('stlDetail')?.addEventListener('change', (e) => setStoredDetail(e.target.value));
  // the slider: the box follows live while dragging; the re-store (a decimate, ~100 ms+) runs on release only
  byId('stlDetailSlider')?.addEventListener('input', (e) => { const b = byId('stlDetail'); if (b) b.value = e.target.value; });
  byId('stlDetailSlider')?.addEventListener('change', (e) => setStoredDetail(e.target.value));
  byId('stlBrowseSi')?.addEventListener('click', () => openStlLibrarySheet({ onPick: (tile) => addStlFromLibrary(tile) }));
  byId('stlGhost')?.addEventListener('change', (e) => { ghostState.visible = !!e.target.checked; _hooks.refreshGhosts(); });
  byId('stlList')?.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-stl-pick]');
    if (pick) { _active = pick.getAttribute('data-stl-pick'); syncStlPanel(); _hooks.refreshGhosts(); }
  });
  byId('stlList')?.addEventListener('change', (e) => {
    const box = e.target.closest('[data-stl-enable]');
    if (box) setStlEnabled(box.getAttribute('data-stl-enable'), box.checked);
  });
  for (const a of STL_ACTIONS) byId(a.id)?.addEventListener('click', () => a.run()); // each run writes, commits and re-syncs
  if (typeof document !== 'undefined') document.addEventListener('stlStockChanged', onStlStockChanged); // one listener (same function)
  for (const c of STL_CONTROLS) {
    if (c.kind === 'slider') {
      const s = byId(`stl_${c.id}Slider`), n = byId(`stl_${c.id}`);
      s?.addEventListener('input', (e) => { if (n) n.value = e.target.value; setStlField(c.id, e.target.value); });
      n?.addEventListener('change', (e) => { setStlField(c.id, e.target.value); syncStlPanel(); }); // the box then shows what the record holds
    } else {
      for (const b of document.querySelectorAll(`#stl_${c.id} [data-stl-choice]`)) {
        b.addEventListener('click', () => { setStlField(c.id, b.getAttribute('data-stl-choice').split(':')[1]); syncStlPanel(); });
      }
    }
  }
  syncStlPanel();
}

/** Test / host hook. */
export function _resetStlPanelForTests() { _active = null; _originals.clear(); _fitAfterBuild.clear(); _hooks = { onChange: () => {}, refreshGhosts: () => {} }; }

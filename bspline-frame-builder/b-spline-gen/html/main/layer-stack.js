/**
 * main/layer-stack.js -- the unified LAYER STACK, step 1 (Fred 2026-11-23; memory project_layer_stack_design, the clickable
 * mockup mock-layer-stack.html): the main panel's LAYERS section lists every layer of the board as a card, READ LIKE THE
 * PIECE (Fred 2026-11-25, STACK_DISPLAY: the top row is stamped LAST and drawn on top; the display is the stamp order
 * reversed), split by the THICKEN LINE -- below it a layer is part of the body (the back follows it, 'withSurface'),
 * above it only the top carries it ('afterBack', core/stamp/placement.js).
 *
 *   - The cards are the sidebar's own panel cards (.panel + .panel-header + .panel-body, tinted by SECTION_THEMES through
 *     section-themes.js themeSectionEl): a fold-open header with the type's icon and colour, several per type.
 *   - LAYER_TYPES declares each kind once: where its layers come from, its card's name / summary / body, its Thicken field
 *     (the engine's own one: an editor layer's `placement`, P.brickSettings.placement, the STL / height record's
 *     `placement`), its Stamp switch and how '+ Add layer' makes one (its app's existing create path).
 *   - Reorder ONLY by dragging a card's ≡ handle (pointer events, touch-action none on the handle alone: the card body still
 *     scrolls the panel). The Thicken line drags the same way. A drop writes each crossed layer's placement; the order is
 *     written (P.layerOrder, core/stamp/order.js) only when the stamp order within a side really changed -- a board never
 *     reordered keeps no order and stamps exactly as before.
 *   - Photo is not a layer here yet (Fred defers it): Surface > Photo stays as it is.
 * Move, don't duplicate: this replaced Board > Layers' list, Vector stamping's layer list and the STL panel's cards; the
 * Thicken panel retired into the Thicken line (its settings, #thickenSettings, open from it).
 */
import { P, scheduleSessionSave } from '../core/state.js';
import { scheduleUndoSnapshot, isEditorOpen } from '../core/history.js';
import { placementOf } from '../core/stamp/placement.js';
import { defaultStackKeys, effectiveOrder, editorLayerKey, isBrickLayerRecord, STACK_BRICKS_KEY } from '../core/stamp/order.js';
import { stampSummaryText, layerStampTarget } from '../core/stamp/target.js';
import {
  isLatticeLayer, isCarved, setLayerCarve, setLayerPlacement, setActiveLayer, addLayer, brickKindLayer, getActiveLayer, typedLayerName,
  setLayerVisible, setLayerShowColor, setLayerLocked, isUserLocked, removeLayer, renameLayer, eyeIconSVG, flashLayerGeometry,
  syncLayerZOrder, applyLayerState, renderLayersPanel,
} from '../editor/layers.js';
import { registerUndoPart } from '../editor/undo-parts.js';
import { patchLayers } from '../core/height/compose.js';
import { FRAME_LABELS } from '../core/frame-labels.js';
import { EDITOR_MOBILE_QUERY, EDITOR_LANDSCAPE_PHONE_QUERY } from '../editor/breakpoints.js';
import { STACK_UNFOLDED_EVENT } from '../editor/editor-drawer.js';
import { commitEdit } from '../editor/editor-commit.js';
import { themeSectionEl, SECTION_ICONS } from './section-themes.js';
import { mountIconGrid } from './icon-select.js';
import {
  openStlId, toggleStlCard, closeStlCards, setStlEnabled, removeStlLayer, setStlField, syncStlPanel, openStlAddSheet, LAYER_STACK_STALE,
} from './stl-panel.js';
import { withLoadingStageShownFirst } from '../core/loading-signal.js';
import { THICKEN_SETTINGS_SYNCED } from './back-flat-ui.js';

/** The stack key of the Thicken line (never a layer: not stored, not in P.layerOrder). */
export const THICKEN_LINE_KEY = 'thicken';

const editor = () => (typeof window !== 'undefined' ? window.svgEditor : null);
const byId = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);
const edLayers = () => { const ed = editor(); return ed && Array.isArray(ed._layers) ? ed._layers : []; };
const brickSettings = () => (P.brickSettings && typeof P.brickSettings === 'object' ? P.brickSettings : null);
/** A heavy main/ module the stack needs only for an action (the editor door, the brick commit, the Height tab): loaded on use. */
const lazy = { framePanel: () => import('./frame-panel.js'), brickPanel: () => import('./brick-panel.js'), heightPanel: () => import('./height-panel.js'),
  lattice: () => import('../editor/editor-lattice-pattern.js') };
/** The editor on 	ab: switched to it when the editor is already up (it stays open), else opened on it. */
async function openEditorTab(tab) {
  if (editorUp()) { const m = await import('./editor-tabs.js'); return m.setEditorTab(tab); }
  const m = await lazy.framePanel(); return m.openEditorOn(tab);
}
const inches = (v) => String(Number(Math.abs(Number(v) || 0).toFixed(3)));

/**
 * The layer kinds, declared once (step 1 of the stack; their sub-layers are step 2, the editor's layer tabs step 3):
 *   theme / icon    the card's colour and glyph (SECTION_THEMES / SECTION_ICONS ids)
 *   editorTab       the editor tab its 'Open in the … tab' opens (main/editor-tabs.js EDITOR_TABS id); none = no such button
 *   name(item) / summary(item)   the header's name and the open card's read-only summary line
 *   placement(item) / setPlacement(item, v)   its Thicken side, through the engine's own field
 *   enabled         { get(item), set(item, on), title }: the header's Stamp switch (absent: none)
 *   remove(item)    the header's trash (absent: none)
 *   add()           '+ Add layer': its app's existing create path; resolves to the new item's key (or null)
 *  The EDITOR view (STACK_VIEWS.editor, Fred 2026-11-23: the editor's layer tabs became this same stack):
 *   stackTab        the editor tab (main/editor-tabs.js EDITOR_TABS id) whose tools + settings a selected row shows
 *   pick(item, sub) make the row the one the editor edits (its app's own active-layer / active-patch call; UI state only)
 *   subRows(item)   its sub-layers, top first: [{ id, name, icon }] (indented fold-open rows; none = no fold)
 */
export const LAYER_TYPES = Object.freeze({
  brick: Object.freeze({
    label: 'Brick', theme: 'brick', icon: SECTION_ICONS.brick, editorTab: 'brick', tabLabel: 'Brick',
    name: () => 'Bricks',
    summary: (item) => {
      const s = brickSettings() || {};
      const parts = item.ref.map((l) => l.name).filter(Boolean).join(' · ');
      return `${parts ? `${parts} — ` : ''}${s.invert ? 'Carved' : 'Raised'} ${inches(s.reliefIn)} in`;
    },
    placement: () => placementOf(brickSettings() && brickSettings().placement),
    async setPlacement(_item, v) {
      if (!P.brickSettings) return;
      if (v === 'afterBack') P.brickSettings.placement = 'afterBack'; else delete P.brickSettings.placement;
      (await lazy.brickPanel()).commitBrickSetting('surface'); // a 3D-only brick setting: re-masks, no re-lay (SURFACE_ONLY_SETTING_KEYS)
    },
    stackTab: 'brick',
    // a part row = its layer becomes the active one (bricks land on the ACTIVE layer, item 22 slice 3)
    pick: (_item, sub) => { const ed = editor(); if (ed && sub != null) { setActiveLayer(ed, sub); flashLayerGeometry(ed, sub); } },
    subRows: (item) => item.ref.map((l) => ({ id: l.id, name: l.name || 'Bricks', icon: '▪' })).reverse(),
    // a new board's bricks start on the Wall's own layer (layers.js BRICK_KIND_LAYERS); they are laid in the Brick tab
    add() {
      const ed = editor();
      if (!ed) return null;
      if (!stackItems().some((i) => i.type === 'brick')) { brickKindLayer(ed, 'wall'); commitEdit(ed); }
      return STACK_BRICKS_KEY;
    },
  }),
  draw: Object.freeze({
    label: 'Vector', theme: 'stamp', icon: SECTION_ICONS.stamp, editorTab: 'artwork', tabLabel: 'Vector',
    name: (item) => item.ref.name || 'Layer',
    summary: (item) => stampSummaryText(layerStampTarget(item.ref)),
    placement: (item) => placementOf(item.ref.placement),
    setPlacement: (item, v) => setLayerPlacement(editor(), item.ref.id, v),
    enabled: { get: (item) => isCarved(item.ref), set: (item, on) => setLayerCarve(editor(), item.ref.id, on), title: 'Stamp this layer into the surface (3D)' },
    stackTab: 'artwork',
    pick: (item) => { const ed = editor(); if (ed) { setActiveLayer(ed, item.ref.id); flashLayerGeometry(ed, item.ref.id); } }, // the old row's flash
    async add() {
      const ed = editor();
      if (!ed) return null;
      // the add (layer panel, session save, change pipeline) runs behind the remask's card, as Vector stamping's '+' did
      const made = await withLoadingStageShownFirst('heightMask', () => { const l = addLayer(ed); setActiveLayer(ed, l.id); return l; });
      return made ? `layer:${made.id}` : null;
    },
  }),
  lattice: Object.freeze({
    label: 'Lattice', theme: 'lattice', icon: SECTION_ICONS.lattice, editorTab: 'lattice', tabLabel: 'Lattice',
    name: (item) => item.ref.name || 'Lattice',
    summary: (item) => stampSummaryText(layerStampTarget(item.ref)),
    placement: (item) => placementOf(item.ref.placement),
    setPlacement: (item, v) => setLayerPlacement(editor(), item.ref.id, v),
    enabled: { get: (item) => isCarved(item.ref), set: (item, on) => setLayerCarve(editor(), item.ref.id, on), title: 'Stamp this layer into the surface (3D)' },
    stackTab: 'lattice',
    pick: (item) => { const ed = editor(); if (ed) { setActiveLayer(ed, item.ref.id); flashLayerGeometry(ed, item.ref.id); } }, // the old row's flash
    // a new layer holding a fresh Lattice pattern (the Lattice panel's own lazy create, editor-lattice-pattern.js freshPattern),
    // then the editor on the Lattice tab: a lattice is made by its Generate there (the Rails / Ties / Nodes layers); until it
    // runs once the layer is a plain drawing layer (layers.js isLatticeLayer: pattern.id, the panels' own signal)
    async add() {
      const ed = editor();
      if (!ed) return null;
      const { freshPattern } = await lazy.lattice();
      const made = addLayer(ed, { name: typedLayerName(edLayers(), 'Lattice'), skipUndo: true }); // named by type, one past the last
      made.pattern = freshPattern(ed);
      setActiveLayer(ed, made.id);
      commitEdit(ed); // ONE undo step: the layer and its pattern
      openEditorTab('lattice');
      return `layer:${made.id}`;
    },
  }),
  height: Object.freeze({
    label: 'Pixel', theme: 'height', icon: SECTION_ICONS.height, editorTab: 'height', tabLabel: 'Pixel',
    name: (item) => item.ref.name || 'Pixel',
    summary: (item) => {
      const n = Array.isArray(item.ref.layers) ? item.ref.layers.length : 1;
      return `${item.ref.raise === false ? 'Carved' : 'Raised'} · ${n} paint layer${n === 1 ? '' : 's'}`;
    },
    placement: (item) => placementOf(item.ref.placement),
    async setPlacement(item, v) { (await lazy.heightPanel()).setHeightField('placement', v, { id: item.ref.id }); },
    enabled: { get: (item) => item.ref.enabled !== false, async set(item, on) { (await lazy.heightPanel()).setHeightEnabled(item.ref.id, on); }, title: 'Stamp this Pixel' },
    async select(item) { (await lazy.heightPanel()).pickHeightPatch(item.ref.id); },
    stackTab: 'height',
    async pick(item, sub) { const hp = await lazy.heightPanel(); hp.pickHeightPatch(item.ref.id); if (sub != null) hp.selectPatchLayer(sub); },
    // its paint / image layers (core/height/compose.js patchLayers, bottom first): top first, as the Height panel lists them
    subRows: (item) => patchLayers(item.ref).map((l) => ({ id: l.id, name: l.name || 'Layer', icon: l.kind === 'image' ? '🖼' : '🖌' })).reverse(),
    async add() { const rec = await (await lazy.heightPanel()).newHeightPatch(); return rec ? `height:${rec.id}` : null; },
  }),
  stl: Object.freeze({
    label: 'Mesh', theme: 'stl', icon: SECTION_ICONS.stl, editorTab: null,
    name: (item) => item.ref.name || 'Mesh',
    summary: () => '', // its open card holds the STL panel's own settings (main/stl-panel.js #stlActive)
    placement: (item) => placementOf(item.ref.placement),
    setPlacement: (item, v) => setStlField('placement', v, item.ref.id),
    enabled: { get: (item) => item.ref.enabled !== false, set: (item, on) => setStlEnabled(item.ref.id, on), title: 'Stamp this Mesh' },
    remove: (item) => removeStlLayer(item.ref.id),
    stackTab: 'stl', // no 2D view yet (planned): its panel points to the sidebar card
    pick: (item) => { _edStlKey = item.key; },
    // the STL add sheet; the new record arrives later (a download): it lands on 'stlLayersChanged' (_pendingAdd)
    add() { _pendingAdd = { type: 'stl', before: new Set((P.stlLayers || []).filter(Boolean).map((r) => r.id)) }; openStlAddSheet(); return null; },
  }),
});
/** '+ Add layer's tiles, in Fred's order (no Photo: deferred). */
export const LAYER_ADD_TYPES = Object.freeze(['brick', 'draw', 'lattice', 'height', 'stl']);
/** Fred (2026-11-23, "are layers expandable into their full previous panel fields?"): the blocks of the old panels an OPEN
 *  card shows, after its summary and its editor door -- MOVED in, parked back (never copied, every id stays unique).
 *    content  the block's id;  park  where it lives while no card shows it;  hide  hide it while parked
 *    hosts    the card types (LAYER_TYPES ids) / stack keys that show it;  none = its own panel moves it in (the STL settings:
 *             main/stl-panel.js syncStlPanel hosts #stlActive in the open STL card; the stack only parks it on a re-render)
 *    editorHome  its park IS its place in the 2D editor (the Draw tab's Stamp branch): while the editor is open it stays there
 *  A Height patch card hosts none: a patch has no sidebar fields (they are all in the editor's Height tab). */
export const HOSTED = Object.freeze([
  Object.freeze({ content: 'stlActive', park: 'stlLayerBody', hide: true }),
  Object.freeze({ content: 'thickenSettings', park: 'thickenSettingsPark', hosts: Object.freeze([THICKEN_LINE_KEY]) }),
  // the selected layer's stamp settings (Relief + Height, Tool profile, V-bit angle, Fusion geometry, Transform, Blur,
  // Smoothing, Smooth the terrain, Edge fillet, Fillet sharpness, metrics: DRAW-STAMP U's moved controls): an open Draw /
  // Lattice card IS the selected layer (opening it makes it active), so they edit that layer
  Object.freeze({ content: 'stampLayerSettings', park: 'drawStampBody', hosts: Object.freeze(['draw', 'lattice']), editorHome: true }),
  Object.freeze({ content: 'stampBlueprint', park: 'layerStackPark', hosts: Object.freeze(['draw']) }), // fills the whole layer
  Object.freeze({ content: 'brickPanelBody', park: 'layerStackPark', hosts: Object.freeze(['brick']) }), // the old Brick panel's body
]);
/** The editor modal is up (core/history.js isEditorOpen): an editorHome block stays in the editor then. */
const editorUp = () => { try { return !!isEditorOpen(); } catch (_) { return false; } };

/** The stack READS LIKE THE PIECE (Fred 2026-11-25), in the sidebar and the editor alike: the top row is stamped LAST and
 *  drawn on top in 2D; the bottom is closest to the body. Above the Thicken line: top-only detail ('afterBack'); below it:
 *  part of the body ('withSurface'); the Frame (the editor's fixed row) is the base, at the very bottom. DISPLAY ONLY: the
 *  stored stamp order (P.layerOrder, the editor roster) and every placement are what they were -- the rows are drawn in
 *  reverse, and a drop is read back in stamp order (stackSequence). */
export const STACK_DISPLAY = Object.freeze({ topRow: 'stampedLast', aboveLine: 'afterBack', belowLine: 'withSurface', fixedRows: 'bottom' });
/** One side's items in display order (top row first): that side's stamp order, reversed. */
const displayOrder = (items, side) => items.filter((i) => (itemPlacement(i) === 'afterBack') === (side === 'afterBack')).reverse();

// ── the items ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** Pure-ish: every layer of the board as { key, type, ref } in STACK ORDER (core/stamp/order.js effectiveOrder): editor
 *  layers (Draw / Lattice; every brick layer is the ONE Brick item, ref = its layers), STL records, height patches. */
export function stackItems() {
  const layers = edLayers();
  const hasBricks = (l) => !!(l && l._brickMask); // the stamp-mask manager's brick pass of that layer
  const byKey = new Map();
  for (const l of layers) {
    if (!l || isBrickLayerRecord(l)) continue;
    byKey.set(editorLayerKey(l), { key: editorLayerKey(l), type: isLatticeLayer(layers, l.id) ? 'lattice' : 'draw', ref: l });
  }
  const bricks = layers.filter((l) => l && (isBrickLayerRecord(l) || hasBricks(l)));
  if (bricks.length) byKey.set(STACK_BRICKS_KEY, { key: STACK_BRICKS_KEY, type: 'brick', ref: bricks });
  for (const r of Array.isArray(P.stlLayers) ? P.stlLayers : []) if (r) byKey.set(`stl:${r.id}`, { key: `stl:${r.id}`, type: 'stl', ref: r });
  for (const r of Array.isArray(P.heightLayers) ? P.heightLayers : []) if (r) byKey.set(`height:${r.id}`, { key: `height:${r.id}`, type: 'height', ref: r });
  const keys = effectiveOrder(defaultStackKeys(layers, P.stlLayers, P.heightLayers, hasBricks), P.layerOrder);
  return keys.filter((k) => byKey.has(k)).map((k) => byKey.get(k));
}
export const itemPlacement = (item) => LAYER_TYPES[item.type].placement(item);

/** Pure: the keys of each side of the line, in order, for a key sequence and a placement rule. */
const sides = (keys, side) => ['withSurface', 'afterBack'].map((z) => keys.filter((k) => side(k) === z));
const sameSides = (a, b) => a.every((zone, i) => zone.length === b[i].length && zone.every((k, j) => k === b[i][j]));

/**
 * A drop: `seq` = the stack as the user left it (layer keys + THICKEN_LINE_KEY). Every layer above the line is written
 * 'withSurface', below 'afterBack' -- only those that changed side, through their type's own field. P.layerOrder is written
 * only when the stamp order within a side differs from the stack's current one (a pure crossing writes no order).
 * Returns { order: written?, moved: [keys whose side changed] }. One undo step.
 */
export async function applyStackDrop(seq) {
  const items = stackItems();
  const byKey = new Map(items.map((i) => [i.key, i]));
  const line = seq.indexOf(THICKEN_LINE_KEY);
  const keys = seq.filter((k) => k !== THICKEN_LINE_KEY && byKey.has(k));
  if (keys.length !== items.length) return { order: false, moved: [] }; // a stale drop (the board changed under it)
  const aboveCount = line < 0 ? keys.length : seq.slice(0, line).filter((k) => byKey.has(k)).length;
  const want = new Map(keys.map((k, i) => [k, i < aboveCount ? 'withSurface' : 'afterBack']));
  const side = (k) => want.get(k);
  let order = false;
  if (!sameSides(sides(keys, side), sides(items.map((i) => i.key), side))) { P.layerOrder = [...keys]; order = true; }
  const moved = keys.filter((k) => itemPlacement(byKey.get(k)) !== want.get(k));
  for (const k of moved) { const it = byKey.get(k); await LAYER_TYPES[it.type].setPlacement(it, want.get(k)); }
  // ONE order everywhere (Fred 2026-11-25, as the old Layers list did): a new stack order is also the 2D drawing order --
  // a row higher in the stack draws ON TOP. The roster follows (editor layers bottom first), the drawing's nodes with it;
  // ONE editor step holds both (the 'layerOrder' undo part below rides in it), so Undo puts both back.
  if (order) applyDrawOrder(keys);
  if (order || moved.length) {
    scheduleSessionSave();
    scheduleUndoSnapshot('layerStack', 'Layers');
    if (order) _hooks.onChange(); // a crossing commits through its own type (and rebuilds); a new order rebuilds here
  }
  refreshLayerStack();
  return { order, moved };
}

/** Pure: the editor roster (bottom of the drawing first) for the stamp order `keys` (stamped first first): the same order --
 *  the last stamped draws on top, the top row of the stack (STACK_DISPLAY reversed) -- each key's own
 *  layers (the Bricks item = every brick layer, in its roster order) in their place; a layer the stack does not list keeps
 *  its place at the bottom. null = the roster is already in that order. */
export function drawOrderForStack(keys, layers) {
  const list = Array.isArray(layers) ? layers.filter(Boolean) : [];
  const groups = new Map();
  for (const l of list) { const k = editorLayerKey(l); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(l); }
  const top = [];
  for (const k of keys) { const g = groups.get(k); if (g) { top.push(...g); groups.delete(k); } }
  const next = [...list.filter((l) => !top.includes(l)), ...top];
  return next.length === list.length && next.every((l, i) => l === list[i]) ? null : next;
}
/** A stack drop's new order, applied to the drawing: the roster reordered, the nodes re-stacked, ONE editor step. */
function applyDrawOrder(keys) {
  const ed = editor();
  const next = ed && drawOrderForStack(keys, ed._layers);
  if (!next) { if (ed) commitEdit(ed); return false; } // the stamp order alone changed: still one step (the undo part holds it)
  ed._layers.splice(0, ed._layers.length, ...next);
  syncLayerZOrder(ed);
  applyLayerState(ed);
  renderLayersPanel(ed);
  commitEdit(ed);
  return true;
}
/** The stack's order (P.layerOrder) rides in the editor's undo entries (editor/undo-parts.js): an Undo of a stack drop puts
 *  the stamp order back with the drawing order (the roster + nodes are the entry's own). */
registerUndoPart('layerOrder', {
  take: () => (Array.isArray(P.layerOrder) ? [...P.layerOrder] : P.layerOrder ?? null),
  restore: (v) => {
    const now = Array.isArray(P.layerOrder) ? P.layerOrder.join('|') : null, was = Array.isArray(v) ? v.join('|') : null;
    if (now === was) return;
    P.layerOrder = Array.isArray(v) ? [...v] : v;
    _lastSig = null;
    _hooks.onChange();
    refreshLayerStack();
  },
});

/** A new layer lands at the top of the BODY side -- on screen just BELOW the Thicken line (STACK_DISPLAY; its stored
 *  placement is today's 'withSurface'): when it is not already the last stamped of that side, the stack's order is
 *  written with it there (the user placed it by adding it). Already there: nothing is written. */
export function landAboveLine(key) {
  const items = stackItems();
  const it = items.find((i) => i.key === key);
  if (!it || itemPlacement(it) === 'afterBack') return false;
  const above = items.filter((i) => itemPlacement(i) !== 'afterBack').map((i) => i.key);
  if (above[above.length - 1] === key) return false;
  const rest = items.map((i) => i.key).filter((k) => k !== key);
  const lastAbove = above.filter((k) => k !== key).pop();
  rest.splice(lastAbove ? rest.indexOf(lastAbove) + 1 : 0, 0, key);
  P.layerOrder = rest;
  scheduleSessionSave();
  scheduleUndoSnapshot('layerStack', 'Layers');
  _hooks.onChange();
  return true;
}

// ── state + rendering ──────────────────────────────────────────────────────────────────────────────────────────────
let _hooks = { onChange: () => {} };
let _openKey = null;   // the open non-STL card (or the Thicken line); an STL card's open state is main/stl-panel.js's
let _drag = null;      // the card being dragged: renders wait for its drop
let _dirty = false;
let _rendering = false;
let _pendingAdd = null; // an STL picked from '+ Add layer' (it arrives after a download)
let _lastSig = null;    // what the cards on screen show (refreshLayerStack: unchanged = text only, no rebuild)

const el = (tag, attrs = {}, kids = []) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'text') e.textContent = v; else if (k === 'class') e.className = v; else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids) if (k) e.appendChild(k);
  return e;
};

const isOpen = (item) => (item.type === 'stl' ? String(openStlId()) === String(item.ref.id) : _openKey === item.key);

function parkHosted() {
  for (const h of HOSTED) {
    const c = byId(h.content), park = byId(h.park);
    if (!c || !park || park.contains(c)) continue;
    if (h.hide) c.hidden = true;
    park.appendChild(c);
  }
}

function cardFor(item, after) {
  const T = LAYER_TYPES[item.type];
  const open = isOpen(item);
  const stl = item.type === 'stl';
  const card = el('div', {
    class: `panel layer-card${stl ? ' stl-card' : ''}${open ? (stl ? ' stl-card-open' : '') : ' collapsed'}${after ? ' layer-card-after' : ''}`,
    role: 'listitem', 'data-stack-key': item.key, 'data-stack-type': item.type,
    ...(stl ? { 'data-stl-card': item.ref.id, 'data-job-lock': 'stl' } : {}),
  });
  themeSectionEl(card, T.theme);
  const name = T.name(item);
  const head = el('div', { class: `panel-header layer-card-head${stl ? ' stl-row' : ''}` }, [
    el('span', { class: 'layer-card-handle', title: 'Drag to move (stamp order; across the Thicken line: body or top only)', 'aria-label': `Move ${name}`, role: 'button', text: '≡' }),
    el('span', { class: 'layer-card-icon', 'aria-hidden': 'true', text: T.icon }),
    T.enabled ? el('input', { type: 'checkbox', class: 'layer-card-enable', title: T.enabled.title, 'aria-label': T.enabled.title, ...(stl ? { 'data-stl-enable': item.ref.id } : {}) }) : null,
    // one row at any width: the name truncates (ellipsis); its title is the full name + type (Fred 2026-11-23)
    el('button', { type: 'button', class: `layer-card-name${stl ? ' stl-row-name' : ''}`, id: cardNameId(item.key), 'data-stack-open': item.key, 'aria-expanded': String(open),
      ...(stl ? { 'data-stl-pick': item.ref.id } : {}), title: `${name} — ${T.label}${after ? ', top only' : ''}` },
    [el('span', { class: 'layer-card-title', text: name }), el('span', { class: 'layer-card-type', text: after ? `${T.label} · top only` : T.label })]),
    stl ? el('span', { class: 'stl-row-warn', 'data-stl-warn': item.ref.id, role: 'img', 'aria-label': 'Over the stock', text: '⚠', hidden: true }) : null,
    T.remove ? el('button', { type: 'button', class: 'layer-card-del stl-row-del', ...(stl ? { 'data-stl-del': item.ref.id } : {}), title: `Remove ${name}`, 'aria-label': `Remove ${name}`, text: '🗑' }) : null,
  ]);
  const box = head.querySelector('.layer-card-enable');
  if (box) box.checked = !!T.enabled.get(item);
  const body = el('div', { class: `panel-body layer-card-body${stl ? ' stl-card-body' : ''}` });
  if (!stl && open) fillBody(item, body);
  card.append(head, body);
  return card;
}

/** An open card's body (not STL: its own panel hosts its settings): the summary + the editor door. */
function fillBody(item, body) {
  const T = LAYER_TYPES[item.type];
  const text = T.summary(item);
  if (text) body.appendChild(el('div', { class: 'layer-card-summary', text }));
  if (T.enabled && !T.enabled.get(item)) body.appendChild(el('div', { class: 'layer-card-note', text: 'Not stamped (its box is off).' }));
  if (T.editorTab) {
    const b = el('button', { type: 'button', class: 'cad-btn cad-btn-secondary layer-card-door', id: cardNameId(item.key).replace('layerCardName_', 'layerCardDoor_'), 'data-stack-door': item.key, text: `Open in the ${T.tabLabel} tab ›` });
    b.addEventListener('click', () => openItemInEditor(item));
    body.appendChild(b);
  }
}

async function openItemInEditor(item) {
  const T = LAYER_TYPES[item.type];
  const ed = editor();
  if ((item.type === 'draw' || item.type === 'lattice') && ed) setActiveLayer(ed, item.ref.id);
  if (T.select) await T.select(item);
  return openEditorTab(T.editorTab);
}

/** The Thicken line. `edit`: the editor view's (its own ids; a line, not a card: no body, its settings stay in the sidebar). */
function thickenLine({ edit = false } = {}) {
  const open = !edit && _openKey === THICKEN_LINE_KEY;
  const card = el('div', { class: `panel layer-card layer-thicken-line${open ? '' : ' collapsed'}${edit ? ' ed-stack-card ed-stack-line' : ''}`, role: 'listitem', 'data-stack-key': THICKEN_LINE_KEY });
  themeSectionEl(card, 'thicken');
  const head = el('div', { class: 'panel-header layer-card-head' }, [
    el('span', { class: 'layer-card-handle', title: 'Drag the line: layers below it are part of the body, above it top-only detail', 'aria-label': 'Move the Thicken line', role: 'button', text: '≡' }),
    el('span', { class: 'layer-card-icon', 'aria-hidden': 'true', text: SECTION_ICONS.thicken }),
    el('button', { type: 'button', class: `layer-card-name${edit ? ' ed-stack-name' : ''}`, id: edit ? edRowId(THICKEN_LINE_KEY) : cardNameId(THICKEN_LINE_KEY),
      ...(edit ? {} : { 'data-stack-open': THICKEN_LINE_KEY, 'aria-expanded': String(open) }), title: 'Thicken: below the line part of the body, above it top-only detail' },
      [el('span', { class: 'layer-card-title', text: 'Thicken' }), el('span', { class: 'layer-card-state', id: edit ? 'editorLayerStackThickenState' : 'layerStackThickenState', text: thickenState() }),
        el('span', { class: 'layer-card-type', text: edit ? '↓ body · ↑ top only' : 'below: part of the body · above: top only' })]),
  ]);
  card.append(head);
  if (!edit) card.append(el('div', { class: 'panel-body layer-card-body', id: 'layerStackThickenBody' }));
  return card;
}
/** The open card's body gets the HOSTED blocks declared for its type / key, in their declared order. */
function hostOpen(listEl, items) {
  const open = [...listEl.children].find((c) => !c.classList.contains('collapsed') && c.dataset.stackType !== 'stl');
  if (!open) return;
  const key = open.dataset.stackKey, type = key === THICKEN_LINE_KEY ? null : (items.find((i) => i.key === key) || {}).type;
  const body = open.querySelector(':scope > .layer-card-body');
  for (const h of HOSTED) {
    if (!h.hosts || !(h.hosts.includes(key) || (type && h.hosts.includes(type)))) continue;
    if (h.editorHome && editorUp()) continue; // the editor shows it now
    const c = byId(h.content);
    if (c && body) { body.appendChild(c); c.hidden = false; }
  }
}
/** A card's name button id (the brick matrix opens a card by it): layerCardName_<key>, ':' as '_'. */
export const cardNameId = (key) => `layerCardName_${String(key).replace(/[^A-Za-z0-9_-]/g, '_')}`;
// Back 'flat' (Fred 2026-11-23): the body is solid to z = 0, the thickness is not used -- the line says so
const thickenState = () => (!P.thickenEnabled ? 'off' : P.backMode === 'flat' ? 'flat back' : `${inches(P.thickness)} in`);
/** Both views' Thicken line state text, from its one function. */
const syncThickenStates = () => { for (const id of ['layerStackThickenState', 'editorLayerStackThickenState']) { const s = byId(id); if (s) s.textContent = thickenState(); } };

/** Re-reads the board and rebuilds the stack (safe any time: a load, an undo, a roster change). */
export function refreshLayerStack() {
  const listEl = byId('layerStackList');
  if (!listEl) return;
  if (_drag) { _dirty = true; return; }
  if (_rendering) { _dirty = true; return; }
  _rendering = true;
  try {
    const items = stackItems();
    if (_openKey && _openKey !== THICKEN_LINE_KEY && !items.some((i) => i.key === _openKey)) _openKey = null;
    // the same cards as on screen (keys, names, sides, Stamp boxes, the open one, the editor up or not): only their text is
    // refreshed -- a rebuild would move the hosted fields out from under a slider being dragged or a box being typed in
    const sig = JSON.stringify([items.map((i) => [i.key, i.type, LAYER_TYPES[i.type].name(i), itemPlacement(i),
      LAYER_TYPES[i.type].enabled ? !!LAYER_TYPES[i.type].enabled.get(i) : null, isOpen(i)]), _openKey, editorUp()]);
    if (sig === _lastSig && listEl.childElementCount) {
      for (const c of listEl.children) {
        const it = items.find((i) => i.key === c.dataset.stackKey), line = c.querySelector(':scope > .layer-card-body > .layer-card-summary');
        if (it && line) line.textContent = LAYER_TYPES[it.type].summary(it);
      }
      const st = byId('layerStackThickenState'); if (st) st.textContent = thickenState();
    } else {
      _lastSig = sig;
      parkHosted();
      listEl.innerHTML = '';
      // read like the piece (STACK_DISPLAY): the top-only detail on top, then the line, then the body; each side's
      // order reversed -- the top row is stamped LAST
      for (const i of displayOrder(items, 'afterBack')) listEl.appendChild(cardFor(i, true));
      listEl.appendChild(thickenLine());
      for (const i of displayOrder(items, 'withSurface')) listEl.appendChild(cardFor(i, false));
      hostOpen(listEl, items);
      const sum = byId('layerStackSummary');
      if (sum) sum.textContent = `${items.length} layer${items.length === 1 ? '' : 's'}`;
    }
  } finally { _rendering = false; }
  syncStlPanel(); // the STL cards' state + its settings in the open one (and the job-timeline lock back on them)
  if (_dirty) { _dirty = false; refreshLayerStack(); return; }
  refreshEditorStack(); // the editor's view of the same stack
}

/** Open one card (or the Thicken line) by its key and scroll it into view: the job timeline's Back opens the line. */
export function openLayerStackItem(key) {
  const item = stackItems().find((i) => i.key === key);
  if (item && item.type === 'stl') { _openKey = null; if (!isOpen(item)) toggleStlCard(item.ref.id); }
  else { _openKey = key; closeStlCards(); if (item && (item.type === 'draw' || item.type === 'lattice') && editor()) setActiveLayer(editor(), item.ref.id); }
  refreshLayerStack();
  const card = [...(byId('layerStackList')?.children || [])].find((c) => c.dataset.stackKey === key);
  if (card && typeof card.scrollIntoView === 'function') card.scrollIntoView({ block: 'nearest' });
  return !!card;
}

function toggleItem(key) {
  if (key === THICKEN_LINE_KEY) { _openKey = _openKey === key ? null : key; closeStlCards(); refreshLayerStack(); return; }
  const item = stackItems().find((i) => i.key === key);
  if (!item) return;
  if (item.type === 'stl') { _openKey = null; toggleStlCard(item.ref.id); refreshLayerStack(); return; }
  const opening = _openKey !== key;
  _openKey = opening ? key : null;
  closeStlCards();
  // a Draw / Lattice card opened = the active layer (Vector stamping's SVG Blueprint fills it, the editor opens on it)
  if (opening && (item.type === 'draw' || item.type === 'lattice') && editor()) setActiveLayer(editor(), item.ref.id);
  refreshLayerStack();
}

// ── drag by the handle ─────────────────────────────────────────────────────────────────────────────────────────────
const AUTOSCROLL = Object.freeze({ edgePx: 40, stepPx: 12 });
function scrollParent(node) {
  // from the list itself: the editor's list scrolls on its own (past EDITOR_STACK_LAYOUTS' rows); the sidebar's has no box
  for (let n = node; n; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}
function paintSides(listEl) {
  let after = true; // above the line (STACK_DISPLAY): top-only detail
  for (const c of listEl.children) {
    if (c.dataset.stackKey === THICKEN_LINE_KEY) { after = false; continue; }
    if (c.dataset.stackKey) c.classList.toggle('layer-card-after', after);
  }
}
/** The stack's keys in STAMP ORDER (stamped first first, the Thicken line between the sides), read from a list on screen:
 *  its rows bottom to top (STACK_DISPLAY: the display is the stamp order reversed). */
export const stackSequence = (listEl = byId('layerStackList')) => (listEl ? [...listEl.children].map((c) => c.dataset.stackKey).filter(Boolean).reverse() : []);

function startDrag(e, handle) {
  if (e.button !== undefined && e.button !== 0) return;
  const card = handle.closest('[data-stack-key]');
  const listEl = card && card.parentElement;
  if (!card || !listEl) return;
  e.preventDefault();
  e.stopPropagation();
  const pointerId = e.pointerId;
  try { handle.setPointerCapture(pointerId); } catch (_) { /* a synthetic event may not capture */ }
  const start = stackSequence(listEl);
  const scroller = scrollParent(listEl);
  _drag = { card, pointerId };
  card.classList.add('dragging');
  const move = (ev) => {
    if (ev.pointerId !== pointerId) return;
    if (scroller) {
      const r = scroller.getBoundingClientRect();
      if (ev.clientY < r.top + AUTOSCROLL.edgePx) scroller.scrollTop -= AUTOSCROLL.stepPx;
      else if (ev.clientY > r.bottom - AUTOSCROLL.edgePx) scroller.scrollTop += AUTOSCROLL.stepPx;
    }
    let before = null;
    for (const c of listEl.children) {
      if (c === card || !c.dataset.stackKey) continue;
      const r = c.getBoundingClientRect();
      if (ev.clientY < r.top + r.height / 2) { before = c; break; }
    }
    if (!before) before = listEl.querySelector(':scope > [data-stack-fixed]'); // a fixed row (the Frame, the base) stays last
    if (before !== card.nextElementSibling && before !== card) { listEl.insertBefore(card, before); paintSides(listEl); }
  };
  // the moves / the release are read on the DOCUMENT: the card moves in the list while it is dragged, and a moved element
  // loses its pointer capture (measured in Chrome: the release then never reached the handle and the drop was lost)
  const doc = handle.ownerDocument;
  const finish = () => {
    doc.removeEventListener('pointermove', move);
    doc.removeEventListener('pointerup', up);
    doc.removeEventListener('pointercancel', cancel);
    try { handle.releasePointerCapture(pointerId); } catch (_) { /* see setPointerCapture */ }
    card.classList.remove('dragging');
    _drag = null;
    _lastSig = null; // the cards were moved by hand: the next refresh rebuilds them in the stack's order
  };
  const up = (ev) => {
    if (ev.pointerId !== pointerId) return;
    const seq = stackSequence(listEl);
    finish();
    if (seq.join('|') === start.join('|')) { refreshLayerStack(); return; }
    applyStackDrop(seq);
  };
  const cancel = (ev) => { if (ev.pointerId !== pointerId) return; finish(); refreshLayerStack(); };
  doc.addEventListener('pointermove', move);
  doc.addEventListener('pointerup', up);
  doc.addEventListener('pointercancel', cancel);
}

// ── + Add layer ────────────────────────────────────────────────────────────────────────────────────────────────────
/** '+ Add layer': the type's own create path, then the new layer lands just above the Thicken line with its card open. */
export async function addStackLayer(type) {
  const T = LAYER_TYPES[type];
  if (!T) return null;
  const key = await T.add();
  if (!key) { refreshLayerStack(); return null; }
  landAboveLine(key);
  return openLayerStackItem(key) ? key : null;
}

/** Where the '+ Add layer' picker is (Fred 2026-11-23: the sidebar's Layers branch, and the editor's tab row "with the same
 *  modal"): the same LAYER_ADD_TYPES tiles, the same mountIconGrid call, the same pickAddType. `ids` = its tiles' prefix and
 *  its picker's ids; `inEditor` = the editor stays open and then shows the new layer's tab. */
export const ADD_PICKERS = Object.freeze([
  Object.freeze({ grid: 'layerStackAddGrid', prefix: 'layerStackAdd_', label: '＋ Add layer', ids: Object.freeze({ wrap: 'layerStackAdd', chip: 'layerStackAddBtn' }), inEditor: false }),
  // the editor layer stack's head (Fred 2026-11-23: '+ Add layer' in the editor with the same picker)
  Object.freeze({ grid: 'editorLayerStackAddGrid', prefix: 'editorLayerStackAdd_', label: '＋ Add layer', ids: Object.freeze({ wrap: 'editorLayerStackAdd', chip: 'editorLayerStackAddBtn' }), inEditor: true }),
]);

/** A picker's tile picked: THE add (addStackLayer); from the editor, the new layer's row is then selected (the editor stays
 *  open and shows its type's tools; the new Draw / Lattice layer is already the active one, a new patch the active patch). */
export async function pickAddType(type, picker = ADD_PICKERS[0]) {
  const key = await addStackLayer(type);
  if (picker.inEditor && key && editorUp()) await selectEditorRow(key);
  return key;
}

// ── the EDITOR view (Fred 2026-11-23) ──────────────────────────────────────────────────────────────────────────────
/** The stack's views: ONE data (stackItems), ONE card look, ONE drag; each view its list and what a header tap does.
 *    sidebar  tap = the card expands inline (its summary, its editor door, its HOSTED blocks)
 *    editor   tap = the row is SELECTED: the editor shows that layer's tools + settings below the list (no card body);
 *             a fixed, locked first row (EDITOR_FIXED_ROWS), sub-layers as indented fold-open rows (LAYER_TYPES subRows) */
export const STACK_VIEWS = Object.freeze({
  sidebar: Object.freeze({ list: 'layerStackList', pane: null, tap: 'expand' }),
  editor: Object.freeze({ list: 'editorLayerStackList', pane: 'editorLayerStack', tap: 'select' }),
});
/** The editor view's fixed rows, above every layer: never dragged, never removed (the Frame: the board's wood frame). */
export const EDITOR_FIXED_ROWS = Object.freeze([
  Object.freeze({ key: 'frame', theme: 'frame', icon: SECTION_ICONS.frame, name: () => FRAME_LABELS.wood, type: 'locked', stackTab: 'frame' }),
]);
/** Per breakpoint (Fred 2026-11-24: "think mobile and desktop"), first match wins -- ONE component, its arrangement declared:
 *    fold     the list folds to the selected row (tap it to unfold; picking a row folds it again)
 *    maxRows  rows the list shows before it scrolls on its own (the settings below always scroll separately)
 *  phone      the editor's drawer (editor/breakpoints.js: below 768 px, or a phone held sideways): the drawer is the only
 *             panel -> fold
 *  desktop    the right-hand column (Fred 2026-11-24: from 768 px -- a tablet, a narrow window, a desktop): open, ~6 rows */
export const EDITOR_STACK_LAYOUTS = Object.freeze([
  Object.freeze({ id: 'phone', query: `${EDITOR_MOBILE_QUERY}, ${EDITOR_LANDSCAPE_PHONE_QUERY}`, fold: true, maxRows: 5 }),
  Object.freeze({ id: 'desktop', query: null, fold: false, maxRows: 6 }),
]);
const FRAME_ROW_KEY = EDITOR_FIXED_ROWS[0].key;
let _edFolded = true;          // the phone layout's fold (UI state)
const _edSubsOpen = new Set(); // rows whose sub-layers are folded open (the selected row's open when it is picked)
let _edStlKey = null;          // the STL row selected (an STL has no editor state of its own yet)
let _edMods = { tabs: null, height: null };
const loadTabs = async () => (_edMods.tabs = _edMods.tabs || await import('./editor-tabs.js'));

export function editorStackLayout() {
  const mm = (q) => { try { return typeof matchMedia === 'function' && matchMedia(q).matches; } catch (_) { return false; } };
  return EDITOR_STACK_LAYOUTS.find((L) => !L.query || mm(L.query)) || EDITOR_STACK_LAYOUTS[EDITOR_STACK_LAYOUTS.length - 1];
}
/** An editor row's id (the matrix / tests pick a row by it): edStackRow_<key>[__<sub id>], ':' as '_'. */
export const edRowId = (key, sub = null) => `edStackRow_${String(key).replace(/[^A-Za-z0-9_-]/g, '_')}${sub != null ? `__${String(sub).replace(/[^A-Za-z0-9_-]/g, '_')}` : ''}`;

/** Which row the editor is editing, DERIVED (never stored twice): the editor's tab + its active layer / active patch. */
export function editorSelection(items = stackItems()) {
  const tab = _edMods.tabs ? _edMods.tabs.getEditorTab() : 'artwork';
  if (tab === 'frame') return { key: FRAME_ROW_KEY, sub: null };
  if (tab === 'stl') return { key: _edStlKey, sub: null };
  if (tab === 'height') {
    const hp = _edMods.height, rec = hp && hp.activeHeightLayer(), l = hp && rec ? hp.activePatchLayer() : null;
    return { key: rec ? `height:${rec.id}` : null, sub: l ? l.id : null };
  }
  const ed = editor(), id = ed ? getActiveLayer(ed) : null;
  const l = edLayers().find((x) => x && x.id === id);
  const bricks = items.find((i) => i.type === 'brick');
  const inBricks = !!(l && bricks && bricks.ref.includes(l));
  if (tab === 'brick') return { key: STACK_BRICKS_KEY, sub: inBricks ? l.id : null };
  if (inBricks && isBrickLayerRecord(l)) return { key: STACK_BRICKS_KEY, sub: l.id };
  return { key: l ? editorLayerKey(l) : null, sub: null };
}

/** Select a row: its type's pick (the app's own active-layer / patch call), then the editor shows its type's tab. */
export async function selectEditorRow(key, sub = null) {
  let tab;
  if (key === FRAME_ROW_KEY) tab = EDITOR_FIXED_ROWS[0].stackTab;
  else {
    const item = stackItems().find((i) => i.key === key);
    if (!item) return false;
    const T = LAYER_TYPES[item.type];
    if (T.pick) await T.pick(item, sub);
    if (T.subRows && sub != null) _edSubsOpen.add(key);
    tab = T.stackTab;
  }
  if (!tab) return false;
  const tabs = await loadTabs();
  if (tabs.getEditorTab() !== tab) tabs.setEditorTab(tab); else refreshEditorStack();
  if (editorStackLayout().fold) { _edFolded = true; refreshEditorStack(); }
  return true;
}

function fixedRow(f, sel) {
  const selected = sel.key === f.key;
  const card = el('div', { class: `panel layer-card ed-stack-card ed-stack-fixed${selected ? ' is-selected' : ''}`, role: 'listitem', 'data-stack-fixed': f.key });
  themeSectionEl(card, f.theme);
  const name = f.name();
  card.append(el('div', { class: 'panel-header layer-card-head' }, [
    el('span', { class: 'layer-card-handle ed-stack-lock', title: 'The frame is always the first layer', 'aria-label': 'Locked first', text: '🔒' }),
    el('span', { class: 'layer-card-icon', 'aria-hidden': 'true', text: f.icon }),
    el('button', { type: 'button', class: 'layer-card-name ed-stack-name', id: edRowId(f.key), 'data-ed-select': f.key, 'aria-pressed': String(selected), title: `${name} (always first)` },
      [el('span', { class: 'layer-card-title', text: name }), el('span', { class: 'layer-card-type', text: f.type })]),
    el('span', { class: 'ed-stack-unfold', 'aria-hidden': 'true', text: '▾' }),
  ]));
  return card;
}

// ── the editor rows' controls (Fred 2026-11-24, phase 2): the EYE on every row; everything else the old Layers list row
// had (lock, rename, delete, Stamp / carve, own colours; a paint layer's up / down) in ONE ⋯ menu per row, opened with the
// editor's own context-menu popover (editor/editor-context-menu.js openMenuRows) -- declared below, one table.
/** What a row stands for: an editor layer (a Draw / Lattice layer, a Brick part), all the bricks, a height patch, one of its
 *  paint layers, or an STL record. */
export function rowSubject(item, sub = null) {
  if (!item) return null;
  if (item.type === 'draw' || item.type === 'lattice') return { kind: 'layer', id: String(item.ref.id) };
  if (item.type === 'brick') return sub != null ? { kind: 'layer', id: String(sub) } : { kind: 'bricks', ids: item.ref.map((l) => String(l.id)) };
  if (item.type === 'height') return sub != null ? { kind: 'paint', patch: item.ref.id, id: String(sub) } : { kind: 'patch', id: item.ref.id };
  if (item.type === 'stl') return { kind: 'stl', id: item.ref.id };
  return null;
}
const edLayer = (id) => edLayers().find((l) => l && String(l.id) === String(id)) || null;
const heightRec = (id) => (Array.isArray(P.heightLayers) ? P.heightLayers : []).find((r) => r && r.id === id) || null;
const paintLayer = (s) => patchLayers(heightRec(s.patch)).find((l) => String(l.id) === s.id) || null;
const stlRecOf = (id) => (Array.isArray(P.stlLayers) ? P.stlLayers : []).find((r) => r && r.id === id) || null;
const heightMod = () => lazy.heightPanel();
/** The eye per subject kind: shown / hidden on the canvas (it still carves and exports). A kind without one has no eye
 *  (a height patch: its paint layers have theirs; an STL: no 2D view yet). */
export const EDITOR_ROW_EYE = Object.freeze({
  layer: Object.freeze({ get: (s) => (edLayer(s.id) || {}).visible !== false, set: (s, on) => setLayerVisible(editor(), s.id, on) }),
  bricks: Object.freeze({ get: (s) => s.ids.some((id) => (edLayer(id) || {}).visible !== false), set: (s, on) => { for (const id of s.ids) setLayerVisible(editor(), id, on); } }),
  paint: Object.freeze({ get: (s) => (paintLayer(s) || {}).visible !== false,
    async set(s, on) { const hp = await heightMod(); hp.pickHeightPatch(s.patch); hp.setPatchLayerField(s.id, 'visible', on); } }),
});
const check = (on) => (on ? '☑' : '☐');
const enabledOf = (s) => ((s.kind === 'patch' ? heightRec(s.id) : stlRecOf(s.id)) || {}).enabled !== false;
/** The ⋯ menu, in order: { id, applies(subject), label(subject), icon(subject), run(subject, row) }. Every control the old
 *  Layers list row had (editor/layers.js _makeLayerRow: carve, colours, lock, rename, delete) and the Height panel's patch /
 *  paint-layer rows (stamp, rename, up / down, delete). */
export const EDITOR_ROW_MENU = Object.freeze([
  Object.freeze({ id: 'rename', applies: (s) => s.kind === 'layer' || s.kind === 'patch' || s.kind === 'paint', label: () => 'Rename…', icon: () => '✎',
    run: (s, row) => beginRowRename(row, s) }),
  Object.freeze({ id: 'stamp', applies: (s) => s.kind === 'layer' || s.kind === 'patch' || s.kind === 'stl', label: () => 'Stamp into the surface (3D)',
    icon: (s) => check(s.kind === 'layer' ? (edLayer(s.id) || {}).carve !== false : enabledOf(s)),
    async run(s) {
      if (s.kind === 'layer') setLayerCarve(editor(), s.id, (edLayer(s.id) || {}).carve === false);
      else if (s.kind === 'patch') (await heightMod()).setHeightEnabled(s.id, !enabledOf(s));
      else setStlEnabled(s.id, !enabledOf(s));
    } }),
  Object.freeze({ id: 'colour', applies: (s) => s.kind === 'layer', label: () => 'Its own colours', icon: (s) => check((edLayer(s.id) || {}).showColor !== false),
    run: (s) => setLayerShowColor(editor(), s.id, (edLayer(s.id) || {}).showColor === false) }),
  Object.freeze({ id: 'lock', applies: (s) => s.kind === 'layer', label: (s) => (isUserLocked(edLayer(s.id)) ? 'Unlock' : 'Lock'), icon: (s) => (isUserLocked(edLayer(s.id)) ? '🔓' : '🔒'),
    run: (s) => setLayerLocked(editor(), s.id, !isUserLocked(edLayer(s.id))) }),
  Object.freeze({ id: 'up', applies: (s) => s.kind === 'paint' && canMovePaint(s, 1), label: () => 'Move up', icon: () => '▲',
    async run(s) { const hp = await heightMod(); hp.pickHeightPatch(s.patch); hp.movePatchLayer(s.id, 1); } }),
  Object.freeze({ id: 'down', applies: (s) => s.kind === 'paint' && canMovePaint(s, -1), label: () => 'Move down', icon: () => '▼',
    async run(s) { const hp = await heightMod(); hp.pickHeightPatch(s.patch); hp.movePatchLayer(s.id, -1); } }),
  // never the only layer, never a locked one (the old row's rules); a paint layer never its patch's last (the patch's Delete)
  Object.freeze({ id: 'delete', applies: (s) => (s.kind === 'layer' ? edLayers().length > 1 && !isUserLocked(edLayer(s.id))
    : s.kind === 'paint' ? patchLayers(heightRec(s.patch)).length > 1 : s.kind === 'patch' || s.kind === 'stl'), label: () => 'Delete', icon: () => '🗑',
    async run(s) {
      if (s.kind === 'layer') removeLayer(editor(), s.id);
      else if (s.kind === 'patch') (await heightMod()).removeHeightPatch(s.id);
      else if (s.kind === 'paint') { const hp = await heightMod(); hp.pickHeightPatch(s.patch); hp.removePatchLayer(s.id); }
      else removeStlLayer(s.id);
    } }),
]);
function canMovePaint(s, dir) {
  const ls = patchLayers(heightRec(s.patch)), i = ls.findIndex((l) => String(l.id) === s.id);
  return i >= 0 && i + dir >= 0 && i + dir < ls.length;
}
/** The ⋯ menu's items for `subject`: the declared ones that apply now. */
export const rowMenuItems = (subject) => (subject ? EDITOR_ROW_MENU.filter((m) => m.applies(subject)) : []);

/** Rename in place: the row's name becomes a text box; Enter / leaving it writes the name (one step), Esc puts it back. */
function beginRowRename(row, s) {
  const title = row && row.querySelector('.layer-card-title, .ed-stack-sub-name');
  if (!title) return false;
  const now = s.kind === 'layer' ? (edLayer(s.id) || {}).name : s.kind === 'patch' ? (heightRec(s.id) || {}).name : (paintLayer(s) || {}).name;
  const input = el('input', { type: 'text', class: 'ed-stack-rename', 'aria-label': 'Layer name', maxlength: '40' });
  input.value = now || '';
  title.replaceWith(input);
  _edRenaming = true;
  let done = false;
  const finish = async (keep) => {
    if (done) return;
    done = true;
    _edRenaming = false;
    const v = input.value.trim();
    if (keep && v && v !== now) {
      if (s.kind === 'layer') renameLayer(editor(), s.id, v);
      else if (s.kind === 'patch') (await heightMod()).renameHeightPatch(s.id, v);
      else { const hp = await heightMod(); hp.pickHeightPatch(s.patch); hp.setPatchLayerField(s.id, 'name', v); }
    }
    refreshEditorStack();
  };
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('pointerdown', (e) => e.stopPropagation());
  if (typeof input.focus === 'function') { input.focus(); if (typeof input.select === 'function') input.select(); }
  return true;
}
let _edRenaming = false; // a row's name is being typed: no rebuild under it

/** Open a row's ⋯ menu (its button's own click), anchored under `anchor`. */
export async function openRowMenu(key, sub = null, anchor = null) {
  const item = stackItems().find((i) => i.key === key);
  const s = rowSubject(item, sub);
  const items = rowMenuItems(s);
  if (!items.length) return null;
  const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 0, bottom: 0 };
  // the row as it is when the item runs (a refresh may have rebuilt the list while the menu was open)
  const rowNow = () => { const n = byId(edRowId(key, sub)); return n ? n.closest('.ed-stack-sub, .layer-card-head') : null; };
  const { openMenuRows } = await import('../editor/editor-context-menu.js');
  return openMenuRows(items.map((m) => ({ label: m.label(s), icon: m.icon(s), run: () => m.run(s, rowNow()) })), r.left, r.bottom + 2);
}

/** A row's eye (none for a kind EDITOR_ROW_EYE does not declare) and ⋯ button. */
function rowControls(item, sub, name) {
  const s = rowSubject(item, sub);
  const eye = s && EDITOR_ROW_EYE[s.kind];
  const shown = eye ? !!eye.get(s) : true;
  const idPart = edRowId(item.key, sub).slice('edStackRow_'.length);
  const out = [];
  if (eye) {
    const b = el('button', { type: 'button', class: `ed-stack-eye${shown ? '' : ' is-hidden'}`, id: `edStackEye_${idPart}`, 'data-ed-eye': item.key, ...(sub != null ? { 'data-ed-sub': sub } : {}),
      'aria-pressed': String(shown), 'aria-label': `${shown ? 'Hide' : 'Show'} ${name}`, title: shown ? 'Hide (it still carves and exports)' : 'Show' });
    b.innerHTML = eyeIconSVG(shown);
    out.push(b);
  }
  if (rowMenuItems(s).length) {
    out.push(el('button', { type: 'button', class: 'ed-stack-more', id: `edStackMenu_${idPart}`, 'data-ed-menu': item.key, ...(sub != null ? { 'data-ed-sub': sub } : {}),
      'aria-haspopup': 'menu', 'aria-label': `More for ${name}`, title: 'Rename, stamp, colours, lock, delete', text: '⋯' }));
  }
  return out;
}

function editorCard(item, after, sel) {
  const T = LAYER_TYPES[item.type];
  const selected = sel.key === item.key;
  const subs = T.subRows ? T.subRows(item) : [];
  const open = subs.length > 0 && _edSubsOpen.has(item.key);
  const card = el('div', { class: `panel layer-card ed-stack-card${selected ? ' is-selected' : ''}${after ? ' layer-card-after' : ''}${open ? ' subs-open' : ''}${selected && sel.sub != null ? ' sub-selected' : ''}`,
    role: 'listitem', 'data-stack-key': item.key, 'data-stack-type': item.type });
  themeSectionEl(card, T.theme);
  const name = T.name(item);
  const head = el('div', { class: 'panel-header layer-card-head' }, [
    el('span', { class: 'layer-card-handle', title: 'Drag to move (stamp order; across the Thicken line: body or top only)', 'aria-label': `Move ${name}`, role: 'button', text: '≡' }),
    el('span', { class: 'layer-card-icon', 'aria-hidden': 'true', text: T.icon }),
    subs.length ? el('button', { type: 'button', class: 'ed-stack-caret', 'data-ed-caret': item.key, 'aria-expanded': String(open), 'aria-label': `${open ? 'Fold' : 'Unfold'} the layers of ${name}`, text: open ? '▾' : '▸' }) : null,
    el('button', { type: 'button', class: 'layer-card-name ed-stack-name', id: edRowId(item.key), 'data-ed-select': item.key, 'aria-pressed': String(selected && sel.sub == null), title: `${name} — ${T.label}${after ? ', top only' : ''}` },
      // a new layer's name says its type (typedLayerName) and its icon + colour do too: the type line only for 'top only'
      [el('span', { class: 'layer-card-title', text: name }), after ? el('span', { class: 'layer-card-type', text: 'top only' }) : null]),
    ...rowControls(item, null, name),
    el('span', { class: 'ed-stack-unfold', 'aria-hidden': 'true', text: '▾' }),
  ]);
  card.append(head);
  if (subs.length) {
    const list = el('div', { class: 'ed-stack-subs', role: 'group', 'aria-label': `Layers of ${name}` });
    for (const s of subs) {
      const on = selected && sel.sub != null && String(sel.sub) === String(s.id);
      list.appendChild(el('div', { class: `ed-stack-sub${on ? ' is-selected' : ''}`, 'data-ed-sub-row': s.id }, [
        el('button', { type: 'button', class: 'ed-stack-sub-pick', id: edRowId(item.key, s.id), 'data-ed-select': item.key, 'data-ed-sub': s.id, 'aria-pressed': String(on), title: s.name },
          [el('span', { class: 'ed-stack-sub-icon', 'aria-hidden': 'true', text: s.icon }), el('span', { class: 'ed-stack-sub-name', text: s.name })]),
        ...rowControls(item, s.id, s.name),
      ]));
    }
    card.append(list);
  }
  return card;
}

/** Re-reads the board and rebuilds the editor's list (its rows hold no hosted fields: a rebuild is always safe). */
export function refreshEditorStack() {
  const listEl = byId(STACK_VIEWS.editor.list), pane = byId(STACK_VIEWS.editor.pane);
  if (!listEl || _drag || _edRenaming) return;
  const items = stackItems();
  const sel = editorSelection(items);
  if (sel.key && sel.sub != null) _edSubsOpen.add(sel.key);
  const L = editorStackLayout();
  const folded = L.fold && _edFolded && !!sel.key;
  const scroll = listEl.scrollTop;
  listEl.innerHTML = '';
  for (const i of displayOrder(items, 'afterBack')) listEl.appendChild(editorCard(i, true, sel));
  listEl.appendChild(thickenLine({ edit: true }));
  for (const i of displayOrder(items, 'withSurface')) listEl.appendChild(editorCard(i, false, sel));
  for (const f of EDITOR_FIXED_ROWS) listEl.appendChild(fixedRow(f, sel)); // the Frame: the base, at the bottom
  listEl.scrollTop = scroll;
  if (pane) {
    pane.classList.toggle('is-folded', folded);
    pane.classList.toggle('can-fold', L.fold && !folded);
    pane.dataset.layout = L.id;
    pane.style.setProperty('--ed-stack-max-rows', String(L.maxRows));
  }
  const count = byId('editorLayerStackCount');
  if (count) count.textContent = `${items.length + EDITOR_FIXED_ROWS.length}`;
  const stl = sel.key && sel.key.startsWith('stl:') ? items.find((i) => i.key === sel.key) : null;
  const stlName = byId('editorStlName');
  if (stlName) stlName.textContent = stl ? LAYER_TYPES.stl.name(stl) : '';
  // the selected row in view (a long list scrolls to it)
  const row = sel.key ? byId(edRowId(sel.key, sel.sub)) || byId(edRowId(sel.key)) : null;
  if (row && !folded && typeof row.scrollIntoView === 'function' && listEl.scrollHeight > listEl.clientHeight) {
    const r = row.getBoundingClientRect(), b = listEl.getBoundingClientRect();
    if (r.top < b.top || r.bottom > b.bottom) listEl.scrollTop += r.top < b.top ? r.top - b.top : r.bottom - b.bottom;
  }
}

let _edDocWired = false;
const _edWiredLists = new WeakSet();
function initEditorStack() {
  const listEl = byId(STACK_VIEWS.editor.list);
  if (!listEl || _edWiredLists.has(listEl)) return false;
  _edWiredLists.add(listEl);
  loadTabs().then(() => refreshEditorStack(), () => {});
  lazy.heightPanel().then((m) => { _edMods.height = m; refreshEditorStack(); }, () => {});
  listEl.addEventListener('pointerdown', (e) => { const h = e.target.closest('.layer-card-handle'); if (h && !h.classList.contains('ed-stack-lock')) startDrag(e, h); });
  listEl.addEventListener('click', (e) => {
    const sub0 = (n) => (n.dataset.edSub != null ? n.dataset.edSub : null);
    const eyeBtn = e.target.closest('[data-ed-eye]');
    if (eyeBtn) {
      const s = rowSubject(stackItems().find((i) => i.key === eyeBtn.dataset.edEye), sub0(eyeBtn));
      const eye = s && EDITOR_ROW_EYE[s.kind];
      if (eye) Promise.resolve(eye.set(s, !eye.get(s))).then(() => refreshEditorStack());
      return;
    }
    const more = e.target.closest('[data-ed-menu]');
    if (more) { openRowMenu(more.dataset.edMenu, sub0(more), more); return; }
    const caret = e.target.closest('[data-ed-caret]');
    if (caret) { const k = caret.dataset.edCaret; if (_edSubsOpen.has(k)) _edSubsOpen.delete(k); else _edSubsOpen.add(k); refreshEditorStack(); return; }
    const row = e.target.closest('[data-ed-select]');
    if (!row) return;
    const key = row.dataset.edSelect, sub = row.dataset.edSub != null ? row.dataset.edSub : null;
    const L = editorStackLayout(), sel = editorSelection();
    const same = sel.key === key && String(sel.sub ?? '') === String(sub ?? '');
    // the phone: a tap on the folded list unfolds it; a tap on the selected row folds it back (picking another row folds too)
    if (L.fold && byId(STACK_VIEWS.editor.pane)?.classList.contains('is-folded')) {
      _edFolded = false; refreshEditorStack();
      document.dispatchEvent(new CustomEvent(STACK_UNFOLDED_EVENT)); // the drawer makes room for the whole list
      return;
    }
    if (L.fold && same) { _edFolded = true; refreshEditorStack(); return; }
    selectEditorRow(key, sub);
  });
  listEl.addEventListener('change', (e) => {
    const box = e.target.closest('.layer-card-enable');
    if (!box) return;
    const item = stackItems().find((i) => i.key === box.closest('[data-stack-key]').dataset.stackKey);
    if (item && LAYER_TYPES[item.type].enabled) LAYER_TYPES[item.type].enabled.set(item, box.checked);
  });
  byId('editorLayerStackFold')?.addEventListener('click', () => { _edFolded = true; refreshEditorStack(); });
  if (typeof document !== 'undefined' && !_edDocWired) {
    _edDocWired = true;
    document.addEventListener('editorTabChanged', () => refreshEditorStack());
    if (typeof matchMedia === 'function') for (const L of EDITOR_STACK_LAYOUTS) if (L.query) { try { matchMedia(L.query).addEventListener('change', () => refreshEditorStack()); } catch (_) { /* old engines */ } }
  }
  return true;
}

function renderAddPickers() {
  for (const picker of ADD_PICKERS) {
    const grid = byId(picker.grid);
    if (!grid || grid.childElementCount) continue;
    for (const type of LAYER_ADD_TYPES) {
      const T = LAYER_TYPES[type];
      const b = el('button', { type: 'button', class: 'cad-btn layer-add-option', id: `${picker.prefix}${type}`, title: `Add a ${T.label} layer`, 'aria-label': `Add a ${T.label} layer` },
        [el('span', { class: 'layer-add-icon', 'aria-hidden': 'true', text: T.icon }), el('span', { class: 'layer-add-label', text: T.label })]);
      b.addEventListener('click', () => { pickAddType(type, picker); });
      grid.appendChild(b);
    }
    mountIconGrid(grid, { label: picker.label, ids: picker.ids });
  }
}

/** Wire the stack. `hooks.onChange`: rebuild the 3D (a new stamp order). */
export function initLayerStack(hooks = {}) {
  _hooks = { onChange: hooks.onChange || (() => {}) };
  const listEl = byId('layerStackList');
  if (!listEl) return false;
  renderAddPickers();
  listEl.addEventListener('pointerdown', (e) => { const h = e.target.closest('.layer-card-handle'); if (h) startDrag(e, h); });
  listEl.addEventListener('click', (e) => {
    const head = e.target.closest('.layer-card-head');
    if (!head || e.target.closest('.layer-card-handle, .layer-card-enable')) return;
    const card = head.closest('[data-stack-key]');
    const del = e.target.closest('.layer-card-del');
    if (del) {
      const item = stackItems().find((i) => i.key === card.dataset.stackKey);
      if (item && LAYER_TYPES[item.type].remove) LAYER_TYPES[item.type].remove(item); // one write, one undo step; it opens nothing
      return;
    }
    toggleItem(card.dataset.stackKey);
  });
  listEl.addEventListener('change', (e) => {
    const box = e.target.closest('.layer-card-enable');
    if (!box) return;
    const item = stackItems().find((i) => i.key === box.closest('[data-stack-key]').dataset.stackKey);
    if (item && LAYER_TYPES[item.type].enabled) LAYER_TYPES[item.type].enabled.set(item, box.checked);
  });
  initEditorStack();
  const t = byId('thickenSettings');
  if (t) for (const ev of ['input', 'change']) t.addEventListener(ev, () => syncThickenStates());
  if (!_docWired && typeof document !== 'undefined') {
    _docWired = true;
    const refresh = () => refreshLayerStack();
    // 'stampTargetChanged': main/stamp/summary.js STAMP_TARGET_CHANGED (a stamp setting edited: the Draw card's summary)
    // 'editorModeChanged': the editor opened (its open sets a mode): an editorHome block (HOSTED) goes back into it
    for (const ev of ['editorLayersChanged', 'stlLayersChanged', LAYER_STACK_STALE, 'brickSettingsRestored', 'editorCommit', 'stampTargetChanged', 'editorModeChanged']) document.addEventListener(ev, refresh);
    document.addEventListener('stlCardOpened', () => { _openKey = null; refreshLayerStack(); });
    // the Thicken settings written without a tap in their panel (an undo, a load, a pull): the label from its one function
    document.addEventListener(THICKEN_SETTINGS_SYNCED, () => syncThickenStates());
    document.addEventListener('stlLayersChanged', () => {
      if (!_pendingAdd || _pendingAdd.type !== 'stl') return;
      const fresh = (P.stlLayers || []).filter((r) => r && !_pendingAdd.before.has(r.id));
      if (!fresh.length) return;
      _pendingAdd = null;
      landAboveLine(`stl:${fresh[fresh.length - 1].id}`);
      refreshLayerStack();
    });
  }
  refreshLayerStack();
  return true;
}
let _docWired = false;

/** Tests: forget the UI state. */
export function _resetLayerStackForTests() {
  _lastSig = null; _openKey = null; _drag = null; _dirty = false; _rendering = false; _pendingAdd = null; _hooks = { onChange: () => {} };
  _edFolded = true; _edSubsOpen.clear(); _edStlKey = null; _edRenaming = false;
}

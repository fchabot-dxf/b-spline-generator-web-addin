/**
 * main/layer-stack.js -- the unified LAYER STACK, step 1 (Fred 2026-11-23; memory project_layer_stack_design, the clickable
 * mockup mock-layer-stack.html): the main panel's LAYERS section lists every layer of the board as a card, in STAMP ORDER
 * (top = stamped first), split by the THICKEN LINE -- above it a layer is part of the body (the back follows it,
 * 'withSurface'), below it only the top carries it ('afterBack', core/stamp/placement.js).
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
import { isLatticeLayer, isCarved, setLayerCarve, setLayerPlacement, setActiveLayer, addLayer, brickKindLayer } from '../editor/layers.js';
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
    // a new board's bricks start on the Wall's own layer (layers.js BRICK_KIND_LAYERS); they are laid in the Brick tab
    add() {
      const ed = editor();
      if (!ed) return null;
      if (!stackItems().some((i) => i.type === 'brick')) { brickKindLayer(ed, 'wall'); commitEdit(ed); }
      return STACK_BRICKS_KEY;
    },
  }),
  draw: Object.freeze({
    label: 'Draw', theme: 'stamp', icon: SECTION_ICONS.stamp, editorTab: 'artwork', tabLabel: 'Draw',
    name: (item) => item.ref.name || 'Layer',
    summary: (item) => stampSummaryText(layerStampTarget(item.ref)),
    placement: (item) => placementOf(item.ref.placement),
    setPlacement: (item, v) => setLayerPlacement(editor(), item.ref.id, v),
    enabled: { get: (item) => isCarved(item.ref), set: (item, on) => setLayerCarve(editor(), item.ref.id, on), title: 'Stamp this layer into the surface (3D)' },
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
    // a new layer holding a fresh Lattice pattern (the Lattice panel's own lazy create, editor-lattice-pattern.js freshPattern),
    // then the editor on the Lattice tab: a lattice is made by its Generate there (the Rails / Ties / Nodes layers); until it
    // runs once the layer is a plain drawing layer (layers.js isLatticeLayer: pattern.id, the panels' own signal)
    async add() {
      const ed = editor();
      if (!ed) return null;
      const { freshPattern } = await lazy.lattice();
      const n = edLayers().filter((l) => l && l.pattern && l.pattern.id != null).length + 1;
      const made = addLayer(ed, { name: `Lattice ${n}`, skipUndo: true });
      made.pattern = freshPattern(ed);
      setActiveLayer(ed, made.id);
      commitEdit(ed); // ONE undo step: the layer and its pattern
      openEditorTab('lattice');
      return `layer:${made.id}`;
    },
  }),
  height: Object.freeze({
    label: 'Height patch', theme: 'height', icon: SECTION_ICONS.height, editorTab: 'height', tabLabel: 'Height',
    name: (item) => item.ref.name || 'Height',
    summary: (item) => {
      const n = Array.isArray(item.ref.layers) ? item.ref.layers.length : 1;
      return `${item.ref.raise === false ? 'Carved' : 'Raised'} · ${n} paint layer${n === 1 ? '' : 's'}`;
    },
    placement: (item) => placementOf(item.ref.placement),
    async setPlacement(item, v) { (await lazy.heightPanel()).setHeightField('placement', v, { id: item.ref.id }); },
    enabled: { get: (item) => item.ref.enabled !== false, async set(item, on) { (await lazy.heightPanel()).setHeightEnabled(item.ref.id, on); }, title: 'Stamp this patch' },
    async select(item) { (await lazy.heightPanel()).pickHeightPatch(item.ref.id); },
    async add() { const rec = await (await lazy.heightPanel()).newHeightPatch(); return rec ? `height:${rec.id}` : null; },
  }),
  stl: Object.freeze({
    label: 'STL relief', theme: 'stl', icon: SECTION_ICONS.stl, editorTab: null,
    name: (item) => item.ref.name || 'STL',
    summary: () => '', // its open card holds the STL panel's own settings (main/stl-panel.js #stlActive)
    placement: (item) => placementOf(item.ref.placement),
    setPlacement: (item, v) => setStlField('placement', v, item.ref.id),
    enabled: { get: (item) => item.ref.enabled !== false, set: (item, on) => setStlEnabled(item.ref.id, on), title: 'Stamp this STL' },
    remove: (item) => removeStlLayer(item.ref.id),
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
  if (order || moved.length) {
    scheduleSessionSave();
    scheduleUndoSnapshot('layerStack', 'Layers');
    if (order) _hooks.onChange(); // a crossing commits through its own type (and rebuilds); a new order rebuilds here
  }
  refreshLayerStack();
  return { order, moved };
}

/** A new layer lands just ABOVE the Thicken line: when it is not already the last layer above it, the stack's order is
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

function thickenLine() {
  const open = _openKey === THICKEN_LINE_KEY;
  const card = el('div', { class: `panel layer-card layer-thicken-line${open ? '' : ' collapsed'}`, role: 'listitem', 'data-stack-key': THICKEN_LINE_KEY });
  themeSectionEl(card, 'thicken');
  const head = el('div', { class: 'panel-header layer-card-head' }, [
    el('span', { class: 'layer-card-handle', title: 'Drag the line: layers above it are part of the body, below it top-only detail', 'aria-label': 'Move the Thicken line', role: 'button', text: '≡' }),
    el('span', { class: 'layer-card-icon', 'aria-hidden': 'true', text: SECTION_ICONS.thicken }),
    el('button', { type: 'button', class: 'layer-card-name', id: cardNameId(THICKEN_LINE_KEY), 'data-stack-open': THICKEN_LINE_KEY, 'aria-expanded': String(open), title: 'Thicken: above the line part of the body, below it top-only detail' },
      [el('span', { class: 'layer-card-title', text: 'Thicken' }), el('span', { class: 'layer-card-state', id: 'layerStackThickenState', text: thickenState() }),
        el('span', { class: 'layer-card-type', text: 'above: part of the body · below: top only' })]),
  ]);
  card.append(head, el('div', { class: 'panel-body layer-card-body', id: 'layerStackThickenBody' }));
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
      for (const i of items) if (itemPlacement(i) !== 'afterBack') listEl.appendChild(cardFor(i, false));
      listEl.appendChild(thickenLine());
      for (const i of items) if (itemPlacement(i) === 'afterBack') listEl.appendChild(cardFor(i, true));
      hostOpen(listEl, items);
      const sum = byId('layerStackSummary');
      if (sum) sum.textContent = `${items.length} layer${items.length === 1 ? '' : 's'}`;
    }
  } finally { _rendering = false; }
  syncStlPanel(); // the STL cards' state + its settings in the open one (and the job-timeline lock back on them)
  if (_dirty) { _dirty = false; refreshLayerStack(); }
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
  for (let n = node && node.parentElement; n; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}
function paintSides(listEl) {
  let after = false;
  for (const c of listEl.children) {
    if (c.dataset.stackKey === THICKEN_LINE_KEY) { after = true; continue; }
    c.classList.toggle('layer-card-after', after);
  }
}
export const stackSequence = (listEl = byId('layerStackList')) => (listEl ? [...listEl.children].map((c) => c.dataset.stackKey).filter(Boolean) : []);

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
  // (the editor's own '+' -- an ADD_PICKERS entry with inEditor: true -- is on HOLD: the editor's layer UI is being decided)
]);

/** A picker's tile picked: THE add (addStackLayer); from the editor, the editor then shows that type's tab (it stays open;
 *  the new Draw / Lattice layer is already the active one, a new patch the Height tab's active patch). */
export async function pickAddType(type, picker = ADD_PICKERS[0]) {
  const key = await addStackLayer(type);
  const tab = LAYER_TYPES[type] && LAYER_TYPES[type].editorTab;
  if (picker.inEditor && key && tab && editorUp()) await openEditorTab(tab);
  return key;
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
  const t = byId('thickenSettings');
  if (t) for (const ev of ['input', 'change']) t.addEventListener(ev, () => { const s = byId('layerStackThickenState'); if (s) s.textContent = thickenState(); });
  if (!_docWired && typeof document !== 'undefined') {
    _docWired = true;
    const refresh = () => refreshLayerStack();
    // 'stampTargetChanged': main/stamp/summary.js STAMP_TARGET_CHANGED (a stamp setting edited: the Draw card's summary)
    // 'editorModeChanged': the editor opened (its open sets a mode): an editorHome block (HOSTED) goes back into it
    for (const ev of ['editorLayersChanged', 'stlLayersChanged', LAYER_STACK_STALE, 'brickSettingsRestored', 'editorCommit', 'stampTargetChanged', 'editorModeChanged']) document.addEventListener(ev, refresh);
    document.addEventListener('stlCardOpened', () => { _openKey = null; refreshLayerStack(); });
    // the Thicken settings written without a tap in their panel (an undo, a load, a pull): the label from its one function
    document.addEventListener(THICKEN_SETTINGS_SYNCED, () => { const s = byId('layerStackThickenState'); if (s) s.textContent = thickenState(); });
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
export function _resetLayerStackForTests() { _lastSig = null; _openKey = null; _drag = null; _dirty = false; _rendering = false; _pendingAdd = null; _hooks = { onChange: () => {} }; }

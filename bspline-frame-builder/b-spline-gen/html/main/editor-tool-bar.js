/**
 * main/editor-tool-bar.js -- the editor's CONTEXT BAR (owner 2026-11-27: "go over all features and tools and see how to move
 * some of the tool settings over there"): the strip at the top of the 2D canvas (#editorToolBar, inside #editorToolbarTop)
 * shows the settings of the ACTIVE tool -- what configures the next stroke or acts on the current selection -- and changes
 * with the tool. A LAYER's settings (stored on a layer / patch / element: how it carves) stay in the side panel.
 * Generalised from the Height tab's options bar (main/height-panel.js, its first user): ONE bar, ONE table, ONE sync.
 *
 * EDITOR_TOOL_BAR[tab][tool] = the tool's row, in order. An item is
 *   { host: '<element id>' }   an EXISTING control group, MOVED into the bar while its tool is active (its id, wiring and
 *                              tests kept; nothing is rebuilt). A hosted group lives in the bar or PARKED (the hidden
 *                              #editorToolBarParked): it is never in a side panel too (owner: a setting shows in ONE place).
 *                              `counts`: how many controls the group shows (default 1), for the owner's 6-item rule.
 *   { control | widget, ... }  a control the tab's own module renders (registerToolBarTab `build` / `sync`): the Height
 *                              tab's compact controls (main/height-panel.js HEIGHT_CONTROLS ids) and read-outs.
 *   { more: [items] }          the overflow '⋯': a button at that place whose small sheet holds `items` (the same kinds).
 * TOOL_BAR_END[tab] is appended to every row of that tab (the Height stock line).
 * Owner rule (2026-11-27): "5-6 at most per context" -- a row shows at most TOOL_BAR_MAX_ITEMS items, the '⋯' and the end
 * items included (toolBarItemCount; tests/editor-tool-bar.test.js holds every declared row to it). The rest go in the '⋯'.
 *
 * The tool key: the editor's gesture mode (window.svgEditor._currentMode), unless the tab registers its own `tool()` (the
 * Brick tab: its tool + sub-tool; the Height tab: its HEIGHT_TOOLS id). The bar shows nothing on a tab / tool with no row.
 */
import { getEditorTab } from './editor-tabs.js';

export const TOOL_BAR_MAX_ITEMS = 6;
export const TOOL_BAR_IDS = Object.freeze({ group: 'editorToolBarGroup', bar: 'editorToolBar', parked: 'editorToolBarParked' });

const h = (id, counts) => Object.freeze(counts ? { host: id, counts } : { host: id });
const row = (...items) => Object.freeze(items);
const more = (...items) => Object.freeze({ more: Object.freeze(items) });

// ── Draw (artwork) ───────────────────────────────────────────────────────────────────────────────────────────────────
// the drawing tools' look (Stroke width, Colour, Style), on the selection too; the Font group (its family, size and the
// Symbols keyboard) shows in Select while a text is selected (editor-ui.js TOOLBAR_GROUPS hides the stroke for a text)
const STROKE = h('editorStrokeGroup'), COLOUR = h('editorColorGroup'), STYLE = h('editorFillModeGroup'), FONT = h('editorFontGroup', 3);
const DRAWING = row(STROKE, COLOUR, STYLE);
// the Stripe tool (shared by Draw, Lattice and Brick; editor/properties-stripe.js): By Count / By Length, the count or the
// length (one shows), the pattern chips, Colours A / B / C; in the '⋯' the ratio, its note, Use C + reset, the colour
// presets. On the Brick tab the slots pick brick STYLES (main/brick-panel.js syncStripePanelContext), in the '⋯'.
const STRIPE_SIZE = [h('stripeDriveRow'), h('stripeCountRow'), h('stripeLengthRow'), h('stripePatternPresets')];
const STRIPE_MORE = [h('stripePatternRatioRow'), h('stripePatternClampNote'), h('stripeColoursHead')];
export const STRIPE_BAR = row(...STRIPE_SIZE, h('stripeColorSwatches'), more(...STRIPE_MORE, h('stripeColorPresets')));
export const BRICK_STRIPE_BAR = row(...STRIPE_SIZE, more(...STRIPE_MORE, h('stripeBrickStyles')));

// the Height tab's selection pieces (main/height-panel.js): compact controls built per row, and the buttons built once
const SEL = Object.freeze({
  combine: Object.freeze({ control: 'selCombine', label: 'New' }), feather: Object.freeze({ control: 'featherIn', label: 'Feather', step: 0.01 }),
  profile: Object.freeze({ control: 'featherProfile', label: 'Profile' }), curve: Object.freeze({ widget: 'featherCurveButton' }),
  shape: Object.freeze({ control: 'selShape', label: 'Shape' }), move: Object.freeze({ widget: 'moveActions' }),
});
const SEL_BTN = Object.freeze({ feather: h('heightSelFeather'), all: h('heightSelAll'), invert: h('heightSelInvert'), clear: h('heightSelClear'), fromShape: h('heightSelShapePick') });

export const EDITOR_TOOL_BAR = Object.freeze({
  artwork: Object.freeze({
    select: row(STROKE, COLOUR, STYLE, FONT),
    node: DRAWING,
    draw: DRAWING, line: DRAWING, rect: DRAWING, circle: DRAWING,
    erase: row(STROKE), // the eraser's width is the stroke width
    text: row(FONT, COLOUR),
    expand: row(h('editorExpandGroup', 3)), // Detail, EXPAND, UN-EXPAND
    stripe: STRIPE_BAR,
  }),
  // ── Lattice ──────────────────────────────────────────────────────────────────────────────────────────────────────
  lattice: Object.freeze({
    select: DRAWING,
    erase: row(STROKE),
    stripe: STRIPE_BAR,
  }),
  // ── Brick (the key: main/brick-panel.js brickToolBarKey -- its tool, or tool.subTool) ───────────────────────────────
  brick: Object.freeze({
    stripe: BRICK_STRIPE_BAR,
  }),
  // ── Height (the key: main/height-panel.js HEIGHT_TOOLS id; its items rendered by that module) ───────────────────────
  height: Object.freeze({
    brush: row({ control: 'sizeIn', label: 'Size', step: 0.05 }, { control: 'mode', label: 'Mode' }, { widget: 'greyChip', label: 'Set' }, { control: 'greyZero', label: 'Grey' }, { control: 'invert', label: 'Paint' }),
    eraser: row({ control: 'sizeIn', label: 'Size', step: 0.05 }),
    // the selection tools (marquee-move, owner 2026-11-27: "those extra features are better in a contextual toolbar"): each
    // tool's row holds the selection's settings and buttons -- the most used on the bar, the rest in its '⋯'. The buttons
    // (Feather, Select all, Invert, Clear, From a Draw shape) are built ONCE (main/height-panel.js) and hosted by every row
    marquee: row(SEL.shape, SEL.combine, SEL.feather, SEL_BTN.clear, more(SEL_BTN.invert, SEL.profile, SEL.curve, SEL_BTN.feather, SEL_BTN.all, SEL_BTN.fromShape, SEL.move)),
    selectLasso: row(SEL.combine, SEL.feather, SEL_BTN.invert, SEL_BTN.clear, more(SEL.profile, SEL.curve, SEL_BTN.feather, SEL_BTN.all, SEL_BTN.fromShape, SEL.move)),
    wand: row({ control: 'wandToleranceIn', label: 'Tolerance', step: 0.005 }, { control: 'wandContiguous', label: 'Contiguous' }, SEL.combine, SEL.feather,
      more({ control: 'sampleFrom', label: 'Sample' }, SEL_BTN.invert, SEL_BTN.clear, SEL.profile, SEL.curve, SEL_BTN.feather, SEL_BTN.all, SEL_BTN.fromShape, SEL.move)),
    eyedropper: row({ control: 'sampleFrom', label: 'Sample' }, { widget: 'greyChip', label: 'Picked' }, { control: 'greyZero', label: 'Grey' }),
    // the Select tool (id 'move', marquee-move)
    move: row({ widget: 'moveActions', hint: 'Drag to move the selection (none: the whole layer)' }, SEL_BTN.all, SEL_BTN.invert, SEL_BTN.clear,
      more(SEL.combine, SEL.feather, SEL.profile, SEL.curve, SEL_BTN.feather, SEL_BTN.fromShape)),
    gradient: row({ control: 'gradStartIn', label: 'Start', step: 0.01 }, { control: 'gradEndIn', label: 'End', step: 0.01 }),
    fill: row({ control: 'fillHeightIn', label: 'Height', step: 0.01 }, { control: 'fillOpacity', label: 'Opacity', step: 0.05 }),
  }),
});
/** Appended to every row of a tab: the Height tab's stock line (main/height-panel.js heightStockLines). */
export const TOOL_BAR_END = Object.freeze({ height: row({ widget: 'stock' }) });

/** A tool's row as shown: its declared items, then its tab's end items. */
export const toolBarItems = (tab, tool) => [...((EDITOR_TOOL_BAR[tab] || {})[tool] || []), ...(TOOL_BAR_END[tab] || [])];
/** How many items a row shows on the bar (the owner's 6-item rule): a hosted group by its `counts`, the '⋯' as one. */
export const toolBarItemCount = (items) => items.reduce((n, it) => n + (it.host ? it.counts || 1 : 1), 0);
/** Every hosted id of `items`, the overflow's included. */
const hostsOf = (items) => items.flatMap((it) => (it.more ? hostsOf(it.more) : it.host ? [it.host] : []));
const ALL_HOSTS = Object.freeze([...new Set(Object.values(EDITOR_TOOL_BAR).flatMap((tools) => Object.values(tools).flatMap((r) => hostsOf(r))))]);
/** Every element the bar hosts somewhere (tests, the brick matrix: none of them may sit in a side panel). */
export const toolBarHostIds = () => [...ALL_HOSTS];

const _tabs = {}; // tab -> { tool, build, sync, decorate } (registerToolBarTab)
const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);
const editorMode = () => (typeof window !== 'undefined' && window.svgEditor ? window.svgEditor._currentMode : null);
const rowKey = (tab, tool) => `${tab}:${tool}`;

/** The active tab's tool key (null: no row). */
export function activeToolBarKey(tab = getEditorTab()) {
  const t = _tabs[tab];
  const tool = t && t.tool ? t.tool() : editorMode();
  return tool != null && (EDITOR_TOOL_BAR[tab] || {})[tool] ? tool : null;
}

/** A tab's own pieces: `tool()` its key, `build(item, tool)` a node for its own items, `sync(node, item, tool)` refreshes
 *  one, `decorate(row, tool)` marks its row (the Height tab's data-height-bar-tool). Builds the tab's rows now. */
export function registerToolBarTab(tab, hooks = {}) {
  _tabs[tab] = { ...hooks };
  _wire();
  const bar = $(TOOL_BAR_IDS.bar);
  if (bar) { for (const r of bar.querySelectorAll(`[data-tool-bar-tab="${tab}"]`)) r.remove(); renderTab(bar, tab); }
  syncToolBar();
}

// the nodes a row built for its own items (by row element, then item), and each '⋯''s sheet
const _built = new WeakMap();

function buildItem(item, tab, tool) {
  if (item.host) return null; // moved in at sync
  if (item.more) {
    const wrap = document.createElement('div');
    wrap.className = 'tool-bar-item tool-bar-more';
    wrap.dataset.toolBarMore = '';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'editor-fillmode-btn tool-bar-more-btn';
    btn.textContent = '⋯';
    btn.title = 'More settings for this tool';
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    const sheet = document.createElement('div');
    sheet.className = 'tool-bar-more-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.hidden = true;
    wrap.append(btn, sheet);
    _built.set(sheet, item.more.map((it) => buildItem(it, tab, tool)));
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggleSheet(wrap); });
    return wrap;
  }
  const t = _tabs[tab];
  const n = t && t.build ? t.build(item, tool) : null;
  return n || null;
}

function renderTab(bar, tab) {
  for (const tool of Object.keys(EDITOR_TOOL_BAR[tab] || {})) {
    const r = document.createElement('div');
    r.className = 'tool-bar-row';
    r.dataset.toolBarTab = tab;
    r.dataset.toolBarTool = tool;
    r.style.display = 'none';
    const t = _tabs[tab];
    if (t && t.decorate) t.decorate(r, tool);
    const items = toolBarItems(tab, tool);
    const nodes = items.map((it) => buildItem(it, tab, tool));
    for (const n of nodes) if (n) r.appendChild(n);
    _built.set(r, nodes);
    bar.appendChild(r);
  }
}
const rowOf = (bar, tab, tool) => bar.querySelector(`[data-tool-bar-tab="${tab}"][data-tool-bar-tool="${tool}"]`);

/** Puts `items` into `box` in their declared order (hosts moved in, built nodes kept); moves only what is out of place --
 *  a re-append of a node already there would blur a field being typed in. */
function place(box, items, nodes) {
  const want = items.map((it, i) => (it.host ? $(it.host) : nodes[i])).filter(Boolean);
  const have = [...box.children];
  if (want.length === have.length && want.every((n, i) => n === have[i])) return want;
  for (const n of want) box.appendChild(n);
  return want;
}

let _open = null; // the '⋯' wrapper whose sheet is open
function closeSheet() {
  if (!_open) return;
  const sheet = _open.querySelector('.tool-bar-more-sheet');
  if (sheet) sheet.hidden = true;
  _open.querySelector('.tool-bar-more-btn')?.setAttribute('aria-expanded', 'false');
  _open = null;
}
/** The sheet floats under its button (position:fixed: the bar scrolls sideways and would clip it), kept on screen. */
function toggleSheet(wrap) {
  if (_open === wrap) { closeSheet(); return; }
  closeSheet();
  const sheet = wrap.querySelector('.tool-bar-more-sheet');
  const btn = wrap.querySelector('.tool-bar-more-btn');
  if (!sheet || !btn) return;
  sheet.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  _open = wrap;
  const r = btn.getBoundingClientRect();
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 1024;
  const w = Math.min(sheet.getBoundingClientRect().width || 300, vw - 8);
  sheet.style.left = `${Math.round(Math.max(4, Math.min(r.right - w, vw - w - 4)))}px`;
  sheet.style.top = `${Math.round(r.bottom + 4)}px`;
}
/** Opens the active row's '⋯' sheet (tests, the brick matrix). */
export function openToolBarMore() {
  const bar = $(TOOL_BAR_IDS.bar);
  const tab = getEditorTab(), tool = activeToolBarKey(tab);
  const r = bar && tool != null ? rowOf(bar, tab, tool) : null;
  const wrap = r && r.querySelector(':scope > [data-tool-bar-more]');
  if (wrap && _open !== wrap) toggleSheet(wrap);
  return wrap ? wrap.querySelector('.tool-bar-more-sheet') : null;
}

/** The hidden home of every hosted group (#editorToolBarParked; made beside the bar when a page has none). A tab module
 *  builds a group it hosts in several rows ONCE, here (the Height selection buttons). */
export function toolBarParked() {
  let p = $(TOOL_BAR_IDS.parked);
  if (!p && typeof document !== 'undefined') {
    p = document.createElement('div');
    p.id = TOOL_BAR_IDS.parked;
    p.hidden = true;
    ($(TOOL_BAR_IDS.group)?.parentElement || $(TOOL_BAR_IDS.bar)?.parentElement || document.body).appendChild(p);
  }
  return p;
}

let _lastKey = null;
/** Shows the active tab's tool row: its hosted groups moved in (every other hosted group parked), the tab's own items
 *  refreshed (its `sync`), the bar's group shown only when the row has something. Safe any time. */
export function syncToolBar() {
  const bar = $(TOOL_BAR_IDS.bar);
  if (!bar) return;
  const tab = getEditorTab();
  if (EDITOR_TOOL_BAR[tab] && !bar.querySelector(`[data-tool-bar-tab="${tab}"]`)) renderTab(bar, tab);
  const tool = activeToolBarKey(tab);
  const key = tool == null ? null : rowKey(tab, tool);
  if (key !== _lastKey) { closeSheet(); _lastKey = key; }
  const active = tool == null ? null : rowOf(bar, tab, tool);
  const items = active ? toolBarItems(tab, tool) : [];
  const wanted = new Set(hostsOf(items));
  const parked = toolBarParked();
  if (parked) for (const id of ALL_HOSTS) { const n = $(id); if (n && !wanted.has(id) && n.parentElement !== parked) parked.appendChild(n); }
  for (const r of bar.querySelectorAll('[data-tool-bar-row]')) r.style.display = r === active ? 'flex' : 'none';
  let shown = 0;
  if (active) {
    const nodes = _built.get(active) || [];
    shown = place(active, items, nodes).length;
    items.forEach((it, i) => {
      if (it.more) { const sheet = nodes[i] && nodes[i].querySelector('.tool-bar-more-sheet'); if (sheet) place(sheet, it.more, _built.get(sheet) || []); }
    });
    const t = _tabs[tab];
    if (t && t.sync) {
      const each = (list, ns) => list.forEach((it, i) => {
        if (it.more) { const sheet = ns[i] && ns[i].querySelector('.tool-bar-more-sheet'); if (sheet) each(it.more, _built.get(sheet) || []); }
        else if (!it.host && ns[i]) t.sync(ns[i], it, tool);
      });
      each(items, nodes);
    }
  }
  const group = $(TOOL_BAR_IDS.group);
  if (group) { group.hidden = !shown; group.style.display = shown ? 'flex' : 'none'; }
}

let _wired = false;
function _wire() {
  if (_wired || typeof document === 'undefined') return;
  _wired = true;
  for (const ev of ['editorTabChanged', 'editorModeChanged', 'editorSelectionChanged']) document.addEventListener(ev, () => syncToolBar());
  // the '⋯' sheet closes on a click outside it, on Esc
  document.addEventListener('click', (e) => { if (_open && !_open.contains(e.target)) closeSheet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
}

/** Wires the bar (main.js, once): its rows follow the tab and the tool from now on. */
export function initEditorToolBar() {
  _wire();
  syncToolBar();
}
/** Tests: forget the registered tabs and the open sheet. */
export function _resetToolBarForTests() { for (const k of Object.keys(_tabs)) delete _tabs[k]; _open = null; _lastKey = null; }

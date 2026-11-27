/**
 * editor-tabs.js — F35 item 10: the editor modal's top-level [Frame][Artwork][Brick] tabs (+ Lattice, Height; the
 * Photo tab left with the photo, Fred 2026-11-23).
 * Generalizes F8's own 2-way Frame/Artwork toggle (previously frame-panel.js's own setEditorTab) into
 * a declared N-way registry: each tab owns its own LEFT toolbar (the vertical icon rail) AND its own
 * RIGHT panel (settings), both swapped together (Fred: each tab uses a completely different toolbar)
 * -- a new tab is one more entry here plus its own toolbar/panel markup in the HTML, never a new
 * switching mechanism.
 *
 * Frame-specific side effects (the shape handles, the view-only shield, setEditorFocus dimming) stay
 * in frame-panel.js, triggered via the 'editorTabChanged' CustomEvent this module dispatches on every
 * switch -- the same declared-event bridge convention this app already uses elsewhere (e.g.
 * 'bricksGenerated'), so this module never needs to import frame-panel.js/
 * brick-panel.js directly (no import cycle, no ownership creep onto their own tabs' behaviour).
 */
// `modes`: the editor gesture modes (editor-interaction.js modeHandlers keys) this tab's own tools
// arm. Fred (2026-10-04): a tool mode never outlives a switch to a tab that doesn't own it -- a
// Shape Lattice mode carried into the Brick tab ran lattice gestures there. main/global-events.js
// returns the editor to Select (the Esc path) when the new tab doesn't list the current mode.
// cut/stripe are shared: Artwork's Cut/Stripe tools and Brick's Scissors/Stripe arm the same modes.
import { FRAME_LABELS } from '../core/frame-labels.js';

// `clears` (F35 item 28): what the editor header's Clear menu clears for this tab -- a main/editor-clear-menu.js
// CLEAR_KINDS key. A new tab that declares one gets its own Clear entry.
/** Redesign phase 3 (Fred): the permanent tool row holds TOOLS only -- this shared set first, in this order, on Draw and
 *  Lattice alike; then the tab's own (EDITOR_TABS `tools`). The actions moved out (main/editor-chrome.js). */
export const SHARED_ART_TOOLS = Object.freeze(['toolSelect', 'toolCut', 'toolErase', 'toolStripe']);
export const EDITOR_TABS = [
  // `undo`: the stack the editor's Undo / Redo (buttons and Ctrl+Z) act on in this tab -- a main/frame-panel.js
  // EDITOR_UNDO_STACKS key; absent = the editor's own (the artwork) stack
  { id: 'frame', clears: 'frame', label: FRAME_LABELS.wood, buttonId: 'editorTabFrame', panelId: 'editorFramePanel', toolbarId: 'editorToolbarFrame',
    modes: ['select'], undo: 'frame' },
  // Redesign phase 2 (Fred): the Artwork tab is DRAW, and the lattices have their own top-level LATTICE tab. Both edit
  // the same drawing: they share the art panel and its tool row (panelId / toolbarId), and `artTabs` says which of
  // main/art-tabs.js ART_TABS each shows. The ids stay (editorTabArtwork, 'artwork'): the matrix, saved state, tests.
  { id: 'artwork', clears: 'artwork', label: 'Draw', buttonId: 'editorTabArtwork', panelId: 'editorLayersPanel', toolbarId: 'editorToolbarArtwork',
    modes: ['select', 'node', 'text', 'draw', 'line', 'rect', 'circle', 'erase', 'cut', 'stripe'],
    artTabs: ['general', 'draw', 'text', 'edit'], artDefault: 'edit',
    tools: [...SHARED_ART_TOOLS, 'toolNode', 'toolDraw', 'toolLine', 'toolRect', 'toolCircle', 'toolExpand', 'toolText'],
    // phase 4: the Draw drawer is a collapse tree (main/draw-tree.js); the Art-tab strip hides on this tab.
    // The CONTEXT BAR (owner 2026-11-27): the stroke / colour / style, font and expand groups (the drawer's former General,
    // Text and Expand branches) are the active tool's row of the bar (main/editor-tool-bar.js EDITOR_TOOL_BAR.artwork)
    drawerTree: 'drawDrawerTree' },
  { id: 'lattice', label: 'Lattice', buttonId: 'editorTabLattice', panelId: 'editorLayersPanel', toolbarId: 'editorToolbarArtwork',
    modes: ['select', 'lattice', 'shapeLattice', 'cut', 'erase', 'stripe'],
    artTabs: ['lattice', 'shape'], artDefault: 'lattice',
    tools: [...SHARED_ART_TOOLS, 'toolLattice', 'toolShapeLattice'] },
  // F35 item 43: no left rail -- the Brick tools are the tab strip at the top of its own panel (#editorToolbarBrick)
  { id: 'brick', clears: 'bricks', label: 'Brick', buttonId: 'editorTabBrick', panelId: 'editorBrickPanel', toolbarId: null,
    modes: ['select', 'brickBrush', 'cut', 'stripe', 'brickAccentClick', 'brickElementSelect', 'brickWallArea', 'brickHeightPick', 'brickBlocks'],
    // `peekEssentials` (Fred, live: "Wall is missing the generate button"): what must show IN FULL when the
    // phone / narrow-palette drawer sits at peek height (editor/editor-drawer.js measures them into its peek
    // floor). The Brick panel's pinned Generate -- at peek only 10 of its 32 px showed.
    // F35 item 40: + the hosted Layers (Fred, phone: "We don't see layers still") -- at peek the drawer shows Generate AND
    // the layer list (it grows with the number of layers; no cap)
    peekEssentials: ['#editorBrickPanel > .sticky-actions', '#brickLayersSlot'],
    // (its `modeHosts` -- the Stripe settings hosted in #brickStripeSection, turn 195 -- and `panelHosts` -- the Layers
    // list, F35 item 40 -- retired: the Stripe settings are the context bar's Stripe row (main/editor-tool-bar.js), the
    // editor layer stack lists the layers; the Brick start hint lives in #brickLayersSlot itself)
  },
  // HEIGHT-PAINTER (HEIGHT-PAINTER-DESIGN.md slice 1): paint height patches ON the shared canvas (main/height-panel.js);
  // its brush is the 'heightBrush' gesture mode (editor/editor-height-tool.js).
  // Owner 2026-11-23 (Draw's frame): no left rail -- the tool row (`toolbarId`) is the pinned head of its own panel
  // (#heightToolsHead, [data-panel-head]), as Draw's #editorToolbarArtwork heads its panel; the settings (a collapse tree,
  // main/height-panel.js HEIGHT_DRAWER_TREE) scroll under it. On a phone that head is the drawer's, shown in full at peek.
  { id: 'height', label: 'Height', buttonId: 'editorTabHeight', panelId: 'editorHeightPanel', toolbarId: 'editorToolbarHeight',
    modes: ['select', 'heightBrush'], peekEssentials: ['#heightToolsHead'] },
  // EDITOR LAYER STACK (Fred 2026-11-23): an STL row selected. No tab button (the stack's row is the picker); its 2D placement
  // view is planned -- for now the panel points to the sidebar card (#editorStlPanel).
  { id: 'stl', label: 'STL', buttonId: null, panelId: 'editorStlPanel', toolbarId: null, modes: ['select'] },
];
/** EDITOR LAYER STACK: what shows in full at peek on EVERY tab, before the tab's own `peekEssentials` -- the stack (on a
 *  phone folded to the selected row, main/layer-stack.js EDITOR_STACK_LAYOUTS). */
export const SHARED_PEEK_ESSENTIALS = Object.freeze(['#editorLayerStack']);

// (applyModeHosts -- the EDITOR_TABS `modeHosts` / `panelHosts` moves -- retired with its last two users, the Draw tab's
// General / Text / Expand groups and the Brick tab's Stripe settings: they are the context bar's rows now,
// main/editor-tool-bar.js, the ONE mechanism that moves a tool's settings to where they show)

let _editorTab = 'artwork';

// F35 item 16 follow-up (Fred: hiding the WHOLE top toolbar on non-Artwork tabs went too far --
// Brick's own Brush tool needs the GRID group (SHOW/GRID-snap/GEOM-snap + spacing) to draw strokes,
// the exact same shared control + P-state editor-ui.js's own TOOLBAR_GROUPS table already drives for
// Artwork). Declared per tab, data not a hand-rolled branch per group, so a future tab/group pairing
// is one more entry here. 'artwork' is deliberately NOT a key: its own groups stay entirely owned by
// editor-ui.js's existing per-MODE `.hidden`-class system (TOOLBAR_GROUPS) -- this table only ever
// sets an INLINE style.display on top of that, and clears it back to '' on return to Artwork, so the
// untouched `.hidden` class state (which never stopped applying underneath) shows through exactly as
// it was, with no re-sync call needed. editorTouchActionsGroup is excluded from BOTH the all-list and
// every tab's own list -- its own visibility is entirely a (pointer:coarse) CSS media query,
// independent of mode OR tab by design (editor-ui.js's own TOOLBAR_GROUPS doc comment).
const ALL_TAB_GATED_TOOLBAR_GROUPS = [
  'editorStrokeGroup', 'editorColorGroup', 'editorGridGroup', 'editorFillModeGroup',
  'editorFontGroup', 'editorExpandGroup',
];
// (the context bar, #editorToolBarGroup, is not gated here: main/editor-tool-bar.js shows it with the active tool's row)
const TOOLBAR_TOP_GROUPS_BY_TAB = {
  brick: ['editorGridGroup'],
  frame: [],
  height: [], // HEIGHT-PAINTER: none of the drawing's groups; its tools' rows are the context bar's (main/editor-tool-bar.js)
  stl: [],
};

export function setEditorTab(tab) {
  const match = EDITOR_TABS.find((t) => t.id === tab);
  _editorTab = match ? match.id : 'artwork';
  // a panel / tool row is shown when the ACTIVE tab uses it (Draw and Lattice share theirs)
  const on = EDITOR_TABS.find((t) => t.id === _editorTab);
  for (const t of EDITOR_TABS) {
    document.getElementById(t.buttonId)?.classList.toggle('active', t.id === _editorTab);
    const panel = document.getElementById(t.panelId);
    if (panel) panel.style.display = t.panelId === on.panelId ? '' : 'none';
    const toolbar = document.getElementById(t.toolbarId);
    if (toolbar) toolbar.style.display = t.toolbarId && t.toolbarId === on.toolbarId ? 'flex' : 'none';
  }
  // Mobile: the editor's bottom drawer gets the active tab's declared peek essentials (editor/ never imports main/, so as data on
  // the drawer element; editor-drawer.js re-measures its peek floor on 'editorTabChanged' below).
  const drawer = document.getElementById('editorMobileDrawer');
  if (drawer) drawer.dataset.peekEssentials = JSON.stringify([...SHARED_PEEK_ESSENTIALS, ...(EDITOR_TABS.find((t) => t.id === _editorTab)?.peekEssentials || [])]);
  // F35 item 10 follow-up (advisor): the top toolbar's own GROUPS are shared chrome, not one tab's
  // content -- the bar itself now always shows (whenever any tab needs at least one group); WHICH
  // groups show is the per-tab table above.
  const topToolbar = document.getElementById('editorToolbarTop');
  if (topToolbar) topToolbar.style.display = 'flex';
  const visibleGroups = TOOLBAR_TOP_GROUPS_BY_TAB[_editorTab]; // undefined for 'artwork'
  for (const groupId of ALL_TAB_GATED_TOOLBAR_GROUPS) {
    const el = document.getElementById(groupId);
    if (!el) continue;
    el.style.display = visibleGroups ? (visibleGroups.includes(groupId) ? 'flex' : 'none') : '';
  }
  document.dispatchEvent(new CustomEvent('editorTabChanged', { detail: { tab: _editorTab } }));
  return _editorTab;
}
export const getEditorTab = () => _editorTab;

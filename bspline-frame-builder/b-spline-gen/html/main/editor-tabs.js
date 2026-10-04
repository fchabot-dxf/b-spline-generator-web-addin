/**
 * editor-tabs.js — F35 item 10: the editor modal's top-level [Frame][Artwork][Photo][Brick] tabs.
 * Generalizes F8's own 2-way Frame/Artwork toggle (previously frame-panel.js's own setEditorTab) into
 * a declared N-way registry: each tab owns its own LEFT toolbar (the vertical icon rail) AND its own
 * RIGHT panel (settings), both swapped together (Fred: each tab uses a completely different toolbar)
 * -- a new tab is one more entry here plus its own toolbar/panel markup in the HTML, never a new
 * switching mechanism.
 *
 * Frame-specific side effects (the shape handles, the view-only shield, setEditorFocus dimming) stay
 * in frame-panel.js, triggered via the 'editorTabChanged' CustomEvent this module dispatches on every
 * switch -- the same declared-event bridge convention this app already uses elsewhere (e.g.
 * 'bricksGenerated'), so this module never needs to import frame-panel.js/photo-panel.js/
 * brick-panel.js directly (no import cycle, no ownership creep onto their own tabs' behaviour).
 */
// `drawerLabel` is the mobile bottom-drawer's OWN side-panel label -- kept distinct from `label`
// (the tab button's own text) because Artwork's panel is actually titled "Layers" (pre-existing,
// tests/frame-tabs.test.js's own expectation), not "Artwork"; Photo/Brick have no such distinction
// (their own panel IS titled Photo/Brick), so `drawerLabel` just repeats `label` there.
// `modes`: the editor gesture modes (editor-interaction.js modeHandlers keys) this tab's own tools
// arm. Fred (2026-10-04): a tool mode never outlives a switch to a tab that doesn't own it -- a
// Shape Lattice mode carried into the Brick tab ran lattice gestures there. main/global-events.js
// returns the editor to Select (the Esc path) when the new tab doesn't list the current mode.
// cut/stripe are shared: Artwork's Cut/Stripe tools and Brick's Scissors/Stripe arm the same modes.
import { TOOLBAR_GROUPS } from '../editor/editor-ui.js';

export const EDITOR_TABS = [
  { id: 'frame', label: 'Frame', drawerLabel: 'Frame', buttonId: 'editorTabFrame', panelId: 'editorFramePanel', toolbarId: 'editorToolbarFrame',
    modes: ['select'] },
  { id: 'artwork', label: 'Artwork', drawerLabel: 'Layers', buttonId: 'editorTabArtwork', panelId: 'editorLayersPanel', toolbarId: 'editorToolbarArtwork',
    modes: ['select', 'node', 'text', 'draw', 'line', 'rect', 'circle', 'erase', 'lattice', 'shapeLattice', 'cut', 'stripe'] },
  { id: 'photo', label: 'Photo', drawerLabel: 'Photo', buttonId: 'editorTabPhoto', panelId: 'editorPhotoPanel', toolbarId: 'editorToolbarPhoto',
    modes: ['select'] },
  { id: 'brick', label: 'Brick', drawerLabel: 'Brick', buttonId: 'editorTabBrick', panelId: 'editorBrickPanel', toolbarId: 'editorToolbarBrick',
    modes: ['select', 'brickBrush', 'cut', 'stripe', 'brickAccentClick'],
    // `peekEssentials` (Fred, live: "Wall is missing the generate button"): what must show IN FULL when the
    // phone / narrow-palette drawer sits at peek height (editor/editor-drawer.js measures them into its peek
    // floor). The Brick panel's pinned Generate -- at peek only 10 of its 32 px showed.
    peekEssentials: ['#editorBrickPanel > .sticky-actions'],
    // `modeHosts` (turn 195, advisor: "one contextual panel"): which panel a mode's settings open in, per
    // tab. Here the stripe mode's settings (#editorStripePanelBody) live INSIDE this tab's own panel
    // (#brickStripeSection, shown for the Stripe tool) instead of opening a second side column. A tab
    // without an entry keeps the mode's own panel (Artwork's Stripe is unchanged).
    modeHosts: { stripe: { content: 'editorStripePanelBody', host: 'brickStripeSection', panel: 'editorStripePanel' } } },
];

/** Apply EDITOR_TABS' `modeHosts` for the active tab: its hosted content moves into the tab's own host;
 *  every other hosted block goes back to its own declared `panel` (its home). The mode's side panel then
 *  re-evaluates its declared visibility (editor-ui.js TOOLBAR_GROUPS: it shows only while it holds its
 *  own content). Homes are declared, never remembered, so a rebuilt DOM can't leave a stale one. */
export function applyModeHosts(tab = _editorTab) {
  const panels = new Set();
  for (const t of EDITOR_TABS) {
    for (const h of Object.values(t.modeHosts || {})) {
      panels.add(h.panel);
      const content = document.getElementById(h.content);
      const target = document.getElementById(t.id === tab ? h.host : h.panel);
      if (content && target && content.parentElement !== target) target.appendChild(content);
    }
  }
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  const mode = editor && editor._currentMode;
  for (const panelId of panels) {
    const visible = TOOLBAR_GROUPS[panelId];
    const node = document.getElementById(panelId);
    if (node && visible) node.classList.toggle('hidden', !visible(mode, null, mode));
  }
}

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
const TOOLBAR_TOP_GROUPS_BY_TAB = {
  brick: ['editorGridGroup'],
  photo: [],
  frame: [],
};

export function setEditorTab(tab) {
  const match = EDITOR_TABS.find((t) => t.id === tab);
  _editorTab = match ? match.id : 'artwork';
  for (const t of EDITOR_TABS) {
    const active = t.id === _editorTab;
    document.getElementById(t.buttonId)?.classList.toggle('active', active);
    const panel = document.getElementById(t.panelId);
    if (panel) panel.style.display = active ? '' : 'none';
    const toolbar = document.getElementById(t.toolbarId);
    if (toolbar) toolbar.style.display = active ? 'flex' : 'none';
  }
  // Mobile: the editor's bottom drawer labels its side panel; name it for the active tab.
  const drawerTab = document.getElementById('editorDrawerTab-layers');
  if (drawerTab) drawerTab.textContent = EDITOR_TABS.find((t) => t.id === _editorTab)?.drawerLabel || 'Layers';
  // ... and hands it the active tab's declared peek essentials (editor/ never imports main/, so as data on
  // the drawer element; editor-drawer.js re-measures its peek floor on 'editorTabChanged' below).
  const drawer = document.getElementById('editorMobileDrawer');
  if (drawer) drawer.dataset.peekEssentials = JSON.stringify(EDITOR_TABS.find((t) => t.id === _editorTab)?.peekEssentials || []);
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
  applyModeHosts(_editorTab);
  document.dispatchEvent(new CustomEvent('editorTabChanged', { detail: { tab: _editorTab } }));
  return _editorTab;
}
export const getEditorTab = () => _editorTab;

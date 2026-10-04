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
export const EDITOR_TABS = [
  { id: 'frame', label: 'Frame', drawerLabel: 'Frame', buttonId: 'editorTabFrame', panelId: 'editorFramePanel', toolbarId: 'editorToolbarFrame' },
  { id: 'artwork', label: 'Artwork', drawerLabel: 'Layers', buttonId: 'editorTabArtwork', panelId: 'editorLayersPanel', toolbarId: 'editorToolbarArtwork' },
  { id: 'photo', label: 'Photo', drawerLabel: 'Photo', buttonId: 'editorTabPhoto', panelId: 'editorPhotoPanel', toolbarId: 'editorToolbarPhoto' },
  { id: 'brick', label: 'Brick', drawerLabel: 'Brick', buttonId: 'editorTabBrick', panelId: 'editorBrickPanel', toolbarId: 'editorToolbarBrick' },
];

let _editorTab = 'artwork';

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
  // F35 item 10 follow-up (advisor): Stroke/Color/Grid/Style only applies to hand-drawn Artwork
  // shapes -- shown on the Artwork tab only, not one of the per-tab toolbar/panel pairs above since
  // it isn't a tab's own content, just shared styling chrome for ONE of them.
  const topToolbar = document.getElementById('editorToolbarTop');
  if (topToolbar) topToolbar.style.display = _editorTab === 'artwork' ? 'flex' : 'none';
  document.dispatchEvent(new CustomEvent('editorTabChanged', { detail: { tab: _editorTab } }));
  return _editorTab;
}
export const getEditorTab = () => _editorTab;

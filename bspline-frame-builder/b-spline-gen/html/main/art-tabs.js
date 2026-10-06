/**
 * art-tabs.js -- the Artwork editor's TABS (Fred's OK on mockup v2: "the tabs over the controls"): the strip heads the
 * Artwork panel (#artTabsHead, pinned), then the active tab's tool buttons, then Layers, then the picked tool's own
 * settings (unchanged: lattice-side-column.js / the top bar's mode groups).
 *
 * ART_TABS declares which Artwork tool button sits in which tab. The buttons are the existing ones (#editorToolbarArtwork
 * moved from the left rail into the panel head): their ids, keyboard shortcuts and active highlight are untouched; a tab
 * only shows its own. General is not a tool: it holds the shared stroke / colour / style groups (EDITOR_TABS artwork
 * `panelHosts` move them into #artGeneralBody) and leaves the tool as it is.
 *
 * A tab pick arms the tab's first tool unless the current mode already belongs to it; a mode change from anywhere else
 * (a shortcut, Esc = Select) brings its tab up.
 */
import { renderTabStrip } from '../editor/tab-strip.js';

export const ART_TABS = Object.freeze([
  Object.freeze({ id: 'general', label: 'General', tools: Object.freeze([]) }),
  Object.freeze({ id: 'draw', label: 'Draw', tools: Object.freeze(['toolDraw', 'toolLine', 'toolRect', 'toolCircle', 'toolErase', 'toolExpand']) }),
  Object.freeze({ id: 'lattice', label: 'Lattice', tools: Object.freeze(['toolLattice']) }),
  Object.freeze({ id: 'shape', label: 'Shape', tools: Object.freeze(['toolShapeLattice']) }),
  Object.freeze({ id: 'text', label: 'Text', tools: Object.freeze(['toolText']) }),
  Object.freeze({ id: 'edit', label: 'Edit', tools: Object.freeze(['toolSelect', 'toolNode', 'toolCut', 'toolStripe', 'toolFit', 'toolDelete', 'toolResetTransform', 'toolFlattenTransform']) }),
]);
export const ART_DEFAULT_TAB = 'edit';
/** The groups General holds (moved there by EDITOR_TABS artwork `panelHosts`, home = the top bar). */
export const ART_GENERAL_GROUPS = Object.freeze(['editorStrokeGroup', 'editorColorGroup', 'editorFillModeGroup']);

/** Pure: the editor mode a tool button arms (the editor's own `tool<Mode>` id convention, editor-ui.js setMode); the
 *  action buttons (Fit, Delete, the transforms) arm none. */
const ACTION_BUTTONS = new Set(['toolFit', 'toolDelete', 'toolResetTransform', 'toolFlattenTransform']);
export const modeOfToolButton = (id) => (ACTION_BUTTONS.has(id) ? null : id.replace(/^tool/, '').replace(/^./, (c) => c.toLowerCase()));
/** Pure: the tab whose tools arm `mode`, else null (a mode no Artwork tool arms, e.g. a Brick mode). */
export function artTabOfMode(mode) {
  const tab = ART_TABS.find((t) => t.tools.some((b) => modeOfToolButton(b) === mode));
  return tab ? tab.id : null;
}

let _tab = ART_DEFAULT_TAB;
let _sync = null;
export const activeArtTab = () => _tab;

export function setArtTab(id, { arm = true } = {}) {
  const tab = ART_TABS.find((t) => t.id === id);
  if (!tab || typeof document === 'undefined') return;
  _tab = id;
  const tools = document.getElementById('editorToolbarArtwork');
  if (tools) {
    for (const el of tools.children) el.style.display = tab.tools.includes(el.id) ? '' : 'none'; // dividers: none
    tools.style.display = tab.tools.length ? 'flex' : 'none';
  }
  const general = document.getElementById('artGeneralBody');
  if (general) general.style.display = id === 'general' ? '' : 'none';
  if (_sync) _sync(id);
  if (!arm) return;
  const editor = typeof window !== 'undefined' ? window.svgEditor : null;
  const first = tab.tools.find((b) => modeOfToolButton(b));
  if (first && editor && artTabOfMode(editor._currentMode) !== id) document.getElementById(first)?.click();
}

export function initArtTabs() {
  const strip = typeof document !== 'undefined' ? document.getElementById('artTabStrip') : null;
  if (!strip) return;
  _sync = renderTabStrip(strip, ART_TABS, (id) => setArtTab(id), { idPrefix: 'artTab_' });
  document.addEventListener('editorModeChanged', (e) => {
    const t = artTabOfMode(e.detail && e.detail.mode);
    if (t && t !== _tab) setArtTab(t, { arm: false });
  });
  setArtTab(ART_DEFAULT_TAB, { arm: false });
}

/**
 * main/draw-tree.js -- the Draw tab's drawer as ONE collapse tree (redesign phase 4, Fred's mockups
 * shots/seatD/redesign/mock_Draw_*; advisor 2026-10-15: no "Pen" branch -- the pen's look IS General's stroke / colour
 * / fill; no "Edit" branch -- the selection bar covers it). The branches' content is moved in by the Draw tab's declared
 * `panelHosts` (main/editor-tabs.js), so a tab switch carries it out and back like the Brick tab's Layers.
 */
import { createDrawerTree } from './drawer-tree.js';

export const drawBranchDomId = (id) => `drawBranch_${id}`;
/** A tool branch arms an editor MODE (its tool button: `tool<Mode>`). */
export const DRAW_DRAWER_TREE = Object.freeze([
  Object.freeze({ id: 'general', title: 'General', summary: 'stroke · colour · fill', hosts: Object.freeze(['artGeneralBody']) }),
  Object.freeze({ id: 'text', title: 'Text', summary: 'font · symbols', hosts: Object.freeze(['artTextBody']), armsTool: 'text' }),
  Object.freeze({ id: 'expand', title: 'Expand', summary: 'offset a shape', hosts: Object.freeze(['artExpandBody']), armsTool: 'expand' }),
  Object.freeze({ id: 'layers', title: 'Layers', hosts: Object.freeze(['drawLayersBody']),
    summary: (doc) => { const n = doc.querySelectorAll('#editorLayersList .layer-row').length; return `${n} layer${n === 1 ? '' : 's'}`; } }),
]);
// the first look: General open, and the Layers (Fred, phone: "We don't see layers" -- the Brick tree opens them too;
// the layers matrix row reads the list on screen when the Draw tab is back); Text / Expand open with their tool
export const DRAW_TREE_DEFAULT_OPEN = Object.freeze(['general', 'layers']);
export const DRAW_TREE_OPEN_KEY = 'bspline.draw.drawerOpen';
export const DRAW_TREE = createDrawerTree({ id: 'drawDrawerTree', branches: DRAW_DRAWER_TREE, openKey: DRAW_TREE_OPEN_KEY,
  defaultOpen: DRAW_TREE_DEFAULT_OPEN, branchDomId: drawBranchDomId });

const _mode = () => (typeof window !== 'undefined' && window.svgEditor ? window.svgEditor._currentMode : null);

/** Builds the Draw tree at the end of the Draw / Lattice panel and keeps it in step: shown on the Draw tab only, its
 *  tool branches open with their mode, the Layers count fresh. */
export function initDrawTree(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return;
  const panel = doc.getElementById('editorLayersPanel');
  if (!panel) return;
  DRAW_TREE.build(panel, (mode) => doc.getElementById(`tool${mode[0].toUpperCase()}${mode.slice(1)}`)?.click(), doc);
  const show = (tab) => { const root = doc.getElementById(DRAW_TREE.id); if (root) root.style.display = tab === 'artwork' ? '' : 'none'; };
  doc.addEventListener('editorTabChanged', (e) => show(e.detail && e.detail.tab));
  doc.addEventListener('editorModeChanged', () => DRAW_TREE.sync(_mode()));
  doc.addEventListener('editorLayersChanged', () => DRAW_TREE.sync(_mode()));
  DRAW_TREE.sync(_mode());
}

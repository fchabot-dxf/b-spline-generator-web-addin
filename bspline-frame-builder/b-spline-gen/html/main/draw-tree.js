/**
 * main/draw-tree.js -- the Draw tab's drawer as ONE collapse tree (redesign phase 4, Fred's mockups
 * shots/seatD/redesign/mock_Draw_*; advisor 2026-10-15: no "Edit" branch -- the selection bar covers it). The pen's look
 * (stroke / colour / fill), the font and Expand are the context bar's (main/editor-tool-bar.js); the tree holds the layer's
 * own settings (Stamp).
 */
import { createDrawerTree } from './drawer-tree.js';
import { stampTarget, stampSummaryText } from '../core/stamp/target.js';
import { STAMP_TARGET_CHANGED } from './stamp/summary.js';

export const drawBranchDomId = (id) => `drawBranch_${id}`;
/** A tool branch arms an editor MODE (its tool button: `tool<Mode>`). */
export const DRAW_DRAWER_TREE = Object.freeze([
  // (the General / Text / Expand branches retired with the context bar, owner 2026-11-27: the stroke, colour, style, font
  // and expand settings are TOOL settings -- the active tool's row at the top of the canvas, main/editor-tool-bar.js)
  // (the Layers branch retired with the editor layer stack, Fred 2026-11-24: the stack above the panel lists the layers)
  // DRAW-STAMP U (Fred 2026-11-22: edited in the editor, summarised in the sidebar): the SELECTED layer's stamp settings
  // (#drawStampBody: moved from the sidebar VECTOR STAMPING panel); its summary = the sidebar row's own line
  Object.freeze({ id: 'stamp', title: 'Stamp', hosts: Object.freeze(['drawStampBody']),
    summary: () => { const t = stampTarget(); return t.layer ? stampSummaryText(t) : ''; } }),
]);
// the first look: every branch folded as before (General, the one open at first, is the context bar now)
export const DRAW_TREE_DEFAULT_OPEN = Object.freeze([]);
export const DRAW_TREE_OPEN_KEY = 'bspline.draw.drawerOpen';
// Fred 2026-11-24 (tool-row duplicates; the Brick and Height trees' rule): `armedOnly` -- a tool card shows only while its
// tool is armed (the tool rail is the picker)
export const DRAW_TREE = createDrawerTree({ id: 'drawDrawerTree', branches: DRAW_DRAWER_TREE, openKey: DRAW_TREE_OPEN_KEY,
  defaultOpen: DRAW_TREE_DEFAULT_OPEN, branchDomId: drawBranchDomId, armedOnly: true });

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
  doc.addEventListener(STAMP_TARGET_CHANGED, () => DRAW_TREE.sync(_mode())); // the Stamp branch's summary
  DRAW_TREE.sync(_mode());
}

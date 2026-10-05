/**
 * main/editor-clear-menu.js -- F35 item 28 (Fred: "Clear should be a drop down in header with all clear
 * options, all, frame, art etc"). The editor header's Clear opens a menu: All, then one entry per thing the
 * editor holds -- read from the tab registry (main/editor-tabs.js EDITOR_TABS `clears`), so a new tab that
 * declares what it clears appears here by itself. Decisions (advisor turn 211):
 *   Frame   -- the frame SHAPE only: the template goes to Rectangle (no frame); the bricks re-lay on it
 *              (main/brick-panel.js 'frameRecordChanged').
 *   Artwork -- the art layers and their content (the Bricks layer stays).
 *   Photo   -- the photo (image, its edits, its pattern) as on a new board.
 *   Bricks  -- every brick element, and the Bricks layer's laid key nulled.
 *   All     -- everything, the template included; it alone asks first (the in-app dialog, audit K5).
 * Each option is ONE undo step: the editor-side kinds share one commitEdit; the frame keeps its own undo
 * (the Frame tab's), the photo its own state. CLEAR_KINDS + clearOptions() are plain data for 88's matrix.
 */
import { EDITOR_TABS } from './editor-tabs.js';
import { clearPhoto } from './photo-panel.js';
import { clearArtworkLayers, clearBrickElements } from '../editor/editor-clear.js';
import { resetArtworkToFresh } from '../editor/editor-io.js';
import { clearFrame } from '../editor/editor-frame-profile.js';
import { refreshGuides } from '../editor/editor-guides.js';
import { commitEdit } from '../editor/editor-commit.js';
import { confirmDialog } from '../core/confirm-dialog.js';

/** kind -> { label, editor: true when it changes the drawing (shares the one commit), run(editor) } */
export const CLEAR_KINDS = Object.freeze({
  frame: { label: 'Frame', editor: false, run: () => clearFrame() },
  artwork: { label: 'Artwork', editor: true, run: (editor) => clearArtworkLayers(editor) },
  photo: { label: 'Photo', editor: false, run: () => clearPhoto() },
  bricks: { label: 'Bricks', editor: true, run: (editor) => clearBrickElements(editor) },
});
export const CLEAR_ALL_CONFIRM = 'Clear everything -- the frame, artwork, photo and bricks?';

/** [{ id, label, kinds, confirm? }]: All first, then one per tab that declares `clears`, in tab order. */
export function clearOptions() {
  const kinds = EDITOR_TABS.map((t) => t.clears).filter((k) => k && CLEAR_KINDS[k]);
  return [{ id: 'all', label: 'All', kinds, confirm: true }, ...kinds.map((k) => ({ id: k, label: CLEAR_KINDS[k].label, kinds: [k] }))];
}

/** Clear one option's kinds; false when unknown, no editor, or the All dialog was declined. */
export async function runClear(optionId, editor = (typeof window !== 'undefined' ? window.svgEditor : null)) {
  const option = clearOptions().find((o) => o.id === optionId);
  if (!option || !editor) return false;
  if (option.confirm && !(await confirmDialog(CLEAR_ALL_CONFIRM, { okLabel: 'Clear all', cancelLabel: 'Keep', zIndex: 10002 }))) return false;
  const editorKinds = option.kinds.filter((k) => CLEAR_KINDS[k].editor);
  for (const k of option.kinds) if (!CLEAR_KINDS[k].editor) CLEAR_KINDS[k].run(editor);
  if (editorKinds.includes('artwork') && editorKinds.includes('bricks')) {
    resetArtworkToFresh(editor); // both at once = exactly a new board's drawing (the SAME function open() uses)
  } else {
    for (const k of editorKinds) CLEAR_KINDS[k].run(editor);
  }
  if (editorKinds.length) {
    refreshGuides(editor);
    commitEdit(editor); // the ONE undo step for this option's drawing changes
  }
  return true;
}

/** The menu under the header's #editorClear (fixed, so the phone's ⋯ popover can't clip it). */
export function initClearMenu() {
  const button = document.getElementById('editorClear');
  if (!button || document.getElementById('editorClearMenu')) return;
  button.textContent = 'Clear ▾';
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  const menu = document.createElement('div');
  menu.id = 'editorClearMenu';
  menu.setAttribute('role', 'menu');
  menu.style.cssText = 'display:none; position:fixed; z-index:10003; background:#fff; border:1px solid #ccc; border-radius:4px;'
    + ' box-shadow:0 2px 8px rgba(0,0,0,0.15); padding:4px; min-width:120px; flex-direction:column; gap:2px;';
  for (const option of clearOptions()) {
    const item = document.createElement('button');
    item.type = 'button';
    item.id = `editorClear_${option.id}`;
    item.className = 'cad-btn cad-btn-secondary';
    item.setAttribute('role', 'menuitem');
    item.textContent = option.label;
    item.style.cssText = 'font-size:11px; padding:4px 10px; text-align:left;';
    item.addEventListener('click', () => { close(); runClear(option.id); });
    menu.appendChild(item);
  }
  document.body.appendChild(menu);
  const close = () => { menu.style.display = 'none'; button.setAttribute('aria-expanded', 'false'); };
  const open = () => {
    const r = button.getBoundingClientRect();
    menu.style.display = 'flex';
    const w = menu.getBoundingClientRect().width;
    menu.style.left = `${Math.max(4, Math.min(r.left, (window.innerWidth || r.left + w) - w - 4))}px`;
    menu.style.top = `${r.bottom + 2}px`;
    button.setAttribute('aria-expanded', 'true');
  };
  button.addEventListener('click', (e) => { e.stopPropagation(); (menu.style.display === 'none' ? open : close)(); });
  document.addEventListener('click', (e) => { if (!menu.contains(e.target) && e.target !== button) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  window.addEventListener('scroll', close, true);
}

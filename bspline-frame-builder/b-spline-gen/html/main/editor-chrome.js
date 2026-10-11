/**
 * editor-chrome.js -- redesign phase 3 (Fred's mockups + his phone shot of the editor: "the second top row wraps over ~3
 * lines and wastes canvas"): the editor's permanent rows hold TOOLS only. What is not a tool moves where it belongs,
 * declared here; the controls keep their ids, handlers, shortcuts and tests (they are MOVED, never rebuilt):
 *   SELECTION_BAR -- the actions on a selection (Delete / Reset / Flatten, Copy, Lock): a floating bar above the
 *                    selection, shown only while something is selected.
 *   CANVAS_CORNER -- Fit view: a button in the canvas corner (it stays in the long-press menu too).
 *   GRID_POPOVER  -- the grid settings (Show / Grid / Geom, the size, Auto nodes): one "Grid ▾" button + a small popover.
 *   TOUCH_ROW     -- the touch row keeps only Cancel, shown while a pen path is being drawn; Paste / Select all are the
 *                    long-press menu's (editor-context-menu.js CONTEXT_MENU_ITEMS 'paste' / 'select-all').
 */
export const SELECTION_BAR = Object.freeze(['toolDelete', 'toolResetTransform', 'toolFlattenTransform', 'editorTouchCopy', 'editorTouchLock']);
/** The modes whose subject IS the selection: only there does the bar show. In a drawing tool the stroke just drawn is
 *  selected too, and a bar over the canvas covered where the user draws and pinches (measured: the layout group's
 *  pinch at the former Expand tip landed on the bar). */
export const SELECTION_BAR_MODES = Object.freeze(['select', 'node', 'brickElementSelect']);
export const CANVAS_CORNER = Object.freeze(['toolFit']);
export const GRID_POPOVER = Object.freeze({
  group: 'editorGridGroup',
  label: 'Grid',
  moves: Object.freeze(['editorGridShow', 'editorSnapGrid', 'editorSnapGeometry', 'editorGridSpacing', 'editorAutoNodesGroup']),
});
export const TOUCH_ROW = Object.freeze({ whileDrawing: Object.freeze(['editorTouchCancel']), menuOnly: Object.freeze(['editorTouchPaste', 'editorTouchSelectAll']) });

const $ = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);
const editor = () => (typeof window !== 'undefined' ? window.svgEditor : null);
const GAP_PX = 10;

/** The selection's box on screen (the union of the selected nodes' rects), or null. */
export function selectionScreenBox(ed = editor()) {
  const sel = (ed && ed._selectedElements) || [];
  let box = null;
  for (const el of sel) {
    const node = el && (el.node || el);
    if (!node || typeof node.getBoundingClientRect !== 'function') continue;
    const r = node.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    box = box ? { left: Math.min(box.left, r.left), top: Math.min(box.top, r.top), right: Math.max(box.right, r.right), bottom: Math.max(box.bottom, r.bottom) }
      : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }
  return box;
}

/** Places (or hides) the selection bar: centred over the selection, kept inside the canvas host. */
export function syncSelectionBar() {
  const bar = $('editorSelectionBar');
  const host = bar && bar.parentElement;
  if (!bar || !host) return;
  const ed = editor();
  const box = ed && SELECTION_BAR_MODES.includes(ed._currentMode) ? selectionScreenBox(ed) : null;
  if (!box) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  const h = host.getBoundingClientRect(), b = bar.getBoundingClientRect();
  const left = Math.max(4, Math.min(h.width - b.width - 4, (box.left + box.right) / 2 - h.left - b.width / 2));
  let top = box.top - h.top - b.height - GAP_PX;
  if (top < 4) top = Math.min(h.height - b.height - 4, box.bottom - h.top + GAP_PX); // no room above: below the selection
  bar.style.left = `${Math.round(left)}px`;
  bar.style.top = `${Math.round(Math.max(4, top))}px`;
}

/** Shows the touch row's Cancel only while a pen path is being drawn. */
export function syncTouchRow() {
  const drawing = !!(editor() && editor()._isDrawing);
  for (const id of TOUCH_ROW.whileDrawing) { const b = $(id); if (b) b.style.display = drawing ? '' : 'none'; }
}

function _buildGridPopover() {
  const group = $(GRID_POPOVER.group);
  if (!group || $('editorGridPopover')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'editorGridButton';
  button.className = 'editor-fillmode-btn';
  button.textContent = `${GRID_POPOVER.label} ▾`;
  button.title = 'Grid: show, snap, size';
  const pop = document.createElement('div');
  pop.id = 'editorGridPopover';
  pop.setAttribute('role', 'dialog');
  pop.style.cssText = 'display:none; position:fixed; z-index:10002; background:#fff; border:1px solid #ccc; border-radius:6px;'
    + ' box-shadow:0 2px 8px rgba(0,0,0,0.15); padding:8px; gap:8px; flex-wrap:wrap; align-items:center; max-width:280px;';
  for (const id of GRID_POPOVER.moves) { const c = $(id); if (!c) continue; const seg = c.closest('.segmented-group'); pop.appendChild(seg && group.contains(seg) ? seg : c); }
  // the group's own label and divider go: the button names it
  for (const c of [...group.children]) if (c !== pop && !c.contains(pop)) c.remove();
  group.append(button, pop);
  const close = () => { pop.style.display = 'none'; };
  button.addEventListener('click', () => {
    if (pop.style.display !== 'none') { close(); return; }
    pop.style.display = 'flex';
    const r = button.getBoundingClientRect();
    pop.style.left = `${Math.max(4, Math.min(r.left, (window.innerWidth || r.left + 280) - pop.getBoundingClientRect().width - 4))}px`;
    pop.style.top = `${r.bottom + 4}px`;
  });
  document.addEventListener('click', (e) => { if (!group.contains(e.target)) close(); });
}

export function initEditorChrome() {
  if (typeof document === 'undefined' || $('editorSelectionBar')) return;
  const host = $('editorSVGContainer')?.parentElement || $('editorSVGContainer');
  if (!host) return;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  // the selection bar: the declared buttons moved in (ids, handlers and active states kept)
  const bar = document.createElement('div');
  bar.id = 'editorSelectionBar';
  bar.className = 'editor-selection-bar';
  bar.style.cssText = 'display:none; position:absolute; z-index:30; gap:2px; padding:4px; background:#fff; border:1px solid #cfd6de;'
    + ' border-radius:10px; box-shadow:0 2px 8px rgba(0,0,0,0.22);';
  for (const id of SELECTION_BAR) { const b = $(id); if (b) bar.appendChild(b); }
  host.appendChild(bar);
  // the canvas corner: Fit
  const corner = document.createElement('div');
  corner.id = 'editorCanvasCorner';
  corner.style.cssText = 'position:absolute; right:10px; bottom:10px; z-index:30; display:flex; gap:6px;';
  for (const id of CANVAS_CORNER) { const b = $(id); if (b) corner.appendChild(b); }
  host.appendChild(corner);
  _buildGridPopover();
  for (const id of TOUCH_ROW.menuOnly) { const b = $(id); if (b) b.style.display = 'none'; }
  for (const ev of ['editorSelectionChanged', 'editorViewChanged', 'editorCommit', 'editorTabChanged', 'editorModeChanged']) document.addEventListener(ev, () => { syncSelectionBar(); syncTouchRow(); });
  host.addEventListener('pointerup', () => requestAnimationFrame(() => { syncSelectionBar(); syncTouchRow(); }), true);
  host.addEventListener('pointerdown', () => requestAnimationFrame(syncTouchRow), true);
  syncSelectionBar();
  syncTouchRow();
}

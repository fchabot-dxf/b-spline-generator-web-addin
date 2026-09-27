/**
 * editor-context-menu.js — H6 CONTEXT-MENU: a declared registry of actions
 * shown on tap-and-hold (touch) or right-click (desktop), on a piece or on
 * empty canvas. Kept as its own module — the same reason H5's gesture
 * module is (editor-multiselect-gesture.js's own doc comment) — so this
 * turn's edits to the shared editor-interaction.js stay a few one-line
 * hooks, not a body of new menu/gesture logic living inside it.
 *
 * Every entry calls an EXISTING command (no reimplementation): Colour via
 * editor.setColor + openColorMosaic (exactly lattice-piece-panel.js's own
 * ordering — stamp overrides first, setColor last, ONE undo step); Cut/Join
 * via editor-cut-tool.js's own cutAt/join (SE16, merged at a626e8f — its own
 * header comment already earmarks them "seat A's H6 context menu registers
 * them"); Duplicate = copySelection + pasteClipboard back to back; Delete
 * via editor.deleteSelected (already multi-select safe); Select all <kind>
 * via editor._selectMany + pieceKindOf; Paste/Select all/Fit view via
 * pasteClipboard/selectAllVisible/editor.fitView. Move to layer has no
 * existing command to reuse (confirmed absent app-wide) — new, minimal
 * logic built only from editor._layers/addLayer/applyLayerState, the same
 * primitives every other layer mutator in layers.js already uses.
 *
 * TARGET SHAPE passed to appliesTo/when/run — one object, called `target`
 * throughout (the checklist's own "state" and "target" are the same thing
 * here):
 *   { editor, kind, el, selection, point, cutIntent }
 *   - kind: the SPECIFIC held/right-clicked element's kind — 'rails' |
 *     'ties' | 'nodes' | 'contour' | a plain el.type ('line'/'rect'/'text'/
 *     …) | 'empty'. Kind-specific entries (Cut/Join/Select-all-<kind>/Move-
 *     to-layer) key off THIS, not the whole selection, which can be mixed.
 *   - el: the specific held element, or null for empty canvas.
 *   - selection: editor._selectedElements AT THE MOMENT the menu opens.
 *     "Acts on the whole selection when the held piece is in it" falls out
 *     for free: the EXISTING select-replace/no-op logic (H5's own,
 *     unchanged 3-way branch) already leaves _selectedElements as exactly
 *     the right whole-selection by the time either trigger (hold-elapsed,
 *     native contextmenu) fires, whether the held piece was already part
 *     of a multi-selection or a fresh one.
 *   - point: the model-space point of the hold/right-click — Cut/Join need
 *     a specific point ON a line, not just "the line".
 *   - cutIntent: cutIntent(editor, point) computed once per menu-open, or
 *     null off a line (editor-cut-tool.js's own {action:'cut'|'join', …}).
 *
 * TIMING: reuses H5's own MULTISELECT_HOLD_MS — that module's own doc
 * comment declares it for exactly this reuse ("H6's own context-menu hold
 * can reuse HOLD_MS"). "Hold = still for the hold time without moving" is
 * the identical definition both features share; cancelMultiSelectHoldIfMoved
 * / the click-threshold check it wraps is the same "still vs a drag" test
 * this file's own cancelContextMenuHoldIfMoved reuses.
 *
 * DESKTOP is NOT hold-based at all — a right-click's own mousedown already
 * runs through the exact same selectHandler/latticeHandler hit-test and
 * select-replace logic every left-click does (confirmed live: no button
 * check gates it), so by the time the native `contextmenu` event fires,
 * editor._selectedElements already holds the right target. bindContextMenu
 * below just reads it and opens the menu — no separate hit-test, no hold
 * timer, for mouse/pen at all.
 */
import { MULTISELECT_HOLD_MS } from './editor-multiselect-gesture.js';
import { inputProfileFor } from './editor-input.js';
import { pieceKindOf, applyColorOverride } from './editor-piece-override.js';
import { CONTOUR_SEG_INDEX_ATTR } from './editor-lattice-pattern.js';
import { openColorMosaic } from './editor-color.js';
import { cutAt, join, cutIntent } from './editor-cut-tool.js';
import { copySelection, pasteClipboard, selectAllVisible } from './editor-interaction.js';
import { applyLayerState, addLayer } from './layers.js';

const LATTICE_OWNED_KINDS = new Set(['rails', 'ties', 'nodes', 'contour']);

function _isContourSegment(el) {
  return !!(el && el.node && el.node.hasAttribute(CONTOUR_SEG_INDEX_ATTR));
}

/** The kind string used for appliesTo/label filtering — see this module's
 *  own doc comment for the vocabulary. Exported for the test file. */
export function targetKindOf(el) {
  if (!el) return 'empty';
  return pieceKindOf(el) || (_isContourSegment(el) ? 'contour' : el.type);
}

function _moveSelectionToLayer(editor, selection, layerId) {
  for (const el of selection) { try { el.attr('data-layer', String(layerId)); } catch (_) {} }
  applyLayerState(editor);
  if (typeof editor.pushState === 'function') editor.pushState();
  if (typeof editor._notifyChange === 'function') editor._notifyChange('commit');
  else if (editor._onChange) editor._onChange();
}

/** ONE declared registry — {id, label, icon, appliesTo(kind), when(target),
 *  run(editor, target, rowEl)}. `label` may be a function of `target` for a
 *  kind-dependent string ("Select all rails"). `submenu(editor, target)`
 *  (Move to layer only) returns [{label, run}] instead of running directly. */
export const CONTEXT_MENU_ITEMS = [
  {
    id: 'colour',
    label: 'Colour…',
    icon: '🎨',
    appliesTo: (kind) => kind !== 'empty',
    when: () => true,
    run(editor, target, rowEl) {
      openColorMosaic(rowEl, (hex) => {
        for (const el of target.selection) {
          const kind = pieceKindOf(el);
          if (kind) applyColorOverride(el, kind, hex);
        }
        editor.setColor(hex); // last: repaints everything (incl. contour segmentColors) in ONE commit
      });
    },
  },
  {
    id: 'cut',
    label: 'Cut here',
    icon: '✂',
    appliesTo: (kind) => kind === 'line' || kind === 'rails' || kind === 'ties',
    when: (target) => !!(target.cutIntent && target.cutIntent.action === 'cut'),
    run(editor, target) { cutAt(editor, target.cutIntent.el, target.cutIntent.at); },
  },
  {
    id: 'join',
    label: 'Join',
    icon: '🔗',
    appliesTo: (kind) => kind === 'line' || kind === 'rails' || kind === 'ties',
    when: (target) => !!(target.cutIntent && target.cutIntent.action === 'join'),
    run(editor, target) { join(editor, target.cutIntent.joint); },
  },
  {
    id: 'duplicate',
    label: 'Duplicate',
    icon: '⧉',
    appliesTo: (kind) => kind !== 'empty',
    when: () => true,
    run(editor) { copySelection(editor); pasteClipboard(editor); },
  },
  {
    id: 'select-all-kind',
    label: (target) => `Select all ${target.kind}`,
    icon: '▦',
    appliesTo: (kind) => kind === 'rails' || kind === 'ties' || kind === 'nodes',
    when: () => true,
    run(editor, target) {
      const all = editor._sketchLayer.children().toArray().filter((el) => pieceKindOf(el) === target.kind);
      editor._selectMany(all);
    },
  },
  {
    id: 'move-to-layer',
    label: 'Move to layer',
    icon: '⇄',
    // Plain elements only — a lattice-owned piece lives on its own
    // kind-layer (SE17: that layer IS its Fusion sketch), so this entry is
    // HIDDEN for it via appliesTo, not shown-and-disabled.
    appliesTo: (kind) => kind !== 'empty' && !LATTICE_OWNED_KINDS.has(kind),
    when: () => true,
    submenu(editor, target) {
      const items = (editor._layers || []).map((layer) => ({
        label: layer.name,
        run: () => _moveSelectionToLayer(editor, target.selection, layer.id),
      }));
      items.push({
        label: 'New layer…',
        run: () => {
          const layer = addLayer(editor, { skipUndo: true }); // folded into the move's own single pushState below
          _moveSelectionToLayer(editor, target.selection, layer.id);
        },
      });
      return items;
    },
  },
  {
    id: 'delete',
    label: 'Delete',
    icon: '🗑',
    appliesTo: (kind) => kind !== 'empty',
    when: () => true,
    run(editor) { editor.deleteSelected(); },
  },
  {
    id: 'paste',
    label: 'Paste',
    icon: '📋',
    appliesTo: (kind) => kind === 'empty',
    when: (target) => Array.isArray(target.editor._clipboard) && target.editor._clipboard.length > 0,
    run(editor) { pasteClipboard(editor); },
  },
  {
    id: 'select-all',
    label: 'Select all',
    icon: '▦',
    appliesTo: (kind) => kind === 'empty',
    when: () => true,
    run(editor) { selectAllVisible(editor); },
  },
  {
    id: 'fit-view',
    label: 'Fit view',
    icon: '⤢',
    appliesTo: (kind) => kind === 'empty',
    when: () => true,
    run(editor) { editor.fitView(); },
  },
];

/** The items that actually apply to `target`, in declared order. Exported
 *  for the test file (registry filtering per kind/empty/state, no DOM). */
export function matchingItems(target) {
  return CONTEXT_MENU_ITEMS.filter((item) => item.appliesTo(target.kind) && item.when(target));
}

// ─── the popover itself ─────────────────────────────────────────────────

let _openMenu = null; // { close } of the currently-open top-level menu, if any

function _clampToViewport(x, y, w, h) {
  const vw = window.innerWidth, vh = window.innerHeight;
  return { x: Math.min(Math.max(x, 4), Math.max(4, vw - w - 4)), y: Math.min(Math.max(y, 4), Math.max(4, vh - h - 4)) };
}

/** A small popover of rows at (clientX, clientY) — reuses openColorMosaic's
 *  own idioms (position:fixed on document.body, clamp to viewport, dismiss
 *  on outside mousedown / Escape) rather than a second, divergent pattern.
 *
 *  `suppressDismissUntil` (a Date.now()-style timestamp) guards against a
 *  real, spec'd browser behaviour openColorMosaic never has to: a touch
 *  sequence synthesizes a trailing compatibility mousedown/mouseup/click
 *  AFTER its own touchend, at the SAME point the finger was — when this
 *  menu opens MID-GESTURE (a hold, fired from a still-active touch, at
 *  MULTISELECT_HOLD_MS, before that touch's own touchend), the menu's own
 *  outside-mousedown dismiss listener is already registered by the time
 *  that trailing synthetic mousedown lands, closing a menu that never saw
 *  a real second interaction (confirmed live: the menu opened, matched
 *  items correctly, then was gone by the time anything queried it).
 *  Right-click's own open has no such trailing event to guard against —
 *  callers pass 0 there. */
function _buildPopover(rows, clientX, clientY, { onDismiss, suppressDismissUntil = 0 } = {}) {
  const pop = document.createElement('div');
  pop.className = 'context-menu-popover';
  pop.setAttribute('role', 'menu');
  pop.style.position = 'fixed';
  pop.style.visibility = 'hidden';
  document.body.appendChild(pop);

  let _suppressUntil = suppressDismissUntil;
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('mousedown', onOutsideMouseDown, true);
    document.removeEventListener('keydown', onKeydown, true);
    pop.remove();
    if (onDismiss) onDismiss();
  }
  function onOutsideMouseDown(e) {
    if (Date.now() < _suppressUntil) return;
    if (!pop.contains(e.target)) close();
  }
  function bumpSuppressDismiss(ms) { _suppressUntil = Math.max(_suppressUntil, Date.now() + ms); }
  function onKeydown(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  for (const row of rows) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'context-menu-row';
    btn.setAttribute('role', 'menuitem');
    if (row.icon) {
      const iconEl = document.createElement('span');
      iconEl.className = 'context-menu-row-icon';
      iconEl.textContent = row.icon;
      btn.appendChild(iconEl);
    }
    const labelEl = document.createElement('span');
    labelEl.className = 'context-menu-row-label';
    labelEl.textContent = row.label;
    btn.appendChild(labelEl);
    if (row.hasSubmenu) {
      const caret = document.createElement('span');
      caret.className = 'context-menu-row-caret';
      caret.textContent = '▸';
      btn.appendChild(caret);
    }
    btn.addEventListener('click', (e) => { e.stopPropagation(); row.onSelect(btn); });
    pop.appendChild(btn);
  }

  const rect = pop.getBoundingClientRect();
  const { x, y } = _clampToViewport(clientX, clientY, rect.width, rect.height);
  pop.style.left = `${x}px`;
  pop.style.top = `${y}px`;
  pop.style.visibility = '';

  document.addEventListener('mousedown', onOutsideMouseDown, true);
  document.addEventListener('keydown', onKeydown, true);
  return { close, el: pop, bumpSuppressDismiss };
}

/** Opens the top-level context menu for `target` at (clientX, clientY).
 *  Closes any menu already open first (a second hold/right-click replaces
 *  it, never stacks). `suppressDismissUntil` — see _buildPopover's own doc
 *  comment — is passed straight through from a touch-hold's fire time. */
export function openContextMenu(editor, target, clientX, clientY, suppressDismissUntil = 0) {
  if (_openMenu) { _openMenu.close(); _openMenu = null; }
  const items = matchingItems(target);
  if (items.length === 0) return null;

  const rows = items.map((item) => ({
    label: typeof item.label === 'function' ? item.label(target) : item.label,
    icon: item.icon,
    hasSubmenu: typeof item.submenu === 'function',
    onSelect(rowEl) {
      if (typeof item.submenu === 'function') {
        const subRows = item.submenu(editor, target).map((sub) => ({
          label: sub.label,
          onSelect() { menu.close(); sub.run(); },
        }));
        const subRect = rowEl.getBoundingClientRect();
        const sub = _buildPopover(subRows, subRect.right, subRect.top);
        // The submenu closing (pick or outside-click/Escape) also closes
        // the parent — one committed action ends the whole menu, matching
        // openColorMosaic's own "a pick closes the popover" contract.
        const origClose = sub.close;
        sub.close = () => { origClose(); menu.close(); };
        return;
      }
      menu.close();
      item.run(editor, target, rowEl);
    },
  }));

  const menu = _buildPopover(rows, clientX, clientY, {
    onDismiss: () => { if (_openMenu === menu) _openMenu = null; },
    suppressDismissUntil,
  });
  _openMenu = menu;
  return menu;
}

// ─── touch hold-to-menu gesture ─────────────────────────────────────────
// Mirrors editor-multiselect-gesture.js's own arm/cancel shape exactly —
// see this file's own doc comment for why the two stay separate timers
// that never both fire for the same press (armContextMenuHold is only
// ever called from the "fresh press" tail of each selection call site,
// i.e. only when armMultiSelectPress has already returned false for that
// SAME press).

let _armed = null; // { editor, target, clientX, clientY, timer }
// The one menu-open still waiting to see ITS OWN opening touch's release —
// see openContextMenu's own suppressDismissUntil doc comment. One-shot:
// consumed by the very next cancelContextMenuHold() call (that release),
// never re-armed by a later, unrelated pointerup.
let _awaitingHoldRelease = null;

export function armContextMenuHold(editor, target, e) {
  cancelContextMenuHold();
  if (editor._pointerType !== 'touch') return; // desktop: right-click only, see bindContextMenu
  _armed = {
    editor, clientX: e.clientX, clientY: e.clientY,
    timer: setTimeout(() => _fireContextMenuHold(target), MULTISELECT_HOLD_MS),
  };
}

function _fireContextMenuHold(target) {
  if (!_armed) return;
  const { editor, clientX, clientY } = _armed;
  _armed = null;
  target.editor = editor;
  target.selection = (editor._selectedElements || []).slice();
  target.cutIntent = target.point ? cutIntent(editor, target.point) : null;
  // A hold that fires never moved (cancelContextMenuHoldIfMoved would have
  // cancelled it otherwise) and should never drag — same neutralization
  // H5's own _fireHold applies, so lifting the finger afterward does
  // nothing further underneath the now-open menu.
  editor._isDragging = false;
  editor._isDrawing = false;
  editor._latticeMove = null;
  // Suppress the popover's own outside-mousedown dismiss for a moment from
  // OPEN time too — covers a release that lands almost immediately (before
  // the pointerup handler even runs cancelContextMenuHold below).
  const menu = openContextMenu(editor, target, clientX, clientY, Date.now() + 500);
  if (menu) _awaitingHoldRelease = menu;
}

export function cancelContextMenuHoldIfMoved(e) {
  if (!_armed) return;
  const threshold = inputProfileFor(_armed.editor._pointerType).clickThresholdPx;
  const dist = Math.hypot(e.clientX - _armed.clientX, e.clientY - _armed.clientY);
  if (dist > threshold) cancelContextMenuHold();
}

export function cancelContextMenuHold() {
  if (_armed) { clearTimeout(_armed.timer); _armed = null; }
  // The real fix for the trailing-compat-mousedown race (see
  // openContextMenu's own doc comment): THIS pointerup is the opening
  // touch's own release, whenever it actually happens — bump the
  // suppression window to start counting from right now instead of
  // guessing a duration from open time. One-shot; a later, unrelated
  // pointerup (e.g. tapping a row, or tapping outside on purpose) never
  // re-triggers this.
  if (_awaitingHoldRelease) { _awaitingHoldRelease.bumpSuppressDismiss(400); _awaitingHoldRelease = null; }
}

// ─── desktop right-click ────────────────────────────────────────────────

/** Registers the canvas's own `contextmenu` suppression + menu-open, once,
 *  from initInteraction — scoped to `svgNode` alone (never `document`), so
 *  the separate 3D preview canvas's own unrelated contextmenu handling
 *  (core/preview/index.js) is untouched. */
export function bindContextMenu(editor, svgNode) {
  svgNode.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const sel = editor._selectedElements || [];
    const primary = sel.length ? sel[sel.length - 1] : null;
    const point = editor._getMousePoint(e);
    const target = {
      editor, point,
      kind: targetKindOf(primary),
      el: primary,
      selection: sel.slice(),
      cutIntent: primary ? cutIntent(editor, point) : null,
    };
    openContextMenu(editor, target, e.clientX, e.clientY);
  });
}

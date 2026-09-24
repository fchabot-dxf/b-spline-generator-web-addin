/**
 * SE9 / T28: the declared color palette for the per-element color control.
 * VECTOR_COLORS is declared as ROWS (one row per hue, 4 shades each) so
 * the toolbar's dropdown mosaic lays its cells out straight from this
 * data — never a second hand-typed grid to drift from it. 8 hues x 4
 * shades = 32 swatches. Fred's own piece (black/red/yellow/navy) is kept
 * verbatim inside the grid rather than bolted on separately: red
 * '#c62828' and yellow '#f9c80e' are each their hue row's own base shade,
 * navy '#1a237e' is the Blue row's darkest shade, black '#000000' is the
 * Neutral row's darkest shade.
 */
export const VECTOR_COLORS = [
  ['#ef9a9a', '#e53935', '#c62828', '#7f0000'], // Red
  ['#ffcc80', '#fb8c00', '#ef6c00', '#c43e00'], // Orange
  ['#fff59d', '#ffd600', '#f9c80e', '#b28704'], // Yellow
  ['#a5d6a7', '#66bb6a', '#2e7d32', '#1b5e20'], // Green
  ['#80cbc4', '#26a69a', '#00796b', '#004d40'], // Teal
  ['#90caf9', '#42a5f5', '#1565c0', '#1a237e'], // Blue
  ['#ce93d8', '#ab47bc', '#6a1b9a', '#4a148c'], // Purple
  ['#ffffff', '#bdbdbd', '#616161', '#000000'], // Neutral
];

/** T28: the color mosaic's "recent" row — last RECENT_COLORS_CAP colors
 *  picked, per-viewer, most-recent-first, deduped (re-picking a color
 *  already in the list moves it to front rather than repeating it). Same
 *  load/merge/save split as editor-grid.js's grid prefs (mergeGridPrefs):
 *  mergeRecentColors is pure so the ordering/cap logic is testable
 *  without mocking localStorage. */
const RECENT_COLORS_KEY = 'bsg.editorRecentColors';
export const RECENT_COLORS_CAP = 4;

export function mergeRecentColors(existing, hex) {
  const rest = (Array.isArray(existing) ? existing : []).filter((c) => c !== hex);
  if (!hex) return rest.slice(0, RECENT_COLORS_CAP);
  return [hex, ...rest].slice(0, RECENT_COLORS_CAP);
}

export function loadRecentColors() {
  try {
    const raw = localStorage.getItem(RECENT_COLORS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.slice(0, RECENT_COLORS_CAP) : [];
  } catch (_) {
    return [];
  }
}

export function saveRecentColors(list) {
  try { localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(list)); } catch (_) {}
}

/** Load, merge `hex` in, save, and return the updated list — the one
 *  call properties-shape.js makes after every pick (mosaic cell, recent
 *  cell, or the native custom picker). */
export function addRecentColor(hex) {
  const updated = mergeRecentColors(loadRecentColors(), hex);
  saveRecentColors(updated);
  return updated;
}

/**
 * SE7g AMEND: the color mosaic popover itself, extracted from properties-
 * shape.js's own T28 color control so the Lattice panel's per-kind
 * Colors row (Rails/Ties/Nodes swatches) can reuse the EXACT SAME picker
 * instead of a second, hand-rolled one. Builds a floating popover
 * (VECTOR_COLORS' 8x4 grid + a "recent" row + "Custom…") anchored under/
 * near `anchorEl`, and calls `onPick(hex)` on any pick — a mosaic cell, a
 * recent cell, or the custom native color input's own 'change'. Recording
 * into the recent-colors list happens HERE, once, for every caller
 * (recent colors are a page-wide concern, not specific to which target
 * just got colored).
 *
 * `opts.customInput`: an EXISTING `<input type="color">` to delegate
 * "Custom…" to. properties-shape.js passes its own `#editorColor`, which
 * already has its own permanent 'change' listener doing
 * `editor.setColor`/`addRecentColor`/`syncColorToggleSwatch` — so this
 * function does NOT also attach a listener to a supplied `customInput`
 * (that would double-fire); it only clicks it, unchanged from what the
 * pre-extraction code did. Omitted (the Lattice panel's case — no
 * existing input to reuse), a temporary hidden `<input type="color">` is
 * created, wired to call `onPick` itself, and torn down after one use.
 *
 * `opts.onClose`: called once whenever the popover closes for ANY reason
 * (a pick, Escape, an outside click, or the caller's own `close()`) — so
 * a caller tracking "is my popover open" (to toggle-close on a second
 * click of the same anchor button, T28's own original behavior) can keep
 * that flag in sync without polling.
 *
 * @returns {{close: () => void}} closes the popover programmatically.
 */
export function openColorMosaic(anchorEl, onPick, opts = {}) {
  const { customInput, onClose } = opts;
  let popover = null;

  function closePopover() {
    if (!popover) return;
    document.removeEventListener('mousedown', onOutsideMouseDown, true);
    document.removeEventListener('keydown', onPopoverKeydown, true);
    popover.remove();
    popover = null;
    anchorEl.setAttribute('aria-expanded', 'false');
    if (onClose) onClose();
  }

  function onOutsideMouseDown(e) {
    if (popover && !popover.contains(e.target) && e.target !== anchorEl) closePopover();
  }

  function onPopoverKeydown(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    closePopover();
    anchorEl.focus();
  }

  const pick = (hex) => {
    addRecentColor(hex);
    onPick(hex);
    closePopover();
    anchorEl.focus();
  };

  // Roving tabindex over the 8-row x 4-col grid (VECTOR_COLORS' own
  // shape) — arrow keys move, Enter/Space picks (reuses the cell's own
  // click handler so there's one pick path, not two).
  function onGridKeydown(e, cells) {
    const cols = VECTOR_COLORS[0].length;
    const idx = cells.indexOf(document.activeElement);
    if (idx === -1) return;
    let next = idx;
    if (e.key === 'ArrowRight') next = Math.min(idx + 1, cells.length - 1);
    else if (e.key === 'ArrowLeft') next = Math.max(idx - 1, 0);
    else if (e.key === 'ArrowDown') next = Math.min(idx + cols, cells.length - 1);
    else if (e.key === 'ArrowUp') next = Math.max(idx - cols, 0);
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cells[idx].click(); return; }
    else return;
    e.preventDefault();
    if (next === idx) return;
    cells[idx].tabIndex = -1;
    cells[next].tabIndex = 0;
    cells[next].focus();
  }

  function makeSwatchCell(hex, tabIndex) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'color-mosaic-cell';
    cell.style.background = hex;
    cell.title = hex;
    cell.setAttribute('aria-label', hex);
    cell.tabIndex = tabIndex;
    cell.addEventListener('click', () => pick(hex));
    return cell;
  }

  function buildGrid() {
    const grid = document.createElement('div');
    grid.className = 'color-mosaic-grid';
    grid.setAttribute('role', 'listbox');
    grid.setAttribute('aria-label', 'Color palette');
    let first = true;
    for (const row of VECTOR_COLORS) {
      for (const hex of row) {
        grid.appendChild(makeSwatchCell(hex, first ? 0 : -1));
        first = false;
      }
    }
    const cells = Array.from(grid.querySelectorAll('.color-mosaic-cell'));
    grid.addEventListener('keydown', (e) => onGridKeydown(e, cells));
    return grid;
  }

  function buildRecentRow() {
    const recent = loadRecentColors();
    if (recent.length === 0) return null;
    const row = document.createElement('div');
    row.className = 'color-mosaic-recent';
    const label = document.createElement('span');
    label.className = 'color-mosaic-label';
    label.textContent = 'Recent';
    row.appendChild(label);
    for (const hex of recent) row.appendChild(makeSwatchCell(hex, -1));
    return row;
  }

  function buildPopover() {
    const pop = document.createElement('div');
    pop.className = 'color-mosaic-popover';
    pop.appendChild(buildGrid());
    const recentRow = buildRecentRow();
    if (recentRow) pop.appendChild(recentRow);
    const customBtn = document.createElement('button');
    customBtn.type = 'button';
    customBtn.className = 'color-mosaic-custom';
    customBtn.textContent = 'Custom…';
    customBtn.addEventListener('click', () => {
      closePopover();
      if (customInput) {
        customInput.click();
        return;
      }
      const tempInput = document.createElement('input');
      tempInput.type = 'color';
      tempInput.style.position = 'fixed';
      tempInput.style.opacity = '0';
      tempInput.style.pointerEvents = 'none';
      document.body.appendChild(tempInput);
      const cleanup = () => { if (tempInput.isConnected) tempInput.remove(); };
      tempInput.addEventListener('change', () => { pick(tempInput.value); cleanup(); }, { once: true });
      tempInput.addEventListener('blur', cleanup, { once: true });
      tempInput.click();
    });
    pop.appendChild(customBtn);
    return pop;
  }

  // Keep the popover inside the viewport (T28's own "390px" requirement):
  // default below-left of the anchor, flip above if it would overflow the
  // bottom, clamp left if it would overflow the right — getBoundingClientRect/
  // innerWidth/innerHeight are viewport-relative regardless of any
  // overflow:hidden ancestor, which is exactly why the popover is appended
  // to document.body (position:fixed) rather than inside the anchor's own
  // container — anything appended there would be clipped instead of floating.
  function positionPopover() {
    const rect = anchorEl.getBoundingClientRect();
    const margin = 8;
    const pw = popover.offsetWidth;
    const ph = popover.offsetHeight;
    let left = rect.left;
    let top = rect.bottom + 4;
    if (left + pw + margin > window.innerWidth) left = Math.max(margin, window.innerWidth - pw - margin);
    if (top + ph + margin > window.innerHeight) top = Math.max(margin, rect.top - ph - 4);
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
  }

  popover = buildPopover();
  document.body.appendChild(popover);
  positionPopover();
  anchorEl.setAttribute('aria-expanded', 'true');
  document.addEventListener('mousedown', onOutsideMouseDown, true);
  document.addEventListener('keydown', onPopoverKeydown, true);
  const firstCell = popover.querySelector('.color-mosaic-cell');
  if (firstCell) firstCell.focus();

  return { close: closePopover };
}

import { el, on } from './dom.js';
import { GRID_SPACINGS } from './editor-grid.js';
import { ELEMENT_CAPS } from './editor-hit.js';
import { VECTOR_COLORS, addRecentColor, loadRecentColors } from './editor-color.js';

export function initShapeProperties(editor) {
  const strokeNum = el('editorStrokeWidth');
  const minusBtn = el('editorStrokeWidthMinus');
  const plusBtn = el('editorStrokeWidthPlus');
  if (!strokeNum) return;

  const syncStroke = (value) => {
    const numeric = parseFloat(value);
    if (Number.isNaN(numeric)) return;
    const clamped = Math.max(0, Math.min(5, numeric));
    strokeNum.value = clamped;
    editor.setStrokeWidth(clamped);
  };

  // SE8a / SA-UNDO-2: setStrokeWidth now pushes an undo step on every
  // call (see editor.js's _commitStyleChange) — 'input' fires per
  // keystroke while typing a number, which would turn one intended edit
  // into several undo steps. 'change' fires once, on blur/Enter, so
  // typing "2.5" commits as ONE step. The +/- buttons already fire once
  // per click either way, so they're unaffected.
  on(strokeNum, 'change', () => syncStroke(strokeNum.value));
  on(minusBtn, 'click', () => syncStroke(parseFloat(strokeNum.value) - 0.1));
  on(plusBtn, 'click', () => syncStroke(parseFloat(strokeNum.value) + 0.1));

  initFillModeToggle(editor);
  initColorControl(editor);
  initGridToggle(editor);
}

/** T28: sync the color toolbar's toggle-button swatch to a hex value —
 *  the one place that visual update happens, called from initColorControl
 *  below AND from editor-ui.js's _afterSelectionChange (selecting an
 *  element reflects ITS color back into the toolbar, same behavior the
 *  old native `<input type="color">` gave for free just by being the
 *  visible control; the toggle button needs this explicit sync since
 *  programmatic `.value =` writes on the now-hidden input fire no event
 *  to hook). */
export function syncColorToggleSwatch(hex) {
  if (!hex) return;
  const swatch = el('editorColorToggleSwatch');
  if (swatch) swatch.style.background = hex;
}

/**
 * Wire the COLOR control (SE9 / T28): a toolbar BUTTON showing the
 * current color, opening a popover mosaic — VECTOR_COLORS' declared 8x4
 * grid, a "recent" row (last colors picked this session), and
 * "custom...". The native `<input type="color">` (#editorColor) stays in
 * the DOM, now visually hidden: it's still what the popover's
 * "custom..." button opens, and still the read-back target
 * editor-ui.js's _afterSelectionChange writes to on every selection
 * change (unchanged there beyond the syncColorToggleSwatch call above).
 * Every pick — mosaic cell, recent cell, or the custom picker's 'change'
 * — calls editor.setColor() on a discrete commit (one undo step, SE9)
 * and records the color into the recent list.
 */
function initColorControl(editor) {
  const colorInput = el('editorColor');
  const toggleBtn = el('editorColorToggle');
  if (!colorInput && !toggleBtn) return;

  if (colorInput) {
    colorInput.value = editor._color || '#000000';
    syncColorToggleSwatch(colorInput.value);
    on(colorInput, 'change', () => {
      editor.setColor(colorInput.value);
      syncColorToggleSwatch(colorInput.value);
      addRecentColor(colorInput.value);
    });
  }

  if (!toggleBtn) return;

  let popover = null;

  const pick = (hex) => {
    editor.setColor(hex);
    if (colorInput) colorInput.value = hex;
    syncColorToggleSwatch(hex);
    addRecentColor(hex);
    closePopover();
    toggleBtn.focus();
  };

  function onOutsideMouseDown(e) {
    if (popover && !popover.contains(e.target) && e.target !== toggleBtn) closePopover();
  }

  function onPopoverKeydown(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    closePopover();
    toggleBtn.focus();
  }

  function closePopover() {
    if (!popover) return;
    document.removeEventListener('mousedown', onOutsideMouseDown, true);
    document.removeEventListener('keydown', onPopoverKeydown, true);
    popover.remove();
    popover = null;
    toggleBtn.setAttribute('aria-expanded', 'false');
  }

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
      if (colorInput) colorInput.click();
    });
    pop.appendChild(customBtn);
    return pop;
  }

  // Keep the popover inside the viewport (T28's own "390px" requirement):
  // default below-left of the toggle button, flip above if it would
  // overflow the bottom, clamp left if it would overflow the right —
  // getBoundingClientRect/innerWidth/innerHeight are viewport-relative
  // regardless of the toolbar's own overflow:hidden ancestor, which is
  // exactly why the popover is appended to document.body (position:fixed)
  // rather than inside #editorColorGroup — anything appended there would
  // be clipped instead of floating.
  function positionPopover() {
    const rect = toggleBtn.getBoundingClientRect();
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

  function openPopover() {
    popover = buildPopover();
    document.body.appendChild(popover);
    positionPopover();
    toggleBtn.setAttribute('aria-expanded', 'true');
    document.addEventListener('mousedown', onOutsideMouseDown, true);
    document.addEventListener('keydown', onPopoverKeydown, true);
    const firstCell = popover.querySelector('.color-mosaic-cell');
    if (firstCell) firstCell.focus();
  }

  toggleBtn.setAttribute('aria-haspopup', 'true');
  toggleBtn.setAttribute('aria-expanded', 'false');
  on(toggleBtn, 'click', (e) => {
    e.stopPropagation();
    if (popover) closePopover(); else openPopover();
  });
}

/**
 * Wire the Stroke / Fill / Both toggle (BUG-27). Stores the user's
 * choice on editor._fillMode and re-applies the style to the current
 * selection so the user gets immediate feedback on a selected shape.
 *
 * New shapes drawn after the toggle change pick up the active mode in
 * createDrawingShape (editor-interaction.js).
 */
function initFillModeToggle(editor) {
  const buttons = {
    stroke: el('editorFillModeStroke'),
    fill:   el('editorFillModeFill'),
    both:   el('editorFillModeBoth'),
  };
  if (!buttons.stroke && !buttons.fill && !buttons.both) return;

  const setActive = (mode) => {
    editor._fillMode = mode;
    for (const [m, btn] of Object.entries(buttons)) {
      if (!btn) continue;
      // .editor-fillmode-btn.active (styles/base.css, SE3b) is the only
      // source of the active look now — no inline style here.
      btn.classList.toggle('active', m === mode);
    }
    _applyFillModeToSelection(editor, mode);
  };

  if (buttons.stroke) on(buttons.stroke, 'click', () => setActive('stroke'));
  if (buttons.fill)   on(buttons.fill,   'click', () => setActive('fill'));
  if (buttons.both)   on(buttons.both,   'click', () => setActive('both'));

  // Initial state — reflect editor._fillMode default.
  setActive(editor._fillMode || 'stroke');
}

/** Read back an element's OWN current color (SE9): whichever of its
 *  stroke/fill is currently real (not 'none'), preferring stroke. Falls
 *  back to `fallback` for an element with neither (shouldn't normally
 *  happen). Used by _applyFillModeToSelection so a mode toggle re-paints
 *  each element in ITS OWN color, not the toolbar's global editor._color
 *  — otherwise a multi-colored selection would collapse to one color the
 *  instant FILL/STROKE/BOTH is clicked. */
export function _currentElementColor(elNode, fallback) {
  try {
    const stroke = elNode.attr('stroke');
    if (stroke && stroke !== 'none') return stroke;
    const fill = elNode.attr('fill');
    if (fill && fill !== 'none') return fill;
  } catch (_) { /* defensive */ }
  return fallback;
}

/** Apply the current fill mode to every element in the selection. */
export function _applyFillModeToSelection(editor, mode) {
  const sel = (editor._selectedElements || []).slice();
  if (sel.length === 0 && editor._selectedElement) sel.push(editor._selectedElement);
  if (sel.length === 0) return;

  const strokeWidth = editor._strokeWidth ?? 0.5;

  for (const elNode of sel) {
    if (!elNode || typeof elNode.fill !== 'function' || typeof elNode.stroke !== 'function') continue;
    // SE8c / SA-DECL-4: ELEMENT_CAPS[type].fill replaces the inline
    // `type === 'line'` check — <line> is still the only non-fillable
    // kind (ELEMENT_CAPS.line.fill === false), just declared once instead
    // of re-typed here; `?? true` matches the old check's implicit
    // "anything that isn't 'line' is fillable" default for any type not
    // in the table.
    const fillable = ELEMENT_CAPS[elNode.type]?.fill ?? true;
    const color = _currentElementColor(elNode, editor._color);
    try {
      if (mode === 'stroke') {
        if (fillable) elNode.fill('none');
        elNode.stroke({ color, width: strokeWidth });
      } else if (mode === 'fill') {
        if (fillable) {
          elNode.fill(color);
          elNode.stroke({ color: 'none', width: 0 });
        } else {
          elNode.stroke({ color, width: strokeWidth });
        }
      } else { // both
        if (fillable) elNode.fill(color);
        elNode.stroke({ color, width: strokeWidth });
      }
    } catch (_) { /* defensive: bad element shouldn't crash the toggle */ }
  }
  if (typeof editor.pushState === 'function') {
    try { editor.pushState(); } catch (_) {}
  }
  if (editor._onChange) { try { editor._onChange(); } catch (_) {} }
}

/** Format a spacing value (inches) as a fraction label, e.g. 0.25 -> '1/4"'.
 *  Whole numbers show as-is (1 -> '1"'). Reduces via GCD over a power-of-
 *  two denominator rather than a hardcoded lookup, so a future addition
 *  to GRID_SPACINGS formats for free as long as it's a clean fraction. */
function formatSpacingLabel(value) {
  if (Number.isInteger(value)) return `${value}"`;
  let denom = 1;
  while (!Number.isInteger(value * denom)) denom *= 2;
  let numer = Math.round(value * denom);
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(numer, denom);
  numer /= g; denom /= g;
  return `${numer}/${denom}"`;
}

/**
 * Wire the GRID toolbar group (SE6): SHOW/SNAP toggles + spacing select.
 * Same shape as initFillModeToggle above — editor.setGrid() is the one
 * place that mutates the record, persists it, and redraws, so this module
 * only needs to reflect state back onto the buttons.
 */
function initGridToggle(editor) {
  const showBtn = el('editorGridShow');
  const snapBtn = el('editorGridSnap');
  const spacingSelect = el('editorGridSpacing');
  // SE7n: AUTO NODES bound HERE, in the same module as SHOW/SNAP, per the
  // dispatch's own instruction — its file-list line named editor-ui.js,
  // but SHOW/SNAP have lived in this file (properties-shape.js) since
  // SE6, not editor-ui.js; followed the explicit "same module" build
  // instruction over the file list.
  const autoNodesBtn = el('editorAutoNodes');
  if (!showBtn && !snapBtn && !spacingSelect && !autoNodesBtn) return;

  const syncButtons = () => {
    if (showBtn) showBtn.classList.toggle('active', !!editor._grid.visible);
    if (snapBtn) snapBtn.classList.toggle('active', !!editor._grid.snap);
    if (autoNodesBtn) autoNodesBtn.classList.toggle('active', !!editor._lattice.autoNodes);
  };

  if (spacingSelect) {
    spacingSelect.innerHTML = '';
    for (const spacing of GRID_SPACINGS) {
      const opt = document.createElement('option');
      opt.value = String(spacing);
      opt.textContent = formatSpacingLabel(spacing);
      spacingSelect.appendChild(opt);
    }
    spacingSelect.value = String(editor._grid.spacing);
  }

  if (showBtn) on(showBtn, 'click', () => { editor.setGrid({ visible: !editor._grid.visible }); syncButtons(); });
  if (snapBtn) on(snapBtn, 'click', () => { editor.setGrid({ snap: !editor._grid.snap }); syncButtons(); });
  if (spacingSelect) on(spacingSelect, 'change', () => {
    const spacing = parseFloat(spacingSelect.value);
    if (!Number.isNaN(spacing)) editor.setGrid({ spacing });
  });
  // Not persisted (unlike _grid) — LATTICE_DEFAULTS.autoNodes is already
  // true, and the dispatch names no load/save pair for it, so a plain
  // mutation matches the shape it was declared with in SE7a.
  if (autoNodesBtn) on(autoNodesBtn, 'click', () => {
    editor._lattice.autoNodes = !editor._lattice.autoNodes;
    syncButtons();
  });

  syncButtons();
}

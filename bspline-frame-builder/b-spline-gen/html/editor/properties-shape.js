import { el, on } from './dom.js';
import { GRID_SPACINGS } from './editor-grid.js';
import { ELEMENT_CAPS } from './editor-hit.js';

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
  initGridToggle(editor);
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

/** Apply the current fill mode to every element in the selection. */
function _applyFillModeToSelection(editor, mode) {
  const sel = (editor._selectedElements || []).slice();
  if (sel.length === 0 && editor._selectedElement) sel.push(editor._selectedElement);
  if (sel.length === 0) return;

  const fillColor = editor._fillColor || editor._strokeColor || '#000000';
  const strokeColor = editor._strokeColor || '#000000';
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
    try {
      if (mode === 'stroke') {
        if (fillable) elNode.fill('none');
        elNode.stroke({ color: strokeColor, width: strokeWidth });
      } else if (mode === 'fill') {
        if (fillable) {
          elNode.fill(fillColor);
          elNode.stroke({ color: 'none', width: 0 });
        } else {
          elNode.stroke({ color: strokeColor, width: strokeWidth });
        }
      } else { // both
        if (fillable) elNode.fill(fillColor);
        elNode.stroke({ color: strokeColor, width: strokeWidth });
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

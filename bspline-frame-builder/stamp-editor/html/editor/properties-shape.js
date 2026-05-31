import { el, on } from './dom.js';

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

  on(strokeNum, 'input', () => syncStroke(strokeNum.value));
  on(minusBtn, 'click', () => syncStroke(parseFloat(strokeNum.value) - 0.1));
  on(plusBtn, 'click', () => syncStroke(parseFloat(strokeNum.value) + 0.1));

  initFillModeToggle(editor);
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
      const isActive = m === mode;
      btn.classList.toggle('active', isActive);
      btn.style.background = isActive ? '#e8f0ff' : 'transparent';
      btn.style.color = isActive ? '#1a55b8' : '#555';
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
    // <line> elements can't be filled meaningfully — skip the fill side
    // but still let the stroke change through.
    const isLine = (elNode.type === 'line');
    try {
      if (mode === 'stroke') {
        if (!isLine) elNode.fill('none');
        elNode.stroke({ color: strokeColor, width: strokeWidth });
      } else if (mode === 'fill') {
        if (!isLine) {
          elNode.fill(fillColor);
          elNode.stroke({ color: 'none', width: 0 });
        } else {
          elNode.stroke({ color: strokeColor, width: strokeWidth });
        }
      } else { // both
        if (!isLine) elNode.fill(fillColor);
        elNode.stroke({ color: strokeColor, width: strokeWidth });
      }
    } catch (_) { /* defensive: bad element shouldn't crash the toggle */ }
  }
  if (typeof editor.pushState === 'function') {
    try { editor.pushState(); } catch (_) {}
  }
  if (editor._onChange) { try { editor._onChange(); } catch (_) {} }
}

/**
 * editor-ui.js - Mode management, toolbar sync, and selection highlights for VectorEditor.
 */
import { el as getEl, queryAll, query } from './dom.js';
import { worldBbox } from './editor-coords.js';
import { fusLog } from '../core/fusion-bridge.js';
import { getElementLayer, setActiveLayer as _setActiveLayer } from './layers.js';

// Per-mode help text shown in the floating status hint at the bottom of the
// editor canvas. Keeps the lessons-learned messages out of the toolbar so the
// affordance is visible without hover. See BUG-02 and BUG-06.
const MODE_HINTS = {
  select: 'Select — click a shape to pick it up, drag to move. Hold Shift for additional…',
  node:   'Nodes — click a shape to edit its anchor points. Drag the diamond handles to reshape.',
  draw:   'Pen — Click to place anchors (double-click or Enter to commit, Esc to cancel). Or drag to freehand.',
  text:   'Text — click on the canvas to start typing. Drag the text to move it.',
  line:   'Line — drag from start to end. Hold Shift to constrain angles.',
  rect:   'Rectangle — drag from one corner to the opposite corner.',
  circle: 'Circle — drag from center outward.',
  expand: 'Expand — use the Detail input + EXPAND button in the top bar to offset/outline your paths.',
  erase:  'Eraser — drag through shapes to cut them. Filled shapes get clipped; open strokes split at the cut (endcaps preserved). Width follows the stroke width.',
};

// Anchor-mode hint replaces the pen mode hint while the user is actively
// placing anchor points; toggled from editor-interaction.js.
export const ANCHOR_HINT = 'Pen (anchor mode) — keep clicking to add points • Double-click or Enter to commit • Esc to cancel';

/** Restore the default hint for the editor's current mode. Useful when
 *  the pen tool exits anchor mode (cancel/commit) but stays in 'draw'. */
export function restoreModeHint(editor) {
  setEditorStatusHint(MODE_HINTS[editor._currentMode] || '');
}

// ─── Expand onboarding callout (BUG-06) ────────────────────────────────
//
// Shows a one-time pointer at the Expand tool after the user finishes
// drawing their first shape. Dismissal (either explicit via the "Got it"
// button OR implicit when the user enters Expand mode) is persisted in
// localStorage so it never re-appears for that browser profile.

const EXPAND_CALLOUT_KEY = 'bspline.editor.expandCalloutDismissed';

function _isExpandCalloutDismissed() {
  try { return localStorage.getItem(EXPAND_CALLOUT_KEY) === '1'; }
  catch (_) { return false; }
}

function _markExpandCalloutDismissed() {
  try { localStorage.setItem(EXPAND_CALLOUT_KEY, '1'); } catch (_) {}
}

/** Hide the Expand-tool onboarding callout, optionally persisting the
 *  dismissal so it won't show again in future sessions. */
export function dismissExpandCallout({ persist = true } = {}) {
  const el = document.getElementById('editorExpandCallout');
  if (el) el.style.display = 'none';
  if (persist) _markExpandCalloutDismissed();
}

/** Show the Expand-tool onboarding callout once, after the user finishes
 *  their first stroke. No-op if the user has dismissed it before, or if
 *  they're already in expand mode (where it would just be redundant). */
export function maybeShowExpandCallout(editor) {
  if (_isExpandCalloutDismissed()) return;
  if (editor && editor._currentMode === 'expand') return;
  const el = document.getElementById('editorExpandCallout');
  if (!el) return;
  el.style.display = 'block';
  // Wire dismiss button once (idempotent — we re-look-up the button
  // each call but only attach the listener the first time via a marker).
  const btn = document.getElementById('editorExpandCalloutDismiss');
  if (btn && !btn.dataset.wired) {
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => dismissExpandCallout({ persist: true }));
  }
}

/** Set the editor status-hint text. Called by setMode + anchor-mode helpers. */
export function setEditorStatusHint(text) {
  const hint = document.getElementById('editorStatusHint');
  if (!hint) return;
  if (text == null || text === '') {
    hint.style.display = 'none';
    hint.textContent = '';
  } else {
    hint.style.display = 'block';
    hint.textContent = text;
  }
}

export function setMode(editor, mode) {
    const wasDrawing = !!editor._isDrawing;
    const wasEditingText = !!editor._editingTextEl;
    try { fusLog(`[STROKE] setMode  from=${editor._currentMode}  to=${mode}  wasDrawing=${wasDrawing}  wasEditingText=${wasEditingText}  hasCurrentPath=${!!editor._currentPath}`); } catch (_) {}
    if (editor._editingTextEl) editor._commitText();
    if (editor._isDrawing) editor._cancelDrawing();
    
    editor._currentMode = mode;
    updateToolbarVisibility(editor, mode, editor._selectedElement);

    // Update active class on buttons
    const btns = queryAll('.editor-sidebar .tool-btn');
    btns.forEach(btn => {
        btn.classList.toggle('active', btn.id === `tool${mode.charAt(0).toUpperCase() + mode.slice(1)}`);
        // Special case for Draw mode (toolDraw)
        if (mode === 'draw' && btn.id === 'toolDraw') btn.classList.add('active');
        // Special case for Select mode (toolSelect)
        if (mode === 'select' && btn.id === 'toolSelect') btn.classList.add('active');
        // Special case for Node mode (toolNode)
        if (mode === 'node' && btn.id === 'toolNode') btn.classList.add('active');
    });

    const container = getEl('editorSVGContainer');
    if (container) {
        container.classList.remove('mode-select', 'mode-draw', 'mode-line', 'mode-text', 'mode-circle', 'mode-rect', 'mode-node');
        container.classList.add(`mode-${mode}`);
    }

    // Restore handles refresh on mode switch
    editor._updateHandles();
    editor._updateSelectionHighlight();

    // Update the floating status hint at the bottom of the canvas so users
    // can see what the current tool does without hunting for tooltips.
    setEditorStatusHint(MODE_HINTS[mode] || '');

    // If the user just entered Expand mode, the Expand-discovery callout
    // (BUG-06) has served its purpose — hide it and persist the dismissal
    // so we don't shove it back at them next time they draw a shape.
    if (mode === 'expand') dismissExpandCallout({ persist: true });
}

export function updateToolbarVisibility(editor, mode, el) {
    const isTextMode = mode === 'text' || (el && el.type === 'text');
    
    const fontGroup = getEl('editorFontGroup');
    const expandGroup = getEl('editorExpandGroup');
    const symbolToggle = getEl('editorSymbolKeyboardToggle');
    const divider = query('.property-divider');
    const strokeGroup = getEl('editorStrokeGroup');

    const isExpandMode = mode === 'expand';

    if (fontGroup) fontGroup.classList.toggle('hidden', !isTextMode);
    if (expandGroup) expandGroup.classList.toggle('hidden', !isExpandMode);
    if (symbolToggle) symbolToggle.classList.toggle('hidden', !isTextMode);
    if (divider) divider.classList.toggle('hidden', !isTextMode && !isExpandMode);
    
    // Hide stroke group in expand mode (no room) and text mode (text uses
    // fill, not stroke — the stroke input doesn't apply).
    if (strokeGroup) strokeGroup.classList.toggle('hidden', isExpandMode || isTextMode);
    
    const selectPanel = getEl('editorSelectPanel');
    
    // Selection details logic
    if (selectPanel) {
        const hasSelection = el || (editor._selectedNodes && editor._selectedNodes.length > 0);
        selectPanel.classList.toggle('hidden', !hasSelection);
    }

    // Sync Snap Toggle UI
    const snapToggle = getEl('editorSnapToggle');
    if (snapToggle) snapToggle.classList.toggle('active', editor._isSnapping);

    // Auto-hide symbol keyboard if leaving text mode (but keep it open when using the text tool)
    const symbolPanel = getEl('editorSymbolKeyboard');
    if (symbolPanel && !isTextMode && symbolPanel.classList.contains('hidden') === false) {
        // Only hide if we explicitly click a non-text tool button
        // (Managed in tool click listeners, but we keep this as a fallback)
    }

    const expandBtn = getEl('toolExpand');
    // Ensure Expand tool is always visible in the new Native CAD layout
    if (expandBtn) {
        expandBtn.classList.remove('hidden');
    }
}

export function updateNodeCountUI(editor, data) {
    const ui = getEl('editorNodeCountUI');
    if (!ui) return;

    let count = '--';
    if (data && data.nodes !== undefined) count = data.nodes;
    else if (editor._selectedElement) {
        const type = editor._selectedElement.type;
        if (type === 'polyline' || type === 'polygon') count = editor._selectedElement.array().length;
        else if (type === 'line') count = 2;
        else if (type === 'rect' || type === 'circle' || type === 'text') count = 1;
    }

    const x = data?.x !== undefined ? data.x.toFixed(1) : '--';
    const y = data?.y !== undefined ? data.y.toFixed(1) : '--';

    ui.textContent = `Nodes: ${count} / X: ${x} Y: ${y}`;
}

/**
 * Both selection and hover highlights have the same shape: text gets a
 * filled rounded-rect behind the bbox; everything else gets a translucent
 * stroke clone of itself. The variants differ only in colors, opacities,
 * and whether the highlight goes behind the original (selection only).
 */
function _renderHighlight(editor, el, color, opts) {
    if (!el || !editor._draw || !editor._highlightLayer) return null;
    const { textFillOpacity, textStrokeOpacity, lineStrokeOpacity, back } = opts;
    let shape;
    if (el.type === 'text') {
        // worldBbox bakes the element's transform into the bbox so the
        // highlight follows drag-translated text instead of staying at
        // the local x/y attrs.
        const b = worldBbox(el);
        shape = editor._highlightLayer.rect(b.w + 0.1, b.h + 0.04)
            .move(b.x - 0.05, b.y - 0.02)
            .fill({ color, opacity: textFillOpacity })
            .radius(0.04);
        if (textStrokeOpacity) shape.stroke({ color, width: 0.02, opacity: textStrokeOpacity });
    } else {
        const sw = parseFloat(el.attr('stroke-width')) || editor._strokeWidth;
        const tol5px = editor._getDynamicTolerance(5);
        shape = el.clone()
            .fill('none')
            .stroke({ color, width: sw + (tol5px * 2), opacity: lineStrokeOpacity })
            .removeClass('svg-selected')
            .removeClass('svg-hover')
            .attr('pointer-events', 'none');
        editor._highlightLayer.add(shape);
    }
    if (back) shape.back();
    return shape;
}

export function updateSelectionHighlight(editor) {
    // Tear down the legacy single-handle if anything still uses it.
    if (editor._selectionHighlight) {
        editor._selectionHighlight.remove();
        editor._selectionHighlight = null;
    }
    if (editor._selectionHighlights) {
        for (const h of editor._selectionHighlights) {
            try { h.remove(); } catch (_) {}
        }
    }
    editor._selectionHighlights = [];

    const sel = editor._selectedElements || [];
    if (!sel.length) return;
    // Hide selection glow in Node Edit mode for clearer point selection.
    if (editor._currentMode === 'node') return;

    // Render a yellow halo for each selected element so the user sees
    // exactly which shapes are in the set (in addition to the combined
    // bbox + transform handles drawn by updateHandles).
    for (const el of sel) {
        const h = _renderHighlight(editor, el, '#ffcc00', {
            textFillOpacity: 0.1,
            textStrokeOpacity: 0.5,
            lineStrokeOpacity: 0.4,
            back: true,
        });
        if (h) editor._selectionHighlights.push(h);
    }
    // Keep _selectionHighlight pointing at the primary's halo for any
    // legacy code that reads it (e.g. updateSelectionHighlight callers
    // that .remove() it directly).
    editor._selectionHighlight =
        editor._selectionHighlights[editor._selectionHighlights.length - 1] || null;
}

export function select(editor, selectedEl) {
    if (!selectedEl) return;
    const cur = editor._selectedElements || [];
    if (cur.length === 1 && cur[0] === selectedEl) return;  // idempotent
    editor._deselect();
    editor._selectedElements = [selectedEl];
    _afterSelectionChange(editor, selectedEl);
}

/** Add `el` to the multi-selection, or remove it if it's already in
 *  there (shift-click toggle). The most recently added element is
 *  treated as the primary — toolbar inputs read from it per the
 *  user's "last clicked wins" preference. */
export function selectAdd(editor, el) {
    if (!el) return;
    const cur = (editor._selectedElements || []).slice();
    const idx = cur.indexOf(el);
    if (idx >= 0) {
        try { el.removeClass('svg-selected'); } catch (_) {}
        cur.splice(idx, 1);
        editor._selectedElements = cur;
        _afterSelectionChange(editor, cur[cur.length - 1] || null);
        return;
    }
    cur.push(el);
    editor._selectedElements = cur;
    _afterSelectionChange(editor, el);
}

/** Replace the selection with a fresh set (marquee finalize). */
export function selectMany(editor, els) {
    editor._deselect();
    const arr = (els || []).filter(Boolean);
    editor._selectedElements = arr;
    _afterSelectionChange(editor, arr[arr.length - 1] || null);
}

/** Shared "after the selection set changed" tail. Syncs toolbar to
 *  the primary, re-renders highlights + handles, fires onSelect. */
function _afterSelectionChange(editor, primary) {
    if (primary) {
        // Ensure the 'svg-selected' class is on every element in the
        // set (callers don't have to remember).
        for (const el of editor._selectedElements) {
            try { el.addClass('svg-selected'); } catch (_) {}
        }
        // BUG-26: clicking an asset switches the editor's active layer
        // to that asset's layer — so the user can immediately edit it
        // without having to manually pick its layer in the panel first.
        // applyLayerState's deselect-on-mismatch rule no longer fires
        // because the active layer is now in sync with the selection.
        try {
            const elemLayer = getElementLayer(primary);
            if (elemLayer != null && String(elemLayer) !== String(editor._activeLayer)) {
                _setActiveLayer(editor, elemLayer);
            }
        } catch (_) { /* defensive: selection sync must not crash on bad markup */ }

        const layerSel = getEl('editorLayerSelect');
        if (layerSel) layerSel.value = primary.attr('data-layer') || "0";

        if (primary.type === 'text') {
            const f = primary.font();
            editor._fontFamily = f.family || editor._fontFamily;
            const parsedSize = parseFloat(f.size);
            if (!isNaN(parsedSize) && parsedSize > 0) editor._fontSize = parsedSize;
            const ffEl = getEl('editorFontFamily');
            const fsEl = getEl('editorFontSize');
            if (ffEl && Array.from(ffEl.options).some(o => o.value === editor._fontFamily)) {
                ffEl.value = editor._fontFamily;
            }
            if (fsEl) fsEl.value = editor._fontSize;
        } else {
            editor._strokeWidth = parseFloat(primary.attr('stroke-width')) || editor._strokeWidth;
        }
    }

    if (editor._hoverHighlight) {
        editor._hoverHighlight.remove();
        editor._hoverHighlight = null;
    }
    if (editor._hoveredElement) editor._hoveredElement.removeClass('svg-hover');

    editor._updateHandles();
    editor._updateSelectionHighlight();
    updateToolbarVisibility(editor);
    if (editor._onSelect) editor._onSelect(primary);
}

export function setHover(editor, el) {
    if (editor._hoveredElement === el) return;

    if (editor._hoverHighlight) {
        editor._hoverHighlight.remove();
        editor._hoverHighlight = null;
    }
    if (editor._hoveredElement) editor._hoveredElement.removeClass('svg-hover');

    editor._hoveredElement = el;
    // Suppress hover halo over any element already in the selection —
    // not just the primary — so the cyan ring doesn't stack on top of
    // the yellow halo for every other shape in a multi-select.
    if (!el || (editor._selectedElements || []).includes(el)) return;

    editor._hoverHighlight = _renderHighlight(editor, el, '#0066cc', {
        textFillOpacity: 0.15,
        textStrokeOpacity: 0,
        lineStrokeOpacity: 0.8,
        back: false,
    });
    if (el.type === 'text' && editor._hoverHighlight) {
        editor._hoverHighlight.attr('pointer-events', 'none');
    } else if (editor._hoveredElement) {
        editor._hoveredElement.addClass('svg-hover');
    }
}

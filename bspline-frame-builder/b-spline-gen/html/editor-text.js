/**
 * editor-text.js - Direct on-canvas text editing logic for VectorEditor.
 * Manages the hidden input synchronization and blinking cursor effects.
 *
 * Architecture: The SVG <text> element contains two <tspan> children:
 *   [0] = the actual user text  (updated ONLY by the input handler)
 *   [1] = the cursor character  (toggled ONLY by the blink interval)
 * This eliminates race conditions between the two writers.
 */


import { COORD_SYSTEM } from './coords.js';

/** Helper: rebuild the two-tspan structure inside a <text> element. */
function _buildTspans(textEl, textContent, x, y) {
    const node = textEl.node;
    // Clear any existing content (SVG.js plain() leftovers)
    while (node.firstChild) node.removeChild(node.firstChild);

    // Convert to physical coordinates for storage/export
    const phys = COORD_SYSTEM.toPhysical(x, y);
    if (window && window.console) {
        console.log(`[COORD_STD] _buildTspans: UI (${x},${y}) -> Physical (${phys.x},${phys.y})`);
    }

    // tspan[0]: user text
    const tText = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    tText.setAttribute('x', phys.x);
    tText.setAttribute('y', phys.y);
    tText.textContent = textContent;

    // tspan[1]: cursor
    const tCursor = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    tCursor.textContent = '|';

    node.appendChild(tText);
    node.appendChild(tCursor);
}

export function startTextAt(editor, pt) {
    // Commit any active text session before starting a new one
    if (editor._editingTextEl) commitText(editor);
    editor._editingTextEl = editor._sketchLayer.text('')
        .font({ family: editor._fontFamily, size: editor._fontSize, anchor: 'start' })
        .fill(editor._strokeColor)
        .attr('data-layer', document.getElementById('editorLayerSelect')?.value || "0")
        .css({ cursor: 'text', 'user-select': 'none' });

    // Convert to physical coordinates for storage/export
    const phys = COORD_SYSTEM.toPhysical(pt.x, pt.y);
    if (window && window.console) {
        console.log(`[COORD_STD] startTextAt: UI (${pt.x},${pt.y}) -> Physical (${phys.x},${phys.y})`);
    }
    editor._editingTextEl.attr({ x: phys.x, y: phys.y });
    editor._currentText = '';
    _buildTspans(editor._editingTextEl, '', pt.x, pt.y);
    initTextSession(editor);
}

export function beginTextEdit(editor, el) {
    if (editor._editingTextEl) commitText(editor);
    editor._editingTextEl = el;
    // Read existing text — strip any leftover cursor character
    editor._currentText = el.text().replace(/\|$/, '');
    editor._editingTextEl.css({ cursor: 'text' });

    // Convert from physical to UI coordinates for editing
    const physX = el.attr('x') || 0;
    const physY = el.attr('y') || 0;
    const ui = COORD_SYSTEM.toUI(physX, physY);
    if (window && window.console) {
        console.log(`[COORD_STD] beginTextEdit: Physical (${physX},${physY}) -> UI (${ui.x},${ui.y})`);
    }
    _buildTspans(editor._editingTextEl, editor._currentText, ui.x, ui.y);
    initTextSession(editor);
}

export function initTextSession(editor) {
    if (!editor._editingTextEl) return;

    // Clean up any stale session first (guards against double-init)
    _teardownTextListeners(editor);

    const input = document.getElementById('editorHiddenInput');
    if (input) {
        input.value = editor._currentText;
        input.focus();

        // Move cursor to end
        const len = input.value.length;
        input.setSelectionRange(len, len);

        // Secondary focus for stubborn environments
        setTimeout(() => {
            if (editor._editingTextEl && document.activeElement !== input) {
                input.focus();
            }
        }, 50);
    } else {
        console.error('[EDITOR] Hidden input element NOT FOUND in document!');
    }

    // 1. Blinking cursor — only toggles tspan[1] opacity, never touches text content
    editor._cursorBlinkInterval = setInterval(() => {
        if (!editor._editingTextEl) {
            clearInterval(editor._cursorBlinkInterval);
            return;
        }
        const cursorSpan = editor._editingTextEl.node.childNodes[1];
        if (cursorSpan) {
            const vis = cursorSpan.getAttribute('opacity');
            cursorSpan.setAttribute('opacity', vis === '0' ? '1' : '0');
        }
    }, 530);

    // 2. Sync hidden input to SVG text — only writer of tspan[0]
    editor._textInputHandler = (e) => {
        const newVal = e.target.value;
        editor._currentText = newVal;
        // Update only the text tspan, leave cursor tspan untouched
        const textSpan = editor._editingTextEl.node.childNodes[0];
        if (textSpan) textSpan.textContent = newVal;
        // Reset cursor to visible on each keystroke
        const cursorSpan = editor._editingTextEl.node.childNodes[1];
        if (cursorSpan) cursorSpan.setAttribute('opacity', '1');
    };

    // 3. Handle control keys on input
    editor._textKeyHandler = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            commitText(editor);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelText(editor);
        }
    };

    input?.addEventListener('input', editor._textInputHandler);
    input?.addEventListener('keydown', editor._textKeyHandler);

    // 4. Force focus back to input on click — skip toolbar and form elements
    editor._refocusReady = false;
    setTimeout(() => { editor._refocusReady = true; }, 150);
    editor._refocusHandler = (e) => {
        if (!editor._editingTextEl || !editor._refocusReady) return;
        // Don't steal focus from toolbar controls
        const topBar = document.querySelector('.editor-toolbar-top');
        const sideBar = document.querySelector('.editor-sidebar');
        if ((topBar && topBar.contains(e.target)) || (sideBar && sideBar.contains(e.target))) return;
        const tag = e.target.tagName;
        if (tag === 'SELECT' || tag === 'INPUT' || tag === 'BUTTON' || tag === 'OPTION') return;
        // Defer focus so it doesn't fight with handleStart → startTextAt
        setTimeout(() => {
            if (editor._editingTextEl && document.activeElement !== input) {
                input?.focus();
            }
        }, 0);
    };
    document.addEventListener('mousedown', editor._refocusHandler);
}

/** Shared cleanup for text session listeners — safe to call multiple times. */
function _teardownTextListeners(editor) {
    clearInterval(editor._cursorBlinkInterval);
    const input = document.getElementById('editorHiddenInput');
    if (input) {
        if (editor._textInputHandler) input.removeEventListener('input', editor._textInputHandler);
        if (editor._textKeyHandler) input.removeEventListener('keydown', editor._textKeyHandler);
    }
    if (editor._refocusHandler) document.removeEventListener('mousedown', editor._refocusHandler);
}

export function commitText(editor) {
    if (!editor._editingTextEl) return;

    _teardownTextListeners(editor);
    const input = document.getElementById('editorHiddenInput');
    if (input) { input.value = ''; input.blur(); }

    if (editor._currentText.trim() === '') {
        const elToRemove = editor._editingTextEl;
        editor._editingTextEl = null;
        editor._currentText = '';
        elToRemove.remove();
        if (editor._onChange) editor._onChange();
    } else {
        // Replace two-tspan structure with clean final text
        editor._editingTextEl.plain(editor._currentText);
        editor._editingTextEl.css({ cursor: 'pointer' });

        editor._editingTextEl = null;
        editor._currentText = '';
        if (typeof editor.pushState === 'function') editor.pushState();
        if (editor._onChange) editor._onChange();
    }
}

export function cancelText(editor) {
    if (!editor._editingTextEl) return;

    _teardownTextListeners(editor);
    const input = document.getElementById('editorHiddenInput');
    if (input) { input.value = ''; input.blur(); }

    editor._editingTextEl.remove();
    editor._editingTextEl = null;
    editor._currentText = '';
}

export function initText(editor) {
    // Hidden input setup
}

export function setFontFamily(editor, family) {
    editor._fontFamily = family;
    if (editor._editingTextEl) {
        editor._editingTextEl.font({ family });
    }
    if (editor._selectedElement && editor._selectedElement.type === 'text') {
        editor._selectedElement.font({ family });
        if (typeof editor.pushState === 'function') editor.pushState();
        if (editor._onChange) editor._onChange();
    }
}

export function setFontSize(editor, size) {
    editor._fontSize = size;
    if (editor._editingTextEl) {
        editor._editingTextEl.font({ size });
    }
    if (editor._selectedElement && editor._selectedElement.type === 'text') {
        editor._selectedElement.font({ size });
        if (typeof editor.pushState === 'function') editor.pushState();
        if (editor._onChange) editor._onChange();
    }
}

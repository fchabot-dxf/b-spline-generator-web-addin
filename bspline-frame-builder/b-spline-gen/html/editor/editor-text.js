/**
 * editor-text.js - Direct on-canvas text editing logic for VectorEditor.
 * Manages the hidden input synchronization and blinking cursor effects.
 *
 * Architecture: The SVG <text> element contains two <tspan> children:
 *   [0] = the actual user text  (updated ONLY by the input handler)
 *   [1] = the cursor character  (toggled ONLY by the blink interval)
 * This eliminates race conditions between the two writers.
 */


import { COORD_SYSTEM } from '../core/coords.js';

/** Helper: rebuild the two-tspan structure inside a <text> element. */
function _buildTspans(textEl, textContent, x, y) {
    const node = textEl.node;
    // Clear any existing content (SVG.js plain() leftovers)
    while (node.firstChild) node.removeChild(node.firstChild);

    if (window && window.console) {
        console.log(`[COORD_STD] _buildTspans: placing UI text at (${x},${y})`);
    }

    // tspan[0]: user text
    const tText = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    tText.setAttribute('x', x);
    tText.setAttribute('y', y);
    tText.textContent = textContent;

    // tspan[1]: cursor
    const tCursor = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    tCursor.textContent = '|';

    node.appendChild(tText);
    node.appendChild(tCursor);
}

export function startTextAt(editor, pt, pointerEvent) {
    // Commit any active text session before starting a new one
    if (editor._editingTextEl) commitText(editor);
    editor._editingTextEl = editor._sketchLayer.text('')
        .font({ family: editor._fontFamily, size: editor._fontSize, anchor: 'start' })
        .fill(editor._strokeColor)
        .attr({
            'data-layer': document.getElementById('editorLayerSelect')?.value || "0",
            'dominant-baseline': 'hanging'
        })
        .css({ cursor: 'text', 'user-select': 'none' });

    editor._editingTextEl.attr({ x: pt.x, y: pt.y });
    editor._currentText = '';
    _buildTspans(editor._editingTextEl, '', pt.x, pt.y);
    // pointerEvent: {clientX, clientY} for mobile input placement
    let pointer = undefined;
    if (pointerEvent) {
        if (pointerEvent.touches && pointerEvent.touches.length > 0) {
            pointer = { x: pointerEvent.touches[0].clientX, y: pointerEvent.touches[0].clientY };
        } else if (typeof pointerEvent.clientX === 'number' && typeof pointerEvent.clientY === 'number') {
            pointer = { x: pointerEvent.clientX, y: pointerEvent.clientY };
        }
    }
    initTextSession(editor, pointer);
}

export function beginTextEdit(editor, el) {
    if (editor._editingTextEl) commitText(editor);
    editor._editingTextEl = el;
    // Read existing text — strip any leftover cursor character
    editor._currentText = el.text().replace(/\|$/, '');
    editor._editingTextEl.css({ cursor: 'text' });

    const x = Number(el.attr('x') || 0);
    const y = Number(el.attr('y') || 0);
    if (window && window.console) {
        console.log(`[COORD_STD] beginTextEdit: editing text at UI (${x},${y})`);
    }
    _buildTspans(editor._editingTextEl, editor._currentText, x, y);
    initTextSession(editor);
}

export function initTextSession(editor, pointer) {
    if (!editor._editingTextEl) return;

    // Clean up any stale session first (guards against double-init)
    _teardownTextListeners(editor);

    const input = document.getElementById('editorHiddenInput');
    if (input) {
        input.value = editor._currentText;

        // --- Mobile keyboard support: move and show input under finger ---
        if (pointer && typeof pointer.x === 'number' && typeof pointer.y === 'number') {
            // Place input at tap/click location, make it visible and large enough for mobile
            input.style.left = (pointer.x - 20) + 'px';
            input.style.top = (pointer.y - 20) + 'px';
            input.style.width = '40px';
            input.style.height = '40px';
            input.style.opacity = '0.01'; // nearly invisible but focusable
            input.style.pointerEvents = 'auto';
        } else {
            // Fallback: keep it hidden but focusable
            input.style.left = '-10000px';
            input.style.top = '0';
            input.style.width = '1px';
            input.style.height = '1px';
            input.style.opacity = '0';
            input.style.pointerEvents = 'none';
        }

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
        // Restore hidden style
        input.style.left = '-10000px';
        input.style.top = '0';
        input.style.width = '1px';
        input.style.height = '1px';
        input.style.opacity = '0';
        input.style.pointerEvents = 'none';
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
    console.log(`[COORD_STD] editor-text: setFontFamily to "${family}"`);
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

export function insertSymbol(editor, symbol, fontFamily) {
    console.log(`[COORD_STD] editor-text: insertSymbol "${symbol}" (U+${symbol.codePointAt(0).toString(16).toUpperCase()}) with font "${fontFamily}"`);
    if (fontFamily) {
        setFontFamily(editor, fontFamily);
    }
    const input = document.getElementById('editorHiddenInput');
    if (!input) return;
    const value = input.value || '';
    const start = typeof input.selectionStart === 'number' ? input.selectionStart : value.length;
    const end = typeof input.selectionEnd === 'number' ? input.selectionEnd : start;
    const nextValue = value.slice(0, start) + symbol + value.slice(end);
    input.value = nextValue;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const cursor = start + symbol.length;
    input.setSelectionRange(cursor, cursor);
    input.focus();
}

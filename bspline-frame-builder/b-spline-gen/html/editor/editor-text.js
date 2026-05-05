/**
 * editor-text.js - Direct on-canvas text editing logic for VectorEditor.
 * Manages the hidden input synchronization and blinking cursor effects.
 *
 * Architecture: The SVG <text> element contains two <tspan> children:
 *   [0] = the actual user text  (updated ONLY by the input handler)
 *   [1] = the cursor character  (toggled ONLY by the blink interval)
 * This eliminates race conditions between the two writers.
 *
 * Baseline convention: text uses alphabetic baseline (the SVG default) and
 * stores the user's intended visual top in `data-anchor-y`. The element's
 * `y` attribute is `anchor-y + ascender` so glyph tops land at anchor-y.
 *
 * Why not `dominant-baseline="hanging"`? It's honored by the browser's
 * live SVG renderer (the editor canvas) but NOT by the same SVG rendered
 * via <img> to a canvas — which is exactly what stamp.js does. That path
 * falls back to alphabetic baseline, so hanging-baseline text renders at
 * a different y in the stamp than in the editor. Using alphabetic
 * everywhere + a manual ascender offset keeps live render, stamp
 * rasterization, and opentype expand all aligned to the same visual top.
 */


import { COORD_SYSTEM } from '../core/coords.js';

/**
 * Returns the font's ascender in user units (treating user units as px
 * for measurement). Uses the browser's font metrics via canvas
 * measureText — same metrics the SVG renderer uses, so the offset
 * applied here matches the actual rendered baseline.
 *
 * Falls back to 0.8 * size for the rare browser without
 * actualBoundingBoxAscent (Firefox <74).
 */
const _measureCanvas = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
const _measureCtx = _measureCanvas ? _measureCanvas.getContext('2d') : null;
export function getAscenderForFont(family, size) {
    if (!_measureCtx || !(size > 0)) return (size || 0) * 0.8;
    const cleaned = String(family || 'Arial').replace(/['"]/g, '').trim();
    _measureCtx.font = `${size}px "${cleaned}", Arial, sans-serif`;
    const m = _measureCtx.measureText('Mg');
    if (typeof m.actualBoundingBoxAscent === 'number' && m.actualBoundingBoxAscent > 0) {
        return m.actualBoundingBoxAscent;
    }
    return size * 0.8;
}

/**
 * Re-anchor a <text> element after a font/size change so its visual top
 * stays at `data-anchor-y`. Updates both the parent <text> y and the
 * inner text-content tspan (when present during an edit session).
 */
function _reanchorTextY(textEl, family, size) {
    const anchorY = parseFloat(textEl.attr('data-anchor-y'));
    if (!Number.isFinite(anchorY)) return;
    const newY = anchorY + getAscenderForFont(family, size);
    textEl.attr('y', newY);
    const inner = textEl.node.childNodes && textEl.node.childNodes[0];
    if (inner && inner.tagName && inner.tagName.toLowerCase() === 'tspan' && inner.hasAttribute('y')) {
        inner.setAttribute('y', newY);
    }
}

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
    console.log(`[TEXT-DBG] startTextAt: pt=(${pt.x.toFixed(1)},${pt.y.toFixed(1)}) hadEditingText=${!!editor._editingTextEl} ptrEvtType=${pointerEvent?.type}`);
    // Commit any active text session before starting a new one
    if (editor._editingTextEl) commitText(editor);

    // Place text using alphabetic baseline (SVG default). The user clicked
    // at pt.y expecting the text top to land there, so push the baseline
    // down by the font's ascender. data-anchor-y remembers the visual top
    // so font/size changes can reflow without drifting.
    const ascender = getAscenderForFont(editor._fontFamily, editor._fontSize);
    const baselineY = pt.y + ascender;

    editor._editingTextEl = editor._sketchLayer.text('')
        .font({ family: editor._fontFamily, size: editor._fontSize, anchor: 'start' })
        .fill(editor._strokeColor)
        .attr({
            'data-layer': document.getElementById('editorLayerSelect')?.value || "0",
            'data-anchor-y': pt.y
        })
        .css({ cursor: 'text', 'user-select': 'none' });

    editor._editingTextEl.attr({ x: pt.x, y: baselineY });
    editor._currentText = '';
    _buildTspans(editor._editingTextEl, '', pt.x, baselineY);
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
    console.log(`[TEXT-DBG] beginTextEdit: hadEditingText=${!!editor._editingTextEl} elText="${el?.text?.() ?? ''}"`);
    if (editor._editingTextEl) commitText(editor);
    editor._editingTextEl = el;
    // Read existing text — strip any leftover cursor character
    editor._currentText = el.text().replace(/\|$/, '');
    editor._editingTextEl.css({ cursor: 'text' });

    // Migrate legacy texts to the alphabetic-baseline + data-anchor-y
    // convention. Two cases worth handling:
    //   1. dominant-baseline="hanging" (old format) — the old `y` was the
    //      visual top, so anchor-y = old y, new baseline y = old y + ascender.
    //   2. No data-anchor-y at all (e.g., text imported from elsewhere) —
    //      assume `y` is already the alphabetic baseline and back-fill
    //      anchor-y = y - ascender.
    const fontFamily = (el.attr('font-family') || editor._fontFamily || 'Arial').replace(/['"]/g, '').trim();
    const fontSize = parseFloat(el.attr('font-size')) || editor._fontSize;
    const ascender = getAscenderForFont(fontFamily, fontSize);
    if (el.attr('dominant-baseline') === 'hanging') {
        const oldY = Number(el.attr('y') || 0);
        el.attr('data-anchor-y', oldY);
        el.attr('dominant-baseline', null);
        el.attr('y', oldY + ascender);
    } else if (el.attr('data-anchor-y') == null) {
        const curY = Number(el.attr('y') || 0);
        el.attr('data-anchor-y', curY - ascender);
    }

    const x = Number(el.attr('x') || 0);
    const y = Number(el.attr('y') || 0);
    if (window && window.console) {
        console.log(`[COORD_STD] beginTextEdit: editing text at UI (${x},${y}) anchor-y=${el.attr('data-anchor-y')}`);
    }
    _buildTspans(editor._editingTextEl, editor._currentText, x, y);
    initTextSession(editor);
}

export function initTextSession(editor, pointer) {
    console.log(`[TEXT-DBG] initTextSession: hasEditingText=${!!editor._editingTextEl} pointer=${pointer ? `(${pointer.x},${pointer.y})` : 'null'}`);
    if (!editor._editingTextEl) {
        console.log('[TEXT-DBG] initTextSession: no editing text, returning early');
        return;
    }

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

        // NOTE: do NOT touch the inputmode attribute here. iOS Safari
        // has a quirk where any DOM mutation on `inputmode` in the same
        // gesture stack as focus() can silently suppress the keyboard
        // popup, even if the attribute was never set. The Symbol
        // Keyboard's open/close handlers in properties-text.js are the
        // single owner of this attribute — they set inputmode='none'
        // when the panel opens and remove it when the panel closes. The
        // attribute state then persists across text sessions on its
        // own. If you find yourself wanting to assert inputmode here,
        // route the change through syncNativeKeyboardSuppression instead.
        console.log(`[TEXT-DBG] initTextSession: inputmode-attr="${input.getAttribute('inputmode') ?? '(none)'}"  about to focus()`);

        input.focus();
        console.log(`[TEXT-DBG] initTextSession: focus() done, activeElement is ${document.activeElement?.id || document.activeElement?.tagName} (matches=${document.activeElement === input})`);
        // Move cursor to end
        const len = input.value.length;
        input.setSelectionRange(len, len);

        // Secondary focus for stubborn environments
        setTimeout(() => {
            const stillActive = document.activeElement === input;
            console.log(`[TEXT-DBG] initTextSession +50ms: hasEditingText=${!!editor._editingTextEl} activeMatches=${stillActive} active=${document.activeElement?.id || document.activeElement?.tagName}`);
            if (editor._editingTextEl && document.activeElement !== input) {
                console.log('[TEXT-DBG] initTextSession +50ms: refocusing (secondary)');
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
        console.log(`[TEXT-DBG] input event: value="${newVal}" (len=${newVal.length}) hasEditingText=${!!editor._editingTextEl}`);
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
        console.log(`[TEXT-DBG] keydown: key="${e.key}" code=${e.code}`);
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
        if (!editor._editingTextEl || !editor._refocusReady) {
            console.log(`[TEXT-DBG] refocusHandler skipped: hasEditingText=${!!editor._editingTextEl} ready=${editor._refocusReady} target=<${e.target?.tagName}>`);
            return;
        }
        // Don't steal focus from toolbar controls
        const topBar = document.querySelector('.editor-toolbar-top');
        const sideBar = document.querySelector('.editor-sidebar');
        if ((topBar && topBar.contains(e.target)) || (sideBar && sideBar.contains(e.target))) {
            console.log(`[TEXT-DBG] refocusHandler skipped: toolbar/sidebar target=<${e.target?.tagName}>`);
            return;
        }
        const tag = e.target.tagName;
        if (tag === 'SELECT' || tag === 'INPUT' || tag === 'BUTTON' || tag === 'OPTION') {
            console.log(`[TEXT-DBG] refocusHandler skipped: form-element target=<${tag}>`);
            return;
        }
        console.log(`[TEXT-DBG] refocusHandler firing: target=<${tag}> ts=${Math.round(e.timeStamp)} — will refocus on next tick`);
        // Defer focus so it doesn't fight with handleStart → startTextAt
        setTimeout(() => {
            if (editor._editingTextEl && document.activeElement !== input) {
                console.log('[TEXT-DBG] refocusHandler: refocusing input now');
                input?.focus();
            } else {
                console.log(`[TEXT-DBG] refocusHandler: refocus skipped, hasEditingText=${!!editor._editingTextEl} alreadyActive=${document.activeElement === input}`);
            }
        }, 0);
    };
    document.addEventListener('mousedown', editor._refocusHandler);
}

/** Shared cleanup for text session listeners — safe to call multiple times. */
function _teardownTextListeners(editor) {
    console.log(`[TEXT-DBG] _teardownTextListeners: hasInputHandler=${!!editor._textInputHandler} hasRefocus=${!!editor._refocusHandler}`);
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
    console.log(`[TEXT-DBG] commitText called: hasEditingText=${!!editor._editingTextEl} currentText="${editor._currentText}" (len=${editor._currentText?.length ?? 0})`);
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
        editor._editingTextEl.font({ family: editor._fontFamily });
        editor._editingTextEl.css({ cursor: 'pointer' });

        editor._editingTextEl = null;
        editor._currentText = '';
        if (typeof editor.pushState === 'function') editor.pushState();
        if (editor._onChange) editor._onChange();
    }
}

export function cancelText(editor) {
    console.log(`[TEXT-DBG] cancelText called: hasEditingText=${!!editor._editingTextEl}`);
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
        const size = parseFloat(editor._editingTextEl.attr('font-size')) || editor._fontSize;
        _reanchorTextY(editor._editingTextEl, family, size);
    }
    if (editor._selectedElement && editor._selectedElement.type === 'text') {
        editor._selectedElement.font({ family });
        const size = parseFloat(editor._selectedElement.attr('font-size')) || editor._fontSize;
        _reanchorTextY(editor._selectedElement, family, size);
        if (typeof editor.pushState === 'function') editor.pushState();
        if (editor._onChange) editor._onChange();
    }
}

export function setFontSize(editor, size) {
    editor._fontSize = size;
    if (editor._editingTextEl) {
        editor._editingTextEl.font({ size });
        const family = (editor._editingTextEl.attr('font-family') || editor._fontFamily).replace(/['"]/g, '').trim();
        _reanchorTextY(editor._editingTextEl, family, size);
    }
    if (editor._selectedElement && editor._selectedElement.type === 'text') {
        editor._selectedElement.font({ size });
        const family = (editor._selectedElement.attr('font-family') || editor._fontFamily).replace(/['"]/g, '').trim();
        _reanchorTextY(editor._selectedElement, family, size);
        if (typeof editor.pushState === 'function') editor.pushState();
        if (editor._onChange) editor._onChange();
    }
}

export function insertSymbol(editor, symbol, fontFamily) {
    console.log(`[COORD_STD] editor-text: insertSymbol "${symbol}" (U+${symbol.codePointAt(0).toString(16).toUpperCase()}) with font "${fontFamily}"`);
    const appliedFamily = fontFamily || editor._fontFamily || 'Arial';
    if (fontFamily) {
        setFontFamily(editor, fontFamily);
    }

    if (editor._editingTextEl) {
        try {
            editor._editingTextEl.font({ family: appliedFamily });
            editor._editingTextEl.attr('font-family', appliedFamily);
            if (editor._editingTextEl.node && editor._editingTextEl.node.style) {
                editor._editingTextEl.node.style.fontFamily = appliedFamily;
            }
        } catch (err) {
            console.warn('[EDITOR] insertSymbol: failed to apply font family', err);
        }
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

/**
 * Text editing session lifecycle:
 *
 *   startTextAt    — begin a brand-new text at a click point.
 *   beginTextEdit  — pick up an existing <text> element for editing.
 *   initTextSession — wire the hidden input + blink + refocus listeners.
 *   commitText     — finalize the active session and replace tspans
 *                    with a clean plain text element.
 *   cancelText     — drop the active session and remove its element.
 *
 * Owns the hidden-input handler, the blinking-cursor interval, and the
 * document-level mousedown handler that keeps focus inside the input
 * when the user clicks elsewhere on the canvas.
 */
import { getAscenderForFont, buildTspans, migrateTextElement } from './editor-text-baseline.js';
import { on } from './dom.js';
import { dbg } from './debug.js';

const HIDDEN_INPUT_ID = 'editorHiddenInput';
const CURSOR_BLINK_MS = 530;

export function startTextAt(editor, pt, pointerEvent) {
    dbg('TEXT-DBG', `startTextAt: pt=(${pt.x.toFixed(1)},${pt.y.toFixed(1)}) hadEditingText=${!!editor._editingTextEl} ptrEvtType=${pointerEvent?.type}`);
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
            'data-anchor-y': pt.y,
        })
        .css({ cursor: 'text', 'user-select': 'none' });

    editor._editingTextEl.attr({ x: pt.x, y: baselineY });
    editor._currentText = '';
    buildTspans(editor._editingTextEl, '', pt.x, baselineY);

    initTextSession(editor, _eventToPointer(pointerEvent));
}

export function beginTextEdit(editor, el) {
    dbg('TEXT-DBG', `beginTextEdit: hadEditingText=${!!editor._editingTextEl} elText="${el?.text?.() ?? ''}"`);
    if (editor._editingTextEl) commitText(editor);
    editor._editingTextEl = el;
    // Read existing text — strip any leftover cursor character.
    editor._currentText = el.text().replace(/\|$/, '');
    editor._editingTextEl.css({ cursor: 'text' });

    // Bring legacy / imported texts into the editor's baseline convention.
    // Single source of truth in editor-text-baseline.js.
    migrateTextElement(el, editor._fontSize);

    const x = Number(el.attr('x') || 0);
    const y = Number(el.attr('y') || 0);
    dbg('COORD_STD', `beginTextEdit: editing text at UI (${x},${y}) anchor-y=${el.attr('data-anchor-y')}`);
    buildTspans(editor._editingTextEl, editor._currentText, x, y);
    initTextSession(editor);
}

/**
 * Wire up the active editing session: position the hidden input, focus
 * it, start the cursor-blink interval, and attach the input/key/refocus
 * handlers. Each step is a small helper so the orchestrator reads as a
 * checklist; the helpers own their own state lifetimes.
 */
export function initTextSession(editor, pointer) {
    dbg('TEXT-DBG', `initTextSession: hasEditingText=${!!editor._editingTextEl} pointer=${pointer ? `(${pointer.x},${pointer.y})` : 'null'}`);
    if (!editor._editingTextEl) {
        dbg('TEXT-DBG', 'initTextSession: no editing text, returning early');
        return;
    }

    // Clean up any stale session first (guards against double-init).
    _teardownTextListeners(editor);

    const input = document.getElementById(HIDDEN_INPUT_ID);
    if (!input) {
        // Structural failure (HTML missing the hidden input). Keep this
        // as console.error so it surfaces unconditionally.
        console.error('[EDITOR] Hidden input element NOT FOUND in document!');
        return;
    }

    input.value = editor._currentText;
    _positionHiddenInput(input, pointer);
    _focusHiddenInput(editor, input);
    _startCursorBlink(editor);
    _attachInputHandlers(editor, input);
    _attachRefocusHandler(editor, input);
}

/** Mobile keyboard: position the hidden input under the touch point so
 *  the OS keyboard pops up beside it. Desktop keeps it hidden far
 *  off-screen. */
function _positionHiddenInput(input, pointer) {
    if (pointer && typeof pointer.x === 'number' && typeof pointer.y === 'number') {
        input.style.left = (pointer.x - 20) + 'px';
        input.style.top = (pointer.y - 20) + 'px';
        input.style.width = '40px';
        input.style.height = '40px';
        input.style.opacity = '0.01';
        input.style.pointerEvents = 'auto';
    } else {
        _hideHiddenInput(input);
    }
}

function _hideHiddenInput(input) {
    input.style.left = '-10000px';
    input.style.top = '0';
    input.style.width = '1px';
    input.style.height = '1px';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';
}

/** Focus the hidden input, place the caret at the end, and re-focus on
 *  a 50ms timer for stubborn environments where the first focus call
 *  gets stolen by the originating gesture (mobile mostly). */
function _focusHiddenInput(editor, input) {
    // NOTE: do NOT touch the inputmode attribute here. iOS Safari has a
    // quirk where any DOM mutation on `inputmode` in the same gesture
    // stack as focus() can silently suppress the keyboard popup, even
    // if the attribute was never set. The Symbol Keyboard's open/close
    // handlers in properties-text.js are the single owner of this
    // attribute — they set inputmode='none' when the panel opens and
    // remove it when the panel closes.
    dbg('TEXT-DBG', `initTextSession: inputmode-attr="${input.getAttribute('inputmode') ?? '(none)'}"  about to focus()`);
    input.focus();
    dbg('TEXT-DBG', `initTextSession: focus() done, activeElement is ${document.activeElement?.id || document.activeElement?.tagName} (matches=${document.activeElement === input})`);
    const len = input.value.length;
    input.setSelectionRange(len, len);

    setTimeout(() => {
        const stillActive = document.activeElement === input;
        dbg('TEXT-DBG', `initTextSession +50ms: hasEditingText=${!!editor._editingTextEl} activeMatches=${stillActive} active=${document.activeElement?.id || document.activeElement?.tagName}`);
        if (editor._editingTextEl && document.activeElement !== input) {
            dbg('TEXT-DBG', 'initTextSession +50ms: refocusing (secondary)');
            input.focus();
        }
    }, 50);
}

/** Start the blinking cursor. Toggles tspan[1] opacity only, never
 *  touches text content — the input handler owns tspan[0]. The interval
 *  self-cancels if the editing element disappears mid-tick. */
function _startCursorBlink(editor) {
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
    }, CURSOR_BLINK_MS);
}

/** Hidden-input → SVG text sync, plus Enter/Escape handling. The input
 *  handler is the only writer of tspan[0], the cursor blink is the only
 *  writer of tspan[1] — splitting them eliminates the race where one
 *  would clobber the other mid-update. */
function _attachInputHandlers(editor, input) {
    editor._textInputHandler = (e) => {
        const newVal = e.target.value;
        dbg('TEXT-DBG', `input event: value="${newVal}" (len=${newVal.length}) hasEditingText=${!!editor._editingTextEl}`);
        editor._currentText = newVal;
        const textSpan = editor._editingTextEl.node.childNodes[0];
        if (textSpan) textSpan.textContent = newVal;
        const cursorSpan = editor._editingTextEl.node.childNodes[1];
        if (cursorSpan) cursorSpan.setAttribute('opacity', '1');
    };

    editor._textKeyHandler = (e) => {
        dbg('TEXT-DBG', `keydown: key="${e.key}" code=${e.code}`);
        if (e.key === 'Enter') {
            e.preventDefault();
            commitText(editor);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelText(editor);
        }
    };

    on(input, 'input',   editor._textInputHandler);
    on(input, 'keydown', editor._textKeyHandler);
}

/** Document-level mousedown handler that pulls focus back to the hidden
 *  input on every canvas click — but skips toolbar/sidebar/form
 *  controls so the user can interact with them without losing the text
 *  session. Has a 150ms grace period at session start so the originating
 *  click doesn't immediately steal-back focus before the keyboard wakes. */
function _attachRefocusHandler(editor, input) {
    editor._refocusReady = false;
    setTimeout(() => { editor._refocusReady = true; }, 150);

    editor._refocusHandler = (e) => {
        if (!editor._editingTextEl || !editor._refocusReady) {
            dbg('TEXT-DBG', `refocusHandler skipped: hasEditingText=${!!editor._editingTextEl} ready=${editor._refocusReady} target=<${e.target?.tagName}>`);
            return;
        }
        const topBar = document.querySelector('.editor-toolbar-top');
        const sideBar = document.querySelector('.editor-sidebar');
        if ((topBar && topBar.contains(e.target)) || (sideBar && sideBar.contains(e.target))) {
            dbg('TEXT-DBG', `refocusHandler skipped: toolbar/sidebar target=<${e.target?.tagName}>`);
            return;
        }
        const tag = e.target.tagName;
        if (tag === 'SELECT' || tag === 'INPUT' || tag === 'BUTTON' || tag === 'OPTION') {
            dbg('TEXT-DBG', `refocusHandler skipped: form-element target=<${tag}>`);
            return;
        }
        dbg('TEXT-DBG', `refocusHandler firing: target=<${tag}> ts=${Math.round(e.timeStamp)} — will refocus on next tick`);
        // Defer focus so it doesn't fight with handleStart → startTextAt.
        setTimeout(() => {
            if (editor._editingTextEl && document.activeElement !== input) {
                dbg('TEXT-DBG', 'refocusHandler: refocusing input now');
                input?.focus();
            } else {
                dbg('TEXT-DBG', `refocusHandler: refocus skipped, hasEditingText=${!!editor._editingTextEl} alreadyActive=${document.activeElement === input}`);
            }
        }, 0);
    };
    on(document, 'mousedown', editor._refocusHandler);
}

/** Convert a DOM mouse/touch event into a {x, y} client-space pointer
 *  used for placing the hidden input under the user's finger on mobile. */
function _eventToPointer(e) {
    if (!e) return undefined;
    if (e.touches && e.touches.length > 0) {
        return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    if (typeof e.clientX === 'number' && typeof e.clientY === 'number') {
        return { x: e.clientX, y: e.clientY };
    }
    return undefined;
}

/** Shared cleanup for text session listeners — safe to call multiple times. */
function _teardownTextListeners(editor) {
    dbg('TEXT-DBG', `_teardownTextListeners: hasInputHandler=${!!editor._textInputHandler} hasRefocus=${!!editor._refocusHandler}`);
    clearInterval(editor._cursorBlinkInterval);
    const input = document.getElementById(HIDDEN_INPUT_ID);
    if (input) {
        if (editor._textInputHandler) input.removeEventListener('input', editor._textInputHandler);
        if (editor._textKeyHandler) input.removeEventListener('keydown', editor._textKeyHandler);
        _hideHiddenInput(input);
    }
    if (editor._refocusHandler) document.removeEventListener('mousedown', editor._refocusHandler);
}

export function commitText(editor) {
    dbg('TEXT-DBG', `commitText called: hasEditingText=${!!editor._editingTextEl} currentText="${editor._currentText}" (len=${editor._currentText?.length ?? 0})`);
    if (!editor._editingTextEl) return;

    _teardownTextListeners(editor);
    const input = document.getElementById(HIDDEN_INPUT_ID);
    if (input) { input.value = ''; input.blur(); }

    if (editor._currentText.trim() === '') {
        const elToRemove = editor._editingTextEl;
        editor._editingTextEl = null;
        editor._currentText = '';
        elToRemove.remove();
        if (editor._onChange) editor._onChange();
    } else {
        // Replace the two-tspan structure with a clean plain-text element.
        // DO NOT re-apply editor._fontFamily here: insertSymbol may have
        // set the text's font to Symbol/Wingdings/etc while editor's
        // default stayed at Arial. Re-asserting from editor._fontFamily
        // would silently revert symbol text back to Arial, and then
        // expand would render it as Latin glyphs instead of symbols.
        editor._editingTextEl.plain(editor._currentText);
        editor._editingTextEl.css({ cursor: 'pointer' });

        editor._editingTextEl = null;
        editor._currentText = '';
        if (typeof editor.pushState === 'function') editor.pushState();
        if (editor._onChange) editor._onChange();
    }
}

export function cancelText(editor) {
    dbg('TEXT-DBG', `cancelText called: hasEditingText=${!!editor._editingTextEl}`);
    if (!editor._editingTextEl) return;

    _teardownTextListeners(editor);
    const input = document.getElementById(HIDDEN_INPUT_ID);
    if (input) { input.value = ''; input.blur(); }

    editor._editingTextEl.remove();
    editor._editingTextEl = null;
    editor._currentText = '';
}

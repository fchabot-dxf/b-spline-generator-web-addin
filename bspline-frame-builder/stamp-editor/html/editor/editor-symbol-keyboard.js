/**
 * Symbol Keyboard — the on-screen panel that lets users insert glyphs
 * from Symbol / Wingdings / Webdings / Segoe UI Symbol etc. into the
 * active text element.
 *
 * Owns:
 *   - Toggle / close / family-change wiring on the keyboard chrome.
 *   - The grid population (one button per glyph in the family's range)
 *     + a runtime font-loading self-test that surfaces a banner when
 *     a bundled font fails to load.
 *   - The grip drag-to-resize gesture.
 *   - The iOS native-keyboard suppression dance: while our Symbol panel
 *     is open, force `inputmode="none"` on the hidden text input so iOS
 *     Safari doesn't pop its own keyboard over ours. Restore by removing
 *     the attribute (NOT setting it back to "text" — see comments).
 *   - Padding-bottom on the canvas container so the panel doesn't cover
 *     the bottom of the editing surface.
 */
import { el, query, addClass, on } from './dom.js';
import { insertSymbol } from './editor-text-style.js';
import { verifyFontLoaded, SYMBOL_FAMILIES } from './editor-fonts.js';
import { dbg } from './debug.js';

const HIDDEN_INPUT_ID = 'editorHiddenInput';
const PANEL_ID = 'editorSymbolKeyboard';
const GRID_ID = 'editorSymbolKeyboardGrid';
const GRIP_SELECTOR = '.editor-symbol-keyboard-grip';

// Glyph ranges per family. Symbol/Wingdings/Webdings/Segoe UI Symbol
// expose glyphs in the ASCII codepoint range; Segoe MDL2 / Fluent Icons
// / UI Emoji live in named PUA / supplementary planes.
const FAMILY_RANGES = {
    Symbol:               { start: 32,     end: 255 },
    Webdings:             { start: 32,     end: 255 },
    Wingdings:            { start: 32,     end: 255 },
    'Segoe UI Symbol':    { start: 32,     end: 255 },
    'Segoe MDL2 Assets':  { start: 0xE700, end: 0xE7FF },
    'Segoe Fluent Icons': { start: 0xF700, end: 0xF7FF },
    'Segoe UI Emoji':     { start: 0x1F300, end: 0x1F35F },
};

export function initSymbolKeyboard(editor) {
    const symbolToggle = el('editorSymbolKeyboardToggle');
    const symbolPanel = el(PANEL_ID);
    const symbolClose = el('editorSymbolKeyboardClose');
    const symbolFamily = el('editorSymbolFamily');
    const canvasContainer = el('editorCanvasContainer')?.parentElement;

    const updateKeyboardPadding = () => {
        if (!canvasContainer || !symbolPanel) return;
        const isOpen = !symbolPanel.classList.contains('hidden');
        canvasContainer.style.paddingBottom = isOpen
            ? `${symbolPanel.getBoundingClientRect().height}px`
            : '0px';
    };

    const syncNativeKeyboardSuppression = (suppress) => suppressNativeKeyboard(editor, suppress);

    if (symbolToggle && symbolPanel && symbolFamily) {
        on(symbolToggle, 'click', () => {
            const isOpen = !symbolPanel.classList.toggle('hidden');
            canvasContainer?.classList.toggle('keyboard-open', isOpen);
            if (isOpen) {
                populateSymbolKeyboard(editor, symbolFamily.value || 'Symbol');
                symbolFamily.focus();
            }
            syncNativeKeyboardSuppression(isOpen);
            updateKeyboardPadding();
        });
    }

    on(symbolClose, 'click', () => {
        if (symbolPanel) addClass(symbolPanel, 'hidden');
        canvasContainer?.classList.remove('keyboard-open');
        syncNativeKeyboardSuppression(false);
        updateKeyboardPadding();
    });

    on(symbolFamily, 'change', () => {
        if (symbolPanel && !symbolPanel.classList.contains('hidden')) {
            populateSymbolKeyboard(editor, symbolFamily.value || 'Symbol');
            updateKeyboardPadding();
        }
    });

    on(window, 'resize', updateKeyboardPadding);

    setupGripResize(symbolPanel, canvasContainer);

    // Expose the populator for hot-reload / debug poking.
    if (typeof window !== 'undefined') {
        window.populateSymbolKeyboard = (editorInstance, family = 'Symbol') =>
            populateSymbolKeyboard(editorInstance, family);
    }
}

/**
 * Suppress / restore the iOS-native software keyboard while the Symbol
 * Keyboard is open. The text editor uses #editorHiddenInput as its
 * input surface — when that input has focus on iOS, Safari pops up its
 * own keyboard and covers our Symbol Keyboard. Setting inputmode="none"
 * keeps the input focusable and event-driven (so insertSymbol's
 * programmatic writes still work) but tells iOS NOT to show its keyboard.
 *
 * Restore path REMOVES the attribute entirely rather than asserting
 * inputmode='text'. iOS Safari has a quirk where dynamically setting
 * inputmode (even to its default) can suppress the keyboard popup on
 * the same gesture, breaking plain text editing. Removing the attribute
 * leaves the input in its native default state.
 */
function suppressNativeKeyboard(editor, suppress) {
    const input = document.getElementById(HIDDEN_INPUT_ID);
    if (!input) return;
    if (suppress) input.setAttribute('inputmode', 'none');
    else input.removeAttribute('inputmode');

    if (document.activeElement === input) {
        input.blur();
        // Re-focus on next tick so editor._editingTextEl can keep typing.
        setTimeout(() => {
            if (editor && editor._editingTextEl) input.focus();
        }, 0);
    }
}

/**
 * Show or hide a banner inside the panel warning that the requested
 * symbol font failed to load. This is the runtime self-test surface —
 * when it appears, something in the font pipeline (editor-fonts.js /
 * .ttf files / network) has regressed. Don't suppress the banner; it
 * prevents the iOS keyboard bug from coming back silently.
 */
function setKeyboardFontWarning(panel, family, isLoaded) {
    if (!panel) return;
    let banner = panel.querySelector('.editor-symbol-keyboard-warning');
    if (isLoaded) {
        if (banner) banner.remove();
        return;
    }
    if (!banner) {
        banner = document.createElement('div');
        banner.className = 'editor-symbol-keyboard-warning';
        banner.setAttribute('role', 'alert');
        const grip = panel.querySelector(GRIP_SELECTOR);
        if (grip && grip.nextSibling) panel.insertBefore(banner, grip.nextSibling);
        else panel.insertBefore(banner, panel.firstChild);
    }
    banner.textContent = `⚠ "${family}" font failed to load — symbol glyphs may render as plain Latin characters. Check editor-fonts.js / fonts directory.`;
}

function populateSymbolKeyboard(editor, family = 'Symbol') {
    const grid = el(GRID_ID);
    const panel = el(PANEL_ID);
    if (!grid || !panel) return;
    dbg('COORD_STD', `populating Symbol Keyboard with family "${family}"`);
    grid.innerHTML = '';

    // Self-test: only meaningful for families we explicitly @font-face.
    // System-only families (Arial, etc.) would yield false positives
    // because document.fonts.check returns true regardless.
    if (SYMBOL_FAMILIES.has(family)) {
        verifyFontLoaded(family).then(ok => {
            if (!ok) console.warn(`[editor-fonts] Symbol Keyboard: font "${family}" failed to load. Banner shown to user.`);
            setKeyboardFontWarning(panel, family, ok);
        });
    } else {
        setKeyboardFontWarning(panel, family, true);
    }

    const range = FAMILY_RANGES[family] || { start: 32, end: 255 };
    const defaultHeight = window.innerWidth <= 720 ? '40vh' : '50vh';
    const maxHeight = '80vh';
    panel.style.width = '100%';
    panel.style.height = defaultHeight;
    panel.style.removeProperty('max-height');
    panel.style.setProperty('--keyboard-max-height', maxHeight);

    for (let code = range.start; code <= range.end; code++) {
        grid.appendChild(buildKeyButton(editor, family, code));
    }

    // Invisible placeholders at the bottom reserve safe space under
    // mobile browser UI (the bottom address bar / home indicator).
    for (let i = 0; i < 8; i++) {
        const placeholder = document.createElement('button');
        placeholder.type = 'button';
        placeholder.className = 'symbol-key symbol-key-placeholder';
        placeholder.setAttribute('aria-hidden', 'true');
        placeholder.tabIndex = -1;
        grid.appendChild(placeholder);
    }
}

function buildKeyButton(editor, family, code) {
    const char = String.fromCodePoint(code);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'symbol-key';
    btn.textContent = char;
    btn.style.fontFamily = `'${family}', "Segoe UI Symbol", "Apple Color Emoji", "Noto Sans Symbols", sans-serif`;
    btn.onclick = () => {
        dbg('COORD_STD', `Symbol clicked: ${char} (0x${code.toString(16).toUpperCase()}) using font: ${family}`);
        if (editor && editor._editingTextEl) {
            insertSymbol(editor, char, family);
        } else {
            alert('Select a text object or click the canvas to start typing before inserting symbols.');
        }
    };
    return btn;
}

/**
 * Drag-to-resize the keyboard via its top grip handle. Listens on
 * pointer/touch start at the grip, then routes move/end to document
 * (so the user can drag past the grip's bounds without losing the drag).
 */
function setupGripResize(symbolPanel, canvasContainer) {
    const keyboardGrip = query(GRIP_SELECTOR);
    if (!keyboardGrip || !symbolPanel) return;

    let dragStartY = null;
    let startHeight = 0;
    const minHeight = 120;
    const getMaxHeight = () => Math.min(window.innerHeight - 120, Math.round(window.innerHeight * 0.85));

    const setKeyboardHeight = (height) => {
        const maxHeight = getMaxHeight();
        const clamped = Math.min(maxHeight, Math.max(minHeight, height));
        requestAnimationFrame(() => {
            symbolPanel.style.setProperty('--keyboard-max-height', `${clamped}px`);
            symbolPanel.style.height = `${clamped}px`;
            if (canvasContainer) {
                if (window.innerWidth <= 720) {
                    const ratio = (clamped - minHeight) / (maxHeight - minHeight);
                    const sidePadding = ratio * 60;
                    canvasContainer.style.setProperty('--mobile-dynamic-padding', `${sidePadding}px`);
                } else {
                    canvasContainer.style.paddingBottom = `${clamped}px`;
                }
            }
        });
    };

    const onPointerMove = (event) => {
        if (dragStartY === null) return;
        const delta = event.clientY - dragStartY;
        setKeyboardHeight(startHeight - delta);
        event.preventDefault();
    };
    const onTouchMove = (event) => {
        if (dragStartY === null) return;
        const touch = event.touches[0];
        if (!touch) return;
        const delta = touch.clientY - dragStartY;
        setKeyboardHeight(startHeight - delta);
        event.preventDefault();
    };
    const stopDrag = () => {
        dragStartY = null;
        symbolPanel.classList.remove('grabbing');
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', stopDrag);
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', stopDrag);
    };

    const startDrag = (clientY, event) => {
        if (symbolPanel.classList.contains('hidden')) return;
        dragStartY = clientY;
        startHeight = symbolPanel.getBoundingClientRect().height;
        symbolPanel.classList.add('grabbing');
        on(document, 'pointermove', onPointerMove, { passive: false });
        on(document, 'pointerup', stopDrag);
        on(document, 'touchmove', onTouchMove, { passive: false });
        on(document, 'touchend', stopDrag);
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
    };

    on(keyboardGrip, 'pointerdown', (event) => {
        if (symbolPanel.classList.contains('hidden')) return;
        keyboardGrip.setPointerCapture(event.pointerId);
        startDrag(event.clientY, event);
    });

    on(keyboardGrip, 'touchstart', (event) => {
        if (symbolPanel.classList.contains('hidden')) return;
        const touch = event.touches[0];
        if (!touch) return;
        startDrag(touch.clientY, event);
    }, { passive: false });
}

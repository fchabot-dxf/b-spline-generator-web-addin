/**
 * Style mutators for the editor's text tool: font family, font size, and
 * symbol insertion. These operate on whichever element is the current
 * "text target":
 *   - editor._editingTextEl, if a session is active (live edit), OR
 *   - editor._selectedElement, if it's a <text> (out-of-session change).
 *
 * Each mutator that can change glyph metrics calls reanchorTextY so the
 * text's visual top stays anchored to data-anchor-y across font/size
 * changes — that's what keeps reflows from drifting upward as the user
 * cycles through fonts.
 */
import { reanchorTextY } from './editor-text-baseline.js';
import { dbg } from './debug.js';

export function initText(editor) {
    // Hidden input setup (currently a no-op — the markup is in the HTML).
}

export function setFontFamily(editor, family) {
    dbg('COORD_STD', `editor-text: setFontFamily to "${family}"`);
    editor._fontFamily = family;
    if (editor._editingTextEl) {
        editor._editingTextEl.font({ family });
        const size = parseFloat(editor._editingTextEl.attr('font-size')) || editor._fontSize;
        reanchorTextY(editor._editingTextEl, family, size);
    }
    // Fan out across every selected <text>. Non-text elements in the
    // selection are silently skipped — font props don't apply to them.
    const texts = (editor._selectedElements || []).filter(el => el && el.type === 'text');
    if (texts.length) {
        for (const el of texts) {
            el.font({ family });
            const size = parseFloat(el.attr('font-size')) || editor._fontSize;
            reanchorTextY(el, family, size);
        }
        if (typeof editor.pushState === 'function') editor.pushState();
        if (editor._onChange) editor._onChange();
    }
}

export function setFontSize(editor, size) {
    editor._fontSize = size;
    if (editor._editingTextEl) {
        editor._editingTextEl.font({ size });
        const family = (editor._editingTextEl.attr('font-family') || editor._fontFamily).replace(/['"]/g, '').trim();
        reanchorTextY(editor._editingTextEl, family, size);
    }
    const texts = (editor._selectedElements || []).filter(el => el && el.type === 'text');
    if (texts.length) {
        for (const el of texts) {
            el.font({ size });
            const family = (el.attr('font-family') || editor._fontFamily).replace(/['"]/g, '').trim();
            reanchorTextY(el, family, size);
        }
        if (typeof editor.pushState === 'function') editor.pushState();
        if (editor._onChange) editor._onChange();
    }
}

export function insertSymbol(editor, symbol, fontFamily) {
    dbg('COORD_STD', `editor-text: insertSymbol "${symbol}" (U+${symbol.codePointAt(0).toString(16).toUpperCase()}) with font "${fontFamily}"`);
    const appliedFamily = fontFamily || editor._fontFamily || 'Arial';

    // Apply the symbol font to the active text element so the inserted
    // glyph renders correctly — but do NOT touch editor._fontFamily.
    // setFontFamily would mutate it, which leaks the symbol font into
    // the user's next text session: their fresh "Arial" text would
    // actually be created with font-family="Symbol", look fine in the
    // live render (system fallback handles ASCII), and then silently
    // turn into Greek/icon glyphs at expand time because expandCurrent's
    // PUA mapping kicks in on font-family="Symbol".
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

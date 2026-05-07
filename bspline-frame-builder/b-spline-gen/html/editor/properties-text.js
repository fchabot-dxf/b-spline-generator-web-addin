/**
 * Text properties: the font-family dropdown and font-size stepper that
 * live in the editor's top toolbar. Wires UI controls to editor.setFontFamily
 * / editor.setFontSize and bootstraps the @font-face rules for the bundled
 * symbol fonts.
 *
 * The on-screen Symbol Keyboard (toggle, grid, resize, iOS keyboard
 * suppression) lives in editor-symbol-keyboard.js.
 */
import { el, on } from './dom.js';
import { injectFontFaceRules } from './editor-fonts.js';
import { initSymbolKeyboard } from './editor-symbol-keyboard.js';

export function initTextProperties(editor) {
    // Register @font-face rules for the bundled symbol fonts before any
    // keyboard rendering happens. Idempotent — safe even if some other
    // editor entry point ends up calling this twice.
    injectFontFaceRules();

    const fontFamilyEl = el('editorFontFamily');
    const fontSizeEl = el('editorFontSize');
    const fsMinus = el('editorFontSizeMinus');
    const fsPlus = el('editorFontSizePlus');

    on(fontFamilyEl, 'change', () => editor.setFontFamily(fontFamilyEl.value));
    on(fontSizeEl, 'input', () => {
        const s = parseFloat(fontSizeEl.value);
        if (!Number.isNaN(s) && s > 0) editor.setFontSize(s);
    });

    const stepFontSize = (delta) => {
        if (!fontSizeEl) return;
        const cur = parseFloat(fontSizeEl.value) || editor._fontSize;
        const next = Math.max(0.2, Math.round((cur + delta) * 10) / 10);
        fontSizeEl.value = next;
        editor.setFontSize(next);
    };

    on(fsMinus, 'click', () => stepFontSize(-0.2));
    on(fsPlus, 'click', () => stepFontSize(+0.2));

    initSymbolKeyboard(editor);
}

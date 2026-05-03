import { el, query, addClass, removeClass } from './dom.js';
import { initShapeProperties } from './properties-shape.js';
import { initTextProperties } from './properties-text.js';
import { registerEditorTools } from './tools/index.js';

const SYMBOL_FONT_RANGES = {
    'Symbol': { start: 32, end: 255 },
    'Webdings': { start: 32, end: 255 },
    'Wingdings': { start: 32, end: 255 },
    'Segoe UI Symbol': { start: 32, end: 255 },
    'Segoe MDL2 Assets': { start: 0xE700, end: 0xE7FF },
    'Segoe Fluent Icons': { start: 0xF700, end: 0xF7FF },
    'Segoe UI Emoji': { start: 0x1F300, end: 0x1F35F }
};

function setupEditorToolbar(editor) {
    registerEditorTools(editor);
    initShapeProperties(editor);
    initTextProperties(editor);

    const sidebarToggle = el('editorSidebarToggle');
    const sidebar = query('.editor-sidebar');
    sidebarToggle?.addEventListener('click', () => {
        if (!sidebar) return;
        sidebar.classList.toggle('collapsed');
    });
}

export { setupEditorToolbar };

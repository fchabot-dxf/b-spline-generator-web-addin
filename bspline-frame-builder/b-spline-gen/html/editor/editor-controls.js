import { el, query, addClass, removeClass } from './dom.js';
import { initShapeProperties } from './properties-shape.js';
import { initTextProperties } from './properties-text.js';
import { initExpandProperties } from './properties-expand.js';
import { registerEditorTools } from './tools/index.js';

function setupEditorToolbar(editor) {
    registerEditorTools(editor);
    initShapeProperties(editor);
    initTextProperties(editor);
    initExpandProperties(editor);

    const sidebarToggle = el('editorSidebarToggle');
    const sidebar = query('.editor-sidebar');
    sidebarToggle?.addEventListener('click', () => {
        if (!sidebar) return;
        sidebar.classList.toggle('collapsed');
    });

    const snapToggle = el('editorSnapToggle');
    snapToggle?.addEventListener('click', () => {
        editor.toggleSnapping();
    });
}

export { setupEditorToolbar };

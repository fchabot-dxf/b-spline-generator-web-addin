import { initShapeProperties } from './properties-shape.js';
import { initTextProperties } from './properties-text.js';
import { initExpandProperties } from './properties-expand.js';
import { initLatticeProperties } from './properties-lattice.js';
import { initShapeLatticeProperties } from './properties-shape-lattice.js';
import { initTouchActionsProperties } from './properties-touch-actions.js';
import { registerEditorTools } from './tools/index.js';

// SA-DEAD-5: the #editorSidebarToggle click handler (collapse/expand the
// rail via a .collapsed class) removed — triple-dead: no such button in
// the palette markup, no CSS rule for `.editor-sidebar.collapsed`
// anywhere, and superseded by SE7m's responsive `@media` layout for the
// same "sidebar doesn't fit narrow" problem.
function setupEditorToolbar(editor) {
    registerEditorTools(editor);
    initShapeProperties(editor);
    initTextProperties(editor);
    initExpandProperties(editor);
    initLatticeProperties(editor); // SE7b slice 3
    initShapeLatticeProperties(editor); // T58 (SE14 Slice 3)
    initTouchActionsProperties(editor); // SE7m
}

export { setupEditorToolbar };

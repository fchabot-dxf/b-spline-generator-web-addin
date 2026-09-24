/**
 * properties-touch-actions.js — SE7m: wires the on-screen Copy/Paste/
 * Select-all/Cancel/Lock group (bspline_gen_palette.html's
 * #editorTouchActionsGroup, shown only under (pointer: coarse) —
 * styles/editor.css). Same per-panel-module shape as properties-shape.js
 * / properties-text.js / properties-expand.js / properties-lattice.js.
 *
 * Copy/Paste/Select-all reuse the exact functions the Ctrl+C/V/A keydown
 * handler already calls (editor-interaction.js) — one behavior, two
 * input paths, not a second copy of the clipboard logic. Cancel reuses
 * the same cancelCurrentDrawing the Esc key path exercises indirectly
 * (editor._cancelDrawing). Lock has no keyboard equivalent to reuse —
 * it's a persistent toggle standing in for a MOMENTARY held key
 * (Shift), read by editor-interaction.js's handleMove as
 * `!!e.shiftKey || !!editor._lockAspect`.
 */
import { el, on } from './dom.js';
import { copySelection, pasteClipboard, selectAllVisible, cancelCurrentDrawing } from './editor-interaction.js';

export function initTouchActionsProperties(editor) {
    const copyBtn = el('editorTouchCopy');
    const pasteBtn = el('editorTouchPaste');
    const selectAllBtn = el('editorTouchSelectAll');
    const cancelBtn = el('editorTouchCancel');
    const lockBtn = el('editorTouchLock');

    on(copyBtn, 'click', () => copySelection(editor));
    on(pasteBtn, 'click', () => pasteClipboard(editor));
    on(selectAllBtn, 'click', () => selectAllVisible(editor));
    on(cancelBtn, 'click', () => cancelCurrentDrawing(editor));

    if (lockBtn) {
        on(lockBtn, 'click', () => {
            editor._lockAspect = !editor._lockAspect;
            lockBtn.classList.toggle('active', !!editor._lockAspect);
        });
    }
}

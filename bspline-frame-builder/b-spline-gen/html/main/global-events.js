/**
 * Global keyboard shortcuts + sculpt-panel undo/redo/clear button wiring.
 *
 * Run after initApp / initSvgEditor — the sculpt buttons and editor-undo
 * targets need to exist in the DOM by the time we bind them.
 */
import { unifiedUndo, unifiedRedo, isEditorOpen } from '../core/history.js';
import { sculptClear, updatePreviewSculptMode } from '../core/sculpt-interaction.js';
import { rebuild, scheduleRebuild } from '../core/engine.js';
import { updateStampMasks } from './stamp-mask-manager.js';
import { applySnapshot } from './snapshot-manager.js';
import { _isTypingTarget } from '../editor/dom.js';

export function wireGlobalEvents(preview) {
    window.addEventListener('keydown', e => {
        if (!(e.ctrlKey || e.metaKey)) return;
        if (_isTypingTarget(e.target)) return;

        // Ctrl+Z = undo. Ctrl+Y or Ctrl+Shift+Z = redo. When the SVG
        // editor modal is open, route to its private undo stack
        // (window.svgEditor.undo/redo) — unifiedUndo/Redo already
        // early-out via isEditorOpen() so they don't double-fire.
        const editorOpen = isEditorOpen();

        if (e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            if (editorOpen) window.svgEditor?.undo();
            else unifiedUndo(snap => applySnapshot(snap, preview));
            return;
        }
        if (e.key === 'y' || (e.key === 'Z' && e.shiftKey) || (e.key === 'z' && e.shiftKey)) {
            e.preventDefault();
            if (editorOpen) window.svgEditor?.redo();
            else unifiedRedo(snap => applySnapshot(snap, preview));
            return;
        }
    });

    const undo = (snap) => applySnapshot(snap, preview);
    const rebuildSoon = (delay) => scheduleRebuild(
        () => rebuild(preview, updateStampMasks, updatePreviewSculptMode),
        delay,
    );

    const uBtn = document.getElementById('btnGlobalUndo');
    const rBtn = document.getElementById('btnGlobalRedo');
    if (uBtn) uBtn.addEventListener('click', () => unifiedUndo(undo));
    if (rBtn) rBtn.addEventListener('click', () => unifiedRedo(undo));

    const clearTop = document.getElementById('btnSculptTopClear');
    const clearBot = document.getElementById('btnSculptBotClear');
    if (clearTop) clearTop.addEventListener('click', () => sculptClear('top', rebuildSoon));
    if (clearBot) clearBot.addEventListener('click', () => sculptClear('bot', rebuildSoon));

    const undoTop = document.getElementById('btnSculptTopUndo');
    const undoBot = document.getElementById('btnSculptBotUndo');
    if (undoTop) undoTop.addEventListener('click', () => unifiedUndo(undo));
    if (undoBot) undoBot.addEventListener('click', () => unifiedUndo(undo));

    const redoTop = document.getElementById('btnSculptTopRedo');
    const redoBot = document.getElementById('btnSculptBotRedo');
    if (redoTop) redoTop.addEventListener('click', () => unifiedRedo(undo));
    if (redoBot) redoBot.addEventListener('click', () => unifiedRedo(undo));
}

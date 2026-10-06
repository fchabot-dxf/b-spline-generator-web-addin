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
import { getEditorTab, EDITOR_TABS } from './editor-tabs.js';
import { deselectTool as deselectBrickTool } from './brick-panel.js';
import { deselectPhotoTool } from './photo-panel.js';

/** "Back to the select tool" for a tab -- the ONE path both Esc and a tab switch use. Dispatches by
 *  tab rather than unifying onto one shared mode concept (Wall/Frame/Photo's own tools have no
 *  gesture "mode" to exit; Brick's deselect also clears its own active tool). */
function returnToSelect(tab) {
    if (tab === 'brick') deselectBrickTool();
    else if (tab === 'photo') deselectPhotoTool();
    else window.svgEditor?.setMode?.('select');
}

/** Fred (2026-10-04): entering a tab drops a tool mode that tab doesn't own (EDITOR_TABS[].modes).
 *  Returning to the old tab does not restore the old tool. */
export function dropForeignModeOnTabChange(tabId) {
    const ed = typeof window !== 'undefined' ? window.svgEditor : null;
    const tab = EDITOR_TABS.find((t) => t.id === tabId);
    if (!ed || !tab?.modes) return;
    if (!tab.modes.includes(ed._currentMode)) returnToSelect(tabId);
}

export function wireGlobalEvents(preview) {
    document.addEventListener('editorTabChanged', (e) => dropForeignModeOnTabChange(e.detail?.tab));

    window.addEventListener('keydown', e => {
        // F35 (advisor: "Esc = back to the select tool in every tab"): dispatches by the
        // CURRENTLY ACTIVE editor tab rather than unifying onto one shared mode concept (Wall/
        // Frame/Photo's own tools have no gesture "mode" to exit) -- Artwork's own Draw-mode
        // anchor-path-cancel (editor-interaction.js's own Escape handler, installed only while
        // actively placing anchor points) stays completely separate and still runs first; this
        // always ALSO returns the editor to plain Select afterward, which is the literal ask.
        if (e.key === 'Escape' && isEditorOpen() && !_isTypingTarget(e.target)) {
            returnToSelect(getEditorTab());
        }

        if (!(e.ctrlKey || e.metaKey)) return;
        if (_isTypingTarget(e.target)) return;

        // Ctrl+Z = undo. Ctrl+Y or Ctrl+Shift+Z = redo. When the SVG
        // editor modal is open, route to its private undo stack
        // (window.svgEditor.undo/redo) — unifiedUndo/Redo already
        // early-out via isEditorOpen() so they don't double-fire.
        const editorOpen = isEditorOpen();
        // FB-APP F8: in the editor's Frame tab the artwork is read-only, so its undo stack is too.
        if (editorOpen && window.svgEditor?._artworkLocked) return;

        if (e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            if (editorOpen) window.svgEditor?.undo();
            else unifiedUndo((snap, frame) => applySnapshot(snap, preview, { source: 'undo', frame }));
            return;
        }
        if (e.key === 'y' || (e.key === 'Z' && e.shiftKey) || (e.key === 'z' && e.shiftKey)) {
            e.preventDefault();
            if (editorOpen) window.svgEditor?.redo();
            else unifiedRedo((snap, frame) => applySnapshot(snap, preview, { source: 'undo', frame }));
            return;
        }
    });

    // T45: global undo/redo (buttons + sculpt top/bottom variants below) —
    // 'undo' for all of them, including the redo direction; applySnapshot's
    // own `source` only distinguishes undo/redo-family FROM a project
    // load, not undo from redo (both leave the drawing untouched).
    const undo = (snap, frame) => applySnapshot(snap, preview, { source: 'undo', frame });
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

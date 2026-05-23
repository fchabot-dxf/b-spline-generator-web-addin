import { bindClick } from '../dom.js';

export function registerActionTools(editor) {
  const bind = (id, fn) => bindClick(id, fn);

  bind('toolDelete', () => editor.deleteSelected());
  bind('editorUndo', () => editor.undo());
  bind('editorRedo', () => editor.redo());

  // Transform attribute management (paired with the on-canvas rotate
  // and scale handles in select mode). Both no-op when nothing's
  // selected; flatten silently no-ops for element types it can't
  // represent (e.g. <text>) — user can Expand text first then flatten.
  bind('toolResetTransform',   () => editor.resetSelectionTransform());
  bind('toolFlattenTransform', () => editor.flattenSelectionTransform());

  bind('toolClear', () => {
    if (confirm('Clear all?')) {
      editor._sketchLayer.clear();
      editor.pushState();
      if (editor._onChange) editor._onChange();
    }
  });

  bind('editorClear', () => {
    if (confirm('Clear all?')) {
      editor._sketchLayer.clear();
      editor.pushState();
      if (editor._onChange) editor._onChange();
    }
  });

  bind('editorDownload', async () => {
    const svgText = await editor.saveWithTextCopies();
    if (!svgText) return;
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:T]/g, '-').replace(/\.\d+Z$/, '');
    const name = `svg-editor-${timestamp}.svg`;
    if (typeof saveAs === 'function') {
      saveAs(blob, name);
    } else {
      const link = document.cre
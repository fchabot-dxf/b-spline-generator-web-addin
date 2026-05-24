import { bindClick } from '../dom.js';

export function registerActionTools(editor) {
  const bind = (id, fn) => bindClick(id, fn);

  bind('toolDelete', () => editor.deleteSelected());
  bind('editorUndo', () => editor.undo());
  bind('editorRedo', () => editor.redo());

  // Transform attribute helpers (paired with the on-canvas rotate/scale
  // handles). Both no-op when nothing's selected.
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
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  });

  bind('editorApply', () => {
    editor._commitText();
    if (editor._onCommit) editor._onCommit(editor.save());
  });

  bind('editorCancel', () => {
    if (editor._onCommit) editor._onCommit(null);
  });
}

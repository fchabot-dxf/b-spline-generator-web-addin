import { bindClick } from '../dom.js';
import { endEditorSession } from '../editor-text-session.js';

export function registerActionTools(editor) {
  const bind = (id, fn) => bindClick(id, fn);

  bind('toolDelete', () => editor.deleteSelected());
  bind('editorUndo', () => editor.undo());
  bind('editorRedo', () => editor.redo());

  // SE2: reset zoom/pan to fit the whole board.
  bind('toolFit', () => editor.fitView());

  // Transform attribute helpers (paired with the on-canvas rotate/scale
  // handles). Both no-op when nothing's selected.
  bind('toolResetTransform',   () => editor.resetSelectionTransform());
  bind('toolFlattenTransform', () => editor.flattenSelectionTransform());

  bind('editorClear', () => {
    if (confirm('Clear all?')) {
      editor._sketchLayer.clear();
      // T8: the cleared elements may still be selected — deselect so their
      // highlight halo / transform handles (separate layers, untouched by
      // _sketchLayer.clear()) don't ghost on screen.
      if (typeof editor._deselect === 'function') editor._deselect();
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

  // SE8a / SA-TEXT-1: both go through the ONE editor-close contract now —
  // Cancel used to skip text-session teardown entirely (see
  // endEditorSession's own comment for the leaked-listener failure mode).
  bind('editorApply',  () => endEditorSession(editor, { commit: true }));
  bind('editorCancel', () => endEditorSession(editor, { commit: false }));
}

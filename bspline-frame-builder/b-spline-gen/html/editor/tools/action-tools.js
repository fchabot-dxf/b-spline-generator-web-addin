import { bindClick } from '../dom.js';
import { endEditorSession } from '../editor-text-session.js';
import { isUnexpandable, unexpand } from '../editor-expand-commit.js';
import { resetArtworkToFresh } from '../editor-io.js';
import { clearFrame } from '../editor-frame-profile.js';
import { refreshGuides } from '../editor-guides.js';
import { commitEdit } from '../editor-commit.js';
import { confirmDialog } from '../../core/confirm-dialog.js';

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

  // H20 item 3 (Fred: "Clear all doesn't clear all" -- the layer list,
  // per-layer metadata and Lattice/Shape-Lattice pattern state all survived
  // the old Clear, which only wiped _sketchLayer): scoped to whichever tab
  // is active (live correction, Fred: "Clear scoped to the active tab --
  // the Artwork tab clears only the artwork, the Frame tab only the
  // frame" -- supersedes the original dispatch's "Does NOT touch the
  // Frame" wording, which never made it into NEXT-SESSION.md's own text;
  // see WORK-LOG for which channel this was confirmed through).
  bind('editorClear', () => {
    if (!confirm('Clear all?')) return;
    if (editor._editorTab === 'frame') {
      // The Frame tab's own undo (pushFrameHistory, inside the handler)
      // is a completely separate stack from the artwork's -- Ctrl+Z here
      // undoes the frame, never the artwork (F8's existing split).
      clearFrame();
      return;
    }
    // Artwork tab: reset to EXACTLY a fresh session's artwork -- one
    // default layer, no elements, no lattice/shape-lattice pattern state
    // (resetArtworkToFresh is the SAME function open()'s own empty-session
    // path uses, declared once in editor-io.js). editor.pushState() below
    // is what makes this ONE undo step (resetArtworkToFresh's own internal
    // addLayer call is skipUndo, by design).
    //
    // F35 (Fred: "Clear leaves a ghost of the old content"): this used to
    // also call sync3DBackground(editor) right here, before commitEdit --
    // that snapshots whatever #svgEditorTopView CURRENTLY shows into the
    // background layer, but nothing has repainted that canvas yet at this
    // point, so it always captured the STALE, pre-Clear terrain. The only
    // thing that ever repaints #svgEditorTopView for real is the async
    // commitEdit -> onChange('commit') -> remask -> rebuild() ->
    // updateEditorTopView() chain below, which calls sync3DBackground
    // itself once the terrain is actually recomputed -- the call removed
    // here was redundant with that AND guaranteed to render stale content
    // in the meantime. Every other edit (draw, delete, ...) already
    // relies on that same chain alone with no ghost; Clear now does too.
    resetArtworkToFresh(editor);
    refreshGuides(editor);
    commitEdit(editor); // audit batch 3: the one commit
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
  // workflow audit #5: Cancel sits next to Apply and used to drop every edit without a word -- it asks first when
  // there is anything to lose (the editor's own undo stack holds only the opening state otherwise)
  bind('editorCancel', async () => {
    const changed = Array.isArray(editor._undoStack) && editor._undoStack.length > 1;
    if (changed && !(await confirmDialog('Discard the changes made in the editor?',
      { okLabel: 'Discard', cancelLabel: 'Keep editing', zIndex: 10002 }))) return;
    endEditorSession(editor, { commit: false });
  });

  // SE8e / SA-TEXT-4: no dynamically-disabled button state — the natural
  // home for selection-reactive enable/disable (editor-ui.js's toolbar/
  // selection-highlight update) is seat B's SE7m territory this turn.
  // Always clickable; the handler itself no-ops (per element AND as a
  // whole) when the selection isn't entirely restorable, matching the
  // dispatch's own "disabled / no-op" contract. Multi-selection: each
  // qualifying element gets its own full unexpand() (its own pushState +
  // select) — a mixed batch ends with only the LAST one selected and one
  // undo step per element rather than a single combined step; acceptable
  // for now since unexpand() itself is the single-element contract the
  // dispatch describes, and this isn't covered by its own Verify list.
  bind('editorUnexpand', () => {
    const sel = (editor._selectedElements || []).slice();
    if (!sel.length || !sel.every(isUnexpandable)) return;
    for (const el of sel) unexpand(editor, el);
  });
}

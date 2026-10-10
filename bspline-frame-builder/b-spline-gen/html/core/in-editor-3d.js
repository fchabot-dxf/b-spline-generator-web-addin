/**
 * F35 item 18 (4), Fred's "no 3D while editing" (the editor loads fast, Apply builds the 3D), for the changes that do NOT
 * come through the editor's own onChange (main/app-init.js CHANGE_PIPELINE_IN_EDITOR covers those): a panel inside the
 * editor that calls back on its own -- every slider step, every button -- had bypassed it. One row per kind of change:
 * what it does while the editor is OPEN, and when it is closed. The 3D is built when the session ends: Apply, Cancel
 * (both remask + rebuild), or the 3D toggle (Apply's way; app-init.js editorSessionFingerprint covers every row below).
 *
 * MEASURED 2026-10-08 (phone width, 4x CPU, editor open): a Photo straighten step was a full rebuild, 2.2 s (the frame
 * mesh 1.4 s of it) -- a drag 4.9 - 8.5 s (seat D); a relief-height step a full rebuild, ~1 s; every Frame-tab write
 * (Generate, template, thickness, inset window, undo) re-applied the hidden 3D frame, 226 - 357 ms.
 *
 * Actions: 'backdrop' -- repaint the editor's backdrop (core/render-topview.js refreshEditorTopView), the change's live
 * feedback in the editor; 'rebuild' -- the full rebuild; 'profile' -- the editor's own 2D drawing only (the frame's cut
 * profile and the board outline, drawn by the caller) ; 'refresh3D' -- that plus the 3D frame (preview.refreshFrame);
 * 'none' -- nothing now.
 *
 * `inEditorDrag` (Fred 2026-10-09, seat D's phone measure: a Photo blur drag repainted the backdrop on every tick, ~160 ms
 * each at 4x CPU): a SLIDER's drag tick with the editor open does nothing to the backdrop -- the Photo panel's own preview
 * stays live -- and the slider's release repaints it once (the panel notifies again without `drag`). A row without it
 * acts the same on every tick. Same idea as the brick sliders' declared slow-drag rule.
 *
 * `restoring`: what the change does while applySnapshot restores P (a project load, a global undo), editor open or not.
 * The restore ends in its own rebuild, which meshes the 3D frame on the RESTORED board (preview update -> _applyFrame).
 * MEASURED 2026-10-09 (seat E): a 9x12 project with an inset window at (0, 3.6) 2.0 x 2.6, loaded into a fresh 7x9 page,
 * re-meshed the frame mid-restore on the PREVIOUS board's panel -- the window's bars reach y 4.9, past that panel's 4.5,
 * found no surface (frame-mesh.js bot: null.lo) and the throw aborted the restore before the drawing reopened: 0 of 240
 * bricks back.
 */
import { isEditorOpen, isRestoring } from './history.js';

export const IN_EDITOR_3D = Object.freeze({
  photo: Object.freeze({ inEditor: 'backdrop', inEditorDrag: 'none', closed: 'rebuild' }), // the Photo tab's edits (main/photo-panel.js)
  // (no 'relief' row since 2026-10-10: Fred moved the photo's Max Height out -- the board Z is edited in Board only, and
  // a pattern pick no longer writes it; nothing in the photo panel writes P.carveZ any more)
  frame: Object.freeze({ inEditor: 'profile', closed: 'refresh3D', restoring: 'profile' }), // a frame-record write (main/frame-panel.js)
});

/** What a change of `kind` does now: its row's action during a restore (when it declares one), else for whether the
 *  editor is open (`drag`: a slider's drag tick). */
export function inEditor3dAction(kind, { drag = false } = {}) {
  const row = IN_EDITOR_3D[kind];
  if (row.restoring && isRestoring()) return row.restoring;
  if (!isEditorOpen()) return row.closed;
  return drag && row.inEditorDrag ? row.inEditorDrag : row.inEditor;
}

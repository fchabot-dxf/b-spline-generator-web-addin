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
 * profile and the board outline, drawn by the caller) ; 'refresh3D' -- that plus the 3D frame (preview.refreshFrame).
 */
import { isEditorOpen } from './history.js';

export const IN_EDITOR_3D = Object.freeze({
  photo: Object.freeze({ inEditor: 'backdrop', closed: 'rebuild' }), // the Photo tab's edits (main/photo-panel.js)
  relief: Object.freeze({ inEditor: 'backdrop', closed: 'rebuild' }), // its relief height (P.carveZ: the backdrop shades by it)
  frame: Object.freeze({ inEditor: 'profile', closed: 'refresh3D' }), // a frame-record write (main/frame-panel.js)
});

/** What a change of `kind` does now: its row's action for whether the editor is open. */
export function inEditor3dAction(kind) {
  return IN_EDITOR_3D[kind][isEditorOpen() ? 'inEditor' : 'closed'];
}

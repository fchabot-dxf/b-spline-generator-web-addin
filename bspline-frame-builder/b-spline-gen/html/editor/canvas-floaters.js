/**
 * editor/canvas-floaters.js -- the controls that float in the TOP of the 2D editor's canvas area (the [2D | 3D] pill,
 * main/view-mode-toggle.js, top-left; the Height readout, main/height-panel.js, top-right) must stay inside the canvas
 * and never sit on the phone drawer. On a phone the drawer is fixed to the viewport bottom and, raised to its full
 * height, covers the canvas up to its top edge: the pill and the readout (positioned from the canvas top) then floated
 * over the drawer's tool row (Draw: Select, Brick: Wall). Same idea as the undo/redo pill's `editor-history-no-room`
 * (editor.js): measure the room between the canvas top and the drawer top; below FLOATER_ROOM_PX the canvas carries
 * CANVAS_NO_ROOM_CLASS and styles/editor.css hides the floaters (visibility, so the layout does not move) until the
 * drawer comes back down. Only while the drawer is a fixed bottom sheet (portrait phone); landscape / desktop never hide.
 */
export const CANVAS_NO_ROOM_CLASS = 'canvas-floaters-no-room';
/** The room a top-anchored floater needs: its 10-12 px inset, a 28 px touch-target tall pill, and the same again below. */
export const FLOATER_ROOM_PX = 56;

/** Pure: true when the floaters have no room above the drawer. `drawerFixed` = the drawer is a fixed bottom sheet. */
export function floatersHaveNoRoom({ drawerTop, canvasTop, drawerFixed }) {
  return !!drawerFixed && (drawerTop - canvasTop) < FLOATER_ROOM_PX;
}

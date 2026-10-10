/**
 * editor/editor-tab-selectable.js -- what each editor tab may SELECT on the canvas (Fred 2026-10-10, his rule: "I
 * shouldn't be able to select brick in Artwork, or vice versa"; his phone: Artwork > Edit > Select picked a Frame
 * stone). One declared table, one predicate; every picker reads it -- the hit test (editor-hit.js getNearbyElement,
 * so a tap, a hold's menu and a double-tap multi-select never even find a foreign piece), the pick of a tap / aim
 * (editor-interaction.js _pickSelectable), the cut tool's line pick (editor-cut-tool.js), and the selection writers
 * themselves (editor-ui.js select / selectAdd / selectMany: the marquee, Select all, the menu's "Select all <kind>",
 * any programmatic pick); a tab switch drops what the new tab can't own (editor-frame-profile.js setEditorFocus), so
 * Delete / nudge only ever act on the tab's own kind. A tap on a piece the tab doesn't own is a tap on empty canvas.
 */

/** A drawing node's kind: 'brick' = anything the brick tools own (a laid piece, a Brush spine, the grout -- all
 *  carry `data-brick` -- or an element's record); 'art' = everything else (strokes, shapes, text, lattice, contour). */
export function selectKindOf(node) {
  const n = node && (node.node || node);
  if (!n || typeof n.hasAttribute !== 'function') return 'art';
  return n.hasAttribute('data-brick') || n.hasAttribute('data-brick-record') ? 'brick' : 'art';
}

/** Per editor tab: the kinds of drawing node it may select, and its empty-canvas menu's "Select all" label (Fred: named
 *  by the tab). Frame: the frame's own handles only (not drawing nodes; the artwork is locked there anyway); Photo:
 *  nothing on the canvas. */
export const EDITOR_TAB_SELECTABLE = Object.freeze({
  artwork: Object.freeze({ kinds: Object.freeze(['art']), selectAllLabel: 'Select all artwork' }),
  brick: Object.freeze({ kinds: Object.freeze(['brick']), selectAllLabel: 'Select all bricks' }),
  frame: Object.freeze({ kinds: Object.freeze([]), selectAllLabel: 'Select all' }),
  photo: Object.freeze({ kinds: Object.freeze([]), selectAllLabel: 'Select all' }),
});

/** The editor's current tab (setEditorFocus records it; before any switch, its frame / artwork mode). */
const tabOf = (editor) => editor?._focusTab ?? editor?._editorTab ?? 'artwork';

/** May `node` be selected / picked in `editor`'s current tab? An undeclared tab allows everything (no new rule). */
export function isSelectableInTab(editor, node) {
  const decl = EDITOR_TAB_SELECTABLE[tabOf(editor)];
  return !decl || decl.kinds.includes(selectKindOf(node));
}

/** The empty-canvas menu's "Select all" label for the open tab. */
export function selectAllLabelFor(editor) {
  return EDITOR_TAB_SELECTABLE[tabOf(editor)]?.selectAllLabel || 'Select all';
}

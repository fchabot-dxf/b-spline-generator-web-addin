/**
 * core/frame-labels.js -- Fred (2026-10-11): the app has two different "Frame"s and both were called Frame. ONE table names
 * them wherever a user reads it: the WOOD frame (the board's milled frame: sidebar Board > Wood frame, the editor's top
 * tab, its panel, the Clear menu, the SVG file's bottom group, the hints that point at it) and the BRICK frame (the brick
 * bands laid along it: the Brick tab's tool and section, the sidebar BRICK row, the brick element / layer names and the
 * undo labels built from them). Ids never change (the matrix, saved boards); only what is shown.
 * Static page text carries data-frame-label="wood" | "brick" and is written by applyFrameLabels; code reads the table.
 */
export const FRAME_LABELS = Object.freeze({
  wood: 'Wood frame',
  brick: 'Brick frame',
});

/** Writes the table's text into every [data-frame-label] element under `root` (the page at boot). */
export function applyFrameLabels(root = typeof document !== 'undefined' ? document : null) {
  if (!root) return;
  for (const el of root.querySelectorAll('[data-frame-label]')) {
    const text = FRAME_LABELS[el.dataset.frameLabel];
    if (text) el.textContent = text;
  }
}

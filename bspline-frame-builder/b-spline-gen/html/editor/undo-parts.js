/**
 * editor/undo-parts.js -- F35 item 38: the declared PARTS of an editor undo entry beyond the drawing. An entry
 * (editor.js _snapshotState) is { svg, layers, activeLayer, parts }: `parts[name]` = what `take()` returned when the
 * entry was pushed, put back by `restore(value)` when undo / redo restores that entry (before the commit pipeline
 * runs, so the persist / re-mask sees it). One undo stack: a part rides in the SAME entry as the canvas it produced.
 * Measured before (seat C 02): Undo put the canvas back but the brick settings that laid it stayed changed.
 * The editor never knows what a part is: a feature registers its own (main/brick-panel.js: 'brickSettings').
 */
export const UNDO_PARTS = new Map();

/** `part` = { take: () => value, restore: (value) => void }; the same name again replaces it. */
export function registerUndoPart(name, part) {
  UNDO_PARTS.set(name, part);
}

export const takeUndoParts = () => Object.fromEntries([...UNDO_PARTS].map(([name, part]) => [name, part.take()]));

/** An entry without parts (pushed before a part was registered) restores the drawing only. */
export function restoreUndoParts(parts) {
  if (!parts) return;
  for (const [name, part] of UNDO_PARTS) if (name in parts) part.restore(parts[name]);
}

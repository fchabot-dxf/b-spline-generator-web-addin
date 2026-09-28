/**
 * editor-commit.js -- Audit (batch 3): THE way a discrete edit ends. One undo step, then the full commit
 * pipeline (_notifyChange('commit'): outline preview, Shape Lattice detach check, boundary refill, guides, then
 * persist/remask). Four idioms did this job; the bare `pushState(); _onChange()` one silently skipped the
 * refill / detach / preview / guides (a deleted contour piece's refill then landed inside the NEXT edit's step).
 * Tolerant of test doubles that lack one of the methods.
 */
export function commitEdit(editor) {
  if (!editor) return;
  if (typeof editor.pushState === 'function') editor.pushState();
  if (typeof editor._notifyChange === 'function') editor._notifyChange('commit');
  else if (editor._onChange) editor._onChange();
}

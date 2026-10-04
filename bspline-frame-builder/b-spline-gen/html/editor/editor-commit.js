/**
 * editor-commit.js -- Audit (batch 3): THE way a discrete edit ends. One undo step, then the full commit
 * pipeline (_notifyChange('commit'): outline preview, Shape Lattice detach check, boundary refill, guides, then
 * persist/remask). Four idioms did this job; the bare `pushState(); _onChange()` one silently skipped the
 * refill / detach / preview / guides (a deleted contour piece's refill then landed inside the NEXT edit's step).
 * Tolerant of test doubles that lack one of the methods.
 */
import { syncLayerZOrder } from './layers.js';

export function commitEdit(editor) {
  if (!editor) return;
  // F35 item 3: a generic "a discrete edit just committed" signal, dispatched
  // FIRST (before the undo snapshot) so a synchronous listener's own DOM
  // mutations -- e.g. editor-brick-tool.js's regenerateOwnedBrickElements,
  // reacting to a cut/join/move on a brick's own spine -- land in THIS same
  // undo step rather than being invisible to it. Same declared-bridge
  // convention as layers.js's own 'layer-tooling-commit' CustomEvent.
  if (typeof document !== 'undefined' && typeof CustomEvent !== 'undefined') {
    document.dispatchEvent(new CustomEvent('editorCommit', { detail: { editor } }));
  }
  syncLayerZOrder(editor); // before the snapshot: the step stores the drawing in its proper order
  if (typeof editor.pushState === 'function') editor.pushState();
  if (typeof editor._notifyChange === 'function') editor._notifyChange('commit');
  else if (editor._onChange) editor._onChange();
}

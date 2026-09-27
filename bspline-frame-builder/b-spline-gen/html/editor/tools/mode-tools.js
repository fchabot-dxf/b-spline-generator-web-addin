import { bindClick } from '../dom.js';

export function registerModeTools(editor) {
  const bind = (id, fn) => bindClick(id, fn);

  bind('toolSelect', () => editor.setMode('select'));
  bind('toolNode', () => editor.setMode('node'));
  bind('toolDraw', () => editor.setMode('draw'));
  bind('toolLine', () => editor.setMode('line'));
  bind('toolRect', () => editor.setMode('rect'));
  bind('toolCircle', () => editor.setMode('circle'));
  bind('toolText', () => editor.setMode('text'));
  // Vector eraser: drag a stroke to subtract from filled shapes and
  // split open strokes. Width follows the sidebar's stroke width.
  bind('toolErase', () => editor.setMode('erase'));
  // SE7a: rails/ties on the grid, auto-nodes at ends and crossings.
  bind('toolLattice', () => editor.setMode('lattice'));
  // T58 (SE14 Slice 3): a generated/picked silhouette, filled by the SAME
  // engine as toolLattice above — its own tool since it edits per-segment
  // shape, not just rails/ties.
  bind('toolShapeLattice', () => editor.setMode('shapeLattice'));
  // SE16 ✂: split a line (rail, tie or plain) where tapped; tap the cut again to join.
  bind('toolCut', () => editor.setMode('cut'));
  // F27 item 3: tap a line to split it into equal stripes cycling Colours A/B(/C); tap again to re-stripe.
  bind('toolStripe', () => editor.setMode('stripe'));
}

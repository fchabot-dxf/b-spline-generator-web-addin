/**
 * Pull from Fusion -- the add-in's 'sketch_pulled' reply (b-spline-gen.py _handle_pull_sketch), handled here as a
 * named handler like frame_result's (main.js dispatches the message by its declared name), not inline in main.js's
 * own big dispatcher. Seat A 2026-10-14 (advisor, Fred: "fix now"), ported from the closed pull-fusion-safe branch
 * and made board-aware: the board is resized ONLY by a size THIS BOARD's own Fusion parameters declare (sizeSource
 * 'fusion'); a board without one keeps the palette's board (the curves were placed on it), with a note when the
 * sketch reaches past it; the curve types the pull left out (or failed to read) are said, never dropped in
 * silence; the loading card is held from the request to here.
 *
 * STEP (a) SCOPE NOTE: the curve-import target is still the 'Fusion Sketch' layer, same as before this slice --
 * Fred's rails-custom-position-+-lock slice (Send-tagged rail ids, pulled curves reshape the real lattice rails in
 * place) replaces this specific piece later; it's its own slice after this one (advisor 2026-10-16), not this one.
 * Board-scoping (the part that matters for this step) already lives entirely on the Python side (b-spline-gen.py's
 * BoardScope) -- this module only sends/reads the board id and applies whatever curves/size come back.
 *
 * STEP (b) (seat D 2026-10-16): board/layer/frame PARAMETERS no longer apply themselves on the reply -- they go
 * through the change-list dialog (core/pull-changelist.js buildChangeList + main/pull-changelist.js
 * showChangeListDialog/applyChangeList), Fred's "nothing changes until Apply" rule. The curve import above is
 * unconditional/unchanged (step (a) scope); PULL_MAP's own rows (width/height, node/rail/tie width, frame
 * settings) are what the dialog gates.
 */
import { P } from '../core/state.js';
import { addLayer, setActiveLayer } from '../editor/layers.js';
import { showToast } from '../core/toast.js';
import { setFusionStatus, fusLog } from '../core/fusion-bridge.js';
import { releaseHeldStage } from '../core/loading-signal.js';
import { getFrameRecord } from '../core/frame-record.js';
import { buildChangeList } from '../core/pull-changelist.js';
import { showChangeListDialog, hasChanges, applyChangeList } from './pull-changelist.js';

/** The add-in's reply action, and the loading stage held while it walks the sketch. */
export const SKETCH_PULLED = 'sketch_pulled';
export const PULL_SKETCH_STAGE = 'pullSketch';
/** The layer the pulled curves replace their previous copy on (step (a) only -- see the module doc comment). */
export const PULLED_LAYER_NAME = 'Fusion Sketch';
/** How a skipped / failed curve collection is said (the add-in's PULL_SKETCH_UNSUPPORTED + its own curve kinds). */
export const PULLED_CURVE_WORDS = Object.freeze({
  sketchFixedSplines: 'fixed spline', sketchControlPointSplines: 'control-point spline', sketchEllipses: 'ellipse',
  sketchEllipticalArcs: 'elliptical arc', sketchConicCurves: 'conic', line: 'line', circle: 'circle', arc: 'arc', spline: 'spline',
});
const counted = (byKind) => Object.entries(byKind || {}).filter(([, n]) => n > 0)
  .map(([k, n]) => `${n} ${PULLED_CURVE_WORDS[k] || k}${n > 1 ? 's' : ''}`);

/** The notes a pull leaves (none = the empty list): what it left out, what failed, a sketch past the kept board. */
export function pulledSketchNotes(data, board = { widthIn: P.widthIn, heightIn: P.heightIn }) {
  const notes = [];
  const skipped = counted(data.skipped);
  if (skipped.length) notes.push(`Not imported (not supported yet): ${skipped.join(', ')}.`);
  const failed = counted(data.failed);
  if (failed.length) notes.push(`Could not be read: ${failed.join(', ')}.`);
  const b = data.bounds;
  if (data.sizeSource !== 'fusion' && b && (b.x0 < -1e-3 || b.y0 < -1e-3 || b.x1 > board.widthIn + 1e-3 || b.y1 > board.heightIn + 1e-3)) {
    const w = (b.x1 - b.x0).toFixed(2), h = (b.y1 - b.y0).toFixed(2);
    notes.push(`The sketch spans ${w} x ${h} in, past the ${board.widthIn} x ${board.heightIn} in board -- the board size was kept (this board declares none).`);
  }
  return notes;
}

/** The 'sketch_pulled' reply: the curves onto their layer (unconditional); board/layer/frame param changes go
 *  through the change-list dialog, shown only when there's something to show. */
export function onSketchPulled(raw) {
  releaseHeldStage(); // the card held since the request (fusion-bridge.js pullSketchFromFusion)
  try {
    const data = JSON.parse(raw || '{}');
    if (!data.ok) {
      const errMsg = data.error || 'Failed to pull sketch from Fusion';
      setFusionStatus(errMsg, 'warn');
      showToast(errMsg, 'warn');
      return;
    }
    const curves = data.curves || [];
    // Prefer non-construction curves (the carved slots, outlines, holes)
    const targetCurves = curves.filter((c) => !c.isConstruction);
    const toImport = targetCurves.length > 0 ? targetCurves : curves;
    const notes = pulledSketchNotes(data);
    const editor = window.svgEditor;
    if (!editor) {
      setFusionStatus('Editor not initialized', 'warn');
      return;
    }

    if (toImport.length > 0) {
      let layer = (editor._layers || []).find((l) => l.name === PULLED_LAYER_NAME);
      if (!layer) layer = addLayer(editor, { name: PULLED_LAYER_NAME });
      setActiveLayer(editor, layer.id);
      if (editor._sketchLayer) {
        editor._sketchLayer.children().toArray().filter((ch) => String(ch.attr('data-layer')) === String(layer.id)).forEach((ch) => ch.remove());
        toImport.forEach((c) => {
          if (c.d) editor._sketchLayer.path(c.d).fill('none').stroke({ width: 0.05, color: '#000000' }).attr('data-layer', layer.id);
        });
      }
      if (typeof editor.pushState === 'function') editor.pushState();
      if (typeof editor._notifyChange === 'function') editor._notifyChange('commit');
      setFusionStatus(`Pulled ${toImport.length} curves from "${data.sketchName}" ✓`, 'ok');
      showToast([`✓ Pulled ${toImport.length} curves from "${data.sketchName}"`, ...notes].join(' '), notes.length ? 'warn' : 'ok');
    } else {
      // No drawable curves -- the pull may still carry PARAMETER changes (node diameter, frame thickness, ...)
      // below, so this is a status note, not an early return.
      setFusionStatus('No curves found in Fusion sketch', 'warn');
      showToast([`Sketch "${data.sketchName}" has no curves to import.`, ...notes].join(' '), 'warn');
    }

    // PULL_MAP's own rows (board size, layer widths, frame settings) -- gated behind the change-list dialog's
    // Apply, Fred's "nothing changes until Apply" rule. "the board follows THIS BOARD's own size only" (never a
    // fallback -- pull-sketch-safe.test.js) still applies: widthIn/heightIn are left out of the diff entirely
    // unless this board's own Fusion parameters declared a size (sizeSource 'fusion').
    const sizedData = data.sizeSource === 'fusion' ? data : { ...data, widthIn: undefined, heightIn: undefined };
    const layers = (editor._layers || []).filter((l) => l && l.pattern);
    const frame = getFrameRecord().templateId ? getFrameRecord() : null;
    const changeList = buildChangeList(sizedData, { P, layers, frame });
    if (hasChanges(changeList)) {
      showChangeListDialog(changeList, { onApply: (cl) => applyChangeList(cl, { editor }) });
    }
  } catch (e) {
    fusLog(`sketch_pulled handling failed: ${e.message}`);
    setFusionStatus(`Sketch pull failed: ${e.message}`, 'warn');
  }
}

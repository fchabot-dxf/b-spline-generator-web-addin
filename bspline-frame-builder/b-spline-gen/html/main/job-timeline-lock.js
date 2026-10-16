/**
 * main/job-timeline-lock.js -- a LOCKED job-timeline step (left of the head) goes inert where it's edited (Fred's
 * spec via the advisor, 2026-10-15, job-timeline step 3, slice 1): a 'section' kind's sidebar panel
 * (core/job-timeline.js JOB_STEP_KINDS readOnly:'section' -- core/ui-utils.js setSectionReadOnly, the
 * data-job-lock DOM hook) goes inert + an amber banner names the step and offers to move the head. A 'layer' kind
 * (lattice rails/nodes, vector, bricks) locks its own editor layer instead -- wired separately, not here.
 *
 * Called on every main/job-timeline-strip.js renderJobStrips, so a panel stays correct whether it was reached via
 * the timeline's own click or by scrolling the sidebar directly.
 */
import { JOB_STEP_KINDS } from '../core/job-timeline.js';
import { setSectionReadOnly } from '../core/ui-utils.js';

const BANNER_CLASS = 'job-lock-banner';

/** Fred's mockup sentence (shots/seatD/timeline/lock_mock_1): the snapshot-backed extra line only applies to a
 *  snapshotOnLock kind (today, only Back) -- step 2 of this slice (the snapshot itself) fills in the timestamp. */
function bannerBody(kind) {
  return kind.snapshotOnLock
    ? 'Read-only. The underside is kept as it was cut -- later edits do not move it.'
    : 'Read-only.';
}

function syncBanner(root, step, kind, locked, onMoveHead) {
  const prev = root.previousElementSibling;
  const hasBanner = !!(prev && prev.classList && prev.classList.contains(BANNER_CLASS));
  if (!locked) { if (hasBanner) prev.remove(); return; }
  const banner = hasBanner ? prev : root.ownerDocument.createElement('div');
  if (!hasBanner) {
    banner.className = BANNER_CLASS;
    root.parentNode.insertBefore(banner, root);
  }
  banner.innerHTML = `<span class="job-lock-icon">🔒</span>`
    + `<span class="job-lock-text"><strong>${step.label} is cut, left of the playhead.</strong> ${bannerBody(kind)}</span>`
    + `<button type="button" class="job-lock-cta">Move the head before ${step.label} to edit</button>`;
  banner.querySelector('.job-lock-cta').onclick = () => onMoveHead(step.id);
}

/** `steps`/`order`/`head` as main/job-timeline-strip.js's syncJobTimeline returns them; `onMoveHead(stepId)` is its
 *  moveHeadBefore. Every 'section' kind's step: setSectionReadOnly on its own data-job-lock scope(s), and a banner
 *  synced onto each matched root. A 'layer' kind is skipped here entirely (syncLayerLocks, below). */
export function syncJobLocks(steps, order, head, onMoveHead, doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return;
  const locked = new Set(order.slice(0, head));
  for (const step of steps) {
    const kind = JOB_STEP_KINDS[step.kind];
    if (kind.readOnly !== 'section') continue;
    const isLocked = locked.has(step.id);
    setSectionReadOnly(step.id, isLocked, doc);
    for (const root of doc.querySelectorAll(`[data-job-lock="${step.id}"]`)) syncBanner(root, step, kind, isLocked, onMoveHead);
  }
}

/** A 'layerRails'/'latticeNodes' step's `layerId` (core/job-timeline.js deriveJobSteps) is the pattern's OWNER
 *  (rails) layer -- shared by BOTH sub-steps, so opening either from the timeline opens the same Lattice tab. The
 *  step's own CONTENT, though, lives on a SIBLING kind-layer, resolved through the owner's own pattern.layers map
 *  (editor-lattice-pattern.js _ensureKindLayers: {rails, ties, nodes, contour} -> real layer ids). Falls back to
 *  the owner itself before the pattern has ever split (everything still lives on one layer then). Vector/bricks
 *  steps have no such indirection -- their own layerId already names the real layer. */
function targetLayerId(editor, step) {
  if (step.kind !== 'latticeRails' && step.kind !== 'latticeNodes') return step.layerId;
  const owner = (editor._layers || []).find((l) => String(l.id) === String(step.layerId));
  const kind = step.kind === 'latticeRails' ? 'rails' : 'nodes';
  const real = owner && owner.pattern && owner.pattern.layers ? owner.pattern.layers[kind] : null;
  return real != null ? String(real) : step.layerId;
}

/** The 'layer' half of a lock: every editor layer's own `jobLocked` flag (editor/layers.js isEditableByLayer /
 *  isOnVisibleLayer), kept in lockstep with the project's current order/head -- same call site, same cadence as
 *  syncJobLocks (main/job-timeline-strip.js renderJobStrips). A layer with no step pointing at it (ties, contour --
 *  core/job-timeline.js declares no step kind for either) is never locked here: locking something with no banner
 *  explaining why would be confusing (flagged to the advisor, not decided here). */
export function syncLayerLocks(steps, order, head, editor) {
  if (!editor || !Array.isArray(editor._layers)) return;
  const locked = new Set(order.slice(0, head));
  const lockedLayerIds = new Set();
  for (const step of steps) {
    const kind = JOB_STEP_KINDS[step.kind];
    if (kind.readOnly !== 'layer' || !locked.has(step.id)) continue;
    const id = targetLayerId(editor, step);
    if (id != null) lockedLayerIds.add(id);
  }
  for (const layer of editor._layers) layer.jobLocked = lockedLayerIds.has(String(layer.id));
}

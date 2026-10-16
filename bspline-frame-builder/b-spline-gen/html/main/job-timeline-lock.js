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
 *  synced onto each matched root. A 'layer' kind is skipped here entirely. */
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

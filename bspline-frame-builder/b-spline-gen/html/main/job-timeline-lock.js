/**
 * main/job-timeline-lock.js -- a LOCKED job-timeline step (left of the head) goes inert where it's edited (Fred's
 * spec via the advisor, 2026-10-15, job-timeline step 3, slice 1): a 'section' kind's sidebar panel
 * (core/job-timeline.js JOB_STEP_KINDS readOnly:'section' -- core/ui-utils.js setSectionReadOnly, the
 * data-job-lock DOM hook) goes inert + an amber banner names the step and offers to move the head. A 'layer' kind
 * (lattice rails/nodes, vector, bricks) locks its own editor layer's GEOMETRY via editor/layers.js jobLocked
 * (syncLayerLocks, below) -- the editor's own Lattice tab PANEL (its form controls, a separate surface from
 * geometry edits) is syncLatticeTabLock's own job (step 3 slice 3, mock_3 shots/seatD/timeline/
 * lock_mock_3_lattice_readonly_editor.png), the SAME setSectionReadOnly + banner mechanism, a second
 * data-job-lock root.
 *
 * Called on every main/job-timeline-strip.js renderJobStrips, so a panel stays correct whether it was reached via
 * the timeline's own click or by scrolling the sidebar directly.
 */
import { JOB_STEP_KINDS } from '../core/job-timeline.js';
import { setSectionReadOnly } from '../core/ui-utils.js';
import { resolvePatternLayer } from '../editor/editor-lattice-pattern.js';
import { getActiveLayer } from '../editor/layers.js';

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
  // Fred, via the advisor 2026-10-16: the pinned Generate New Seed button is ALWAYS on screen while Seed is locked
  // (it lives in .sticky-actions), so its own copy of the banner just duplicated the one already shown at Seed's
  // Offset X/Y controls below -- declared per-root (data-job-lock-banner="false" on the button, palette.html),
  // not a kind-level special case, since every OTHER root for the same step still wants its own banner. Quieter
  // instead: styles/layout-app.css's .job-readonly[data-job-lock-banner="false"] appends a small lock mark.
  if (root.getAttribute('data-job-lock-banner') === 'false') { if (hasBanner) prev.remove(); return; }
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

/** A step's own `locksAlso` kinds (core/job-timeline.js -- ties/contour, no step of their own), resolved through
 *  the SAME owner.pattern.layers map targetLayerId above reads -- a kind-layer that was never generated (the
 *  pattern never split that far, e.g. no contour yet) simply isn't in the map, so nothing is added for it. */
function locksAlsoIds(editor, step, kindDef) {
  if (!kindDef.locksAlso || !kindDef.locksAlso.length) return [];
  const owner = (editor._layers || []).find((l) => String(l.id) === String(step.layerId));
  const map = owner && owner.pattern && owner.pattern.layers ? owner.pattern.layers : null;
  if (!map) return [];
  return kindDef.locksAlso.map((k) => map[k]).filter((id) => id != null).map(String);
}

/** The 'layer' half of a lock: every editor layer's own `jobLocked` flag (editor/layers.js isEditableByLayer /
 *  isOnVisibleLayer), kept in lockstep with the project's current order/head -- same call site, same cadence as
 *  syncJobLocks (main/job-timeline-strip.js renderJobStrips). A layer with no step pointing at it (ties, contour --
 *  core/job-timeline.js declares no step kind for either) is locked only via latticeRails' own declared `locksAlso`
 *  -- Fred, via the advisor 2026-10-16: they're "cut with the rails", so Rails locked locks them too. */
export function syncLayerLocks(steps, order, head, editor) {
  if (!editor || !Array.isArray(editor._layers)) return;
  const locked = new Set(order.slice(0, head));
  const lockedLayerIds = new Set();
  for (const step of steps) {
    const kind = JOB_STEP_KINDS[step.kind];
    if (kind.readOnly !== 'layer' || !locked.has(step.id)) continue;
    const id = targetLayerId(editor, step);
    if (id != null) lockedLayerIds.add(id);
    for (const alsoId of locksAlsoIds(editor, step, kind)) lockedLayerIds.add(alsoId);
  }
  for (const layer of editor._layers) layer.jobLocked = lockedLayerIds.has(String(layer.id));
}

const LATTICE_PANEL_LOCK_ID = 'lattice-panel'; // data-job-lock on #editorLatticePanelBody (bspline_gen_palette.html)

function _joinHuman(labels) {
  if (labels.length <= 1) return labels[0] || '';
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

/** The editor-tab banner's own text (mock_3): names the LAYER and which of ITS kinds are cut, not the step's own
 *  label sentence syncBanner above uses -- a sidebar reader is already inside that one section; an editor-tab
 *  reader needs the layer named ("every OTHER layer is still editable") since nothing else on screen says which
 *  one this panel is for. */
function syncLatticeBanner(root, ownerName, lockedLabels, firstLockedStepId, onMoveHead) {
  const prev = root.previousElementSibling;
  const hasBanner = !!(prev && prev.classList && prev.classList.contains(BANNER_CLASS));
  if (!lockedLabels.length) { if (hasBanner) prev.remove(); return; }
  const banner = hasBanner ? prev : root.ownerDocument.createElement('div');
  if (!hasBanner) { banner.className = BANNER_CLASS; root.parentNode.insertBefore(banner, root); }
  const verb = lockedLabels.length === 1 ? 'is' : 'are';
  banner.innerHTML = `<span class="job-lock-icon">🔒</span>`
    + `<span class="job-lock-text"><strong>${ownerName} · ${_joinHuman(lockedLabels)} ${verb} cut.</strong> `
    + `Read-only: the lattice and its layer can be looked at, not changed. Every other layer is still editable.</span>`
    + `<button type="button" class="job-lock-cta">Move the head before ${lockedLabels[0]} to edit</button>`;
  banner.querySelector('.job-lock-cta').onclick = () => onMoveHead(firstLockedStepId);
}

/** The editor's OWN Lattice tab (step 3 slice 3): the Lattice Pattern panel (#editorLatticePanelBody) goes inert +
 *  its own banner -- separate from the sidebar (syncJobLocks only ever touches 'section' kinds). Whichever layer
 *  is active, resolved to its pattern's OWNER (a click on a tie/node activates a SIBLING kind-layer --
 *  editor-lattice-pattern.js resolvePatternLayer, the SAME resolution properties-lattice.js's own live binding
 *  uses, so this always names the layer the panel is actually showing). A non-lattice active layer (or none)
 *  clears both -- nothing to lock, same as before this slice existed. */
export function syncLatticeTabLock(steps, order, head, editor, onMoveHead, doc = typeof document !== 'undefined' ? document : null) {
  if (!doc || !editor || !Array.isArray(editor._layers)) return;
  const root = doc.getElementById('editorLatticePanelBody');
  if (!root) return;
  const activeId = getActiveLayer(editor);
  const owner = activeId != null ? resolvePatternLayer(editor, activeId) : null;
  if (!owner) {
    setSectionReadOnly(LATTICE_PANEL_LOCK_ID, false, doc);
    syncLatticeBanner(root, '', [], null, onMoveHead);
    return;
  }

  const locked = new Set(order.slice(0, head));
  const lockedLabels = [];
  let firstLockedStepId = null, firstLockedIndex = Infinity;
  for (const step of steps) {
    if (String(step.layerId) !== String(owner.id)) continue;
    const kind = JOB_STEP_KINDS[step.kind];
    if (kind.readOnly !== 'layer' || !locked.has(step.id)) continue;
    lockedLabels.push(kind.label);
    const idx = order.indexOf(step.id);
    if (idx < firstLockedIndex) { firstLockedIndex = idx; firstLockedStepId = step.id; }
  }
  const isLocked = lockedLabels.length > 0;
  setSectionReadOnly(LATTICE_PANEL_LOCK_ID, isLocked, doc);
  syncLatticeBanner(root, owner.name || 'This layer', lockedLabels, firstLockedStepId, onMoveHead);
}

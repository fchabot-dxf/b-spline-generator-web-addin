/**
 * main/job-timeline-strip.js -- the JOB TIMELINE strip (Fred 2026-10-14, step 2; mockups shots/seatD/timeline/): a thin
 * strip along the bottom of each canvas -- the 3D view and the 2D editor (above the phone drawer) -- with the job's steps
 * in cut order (core/job-timeline.js) and the playhead. Groups fold; a step (or a folded group's run) is dragged to
 * reorder; the head is dragged; a click opens the step's panel or editor. NO locking yet: the head is only shown and
 * saved (P.jobTimeline). A step cut before one it depends on gets an amber dot -- detection only.
 */
import { P, scheduleSessionSave, bootRestore } from '../core/state.js';
import { markDirty } from '../core/dirty.js';
import { JOB_STEP_KINDS, jobProjectOf, deriveJobSteps, normalizeJobTimeline, groupRuns, dependencyMarks, dependencyNote } from '../core/job-timeline.js';
import { decodeLayersAttr } from '../editor/layers-attr.js';
import { ensureUndoBaseline, takeSnapshot } from '../core/history.js';
import { syncJobLocks, syncLayerLocks } from './job-timeline-lock.js';
import { sectionColor } from './section-themes.js';
import { isJobTimelineEnabled } from '../core/job-timeline-enabled.js';
import { isBackLocked, captureBackSnapshot, dropBackSnapshot } from '../core/job-timeline-snapshot.js';

/** Where a strip is drawn: the host and what its bottom sits on (the editor's: the phone drawer's top). `rootVar`: its
 *  height also on the document root, for what floats over that canvas OUTSIDE its host (the phone's position:fixed
 *  undo / redo pill and the tool hint, styles/editor.css -- under the strip a real tap hit the strip; gate 2026-10-15). */
export const JOB_STRIP_HOSTS = Object.freeze([
  Object.freeze({ host: 'previewArea', id: 'jobStrip3d', bottom: '0px' }),
  Object.freeze({ host: 'editorCanvasContainer', id: 'jobStrip2d', bottom: 'var(--drawer-height, 0px)', rootVar: '--job-strip-2d-height' }),
]);
// heightPx: the strip's own band; headOverhangPx (Fred: "make the cursor stick out up a bit", like Fusion's marker): how
// far the playhead's grab tab rises ABOVE the band; headGrabPx: the head's width = its touch target (>= 28 on a phone)
export const JOB_STRIP = Object.freeze({
  heightPx: Object.freeze({ phone: 44, desktop: 34 }),
  headOverhangPx: Object.freeze({ phone: 14, desktop: 9 }),
  headGrabPx: Object.freeze({ phone: 28, desktop: 14 }),
  // Fred 2026-10-16: no text on a chip -- just its section icon on its section colour, so it stays a real touch
  // target (>= 28px, both axes) on a phone even without a label stretching it out.
  chipMinPx: Object.freeze({ phone: 28, desktop: 24 }),
  dragStartPx: 6,
  foldKey: 'bspline.jobTimeline.folded',
  // advisor 2026-10-15 (the phone shot: the head sat past the right edge): a strip's FIRST draw scrolls the head into view
  scrollHeadOnFirstDraw: true,
  // Fred 2026-10-16: a track line behind the chips, like beads on a rail -- solid/dark left of the head (done),
  // lighter right of it (pending). styles/layout-app.css .job-track reads these.
  // advisor review 2026-10-16 ("barely visible on desktop, not at all on phone"): 2px/#5a6472 read as a hairline --
  // 3px and a near-black done colour so it reads as a real rail, not a seam
  trackPx: 3,
  trackColorDone: '#2b323b',
  trackColorPending: '#aeb6c0',
});
const JOB_DEP_MARK_COLOR = '#f0a020';

const _state = { folded: null, opener: null };
const _readFolded = () => { try { const v = JSON.parse(localStorage.getItem(JOB_STRIP.foldKey)); return Array.isArray(v) ? v : []; } catch (_) { return []; } };
const _writeFolded = (v) => { try { localStorage.setItem(JOB_STRIP.foldKey, JSON.stringify(v)); } catch (_) { /* not remembered */ } };
const _phone = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

/** The project's steps now: the live editor's layers (else the saved document's roster) and the frame. */
export function currentJobSteps() {
  const ed = typeof window !== 'undefined' ? window.svgEditor : null;
  let roster = ed && Array.isArray(ed._layers) && ed._layers.length ? ed._layers : null;
  if (!roster) {
    const m = typeof P.editorSvg === 'string' ? P.editorSvg.match(/data-editor-layers="([^"]*)"/) : null;
    try { roster = m ? decodeLayersAttr(m[1]) : []; } catch (_) { roster = []; }
  }
  return deriveJobSteps(jobProjectOf(roster, P.frame));
}

/** The timeline made safe for the project as it is now (a deleted / new layer, a new frame); written back when it
 *  changed -- once the page-load restore is complete (state.js bootRestore). The strip is first drawn BEFORE initApp
 *  restores the session (main.js), and a write then saved the DEFAULT P over the session the reload was restoring
 *  (gate 2026-10-15: every brick matrix "Persist (reload)" row). Returns { steps, order, head }. */
export function syncJobTimeline() {
  const steps = currentJobSteps();
  const t = normalizeJobTimeline(P.jobTimeline, steps);
  // the switch (core/job-timeline-enabled.js) OFF: never write -- P.jobTimeline (order/head/snapshots) stays
  // exactly as saved, same rule as before bootRestore completes, so switching back on resumes where it left off
  if (!bootRestore.complete || !isJobTimelineEnabled()) return { steps, ...t };
  if (!P.jobTimeline || JSON.stringify(P.jobTimeline) !== JSON.stringify(t)) { P.jobTimeline = t; scheduleSessionSave(); }
  return { steps, ...t };
}

/** A user's edit of the order or the head: saved with the project. `isHeadMove`: advisor 2026-10-15 ("every head
 *  move is one undo step, uniform") -- a global undo step so crossing a locked step's snapshot backward (step 3)
 *  Undoes cleanly; P.jobTimeline isn't in core/history.js's UNDO_KEEPS, so it already round-trips whole through
 *  every global snapshot once one is taken around the move. Plain reordering (no head move) takes no step, same as
 *  step 2.
 *
 *  job-timeline step 3 slice 2: a head move that crosses Back's OWN lock boundary captures or drops its snapshot
 *  (core/job-timeline-snapshot.js) BEFORE the undo snapshot is taken, so the capture/drop is part of the SAME
 *  step Undo already restores -- no extra undo machinery. Gated on the Settings switch defensively (renderJobStrips'
 *  own gating already means this path is unreachable from the UI while it's off, same as syncJobLocks/syncLayerLocks). */
function _commit(order, head, { isHeadMove = false } = {}) {
  const steps = currentJobSteps();
  if (isHeadMove) ensureUndoBaseline('Before move the job timeline head'); // recordStep's own "Before X" convention
  const wasBackLocked = isHeadMove && isJobTimelineEnabled() && isBackLocked(P.jobTimeline);
  // carry any existing snapshots (slice 2) forward -- a plain reorder, or a head move that doesn't cross Back's
  // own lock boundary, must never silently drop an already-frozen underside
  P.jobTimeline = normalizeJobTimeline({ order, head, snapshots: P.jobTimeline?.snapshots }, steps);
  if (isHeadMove) {
    if (isJobTimelineEnabled()) {
      const nowBackLocked = isBackLocked(P.jobTimeline);
      if (nowBackLocked && !wasBackLocked) captureBackSnapshot();
      else if (!nowBackLocked && wasBackLocked) dropBackSnapshot();
    }
    takeSnapshot('Move the job timeline head');
  }
  markDirty();
  scheduleSessionSave();
  renderJobStrips();
}

/** The lock banner's "Move the head before X to edit" button (main/job-timeline-lock.js): the head lands exactly
 *  where `stepId` sits in the CURRENT order, unlocking it (and everything after it). A no-op if the id is gone
 *  (the layer it named was deleted since the banner was drawn). */
export function moveHeadBefore(stepId) {
  const { order } = P.jobTimeline || { order: [] };
  const at = order.indexOf(stepId);
  if (at < 0) return;
  _commit(order, at, { isHeadMove: true });
}

/** A deterministic colour from a string (a layer id/name) -- no stored per-layer swatch exists, so this is read,
 *  not written: the SAME layer always lands on the SAME hue, letting two Lattice groups (or two vector layers,
 *  Fred: "Yellow vs Red") stay visually distinct without any new per-layer field. */
function _layerSwatch(key) {
  let h = 0;
  const s = String(key);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  // the comma-separated legacy hsl() syntax, not the space-separated CSS Color 4 form -- jsdom's CSSOM (tests)
  // silently drops a style.backgroundColor write in the newer syntax, reading back '' instead of throwing
  return `hsl(${h % 360}, 70%, 48%)`;
}

/** A chip: icon on its section's colour, no text (Fred 2026-10-16) -- `name` is the tooltip + aria-label instead.
 *  `swatchKey`: a sub-item (a lattice layer, a vector layer) gets a small ring in a colour derived from it
 *  (_layerSwatch), so same-kind sub-items of DIFFERENT layers stay distinguishable. */
function _chip(doc, kindId, name, { sub = false, caret = null, mark = null, fixed = false, swatchKey = null } = {}) {
  const k = JOB_STEP_KINDS[kindId];
  const c = doc.createElement('button');
  c.type = 'button';
  c.className = 'job-step' + (sub ? ' job-step-sub' : '') + (fixed ? ' job-step-fixed' : '');
  c.style.setProperty('--job-color', sectionColor(k.section));
  c.title = mark ? `${name}\n\n${mark}` : name;
  c.setAttribute('aria-label', name);
  c.innerHTML = (caret ? `<span class="job-caret">${caret}</span>` : '') + `<span class="job-icon">${k.icon || ''}</span>`
    + (swatchKey ? `<span class="job-swatch"></span>` : '') + (mark ? '<span class="job-dep-mark"></span>' : '');
  if (swatchKey) c.querySelector('.job-swatch').style.backgroundColor = _layerSwatch(swatchKey);
  if (mark) c.querySelector('.job-dep-mark').style.background = JOB_DEP_MARK_COLOR;
  return c;
}

/** The switch (core/job-timeline-enabled.js) OFF: no strip, the canvas keeps its full height -- removes any bar a
 *  PRIOR render (while on) left behind and zeroes the height custom properties every reader (the phone undo pill,
 *  the editor canvas) backs off by. P.jobTimeline itself is untouched (syncJobTimeline's own guard). */
function _clearStrips(doc) {
  for (const def of JOB_STRIP_HOSTS) {
    const host = doc.getElementById(def.host);
    if (!host) continue;
    doc.getElementById(def.id)?.remove();
    host.style.removeProperty('--job-strip-height');
    if (def.rootVar) doc.documentElement.style.setProperty(def.rootVar, '0px');
  }
}

/** Draws the strip into every declared host. */
export function renderJobStrips(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return;
  if (!isJobTimelineEnabled()) { _clearStrips(doc); return; }
  const { steps, order, head } = syncJobTimeline();
  syncJobLocks(steps, order, head, moveHeadBefore, doc);
  syncLayerLocks(steps, order, head, typeof window !== 'undefined' ? window.svgEditor : null);
  if (!_state.folded) _state.folded = _readFolded();
  const byId = new Map(steps.map((s) => [s.id, s]));
  const marks = new Map(dependencyMarks(order, steps).map((m) => [m.stepId, dependencyNote(m, steps)]));
  const size = _phone() ? 'phone' : 'desktop';
  const h = JOB_STRIP.heightPx[size], over = JOB_STRIP.headOverhangPx[size], grab = JOB_STRIP.headGrabPx[size];
  for (const def of JOB_STRIP_HOSTS) {
    const host = doc.getElementById(def.host);
    if (!host) continue;
    let bar = doc.getElementById(def.id);
    if (!bar) {
      bar = doc.createElement('div');
      bar.id = def.id;
      bar.className = 'job-strip';
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', 'Job timeline');
      host.appendChild(bar);
    }
    bar.style.bottom = def.bottom;
    bar.style.height = `${h + over}px`; // the band + the transparent strip above it the head's tab rises into
    bar.style.setProperty('--job-band', `${h}px`);
    bar.style.setProperty('--job-overhang', `${over}px`);
    bar.style.setProperty('--job-head-grab', `${grab}px`);
    bar.style.setProperty('--job-chip-min', `${JOB_STRIP.chipMinPx[size]}px`);
    host.style.setProperty('--job-strip-height', `${h}px`);
    if (def.rootVar) doc.documentElement.style.setProperty(def.rootVar, `${h}px`);
    bar.replaceChildren();
    const track = doc.createElement('div');
    track.className = 'job-track';
    bar.appendChild(track);
    const label = doc.createElement('span');
    label.className = 'job-strip-title';
    label.textContent = 'Job';
    bar.appendChild(label);
    let index = 0; // steps drawn so far: the head sits before step `head`
    let headDrawn = false; // ONE head: a group's own chip does not advance `index` (measured: drawn twice at an open group)
    const putHead = () => {
      if (headDrawn) return;
      headDrawn = true;
      const k = doc.createElement('div');
      k.className = 'job-head';
      k.dataset.jobHead = '1';
      k.title = 'Playhead: the steps left of it are done (locking comes later)';
      bar.appendChild(k);
    };
    for (const run of groupRuns(order, steps)) {
      const folded = run.group && _state.folded.includes(run.group.id);
      if (run.group) {
        if (index === head) putHead();
        const ids = run.steps.map((s) => s.id);
        const runMark = ids.map((id) => marks.get(id)).filter(Boolean).join('\n');
        // a 'layer' group (one lattice) swatches by its own group id; a 'kind' group (several vector LAYERS folded
        // into one chip) has no single layer to swatch -- its own sub-item chips carry the swatch instead
        const groupSwatch = JOB_STEP_KINDS[run.steps[0].kind].group.by === 'layer' ? run.group.id : null;
        const g = _chip(doc, run.steps[0].kind, folded ? `${run.group.label} · ${run.steps.length}` : run.group.label, { caret: folded ? '▸' : '▾', mark: folded ? runMark || null : null, swatchKey: groupSwatch });
        g.classList.add('job-group');
        g.dataset.jobGroup = run.group.id;
        g.dataset.jobIds = JSON.stringify(ids);
        if (folded) g.dataset.jobFolded = '1';
        if (index < head) g.classList.add('job-done');
        bar.appendChild(g);
        if (folded) { index += run.steps.length; continue; }
      }
      for (const s of run.steps) {
        if (index === head) putHead();
        // a sub-item's own swatch: 'layer' groups (lattice rails/nodes) share their group id's colour (the SAME
        // lattice, both sub-steps); 'kind' groups (vector) swatch per LAYER instead (group.id is the shared literal
        // 'vector' for every layer -- useless for telling Red from Yellow)
        const swatchKey = run.group ? (JOB_STEP_KINDS[s.kind].group.by === 'layer' ? run.group.id : s.layerId) : null;
        const c = _chip(doc, s.kind, s.label, { sub: !!run.group, mark: marks.get(s.id) || null, fixed: JOB_STEP_KINDS[s.kind].fixed === 'first', swatchKey });
        c.dataset.jobIds = JSON.stringify([s.id]);
        c.dataset.jobStep = s.id;
        if (index < head) c.classList.add('job-done');
        bar.appendChild(c);
        index++;
      }
    }
    if (index === head) putHead();
    renderTrack(track, bar);
    _wireBar(bar, byId);
    if (JOB_STRIP.scrollHeadOnFirstDraw && !bar.dataset.jobScrolled) { bar.dataset.jobScrolled = '1'; scrollHeadIntoView(bar); }
  }
}

/** The track line (Fred 2026-10-16, "like beads on a rail"): one thin line through the chips' vertical centre,
 *  first step to last; solid/dark LEFT of the head (done), lighter RIGHT of it (pending) -- JOB_STRIP's own
 *  declared colours/width, not inline CSS math scattered at the call site. A no-op with < 2 chips (nothing to
 *  span) or no real layout yet (widths all 0 -- jsdom without getBoundingClientRect). */
function renderTrack(track, bar) {
  const chips = [...bar.querySelectorAll('[data-job-ids]')];
  if (chips.length < 2) { track.style.display = 'none'; return; }
  const first = chips[0], last = chips[chips.length - 1];
  const startX = first.offsetLeft + first.offsetWidth / 2;
  const endX = last.offsetLeft + last.offsetWidth / 2;
  if (endX <= startX) { track.style.display = 'none'; return; }
  const headEl = bar.querySelector('[data-job-head]');
  const headX = headEl ? Math.min(endX, Math.max(startX, headEl.offsetLeft + headEl.offsetWidth / 2)) : startX;
  const donePct = ((headX - startX) / (endX - startX)) * 100;
  // BUG (advisor review 2026-10-16, "barely visible on desktop, not at all on phone"): `top` was never set, so the
  // track defaulted to the TOP of the strip (the overhang band), nowhere near the chip row it's meant to run
  // through. The chip row is bottom-aligned (.job-strip align-items:flex-end), so its real vertical centre is read
  // off a chip's own offsetTop/offsetHeight, same as left/width above.
  track.style.top = `${first.offsetTop + first.offsetHeight / 2 - JOB_STRIP.trackPx / 2}px`;
  track.style.display = 'block';
  track.style.left = `${startX}px`;
  track.style.width = `${endX - startX}px`;
  track.style.height = `${JOB_STRIP.trackPx}px`;
  track.style.background = `linear-gradient(to right, ${JOB_STRIP.trackColorDone} ${donePct}%, ${JOB_STRIP.trackColorPending} ${donePct}%)`;
}

/** Scrolls a strip so its playhead sits in the middle of what shows (a strip wider than its canvas scrolls sideways). */
export function scrollHeadIntoView(bar) {
  const k = bar && bar.querySelector('.job-head');
  if (!k) return;
  bar.scrollLeft = Math.max(0, k.offsetLeft - (bar.clientWidth - k.offsetWidth) / 2);
}

/** Pointer handling on a strip: a tap opens (a group's caret folds), a drag reorders a step / a folded run, the head
 *  is dragged to a gap. One set of listeners per bar. */
function _wireBar(bar, byId) {
  if (bar.dataset.jobWired) return;
  bar.dataset.jobWired = '1';
  let drag = null;
  bar.addEventListener('pointerdown', (e) => {
    const head = e.target.closest('[data-job-head]');
    const chip = e.target.closest('[data-job-ids]');
    if (!head && !chip) return;
    drag = { x: e.clientX, head: !!head, chip, moved: false, pointerId: e.pointerId };
    try { bar.setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ }
  });
  bar.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x) >= JOB_STRIP.dragStartPx) drag.moved = true;
    if (drag.moved) bar.classList.add('job-dragging');
  });
  const end = (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    bar.classList.remove('job-dragging');
    const { order, head } = P.jobTimeline || { order: [], head: 0 };
    if (!d.moved) {
      if (d.head) return;
      if (d.chip.dataset.jobGroup) { toggleJobGroup(d.chip.dataset.jobGroup); return; } // a group's chip folds / unfolds it
      openJobStep(byId.get(JSON.parse(d.chip.dataset.jobIds)[0]));
      return;
    }
    const gap = gapAt(bar, e.clientX); // 0..n: the number of steps left of the drop point
    if (d.head) { _commit(order, gap, { isHeadMove: true }); return; }
    const ids = JSON.parse(d.chip.dataset.jobIds);
    if (ids.some((id) => JOB_STEP_KINDS[byId.get(id).kind].fixed === 'first')) return; // Stock never moves
    _commit(moveIds(order, ids, gap), head);
  };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', () => { drag = null; bar.classList.remove('job-dragging'); });
}

/** The gap (0..n steps) a drop at client x lands in: the steps whose chip centre lies left of x (a folded group counts
 *  its steps). */
export function gapAt(bar, x) {
  let n = 0;
  for (const c of bar.querySelectorAll('[data-job-ids]')) {
    const r = c.getBoundingClientRect();
    // an open group's own chip is a label (its steps are chips of their own); a folded one stands for its steps
    if (r.left + r.width / 2 < x) n += c.dataset.jobGroup && !c.dataset.jobFolded ? 0 : JSON.parse(c.dataset.jobIds).length;
  }
  return n;
}

/** Pure: `ids` (one step, or a folded run, in their order) moved so they start at gap `gap` of the order WITHOUT them
 *  counted in the original order -- i.e. `gap` steps of the original order stay left of them. */
export function moveIds(order, ids, gap) {
  const set = new Set(ids);
  const leftKept = order.slice(0, gap).filter((id) => !set.has(id)).length;
  const rest = order.filter((id) => !set.has(id));
  return [...rest.slice(0, leftKept), ...ids, ...rest.slice(leftKept)];
}

/** Folds / unfolds a group (per device). */
export function toggleJobGroup(groupId) {
  const f = _state.folded || _readFolded();
  _state.folded = f.includes(groupId) ? f.filter((g) => g !== groupId) : [...f, groupId];
  _writeFolded(_state.folded);
  renderJobStrips();
}

/** Opens what a step is about (its kind's declared `opens`), through the app's own openers (installJobStripOpeners). */
export function openJobStep(step) {
  if (!step || !_state.opener) return;
  _state.opener(step, JOB_STEP_KINDS[step.kind].opens);
}

/** Draws the strips and keeps them in step with the project. `opener(step, opens)` = the app's way to open a sidebar
 *  section / an editor tab and layer (main.js passes it, so this module imports no panel). */
export function initJobTimelineStrip({ opener } = {}) {
  if (typeof document === 'undefined') return;
  _state.opener = opener || null;
  for (const ev of ['editorLayersChanged', 'frameRecordChanged', 'brickSettingsRestored', 'editorTabChanged']) document.addEventListener(ev, () => renderJobStrips());
  renderJobStrips();
}

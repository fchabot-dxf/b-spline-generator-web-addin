/**
 * main/job-timeline-strip.js -- the JOB TIMELINE strip (Fred 2026-10-14, step 2; mockups shots/seatD/timeline/): a thin
 * strip along the bottom of each canvas -- the 3D view and the 2D editor (above the phone drawer) -- with the job's steps
 * in cut order (core/job-timeline.js) and the playhead. Groups fold; a step (or a folded group's run) is dragged to
 * reorder; the head is dragged; a click opens the step's panel or editor. NO locking yet: the head is only shown and
 * saved (P.jobTimeline). A step cut before one it depends on gets an amber dot -- detection only.
 */
import { P, scheduleSessionSave } from '../core/state.js';
import { markDirty } from '../core/dirty.js';
import { JOB_STEP_KINDS, jobProjectOf, deriveJobSteps, normalizeJobTimeline, groupRuns, dependencyMarks, dependencyNote } from '../core/job-timeline.js';
import { decodeLayersAttr } from '../editor/layers-attr.js';

/** Where a strip is drawn: the host and what its bottom sits on (the editor's: the phone drawer's top). */
export const JOB_STRIP_HOSTS = Object.freeze([
  Object.freeze({ host: 'previewArea', id: 'jobStrip3d', bottom: '0px' }),
  Object.freeze({ host: 'editorCanvasContainer', id: 'jobStrip2d', bottom: 'var(--drawer-height, 0px)' }),
]);
// heightPx: the strip's own band; headOverhangPx (Fred: "make the cursor stick out up a bit", like Fusion's marker): how
// far the playhead's grab tab rises ABOVE the band; headGrabPx: the head's width = its touch target (>= 28 on a phone)
export const JOB_STRIP = Object.freeze({
  heightPx: Object.freeze({ phone: 44, desktop: 34 }),
  headOverhangPx: Object.freeze({ phone: 14, desktop: 9 }),
  headGrabPx: Object.freeze({ phone: 28, desktop: 14 }),
  dragStartPx: 6,
  foldKey: 'bspline.jobTimeline.folded',
  // advisor 2026-10-15 (the phone shot: the head sat past the right edge): a strip's FIRST draw scrolls the head into view
  scrollHeadOnFirstDraw: true,
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
 *  changed. Returns { steps, order, head }. */
export function syncJobTimeline() {
  const steps = currentJobSteps();
  const t = normalizeJobTimeline(P.jobTimeline, steps);
  if (!P.jobTimeline || JSON.stringify(P.jobTimeline) !== JSON.stringify(t)) { P.jobTimeline = t; scheduleSessionSave(); }
  return { steps, ...t };
}

/** A user's edit of the order or the head: saved with the project. */
function _commit(order, head) {
  const steps = currentJobSteps();
  P.jobTimeline = normalizeJobTimeline({ order, head }, steps);
  markDirty();
  scheduleSessionSave();
  renderJobStrips();
}

function _chip(doc, kindId, text, { sub = false, caret = null, mark = null, fixed = false } = {}) {
  const k = JOB_STEP_KINDS[kindId];
  const c = doc.createElement('button');
  c.type = 'button';
  c.className = 'job-step' + (sub ? ' job-step-sub' : '') + (fixed ? ' job-step-fixed' : '');
  c.style.setProperty('--job-color', k.color);
  c.innerHTML = (caret ? `<span class="job-caret">${caret}</span>` : '') + `<span class="job-icon">${k.icon}</span><span class="job-label"></span>`
    + (mark ? '<span class="job-dep-mark"></span>' : '');
  c.querySelector('.job-label').textContent = text;
  if (mark) { c.title = mark; c.querySelector('.job-dep-mark').style.background = JOB_DEP_MARK_COLOR; }
  return c;
}

/** Draws the strip into every declared host. */
export function renderJobStrips(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return;
  const { steps, order, head } = syncJobTimeline();
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
    host.style.setProperty('--job-strip-height', `${h}px`);
    bar.replaceChildren();
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
        const g = _chip(doc, run.steps[0].kind, folded ? `${run.group.label} · ${run.steps.length}` : run.group.label, { caret: folded ? '▸' : '▾', mark: folded ? runMark || null : null });
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
        const c = _chip(doc, s.kind, s.label, { sub: !!run.group, mark: marks.get(s.id) || null, fixed: JOB_STEP_KINDS[s.kind].fixed === 'first' });
        c.dataset.jobIds = JSON.stringify([s.id]);
        c.dataset.jobStep = s.id;
        if (index < head) c.classList.add('job-done');
        bar.appendChild(c);
        index++;
      }
    }
    if (index === head) putHead();
    _wireBar(bar, byId);
    if (JOB_STRIP.scrollHeadOnFirstDraw && !bar.dataset.jobScrolled) { bar.dataset.jobScrolled = '1'; scrollHeadIntoView(bar); }
  }
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
    if (d.head) { _commit(order, gap); return; }
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

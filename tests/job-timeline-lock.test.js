/**
 * Job timeline step 3, slice 1 (seat D, advisor-approved 2026-10-15): a locked step's sidebar section goes
 * read-only + an amber banner (main/job-timeline-lock.js syncJobLocks, core/ui-utils.js setSectionReadOnly),
 * and moving the playhead is one global undo step (core/history.js) -- advisor: "every head move is one undo
 * step, uniform". Plain reordering (no head move) stays un-doable, same as step 2.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { P, bootRestore } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { globalHistoryLog, globalRedoLog, takeSnapshot } from '../bspline-frame-builder/b-spline-gen/html/core/history.js';
import { renderJobStrips, moveHeadBefore, JOB_STRIP_HOSTS } from '../bspline-frame-builder/b-spline-gen/html/main/job-timeline-strip.js';
import { syncJobLocks } from '../bspline-frame-builder/b-spline-gen/html/main/job-timeline-lock.js';
import { deriveJobSteps, jobProjectOf, defaultJobOrder } from '../bspline-frame-builder/b-spline-gen/html/core/job-timeline.js';
import { setJobTimelineEnabled } from '../bspline-frame-builder/b-spline-gen/html/core/job-timeline-enabled.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');

beforeEach(() => {
  document.body.innerHTML = BODY.replace(/^<body[^>]*>/, '').replace(/<\/body>$/, '');
  try { localStorage.clear(); } catch (_) { /* blocked */ }
  setJobTimelineEnabled(true); // the switch is DEFAULT OFF (core/job-timeline-enabled.js, merged in from job-timeline) --
  // the renderJobStrips calls below need it on, same as tests/job-timeline-strip.test.js's own fix
  window.svgEditor = { _layers: [{ id: 'L1', name: 'Red petals' }] };
  P.frame = null;
  P.jobTimeline = null;
  bootRestore.complete = true;
  globalHistoryLog.length = 0; globalRedoLog.length = 0;
  takeSnapshot('Initial');
});

describe('syncJobLocks: a locked \'section\' step goes inert with a banner; unlocked ones stay untouched', () => {
  const steps = deriveJobSteps(jobProjectOf([{ id: 'L1', name: 'Red petals', kind: 'vector', stackIndex: 0 }], null));
  const order = defaultJobOrder(steps);

  it('Back locked (the head just past it): its own panel control is disabled, a banner names it with the snapshot sentence', () => {
    const head = order.indexOf('back') + 1;
    const moved = [];
    syncJobLocks(steps, order, head, (id) => moved.push(id), document);

    expect(document.getElementById('thickenEnabled').disabled).toBe(true);
    const root = document.querySelector('[data-job-lock="back"]');
    const banner = root.previousElementSibling;
    expect(banner.classList.contains('job-lock-banner')).toBe(true);
    expect(banner.textContent).toContain('Back is cut, left of the playhead.');
    expect(banner.textContent).toContain('The underside is kept as it was cut');

    banner.querySelector('.job-lock-cta').click();
    expect(moved).toEqual(['back']);
  });

  it('Frame (not yet reached by the head) stays fully live, no banner', () => {
    // a frame step only exists when the project has one (core/job-timeline.js deriveJobSteps) -- give it one here
    // so this is a REAL present-but-unlocked step, not just an id syncJobLocks never saw at all
    const withFrame = deriveJobSteps(jobProjectOf([{ id: 'L1', name: 'Red petals', kind: 'vector', stackIndex: 0 }], { templateId: 'template_1' }));
    const orderWithFrame = defaultJobOrder(withFrame);
    const head = orderWithFrame.indexOf('back') + 1; // well before Frame in the default order
    syncJobLocks(withFrame, orderWithFrame, head, () => {}, document);
    const frameRoot = document.querySelector('[data-job-lock="frame"]');
    expect(frameRoot.previousElementSibling?.classList.contains('job-lock-banner')).not.toBe(true);
    expect(document.getElementById('btnEditFrameShape').disabled).toBe(false);
  });

  it('moving the head back past Back unlocks it again: control re-enabled, banner removed', () => {
    const lockedHead = order.indexOf('back') + 1;
    syncJobLocks(steps, order, lockedHead, () => {}, document);
    expect(document.getElementById('thickenEnabled').disabled).toBe(true);

    syncJobLocks(steps, order, 0, () => {}, document);
    expect(document.getElementById('thickenEnabled').disabled).toBe(false);
    const root = document.querySelector('[data-job-lock="back"]');
    expect(root.previousElementSibling?.classList.contains('job-lock-banner')).not.toBe(true);
  });

  it('a kind with no snapshotOnLock (Skeleton) gets the generic sentence, no underside line', () => {
    const head = order.indexOf('skeleton') + 1;
    syncJobLocks(steps, order, head, () => {}, document);
    const root = document.querySelector('[data-job-lock="skeleton"]');
    const banner = root.previousElementSibling;
    expect(banner.textContent).toContain('Read-only.');
    expect(banner.textContent).not.toContain('underside');
  });
});

describe('moving the playhead is one global undo step (advisor: every head move, uniform)', () => {
  it('moveHeadBefore takes exactly one step; Undo restores the earlier head position', async () => {
    renderJobStrips(document); // seeds P.jobTimeline with the default order, head 0
    const order = P.jobTimeline.order;
    const target = order.indexOf('back');
    expect(globalHistoryLog.length).toBe(1); // just 'Initial'

    moveHeadBefore('back');
    expect(P.jobTimeline.head).toBe(target);
    // ensureUndoBaseline adds its own 'Before ...' entry since P.jobTimeline changed between 'Initial' and this move
    // (renderJobStrips seeded it) -- same convention tests/frame-undo-step.test.js already uses for this baseline.
    const real = globalHistoryLog.filter((s) => s.label !== 'Initial' && !s.label.startsWith('Before '));
    expect(real.length).toBe(1);
    expect(real[0].label).toBe('Move the job timeline head');
    expect(real[0].P.jobTimeline.head).toBe(target); // the step's own snapshot: the head AFTER the move

    // what Undo actually restores lives in the BASELINE snapshot's own P (unifiedUndo pops to it; the real P
    // restoration runs in main/snapshot-manager.js's applySnapshot, exercised elsewhere -- UNDO_KEEPS,
    // tests/frame-undo-step.test.js). jobTimeline isn't in UNDO_KEEPS, so it round-trips with every other P key.
    const baseline = globalHistoryLog.find((s) => s.label === 'Before move the job timeline head');
    expect(baseline.P.jobTimeline.head).toBe(0); // the head BEFORE the move
    expect(baseline.P.jobTimeline).not.toBe(P.jobTimeline); // takeSnapshot deep-copies, not a live reference
  });

  it('a no-op move (the id is already gone) commits nothing', () => {
    renderJobStrips(document);
    const before = globalHistoryLog.length;
    moveHeadBefore('not-a-real-step-id');
    expect(globalHistoryLog.length).toBe(before); // unchanged
  });

  it('plain reordering (no head move) still takes NO undo step -- step 2 behaviour unchanged', () => {
    renderJobStrips(document);
    const before = globalHistoryLog.length;
    const bar = document.getElementById(JOB_STRIP_HOSTS[0].id);
    // the strip chip's OWN data-job-step attribute (main/job-timeline-strip.js, step 2 -- distinct from this
    // slice's sidebar-scope data-job-lock hook, which lives on the sidebar panels, not the strip's own chips)
    const chip = bar.querySelector('[data-job-step="skeleton"]');
    chip.getBoundingClientRect = () => ({ left: 500, width: 20 });
    chip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 500, pointerId: 7 }));
    chip.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 20, pointerId: 7 }));
    chip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 20, pointerId: 7 }));
    expect(globalHistoryLog.length).toBe(before); // reordering alone never touches global history
  });
});

/**
 * The job timeline STRIP (main/job-timeline-strip.js; Fred 2026-10-14, step 2, no locking): drawn along each canvas
 * bottom from P.jobTimeline, kept safe on every layer change, groups fold, a step / a folded run is dragged, the head is
 * dragged, a tap opens the step (the app's opener), an amber dot marks a step cut before one it depends on.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { renderJobStrips, syncJobTimeline, moveIds, initJobTimelineStrip, toggleJobGroup, JOB_STRIP_HOSTS, JOB_STRIP } from '../bspline-frame-builder/b-spline-gen/html/main/job-timeline-strip.js';

const $ = (id) => document.getElementById(id);
const chipIds = (bar) => [...bar.querySelectorAll('[data-job-step]')].map((c) => c.dataset.jobStep);
let opener;
beforeEach(() => {
  document.body.innerHTML = '<div id="previewArea" style="position:relative"></div><div id="editorCanvasContainer" style="position:relative"></div>';
  try { localStorage.clear(); } catch (_) { /* blocked */ }
  window.svgEditor = { _layers: [{ id: 'L1', name: 'Red petals' }, { id: 'LA', name: 'A', pattern: {} }, { id: 'L2', name: 'Green stems' }] };
  P.frame = { templateId: 'template_1' };
  P.jobTimeline = null;
  opener = vi.fn();
  initJobTimelineStrip({ opener });
});

describe('the strip', () => {
  it('drawn in both canvases, every step a chip in the saved order, Stock fixed, the head at its place', () => {
    for (const h of JOB_STRIP_HOSTS) expect($(h.id), h.id).not.toBeNull();
    const bar = $('jobStrip3d');
    expect(chipIds(bar)).toEqual(P.jobTimeline.order);
    expect(bar.querySelector('[data-job-step="stock"]').classList.contains('job-step-fixed')).toBe(true);
    expect(bar.children[1].dataset.jobHead).toBe('1'); // head 0: right after the title, before Stock
    expect(JOB_STRIP_HOSTS.find((h) => h.id === 'jobStrip2d').bottom).toBe('var(--drawer-height, 0px)'); // the editor's: above the phone drawer
  });
  it('a group folds into one chip with its count; unfolding brings its steps back', () => {
    toggleJobGroup('vector');
    const g = $('jobStrip3d').querySelector('[data-job-group="vector"]');
    expect(g.dataset.jobFolded).toBe('1');
    expect(g.textContent).toContain('Vector stamping · 2');
    expect(chipIds($('jobStrip3d'))).not.toContain('vector:L1');
    toggleJobGroup('vector');
    expect(chipIds($('jobStrip3d'))).toContain('vector:L1');
  });
  it('a layer deleted / added: the saved order follows at once (the deleted id dropped, the new one at the end)', () => {
    P.jobTimeline = { order: ['stock', 'vector:L1', 'seed'], head: 1 };
    window.svgEditor._layers = window.svgEditor._layers.filter((l) => l.id !== 'L1').concat([{ id: 'L9', name: 'Blue' }]);
    document.dispatchEvent(new CustomEvent('editorLayersChanged'));
    expect(P.jobTimeline.order).not.toContain('vector:L1');
    // appended after everything the saved order had (the missing ones in the default order: Wood frame still last)
    expect(P.jobTimeline.order.indexOf('vector:L9')).toBeGreaterThan(P.jobTimeline.order.indexOf('seed'));
    expect(P.jobTimeline.order.slice(0, 2)).toEqual(['stock', 'seed']);
    expect(chipIds($('jobStrip3d'))).toEqual(P.jobTimeline.order);
  });
  it('a tap opens the step through the app\'s opener (its declared target)', () => {
    const chip = $('jobStrip3d').querySelector('[data-job-step="vector:L2"]');
    chip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, pointerId: 1 }));
    chip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 10, pointerId: 1 }));
    expect(opener).toHaveBeenCalledTimes(1);
    expect(opener.mock.calls[0][0]).toMatchObject({ id: 'vector:L2', layerId: 'L2' });
    expect(opener.mock.calls[0][1]).toEqual({ editorTab: 'artwork', layer: true });
  });
  it('an amber dot (detection only) on a step cut before one it depends on, with Fred\'s sentence', () => {
    // Fred's default order cuts Skeleton before Filter (Filter sets its frequency); the Back is snapshot-backed: no mark
    const sk = $('jobStrip3d').querySelector('[data-job-step="skeleton"]');
    expect(sk.querySelector('.job-dep-mark')).not.toBeNull();
    expect(sk.title).toBe('Skeleton is cut before Filter, but Filter changes the skeleton');
    for (const id of ['seed', 'back']) expect($('jobStrip3d').querySelector(`[data-job-step="${id}"] .job-dep-mark`), id).toBeNull();
  });
});

describe('one playhead', () => {
  it('drawn once, also where it falls at an open group (its chip does not count as a step)', () => {
    const order = P.jobTimeline.order;
    const g = order.findIndex((id) => id.startsWith('lattice:'));
    P.jobTimeline = { order, head: g }; // the head right before the lattice group
    renderJobStrips();
    for (const h of JOB_STRIP_HOSTS) expect($(h.id).querySelectorAll('.job-head').length, h.id).toBe(1);
  });
});

describe('the playhead sticks out above the strip (Fred: "like Fusion’s marker")', () => {
  it('declared: an overhang above the band and a grab width, at least 28 px on a phone; the bar carries them', () => {
    expect(JOB_STRIP.headOverhangPx.desktop).toBeGreaterThan(0);
    expect(JOB_STRIP.headOverhangPx.phone).toBeGreaterThanOrEqual(JOB_STRIP.headOverhangPx.desktop);
    expect(JOB_STRIP.headGrabPx.phone).toBeGreaterThanOrEqual(28);
    const bar = $('jobStrip3d');
    expect(bar.style.getPropertyValue('--job-overhang')).toMatch(/^\d+px$/);
    expect(bar.style.getPropertyValue('--job-head-grab')).toMatch(/^\d+px$/);
  });
});

describe('moving steps (pure)', () => {
  const order = ['stock', 'seed', 'filter', 'skeleton', 'back', 'vector:a', 'vector:b'];
  it('one step dropped into a gap: the gap counts the steps left of the drop', () => {
    expect(moveIds(order, ['back'], 7)).toEqual(['stock', 'seed', 'filter', 'skeleton', 'vector:a', 'vector:b', 'back']);
    expect(moveIds(order, ['vector:b'], 1)).toEqual(['stock', 'vector:b', 'seed', 'filter', 'skeleton', 'back', 'vector:a']);
  });
  it('a folded run moves whole, in its order', () => {
    expect(moveIds(order, ['vector:a', 'vector:b'], 2)).toEqual(['stock', 'seed', 'vector:a', 'vector:b', 'filter', 'skeleton', 'back']);
  });
  it('Stock stays first whatever the drop (normalized when saved)', () => {
    syncJobTimeline();
    const t = P.jobTimeline;
    P.jobTimeline = { order: moveIds(t.order, ['seed'], 0), head: 0 };
    expect(syncJobTimeline().order[0]).toBe('stock');
  });
});

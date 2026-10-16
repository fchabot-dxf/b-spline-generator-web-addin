/**
 * The job timeline STRIP (main/job-timeline-strip.js; Fred 2026-10-14, step 2, no locking): drawn along each canvas
 * bottom from P.jobTimeline, kept safe on every layer change, groups fold, a step / a folded run is dragged, the head is
 * dragged, a tap opens the step (the app's opener), an amber dot marks a step cut before one it depends on.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { P, bootRestore } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { renderJobStrips, syncJobTimeline, moveIds, initJobTimelineStrip, toggleJobGroup, JOB_STRIP_HOSTS, JOB_STRIP, scrollHeadIntoView } from '../bspline-frame-builder/b-spline-gen/html/main/job-timeline-strip.js';

const $ = (id) => document.getElementById(id);
const chipIds = (bar) => [...bar.querySelectorAll('[data-job-step]')].map((c) => c.dataset.jobStep);
let opener;
beforeEach(() => {
  document.body.innerHTML = '<div id="previewArea" style="position:relative"></div><div id="editorCanvasContainer" style="position:relative"></div>';
  try { localStorage.clear(); } catch (_) { /* blocked */ }
  window.svgEditor = { _layers: [{ id: 'L1', name: 'Red petals' }, { id: 'LA', name: 'A', pattern: {} }, { id: 'L2', name: 'Green stems' }] };
  P.frame = { templateId: 'template_1' };
  P.jobTimeline = null;
  bootRestore.complete = true; // the strip in use: the page-load restore is done
  opener = vi.fn();
  initJobTimelineStrip({ opener });
});

describe('the strip', () => {
  it('drawn in both canvases, every step a chip in the saved order, Stock fixed, the head at its place', () => {
    for (const h of JOB_STRIP_HOSTS) expect($(h.id), h.id).not.toBeNull();
    const bar = $('jobStrip3d');
    expect(chipIds(bar)).toEqual(P.jobTimeline.order);
    expect(bar.querySelector('[data-job-step="stock"]').classList.contains('job-step-fixed')).toBe(true);
    expect(bar.children[2].dataset.jobHead).toBe('1'); // head 0: right after the track + title, before Stock
    expect(JOB_STRIP_HOSTS.find((h) => h.id === 'jobStrip2d').bottom).toBe('var(--drawer-height, 0px)'); // the editor's: above the phone drawer
  });
  it('a group folds into one chip with its count; unfolding brings its steps back', () => {
    toggleJobGroup('vector');
    const g = $('jobStrip3d').querySelector('[data-job-group="vector"]');
    expect(g.dataset.jobFolded).toBe('1');
    expect(g.title).toContain('Vector stamping · 2'); // no visible text (Fred 2026-10-16) -- the name moved to the tooltip
    expect(g.getAttribute('aria-label')).toContain('Vector stamping · 2');
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
    expect(sk.title).toContain('Skeleton is cut before Filter, but Filter changes the skeleton');
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

describe('the head in view on a narrow canvas', () => {
  it('the first draw scrolls the strip so the head sits in the middle; later draws leave the scroll alone', () => {
    const bar = $('jobStrip3d');
    expect(bar.dataset.jobScrolled).toBe('1');
    const k = bar.querySelector('.job-head');
    Object.defineProperty(k, 'offsetLeft', { value: 600, configurable: true });
    Object.defineProperty(k, 'offsetWidth', { value: 28, configurable: true });
    Object.defineProperty(bar, 'clientWidth', { value: 390, configurable: true });
    scrollHeadIntoView(bar);
    expect(bar.scrollLeft).toBe(600 - (390 - 28) / 2);
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

// gate 2026-10-15 (every "Persist (reload)" row red): the strip is drawn BEFORE initApp restores the last session, and
// its write-back then scheduled a save of the DEFAULT P over the session being restored
describe('before the page-load restore', () => {
  it('the strip draws but writes nothing: no P.jobTimeline, no session save over the board being restored', () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = '<div id="previewArea"></div><div id="editorCanvasContainer"></div>';
      localStorage.setItem('splineGenLastSession', '{"P":{"seed":7}}');
      P.jobTimeline = null;
      bootRestore.complete = false;
      initJobTimelineStrip({ opener: vi.fn() });
      vi.advanceTimersByTime(5000);
      expect($('jobStrip3d')).not.toBeNull();
      expect(P.jobTimeline).toBeNull();
      expect(localStorage.getItem('splineGenLastSession')).toBe('{"P":{"seed":7}}');
      bootRestore.complete = true; // the restore landed: the next draw writes the timeline back
      document.dispatchEvent(new Event('editorLayersChanged'));
      expect(P.jobTimeline).not.toBeNull();
    } finally { vi.useRealTimers(); }
  });
});

describe('Fred 2026-10-16: chips are icon-on-colour, no text -- a sub-item\'s own layer swatch tells same-kind layers apart', () => {
  it('a plain section chip (Stock) has no swatch; a lattice sub-item (Rails) does', () => {
    const bar = $('jobStrip3d');
    expect(bar.querySelector('[data-job-step="stock"] .job-swatch')).toBeNull();
    const rails = [...bar.querySelectorAll('[data-job-step]')].find((c) => c.dataset.jobStep.endsWith(':rails'));
    expect(rails.querySelector('.job-swatch')).not.toBeNull();
  });
  it('one lattice\'s Rails and Nodes chips share the SAME swatch colour (one group); a SECOND lattice gets a different one', () => {
    window.svgEditor._layers.push({ id: 'LB', name: 'B', pattern: {} });
    P.jobTimeline = null;
    renderJobStrips();
    const bar = $('jobStrip3d');
    const swatchOf = (id) => bar.querySelector(`[data-job-step="${id}"] .job-swatch`).style.backgroundColor;
    const [railsA, nodesA] = ['lattice:LA:rails', 'lattice:LA:nodes'].map(swatchOf);
    const [railsB] = ['lattice:LB:rails'].map(swatchOf);
    expect(railsA).toBe(nodesA); // same lattice, same colour
    expect(railsA).not.toBe(railsB); // a different lattice, a different colour
  });
  it('two DIFFERENT vector layers get two DIFFERENT swatch colours (Fred: "Yellow vs Red")', () => {
    const bar = $('jobStrip3d');
    const c1 = bar.querySelector('[data-job-step="vector:L1"] .job-swatch').style.backgroundColor;
    const c2 = bar.querySelector('[data-job-step="vector:L2"] .job-swatch').style.backgroundColor;
    expect(c1).not.toBe(c2);
  });
  it('a chip never shows its name as visible text -- only as its title / aria-label', () => {
    const chip = $('jobStrip3d').querySelector('[data-job-step="skeleton"]');
    expect(chip.textContent.trim()).not.toContain('Skeleton');
    expect(chip.title).toContain('Skeleton');
    expect(chip.getAttribute('aria-label')).toBe('Skeleton');
  });
  it('declares a minimum chip size so an icon-only chip stays a real touch target (>= 28px on a phone); the bar carries it, same pattern as --job-overhang', () => {
    expect(JOB_STRIP.chipMinPx.phone).toBeGreaterThanOrEqual(28);
    const bar = $('jobStrip3d');
    expect(bar.style.getPropertyValue('--job-chip-min')).toBe(`${JOB_STRIP.chipMinPx.desktop}px`);
  });
});

describe('Fred 2026-10-16: a track line behind the chips, like beads on a rail', () => {
  // jsdom lays out nothing for real -- a PROTOTYPE-level override (not per-instance) so it applies to chips AND
  // the head the moment renderJobStrips creates them fresh each render: element i among its siblings sits at
  // x = i*50, 30px wide -- a believable row in DOM order (chips, then wherever putHead() placed the head).
  let origLeft, origWidth, origTop, origHeight;
  beforeEach(() => {
    origLeft = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetLeft');
    origWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    origTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop');
    origHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return 30; } });
    Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
      configurable: true,
      get() { return [...(this.parentNode?.children || [])].indexOf(this) * 50; },
    });
    // the chip row is bottom-aligned (.job-strip align-items:flex-end) -- every chip sits at the same offsetTop/
    // offsetHeight regardless of x position, unlike offsetLeft above
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return 24; } });
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', { configurable: true, get() { return 10; } });
  });
  afterEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetLeft', origLeft);
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', origWidth);
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', origTop);
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', origHeight);
  });

  it('renders a visible track spanning the chip row, not the "nothing to span" no-op', () => {
    renderJobStrips();
    const track = $('jobStrip3d').querySelector('.job-track');
    expect(track).not.toBeNull();
    expect(track.style.display).not.toBe('none');
    expect(track.style.left).toMatch(/^\d+px$/);
    expect(parseFloat(track.style.width)).toBeGreaterThan(0);
  });

  it('sits at the chip row\'s real vertical centre, not the strip\'s top (the bug: `top` was never set at all)', () => {
    renderJobStrips();
    const track = $('jobStrip3d').querySelector('.job-track');
    // every stubbed chip: offsetTop 10, offsetHeight 24 -> centre 22, minus half the track's own declared width
    expect(track.style.top).toBe(`${10 + 24 / 2 - JOB_STRIP.trackPx / 2}px`);
  });

  it('the head at the very start: the whole track reads pending (0% done)', () => {
    renderJobStrips();
    const track = $('jobStrip3d').querySelector('.job-track');
    expect(track.style.background).toContain(`${JOB_STRIP.trackColorDone} 0%`);
  });

  it('the head at the very end: the whole track reads done (100%)', () => {
    const order = P.jobTimeline.order;
    P.jobTimeline = { order, head: order.length };
    renderJobStrips();
    const track = $('jobStrip3d').querySelector('.job-track');
    expect(track.style.background).toContain(`${JOB_STRIP.trackColorPending} 100%`);
  });

  it('declares its own colours/width in JOB_STRIP (not inline CSS math at the call site)', () => {
    expect(JOB_STRIP.trackPx).toBeGreaterThan(0);
    expect(JOB_STRIP.trackColorDone).toMatch(/^#/);
    expect(JOB_STRIP.trackColorPending).toMatch(/^#/);
  });
});

// gate 2026-10-15 (blind: "Art: Shape Generate" setup missing): on a phone the undo / redo pill (position:fixed, outside
// the strip's host) sat UNDER the 2D strip, so a real tap on Undo hit the playhead and on Redo the Stock chip
describe('what floats over the editor canvas clears the 2D strip', () => {
  it('the 2D strip publishes its height on the root; the phone pill and the tool hint add it', () => {
    const def = JOB_STRIP_HOSTS.find((h) => h.id === 'jobStrip2d');
    expect(def.rootVar).toBe('--job-strip-2d-height');
    expect(document.documentElement.style.getPropertyValue(def.rootVar)).toBe(`${JOB_STRIP.heightPx.desktop}px`);
    const css = readFileSync('bspline-frame-builder/styles/editor.css', 'utf8');
    const coarse = css.slice(css.indexOf('@media (pointer: coarse) {\n    /* Moved OUT of normal flow'));
    const rules = [...coarse.matchAll(/\.editor-history \{[^}]*bottom: calc\(([^;]*)\);/g)].map((m) => m[1]);
    expect(rules.length).toBe(2); // the pill, and its lift above the drawer
    for (const r of rules) expect(r).toContain(`var(${def.rootVar}, 0px)`);
    const hint = css.slice(css.indexOf('#editorStatusHint {'));
    expect(hint.slice(0, hint.indexOf(';'))).toContain(`var(${def.rootVar}, 0px)`);
  });
});

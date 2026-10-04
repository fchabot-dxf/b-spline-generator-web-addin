/**
 * F35 item 16 follow-up (Fred: "the existing LOADING signal... must also cover [bricks, the
 * height-mask pass, slow resolution rebuilds]... reuse it, don't invent a new one... show it when
 * the work takes > ~250 ms (no flicker for fast ones)... declare the stages as data"). core/
 * loading-signal.js's `withLoadingStage` reuses core/fusion-bridge.js's own `setFusionStatus` --
 * the app's one existing reusable status-line surface -- rather than a new status UI.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { withLoadingStage, LOADING_STAGES } from '../bspline-frame-builder/b-spline-gen/html/core/loading-signal.js';

const FIXTURE = `<div id="fusion-status" class="fusion-status" hidden role="status" aria-live="polite"></div>`;
const $status = () => document.getElementById('fusion-status');

let root;
beforeEach(() => {
  root = document.createElement('div');
  root.innerHTML = FIXTURE;
  document.body.appendChild(root);
  vi.useFakeTimers();
});
afterEach(() => {
  root.remove();
  vi.useRealTimers();
});

describe('LOADING_STAGES: declared data, not a hand-rolled label per call site', () => {
  it('bricks / heightMask are plain string labels', () => {
    expect(LOADING_STAGES.bricks.label).toBe('Laying bricks…');
    expect(LOADING_STAGES.heightMask.label).toBe('Carving relief…');
  });

  it('rebuild\'s own label is a function of ctx.spacing, matching Fred\'s own example wording', () => {
    expect(LOADING_STAGES.rebuild.label({ spacing: '0.015' })).toBe('Building surface 0.015″…');
    expect(LOADING_STAGES.rebuild.label({})).toBe('Building surface…'); // no spacing given -- still a valid label
  });
});

describe('withLoadingStage: no flicker for fast operations', () => {
  it('a fn that resolves well under 250ms never touches the status line', async () => {
    const p = withLoadingStage('bricks', () => new Promise((r) => setTimeout(r, 50)));
    await vi.advanceTimersByTimeAsync(50);
    await p;
    expect($status().hidden).toBe(true);
    expect($status().textContent).toBe('');
  });

  it('a purely synchronous fn (no internal await at all) never touches the status line either', async () => {
    const result = await withLoadingStage('bricks', () => 'done-synchronously');
    expect(result).toBe('done-synchronously');
    expect($status().hidden).toBe(true);
  });
});

describe('withLoadingStage: shows the stage label once the threshold is crossed, clears it after', () => {
  it('shows "Laying bricks…" as busy once 250ms elapses while fn is still running, clears on completion', async () => {
    let resolveFn;
    const fn = () => new Promise((r) => { resolveFn = r; });
    const p = withLoadingStage('bricks', fn);

    await vi.advanceTimersByTimeAsync(249);
    expect($status().hidden).toBe(true); // not yet -- still under the threshold

    await vi.advanceTimersByTimeAsync(2);
    expect($status().hidden).toBe(false);
    expect($status().textContent).toBe('Laying bricks…');
    expect($status().dataset.kind).toBe('busy');

    resolveFn('the-result');
    const result = await p;
    expect(result).toBe('the-result');
    expect($status().hidden).toBe(true);
    expect($status().textContent).toBe('');
  });

  it('passes ctx through to a dynamic label (the rebuild stage\'s own resolution value)', async () => {
    let resolveFn;
    const p = withLoadingStage('rebuild', () => new Promise((r) => { resolveFn = r; }), { spacing: '0.011' });
    await vi.advanceTimersByTimeAsync(300);
    expect($status().textContent).toBe('Building surface 0.011″…');
    resolveFn();
    await p;
  });

  it('still clears the timer and the status line when fn REJECTS, and re-throws', async () => {
    let rejectFn;
    const p = withLoadingStage('heightMask', () => new Promise((_, rej) => { rejectFn = rej; }));
    const assertion = expect(p).rejects.toThrow('carving failed');
    await vi.advanceTimersByTimeAsync(300);
    expect($status().textContent).toBe('Carving relief…');
    rejectFn(new Error('carving failed'));
    await assertion;
    expect($status().hidden).toBe(true); // cleaned up despite the rejection
  });

  it('an unknown stage id is a safe no-op wrapper -- fn still runs, its result still returned, status line never touched', async () => {
    const result = await withLoadingStage('notARealStage', () => 'value');
    expect(result).toBe('value');
    expect($status().hidden).toBe(true);
  });
});

/**
 * 2026-10-10 (seat A; the phone profile of a board-size nudge on a loaded board): one nudge built the 3D FOUR times
 * (the param's own rebuild on the old masks, the editor resync's commit, the brick re-lay's commit, its remask) and
 * only the last one was the board asked for. The rebuild hold (core/engine/scheduler.js) over the declared
 * STOCK_CHANGE_STAGES (main/app-init.js) makes it ONE build after the last stage closes, with a backstop.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, drawFrameProfile: vi.fn() };
});

import {
  scheduleRebuild, isRebuildScheduled, openRebuildHold, joinRebuildHold, isRebuildHeld, deferToHold, REBUILD_HOLD_BACKSTOP_MS,
} from '../bspline-frame-builder/b-spline-gen/html/core/engine/scheduler.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { STOCK_CHANGE_STAGES, STOCK_CHANGE_DEFERS } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';
import { refreshAllStampMasks } from '../bspline-frame-builder/b-spline-gen/html/main/stamp-mask-manager.js';

const HTML = join(__dirname, '../bspline-frame-builder/b-spline-gen/html');

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  vi.advanceTimersByTime(REBUILD_HOLD_BACKSTOP_MS + 100); // no hold leaks into the next test
  vi.useRealTimers();
});

describe('the rebuild hold (scheduler)', () => {
  it('a held scheduleRebuild records only the latest fn; it runs ONCE, after the last joined stage closes', () => {
    const fns = [vi.fn(), vi.fn(), vi.fn()];
    openRebuildHold(['a', 'b']);
    const closeA = joinRebuildHold('a'), closeB = joinRebuildHold('b');
    scheduleRebuild(fns[0], 0);
    vi.advanceTimersByTime(500);
    scheduleRebuild(fns[1], 50);
    closeA(); closeA(); // idempotent
    scheduleRebuild(fns[2], 50);
    vi.advanceTimersByTime(500);
    expect(fns.map((f) => f.mock.calls.length)).toEqual([0, 0, 0]);
    expect(isRebuildScheduled()).toBe(true); // whenRebuildIdle waits for the held build
    closeB();
    expect(isRebuildHeld()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(fns.map((f) => f.mock.calls.length)).toEqual([0, 0, 1]);
    expect(isRebuildScheduled()).toBe(false);
  });

  it('a build already on its timer when the hold opens waits for the release too', () => {
    const fn = vi.fn();
    scheduleRebuild(fn, 50);
    openRebuildHold(['a']);
    const close = joinRebuildHold('a');
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
    close();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a stage that never closes cannot freeze the 3D: the backstop releases the hold', () => {
    const fn = vi.fn();
    openRebuildHold(['a']);
    joinRebuildHold('a');
    scheduleRebuild(fn, 0);
    vi.advanceTimersByTime(REBUILD_HOLD_BACKSTOP_MS - 10);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(isRebuildHeld()).toBe(false);
  });

  it('a chain LONGER than the backstop whose stages keep progressing builds ONCE (phone CPU 4: the size chain runs ~3.2 s)', () => {
    const fn = vi.fn();
    openRebuildHold(['a', 'b', 'c']);
    const closeA = joinRebuildHold('a');
    scheduleRebuild(fn, 0);
    vi.advanceTimersByTime(1700); // the resync, behind the old editor's mask pass
    const closeB = joinRebuildHold('b');
    closeA();
    vi.advanceTimersByTime(1100); // the re-lay
    const closeC = joinRebuildHold('c');
    closeB();
    vi.advanceTimersByTime(400); // its remask: 3.2 s since the open
    scheduleRebuild(fn, 50);
    expect(fn).not.toHaveBeenCalled();
    closeC();
    vi.advanceTimersByTime(REBUILD_HOLD_BACKSTOP_MS + 100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('declared deferred work: only the LATEST fn per key runs, once, at the release, then the build owed', async () => {
    const order = [];
    const build = vi.fn(() => order.push('build'));
    openRebuildHold(['a'], { defers: ['masks'] });
    const close = joinRebuildHold('a');
    expect(deferToHold('masks', () => order.push('masks 1'))).toBe(true);
    scheduleRebuild(build, 0);
    // async, as the real pass is (rasterizing): the build owed must wait for it, or the nudge builds twice
    expect(deferToHold('masks', async () => { await new Promise((r) => setTimeout(r, 30)); order.push('masks 2'); scheduleRebuild(build, 50); })).toBe(true);
    expect(deferToHold('not-declared', () => order.push('x'))).toBe(false);
    expect(isRebuildScheduled()).toBe(true);
    vi.advanceTimersByTime(500);
    expect(order).toEqual([]);
    close();
    await vi.advanceTimersByTimeAsync(100);
    expect(order).toEqual(['masks 2', 'build']); // one build: the masks' own and the owed one collapse
    expect(isRebuildScheduled()).toBe(false);
  });

  it('supersededByBuild work is DROPPED when the hold ends in a build (the build redoes it) ...', async () => {
    const frame = vi.fn(), build = vi.fn();
    openRebuildHold(['a'], { defers: ['masks', 'frame'] });
    const close = joinRebuildHold('a');
    deferToHold('frame', frame, { supersededByBuild: true });
    deferToHold('masks', () => scheduleRebuild(build, 50)); // the masks pass schedules the build
    close();
    await vi.advanceTimersByTimeAsync(100);
    expect(build).toHaveBeenCalledTimes(1);
    expect(frame).not.toHaveBeenCalled();
  });

  it('... and RUN when no build follows', () => {
    const frame = vi.fn();
    openRebuildHold(['a'], { defers: ['frame'] });
    const close = joinRebuildHold('a');
    deferToHold('frame', frame, { supersededByBuild: true });
    close();
    expect(frame).toHaveBeenCalledTimes(1);
  });

  it('deferred work alone counts as a build to come (whenRebuildIdle: Send / export wait for it), until it has run', async () => {
    openRebuildHold(['a'], { defers: ['masks'] });
    const close = joinRebuildHold('a');
    expect(isRebuildScheduled()).toBe(false);
    deferToHold('masks', async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(isRebuildScheduled()).toBe(true);
    close();
    expect(isRebuildScheduled()).toBe(true); // released, its work still running
    await vi.advanceTimersByTimeAsync(100);
    expect(isRebuildScheduled()).toBe(false);
  });

  it('the stamp masks: a refresh while a size change holds the 3D waits for its end (main/stamp-mask-manager.js)', async () => {
    window.svgEditor = null; // no layers: the pass itself is instant, its 'stampMaskUpdated' says it ran
    const ran = vi.fn();
    document.addEventListener('stampMaskUpdated', ran);
    try {
      openRebuildHold(['a'], { defers: STOCK_CHANGE_DEFERS });
      const close = joinRebuildHold('a');
      await refreshAllStampMasks(4, 4, null, () => {});
      await refreshAllStampMasks(4, 4, null, () => {});
      expect(ran).not.toHaveBeenCalled();
      close();
      await vi.advanceTimersByTimeAsync(100);
      expect(ran).toHaveBeenCalledTimes(1);
    } finally { document.removeEventListener('stampMaskUpdated', ran); }
  });

  it('no hold: deferToHold refuses, the caller runs the work now', () => {
    expect(deferToHold('masks', () => {})).toBe(false);
  });

  it('no hold, or a stage the hold did not declare: join is a no-op and builds run as before', () => {
    const fn = vi.fn();
    joinRebuildHold('a')();
    scheduleRebuild(fn, 0);
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    openRebuildHold(['a']);
    const closeA = joinRebuildHold('a');
    joinRebuildHold('not-declared'); // never counted
    closeA();
    expect(isRebuildHeld()).toBe(false);
  });

  it('a released hold with nothing scheduled builds nothing', () => {
    const fn = vi.fn();
    scheduleRebuild(fn, 0); vi.advanceTimersByTime(1); fn.mockClear();
    openRebuildHold(['a']);
    joinRebuildHold('a')();
    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('a board size change holds the 3D (main/app-init.js)', () => {
  let saved;
  beforeEach(() => {
    saved = { w: P.widthIn, h: P.heightIn, svg: P.editorSvg };
    document.body.innerHTML = '<div id="svgEditorModal" style="display:none"></div>';
  });
  afterEach(() => { P.widthIn = saved.w; P.heightIn = saved.h; P.editorSvg = saved.svg; window.svgEditor = null; });

  // the editor's surface the resync touches; its commit joins 'change-pipeline' like the real onChange, and the
  // re-lay joins 'brick-relay' on editorBoardResized like brick-panel.js
  function editor() {
    const ed = { _mW: 7, _mH: 9, _draw: { viewbox() {} }, _view: { zoom: 1, cx: 3.5, cy: 4.5 } };
    ed.setModelMetrics = (w, h) => { ed._mW = w; ed._mH = h; };
    ed.fitView = () => {};
    ed.open = (svg, w, h) => { ed._mW = w; ed._mH = h; };
    ed.pipelineCloses = [];
    ed._notifyChange = () => { ed.pipelineCloses.push(joinRebuildHold('change-pipeline')); };
    return ed;
  }

  it('the nudge\'s own rebuild, the commit and the re-lay make ONE build, after the last stage', () => {
    const ed = window.svgEditor = editor();
    P.editorSvg = '<svg/>';
    let relayClose = null;
    const onResized = () => { relayClose = joinRebuildHold('brick-relay'); };
    document.addEventListener('editorBoardResized', onResized, { once: true });
    const build = vi.fn();
    P.widthIn = 9; P.heightIn = 12;
    document.dispatchEvent(new CustomEvent('stockSizeChanged'));
    scheduleRebuild(build, 0); // applyParam's own, right after the dispatch
    expect(isRebuildHeld()).toBe(true);
    vi.advanceTimersByTime(400); // the resync ran: its commit and the re-lay joined before its own stage closed
    expect(isRebuildHeld()).toBe(true);
    ed.pipelineCloses[0]();
    scheduleRebuild(build, 50); // the commit's remask
    vi.advanceTimersByTime(500);
    expect(build).not.toHaveBeenCalled();
    relayClose();
    vi.advanceTimersByTime(1);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('a resync with nothing to do (the editor already on this board) still closes its stage', () => {
    window.svgEditor = Object.assign(editor(), { _mW: 9, _mH: 12 });
    const build = vi.fn();
    P.widthIn = 9; P.heightIn = 12;
    document.dispatchEvent(new CustomEvent('stockSizeChanged'));
    scheduleRebuild(build, 0);
    vi.advanceTimersByTime(400);
    expect(isRebuildHeld()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('every joinRebuildHold stage in the app is a declared STOCK_CHANGE_STAGES entry, and every entry is joined', () => {
    const files = [];
    const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (n.endsWith('.js')) files.push(p); } };
    walk(HTML);
    const joined = new Set();
    for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/joinRebuildHold\('([^']+)'\)/g)) joined.add(m[1]);
    expect([...joined].sort()).toEqual([...STOCK_CHANGE_STAGES].sort());
    const deferred = new Set();
    for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/deferToHold\('([^']+)'/g)) deferred.add(m[1]);
    expect([...deferred].sort()).toEqual([...STOCK_CHANGE_DEFERS].sort());
  });
});

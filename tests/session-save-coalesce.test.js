/**
 * core/state.js SESSION_SAVE (seat A 2026-10-11, the advisor's pick; matrix blind row "Surface: photo layer Filter shows
 * through drag", 58 ms frozen): a per-input write (updateP, a slider row's tweak) asks for ONE trailing session save
 * instead of serialising the whole board on every tick; the explicit saveLastSession() still writes at once; a pending
 * save is flushed when the page hides / is left, and before Save, Send, a load / New.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  P, DEFAULT, updateP, saveLastSession, loadLastSession, SESSION_SAVE, scheduleSessionSave, flushSessionSave, sessionSavePending,
} from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { setTweak } from '../bspline-frame-builder/b-spline-gen/html/core/noise/tweaks-ui.js';

const KEY = 'splineGenLastSession';
const H = 'bspline-frame-builder/b-spline-gen/html/';
let writes;

// one spy for the file (a second spyOn after mockRestore does not re-attach to jsdom's Storage -- MEASURED here)
beforeAll(() => { writes = vi.spyOn(Storage.prototype, 'setItem'); });
afterAll(() => { writes.mockRestore(); });
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  Object.assign(P, JSON.parse(JSON.stringify(DEFAULT)));
  writes.mockClear();
});
afterEach(() => {
  flushSessionSave();
  vi.useRealTimers();
});
const sessionWrites = () => writes.mock.calls.filter(([k]) => k === KEY).length;

describe('SESSION_SAVE: one trailing save per burst', () => {
  it('declared: a quarter-second of quiet', () => {
    expect(SESSION_SAVE.trailingMs).toBe(250);
  });

  it('a slider drag of 12 ticks (updateP each) = ONE session save, after the quiet', () => {
    for (let i = 0; i < 12; i++) { updateP('photoFilterAmount', 10 + i); vi.advanceTimersByTime(40); }
    expect(sessionWrites()).toBe(0); // nothing in the gesture
    expect(sessionSavePending()).toBe(true);
    vi.advanceTimersByTime(SESSION_SAVE.trailingMs);
    expect(sessionWrites()).toBe(1);
    expect(JSON.parse(localStorage.getItem(KEY)).P.photoFilterAmount).toBe(21);
  });

  it('a slider row\'s tweak ticks coalesce the same way', () => {
    for (let i = 0; i < 8; i++) setTweak('photo', 'scale', 1 + i / 10);
    expect(sessionWrites()).toBe(0);
    vi.advanceTimersByTime(SESSION_SAVE.trailingMs);
    expect(sessionWrites()).toBe(1);
  });

  it('an explicit saveLastSession() writes at once and takes the pending save with it (no second write)', () => {
    updateP('photoFilterAmount', 33);
    saveLastSession();
    expect(sessionWrites()).toBe(1);
    expect(sessionSavePending()).toBe(false);
    vi.advanceTimersByTime(SESSION_SAVE.trailingMs * 4);
    expect(sessionWrites()).toBe(1);
  });

  it('flushSessionSave writes a pending save now, and is a no-op with none pending', () => {
    flushSessionSave();
    expect(sessionWrites()).toBe(0);
    scheduleSessionSave();
    flushSessionSave();
    expect(sessionWrites()).toBe(1);
    vi.advanceTimersByTime(SESSION_SAVE.trailingMs * 4);
    expect(sessionWrites()).toBe(1);
  });

  it('an edit, then the page leaving (its flush), then a reload: the edit is restored', () => {
    updateP('photoFilterAmount', 57);
    flushSessionSave(); // what visibilitychange-hidden runs; pagehide runs saveLastSession -- both write it
    P.photoFilterAmount = DEFAULT.photoFilterAmount; // the reload's fresh state
    expect(loadLastSession()).toBe(true);
    expect(P.photoFilterAmount).toBe(57);
  });
});

describe('the flush points are wired (main.js, Save, Send, a load / New)', () => {
  const src = (f) => readFileSync(H + f, 'utf8');
  it('leaving the page saves; hiding it flushes', () => {
    expect(src('main/main.js')).toMatch(/addEventListener\('pagehide', \(\) => saveLastSession\(\)\)/);
    expect(src('main/main.js')).toMatch(/visibilityState === 'hidden'\) flushSessionSave\(\)/);
  });
  it('Save (every save goes through _saveTo), Send, and applySnapshot (a load and New) flush first', () => {
    expect(src('main/cloud-project-manager.js')).toMatch(/async function _saveTo\(fullName\) \{\s*flushSessionSave\(\);/);
    expect(src('main/export-flow.js')).toMatch(/async function sendToFusion\([^)]*\) \{\s*flushSessionSave\(\);/);
    expect(src('main/snapshot-manager.js')).toMatch(/if \(!snap\) return Promise\.resolve\(\);\s*flushSessionSave\(\);/);
  });
});

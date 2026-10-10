/**
 * Seat A's re-time 2026-10-09 (main e6c4f35, phone 390 px, CPU x4): the Art tab's Undo, Redo, Lattice / Shape Generate
 * and an Undo after a Generate froze 0.56-0.9 s with NO feedback at all. Each now runs behind a declared loading stage
 * (core/loading-signal.js LOADING_STAGES undo / redo / latticeGenerate), on screen before the work. A Generate awaits
 * inside, so withLoadingStageShownFirst keeps an async job's stage up until its promise settles.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  LOADING_STAGES, withLoadingStageShownFirst, setPaintScheduler, currentLoadingStage, HIDE_GRACE_MS, MIN_VISIBLE_MS,
} from '../bspline-frame-builder/b-spline-gen/html/core/loading-signal.js';
import { registerActionTools } from '../bspline-frame-builder/b-spline-gen/html/editor/tools/action-tools.js';

const waitOut = () => new Promise((r) => setTimeout(r, Math.max(HIDE_GRACE_MS, MIN_VISIBLE_MS) + 50)); // the pill's anti-flicker hold

beforeEach(() => {
  document.body.innerHTML = '<div id="loading-stage" hidden><span class="loading-stage-text"></span></div>'
    + '<button id="editorUndo"></button><button id="editorRedo"></button>';
});
afterEach(() => { document.body.innerHTML = ''; });

describe('the Art actions: declared stages, on screen before the work', () => {
  it('declared: undo / redo / latticeGenerate, small pills', () => {
    expect(LOADING_STAGES.undo).toEqual({ group: 'refreshing', label: 'undoing', surface: 'pill' });
    expect(LOADING_STAGES.redo).toEqual({ group: 'refreshing', label: 'redoing', surface: 'pill' });
    expect(LOADING_STAGES.latticeGenerate).toEqual({ group: 'computing', label: 'generating the lattice', surface: 'pill' });
  });

  it("the editor's Undo / Redo buttons: the stage first, the undo in the paint step", () => {
    const calls = [];
    registerActionTools({ undo: () => calls.push('undo'), redo: () => calls.push('redo') });
    let paint = null;
    setPaintScheduler((cb) => { paint = cb; });
    document.getElementById('editorUndo').click();
    expect(currentLoadingStage()?.id).toBe('undo');
    expect(calls).toEqual([]); // nothing ran yet
    paint();
    expect(calls).toEqual(['undo']);
    document.getElementById('editorRedo').click();
    expect(currentLoadingStage()?.id).toBe('redo');
    paint();
    expect(calls).toEqual(['undo', 'redo']);
  });
});

describe('withLoadingStageShownFirst: an async job keeps its stage until it is done', () => {
  it('up while the promise is pending (past the anti-flicker hold); gone once it settles', async () => {
    let done;
    const job = new Promise((r) => { done = r; });
    const out = withLoadingStageShownFirst('latticeGenerate', () => job);
    await waitOut();
    expect(currentLoadingStage()?.id).toBe('latticeGenerate');
    done(7);
    expect(await out).toBe(7);
    await waitOut();
    expect(currentLoadingStage()).toBeFalsy();
  });

  it('a rejected job, or one that throws, still leaves its stage', async () => {
    await expect(withLoadingStageShownFirst('latticeGenerate', () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(withLoadingStageShownFirst('latticeGenerate', () => { throw new Error('y'); })).rejects.toThrow('y');
    await waitOut();
    expect(currentLoadingStage()).toBeFalsy();
  });

  it('a synchronous job: unchanged, it runs inside the paint step and its stage leaves at once', async () => {
    let ran = false;
    const out = withLoadingStageShownFirst('undo', () => { ran = true; return 3; });
    expect(ran).toBe(true); // the suite's immediate paint step
    expect(await out).toBe(3);
    await waitOut();
    expect(currentLoadingStage()).toBeFalsy();
  });
});

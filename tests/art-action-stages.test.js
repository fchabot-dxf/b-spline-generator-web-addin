/**
 * Seat A's re-time 2026-10-09 (main e6c4f35, phone 390 px, CPU x4): the Art tab's Undo, Redo, Lattice / Shape Generate
 * and an Undo after a Generate froze 0.56-0.9 s with NO feedback at all. Each now runs behind a declared loading stage
 * (core/loading-signal.js LOADING_STAGES undo / redo / latticeGenerate), on screen before the work. A Generate awaits
 * inside, so withLoadingStageShownFirst keeps an async job's stage up until its promise settles.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  LOADING_STAGES, LOADING_SEQUENCES, withLoadingStageShownFirst, setPaintScheduler, currentLoadingStage, HIDE_GRACE_MS, MIN_VISIBLE_MS, SEQUENCE_IDLE_MS,
} from '../bspline-frame-builder/b-spline-gen/html/core/loading-signal.js';
import { registerActionTools } from '../bspline-frame-builder/b-spline-gen/html/editor/tools/action-tools.js';

const waitOut = () => new Promise((r) => setTimeout(r, Math.max(HIDE_GRACE_MS, MIN_VISIBLE_MS) + 50)); // the pill's anti-flicker hold

beforeEach(() => {
  document.body.innerHTML = '<div id="loading-stage" hidden><span class="loading-stage-text"></span></div>'
    + '<button id="editorUndo"></button><button id="editorRedo"></button><button id="editorApply"></button>';
});
afterEach(() => { document.body.innerHTML = ''; });

// seat D 2026-10-09 (Fred's 20 projects on the phone rig: 3D / Apply after a Generate ~120 ms blind -- the text commit, the
// drawing's save and the session write ran in the tap, before the carve's card)
describe("Apply: the sequence's first step 'saving the drawing' on screen first, until the commit is done", () => {
  it('declared: applyEdits, the first of the apply sequence', () => {
    expect(LOADING_STAGES.applyEdits).toEqual({ group: 'computing', label: 'saving the drawing', surface: 'card' });
    expect(LOADING_SEQUENCES.apply.stages).toEqual(['applyEdits', 'heightMask', 'rebuild']);
  });

  it('the tap only puts the step up; the save runs in the paint step; the step stays until the commit settles', async () => {
    let saved = 0, finish;
    const editor = { save: () => { saved++; return '<svg/>'; }, _onCommit: () => new Promise((r) => { finish = r; }) };
    registerActionTools(editor);
    let paint = null;
    setPaintScheduler((cb) => { paint = cb; });
    document.getElementById('editorApply').click();
    expect(currentLoadingStage()?.id).toBe('applyEdits');
    expect(currentLoadingStage()?.text).toBe('Computing - saving the drawing, step 1 of 3');
    expect(saved).toBe(0); // nothing of the commit ran in the tap
    paint();
    expect(saved).toBe(1);
    // a sequence keeps its card up SEQUENCE_IDLE_MS between steps, so "held" is only visible past that
    const pastIdle = () => new Promise((r) => setTimeout(r, SEQUENCE_IDLE_MS + Math.max(HIDE_GRACE_MS, MIN_VISIBLE_MS) + 100));
    await pastIdle();
    expect(currentLoadingStage()?.id).toBe('applyEdits'); // the async commit is still running
    finish();
    await pastIdle();
    expect(currentLoadingStage()).toBeFalsy(); // done: no carve / build followed here, so the sequence ended
  });
});

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

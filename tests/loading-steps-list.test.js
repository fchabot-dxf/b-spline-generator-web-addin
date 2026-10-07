/**
 * Fred (2026-10-07): "the load splash could list all the steps" -- a loading CARD inside a sequence lists every step
 * (done ticked, the current one, the rest pending; passed-without-running = skipped), once in the card renderer
 * (core/loading-signal.js), so the app refresh, Fusion Send and CAM BUILD cards all get it; pills show no list. And
 * the steps can GROW live (growLoadingSequence): the declared sequence is only the starting list.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  LOADING_SEQUENCES, LOADING_STAGES, beginLoadingSequence, holdLoadingStage, growLoadingSequence,
  currentLoadingStage, currentLoadingSteps, resetLoadingSignal, stepLabel,
} from '../bspline-frame-builder/b-spline-gen/html/core/loading-signal.js';
import CAM_STAGES from '../bspline-frame-builder/CAM-builder/ui/html/cam-stages.js';

beforeAll(async () => {
  document.body.innerHTML = '<div id="loading-stage" class="loading-stage" hidden><span class="loading-stage-spinner"></span><span class="loading-stage-text"></span></div>';
  await import('../bspline-frame-builder/CAM-builder/ui/html/cam-loading.js'); // registers the CAM sequences
});
afterEach(() => resetLoadingSignal());

describe('every declared sequence lists its steps on a card', () => {
  for (const seqId of ['generate', 'apply', 'newSeed', 'projectLoad', 'sessionRestore', 'export', 'send', 'camBuild', 'camApply']) {
    it(`${seqId}: each step in turn -- earlier ones done, this one current, the rest pending`, async () => {
      const stages = LOADING_SEQUENCES[seqId].stages;
      expect(stages.length).toBeGreaterThan(1);
      beginLoadingSequence(seqId);
      for (let i = 0; i < stages.length; i++) {
        await holdLoadingStage(stages[i]);
        const steps = currentLoadingSteps();
        if (currentLoadingStage().surface !== 'card') { expect(steps).toBe(null); continue; }
        expect(steps.map((s) => s.id)).toEqual(stages);
        expect(steps.map((s) => s.state)).toEqual(stages.map((_, j) => (j < i ? 'done' : j === i ? 'current' : 'pending')));
        expect(steps[i].label).toBe(stepLabel(stages[i]));
      }
    });
  }
  it('CAM BUILD ends with APPLY as its own 5th step (H23 item 101)', async () => {
    expect(CAM_STAGES.sequences.camBuild).toEqual(['camWcs', 'camCleanup', 'camModels', 'camSetups', 'camBuildApply']);
    beginLoadingSequence('camBuild');
    await holdLoadingStage('camBuildApply');
    expect(currentLoadingStage().text).toBe('Waiting - Fusion: applying toolpaths, step 5 of 5');
    expect(currentLoadingSteps().at(-1)).toEqual({ id: 'camBuildApply', label: 'Fusion: applying toolpaths', state: 'current' });
  });
});

describe('the list itself', () => {
  it('a step passed without running reads skipped (no cleanup on a reuse)', async () => {
    beginLoadingSequence('camBuild');
    await holdLoadingStage('camWcs');
    await holdLoadingStage('camModels');
    expect(currentLoadingSteps().map((s) => s.state)).toEqual(['done', 'skipped', 'current', 'pending', 'pending']);
  });
  it('a pill shows no list, and no sequence = no list', async () => {
    await holdLoadingStage('bricks');
    expect(currentLoadingStage().surface).toBe('pill');
    expect(currentLoadingSteps()).toBe(null);
    resetLoadingSignal();
    await holdLoadingStage('cloudLoad');
    expect(currentLoadingStage().surface).toBe('card');
    expect(currentLoadingSteps()).toBe(null);
  });
});

describe('the steps grow live', () => {
  it('a step inserted mid-run shows at once, pending, then runs; the declared list is untouched', async () => {
    beginLoadingSequence('camBuild');
    await holdLoadingStage('camModels');
    expect(growLoadingSequence({ insertAfter: 'camSetups', step: { id: 'camTpgenPass2', label: 'Fusion: toolpaths, pass 2' } })).toBe(true);
    expect(currentLoadingSteps().map((s) => `${s.id}:${s.state}`)).toEqual(
      ['camWcs:skipped', 'camCleanup:skipped', 'camModels:current', 'camSetups:pending', 'camTpgenPass2:pending', 'camBuildApply:pending']);
    await holdLoadingStage('camTpgenPass2');
    expect(currentLoadingStage().text).toBe('Waiting - Fusion: toolpaths, pass 2, step 5 of 6');
    expect(currentLoadingSteps()[4]).toEqual({ id: 'camTpgenPass2', label: 'Fusion: toolpaths, pass 2', state: 'current' });
    expect(LOADING_SEQUENCES.camBuild.stages).not.toContain('camTpgenPass2');
    expect(LOADING_STAGES.camTpgenPass2).toBeTruthy();
  });
  it('a whole new list from the reporter replaces the list; the CAM stage report carries it (cam-loading.js)', async () => {
    window.camLoading.begin('camApply');
    await window.camLoading.stage('camTemplates', { steps: ['camTemplates', 'camToolpaths', { id: 'camTpgenPass3', label: 'Fusion: toolpaths, pass 3' }] });
    expect(currentLoadingSteps().map((s) => s.id)).toEqual(['camTemplates', 'camToolpaths', 'camTpgenPass3']);
    expect(growLoadingSequence({ insertAfter: 'camToolpaths', step: 'camToolpaths' })).toBe(false); // already listed
  });
  it('nothing grows without a running sequence', () => {
    expect(growLoadingSequence({ steps: ['camWcs'] })).toBe(false);
  });
});

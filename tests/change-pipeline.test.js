/**
 * SE8b-2 — SE8b's `_notifyChange('live')` already caps the fan-out at one
 * `_onChange` per animation frame, but `_onChange` itself was still the
 * WHOLE pipeline (saveForRasterization -> P.editorSvg write ->
 * saveLastSession (localStorage) -> refreshAllStampMasks), running in
 * full on every throttled drag frame. Nobody had measured which step
 * costs what.
 *
 * `CHANGE_PIPELINE` (main/app-init.js) declares which steps each kind
 * runs — 'live' never includes `persist` (saveLastSession), so a drag
 * never writes to localStorage mid-gesture; 'commit' (once per gesture)
 * still runs the full sequence, unchanged. `runChangePipeline` is the
 * declared table's interpreter, taking its three steps as plain
 * callbacks so it's testable with mocks — no live editor/DOM/3D preview
 * needed; the REAL wiring (main/app-init.js's initSvgEditor) closes over
 * window.svgEditor/P/resolveGrid and isn't re-tested here (matches the
 * rest of this file's own testing precedent — runMigrations/
 * editorRestoreSvg are tested the same way, the DOM-heavy callers are
 * not). `_perfLog` is the PERF debug-category gate (core/debug.js) that
 * times each step — off by default, so this measurement costs nothing
 * until an advisor switches it on.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  runChangePipeline, _perfLog, CHANGE_PIPELINE,
} from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';

function mockSteps(svgReturn = '<svg/>') {
  const calls = [];
  return {
    calls,
    serialize: async () => { calls.push('serialize'); return svgReturn; },
    persist: () => { calls.push('persist'); },
    remask: async () => { calls.push('remask'); },
  };
}

describe('CHANGE_PIPELINE (the declared table itself)', () => {
  it('live never includes persist; commit does, in the same relative order', () => {
    expect(CHANGE_PIPELINE.live).toEqual(['serialize', 'remask']);
    expect(CHANGE_PIPELINE.commit).toEqual(['serialize', 'persist', 'remask']);
  });
});

describe('runChangePipeline', () => {
  it("'live': serializes and remasks, but NEVER persists", async () => {
    const steps = mockSteps();
    await runChangePipeline('live', steps);
    expect(steps.calls).toEqual(['serialize', 'remask']);
  });

  it("'commit': persists exactly once, between serialize and remask", async () => {
    const steps = mockSteps();
    await runChangePipeline('commit', steps);
    expect(steps.calls).toEqual(['serialize', 'persist', 'remask']);
  });

  it('serialize returning falsy stops the pipeline right there, for EITHER kind (mirrors the original "editor not drawn yet" guard)', async () => {
    const liveSteps = mockSteps('');
    await runChangePipeline('live', liveSteps);
    expect(liveSteps.calls).toEqual(['serialize']);

    const commitSteps = mockSteps(null);
    await runChangePipeline('commit', commitSteps);
    expect(commitSteps.calls).toEqual(['serialize']);
  });

  it('an unrecognized kind falls back to the commit pipeline (the default for "any other caller")', async () => {
    const steps = mockSteps();
    await runChangePipeline('bogus', steps);
    expect(steps.calls).toEqual(['serialize', 'persist', 'remask']);
  });
});

describe('_perfLog: the PERF debug-category gate', () => {
  afterEach(() => { window.__editorDebug = false; });

  it('off by default: no console output at all', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    window.__editorDebug = false;
    _perfLog('live serialize 3.1ms');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("enabled via 'PERF': logs through dbg(), category-prefixed", () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    window.__editorDebug = 'PERF';
    _perfLog('live serialize 3.1ms');
    expect(spy).toHaveBeenCalledWith('[PERF]', 'live serialize 3.1ms');
    spy.mockRestore();
  });

  it('a DIFFERENT category being enabled does not leak PERF logs', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    window.__editorDebug = 'SOME-OTHER-CATEGORY';
    _perfLog('should not appear');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

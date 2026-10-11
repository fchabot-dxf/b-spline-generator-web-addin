/**
 * Fred: "3D canvas also has some setting that refresh the geometry without spinner". Seat D's 3D-controls sweep (claude_1,
 * 900 px, CPU x4) found 7 Decor controls (brick Surface wear / Grout depth, the stamp Blur / fillet / Profile) blind
 * 59-261 ms before their 'carving relief' card; the profiler named the work: refreshAllStampMasks -> updateStampMasks ->
 * getLayerSvg / _parseLayerContent / rasterizeSvg, run before any stage painted (from app-init.js's change pipeline and
 * param-manager.js applyParam alike). The whole mask pass is the declared 'heightMask' stage, on screen first.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/engine.js', () => ({ scheduleRebuild: vi.fn(), rebuild: vi.fn() }));

import { refreshAllStampMasks } from '../bspline-frame-builder/b-spline-gen/html/main/stamp-mask-manager.js';
import { setPaintScheduler, currentLoadingStage, resetLoadingSignal } from '../bspline-frame-builder/b-spline-gen/html/core/loading-signal.js';

afterEach(() => { setPaintScheduler((cb) => cb()); resetLoadingSignal(); delete window.svgEditor; });

describe('refreshAllStampMasks: the heightMask stage paints before the mask pass starts', () => {
  it('the stage is up and no layer is read until the paint; then the pass runs', async () => {
    document.body.innerHTML = '<div id="loading-stage" hidden><span class="loading-stage-text"></span></div>';
    const reads = [];
    Object.defineProperty(window, 'svgEditor', { configurable: true, get: () => { reads.push('editor'); return null; } });
    let paint = null;
    setPaintScheduler((cb) => { paint = cb; });
    const run = refreshAllStampMasks(10, 10, null, () => {});
    await Promise.resolve(); await Promise.resolve();
    expect(currentLoadingStage()?.id).toBe('heightMask');
    expect(reads).toEqual([]); // nothing of the pass ran before the paint
    while (paint) { const p = paint; paint = null; p(); await Promise.resolve(); }
    await run;
    expect(reads.length).toBeGreaterThan(0); // the pass ran (updateStampMasks read the editor's layers)
  });
});

// The brick side: a 3D-only brick setting's release (BRICK_COMMIT.surface: Surface wear, Grout depth ...) saved the
// session, pushed its undo step and ran the change pipeline's serialize before any card (100-125 ms blind, profiled).
describe('a brick surface setting release: the heightMask stage first', () => {
  it('the release (its undo push and re-mask) runs in the paint step, behind the stage', async () => {
    const { commitBrickSetting } = await import('../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js');
    document.body.innerHTML = '<div id="loading-stage" hidden><span class="loading-stage-text"></span></div>';
    const pushes = [];
    window.svgEditor = { pushState: () => pushes.push(1), _notifyChange: () => {}, _undoStack: [], _layers: [] };
    let paint = null;
    setPaintScheduler((cb) => { paint = cb; });
    commitBrickSetting('surface', 'onRelease');
    expect(currentLoadingStage()?.id).toBe('heightMask');
    expect(pushes).toEqual([]); // _remaskSurface (commitEdit -> pushState) waits for the paint
    while (paint) { const p = paint; paint = null; p(); await Promise.resolve(); }
    expect(pushes.length).toBeGreaterThan(0);
  });
});

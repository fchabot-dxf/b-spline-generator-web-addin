/**
 * Seat D 2026-10-08 (Brick-tab phone audit, tools/repro/art_phone_audit.mjs SURFACE=brick, 390 px, CPU x4, real touch;
 * Fred's rule: a loading signal before every long computation): a Brush / Raised brush / Grout cut stroke baked its
 * bricks INSIDE the finger-up handler -- ~100 ms frozen with no card before the follow-up lay's 'bricks' stage painted.
 * The bake now waits for the 'bricks' stage to be on screen; the live stroke line stays until the bake replaces it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { brickBrushHandler } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { currentLoadingStage, resetLoadingSignal, setPaintScheduler } from '../bspline-frame-builder/b-spline-gen/html/core/loading-signal.js';

describe('a Brush stroke shows the bricks stage before its bake', () => {
  let frames;
  beforeEach(() => {
    document.body.innerHTML = '<div id="loading-stage" hidden><span class="loading-stage-text"></span></div>';
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb) => { frames.push(cb); return frames.length; });
    setPaintScheduler(null); // the real paint step (the suite's is immediate)
    resetLoadingSignal();
  });
  afterEach(() => { setPaintScheduler((cb) => cb()); vi.unstubAllGlobals(); resetLoadingSignal(); });

  it('finger up: the stage is entered and the stroke line kept; the bake runs only after the paint', async () => {
    const preview = { remove: vi.fn() };
    // the bake itself needs the live editor's layers; here it fails once it runs, after the stage -- only the ORDER is under test
    const editor = { _isDrawing: true, _currentPath: preview, _points: [[0, 0], [1, 0], [2, 0.1]], _brickSettings: { setId: 'red' } };
    const done = brickBrushHandler.finish(editor);
    expect(editor._isDrawing).toBe(false);
    expect(currentLoadingStage()?.id).toBe('bricks');
    expect(preview.remove).not.toHaveBeenCalled(); // nothing baked yet: the stage gets its paint first
    while (frames.length) frames.shift()();
    await Promise.resolve(done).catch(() => {});
    expect(preview.remove).toHaveBeenCalledTimes(1);
  });

  it('a tap (one point) bakes nothing and enters no stage', () => {
    const preview = { remove: vi.fn() };
    const editor = { _isDrawing: true, _currentPath: preview, _points: [[0, 0]], _brickSettings: { setId: 'red' } };
    brickBrushHandler.finish(editor);
    expect(preview.remove).toHaveBeenCalledTimes(1);
    expect(currentLoadingStage()).toBeFalsy();
  });
});

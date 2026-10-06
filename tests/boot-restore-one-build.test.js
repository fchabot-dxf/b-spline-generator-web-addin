/**
 * Item 37 (seat E, measured live at CPU x4): a page load built the 3D TWICE -- initApp masked the saved drawing before
 * the editor existed (an unmasked surface: 17 k of 25.5 k cells off by up to 0.37 in, on screen 1.4-5 s, sometimes with
 * no loading card), then initSvgEditor's restore masked it for real. The boot build now has ONE owner
 * (app-init.js bootBuildOwner), and its landed build is the declared restore end (core/state.js bootRestore) that probes
 * and the brick matrix wait on instead of a quiet window.
 *
 * vi.mock stands in for the engine / mask / editor modules (the snapshot-manager.test.js precedent): what is under
 * test is the WIRING -- who builds, how often, and when the restore is declared complete.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/engine.js', () => ({
  rebuild: vi.fn(async () => {}),
  whenRebuildIdle: vi.fn(async () => {}),
  scheduleRebuild: vi.fn(),
}));
vi.mock('../bspline-frame-builder/b-spline-gen/html/main/stamp-mask-manager.js', () => ({
  refreshAllStampMasks: vi.fn(async () => {}),
  updateStampMasks: vi.fn(async () => true),
}));
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/index.js', () => ({
  VectorEditor: class {
    initEditor() {}
    open() { if (globalThis.__bootOpenThrows) throw new Error('open failed'); }
  },
}));

import { rebuild } from '../bspline-frame-builder/b-spline-gen/html/core/engine.js';
import { refreshAllStampMasks } from '../bspline-frame-builder/b-spline-gen/html/main/stamp-mask-manager.js';
import { P, bootRestore } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { initApp, initSvgEditor, bootBuildOwner } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';

const DRAWING = '<svg xmlns="http://www.w3.org/2000/svg"><g id="Layer 1"><rect width="1" height="1"/></g></svg>';
const flush = () => new Promise((r) => setTimeout(r, 0));

async function boot() {
  initApp(null, () => {});
  initSvgEditor(null);
  for (let i = 0; i < 5; i++) await flush();
}

describe('item 37: a page load builds the 3D once, and declares when it landed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.svgEditor = undefined;
    globalThis.__bootOpenThrows = false;
    bootRestore.complete = false; bootRestore.generation = null;
  });

  it('the owner is declared from the saved drawing', () => {
    P.editorSvg = DRAWING;
    expect(bootBuildOwner()).toBe('initSvgEditor');
    P.editorSvg = '';
    expect(bootBuildOwner()).toBe('initApp');
  });

  it('a saved drawing: initApp does not build; the editor restore masks + builds once; then the restore is complete', async () => {
    P.editorSvg = DRAWING;
    initApp(null, () => {});
    await flush();
    expect(rebuild).not.toHaveBeenCalled();
    expect(refreshAllStampMasks).not.toHaveBeenCalled();
    expect(bootRestore.complete).toBe(false);
    initSvgEditor(null);
    for (let i = 0; i < 5; i++) await flush();
    expect(refreshAllStampMasks).toHaveBeenCalledTimes(1);
    expect(rebuild).not.toHaveBeenCalled();
    expect(bootRestore.complete).toBe(true);
  });

  it('no drawing: initApp builds once (no editor restore will come); the restore is complete', async () => {
    P.editorSvg = '';
    await boot();
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(refreshAllStampMasks).not.toHaveBeenCalled();
    expect(bootRestore.complete).toBe(true);
  });

  it('a saved drawing whose editor restore fails still builds the board once, and completes', async () => {
    P.editorSvg = DRAWING;
    globalThis.__bootOpenThrows = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await boot();
    warn.mockRestore();
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(refreshAllStampMasks).not.toHaveBeenCalled();
    expect(bootRestore.complete).toBe(true);
  });
});

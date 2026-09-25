/**
 * T45 (Fred: "on open, a loaded project doesn't have the SVG until I open
 * the editor and Apply Stencils"). applySnapshot is BOTH the global
 * undo/redo apply step AND the project-load apply step (cloud-project-
 * manager.js's _loadFrom); it used to treat them identically, which was
 * correct for undo (SE4c: the drawing has its own undo stack) but wrong
 * for load (a project load must ALSO replace the live editor's own
 * document — P.editorSvg alone isn't what the mask/drape/export pipeline
 * reads).
 *
 * This file uses vi.mock for applySnapshot's heavy sibling modules
 * (engine/stamp-mask-manager/sculpt-interaction/terrain/app-init) — a
 * deliberate departure from this suite's usual "real DOM/object stand-ins,
 * no vi.mock" convention (see export-flow.test.js's own T44 notice on
 * that convention). Those modules pull in real rasterization/engine/grid
 * machinery this function only needs to CALL correctly, not execute for
 * real; the thing actually under test here is the WIRING — does 'load'
 * call editor.open() and refreshDrape, does 'undo' not — not those other
 * modules' own internals (each already has, or doesn't need, its own
 * test coverage). state.js/history.js/ui-utils.js stay REAL (their own
 * setters/DOM lookups already guard safely against a happy-dom document
 * with no matching elements, confirmed by reading them, not assumed).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/main/stamp-mask-manager.js', () => ({
  updateStampMasks: vi.fn(async () => true),
}));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/engine.js', () => ({
  scheduleRebuild: vi.fn(),
  rebuild: vi.fn(),
}));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/sculpt-interaction.js', () => ({
  updatePreviewSculptMode: vi.fn(),
}));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/terrain.js', () => ({
  resolveGrid: vi.fn(() => ({ nx: 10, nz: 10 })),
}));
vi.mock('../bspline-frame-builder/b-spline-gen/html/main/app-init.js', () => ({
  runMigrations: vi.fn(),
  editorRestoreSvg: vi.fn(() => 'MOCK_RESTORE_SVG'),
  refreshDrape: vi.fn(async () => {}),
}));

import { applySnapshot } from '../bspline-frame-builder/b-spline-gen/html/main/snapshot-manager.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import * as appInit from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';
import { updateStampMasks } from '../bspline-frame-builder/b-spline-gen/html/main/stamp-mask-manager.js';

function mockEditor() {
  return {
    _layers: [],
    open: vi.fn(),
  };
}

describe('applySnapshot — T45: source is required, no silent default', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.svgEditor = null;
  });

  it('throws when source is omitted entirely', async () => {
    await expect(applySnapshot({ P: {} }, null)).rejects.toThrow(/source must be 'undo' or 'load'/);
  });

  it('throws when source is an unrecognized string', async () => {
    await expect(applySnapshot({ P: {} }, null, { source: 'redo' })).rejects.toThrow(/source must be 'undo' or 'load'/);
  });

  it('returns silently (no throw) when snap itself is falsy, regardless of source — the pre-existing early-return guard', async () => {
    await expect(applySnapshot(null, null, { source: 'undo' })).resolves.toBeUndefined();
  });
});

describe("applySnapshot — T45: source:'load' replaces the live editor's own document", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls editor.open(editorRestoreSvg(), P.widthIn, P.heightIn) — the SAME restore path a manual editor-open uses", async () => {
    const editor = mockEditor();
    window.svgEditor = editor;
    P.widthIn = 12;
    P.heightIn = 7;

    await applySnapshot({ P: {} }, null, { source: 'load' });

    expect(editor.open).toHaveBeenCalledTimes(1);
    expect(editor.open).toHaveBeenCalledWith('MOCK_RESTORE_SVG', 12, 7);
  });

  it('refreshes the drape — the one item editor.open() itself does NOT cover as a side effect (unlike the sidebar/outline-preview, which setActiveLayer already refreshes)', async () => {
    window.svgEditor = mockEditor();
    const preview = { marker: 'the-preview' };

    await applySnapshot({ P: {} }, preview, { source: 'load' });

    expect(appInit.refreshDrape).toHaveBeenCalledTimes(1);
    expect(appInit.refreshDrape).toHaveBeenCalledWith(preview);
  });

  it('still refreshes stamp masks (the pre-existing unconditional call) — now reading the FRESHLY loaded content, since open() ran first', async () => {
    window.svgEditor = mockEditor();
    await applySnapshot({ P: {} }, null, { source: 'load' });
    expect(updateStampMasks).toHaveBeenCalledTimes(1);
  });

  it('does nothing to the editor when window.svgEditor does not exist yet (defensive, matches every other window.svgEditor guard in this file)', async () => {
    window.svgEditor = null;
    await expect(applySnapshot({ P: {} }, null, { source: 'load' })).resolves.toBeUndefined();
    // No editor to call .open() on -- nothing to assert on a null editor,
    // this just proves the call doesn't throw.
  });
});

describe("applySnapshot — T45: source:'undo' leaves the live editor's document untouched (SE4c's own pre-existing contract)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('never calls editor.open()', async () => {
    const editor = mockEditor();
    window.svgEditor = editor;

    await applySnapshot({ P: {} }, null, { source: 'undo' });

    expect(editor.open).not.toHaveBeenCalled();
  });

  it('never refreshes the drape (the drawing did not change, so its derived texture does not need to)', async () => {
    window.svgEditor = mockEditor();
    await applySnapshot({ P: {} }, { marker: 'preview' }, { source: 'undo' });
    expect(appInit.refreshDrape).not.toHaveBeenCalled();
  });

  it('still refreshes stamp masks — unconditional for both sources, since tooling fields (restored separately, above) also bake into the mask', async () => {
    window.svgEditor = mockEditor();
    await applySnapshot({ P: {} }, null, { source: 'undo' });
    expect(updateStampMasks).toHaveBeenCalledTimes(1);
  });
});

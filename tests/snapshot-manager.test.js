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
  refreshAllStampMasks: vi.fn(async () => {}),
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
  announceBrickSettingsRestored: vi.fn(),
}));

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/layers.js', async (importOriginal) => ({
  ...(await importOriginal()),
  renderLayersPanel: vi.fn(),
}));

import { applySnapshot } from '../bspline-frame-builder/b-spline-gen/html/main/snapshot-manager.js';
import { renderLayersPanel } from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';
import { getFrameRecord, setFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import * as appInit from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';
import { updateStampMasks, refreshAllStampMasks } from '../bspline-frame-builder/b-spline-gen/html/main/stamp-mask-manager.js';
import { openRebuildHold, joinRebuildHold } from '../bspline-frame-builder/b-spline-gen/html/core/engine/scheduler.js';
import { currentLoadingStage, resetLoadingSignal } from '../bspline-frame-builder/b-spline-gen/html/core/loading-signal.js';

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
    // save audit #5: a load sets every key -- the saved project's size is what open() gets
    await applySnapshot({ P: { widthIn: 12, heightIn: 7 } }, null, { source: 'load' });

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

describe('applySnapshot — FB-APP S2 (F6): the frame record on project load', () => {
  beforeEach(() => { vi.clearAllMocks(); window.svgEditor = null; });

  it('an old project (saved before frames existed: no frame key) loads as NO frame', async () => {
    P.frame = { recordVersion: 1, templateId: 'template_1', params: {}, frameBottomZ: -1, appearance: '3D Ash - Unfinished' };
    await applySnapshot({ P: { widthIn: 7 } }, null, { source: 'load' });
    expect(P.frame).toBeNull();
  });

  it('a project with a frame restores it', async () => {
    P.frame = null;
    const frame = { recordVersion: 1, templateId: 'template_2', params: {}, frameBottomZ: -0.5, appearance: '3D Maple - Unfinished' };
    await applySnapshot({ P: { widthIn: 7, frame } }, null, { source: 'load' });
    expect(P.frame).toEqual(frame);
    // F12: the old (non-existent) wood name reads back as its real Fusion appearance
    const { getFrameRecord } = await import('../bspline-frame-builder/b-spline-gen/html/core/frame-record.js');
    expect(getFrameRecord().appearance).toBe('3D Maple - Painted');
  });
});

describe('applySnapshot -- save audit #1 / #5', () => {
  beforeEach(() => { vi.clearAllMocks(); window.svgEditor = mockEditor(); });

  it("a global undo never restores the drawing or the frame (they have their own undo)", async () => {
    P.editorSvg = '<svg>current drawing</svg>';
    P.frame = { id: 'current' };
    await applySnapshot({ P: { editorSvg: null, frame: null, widthIn: 20 } }, null, { source: 'undo' });
    expect(P.editorSvg).toBe('<svg>current drawing</svg>');
    expect(P.frame).toEqual({ id: 'current' });
    expect(P.widthIn).toBe(20);
  });

  it('a load of an older project (no editorSvg key) does not keep the current drawing', async () => {
    P.editorSvg = '<svg>current drawing</svg>';
    P.frame = { id: 'current' };
    await applySnapshot({ P: { widthIn: 10 } }, null, { source: 'load' });
    expect(P.editorSvg).toBe(null);
    expect(P.frame).toBe(null);
  });
});

describe('audit v2 N2: a load or a global undo announces that P.brickSettings was replaced', () => {
  beforeEach(() => { vi.clearAllMocks(); window.svgEditor = mockEditor(); });
  it.each([['load'], ['undo']])("source '%s' -> announceBrickSettingsRestored, once, after the new settings are in P", async (source) => {
    let seen = null;
    appInit.announceBrickSettingsRestored.mockImplementation(() => { seen = P.brickSettings; });
    const brickSettings = { ...P.brickSettings, setId: 3, pattern: 'herringbone' };
    await applySnapshot({ P: { brickSettings } }, null, { source });
    expect(appInit.announceBrickSettingsRestored).toHaveBeenCalledTimes(1);
    expect(seen).toBe(brickSettings); // the panel re-syncs from the RESTORED object, not the one before
  });
});

describe('F35 item 41: a restore (load or global undo) is a declared loading stage, painted before it runs', () => {
  it("'restore' shows first; the restore work starts only after the paint; it leaves when done", async () => {
    const root = document.createElement('div');
    root.innerHTML = '<div id="loading-stage" hidden><span class="loading-stage-text"></span></div>';
    document.body.appendChild(root);
    resetLoadingSignal();
    vi.clearAllMocks();
    const p = applySnapshot({ P: {} }, null, { source: 'undo' });
    expect(currentLoadingStage()).toEqual({ id: 'restore', text: 'Refreshing - restoring the board', surface: 'card' });
    expect(appInit.runMigrations).not.toHaveBeenCalled(); // not yet: the stage gets its paint first
    await p;
    expect(appInit.runMigrations).toHaveBeenCalled();
    resetLoadingSignal();
    root.remove();
  });
});

// item 69 (seat E, measured live: after Undo of a layer's carve toggle the row button kept its toggled look; Delete frame
// could not be undone from the sidebar)
describe("applySnapshot (undo): item 69 -- the layer rows follow the restored tooling; a step's own frame comes back", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('restores the layer tooling, redraws the layer rows and re-saves the roster', async () => {
    const layer = { id: '2', name: 'Wall', carve: false, visible: true };
    const editor = { ...mockEditor(), _layers: [layer], _notifyChange: vi.fn() };
    window.svgEditor = editor;
    await applySnapshot({ P: {}, layerTooling: [{ id: '2', carve: true, visible: true }] }, null, { source: 'undo' });
    expect(layer.carve).toBe(true);
    expect(renderLayersPanel).toHaveBeenCalledWith(editor);
    expect(editor._notifyChange).toHaveBeenCalledWith('tooling');
  });

  it("restores the frame the undone step declared, and only then", async () => {
    window.svgEditor = null;
    setFrameRecord({ templateId: null, params: {} });
    await applySnapshot({ P: {} }, null, { source: 'undo' });
    expect(getFrameRecord().templateId).toBeNull(); // no declared transition: the frame is left alone
    await applySnapshot({ P: {} }, null, { source: 'undo', restore: { frame: { templateId: 'template_1', params: {} } } });
    expect(getFrameRecord().templateId).toBe('template_1');
  });

  // item 71: a sidebar board change's own drawing comes back into P and the live editor
  it('restores the drawing the undone step declared: P.editorSvg and the live editor (open)', async () => {
    const editor = { ...mockEditor(), _layers: [] };
    window.svgEditor = editor;
    P.editorSvg = '<svg>after</svg>';
    await applySnapshot({ P: {} }, null, { source: 'undo', restore: { editorSvg: '<svg>before</svg>' } });
    expect(P.editorSvg).toBe('<svg>before</svg>');
    expect(editor.open).toHaveBeenCalledWith('<svg>before</svg>', P.widthIn, P.heightIn);
    await applySnapshot({ P: {} }, null, { source: 'undo' });
    expect(editor.open).toHaveBeenCalledTimes(1); // no declared drawing: the drawing is left alone
  });
});

// 2026-10-10: an undo of the board SIZE holds the 3D (main/app-init.js STOCK_CHANGE_DEFERS): its mask pass waits for
// the hold's one pass on the final editor (MEASURED, phone rig: a size undo ran 2 mask passes, now 1, the same 3D)
describe('applySnapshot: an undo inside a board-size hold defers its masks to the hold', () => {
  beforeEach(() => { vi.clearAllMocks(); window.svgEditor = null; });
  it('a hold declaring stamp-masks: no mask pass now; the hold runs ONE at its release', async () => {
    openRebuildHold(['editor-resync'], { defers: ['stamp-masks'] });
    const close = joinRebuildHold('editor-resync');
    await applySnapshot({ P: {} }, null, { source: 'undo' });
    expect(updateStampMasks).not.toHaveBeenCalled();
    expect(refreshAllStampMasks).not.toHaveBeenCalled();
    close();
    await new Promise((r) => setTimeout(r, 0));
    expect(refreshAllStampMasks).toHaveBeenCalledTimes(1);
  });
  it('no hold: the masks run now, as before', async () => {
    await applySnapshot({ P: {} }, null, { source: 'undo' });
    expect(updateStampMasks).toHaveBeenCalledTimes(1);
  });
});

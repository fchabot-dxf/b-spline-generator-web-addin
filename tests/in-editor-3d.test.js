/**
 * core/in-editor-3d.js (2026-10-08): F35 item 18 (4)'s "no 3D while editing" for the changes that do not come
 * through the editor's own onChange -- one declared table (photo, relief, frame). MEASURED with the editor open
 * (phone width, 4x CPU): every Frame-tab write re-applied the hidden 3D frame (226 - 357 ms); a relief-height slider
 * step ran a full rebuild (~1 s). The 2D cut profile and board outline stay live; the 3D waits for the session's end,
 * which the session fingerprint must therefore see (the relief height included).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

const sched = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/engine.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, scheduleRebuild: () => { sched.calls++; } };
});
// applyParam's other rebuild path (a grid change, or a mask param): re-mask + rebuild
vi.mock('../bspline-frame-builder/b-spline-gen/html/main/stamp-mask-manager.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, refreshAllStampMasks: async () => { sched.calls++; } };
});

import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { IN_EDITOR_3D, inEditor3dAction } from '../bspline-frame-builder/b-spline-gen/html/core/in-editor-3d.js';
import { applyParam } from '../bspline-frame-builder/b-spline-gen/html/main/param-manager.js';
import { syncFramePanel } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';
import { AppState } from '../bspline-frame-builder/b-spline-gen/html/main/app-state.js';
import { SvgEditorSnapshot, editorSessionFingerprint } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';
import { setViewMode } from '../bspline-frame-builder/b-spline-gen/html/main/view-mode-toggle.js';

let modal;
beforeEach(() => {
  document.body.innerHTML = '<div id="svgEditorModal" style="display:none"></div><button id="editorApply"></button>';
  modal = document.getElementById('svgEditorModal');
  sched.calls = 0;
});
afterEach(() => { document.body.innerHTML = ''; });

describe('IN_EDITOR_3D: one row per kind of change, the editor open vs closed', () => {
  it('declared: photo / relief -> the backdrop in the editor, the rebuild when closed; frame -> its 2D profile vs + the 3D', () => {
    expect(IN_EDITOR_3D).toEqual({
      photo: { inEditor: 'backdrop', closed: 'rebuild' },
      relief: { inEditor: 'backdrop', closed: 'rebuild' },
      frame: { inEditor: 'profile', closed: 'refresh3D' },
    });
    modal.style.display = 'flex';
    expect(['photo', 'relief', 'frame'].map(inEditor3dAction)).toEqual(['backdrop', 'backdrop', 'profile']);
    modal.style.display = 'none';
    expect(['photo', 'relief', 'frame'].map(inEditor3dAction)).toEqual(['rebuild', 'rebuild', 'refresh3D']);
  });
});

describe('the Frame tab: its record writes reach the 3D frame only with the editor closed', () => {
  it('syncFramePanel: editor open -> no 3D frame refresh; closed -> one', () => {
    const prev = AppState.preview;
    AppState.preview = { refreshFrame: vi.fn() };
    try {
      modal.style.display = 'flex';
      syncFramePanel();
      expect(AppState.preview.refreshFrame).not.toHaveBeenCalled();
      modal.style.display = 'none';
      syncFramePanel();
      expect(AppState.preview.refreshFrame).toHaveBeenCalledTimes(1);
    } finally { AppState.preview = prev; }
  });
});

describe('the Photo relief height: written without a rebuild in the editor', () => {
  it('applyParam(key, value, { rebuild: false }) writes the param and starts no rebuild; the default still does', () => {
    const was = P.carveZ;
    try {
      applyParam('carveZ', 0.2, { rebuild: false });
      expect(P.carveZ).toBe(0.2);
      expect(sched.calls).toBe(0);
      applyParam('carveZ', 0.15);
      expect(sched.calls).toBe(1);
    } finally { P.carveZ = was; }
  });
  it("photo-panel's relief slider reads the table: in the editor no rebuild + the backdrop; else applyParam as before", () => {
    const src = readFileSync('bspline-frame-builder/b-spline-gen/html/main/photo-panel.js', 'utf8');
    const at = src.indexOf('function setReliefHeight(v) {');
    const body = src.slice(at, src.indexOf('\n}', at));
    expect(body).toMatch(/inEditor3dAction\('relief'\) === 'backdrop'/);
    expect(body).toMatch(/applyParam\('carveZ', clampReliefIn\(v\), \{ rebuild: false \}\);\s*refreshEditorTopView\(\);/);
    expect(body).toMatch(/else applyParam\('carveZ', clampReliefIn\(v\)\);/);
  });
  it('a relief-only editor session is a change: [3D] takes the Apply way (the rebuild), not the plain close', () => {
    const was = P.carveZ;
    let applied = 0;
    document.getElementById('editorApply').addEventListener('click', () => { applied++; });
    try {
      modal.style.display = 'flex'; // the editor is open
      SvgEditorSnapshot.fingerprint = editorSessionFingerprint(); // as the session opened
      P.carveZ = (P.carveZ ?? 0.125) + 0.05; // only the relief height moves (its slider builds no 3D in the editor)
      expect(setViewMode('3d')).toBe('apply');
      expect(applied).toBe(1);
    } finally { P.carveZ = was; SvgEditorSnapshot.fingerprint = null; }
  });
});

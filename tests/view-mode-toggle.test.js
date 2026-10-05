/**
 * F35 item 25 (Fred: "in the viewport have a 2D 3D toggle that enters and exits editor mode"): the [2D | 3D] pill
 * (main/view-mode-toggle.js). 2D opens the editor on the last-used tab; 3D leaves it the Apply way, or just closes
 * when nothing changed since it opened.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const app = vi.hoisted(() => ({ fingerprint: 'A', now: 'A', closed: 0 }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/main/app-init.js', () => ({
  SvgEditorSnapshot: { get fingerprint() { return app.fingerprint; } },
  editorSessionFingerprint: () => app.now,
  closeEditorUnchanged: () => { app.closed++; },
}));
vi.mock('../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js', () => ({ openEditorOn: vi.fn() }));

import { VIEW_MODES, VIEW_TOGGLE_HOSTS, setViewMode, currentViewMode, initViewModeToggle } from '../bspline-frame-builder/b-spline-gen/html/main/view-mode-toggle.js';
import { openEditorOn } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';

let root, applied;
const openEditor = (open) => { document.getElementById('svgEditorModal').style.display = open ? 'flex' : 'none'; };
beforeEach(() => {
  root = document.createElement('div');
  root.innerHTML = '<div id="previewArea"></div><div id="svgEditorModal" style="display:none"><div id="editorCanvasContainer"></div></div><button id="editorApply"></button>';
  document.body.appendChild(root);
  applied = 0;
  document.getElementById('editorApply').addEventListener('click', () => { applied++; });
  app.fingerprint = 'A'; app.now = 'A'; app.closed = 0;
  openEditorOn.mockClear();
  window.svgEditor = {};
});
afterEach(() => { root.remove(); window.svgEditor = null; });

describe('the [2D | 3D] pill', () => {
  it('declared: two modes; one pill per host, each showing its own place as the active mode', () => {
    expect(VIEW_MODES.map((m) => m.id)).toEqual(['2d', '3d']);
    expect(VIEW_TOGGLE_HOSTS).toEqual([{ host: 'previewArea', mode: '3d' }, { host: 'editorCanvasContainer', mode: '2d' }]);
    initViewModeToggle();
    expect(document.getElementById('viewMode_3d').getAttribute('aria-pressed')).toBe('true'); // the viewport's
    expect(document.getElementById('viewMode_2d_editor').getAttribute('aria-pressed')).toBe('true'); // the editor's
    initViewModeToggle(); // idempotent
    expect(document.querySelectorAll('.view-mode-toggle')).toHaveLength(2);
  });

  it('2D opens the editor on the LAST-USED tab (the editor tab last switched to)', () => {
    initViewModeToggle();
    document.dispatchEvent(new CustomEvent('editorTabChanged', { detail: { tab: 'brick' } }));
    expect(setViewMode('2d')).toBe('open');
    expect(openEditorOn).toHaveBeenCalledWith('brick');
  });

  it('3D with nothing changed since the editor opened: just closes (no Apply rebuild)', () => {
    openEditor(true);
    expect(currentViewMode()).toBe('2d');
    expect(setViewMode('3d')).toBe('close');
    expect(app.closed).toBe(1);
    expect(applied).toBe(0);
  });

  it('3D after a change: the real Apply button (the Apply way, its toast and loading)', () => {
    openEditor(true);
    app.now = 'B';
    expect(setViewMode('3d')).toBe('apply');
    expect(applied).toBe(1);
    expect(app.closed).toBe(0);
  });

  it('3D while a text edit is still open counts as changed (its text is not in the drawing yet)', () => {
    openEditor(true);
    window.svgEditor = { _editingTextEl: {} };
    expect(setViewMode('3d')).toBe('apply');
  });

  it('the mode you are already in does nothing; the pill buttons drive it', () => {
    expect(setViewMode('3d')).toBe('none');
    initViewModeToggle();
    document.getElementById('viewMode_2d').click();
    expect(openEditorOn).toHaveBeenCalledTimes(1);
  });
});

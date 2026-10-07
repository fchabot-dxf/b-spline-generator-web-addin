/**
 * 2026-10-07 (seat A, measured headless): at phone width the sidebar's board size stays reachable WHILE the editor is
 * open, and the editor used to keep the old board (app-init _resyncEditorToStock returned while #svgEditorModal was
 * open): the outline, the grid, the SVG download's size (672 x 864 on a 9 x 12 board), the Shape Lattice's extent and
 * the bricks' board all stayed 7 x 9. Now an OPEN editor follows IN PLACE (setModelMetrics -- no reload, so undo and
 * selection stay), a closed one reloads as before; then the frame profile, one commit and 'editorBoardResized' (the
 * Brick re-lay follows that: brick-element-laid-key-panel.test.js).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS });
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, drawFrameProfile: vi.fn() };
});

import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import '../bspline-frame-builder/b-spline-gen/html/main/app-init.js'; // installs the stockSizeChanged handler
import { drawFrameProfile } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';

// the real editor's surface this path touches (VectorEditor: _draw, _mW/_mH, setModelMetrics, open, _notifyChange)
function editor(w = 7, h = 9) {
  const ed = { _mW: w, _mH: h, _undoStack: ['before'], calls: [], _view: { zoom: 1, cx: w / 2, cy: h / 2 } }; // a fitted view
  ed._draw = { viewbox: vi.fn(() => ed.calls.push('viewbox')) };
  // the real setModelMetrics fits on the OLD frame region (the profile is redrawn after it): modelled as a stale fit
  ed.setModelMetrics = vi.fn((nw, nh) => { ed._mW = nw; ed._mH = nh; ed._view = { zoom: 1.4, cx: 3.5, cy: 4.5 }; ed.calls.push('metrics'); });
  ed.fitView = vi.fn(() => { ed._view = { zoom: 1, cx: ed._mW / 2, cy: ed._mH / 2 }; ed.calls.push('fit'); });
  ed.open = vi.fn((svg, nw, nh) => { ed._mW = nw; ed._mH = nh; ed._undoStack = []; ed.calls.push('open'); });
  ed._notifyChange = vi.fn((kind) => ed.calls.push(`notify:${kind}`));
  return ed;
}
let saved;
beforeEach(() => {
  saved = { w: P.widthIn, h: P.heightIn, svg: P.editorSvg };
  document.body.innerHTML = '<div id="svgEditorModal" style="display:none"></div>';
  vi.useFakeTimers();
});
afterEach(() => {
  P.widthIn = saved.w; P.heightIn = saved.h; P.editorSvg = saved.svg;
  window.svgEditor = null;
  vi.useRealTimers();
  vi.clearAllMocks();
});

function boardChange(w, h) {
  P.widthIn = w; P.heightIn = h;
  document.dispatchEvent(new CustomEvent('stockSizeChanged'));
  vi.advanceTimersByTime(400);
}

describe('the editor follows a board change', () => {
  it('OPEN editor (phone): follows in place -- the new board, no reload (undo kept), the frame profile, one commit', () => {
    const ed = window.svgEditor = editor();
    document.getElementById('svgEditorModal').style.display = 'flex';
    const resized = [];
    document.addEventListener('editorBoardResized', (e) => resized.push(e.detail), { once: true });
    boardChange(9, 12);
    expect(ed.setModelMetrics).toHaveBeenCalledWith(9, 12);
    expect(ed.open).not.toHaveBeenCalled();
    expect(ed._undoStack).toEqual(['before']);
    expect([ed._mW, ed._mH]).toEqual([9, 12]);
    expect(drawFrameProfile).toHaveBeenCalledWith(ed);
    // the whole new board in view, fitted AFTER the frame profile is redrawn (the stale fit is replaced)
    expect(ed.calls).toEqual(['metrics', 'fit', 'notify:commit']);
    expect(drawFrameProfile.mock.invocationCallOrder[0]).toBeLessThan(ed.fitView.mock.invocationCallOrder[0]);
    expect(ed._view).toEqual({ zoom: 1, cx: 4.5, cy: 6 });
    expect(resized).toEqual([{ w: 9, h: 12, editorOpen: true }]);
  });

  it('OPEN editor the user had zoomed / panned: their view stays (not refitted)', () => {
    const ed = window.svgEditor = editor();
    ed._view = { zoom: 2.5, cx: 2, cy: 3 };
    document.getElementById('svgEditorModal').style.display = 'flex';
    boardChange(9, 12);
    expect(ed.fitView).not.toHaveBeenCalled();
    expect(ed._view).toEqual({ zoom: 2.5, cx: 2, cy: 3 });
    expect(ed._draw.viewbox).toHaveBeenCalled(); // re-applied on the new board
  });

  it('closed editor: reloads at the new board as before, then the same follow-ups', () => {
    const ed = window.svgEditor = editor();
    P.editorSvg = '<svg/>';
    const resized = [];
    document.addEventListener('editorBoardResized', (e) => resized.push(e.detail), { once: true });
    boardChange(9, 12);
    expect(ed.open).toHaveBeenCalledWith(expect.any(String), 9, 12);
    expect(ed.setModelMetrics).not.toHaveBeenCalled();
    expect(resized).toEqual([{ w: 9, h: 12, editorOpen: false }]);
  });

  it('nothing to do when the editor already has the board; a closed editor with no drawing stays as it is', () => {
    const ed = window.svgEditor = editor(9, 12);
    boardChange(9, 12);
    expect(ed.calls).toEqual([]);
    const ed2 = window.svgEditor = editor();
    P.editorSvg = '';
    boardChange(9, 12);
    expect(ed2.calls).toEqual([]);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  globalHistoryLog,
  globalRedoLog,
  takeSnapshot,
  unifiedUndo,
  unifiedRedo,
  scheduleUndoSnapshot,
} from '../bspline-frame-builder/b-spline-gen/html/core/history.js';
import { SvgEditorSnapshot } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';

describe('2D <-> 3D Undo / Redo synchronization', () => {
  beforeEach(() => {
    globalHistoryLog.length = 0;
    globalRedoLog.length = 0;
    takeSnapshot('Initial');
    P.editorSvg = '<svg id="initial"/>';
    SvgEditorSnapshot.editorSvg = '<svg id="initial"/>';
    SvgEditorSnapshot.active = true;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('unifiedUndo and unifiedRedo clear pending debounced undo snapshots', () => {
    vi.useFakeTimers();
    scheduleUndoSnapshot('testSlider', 'Slider change');
    const seen = [];
    unifiedUndo((snap, restore) => seen.push(['undo', snap.label, restore]));
    // Fast forward past coalesce debounce window (400ms)
    vi.advanceTimersByTime(500);
    // The pending snapshot should NOT have fired
    expect(globalHistoryLog.map((s) => s.label)).toEqual(['Initial']);
  });

  it('Apply records 2D Edits with restore.editorSvg when drawing changes', () => {
    const beforeSvg = '<svg id="initial"/>';
    const afterSvg = '<svg id="drawing_added"/>';
    P.editorSvg = afterSvg;
    takeSnapshot('2D Edits', { restore: { editorSvg: { before: beforeSvg, after: afterSvg } } });

    expect(globalHistoryLog.length).toBe(2);
    const last = globalHistoryLog[globalHistoryLog.length - 1];
    expect(last.label).toBe('2D Edits');
    expect(last.restore).toEqual({
      editorSvg: { before: beforeSvg, after: afterSvg },
    });

    const seen = [];
    unifiedUndo((snap, restore) => seen.push(['undo', snap.label, restore]));
    expect(seen).toEqual([['undo', 'Initial', { editorSvg: beforeSvg }]]);

    unifiedRedo((snap, restore) => seen.push(['redo', snap.label, restore]));
    expect(seen).toEqual([
      ['undo', 'Initial', { editorSvg: beforeSvg }],
      ['redo', '2D Edits', { editorSvg: afterSvg }],
    ]);
  });
});

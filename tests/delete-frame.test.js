/**
 * F26 item 2 (b), Fred ("add a delete frame button"): [Delete frame] in the sidebar's Frame section sets the frame
 * back to none (template None, the artwork untouched) as ONE Frame undo step; inside Fusion it also asks the add-in
 * to delete the frame Send built ('delete_frame'), whose reply goes on the status line. No confirm dialog.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { P, setIsFusionMode } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { getFrameRecord, setFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { deleteFrame, onDeleteFrameResult, undoFrame, frameHistoryDepth } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';
import { globalHistoryLog, globalRedoLog, unifiedUndo, unifiedRedo, ensureUndoBaseline, takeSnapshot } from '../bspline-frame-builder/b-spline-gen/html/core/history.js';

const sent = [];
beforeEach(() => {
  sent.length = 0;
  vi.stubGlobal('adsk', { fusionSendData: (a, d) => { if (a !== 'log') sent.push([a, d]); } }); // (session saves log through it)
  document.body.innerHTML = '<div id="fusion-status" hidden></div>';
  setFrameRecord({ templateId: 'template_1', params: {} });
  P.editorSvg = '<svg><rect data-layer="1"/></svg>';
});
afterEach(() => { setIsFusionMode(false); vi.unstubAllGlobals(); });

describe('F26 item 2 (b): Delete frame', () => {
  it('the button sits in the sidebar Frame section, secondary style', () => {
    const html = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf-8');
    const at = html.indexOf('id="btnDeleteFrame"');
    expect(at).toBeGreaterThan(html.indexOf('id="frameTemplate"'));
    expect(at).toBeLessThan(html.indexOf('panel-skeleton'));
    expect(html.slice(html.lastIndexOf('<button', at), at + 120)).toMatch(/cad-btn-secondary[\s\S]*>Delete frame</);
  });

  it('the frame goes back to none as ONE undo step; the artwork is untouched; Undo brings it back', () => {
    const depth = frameHistoryDepth();
    deleteFrame();
    expect(getFrameRecord().templateId).toBeNull();
    expect(frameHistoryDepth()).toBe(depth + 1);
    expect(P.editorSvg).toBe('<svg><rect data-layer="1"/></svg>');
    expect(sent).toEqual([]); // not in Fusion: nothing sent
    undoFrame();
    expect(getFrameRecord().templateId).toBe('template_1');
  });

  it('in Fusion: also asks the add-in to delete the frame it built; the reply goes on the status line', () => {
    setIsFusionMode(true);
    deleteFrame();
    expect(sent.map((s) => s[0])).toEqual(['delete_frame']);
    expect(document.getElementById('fusion-status').textContent).toMatch(/Deleting the frame/);
    onDeleteFrameResult(JSON.stringify({ ok: true, frames: ['Frame_1'], error: null }));
    expect(document.getElementById('fusion-status').textContent).toBe('Frame deleted in Fusion: Frame_1');
    onDeleteFrameResult({ ok: true, frames: [] });
    expect(document.getElementById('fusion-status').textContent).toBe('No frame to delete in Fusion');
    onDeleteFrameResult({ ok: false, error: 'Delete frame failed: x' });
    expect(document.getElementById('fusion-status').dataset.kind).toBe('warn');
  });

  // item 69 (seat E, measured live: the SIDEBAR Undo left the frame deleted -- the global undo never restores a frame,
  // and its newest snapshot predated the brick lay, so it also reverted brickSettings)
  it('the sidebar (global) Undo restores the frame from the declared transition; Redo deletes it again', () => {
    globalHistoryLog.length = 0; globalRedoLog.length = 0;
    takeSnapshot('Initial');
    P.brickSettings = { ...(P.brickSettings || {}), seed: 777 }; // a change that took no snapshot (a brick lay)
    deleteFrame();
    const labels = globalHistoryLog.map((x) => x.label);
    expect(labels).toEqual(['Initial', 'Before delete frame', 'Delete frame']);
    const step = globalHistoryLog[globalHistoryLog.length - 1];
    expect(step.restore.frame.before.templateId).toBe('template_1');
    expect(step.restore.frame.after.templateId).toBeNull();
    const applied = [];
    unifiedUndo((snap, restore) => applied.push(['undo', snap.label, restore && restore.frame.templateId]));
    unifiedRedo((snap, restore) => applied.push(['redo', snap.label, restore && restore.frame.templateId]));
    expect(applied).toEqual([['undo', 'Before delete frame', 'template_1'], ['redo', 'Delete frame', null]]);
  });

  it('ensureUndoBaseline records the board only when the newest snapshot no longer matches it', () => {
    globalHistoryLog.length = 0;
    takeSnapshot('Initial');
    expect(ensureUndoBaseline()).toBe(false);
    P.seed = (P.seed || 0) + 1;
    expect(ensureUndoBaseline()).toBe(true);
    expect(globalHistoryLog.length).toBe(2);
  });
});

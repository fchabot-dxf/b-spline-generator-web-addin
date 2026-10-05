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
});

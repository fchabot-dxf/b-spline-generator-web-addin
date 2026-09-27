/**
 * FB-APP S5 (F10) item 1: the sidebar FRAME section's [Send frame] button.
 * Disabled with a hint when no frame is chosen or outside Fusion; the press
 * sends the frame record (template, params incl. boundingboxoffset, frame
 * bottom, wood, seeds) as the 'send_frame' action; the add-in's 'frame_result'
 * reply (incl. "no B-spline body") lands in the one Fusion status line.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { P, setIsFusionMode } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { normalizeFrameRecord, setFrameRecord, framePayload, getFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import {
  frameSendState, sendFrame, onFrameResult, initFramePanel, syncFramePanel,
} from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';

let root;
beforeEach(() => {
  root = document.createElement('div');
  root.innerHTML = `<input id="widthIn" value="7"><input id="heightIn" value="9">
    <select id="frameTemplate"></select><div id="frameSettings"><select id="frameAppearance"></select></div>
    <button id="btnSendFrame" disabled></button><div id="frameSendHint"></div><div id="fusion-status" hidden></div>`;
  document.body.appendChild(root);
  P.frame = null;
  window.adsk = { fusionSendData: vi.fn() };
  initFramePanel();
});
afterEach(() => { root.remove(); delete window.adsk; setIsFusionMode(false); P.frame = null; });
const $ = (id) => document.getElementById(id);

describe('[Send frame] state', () => {
  it('disabled with a hint when no frame is chosen, or outside Fusion; enabled in Fusion with a frame', () => {
    expect(frameSendState(FRAME_DEFS, normalizeFrameRecord({}), true)).toMatchObject({ enabled: false, hint: expect.stringContaining('Pick a frame') });
    const rec = normalizeFrameRecord({ templateId: 'template_1' });
    expect(frameSendState(FRAME_DEFS, rec, false)).toMatchObject({ enabled: false, hint: expect.stringContaining('Fusion add-in') });
    // F26 item 2 (Fred: "remove these labels"): enabled = no standing caption any more -- only the two
    // DISABLED cases above (an actual reason it can't be pressed) still carry a hint.
    expect(frameSendState(FRAME_DEFS, rec, true)).toEqual({ enabled: true, hint: '' });
  });

  it('the sidebar button follows the record and the Fusion mode; no standing hint once it is enabled', () => {
    setIsFusionMode(true);
    syncFramePanel();
    expect($('btnSendFrame').disabled).toBe(true); // no frame
    setFrameRecord({ templateId: 'template_2' });
    syncFramePanel();
    expect($('btnSendFrame').disabled).toBe(false);
    expect($('frameSendHint').textContent).toBe('');
  });
});

describe('the press and the reply', () => {
  it('sends the frame record as the send_frame payload', () => {
    setIsFusionMode(true);
    setFrameRecord({ templateId: 'template_1', params: { boundingboxoffset: 0.5 }, frameBottomZ: -1.5, appearance: '3D Oak - Painted', seeds: { waistReach: 0.4 } });
    syncFramePanel();
    $('btnSendFrame').click();
    // (in Fusion mode the app also sends its own 'log' action; only the send counts)
    const sends = window.adsk.fusionSendData.mock.calls.filter(([action]) => action === 'send_frame');
    expect(sends).toHaveLength(1);
    const sent = JSON.parse(sends[0][1]);
    const { seedGeometry, ...rest } = sent;
    expect(rest).toEqual(framePayload(FRAME_DEFS, getFrameRecord()));
    // F11: seeded handles travel as the template's own seed geometry
    expect(Object.keys(seedGeometry).sort()).toEqual(FRAME_DEFS.templates[0].seedMap.map((e) => e.id).sort());
    expect(sent).toMatchObject({ templateId: 'template_1', frameBottomZ: -1.5, appearance: '3D Oak - Painted', seeds: { waistReach: 0.4 } });
    expect(sent.params.boundingboxoffset).toBe(0.5);
    expect($('fusion-status').textContent).toContain('Sending the frame');
  });

  it('no frame chosen: nothing is sent', () => {
    expect(sendFrame()).toBe(false);
    expect(window.adsk.fusionSendData.mock.calls.filter(([a]) => a === 'send_frame')).toEqual([]);
  });

  it('the reply lands in the status line: built, refused (no body), and seeds not applied', () => {
    onFrameResult(JSON.stringify({ ok: true, frame: 'Frame_1', seeds: { count: 0, applied: false } }));
    expect([$('fusion-status').textContent, $('fusion-status').dataset.kind]).toEqual(['Frame built in Fusion: Frame_1', 'ok']);
    onFrameResult(JSON.stringify({ ok: false, error: 'No B-spline body in this document: press Send B-spline first' }));
    expect([$('fusion-status').textContent, $('fusion-status').dataset.kind]).toEqual(['No B-spline body in this document: press Send B-spline first', 'warn']);
    onFrameResult(JSON.stringify({ ok: true, frame: 'Frame_1', seeds: { count: 2, applied: false } }));
    expect($('fusion-status').dataset.kind).toBe('warn');
    expect($('fusion-status').textContent).toContain('2 handle change(s) not applied');
  });
});

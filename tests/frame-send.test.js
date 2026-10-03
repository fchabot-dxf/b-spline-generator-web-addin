/**
 * FB-APP S5 (F10) item 1, then Fred ("no send frame"): the frame rides in the one Send (frameSendPayload); the
 * frame-alone send (no button any more) sends the frame record (template, params incl. boundingboxoffset, frame
 * bottom, wood, seeds) as the 'send_frame' action; the add-in's 'frame_result'
 * reply (incl. "no B-spline body") lands in the one Fusion status line.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { P, setIsFusionMode } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { normalizeFrameRecord, setFrameRecord, framePayload, getFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import {
  sendFrame, frameSendPayload, onFrameResult, initFramePanel, syncFramePanel,
} from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';

let root;
beforeEach(() => {
  root = document.createElement('div');
  root.innerHTML = `<input id="widthIn" value="7"><input id="heightIn" value="9">
    <select id="frameTemplate"></select><div id="frameSettings"><select id="frameAppearance"></select></div>
    <div id="fusion-status" hidden></div>`;
  document.body.appendChild(root);
  P.frame = null;
  window.adsk = { fusionSendData: vi.fn() };
  initFramePanel();
});
afterEach(() => { root.remove(); delete window.adsk; setIsFusionMode(false); P.frame = null; });
const $ = (id) => document.getElementById(id);

describe('the press and the reply', () => {
  it('sends the frame record as the send_frame payload', () => {
    setIsFusionMode(true);
    setFrameRecord({ templateId: 'template_1', params: { boundingboxoffset: 0.5 }, frameBottomZ: -1.5, appearance: '3D Oak - Painted', seeds: { waistReach: 0.4 } });
    syncFramePanel();
    sendFrame();
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

  it('the one Send carries the same frame payload; none when no frame is chosen', () => {
    expect(frameSendPayload()).toBe(null);
    setFrameRecord({ templateId: 'template_1', params: { boundingboxoffset: 0.5 } });
    const { seedGeometry, ...rest } = frameSendPayload();
    expect(rest).toEqual(framePayload(FRAME_DEFS, getFrameRecord()));
  });

  // H23 item 42 (ONE build path, declared): a FRESH template pick resets seeds to {} (setFrameRecord's
  // own "a template change resets the seeds" rule) -- exactly what Fred hits picking a template then
  // Sending without ever touching Generate or a handle. MEASURED (H23 item 41): T7's and T10's own
  // LEGACY unseeded construction has its own pre-existing defects (a reflex arc; an unsplit miter),
  // neither reachable through the already-tested SEEDED path -- so every Send, seeded or not, must
  // carry seed geometry, not just a dragged/Generated one.
  it.each(['template_7', 'template_10'])('%s: a FRESH (unseeded) record’s Send payload still ' +
    'carries full seed geometry -- the legacy construction is never reached', (templateId) => {
    expect(getFrameRecord().seeds).toEqual({}); // nothing touched yet -- the exact state this item is about
    setFrameRecord({ templateId });
    expect(getFrameRecord().seeds).toEqual({}); // confirms the record THIS test sends really is unseeded
    const payload = frameSendPayload();
    const tpl = FRAME_DEFS.templates.find((t) => t.id === templateId);
    expect(Object.keys(payload.seedGeometry).sort()).toEqual(tpl.seedMap.map((e) => e.id).sort());
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

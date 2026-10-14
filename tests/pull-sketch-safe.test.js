/**
 * Pull from Fusion, made safe (seat A 2026-10-14; advisor, Fred: "fix now"): e6efb96 resized the user's board to 7 x 9
 * whenever the design had no widthIn parameter (the add-in's fallback, applied by the palette). Now: only a size the
 * DESIGN declares (sizeSource 'fusion') resizes; otherwise the board is kept, with a note when the sketch reaches past
 * it; the curve types the pull leaves out or fails to read are said; a loading card is up from the request to the reply;
 * the reply is a named handler (main/pull-sketch.js onSketchPulled, dispatched like frame_result).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/main/param-manager.js', async (orig) => ({ ...(await orig()), applyParam: vi.fn() }));

import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { showToast } from '../bspline-frame-builder/b-spline-gen/html/core/toast.js';
import { applyParam } from '../bspline-frame-builder/b-spline-gen/html/main/param-manager.js';
import { onSketchPulled, pulledSketchNotes, SKETCH_PULLED, PULL_SKETCH_STAGE } from '../bspline-frame-builder/b-spline-gen/html/main/pull-sketch.js';
import { pullSketchFromFusion } from '../bspline-frame-builder/b-spline-gen/html/core/fusion-bridge.js';
import { LOADING_STAGES, currentLoadingStage, setPaintScheduler, releaseHeldStage } from '../bspline-frame-builder/b-spline-gen/html/core/loading-signal.js';
import { readFileSync } from 'node:fs';

const editor = () => {
  const children = [];
  const node = (d) => { const n = { d, attrs: {}, attr(k, v) { if (v !== undefined) { n.attrs[k] = v; return n; } return n.attrs[k]; }, fill() { return n; }, stroke() { return n; }, remove() { children.splice(children.indexOf(n), 1); } }; children.push(n); return n; };
  return { children, ed: { _layers: [], _sketchLayer: { children: () => ({ toArray: () => [...children], forEach: (fn) => [...children].forEach(fn) }), path: node }, pushState: vi.fn(), _notifyChange: vi.fn() } };
};
const reply = (extra) => JSON.stringify({ ok: true, sketchName: 'S', curves: [{ type: 'line', d: 'M 1 1 L 2 2', isConstruction: false }], ...extra });

let saved;
beforeEach(() => { document.body.innerHTML = '<div id="loading-stage" hidden><span class="loading-stage-text"></span></div>'; saved = { w: P.widthIn, h: P.heightIn }; P.widthIn = 7; P.heightIn = 9; vi.clearAllMocks(); setPaintScheduler((cb) => cb()); });
afterEach(() => { P.widthIn = saved.w; P.heightIn = saved.h; delete globalThis.adsk; window.svgEditor = null; releaseHeldStage(); setPaintScheduler(null); });

describe('Pull from Fusion never resizes the board by a fallback', () => {
  it('no size in the design (sizeSource null): the board is kept, whatever sizes the reply carries', () => {
    window.svgEditor = editor().ed;
    onSketchPulled(reply({ widthIn: 7, heightIn: 9, sizeSource: null })); // the old fallback's numbers
    P.widthIn = 12; P.heightIn = 16; // a board that is not 7 x 9
    onSketchPulled(reply({ widthIn: 7, heightIn: 9, sizeSource: null }));
    expect(applyParam).not.toHaveBeenCalled();
  });
  it('the design declares its size (sizeSource fusion): the board follows it', () => {
    window.svgEditor = editor().ed;
    onSketchPulled(reply({ widthIn: 10, heightIn: 12, sizeSource: 'fusion' }));
    expect(applyParam.mock.calls).toEqual([['widthIn', 10], ['heightIn', 12]]);
  });
});

describe('what the pull leaves out is said', () => {
  it('skipped and failed curve types, and a sketch past the kept board, become notes', () => {
    const notes = pulledSketchNotes({ skipped: { sketchEllipses: 2, sketchControlPointSplines: 1 }, failed: { spline: 1 },
      bounds: { x0: -1, y0: 0, x1: 8, y1: 9 } }, { widthIn: 7, heightIn: 9 });
    expect(notes).toEqual([
      'Not imported (not supported yet): 2 ellipses, 1 control-point spline.',
      'Could not be read: 1 spline.',
      'The sketch spans 9.00 x 9.00 in, past the 7 x 9 in board -- the board size was kept (the design declares none).',
    ]);
    expect(pulledSketchNotes({ bounds: { x0: 0, y0: 0, x1: 7, y1: 9 } }, { widthIn: 7, heightIn: 9 })).toEqual([]);
    expect(pulledSketchNotes({ sizeSource: 'fusion', bounds: { x0: -1, y0: 0, x1: 8, y1: 9 } }, { widthIn: 7, heightIn: 9 })).toEqual([]);
  });
  it('the toast carries the notes as a warning', () => {
    window.svgEditor = editor().ed;
    onSketchPulled(reply({ sizeSource: null, skipped: { sketchEllipses: 1 } }));
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('1 ellipse'), 'warn');
  });
});

describe('a card from the request to the reply; a named handler', () => {
  // (a shown card stays up MIN_VISIBLE_MS + a grace after its release: the timers run past it before asking)
  it('the send holds the declared stage with the board size; the reply releases it', () => {
    vi.useFakeTimers();
    expect(LOADING_STAGES[PULL_SKETCH_STAGE]).toMatchObject({ group: 'waiting', surface: 'card' });
    const send = vi.fn();
    globalThis.adsk = { fusionSendData: send };
    pullSketchFromFusion();
    expect(send).toHaveBeenCalledWith('pull_sketch_from_fusion', JSON.stringify({ widthIn: 7, heightIn: 9 }));
    expect(currentLoadingStage()?.id).toBe(PULL_SKETCH_STAGE);
    window.svgEditor = editor().ed;
    onSketchPulled(reply({}));
    vi.advanceTimersByTime(2000);
    expect(currentLoadingStage()).toBeNull();
    vi.useRealTimers();
  });
  it('an error reply releases the card too', () => {
    vi.useFakeTimers();
    globalThis.adsk = { fusionSendData: vi.fn() };
    pullSketchFromFusion();
    expect(currentLoadingStage()?.id).toBe(PULL_SKETCH_STAGE);
    onSketchPulled(JSON.stringify({ ok: false, error: 'No sketch found' }));
    vi.advanceTimersByTime(2000);
    expect(currentLoadingStage()).toBeNull();
    vi.useRealTimers();
    expect(showToast).toHaveBeenCalledWith('No sketch found', 'warn');
  });
  it('main.js dispatches the declared message to the handler (as frame_result), no inline branch', () => {
    const src = readFileSync('bspline-frame-builder/b-spline-gen/html/main/main.js', 'utf8');
    expect(SKETCH_PULLED).toBe('sketch_pulled');
    expect(src).toMatch(/if \(action === SKETCH_PULLED\) \{ onSketchPulled\(ev\.detail\.data\); return; \}/);
    expect(src).not.toMatch(/action === 'sketch_pulled'/);
  });
});

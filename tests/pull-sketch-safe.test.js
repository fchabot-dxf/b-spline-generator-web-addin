/**
 * Pull from Fusion, made safe (seat A 2026-10-14, ported from the closed pull-fusion-safe branch; advisor, Fred:
 * "fix now"): e6efb96 resized the user's board to 7 x 9 whenever the design had no widthIn parameter (the add-in's
 * fallback, applied by the palette). Now: only a size THIS BOARD declares (sizeSource 'fusion') resizes; otherwise
 * the board is kept, with a note when the sketch reaches past it; the curve types the pull leaves out or fails to
 * read are said; a loading card is up from the request to the reply; the reply is a named handler
 * (main/pull-sketch.js onSketchPulled, dispatched like frame_result's -- main.js's own literal-string convention,
 * not a second one).
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
beforeEach(() => { document.body.innerHTML = '<div id="loading-stage" hidden><span class="loading-stage-text"></span></div>'; saved = { w: P.widthIn, h: P.heightIn, boardId: P.boardId }; P.widthIn = 7; P.heightIn = 9; vi.clearAllMocks(); setPaintScheduler((cb) => cb()); });
afterEach(() => { P.widthIn = saved.w; P.heightIn = saved.h; P.boardId = saved.boardId; delete globalThis.adsk; window.svgEditor = null; releaseHeldStage(); setPaintScheduler(null); });

describe('Pull from Fusion never resizes the board by a fallback', () => {
  it('no size on this board (sizeSource null): the board is kept, whatever sizes the reply carries', () => {
    window.svgEditor = editor().ed;
    onSketchPulled(reply({ widthIn: 7, heightIn: 9, sizeSource: null })); // the old fallback's numbers
    P.widthIn = 12; P.heightIn = 16; // a board that is not 7 x 9
    onSketchPulled(reply({ widthIn: 7, heightIn: 9, sizeSource: null }));
    expect(applyParam).not.toHaveBeenCalled();
  });
  it('this board declares its own size (sizeSource fusion): the change-list dialog offers it; nothing applies until Apply', () => {
    window.svgEditor = editor().ed;
    onSketchPulled(reply({ widthIn: 10, heightIn: 12, sizeSource: 'fusion' }));
    expect(applyParam).not.toHaveBeenCalled(); // Fred: "nothing changes until Apply"
    const overlay = document.getElementById('pullChangeListOverlay');
    expect(overlay).not.toBeNull();
    expect(overlay.textContent).toContain('Width');
    overlay.querySelector('.cad-btn-primary').click(); // Apply
    expect(applyParam.mock.calls).toEqual([['widthIn', 10], ['heightIn', 12]]);
  });

  it('no size on this board (sizeSource null): no dialog row offers to resize it either', () => {
    window.svgEditor = editor().ed;
    onSketchPulled(reply({ widthIn: 10, heightIn: 12, sizeSource: null }));
    const overlay = document.getElementById('pullChangeListOverlay');
    expect(overlay === null || !overlay.textContent.includes('Width')).toBe(true);
  });
});

describe('what the pull leaves out is said', () => {
  it('skipped and failed curve types, and a sketch past the kept board, become notes', () => {
    const notes = pulledSketchNotes({ skipped: { sketchEllipses: 2, sketchControlPointSplines: 1 }, failed: { spline: 1 },
      bounds: { x0: -1, y0: 0, x1: 8, y1: 9 } }, { widthIn: 7, heightIn: 9 });
    expect(notes).toEqual([
      'Not imported (not supported yet): 2 ellipses, 1 control-point spline.',
      'Could not be read: 1 spline.',
      'The sketch spans 9.00 x 9.00 in, past the 7 x 9 in board -- the board size was kept (this board declares none).',
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
  it('the send holds the declared stage with the board id + size; the reply releases it', () => {
    vi.useFakeTimers();
    expect(LOADING_STAGES[PULL_SKETCH_STAGE]).toMatchObject({ group: 'waiting', surface: 'card' });
    const send = vi.fn();
    globalThis.adsk = { fusionSendData: send };
    P.boardId = 'kx1y2z3a';
    pullSketchFromFusion();
    expect(send).toHaveBeenCalledWith('pull_sketch_from_fusion', JSON.stringify({ board: { id: 'kx1y2z3a' }, widthIn: 7, heightIn: 9, frameSeedIds: [] }));
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
    // main.js's own convention for these replies is a literal string (same as frame_result/delete_frame_result),
    // not an imported constant -- matching that, not inventing a second pattern for this one handler
    expect(src).toMatch(/if \(action === 'sketch_pulled'\) \{ onSketchPulled\(ev\.detail\.data\); return; \}/);
    expect(src).not.toMatch(/addLayer\(editor, \{ name: 'Fusion Sketch' \}\)/); // the inline branch is gone
  });
});

describe('the change list counts the rails, not the edge lines (live: 9 rails showed "18 rails moved")', () => {
  // 9 live rails drawn by Send at y 1..9 (a rail element = x1/y1/x2/y2 on its node, data-layer 1 whose pattern owns it)
  const rail = (id, y) => ({ node: { getAttribute: (k) => ({ 'data-rail-id': id, x1: '1', y1: String(y), x2: '7', y2: String(y), 'data-layer': '1' })[k] ?? null, hasAttribute: () => true }, attr: (k) => (k === 'data-layer' ? '1' : undefined), addClass() {}, removeClass() {}, hasClass: () => false });
  const RAIL_Y = { rail1: 1, rail2: 2, rail3: 2.8, rail4: 4, rail5: 5, rail6: 6.3, rail7: 7, rail8: 8, rail9: 9 }; // rail3 +0.2 / rail6 -0.3 in Fusion
  const curves = Object.entries(RAIL_Y).flatMap(([id, y]) => [
    { type: 'line', d: `M 1 ${y + 0.125} L 7 ${y + 0.125}`, x1: 1, y1: y + 0.125, x2: 7, y2: y + 0.125, isConstruction: false, railId: null },
    { type: 'line', d: `M 7 ${y - 0.125} L 1 ${y - 0.125}`, x1: 7, y1: y - 0.125, x2: 1, y2: y - 0.125, isConstruction: false, railId: null },
    { type: 'line', d: `M 1 ${y} L 7 ${y}`, x1: 1, y1: y, x2: 7, y2: y, isConstruction: true, railId: id },
  ]);
  it('2 rails moved, Apply locks all 9 -- and says so', () => {
    const { ed } = editor();
    ed._layers = [{ id: '1', pattern: { orientation: 'horizontal' } }];
    const live = Array.from({ length: 9 }, (_, i) => rail(`rail${i + 1}`, i + 1));
    const base = ed._sketchLayer.children;
    ed._sketchLayer.children = () => ({ toArray: () => [...base().toArray(), ...live], forEach: (fn) => [...base().toArray(), ...live].forEach(fn) });
    window.svgEditor = ed;
    onSketchPulled(reply({ curves }));
    const note = document.querySelector('#pullChangeListOverlay .pull-changelist-note');
    expect(note.textContent).toBe('2 rails moved in Fusion. Apply locks all 9 at their Fusion positions.');
  });
});

/**
 * Pull from Fusion NEVER adds layers (Fred 2026-10-14: "it only modifies the current project; params -> app settings via
 * the declared map; Send-tagged curves reshape their own elements; untagged = noted, not added"). Seat P 2026-10-22 found
 * the leftover: onSketchPulled drew every pulled curve onto a new carving 'Fusion Sketch' layer (and wrote the editor's
 * SVG) BEFORE the change-list dialog -- Cancel kept it, and it moved the terrain (headless real palette: the Clean STEP hash
 * changed on a dialog that was only opened). Real shapes: the real P, the real history log, the real Fusion reply shape.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/main/param-manager.js', async (orig) => ({ ...(await orig()), applyParam: vi.fn() }));

import { P, persistableP } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { showToast } from '../bspline-frame-builder/b-spline-gen/html/core/toast.js';
import { globalHistoryLog } from '../bspline-frame-builder/b-spline-gen/html/core/history.js';
import { getFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { applyParam } from '../bspline-frame-builder/b-spline-gen/html/main/param-manager.js';
import { onSketchPulled } from '../bspline-frame-builder/b-spline-gen/html/main/pull-sketch.js';
import { setPaintScheduler, releaseHeldStage } from '../bspline-frame-builder/b-spline-gen/html/core/loading-signal.js';

const fakeEditor = () => {
  const children = [];
  const node = (d) => { const n = { d, attrs: {}, attr(k, v) { if (v !== undefined) { n.attrs[k] = v; return n; } return n.attrs[k]; }, fill() { return n; }, stroke() { return n; }, remove() { children.splice(children.indexOf(n), 1); } }; children.push(n); return n; };
  return { children, ed: { _layers: [{ id: 'L1', name: 'Layer 1' }], _sketchLayer: { children: () => ({ toArray: () => [...children], forEach: (fn) => [...children].forEach(fn) }), path: node }, pushState: vi.fn(), _notifyChange: vi.fn() } };
};
// a Fusion pull reply in its real shape (b-spline-gen.py _handle_pull_sketch): the board's own size + params, curves with no Send tag
const reply = (boardParams = {}) => JSON.stringify({
  ok: true, sketchName: 'Carved', sizeSource: 'fusion', widthIn: P.widthIn, heightIn: P.heightIn, boardParams,
  curves: [{ type: 'line', d: 'M 1 2 L 3 4', isConstruction: false }, { type: 'circle', d: 'M 2 2 A 1 1 0 1 0 4 2 A 1 1 0 1 0 2 2 Z', isConstruction: false }],
});
const snapshot = (ed, children) => JSON.stringify({
  P: persistableP(), frame: getFrameRecord(), layers: ed._layers.map((l) => l.name), paths: children.map((c) => c.d),
  pushes: ed.pushState.mock.calls.length, commits: ed._notifyChange.mock.calls.length, history: globalHistoryLog.length,
});

let saved;
beforeEach(() => {
  document.body.innerHTML = '<div id="loading-stage" hidden><span class="loading-stage-text"></span></div>';
  saved = { w: P.widthIn, h: P.heightIn, seed: P.seed };
  P.widthIn = 7; P.heightIn = 9; P.seed = 42;
  vi.clearAllMocks(); setPaintScheduler((cb) => cb());
});
afterEach(() => {
  P.widthIn = saved.w; P.heightIn = saved.h; P.seed = saved.seed;
  window.svgEditor = null; document.getElementById('pullChangeListOverlay')?.remove(); releaseHeldStage(); setPaintScheduler(null);
});

describe('a Pull never adds a layer, never draws, never writes before Apply', () => {
  it('untagged curves: no layer, no path, no editor undo step -- only a count in the report', () => {
    const { ed, children } = fakeEditor();
    window.svgEditor = ed;
    onSketchPulled(reply());
    expect(ed._layers.map((l) => l.name)).toEqual(['Layer 1']);
    expect(children).toEqual([]);
    expect(ed.pushState).not.toHaveBeenCalled();
    expect(ed._notifyChange).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('2 curves not made by Send were noted, not added.'), 'warn');
  });

  it('Send-tagged curves are not counted as untagged', () => {
    const { ed } = fakeEditor();
    window.svgEditor = ed;
    const r = JSON.parse(reply());
    r.curves = [{ type: 'line', d: 'M 0 0 L 1 0', railId: 'r1' }, { type: 'line', d: 'M 0 1 L 1 1' }];
    onSketchPulled(JSON.stringify(r));
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('1 curve not made by Send was noted, not added.'), 'warn');
  });

  it('Cancel leaves the project byte-identical (dialog open with a Seed row, then Cancel)', () => {
    const { ed, children } = fakeEditor();
    window.svgEditor = ed;
    const before = snapshot(ed, children);
    onSketchPulled(reply({ seed: 4821 }));
    const overlay = document.getElementById('pullChangeListOverlay');
    expect(overlay.textContent).toContain('Seed');           // the dialog really is open, with the seed row
    expect(snapshot(ed, children)).toBe(before);             // ...and nothing was written to open it
    overlay.querySelector('.cad-btn-secondary').click();     // Cancel
    expect(snapshot(ed, children)).toBe(before);
    expect(applyParam).not.toHaveBeenCalled();
  });

  it('Apply changes only the PULL_MAP rows: the seed goes through applyParam, no layer is added', () => {
    const { ed, children } = fakeEditor();
    window.svgEditor = ed;
    onSketchPulled(reply({ seed: 4821 }));
    document.getElementById('pullChangeListOverlay').querySelector('.cad-btn-primary').click();
    expect(applyParam).toHaveBeenCalledTimes(1);
    expect(applyParam).toHaveBeenCalledWith('seed', 4821);
    expect(ed._layers.map((l) => l.name)).toEqual(['Layer 1']);
    expect(children).toEqual([]);
  });
});

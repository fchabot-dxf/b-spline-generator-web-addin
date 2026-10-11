/**
 * main/ui-bindings.js PARAM_STAGES (seat A's re-time 2026-10-09 + seat D's phone audit, 390 px, CPU x4, bricks laid): a
 * board width / height nudge ran its apply -- the grid change starts the mask refresh, which serialises every carved
 * layer's SVG -- 55-85 ms in the tap before the 'frame' card. The declared stage is on screen first; the apply follows
 * in the paint step, for the field's input and its change (blur) alike.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/main/param-manager.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, applyParam: vi.fn() };
});

import { PARAM_STAGES, bindControls } from '../bspline-frame-builder/b-spline-gen/html/main/ui-bindings.js';
import { applyParam } from '../bspline-frame-builder/b-spline-gen/html/main/param-manager.js';
import { LOADING_STAGES, setPaintScheduler, currentLoadingStage } from '../bspline-frame-builder/b-spline-gen/html/core/loading-signal.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { renderPhotoLayerSection, bindPhotoLayerSection } from '../bspline-frame-builder/b-spline-gen/html/main/photo-layer-section.js';

beforeEach(() => {
  document.body.innerHTML = '<div id="loading-stage" hidden><span class="loading-stage-text"></span></div>'
    + '<input id="widthIn" type="number" value="7"><input id="heightIn" type="number" value="9"><input id="seed" type="number" value="3">';
  try { bindControls(null); } catch { /* the rest of the sidebar is not in this page */ }
  applyParam.mockClear();
});
afterEach(() => { document.body.innerHTML = ''; });

describe('PARAM_STAGES: a heavy sidebar param shows its stage before its apply', () => {
  it('declared: the board width and height -> the frame stage', () => {
    expect(PARAM_STAGES).toEqual({ widthIn: 'frame', heightIn: 'frame', photoLayer: 'rebuild' });
    for (const s of Object.values(PARAM_STAGES)) expect(LOADING_STAGES[s]).toBeTruthy();
  });

  it('a width nudge (input, then the change): the stage first, each apply in its paint step, in order', () => {
    let paints = [];
    setPaintScheduler((cb) => { paints.push(cb); });
    const el = document.getElementById('widthIn');
    el.value = '7.25';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    expect(currentLoadingStage()?.id).toBe('frame');
    expect(applyParam.mock.calls.filter(([k]) => k === 'widthIn')).toEqual([]); // nothing ran in the gesture
    paints.forEach((p) => p()); paints = [];
    expect(applyParam.mock.calls.filter(([k]) => k === 'widthIn')).toEqual([['widthIn', 7.25], ['widthIn', 7.25]]);
  });

  // seat A 2026-10-11 (matrix blind row "Surface: photo layer toggle (off)", 53-92 ms blind): the switch's apply AND
  // Surface > Photo's greying (photo-layer-section.js) both wait for the stage; the greying reads the applied value
  it('the Photo layer switch: the rebuild stage first; the apply, then the greying, in its paint step', () => {
    P.photoLayer = true;
    document.body.innerHTML += '<div id="photoLayerBody"></div>';
    renderPhotoLayerSection(document.getElementById('photoLayerBody'));
    try { bindControls(null); } catch { /* the rest of the sidebar is not in this page */ }
    bindPhotoLayerSection();
    applyParam.mockImplementation((k, v) => { P[k] = v; });
    let paints = [];
    setPaintScheduler((cb) => { paints.push(cb); });
    const box = document.getElementById('photoLayer'), amount = document.getElementById('photoFilterAmount');
    box.checked = false; box.dispatchEvent(new Event('input', { bubbles: true })); box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(currentLoadingStage()?.id).toBe('rebuild');
    expect([applyParam.mock.calls.filter(([k]) => k === 'photoLayer'), amount.disabled]).toEqual([[], false]); // nothing in the tap
    paints.forEach((p) => p()); paints = [];
    expect(applyParam.mock.calls.filter(([k]) => k === 'photoLayer')).toEqual([['photoLayer', false]]);
    expect(amount.disabled).toBe(true);
    applyParam.mockReset();
  });

  it('an undeclared param applies at once, as before', () => {
    setPaintScheduler(() => {}); // a paint that never comes: only a staged apply would wait for it
    const el = document.getElementById('seed');
    el.value = '4';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(applyParam).toHaveBeenCalledWith('seed', 4);
  });
});

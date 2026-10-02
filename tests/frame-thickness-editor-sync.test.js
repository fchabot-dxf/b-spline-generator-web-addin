/**
 * T82 item 4 (Fred: "a frame thickness (offset) setting can be in frame editor since it's a visible 2D
 * feature", same rule as the inset window): a second Frame-thickness stepper in #editorFramePanel, bound
 * to the SAME frame_thickness the sidebar's own #frameThickness edits (one value, two views, kept in
 * sync via FRAME_PARAM_FIELDS' own generic read/write loop -- main/frame-panel.js). Plus a live warning
 * when thickness is at or past the outline's own smallest CONVEX arc radius (editor-frame-profile.js's
 * own `smallestConvexArcRadius`, read from the app's already-solved outline/inner profile, no new
 * formula -- outline-offset.js's own documented `r - t` convex / `r + t` concave rule).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { getFrameRecord, setFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile, frameInnerProfile, smallestConvexArcRadius } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { initFramePanel, setEditorTab, editFrame } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';

const BOARD = { widthIn: 7, heightIn: 9 };
const $ = (id) => document.getElementById(id);

describe('T82 item 4: Frame-editor thickness stepper + convex-radius warning', () => {
  let root;
  beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML = `<input id="widthIn" value="7"><input id="heightIn" value="9">
      <select id="frameTemplate"></select>
      <div id="frameSettings">
        <select id="frameAppearance"></select>
        <div id="frameThicknessRow"><input type="number" id="frameThickness" step="0.0625"></div>
      </div>
      <button id="btnStampEdit"></button><div id="editorSVGContainer"></div><div id="editorFrameShield"></div>
      <aside id="editorFramePanel">
        <select id="editorFrameTemplate"></select>
        <input type="number" id="editorFrameThickness" step="0.0625">
        <div id="editorFrameThicknessWarning"></div>
      </aside>
      <aside id="editorLayersPanel"></aside>`;
    document.body.appendChild(root);
    P.frame = null; P.widthIn = 7; P.heightIn = 9;
    initFramePanel();
    setFrameRecord({ templateId: 'template_1' }); // T1 Hourglass: has convex shoulder/hip arcs
  });
  afterEach(() => { setEditorTab('artwork'); root.remove(); P.frame = null; });

  it('typing in the SIDEBAR field updates the editor-panel field and the record', () => {
    $('frameThickness').value = '0.5';
    $('frameThickness').dispatchEvent(new Event('change'));
    expect(getFrameRecord().params.frame_thickness).toBe(0.5);
    expect($('editorFrameThickness').value).toBe('0.5');
  });

  it('typing in the EDITOR-PANEL field updates the sidebar field and the record', () => {
    $('editorFrameThickness').value = '0.6';
    $('editorFrameThickness').dispatchEvent(new Event('change'));
    expect(getFrameRecord().params.frame_thickness).toBe(0.6);
    expect($('frameThickness').value).toBe('0.6');
  });

  it('the oracle: smallestConvexArcRadius agrees with a hand-count of T1\'s own convex arcs at 7x9', () => {
    const rec = getFrameRecord();
    const prof = frameCutProfile(FRAME_DEFS, rec, BOARD);
    const inner = frameInnerProfile(FRAME_DEFS, { ...rec, params: { frame_thickness: 0.3 } }, BOARD); // a thin, surely-valid probe thickness
    const r = smallestConvexArcRadius(prof.primitives, inner.primitives);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(Infinity); // T1 genuinely has a convex arc (shoulder/hip), this must find one
  });

  it('the warning appears once thickness reaches the smallest convex radius, and disappears below it', () => {
    const rec = getFrameRecord();
    const prof = frameCutProfile(FRAME_DEFS, rec, BOARD);
    const probeInner = frameInnerProfile(FRAME_DEFS, { ...rec, params: { frame_thickness: 0.05 } }, BOARD);
    const minR = smallestConvexArcRadius(prof.primitives, probeInner.primitives);

    editFrame({ params: { frame_thickness: minR - 0.1 } });
    expect($('editorFrameThicknessWarning').style.display).toBe('none');

    editFrame({ params: { frame_thickness: minR + 0.1 } });
    expect($('editorFrameThicknessWarning').style.display).toBe('');
    expect($('editorFrameThicknessWarning').textContent).toMatch(/thickness/i);

    editFrame({ params: { frame_thickness: minR - 0.1 } });
    expect($('editorFrameThicknessWarning').style.display).toBe('none');
  });

  it('no warning with no frame selected (nothing to measure)', () => {
    editFrame({ templateId: null, params: {} });
    expect($('editorFrameThicknessWarning').style.display).toBe('none');
  });
});

/**
 * T82 item 4 (Fred: "a frame thickness (offset) setting can be in frame editor since it's a visible 2D
 * feature", same rule as the inset window): a second Frame-thickness stepper in #editorFramePanel, bound
 * to the SAME frame_thickness the sidebar's own #frameThickness edits (one value, two views, kept in
 * sync via FRAME_PARAM_FIELDS' own generic read/write loop -- main/frame-panel.js). Its convex-radius
 * warning was removed (Fred, 2026-10-03): since isTopologyMatched=False + the H23 item 63 corner
 * fallbacks, Fusion builds that case fine -- the inner edge just gets a sharp corner.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { getFrameRecord, setFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { initFramePanel, setEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';

const $ = (id) => document.getElementById(id);

describe('T82 item 4: Frame-editor thickness stepper', () => {
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
      </aside>
      <aside id="editorLayersPanel"></aside>`;
    document.body.appendChild(root);
    P.frame = null; P.widthIn = 7; P.heightIn = 9;
    initFramePanel();
    setFrameRecord({ templateId: 'template_1' });
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
});

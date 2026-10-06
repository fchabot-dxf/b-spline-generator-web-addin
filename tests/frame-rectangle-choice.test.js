/**
 * Fred (turn 207): the frame template picker's no-frame choice reads 'Rectangle' and shows a rectangle OUTLINE
 * icon drawn like the template icons -- same value underneath ('' = no frame shape), declared once
 * (main/frame-panel.js NO_FRAME_CHOICE, editor/frame-template-icon.js boardOutlineIconSvg).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { initFramePanel, NO_FRAME_CHOICE } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';
import { boardOutlineIconSvg, templateIconSvg } from '../bspline-frame-builder/b-spline-gen/html/editor/frame-template-icon.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';

const FIXTURE = `
  <input id="widthIn" value="7"><input id="heightIn" value="9">
  <span id="frameSummary"></span><div id="framePanelHeader" class="collapsed"></div>
  <select id="frameTemplate"></select>
  <div id="frameSettings"><div id="frameThicknessRow"><input id="frameThickness" type="number"></div><input id="frameBottomZ"><input id="frameTrimOffset" type="number"><select id="frameAppearance"></select>
    <div id="frameFitWarning"></div><button id="btnEditFrameShape"></button></div>
  <button id="btnStampEdit"></button>
  <button id="editorTabFrame"></button><button id="editorTabArtwork" class="active"></button>
  <div id="editorFrameShield" style="display:none"></div>
  <aside id="editorFramePanel" style="display:none"><select id="editorFrameTemplate"></select></aside>
  <aside id="editorLayersPanel"></aside>`;

let root;
beforeEach(() => {
  root = document.createElement('div');
  root.innerHTML = FIXTURE;
  document.body.appendChild(root);
  P.frame = null; P.widthIn = 7; P.heightIn = 9;
  window.svgEditor = null;
  initFramePanel();
});
afterEach(() => root.remove());

describe("the no-frame choice is 'Rectangle' with an outline icon", () => {
  it("declared once: value '' (no frame shape), label 'Rectangle'", () => {
    expect(NO_FRAME_CHOICE).toEqual({ value: '', label: 'Rectangle' });
  });
  it('both pickers offer it first, labelled Rectangle, same value as before', () => {
    for (const id of ['frameTemplate', 'editorFrameTemplate']) {
      const first = document.getElementById(id).options[0];
      expect(first.value).toBe('');
      expect(first.textContent).toBe('Rectangle');
    }
  });
  it('the icon is a rectangle outline in the template icons\' own box, not a text cell', () => {
    const svg = boardOutlineIconSvg();
    expect(svg).toBe(boardOutlineIconSvg(28));
    expect(svg).toMatch(/^<svg[^>]*viewBox="0 0 7 9"/);
    expect(svg).toMatch(/<rect [^>]*fill="none"/);
    const button = root.querySelector('.icon-select-button');
    expect(button.querySelector('svg rect')).not.toBeNull(); // no frame picked -> the button shows the outline
    expect(button.title).toBe('Frame template: Rectangle');
    expect(templateIconSvg(FRAME_DEFS, '')).toBe(null); // the template drawer itself is unchanged
  });
  it("the sidebar FRAME header names it too ('— Rectangle', not '— none')", () => {
    expect(document.getElementById('frameSummary').textContent).toBe('— Rectangle');
  });
});

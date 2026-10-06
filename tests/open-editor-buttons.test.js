/**
 * Turn 207 (Fred): a "Brick editor" button at the TOP of the main sidebar's BRICK section opens the editor on
 * the Brick tab -- declared with the FRAME section's "Edit frame" in main/frame-panel.js OPEN_EDITOR_BUTTONS,
 * both through the same path (btnStampEdit's own open, on the declared tab).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { initFramePanel, OPEN_EDITOR_BUTTONS } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';
import { getEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';
import { currentLoadingStage, resetLoadingSignal, setPaintScheduler } from '../bspline-frame-builder/b-spline-gen/html/core/loading-signal.js';

const FIXTURE = `
  <input id="widthIn" value="7"><input id="heightIn" value="9">
  <span id="frameSummary"></span><div id="framePanelHeader" class="collapsed"></div>
  <select id="frameTemplate"></select>
  <div id="frameSettings"><div id="frameThicknessRow"><input id="frameThickness" type="number"></div><input id="frameBottomZ"><input id="frameTrimOffset" type="number"><select id="frameAppearance"></select>
    <div id="frameFitWarning"></div><button id="btnEditFrameShape"></button></div>
  <button id="btnStampEdit"></button><button id="btnEditBricks"></button>
  <button id="editorTabFrame"></button><button id="editorTabArtwork" class="active"></button><button id="editorTabBrick"></button>
  <div id="editorFrameShield" style="display:none"></div>
  <aside id="editorFramePanel" style="display:none"><select id="editorFrameTemplate"></select></aside>
  <aside id="editorLayersPanel"></aside><aside id="editorBrickPanel" style="display:none"></aside>
  <button id="editorDrawerTab-layers">Layers</button>
  <div id="loading-stage" hidden><span class="loading-stage-text"></span></div>`;

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

describe('the sidebar open-the-editor buttons', () => {
  it('declared: Edit frame -> Frame tab, Brick editor -> Brick tab', () => {
    expect(OPEN_EDITOR_BUTTONS).toEqual([{ id: 'btnEditFrameShape', tab: 'frame' }, { id: 'btnEditBricks', tab: 'brick' }]);
  });
  it('Brick editor opens the editor through btnStampEdit, on the Brick tab', async () => {
    const open = vi.fn();
    document.getElementById('btnStampEdit').addEventListener('click', open);
    document.getElementById('btnEditBricks').click();
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1)); // item 41: its loading stage paints first
    expect(getEditorTab()).toBe('brick');
  });
  it('item 41: opening shows its loading stage FIRST -- the open itself runs after the paint', async () => {
    resetLoadingSignal();
    setPaintScheduler(null); // the real paint step (the suite's is immediate)
    let seen = 'not opened';
    document.getElementById('btnStampEdit').addEventListener('click', () => { seen = currentLoadingStage(); });
    document.getElementById('btnEditBricks').click();
    expect(currentLoadingStage()).toEqual({ id: 'openEditor', text: 'Refreshing - opening the editor', surface: 'pill' });
    expect(seen).toBe('not opened');
    await vi.waitFor(() => expect(seen).not.toBe('not opened'));
    expect(seen?.id).toBe('openEditor'); // the stage was on screen while the editor opened
    resetLoadingSignal();
  });
  it('the button is the first thing in the BRICK section', () => {
    const html = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
    const section = html.slice(html.indexOf('<div class="panel panel-brick">'));
    const body = section.slice(section.indexOf('<div class="panel-body hidden">') + '<div class="panel-body hidden">'.length);
    expect(body.replace(/<!--[\s\S]*?-->/g, '').trimStart()).toMatch(/^<button type="button" id="btnEditBricks"/);
  });
});

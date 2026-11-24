/**
 * Turn 207 (Fred): a "Brick editor" button at the TOP of the main sidebar's BRICK section opens the editor on
 * the Brick tab -- declared with the FRAME section's "Edit frame" in main/frame-panel.js OPEN_EDITOR_BUTTONS,
 * both through the same path (openEditorOn -> svg-source.js openEditorSession, on the declared tab). The sidebar's Open SVG
 * Editor button (#btnStampEdit) retired with the Vector stamping panel (Fred 2026-11-23): no element is needed to open it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { initFramePanel, OPEN_EDITOR_BUTTONS, openEditorOn } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';
import { getEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';
import { currentLoadingStage, resetLoadingSignal, setPaintScheduler } from '../bspline-frame-builder/b-spline-gen/html/core/loading-signal.js';

const FIXTURE = `
  <input id="widthIn" value="7"><input id="heightIn" value="9">
  <span id="frameSummary"></span><div id="framePanelHeader" class="collapsed"></div>
  <select id="frameTemplate"></select>
  <div id="frameSettings"><div id="frameThicknessRow"><input id="frameThickness" type="number"></div><input id="frameBottomZ"><input id="frameTrimOffset" type="number"><select id="frameAppearance"></select>
    <div id="frameFitWarning"></div><button id="btnEditFrameShape"></button></div>
  <div id="svgEditorModal" style="display:none"></div><button id="btnEditBricks"></button>
  <button id="editorTabFrame"></button><button id="editorTabArtwork" class="active"></button><button id="editorTabBrick"></button>
  <div id="editorFrameShield" style="display:none"></div>
  <aside id="editorFramePanel" style="display:none"><select id="editorFrameTemplate"></select></aside>
  <aside id="editorLayersPanel"></aside><aside id="editorBrickPanel" style="display:none"></aside>
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
  it('declared: Edit frame -> Frame tab (the Brick panel\'s Brick editor retired: the Brick card\'s door calls openEditorOn)', () => {
    // c64a466 (2026-10-14): the main sidebar's permanent Layers panel opens the editor on the Artwork tab
    // (the Layers section's Open Editor retired, Fred 2026-11-23: the 2D / 3D toggle opens the editor)
    expect(OPEN_EDITOR_BUTTONS).toEqual([{ id: 'btnEditFrameShape', tab: 'frame' }]);
  });
  it('openEditorOn brick (the layer stack Brick card door, the [2D] toggle) opens the editor with NO #btnStampEdit in the page, on the Brick tab', async () => {
    expect(document.getElementById('btnStampEdit')).toBeNull();
    const open = vi.fn();
    window.svgEditor = { _layers: [], _activeLayer: null, open };
    openEditorOn('brick');
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1)); // item 41: its loading stage paints first
    expect(document.getElementById('svgEditorModal').style.display).toBe('flex');
    expect(getEditorTab()).toBe('brick');
  });
  it('item 41: opening shows its loading stage FIRST -- the open itself runs after the paint', async () => {
    resetLoadingSignal();
    setPaintScheduler(null); // the real paint step (the suite's is immediate)
    let seen = 'not opened';
    window.svgEditor = { _layers: [], _activeLayer: null, open() { seen = currentLoadingStage(); } };
    openEditorOn('brick');
    expect(currentLoadingStage()).toEqual({ id: 'openEditor', text: 'Refreshing - opening the editor', surface: 'pill' });
    expect(seen).toBe('not opened');
    await vi.waitFor(() => expect(seen).not.toBe('not opened'));
    expect(seen?.id).toBe('openEditor'); // the stage was on screen while the editor opened
    resetLoadingSignal();
  });
  it('the Brick fields (the old BRICK panel\'s body, hosted by the layer stack\'s Brick card) carry no second Brick-tab button', () => {
    const html = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
    const open = '<div id="brickPanelBody" class="layer-hosted-body">';
    const body = html.slice(html.indexOf(open) + open.length);
    expect(body.slice(0, body.indexOf('<div id="stampBlueprint"')).replace(/<!--[\s\S]*?-->/g, '')).not.toMatch(/btnEditBricks|Brick editor/);
  });
});

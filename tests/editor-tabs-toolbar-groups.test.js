/**
 * F35 item 16 follow-up (Fred): hiding the WHOLE top toolbar on non-Artwork tabs went too far --
 * Brick's own Brush tool needs the GRID group (SHOW/GRID-snap/GEOM-snap + spacing) to draw strokes.
 * main/editor-tabs.js's own declared TOOLBAR_TOP_GROUPS_BY_TAB now gates each GROUP individually via
 * an inline style.display, leaving 'artwork' alone entirely so editor-ui.js's existing per-MODE
 * `.hidden`-class system (TOOLBAR_GROUPS) keeps full, undisturbed control there.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';

const GATED_GROUPS = ['editorStrokeGroup', 'editorColorGroup', 'editorGridGroup', 'editorFillModeGroup', 'editorFontGroup', 'editorExpandGroup'];

const FIXTURE = `
  <button id="editorTabFrame"></button><div id="editorFramePanel"></div><div id="editorToolbarFrame"></div>
  <button id="editorTabArtwork"></button><div id="editorLayersPanel"></div><div id="editorToolbarArtwork"></div>
  <button id="editorTabPhoto"></button><div id="editorPhotoPanel"></div><div id="editorToolbarPhoto"></div>
  <button id="editorTabBrick"></button><div id="editorBrickPanel"></div><div id="editorToolbarBrick"></div>
  <div id="editorToolbarTop"></div>
  <div id="editorStrokeGroup"></div>
  <div id="editorColorGroup"></div>
  <div id="editorGridGroup"></div>
  <div id="editorFillModeGroup"></div>
  <div id="editorFontGroup" class="hidden"></div>
  <div id="editorExpandGroup" class="hidden"></div>
  <div id="editorTouchActionsGroup"></div>
`;

const $ = (id) => document.getElementById(id);
let root;
beforeEach(() => {
  root = document.createElement('div');
  root.innerHTML = FIXTURE;
  document.body.appendChild(root);
});
afterEach(() => { root.remove(); });

describe('setEditorTab: per-tab top-toolbar GROUP gating', () => {
  it('Brick: shows editorGridGroup only, hides every other gated group, bar itself stays visible', () => {
    setEditorTab('brick');
    expect($('editorToolbarTop').style.display).toBe('flex');
    expect($('editorGridGroup').style.display).toBe('flex');
    for (const id of GATED_GROUPS) {
      if (id === 'editorGridGroup') continue;
      expect($(id).style.display).toBe('none');
    }
  });

  it('Photo and Frame: hide every gated group, bar itself stays visible', () => {
    for (const tab of ['photo', 'frame']) {
      setEditorTab(tab);
      expect($('editorToolbarTop').style.display).toBe('flex');
      for (const id of GATED_GROUPS) expect($(id).style.display).toBe('none');
    }
  });

  it('Artwork: clears every gated group\'s own inline style -- never forces them visible or hidden, leaving editor-ui.js\'s own per-mode .hidden class in sole control', () => {
    setEditorTab('artwork');
    for (const id of GATED_GROUPS) expect($(id).style.display).toBe('');
    // the PRE-EXISTING .hidden class (editorFontGroup/editorExpandGroup, set in the fixture to
    // simulate editor-ui.js's own TOOLBAR_GROUPS table having already hidden them for the current
    // mode) is left completely untouched -- confirming visibility is genuinely class-driven here,
    // not just "currently looks right because nothing hid it yet".
    expect($('editorFontGroup').classList.contains('hidden')).toBe(true);
    expect($('editorExpandGroup').classList.contains('hidden')).toBe(true);
  });

  it('round-trip Artwork -> Brick -> Artwork restores the exact pre-existing .hidden-class visibility with NO re-sync call needed', () => {
    setEditorTab('artwork');
    setEditorTab('brick'); // editorFontGroup/editorExpandGroup forced to display:none here
    expect($('editorFontGroup').style.display).toBe('none');
    setEditorTab('artwork'); // back: inline style cleared, the class (still 'hidden', never touched) shows through again
    expect($('editorFontGroup').style.display).toBe('');
    expect($('editorFontGroup').classList.contains('hidden')).toBe(true); // unchanged the whole time
  });

  it('never touches editorTouchActionsGroup -- its own visibility is a CSS media query, independent of tab by design', () => {
    for (const tab of ['brick', 'photo', 'frame', 'artwork']) {
      setEditorTab(tab);
      expect($('editorTouchActionsGroup').style.display).toBe('');
    }
  });
});

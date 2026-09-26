/**
 * FB-APP F8: the editor's [Frame | Artwork] tabs (design §3.1, two doors / one
 * room) and the round trip Frame -> Artwork -> Frame -> save -> reload with the
 * record intact and the artwork untouched.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { P, persistableP } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { getFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { initFramePanel, setEditorTab, getEditorTab, syncFramePanel } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';

const FIXTURE = `
  <input id="widthIn" value="7"><input id="heightIn" value="9">
  <span id="frameSummary"></span><div id="framePanelHeader" class="collapsed"></div>
  <select id="frameTemplate"></select>
  <div id="frameSettings"><input id="frameBottomZ"><select id="frameAppearance"></select>
    <div id="frameFitWarning"></div><button id="btnEditFrameShape"></button></div>
  <button id="btnStampEdit"></button>
  <button id="editorTabFrame"></button><button id="editorTabArtwork" class="active"></button>
  <div id="editorFrameShield" style="display:none"></div>
  <aside id="editorFramePanel" style="display:none">
    <select id="editorFrameTemplate"></select>
    <label id="editorFrameThicknessRow"><input id="editorFrameThickness" type="number"></label>
    <label id="editorFrameWoodRow"><select id="editorFrameWood"></select></label>
  </aside>
  <aside id="editorLayersPanel"></aside>
  <button id="editorDrawerTab-layers">Layers</button>`;

/** An artwork layer that records every write, so "untouched" is checked, not assumed. */
function mockEditor() {
  const writes = [];
  const artwork = [{ id: 'path1', d: 'M1 1 L2 2' }, { id: 'text1', d: 'M3 3 L4 4' }];
  const layerAttrs = {};
  const sketch = {
    attr(k, v) { writes.push([k, v]); if (v === null) delete layerAttrs[k]; else layerAttrs[k] = v; return sketch; },
    children: () => artwork,
  };
  return { editor: { _sketchLayer: sketch, _mW: 7, _mH: 9 }, artwork, layerAttrs, writes };
}

let root, mock;
beforeEach(() => {
  root = document.createElement('div');
  root.innerHTML = FIXTURE;
  document.body.appendChild(root);
  P.frame = null; P.widthIn = 7; P.heightIn = 9;
  mock = mockEditor();
  window.svgEditor = mock.editor;
  initFramePanel();
});
afterEach(() => { root.remove(); window.svgEditor = null; setEditorTab('artwork'); });

const $ = (id) => document.getElementById(id);
const change = (id, value) => { $(id).value = value; $(id).dispatchEvent(new Event('change')); };
const shown = (id) => $(id).style.display !== 'none';

describe('editor [Frame | Artwork] tabs', () => {
  it('"Edit frame shape" opens the editor on the Frame tab; "Open SVG Editor" on the Artwork tab', () => {
    $('btnEditFrameShape').click();
    expect(getEditorTab()).toBe('frame');
    expect([shown('editorFramePanel'), shown('editorLayersPanel'), shown('editorFrameShield')]).toEqual([true, false, true]);
    expect($('editorDrawerTab-layers').textContent).toBe('Frame'); // mobile drawer label
    $('btnStampEdit').click();
    expect(getEditorTab()).toBe('artwork');
    expect([shown('editorFramePanel'), shown('editorLayersPanel'), shown('editorFrameShield')]).toEqual([false, true, false]);
    expect($('editorDrawerTab-layers').textContent).toBe('Layers');
  });

  it('the Frame tab edits the SAME record as the sidebar (template, thickness, wood)', () => {
    setEditorTab('frame');
    change('editorFrameTemplate', 'template_2');
    expect(getFrameRecord().templateId).toBe('template_2');
    expect($('frameTemplate').value).toBe('template_2'); // the sidebar follows
    change('editorFrameThickness', '0.5');
    expect(getFrameRecord().params.frame_thickness).toBe(0.5);
    change('frameAppearance', '3D Maple - Unfinished'); // sidebar -> the editor follows
    expect($('editorFrameWood').value).toBe('3D Maple - Unfinished');
    expect(Number($('editorFrameThickness').max)).toBe(1.5); // limits come from the definition
  });

  it('the artwork is view-only in the Frame tab and restored exactly in the Artwork tab', () => {
    setEditorTab('frame');
    expect(mock.layerAttrs.opacity).toBe(0.35);
    setEditorTab('artwork');
    expect(mock.layerAttrs).toEqual({}); // the dim is removed, nothing else was ever written
    expect(mock.writes.every(([k]) => k === 'opacity')).toBe(true);
  });
});

describe('round trip: Frame -> Artwork -> Frame -> save -> reload', () => {
  it('keeps the record intact and never touches the artwork', () => {
    const artworkBefore = JSON.parse(JSON.stringify(mock.artwork));
    $('btnEditFrameShape').click(); // Frame
    change('editorFrameTemplate', 'template_1');
    change('editorFrameThickness', '0.625');
    change('editorFrameWood', '3D Cherry - Unfinished');
    $('editorTabArtwork').click(); // Artwork
    change('frameBottomZ', '-1.5'); // a sidebar edit meanwhile
    $('editorTabFrame').click(); // Frame again
    const expected = { templateId: 'template_1', params: { frame_thickness: 0.625 }, frameBottomZ: -1.5, appearance: '3D Cherry - Unfinished' };
    expect(getFrameRecord()).toMatchObject(expected);
    // save -> reload (the project serializer, then the load's own P restore)
    const saved = JSON.parse(JSON.stringify({ P: persistableP() }));
    P.frame = null;
    P.frame = saved.P.frame;
    expect(getFrameRecord()).toMatchObject(expected);
    $('editorFrameThickness').value = ''; syncFramePanel(); // the reloaded record drives the fields again
    expect($('editorFrameThickness').value).toBe('0.625');
    expect(mock.artwork).toEqual(artworkBefore);
    expect(mock.writes.every(([k]) => k === 'opacity')).toBe(true);
  });
});

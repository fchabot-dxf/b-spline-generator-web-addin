/**
 * FB-APP F8: the editor's [Frame | Artwork] tabs (design §3.1, two doors / one
 * room) and the round trip Frame -> Artwork -> Frame -> save -> reload with the
 * record intact and the artwork untouched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { P, persistableP } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { getFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { initFramePanel, setEditorTab, getEditorTab, syncFramePanel } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';
import { INACTIVE_LAYER_OPACITY } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { initInteraction } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-interaction.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { frameCutProfile } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { FORMULA_FIELDS } from '../bspline-frame-builder/b-spline-gen/html/main/formula-fields.js';

const FIXTURE = `
  <input id="widthIn" value="7"><input id="heightIn" value="9">
  <span id="frameSummary"></span><div id="framePanelHeader" class="collapsed"></div>
  <select id="frameTemplate"></select>
  <div id="frameSettings"><input id="frameBottomZ"><input id="frameTrimOffset" type="number"><select id="frameAppearance"></select>
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
  const editor = { _sketchLayer: sketch, _mW: 7, _mH: 9, deselected: 0, _deselect() { editor.deselected++; } };
  return { editor, artwork, layerAttrs, writes };
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

  it('the Frame tab shows the artwork faded and LOCKED; the Artwork tab restores it exactly', () => {
    setEditorTab('frame');
    expect(mock.layerAttrs.opacity).toBe(INACTIVE_LAYER_OPACITY);
    expect(mock.editor._artworkLocked).toBe(true);
    expect(mock.editor.deselected).toBe(1); // nothing of the art stays selected
    setEditorTab('artwork');
    expect(mock.editor._artworkLocked).toBe(false);
    expect(mock.layerAttrs).toEqual({}); // the fade is removed, nothing else was ever written
    expect(mock.writes.every(([k]) => k === 'opacity')).toBe(true);
  });

  it('no editor shortcut reaches the art in the Frame tab (Delete, tool keys, copy/paste/select all)', () => {
    const modal = document.createElement('div');
    modal.id = 'svgEditorModal';
    root.appendChild(modal);
    const tool = document.createElement('button');
    tool.dataset.key = 'p';
    const toolClick = vi.fn();
    tool.addEventListener('click', toolClick);
    modal.appendChild(tool);
    const ed = mock.editor;
    Object.assign(ed, { _draw: { node: document.createElement('div') }, _selectedElements: [{}], deleteSelected: vi.fn() });
    initInteraction(ed);
    const press = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    setEditorTab('frame');
    press('Delete'); press('p');
    expect([ed.deleteSelected.mock.calls.length, toolClick.mock.calls.length]).toEqual([0, 0]);
    setEditorTab('artwork'); // the same keys work again on the Artwork tab
    ed._selectedElements = [{}];
    press('Delete'); press('p');
    expect([ed.deleteSelected.mock.calls.length, toolClick.mock.calls.length]).toEqual([1, 1]);
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

describe('Trim offset field (F9 item 1: the template param boundingboxoffset)', () => {
  it('shows the template default and its declared limit, and writes the SAME frame record', () => {
    change('frameTemplate', 'template_1');
    expect(Number($('frameTrimOffset').value)).toBe(0.25);
    expect(Number($('frameTrimOffset').min)).toBe(0);
    change('frameTrimOffset', '0.5');
    expect(getFrameRecord().params.boundingboxoffset).toBe(0.5);
  });

  it('drives the cut profile and the fit rule live (one value, every consumer)', () => {
    change('frameTemplate', 'template_2');
    change('frameTrimOffset', '0.5');
    const prof = frameCutProfile(FRAME_DEFS, getFrameRecord(), { widthIn: 7, heightIn: 9 });
    expect(prof.region).toEqual({ x: 0.5, y: 0.5, w: 6, h: 8 });
    expect(prof.fit.safeZoneIn).toBe(6); // min(7, 9) - 2 * 0.5
  });

  it('is kept by save -> reload, and a template change resets it to the new default', () => {
    change('frameTemplate', 'template_1');
    change('frameTrimOffset', '0.375');
    const saved = JSON.parse(JSON.stringify({ P: persistableP() }));
    P.frame = null; P.frame = saved.P.frame;
    expect(getFrameRecord().params.boundingboxoffset).toBe(0.375);
    change('frameTemplate', 'template_2');
    expect(getFrameRecord().params.boundingboxoffset).toBeUndefined();
    expect(Number($('frameTrimOffset').value)).toBe(0.25);
  });

  it('is a formula field of the FRAME section, with "trim" reading the record', () => {
    const f = FORMULA_FIELDS.find((q) => q.id === 'frameTrimOffset');
    expect(f.section).toBe('FRAME');
    change('frameTemplate', 'template_1');
    change('frameTrimOffset', '0.3');
    expect(f.scope.find((n) => n.name === 'trim').get()).toBe(0.3);
  });
});

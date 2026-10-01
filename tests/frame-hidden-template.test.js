/**
 * F29 item 1 (seat A's H23 item 14 live Fusion check: Template 10's arch sweeps the wrong branch in Fusion at
 * every board size, the fix isn't done yet): hide it from the template picker with one declared flag
 * (template_10/template_data.py FRAME_HIDDEN -> frame_definition.py build_frame_defs -> frame-defs `hidden`)
 * until the fix lands, WITHOUT breaking an already-saved project that picked it before today.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { getFrameRecord, setFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { initFramePanel, setEditorTab, syncFramePanel, frameLabel } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';
import { frameCutProfile } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
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
  <aside id="editorFramePanel" style="display:none">
    <select id="editorFrameTemplate"></select>
  </aside>
  <aside id="editorLayersPanel"></aside>
  <button id="editorDrawerTab-layers">Layers</button>`;

const $ = (id) => document.getElementById(id);
const change = (id, value) => { $(id).value = value; $(id).dispatchEvent(new Event('change')); };
const optionIds = (sel) => [...sel.options].map((o) => o.value);

let root;
beforeEach(() => {
  root = document.createElement('div');
  root.innerHTML = FIXTURE;
  document.body.appendChild(root);
  P.frame = null; P.widthIn = 7; P.heightIn = 9;
  window.svgEditor = null;
  initFramePanel();
});
afterEach(() => { root.remove(); setEditorTab('artwork'); });

// F30 item 3: Template 12/13 (the taper copies) are hidden the same way, until verified live in Fusion --
// same flag, same mechanism, so this file's own assertions now cover all three ids instead of just T10's.
const HIDDEN_IDS = ['template_10', 'template_12', 'template_13'];

describe('F29 item 1: Template 10 hidden from the picker, not from the data', () => {
  it('frame-defs: template_10, 12 and 13 carry hidden: true, no others', () => {
    for (const t of FRAME_DEFS.templates) expect(t.hidden, t.id).toBe(HIDDEN_IDS.includes(t.id));
  });

  it('neither template <select> offers any of them for a fresh pick', () => {
    for (const id of HIDDEN_IDS) {
      expect(optionIds($('frameTemplate'))).not.toContain(id);
      expect(optionIds($('editorFrameTemplate'))).not.toContain(id);
    }
    // every OTHER template is still offered (nothing over-filtered)
    for (const t of FRAME_DEFS.templates) if (!HIDDEN_IDS.includes(t.id)) {
      expect(optionIds($('frameTemplate'))).toContain(t.id);
    }
  });

  it('a record already on template_10 (an existing saved project) still loads, draws and shows correctly', () => {
    setFrameRecord({ templateId: 'template_10', seeds: {} });
    syncFramePanel();
    // the geometry side: unaffected by the flag, exactly like any other lookup by id
    const prof = frameCutProfile(FRAME_DEFS, getFrameRecord(), { widthIn: 7, heightIn: 9 });
    expect(prof.defects).toEqual([]);
    expect(prof.primitives.length).toBe(12);
    // the UI side: the select shows the correct template even though it isn't in the offered list
    expect($('frameTemplate').value).toBe('template_10');
    expect($('editorFrameTemplate').value).toBe('template_10');
    expect($('frameSummary').textContent).toBe(`— ${frameLabel(FRAME_DEFS.templates.find((t) => t.id === 'template_10'))}`);
  });

  it('switching away from the injected template_10 option removes it again (never left pickable)', () => {
    setFrameRecord({ templateId: 'template_10', seeds: {} });
    syncFramePanel();
    expect(optionIds($('frameTemplate'))).toContain('template_10');
    change('editorFrameTemplate', 'template_1'); // the sidebar <select> drives frame-record the same as T9/T10's own tests
    expect(getFrameRecord().templateId).toBe('template_1');
    expect(optionIds($('frameTemplate'))).not.toContain('template_10');
    expect(optionIds($('editorFrameTemplate'))).not.toContain('template_10');
  });
});

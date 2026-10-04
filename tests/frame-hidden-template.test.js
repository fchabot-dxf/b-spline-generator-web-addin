/**
 * F29 item 1 / H23 item 25: a template can be hidden from the picker (one declared flag --
 * template_N/template_data.py FRAME_HIDDEN -> frame_definition.py build_frame_defs -> frame-defs `hidden`)
 * without breaking an already-saved project that picked it before it was hidden, or before it un-hides.
 *
 * Template 10 itself used this mechanism from H23 item 14 (its arch swept the wrong branch in Fusion) until
 * item 25 un-hid it once the real fix (items 21-24) was live-verified -- it is no longer hidden, so this
 * suite no longer pins ITS id specifically. Instead it marks a DIFFERENT real template `hidden` for the
 * duration of each test (restored after), so the general mechanism -- not any one template's current status
 * -- stays covered regardless of which template (if any) is hidden at a given time.
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

// Any real, shipped, non-special template works as the synthetic hidden one for a test's own duration --
// template_9 picked arbitrarily (not template_10: it is never hidden again by design once shipped).
const HIDDEN_ID = 'template_9';
const hiddenTpl = () => FRAME_DEFS.templates.find((t) => t.id === HIDDEN_ID);

let root;
const mount = () => {
  root = document.createElement('div');
  root.innerHTML = FIXTURE;
  document.body.appendChild(root);
  P.frame = null; P.widthIn = 7; P.heightIn = 9;
  window.svgEditor = null;
  initFramePanel();
};

// F30 item 3 -> F30 item 4 merge (2026-10-02): the taper copies (Template 12/13) were hidden until verified live in
// Fusion; both passed the real panel-join check on the merged code, so neither stayed hidden.
// H23 item 78c / turn 550: Template 18 ("Arched Head") joined the list the same way, un-hidden now that its own
// 18-case live matrix is all-BUILT (template_18/template_data.py FRAME_HIDDEN -> False) -- same as T12/T13 before it.
const HIDDEN_IDS = [];

describe('F30 item 4 / H23 item 25 / H23 item 78c: only genuinely in-progress templates are hidden (currently: none)', () => {
  beforeEach(mount);
  afterEach(() => { root.remove(); setEditorTab('artwork'); });

  it('frame-defs: no template carries hidden: true', () => {
    for (const t of FRAME_DEFS.templates) expect(t.hidden, t.id).toBe(HIDDEN_IDS.includes(t.id));
  });

  it('both template <select>s offer every template for a fresh pick', () => {
    for (const id of HIDDEN_IDS) {
      expect(optionIds($('frameTemplate'))).not.toContain(id);
      expect(optionIds($('editorFrameTemplate'))).not.toContain(id);
    }
    // every OTHER template is still offered (nothing over-filtered)
    for (const t of FRAME_DEFS.templates) if (!HIDDEN_IDS.includes(t.id)) {
      expect(optionIds($('frameTemplate'))).toContain(t.id);
    }
  });
});

describe('F29 item 1: the general hidden-template mechanism (a template marked hidden for this test only)', () => {
  // the flag must be set BEFORE initFramePanel's own populate pass (mount), same as a real app load would see
  // it with FRAME_HIDDEN already true -- setting it only AFTER mount leaves the option present but untracked
  // as "dynamically injected for the current record", so the later removal-on-switch check never fires.
  beforeEach(() => { hiddenTpl().hidden = true; mount(); });
  afterEach(() => { root.remove(); setEditorTab('artwork'); delete hiddenTpl().hidden; });

  it('neither template <select> offers a hidden template for a fresh pick', () => {
    expect(optionIds($('frameTemplate'))).not.toContain(HIDDEN_ID);
    expect(optionIds($('editorFrameTemplate'))).not.toContain(HIDDEN_ID);
    // every OTHER template is still offered (nothing over-filtered) -- except F30 item 3's own taper copies,
    // which stay genuinely hidden (HIDDEN_IDS above) independent of this test's own synthetic flag.
    for (const t of FRAME_DEFS.templates) if (t.id !== HIDDEN_ID && !HIDDEN_IDS.includes(t.id)) {
      expect(optionIds($('frameTemplate'))).toContain(t.id);
    }
  });

  it('a record already on the hidden template (an existing saved project) still loads, draws and shows correctly', () => {
    setFrameRecord({ templateId: HIDDEN_ID, seeds: {} });
    syncFramePanel();
    // the geometry side: unaffected by the flag, exactly like any other lookup by id
    const prof = frameCutProfile(FRAME_DEFS, getFrameRecord(), { widthIn: 7, heightIn: 9 });
    expect(prof.defects).toEqual([]);
    // the UI side: the select shows the correct template even though it isn't in the offered list
    expect($('frameTemplate').value).toBe(HIDDEN_ID);
    expect($('editorFrameTemplate').value).toBe(HIDDEN_ID);
    expect($('frameSummary').textContent).toBe(`— ${frameLabel(hiddenTpl())}`);
  });

  it('switching away from the injected hidden option removes it again (never left pickable)', () => {
    setFrameRecord({ templateId: HIDDEN_ID, seeds: {} });
    syncFramePanel();
    expect(optionIds($('frameTemplate'))).toContain(HIDDEN_ID);
    change('editorFrameTemplate', 'template_1'); // the sidebar <select> drives frame-record the same as T9/T10's own tests
    expect(getFrameRecord().templateId).toBe('template_1');
    expect(optionIds($('frameTemplate'))).not.toContain(HIDDEN_ID);
    expect(optionIds($('editorFrameTemplate'))).not.toContain(HIDDEN_ID);
  });
});

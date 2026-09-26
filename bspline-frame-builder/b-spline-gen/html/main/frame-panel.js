/**
 * frame-panel.js — FB-APP S2 (F6): the sidebar FRAME section (design §3.1).
 *
 * The frame's solid-extrusion settings + template choice. Every option comes
 * from the generated frame definition (templates, the 5 declared woods, the
 * frame-bottom Z default); every write goes through setFrameRecord (the one
 * normalizing gate). It also registers the editor's cut-profile provider, so
 * the editor draws the board as the chosen frame's cut profile.
 *
 * F8: the editor's [Frame | Artwork] tabs. "Edit frame shape" opens the editor
 * on the Frame tab (the frame's template + params + wood, with the live cut
 * profile; gate 3.2 = (c): numeric fields, no on-canvas handles), "Open SVG
 * Editor" on the Artwork tab. In the Frame tab the artwork is view-only: a
 * shield over the canvas stops every tool, the editor's artwork lock stops
 * every shortcut, and the focus rule dims whichever side is not being edited
 * (editor-frame-profile.js setEditorFocus; display only).
 */
import { FRAME_DEFS, findFrameTemplate, getFrameRecord, setFrameRecord, frameParam } from '../core/frame-record.js';
import { P } from '../core/state.js';
import { setFrameProfileProvider, drawFrameProfile, frameFit, frameSolidSpec, setEditorFocus } from '../editor/editor-frame-profile.js';
import { AppState } from './app-state.js';

const $ = (id) => document.getElementById(id);

function _option(value, label) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  return o;
}

let _editorTab = 'artwork';
let _openEditorOn = null;

/** Switch the editor between its Frame and Artwork modes. */
export function setEditorTab(tab) {
  _editorTab = tab === 'frame' ? 'frame' : 'artwork';
  const frame = _editorTab === 'frame';
  $('editorTabFrame')?.classList.toggle('active', frame);
  $('editorTabArtwork')?.classList.toggle('active', !frame);
  if ($('editorFramePanel')) $('editorFramePanel').style.display = frame ? '' : 'none';
  if ($('editorLayersPanel')) $('editorLayersPanel').style.display = frame ? 'none' : '';
  if ($('editorFrameShield')) $('editorFrameShield').style.display = frame ? '' : 'none';
  // Mobile: the editor's bottom drawer labels its side panel; name it for the mode.
  if ($('editorDrawerTab-layers')) $('editorDrawerTab-layers').textContent = frame ? 'Frame' : 'Layers';
  setEditorFocus(typeof window !== 'undefined' ? window.svgEditor : null, _editorTab);
  return _editorTab;
}
export const getEditorTab = () => _editorTab;

/** Push the current record into the section (and the editor, if open). */
export function syncFramePanel() {
  const rec = getFrameRecord();
  const tpl = findFrameTemplate(FRAME_DEFS, rec.templateId);
  // The editor's Frame tab mirrors the same record.
  if ($('editorFrameTemplate')) $('editorFrameTemplate').value = rec.templateId || '';
  if ($('editorFrameWood')) $('editorFrameWood').value = rec.appearance;
  const th = $('editorFrameThickness');
  if (th) {
    const p = tpl?.params.find((q) => q.name === 'frame_thickness');
    if (p) { th.min = p.min; th.max = p.max; }
    if (document.activeElement !== th) th.value = tpl ? frameParam(FRAME_DEFS, rec, 'frame_thickness') : '';
  }
  for (const id of ['editorFrameThicknessRow', 'editorFrameWoodRow']) if ($(id)) $(id).style.display = tpl ? '' : 'none';
  if ($('frameTemplate')) $('frameTemplate').value = rec.templateId || '';
  if ($('frameBottomZ') && document.activeElement !== $('frameBottomZ')) $('frameBottomZ').value = rec.frameBottomZ;
  if ($('frameAppearance')) $('frameAppearance').value = rec.appearance;
  if ($('frameSettings')) $('frameSettings').style.display = tpl ? '' : 'none';
  if ($('frameSummary')) $('frameSummary').textContent = tpl ? `— ${tpl.name.split(' - ').pop()}` : '— none';

  const warn = $('frameFitWarning');
  if (warn) {
    const fit = tpl ? frameFit(P.widthIn, P.heightIn, frameParam(FRAME_DEFS, rec, 'frame_thickness'),
      frameParam(FRAME_DEFS, rec, 'boundingboxoffset')) : { ok: true };
    warn.style.display = fit.ok ? 'none' : '';
    warn.textContent = fit.ok ? '' : `Board too small for this frame: the safe zone is ${fit.safeZoneIn.toFixed(2)} in `
      + `but the frame needs more than ${fit.requiredIn.toFixed(2)} in.`;
  }
  if (typeof window !== 'undefined' && window.svgEditor) drawFrameProfile(window.svgEditor);
  AppState.preview?.refreshFrame?.(); // F7: the 3D trimmed panel + wood bars, live
}

export function initFramePanel() {
  setFrameProfileProvider(() => ({ defs: FRAME_DEFS, record: getFrameRecord() }));
  // F7: the 3D preview asks with the grid size it is actually drawing.
  AppState.preview?.setFrameProvider?.((W, H) => frameSolidSpec(FRAME_DEFS, getFrameRecord(), { widthIn: W, heightIn: H }));
  const tplSel = $('frameTemplate');
  const woodSel = $('frameAppearance');
  if (!tplSel || !woodSel) return;

  for (const sel of [tplSel, $('editorFrameTemplate')].filter(Boolean)) {
    sel.appendChild(_option('', 'None'));
    for (const t of FRAME_DEFS.templates || []) sel.appendChild(_option(t.id, t.name.split(' - ').pop()));
  }
  for (const sel of [woodSel, $('editorFrameWood')].filter(Boolean)) {
    for (const w of FRAME_DEFS.appearance?.options || []) sel.appendChild(_option(w, w.replace(/^3D /, '')));
  }
  $('editorFrameTemplate')?.addEventListener('change', (e) => { setFrameRecord({ templateId: e.target.value || null, params: {} }); syncFramePanel(); });
  $('editorFrameWood')?.addEventListener('change', (e) => { setFrameRecord({ appearance: e.target.value }); syncFramePanel(); });
  $('editorFrameThickness')?.addEventListener('change', (e) => {
    const rec = getFrameRecord();
    setFrameRecord({ params: { ...rec.params, frame_thickness: parseFloat(e.target.value) } });
    syncFramePanel();
  });
  $('editorTabFrame')?.addEventListener('click', () => setEditorTab('frame'));
  $('editorTabArtwork')?.addEventListener('click', () => setEditorTab('artwork'));
  // Two doors, one room: "Edit frame shape" opens the editor on the Frame tab,
  // "Open SVG Editor" (the same button) on the Artwork tab.
  $('btnStampEdit')?.addEventListener('click', () => { setEditorTab(_openEditorOn || 'artwork'); _openEditorOn = null; });

  tplSel.addEventListener('change', () => { setFrameRecord({ templateId: tplSel.value || null, params: {} }); syncFramePanel(); });
  woodSel.addEventListener('change', () => { setFrameRecord({ appearance: woodSel.value }); syncFramePanel(); });
  $('frameBottomZ')?.addEventListener('change', (e) => { setFrameRecord({ frameBottomZ: parseFloat(e.target.value) }); syncFramePanel(); });
  $('btnEditFrameShape')?.addEventListener('click', () => { _openEditorOn = 'frame'; $('btnStampEdit')?.click(); });
  // The fit warning (and the editor's profile) depend on the board size.
  for (const id of ['widthIn', 'heightIn']) $(id)?.addEventListener('change', () => syncFramePanel());
  syncFramePanel();
}

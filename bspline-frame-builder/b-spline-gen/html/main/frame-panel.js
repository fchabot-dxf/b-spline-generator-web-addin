/**
 * frame-panel.js — FB-APP S2 (F6): the sidebar FRAME section (design §3.1).
 *
 * The frame's solid-extrusion settings + template choice. Every option comes
 * from the generated frame definition (templates, the 5 declared woods, the
 * frame-bottom Z default); every write goes through setFrameRecord (the one
 * normalizing gate). It also registers the editor's cut-profile provider, so
 * the editor draws the board as the chosen frame's cut profile.
 *
 * "Edit frame shape" opens the SVG editor for now: gate 3.2 = (c), no shape
 * handles in this stage (the shape comes from the template's declared params).
 */
import { FRAME_DEFS, findFrameTemplate, getFrameRecord, setFrameRecord, frameParam } from '../core/frame-record.js';
import { P } from '../core/state.js';
import { setFrameProfileProvider, drawFrameProfile, frameFit, frameSolidSpec } from '../editor/editor-frame-profile.js';
import { AppState } from './app-state.js';

const $ = (id) => document.getElementById(id);

function _option(value, label) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  return o;
}

/** Push the current record into the section (and the editor, if open). */
export function syncFramePanel() {
  const rec = getFrameRecord();
  const tpl = findFrameTemplate(FRAME_DEFS, rec.templateId);
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

  tplSel.appendChild(_option('', 'None'));
  for (const t of FRAME_DEFS.templates || []) tplSel.appendChild(_option(t.id, t.name.split(' - ').pop()));
  for (const w of FRAME_DEFS.appearance?.options || []) woodSel.appendChild(_option(w, w.replace(/^3D /, '')));

  tplSel.addEventListener('change', () => { setFrameRecord({ templateId: tplSel.value || null, params: {} }); syncFramePanel(); });
  woodSel.addEventListener('change', () => { setFrameRecord({ appearance: woodSel.value }); syncFramePanel(); });
  $('frameBottomZ')?.addEventListener('change', (e) => { setFrameRecord({ frameBottomZ: parseFloat(e.target.value) }); syncFramePanel(); });
  $('btnEditFrameShape')?.addEventListener('click', () => $('btnStampEdit')?.click());
  // The fit warning (and the editor's profile) depend on the board size.
  for (const id of ['widthIn', 'heightIn']) $(id)?.addEventListener('change', () => syncFramePanel());
  syncFramePanel();
}

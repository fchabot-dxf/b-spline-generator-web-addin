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
import { FRAME_DEFS, findFrameTemplate, getFrameRecord, setFrameRecord, frameParam, framePayload } from '../core/frame-record.js';
import { P, isFusionMode } from '../core/state.js';
import { setFusionStatus } from '../core/fusion-bridge.js';
import { setFrameProfileProvider, drawFrameProfile, frameFit, frameSolidSpec, setEditorFocus } from '../editor/editor-frame-profile.js';
import { AppState } from './app-state.js';
import { handleDragPatch, frameSeedGeometry } from '../editor/frame-handles.js';
import { frameCutProfile } from '../editor/editor-frame-profile.js';

/** F9: how close (screen px) a press must land to grab a frame shape handle (finger-sized). */
export const HANDLE_HIT_PX = 16;

const $ = (id) => document.getElementById(id);

/** The frame's numeric param fields: field id -> the template param it edits
 *  (limits from the generated definition), plus the row hidden with no frame. */
export const FRAME_PARAM_FIELDS = Object.freeze([
  { id: 'editorFrameThickness', param: 'frame_thickness', row: 'editorFrameThicknessRow' },
  { id: 'frameTrimOffset', param: 'boundingboxoffset' }, // F9: "Trim offset (in)"
]);

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
  const ed = typeof window !== 'undefined' ? window.svgEditor : null;
  setEditorFocus(ed, _editorTab);
  if (ed) drawFrameProfile(ed); // F9: the shape handles show in the Frame tab only
  return _editorTab;
}
export const getEditorTab = () => _editorTab;

/**
 * FB-APP S5 (F10): the [Send frame] button's state, from the record. The
 * "needs a B-spline body" check is the add-in's (it knows the document) and
 * comes back in `frame_result`.
 */
export function frameSendState(defs, record, inFusion) {
  if (!findFrameTemplate(defs, record?.templateId)) return { enabled: false, hint: 'Pick a frame template to send it.' };
  if (!inFusion) return { enabled: false, hint: 'Open this app from the Fusion add-in to send the frame.' };
  const seeded = Object.keys(record.seeds || {}).length;
  return { enabled: true, hint: seeded
    ? `Sends the frame to Fusion with your ${seeded} handle shape change(s) (replaces the previous frame). Send B-spline first.`
    : 'Sends the frame to Fusion (replaces the previous frame). Send B-spline first.' };
}

/** Press [Send frame]: the frame record as the payload [Send frame] reads (fb_engine/send_frame.py). */
export function sendFrame() {
  const rec = getFrameRecord();
  const payload = framePayload(FRAME_DEFS, rec);
  if (!payload) return false;
  // F11 option B: seeded handles go as the template's own seed geometry
  if (Object.keys(rec.seeds || {}).length) {
    const prof = frameCutProfile(FRAME_DEFS, rec, { widthIn: P.widthIn, heightIn: P.heightIn });
    payload.seedGeometry = frameSeedGeometry(findFrameTemplate(FRAME_DEFS, rec.templateId), prof, P.widthIn, P.heightIn);
  }
  adsk.fusionSendData('send_frame', JSON.stringify(payload));
  setFusionStatus('Sending the frame to Fusion...', 'busy');
  return true;
}

/** The add-in's reply to [Send frame]. */
export function onFrameResult(data) {
  let r = {};
  try { r = typeof data === 'string' ? JSON.parse(data || '{}') : (data || {}); } catch (_) { r = { ok: false, error: 'Unreadable reply from Fusion.' }; }
  if (!r.ok) { setFusionStatus(r.error || 'The frame was not sent.', 'warn'); return r; }
  const notApplied = r.seeds && r.seeds.count && !r.seeds.applied ? ` (${r.seeds.count} handle change(s) not applied)` : '';
  setFusionStatus(`Frame built in Fusion: ${r.frame}${notApplied}`, notApplied ? 'warn' : 'ok');
  return r;
}

/** Push the current record into the section (and the editor, if open). */
export function syncFramePanel() {
  const rec = getFrameRecord();
  const tpl = findFrameTemplate(FRAME_DEFS, rec.templateId);
  // The editor's Frame tab mirrors the same record.
  if ($('editorFrameTemplate')) $('editorFrameTemplate').value = rec.templateId || '';
  if ($('editorFrameWood')) $('editorFrameWood').value = rec.appearance;
  for (const f of FRAME_PARAM_FIELDS) {
    const el = $(f.id);
    if (!el) continue;
    const p = tpl?.params.find((q) => q.name === f.param);
    for (const k of ['min', 'max']) { if (p && p[k] != null) el[k] = p[k]; else el.removeAttribute(k); }
    if (document.activeElement !== el) el.value = tpl ? frameParam(FRAME_DEFS, rec, f.param) : '';
    if (f.row && $(f.row)) $(f.row).style.display = tpl ? '' : 'none';
  }
  if ($('editorFrameWoodRow')) $('editorFrameWoodRow').style.display = tpl ? '' : 'none';
  if ($('frameTemplate')) $('frameTemplate').value = rec.templateId || '';
  if ($('frameBottomZ') && document.activeElement !== $('frameBottomZ')) $('frameBottomZ').value = rec.frameBottomZ;
  if ($('frameAppearance')) $('frameAppearance').value = rec.appearance;
  if ($('frameSettings')) $('frameSettings').style.display = tpl ? '' : 'none';
  if ($('frameSummary')) $('frameSummary').textContent = tpl ? `— ${tpl.name.split(' - ').pop()}` : '— none';
  const send = frameSendState(FRAME_DEFS, rec, isFusionMode);
  if ($('btnSendFrame')) $('btnSendFrame').disabled = !send.enabled;
  if ($('frameSendHint')) $('frameSendHint').textContent = send.hint;

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

/**
 * F9: drag a frame shape handle in the Frame tab. The shield over the canvas is
 * the Frame tab's own pointer surface (the artwork stays unreachable); a press
 * within HANDLE_HIT_PX of a handle grabs it, each move writes the record through
 * the handle's declared binding and redraws the editor profile, and the release
 * refreshes everything else (the 3D preview) once.
 */
function _wireHandleDrag() {
  const shield = $('editorFrameShield');
  if (!shield) return;
  let dragKey = null;
  const editor = () => (typeof window !== 'undefined' ? window.svgEditor : null);
  shield.addEventListener('pointerdown', (e) => {
    const ed = editor();
    if (!ed || !ed._frameProfile || !(ed._frameHandles || []).length) return;
    const pt = ed._getMousePoint(e);
    const edge = ed._getMousePoint({ clientX: e.clientX + HANDLE_HIT_PX, clientY: e.clientY });
    let best = null, bestD = Infinity;
    for (const h of ed._frameHandles) {
      const d = Math.hypot(h.anchor.x - pt.x, h.anchor.y - pt.y);
      if (d < bestD) { bestD = d; best = h; }
    }
    if (!best || bestD > Math.abs(edge.x - pt.x)) return;
    dragKey = best.key;
    if (shield.setPointerCapture && e.pointerId != null) { try { shield.setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ } }
    e.preventDefault();
  });
  shield.addEventListener('pointermove', (e) => {
    if (!dragKey) return;
    const ed = editor();
    const h = (ed?._frameHandles || []).find((q) => q.key === dragKey);
    if (!h) return;
    setFrameRecord(handleDragPatch(getFrameRecord(), h, ed._getMousePoint(e), ed._frameProfile.region));
    drawFrameProfile(ed);
    e.preventDefault();
  });
  const end = () => { if (!dragKey) return; dragKey = null; syncFramePanel(); };
  shield.addEventListener('pointerup', end);
  shield.addEventListener('pointercancel', end);
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
  for (const f of FRAME_PARAM_FIELDS) {
    $(f.id)?.addEventListener('change', (e) => {
      const rec = getFrameRecord();
      setFrameRecord({ params: { ...rec.params, [f.param]: parseFloat(e.target.value) } });
      syncFramePanel();
    });
  }
  $('editorTabFrame')?.addEventListener('click', () => setEditorTab('frame'));
  $('editorTabArtwork')?.addEventListener('click', () => setEditorTab('artwork'));
  // Two doors, one room: "Edit frame shape" opens the editor on the Frame tab,
  // "Open SVG Editor" (the same button) on the Artwork tab.
  $('btnStampEdit')?.addEventListener('click', () => { setEditorTab(_openEditorOn || 'artwork'); _openEditorOn = null; });

  tplSel.addEventListener('change', () => { setFrameRecord({ templateId: tplSel.value || null, params: {} }); syncFramePanel(); });
  woodSel.addEventListener('change', () => { setFrameRecord({ appearance: woodSel.value }); syncFramePanel(); });
  $('frameBottomZ')?.addEventListener('change', (e) => { setFrameRecord({ frameBottomZ: parseFloat(e.target.value) }); syncFramePanel(); });
  $('btnEditFrameShape')?.addEventListener('click', () => { _openEditorOn = 'frame'; $('btnStampEdit')?.click(); });
  $('btnSendFrame')?.addEventListener('click', () => sendFrame());
  _wireHandleDrag();
  // The fit warning (and the editor's profile) depend on the board size.
  for (const id of ['widthIn', 'heightIn']) $(id)?.addEventListener('change', () => syncFramePanel());
  syncFramePanel();
}

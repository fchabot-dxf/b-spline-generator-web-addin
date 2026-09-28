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
import { FRAME_DEFS, findFrameTemplate, getFrameRecord, setFrameRecord, frameParam, framePayload, panelLipRange } from '../core/frame-record.js';
import { P, isFusionMode } from '../core/state.js';
import { setFusionStatus } from '../core/fusion-bridge.js';
import { setFrameProfileProvider, setFrameClearHandler, drawFrameProfile, frameFit, frameSolidSpec, setEditorFocus } from '../editor/editor-frame-profile.js';
import { AppState } from './app-state.js';
import { handleDragPatch, frameSeedGeometry, generateFrameSeeds } from '../editor/frame-handles.js';
import { nextSeed } from '../editor/editor-lattice-pattern.js';
import { frameCutProfile } from '../editor/editor-frame-profile.js';
import { setHandleCursor, paramHandleCursorAxis } from '../editor/editor-transform-handles.js';
import { hitTestArcGrip } from '../editor/editor-shape-lattice-interaction.js';
import { syncDrawerForMode } from '../editor/editor-drawer.js';

/** F9: how close (screen px) a press must land to grab a frame shape handle (finger-sized). */
export const HANDLE_HIT_PX = 16;

// ── F13: the Frame tab's own undo (generate, a handle drag and a template change
// are each one step). The editor's artwork undo is locked in the Frame tab (F8),
// so the frame's steps never mix with the artwork's.
const _frameHistory = [];
let _undoKeyWired = false;
const _clone = (r) => JSON.parse(JSON.stringify(r));

/** Remember the current frame record as one undoable step. */
export function pushFrameHistory() {
  _frameHistory.push(_clone(getFrameRecord()));
  _syncUndo();
}

/** Restore the frame record before the last step; false when there is none. */
export function undoFrame() {
  const prev = _frameHistory.pop();
  if (!prev) return false;
  setFrameRecord(prev);
  syncFramePanel();
  _syncUndo();
  return true;
}
export const frameHistoryDepth = () => _frameHistory.length;
function _syncUndo() { if ($('editorFrameUndo')) $('editorFrameUndo').disabled = _frameHistory.length === 0; }

/** F13 [Generate]: a new seeded random frame shape, written as the handles' seeds. */
export function generateFrame(seed = nextSeed()) {
  const rec = getFrameRecord();
  const tpl = findFrameTemplate(FRAME_DEFS, rec.templateId);
  if (!tpl) return null;
  const region = frameCutProfile(FRAME_DEFS, rec, { widthIn: P.widthIn, heightIn: P.heightIn }).region;
  pushFrameHistory();
  setFrameRecord({ seeds: generateFrameSeeds(tpl, region, seed, frameParam(FRAME_DEFS, rec, 'frame_thickness')), genSeed: seed });
  syncFramePanel();
  return getFrameRecord();
}

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
  // Fred: "the tab should be the toggle" -- the phone drawer follows this switch (Frame: frame settings only).
  if (ed) syncDrawerForMode(ed, ed._currentMode);
  // T81 item 1: leaving the Frame tab drops its handles entirely (below) --
  // a hover/grab cursor read from the OLD tab must not stick around either.
  if (!frame) _clearFrameHover();
  if (ed) drawFrameProfile(ed); // F9: the shape handles show in the Frame tab only
  return _editorTab;
}
export const getEditorTab = () => _editorTab;

/**
 * FB-APP S5 (F10): the [Send frame] button's state, from the record. The
 * "needs a B-spline body" check is the add-in's (it knows the document) and
 * comes back in `frame_result` -- a real failure already surfaces through
 * onFrameResult's own setFusionStatus call below, the existing status line,
 * so it isn't re-explained here.
 *
 * F26 item 2 (Fred, screenshot: "remove these labels"): `hint` used to
 * explain what the button DOES even while it's enabled and ready (a
 * standing caption, always visible) -- now it's empty whenever the button
 * can be pressed; only the two DISABLED cases (an actual reason it can't
 * be) still carry one, since those are the ones a person needs telling.
 */
export function frameSendState(defs, record, inFusion) {
  if (!findFrameTemplate(defs, record?.templateId)) return { enabled: false, hint: 'Pick a frame template to send it.' };
  if (!inFusion) return { enabled: false, hint: 'Open this app from the Fusion add-in to send the frame.' };
  return { enabled: true, hint: '' };
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
  if ($('framePanelLip')) { // F22: its declared range follows the Trim offset
    const r = panelLipRange(FRAME_DEFS, rec);
    $('framePanelLip').min = r.min;
    if (Number.isFinite(r.max)) $('framePanelLip').max = r.max;
    if (document.activeElement !== $('framePanelLip')) $('framePanelLip').value = rec.panelLip;
  }
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
/**
 * F9 handle drags, F18 (FRAME-TAB-ZOOM, Fred on his phone: no pinch/pan in the Frame tab): the shield no longer
 * swallows every gesture. It is inert (pointer-events:none), and a CAPTURE listener on its parent (the canvas
 * container) takes ONLY a pointerdown that starts on a frame handle. Everything else reaches the editor, which in
 * the Frame tab (artwork locked) pans on one finger and pinch-zooms on two (editor-interaction.js).
 */
/** F27 item 2 follow-up: a Frame handle's cursor axis (paramHandleCursorAxis: its drag axis, or 'plain' for a radius). */
function _frameHandleAxis(ed, key) {
  const h = key && ed ? (ed._frameHandles || []).find((q) => q.key === key) : null;
  return paramHandleCursorAxis(h);
}

/** F9 hit-test, factored out (T81 item 1) so pointerdown's grab check and
 *  the idle-hover check below share the ONE nearest-handle-within-
 *  HANDLE_HIT_PX rule rather than two copies. F27 item 2 arc pull (Fred: "more
 *  intuitive to pull the arc than the arc center"): the handle MARKS (squares,
 *  radius dots) first -- a position square in reach wins -- then a radius
 *  param's ARC, either side, within the same HANDLE_HIT_PX. Returns
 *  `{ handle, side }` (side 1 = the mirrored left arc) or null. */
function _hitFrameHandle(ed, clientX, clientY) {
  const pt = ed._getMousePoint({ clientX, clientY });
  const edge = ed._getMousePoint({ clientX: clientX + HANDLE_HIT_PX, clientY });
  const tol = Math.abs(edge.x - pt.x);
  let best = null, bestD = Infinity;
  for (const h of ed._frameHandles || []) {
    const d = Math.hypot(h.anchor.x - pt.x, h.anchor.y - pt.y);
    if (d < bestD) { bestD = d; best = h; }
  }
  if (best && bestD <= tol) return { handle: best, side: 0 };
  return hitTestArcGrip(ed._frameHandles, pt, tol);
}

// T81 item 1: module scope (not inside _wireHandleDrag's own closure) so
// setEditorTab, below, can clear it when the Frame tab is left -- same
// "a mode/tab switch invalidates a stale hover" rule editor-ui.js's setMode
// already applies to its own snap/grid hover state.
let _frameHoverKey = null;
function _clearFrameHover() {
  if (_frameHoverKey === null) return;
  _frameHoverKey = null;
  const ed = typeof window !== 'undefined' ? window.svgEditor : null;
  if (ed) ed._frameHandleHover = null;
  setHandleCursor(null);
}

function _wireHandleDrag() {
  const shield = $('editorFrameShield');
  if (!shield || !shield.parentElement) return;
  shield.style.pointerEvents = 'none';
  const surface = shield.parentElement;
  let dragKey = null;
  let dragCtx = {}; // F27 item 2 arc pull: { side, grab } for the whole drag
  // Fred: "Zooming shouldn't move geometry inadvertently". The finger that grabbed the handle
  // (only ITS moves drag it -- a pinch's second finger used to drag it too), the record as the
  // drag found it (restored if a second finger turns the gesture into a pinch), and that
  // finger's last position (handed to the editor so the pinch it joins has both fingers).
  let dragPointerId = null;
  let dragStartRecord = null;
  let dragLastPt = null;
  const editor = () => (typeof window !== 'undefined' ? window.svgEditor : null);
  const inFrameTab = () => _editorTab === 'frame';
  // T81 item 1: hover state lives on the editor (ed._frameHandleHover/Drag)
  // so editor-frame-profile.js's own draw loop -- a different module, no
  // access to this closure -- can read it; `_frameHoverKey` is just this
  // listener's (and setEditorTab's) own "did it change" guard, so an
  // unmoved hover doesn't redraw the whole frame profile every mousemove.
  const setHover = (ed, key) => {
    if (_frameHoverKey === key) return;
    _frameHoverKey = key;
    if (ed) { ed._frameHandleHover = key; if (ed._frameProfile) drawFrameProfile(ed); }
    setHandleCursor(key ? 'hover' : null, _frameHandleAxis(ed, key));
  };
  surface.addEventListener('pointerdown', (e) => {
    if (!inFrameTab()) return;
    if (dragKey && e.pointerId !== dragPointerId) {
      // A second finger during a handle drag = a pinch: put the frame back, end the drag, and
      // let this press through to the editor with the first finger registered, so it zooms.
      const ed = editor();
      setFrameRecord(dragStartRecord);
      dragKey = null;
      dragCtx = {};
      if (ed) {
        ed._frameHandleDrag = null;
        if (ed._activePointers && dragLastPt) ed._activePointers.set(dragPointerId, dragLastPt);
        if (ed._frameProfile) drawFrameProfile(ed);
      }
      dragPointerId = null;
      setHandleCursor(null);
      syncFramePanel();
      return;
    }
    const ed = editor();
    if (!ed || !ed._frameProfile || !(ed._frameHandles || []).length) return;
    const hit = _hitFrameHandle(ed, e.clientX, e.clientY);
    if (!hit) return;
    const best = hit.handle;
    dragKey = best.key;
    dragCtx = { side: hit.side, grab: { value: best.value } };
    dragPointerId = e.pointerId;
    dragStartRecord = JSON.parse(JSON.stringify(getFrameRecord()));
    dragLastPt = { x: e.clientX, y: e.clientY };
    ed._frameHandleDrag = dragKey; // T81 item 1: the SAME hover/press look for the whole drag
    setHandleCursor('active', paramHandleCursorAxis(best));
    drawFrameProfile(ed); // show it immediately -- a bare press with no movement yet (Touch has no hover at all) must not wait for the first move tick
    pushFrameHistory(); // F13: a tweak is one undoable step
    if (surface.setPointerCapture && e.pointerId != null) { try { surface.setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ } }
    e.preventDefault();
    e.stopPropagation(); // the editor never sees a handle drag
  }, true);
  surface.addEventListener('pointermove', (e) => {
    const ed = editor();
    if (!dragKey) {
      // T81 item 1: idle hover -- only while the Frame tab's own handles are live.
      setHover(ed, inFrameTab() && ed && ed._frameProfile ? (_hitFrameHandle(ed, e.clientX, e.clientY)?.handle.key ?? null) : null);
      return;
    }
    if (e.pointerId !== dragPointerId) return; // another finger (a pinch): never drags the handle
    dragLastPt = { x: e.clientX, y: e.clientY };
    const h = (ed?._frameHandles || []).find((q) => q.key === dragKey);
    if (!h) return;
    setFrameRecord(handleDragPatch(getFrameRecord(), h, ed._getMousePoint(e), ed._frameProfile.region, dragCtx));
    drawFrameProfile(ed);
    e.preventDefault();
    e.stopPropagation();
  }, true);
  const end = (e) => {
    if (!dragKey || e.pointerId !== dragPointerId) return;
    dragKey = null;
    dragPointerId = null;
    dragCtx = {};
    const ed = editor();
    if (ed) {
      ed._frameHandleDrag = null;
      if (ed._frameProfile) drawFrameProfile(ed); // T81 item 1: drop the "active" look immediately, don't wait for the next move
    }
    setHandleCursor(_frameHoverKey ? 'hover' : null, _frameHandleAxis(ed, _frameHoverKey)); // likely still hovering the handle just released
    e.stopPropagation();
    syncFramePanel();
  };
  surface.addEventListener('pointerup', end, true);
  surface.addEventListener('pointercancel', end, true);
}

export function initFramePanel() {
  setFrameProfileProvider(() => ({ defs: FRAME_DEFS, record: getFrameRecord() }));
  // H20 item 3: Clear, when the Frame tab is active, resets the frame to
  // "None" — same reset a manual template-dropdown-to-"None" change does
  // (setFrameRecord({templateId:null, params:{}})), with its own
  // pushFrameHistory() step so Ctrl+Z on the Frame tab undoes it.
  setFrameClearHandler(() => {
    pushFrameHistory();
    setFrameRecord({ templateId: null, params: {} });
    syncFramePanel();
  });
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
  $('editorFrameTemplate')?.addEventListener('change', (e) => { pushFrameHistory(); setFrameRecord({ templateId: e.target.value || null, params: {} }); syncFramePanel(); });
  $('editorFrameGenerate')?.addEventListener('click', () => generateFrame());
  $('editorFrameUndo')?.addEventListener('click', () => undoFrame());
  // Ctrl/Cmd+Z in the Frame tab undoes the FRAME (the artwork's undo is locked there, F8)
  if (!_undoKeyWired) { // once per page (initFramePanel may run again, e.g. in tests)
    _undoKeyWired = true;
    window.addEventListener('keydown', (e) => {
      if (_editorTab !== 'frame' || !(e.ctrlKey || e.metaKey) || e.shiftKey || (e.key !== 'z' && e.key !== 'Z')) return;
      e.preventDefault();
      undoFrame();
    });
  }
  _syncUndo();
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

  tplSel.addEventListener('change', () => { pushFrameHistory(); setFrameRecord({ templateId: tplSel.value || null, params: {} }); syncFramePanel(); });
  woodSel.addEventListener('change', () => { setFrameRecord({ appearance: woodSel.value }); syncFramePanel(); });
  $('frameBottomZ')?.addEventListener('change', (e) => { setFrameRecord({ frameBottomZ: parseFloat(e.target.value) }); syncFramePanel(); });
  $('framePanelLip')?.addEventListener('change', (e) => { setFrameRecord({ panelLip: parseFloat(e.target.value) }); syncFramePanel(); });
  $('btnEditFrameShape')?.addEventListener('click', () => { _openEditorOn = 'frame'; $('btnStampEdit')?.click(); });
  $('btnSendFrame')?.addEventListener('click', () => sendFrame());
  _wireHandleDrag();
  // The fit warning (and the editor's profile) depend on the board size.
  for (const id of ['widthIn', 'heightIn']) $(id)?.addEventListener('change', () => syncFramePanel());
  syncFramePanel();
}

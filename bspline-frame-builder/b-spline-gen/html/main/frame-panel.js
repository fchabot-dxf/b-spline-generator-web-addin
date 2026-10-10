/**
 * frame-panel.js — FB-APP S2 (F6): the sidebar FRAME section (design §3.1).
 *
 * The frame's solid-extrusion settings + template choice. Every option comes
 * from the generated frame definition (templates, the 5 declared woods, the
 * frame-bottom Z default); every write goes through setFrameRecord (the one
 * normalizing gate). It also registers the editor's cut-profile provider, so
 * the editor draws the board as the chosen frame's cut profile.
 *
 * F8 + F35 item 10: the editor's [Frame | Artwork | Photo | Brick] tabs. "Edit frame shape" opens the
 * editor on the Frame tab (the frame's template + params + wood, with the live cut profile; gate
 * 3.2 = (c): numeric fields, no on-canvas handles), "Open SVG Editor" on the Artwork tab. In the Frame
 * tab the artwork is view-only: a shield over the canvas stops every tool, the editor's artwork lock
 * stops every shortcut, and the focus rule dims whichever side is not being edited (editor-frame-
 * profile.js setEditorFocus; display only). The actual N-way tab switch (buttons, panels, toolbars)
 * is main/editor-tabs.js's own declared registry -- this file only keeps its OWN Frame-specific
 * reaction to a switch (below, the 'editorTabChanged' listener), same as photo-panel.js/
 * brick-panel.js keep theirs.
 */
import { FRAME_DEFS, findFrameTemplate, getFrameRecord, setFrameRecord, frameParam, framePayload, panelLipRange } from '../core/frame-record.js';
import { P, isFusionMode } from '../core/state.js';
import { recordStep } from '../core/history.js';
import { inEditor3dAction } from '../core/in-editor-3d.js';
import { setFusionStatus } from '../core/fusion-bridge.js';
import { withLoadingStageShownFirst } from '../core/loading-signal.js';
import { setFrameProfileProvider, setFrameClearHandler, drawFrameProfile, frameFit, frameSolidSpec, setEditorFocus } from '../editor/editor-frame-profile.js';
import { setEditorTab as switchEditorTab, getEditorTab } from './editor-tabs.js';
import { AppState } from './app-state.js';
import { deferToHold } from '../core/engine/scheduler.js';
import { handleDragPatch, frameSeedGeometry, generateFrameSeeds, generateValidFrameSeeds } from '../editor/frame-handles.js';
import { nextSeed } from '../editor/editor-lattice-pattern.js';
import { frameCutProfile, frameGenerateIsValid, frameInnerProfile, frameMiters, miterStaysInsideWood, outlineHasUndercut, mitersCollide, blankWidthIn, formatBlankWidthIn } from '../editor/editor-frame-profile.js';
import { setHandleCursor, paramHandleCursorAxis } from '../editor/editor-transform-handles.js';
import { hitTestArcGrip } from '../editor/editor-shape-lattice-interaction.js';
import { inputProfileFor } from '../editor/editor-input.js';
import { FRAME_HANDLE_RADIUS } from '../editor/editor-frame-profile.js';
import { insetWindowGeometry, insetWindowOuterRect } from '../core/inset-window.js';
import { mountIconSelect, refreshIconSelect } from './icon-select.js';
import { templateIconSvg, boardOutlineIconSvg } from '../editor/frame-template-icon.js';

/** Fred (turn 207): the template picker's no-frame choice -- the board's own rectangle (value '' = no frame
 *  shape, unchanged underneath), labelled and drawn as such instead of a 'None' text cell. */
export const NO_FRAME_CHOICE = Object.freeze({ value: '', label: 'Rectangle' });

/** F9: how close (screen px) a press must land to grab a frame shape handle -- the FLOOR (a mouse). Audit
 *  (batch 1): the reach is now the pointer's own, the same `handlePx * 1.8` Shape Lattice's identical handles
 *  use (~25 px for a finger), and never less than the drawn dot itself when zoomed in (`_frameHandleHitPx`). */
export const HANDLE_HIT_PX = 16;
function _frameHandleHitPx(ed, pointerType) {
  const onePx = Math.abs(ed._getMousePoint({ clientX: 1, clientY: 0 }).x - ed._getMousePoint({ clientX: 0, clientY: 0 }).x) || 1;
  return Math.max(HANDLE_HIT_PX, inputProfileFor(pointerType).handlePx * 1.8, FRAME_HANDLE_RADIUS / onePx + 4);
}

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
  setFrameRecord(prev, { restored: true }); // audit B9: the bricks' re-lay then amends, it adds no editor step
  syncFramePanel();
  _syncUndo();
  return true;
}
export const frameHistoryDepth = () => _frameHistory.length;

/** Audit (batch 3): THE way a Frame-tab control edits the frame -- one undo step, the write, the panel sync.
 *  Thickness / Trim offset / Wood / Bottom Z / Panel lip used to write with no step (a Frame Undo then reverted
 *  them together with the previous handle drag, or couldn't undo them at all). */
export function editFrame(patch, label) {
  // the 'frame' stage on screen first (core/loading-signal.js): a frame edit blocks up to ~2 s on a phone
  return withLoadingStageShownFirst('frame', () => editFrameNow(patch, label));
}
/** The same edit, NOW (no stage): for a caller that reads the result in the same breath -- a Clear records the steps
 *  and the frame it left (editor-clear-menu.js undoLastClear compares them), Delete frame snapshots the frame after.
 *  MEASURED (the gate's clear row): through the deferred editFrame, Clear All's one undo restored neither the frame
 *  nor the photo (it recorded 0 frame steps and the old frame, then refused as "changed since"). */
/** In the sidebar it is also ONE global step carrying the frame transition (core/history.js recordStep), so the main
 *  Undo / Ctrl+Z puts the frame back (Fred: "changing wood frame doesn't make an undo step"); inside the editor only the
 *  Frame tab's own undo records it. */
export function editFrameNow(patch, label = 'Frame change') {
  recordStep(label, ['frame'], () => {
    pushFrameHistory();
    setFrameRecord(patch);
    syncFramePanel();
  });
}
function _syncUndo() { if ($('editorFrameUndo')) $('editorFrameUndo').disabled = _frameHistory.length === 0; }


/** F13 [Generate]: a new seeded random frame shape, written as the handles' seeds. */
export function generateFrame(seed = nextSeed()) {
  return withLoadingStageShownFirst('frame', () => _generateFrameNow(seed)); // the 'frame' stage on screen first
}
function _generateFrameNow(seed) {
  const rec = getFrameRecord();
  const tpl = findFrameTemplate(FRAME_DEFS, rec.templateId);
  if (!tpl) return null;
  const region = frameCutProfile(FRAME_DEFS, rec, { widthIn: P.widthIn, heightIn: P.heightIn }).region;
  const t = frameParam(FRAME_DEFS, rec, 'frame_thickness');
  // Generate must never produce a broken frame (Fred): editor-frame-profile.js frameGenerateIsValid, the declared rule.
  const seeds = generateValidFrameSeeds(tpl, region, seed, t, frameGenerateIsValid(FRAME_DEFS, rec, { widthIn: P.widthIn, heightIn: P.heightIn }, tpl, region, t));
  pushFrameHistory();
  setFrameRecord({ seeds, genSeed: seed });
  syncFramePanel();
  return getFrameRecord();
}

const $ = (id) => document.getElementById(id);

/** Advisor review on T82 item 5 (a 7/3 board-third default showed as "2.3333333333333"): round a numeric
 *  field's DISPLAYED value to 3 decimals -- the record itself keeps full precision, only `el.value` is ever
 *  touched here. Non-finite input passes through unchanged (the field's own "nothing to show" cases, e.g.
 *  no template selected, already write '' or similar, not a number). */
const _round3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v);

/** The frame's numeric param fields: field id -> the template param it edits
 *  (limits from the generated definition), plus the row hidden with no frame. */
export const FRAME_PARAM_FIELDS = Object.freeze([
  { id: 'frameThickness', param: 'frame_thickness', row: 'frameThicknessRow' },
  // T82 item 4: the SAME frame_thickness, a second field in the Frame tab's own editor panel (Fred: a
  // visible-2D-drawing setting belongs there too, same rule as the inset window) -- this generic
  // read/write loop is the ENTIRE sync (both directions), no extra wiring needed for the second field.
  { id: 'editorFrameThickness', param: 'frame_thickness' },
  { id: 'frameTrimOffset', param: 'boundingboxoffset' }, // F9: "Trim offset (in)"
]);

/** T82 item 5: two views of the SAME insetWindow record (the sidebar's own fields, and #editorFramePanel's own
 *  -- T82 item 4's own "a second view, not a second setting" pattern, extended to a compound field: there is
 *  no single param to loop over the way FRAME_PARAM_FIELDS does, so this declares the two ID sets instead. */
const INSET_WINDOW_FIELD_GROUPS = Object.freeze([
  { toggle: 'frameInsetWindowToggle', fields: 'frameInsetWindowFields',
    posX: 'frameWindowPosX', posY: 'frameWindowPosY', sizeW: 'frameWindowSizeW', sizeH: 'frameWindowSizeH' },
  { toggle: 'editorFrameInsetWindowToggle', fields: 'editorFrameInsetWindowFields',
    posX: 'editorWindowPosX', posY: 'editorWindowPosY', sizeW: 'editorWindowSizeW', sizeH: 'editorWindowSizeH' },
]);

function _option(value, label) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  return o;
}

/** F29 item 1: the template `<select>`s only ever OFFER the non-hidden templates (initFramePanel), so a record
 *  already on a hidden one (an existing saved project, not a fresh pick) needs its own option added back just to
 *  display correctly -- removed again once the record moves off it, so it is never left sitting there pickable. */
function _syncTemplateSelect(sel, templateId) {
  if (!sel) return;
  const stale = sel.querySelector('option[data-hidden-current]');
  if (stale && stale.value !== (templateId || '')) stale.remove();
  if (templateId && !sel.querySelector(`option[value="${templateId}"]`)) {
    const t = FRAME_DEFS.templates.find((x) => x.id === templateId);
    if (t) { const o = _option(t.id, frameLabel(t)); o.dataset.hiddenCurrent = '1'; sel.appendChild(o); }
  }
  sel.value = templateId || '';
  refreshIconSelect(sel); // advisor turn 203: the icon dropdown over it follows a programmatic value too
}

let _openEditorOn = null;
/** Open the editor (btnStampEdit's own path) on `tab` -- the sidebar buttons below and the viewport's [2D]
 *  (main/view-mode-toggle.js) all go through here. */
export function openEditorOn(tab) {
  _openEditorOn = tab;
  // item 41: opening rebuilds the editor document (~1 s blocked at 900 px / CPU x4): its stage paints first
  return withLoadingStageShownFirst('openEditor', () => $('btnStampEdit')?.click());
}
export const OPEN_EDITOR_BUTTONS = Object.freeze([
  { id: 'btnEditFrameShape', tab: 'frame' },
  { id: 'btnEditBricks', tab: 'brick' },
]);

/** A frame template's name as shown: numbered (Fred: "Number the other frames too") -- "Template 1 - Hourglass"
 *  -> "1. Hourglass"; a name without the "Template N - " prefix is shown as is. */
export function frameLabel(tpl) {
  const name = String((tpl && tpl.name) || '');
  const m = name.match(/^Template\s*(\d+)\s*[-–]\s*(.+)$/i);
  return m ? `${m[1]}. ${m[2]}` : name;
}

// F35 item 10: the actual N-way button/panel/toolbar switch is editor-tabs.js's own declared
// registry (imported above as `switchEditorTab`/`getEditorTab`); this file re-exports both under
// their historical names (tests/frame-tabs.test.js imports them from here) and keeps ONLY its own
// Frame-specific reaction below.
export function setEditorTab(tab) {
  return switchEditorTab(tab);
}
export { getEditorTab };

document.addEventListener('editorTabChanged', (e) => {
  const frame = e.detail.tab === 'frame';
  if ($('editorFrameShield')) $('editorFrameShield').style.display = frame ? '' : 'none';
  const ed = typeof window !== 'undefined' ? window.svgEditor : null;
  setEditorFocus(ed, e.detail.tab);
  // T81 item 1: leaving the Frame tab drops its handles entirely (below) --
  // a hover/grab cursor read from the OLD tab must not stick around either.
  if (!frame) _clearFrameHover();
  if (ed) drawFrameProfile(ed); // F9: the shape handles show in the Frame tab only
});

/** The frame as fb_engine/send_frame.py reads it, or null when no frame is chosen. Fred ("no send frame"): it rides
 *  in the one Send's payload (export-flow.js `frame`); the add-in builds it right after the B-spline body. */
export function frameSendPayload() {
  const rec = getFrameRecord();
  const payload = framePayload(FRAME_DEFS, rec);
  if (!payload) return null;
  // H23 item 42 (ONE build path, declared -- not two maintained separately): every Send carries
  // the CURRENT params' own seed geometry, seeded or not (F11 option B's own mechanism, now used
  // unconditionally). A fresh template pick resets seeds to {} (setFrameRecord's own "a template
  // change resets the seeds" rule, core/frame-record.js) -- Sending right after, with no Generate
  // or handle drag in between, used to skip seedGeometry entirely and fall back to the template's
  // OWN legacy literal/formula construction in Fusion. MEASURED (H23 item 41): that legacy path has
  // its own pre-existing, unrelated defects for T7 (a reflex arc) and T10 (an unsplit miter),
  // neither ever reachable live before because an even earlier bug (item 41, now fixed) always
  // crashed first -- the SEEDED path is the one already tested and fixed end to end (item 40: 8/8
  // live). frameSeedGeometry reads whatever frameCutProfile resolves to (seeded or the template's
  // own default), so this needs no per-template branching: every template's own declared seedMap
  // already covers its default shape, not just a dragged one.
  const prof = frameCutProfile(FRAME_DEFS, rec, { widthIn: P.widthIn, heightIn: P.heightIn });
  payload.seedGeometry = frameSeedGeometry(findFrameTemplate(FRAME_DEFS, rec.templateId), prof, P.widthIn, P.heightIn);
  return payload;
}

/** The frame alone ('send_frame' -- no button any more; the one Send carries the frame). */
export function sendFrame() {
  const payload = frameSendPayload();
  if (!payload) return false;
  adsk.fusionSendData('send_frame', JSON.stringify(payload));
  setFusionStatus('Sending the frame to Fusion...', 'busy');
  return true;
}

/** F26 item 2 (b), Fred ("add a delete frame button"): the frame goes back to none -- template None, the same reset
 *  as a fresh session (the artwork untouched), ONE Frame undo step (editFrame). Inside Fusion it also asks the
 *  add-in to delete the frame Send built ('delete_frame': only the frames fb_engine/send_frame.py tagged, the same
 *  ones a Send replaces); no confirm dialog. */
export function deleteFrame() {
  // item 69 (seat E, measured: the sidebar Undo left the frame deleted): its own GLOBAL undo step, carrying the
  // frame transition (editFrameNow) -- the sidebar's Undo restores the frame (and the 3D follows its re-lay)
  editFrameNow({ templateId: null, params: {} }, 'Delete frame');
  if (isFusionMode) {
    try {
      adsk.fusionSendData('delete_frame', '{}');
      setFusionStatus('Deleting the frame in Fusion...', 'busy');
    } catch (_) { /* not in Fusion */ }
  }
}
/** The add-in's reply to 'delete_frame': { ok, frames: [names], error }. */
export function onDeleteFrameResult(data) {
  let r = {};
  try { r = typeof data === 'string' ? JSON.parse(data || '{}') : (data || {}); } catch (_) { r = { ok: false, error: 'Unreadable reply from Fusion.' }; }
  if (!r.ok) { setFusionStatus(r.error || 'The frame was not deleted in Fusion.', 'warn'); return r; }
  const n = (r.frames || []).length;
  setFusionStatus(n ? `Frame deleted in Fusion: ${r.frames.join(', ')}` : 'No frame to delete in Fusion', 'ok');
  return r;
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
  _syncTemplateSelect($('editorFrameTemplate'), rec.templateId);
  for (const f of FRAME_PARAM_FIELDS) {
    const el = $(f.id);
    if (!el) continue;
    const p = tpl?.params.find((q) => q.name === f.param);
    for (const k of ['min', 'max']) { if (p && p[k] != null) el[k] = p[k]; else el.removeAttribute(k); }
    if (document.activeElement !== el) el.value = tpl ? _round3(frameParam(FRAME_DEFS, rec, f.param)) : '';
    if (f.row && $(f.row)) $(f.row).style.display = tpl ? '' : 'none';
  }
  _syncTemplateSelect($('frameTemplate'), rec.templateId);
  if ($('frameBottomZ') && document.activeElement !== $('frameBottomZ')) $('frameBottomZ').value = rec.frameBottomZ;
  if ($('framePanelLip')) { // F22: its declared range follows the Trim offset
    const r = panelLipRange(FRAME_DEFS, rec);
    $('framePanelLip').min = r.min;
    if (Number.isFinite(r.max)) $('framePanelLip').max = r.max;
    if (document.activeElement !== $('framePanelLip')) $('framePanelLip').value = rec.panelLip;
  }
  if ($('frameAppearance')) $('frameAppearance').value = rec.appearance;
  // T82 item 5: two views of the SAME insetWindow record (the sidebar's own, and #editorFramePanel's own --
  // T82 item 4's own "a second view, not a second setting" pattern). Position X/Y = the record's own cx/cy
  // (the window's centre, from the board centre, +y UP), Size W/H = the record's own w/h directly -- a direct
  // read-back now (the record itself IS centre-based), no corner math the old {x1,y1,x2,y2} shape needed.
  for (const g of INSET_WINDOW_FIELD_GROUPS) {
    if ($(g.toggle)) $(g.toggle).checked = !!rec.insetWindow?.enabled;
    if ($(g.fields)) $(g.fields).style.display = rec.insetWindow?.enabled ? '' : 'none';
    if (rec.insetWindow) {
      const w = rec.insetWindow;
      if ($(g.posX) && document.activeElement !== $(g.posX)) $(g.posX).value = _round3(w.cx);
      if ($(g.posY) && document.activeElement !== $(g.posY)) $(g.posY).value = _round3(w.cy);
      if ($(g.sizeW) && document.activeElement !== $(g.sizeW)) $(g.sizeW).value = _round3(w.w);
      if ($(g.sizeH) && document.activeElement !== $(g.sizeH)) $(g.sizeH).value = _round3(w.h);
    }
  }
  if ($('frameSettings')) $('frameSettings').style.display = tpl ? '' : 'none';
  if ($('frameSummary')) $('frameSummary').textContent = tpl ? `— ${frameLabel(tpl)}` : `— ${NO_FRAME_CHOICE.label}`;

  const warn = $('frameFitWarning');
  if (warn) {
    const fit = tpl ? frameFit(P.widthIn, P.heightIn, frameParam(FRAME_DEFS, rec, 'frame_thickness'),
      frameParam(FRAME_DEFS, rec, 'boundingboxoffset')) : { ok: true };
    warn.style.display = fit.ok ? 'none' : '';
    warn.textContent = fit.ok ? '' : `Board too small for this frame: the safe zone is ${fit.safeZoneIn.toFixed(2)} in `
      + `but the frame needs more than ${fit.requiredIn.toFixed(2)} in.`;
  }
  // F31 item 2c (the advisor's own ruling): "one piece: needs a 1 1/16 in blank" -- one line per
  // currently-joined joint (deduped: a symmetric default shape's own mirrored pair always measures
  // the same width, so showing both would just repeat it), same read-only-computed-text pattern
  // frameFitWarning above already uses. Computed FRESH from `rec` (not read off `ed._frameProfile`,
  // which `drawFrameProfile` below only updates AFTER this point -- reading it here would show the
  // PREVIOUS record's own geometry for one sync cycle after every change, the same staleness trap
  // frameFitWarning's own fresh frameFit() call already avoids).
  const joinInfo = $('frameJoinInfo');
  if (joinInfo) {
    const seen = new Set();
    const lines = [];
    if (tpl && (rec.joinedMiters || []).length) {
      const board = { widthIn: P.widthIn, heightIn: P.heightIn };
      const outerProf = frameCutProfile(FRAME_DEFS, rec, board);
      const innerProf = !outerProf.defects.length ? frameInnerProfile(FRAME_DEFS, rec, board) : null;
      if (innerProf && !innerProf.defects.length) {
        for (const id of rec.joinedMiters) {
          const j = tpl.regions.joinable?.find((q) => q.id === id);
          if (!j || seen.has(id) || (j.mirror && seen.has(j.mirror))) continue;
          seen.add(id);
          const w = blankWidthIn(tpl, outerProf.primitives, innerProf.primitives, id);
          const text = w != null ? formatBlankWidthIn(w) : null;
          if (text) lines.push(`One piece: needs a ${text} blank.`);
        }
      }
    }
    joinInfo.style.display = lines.length ? '' : 'none';
    joinInfo.textContent = lines.join(' ');
  }
  if (typeof window !== 'undefined' && window.svgEditor) drawFrameProfile(window.svgEditor);
  // F7: the 3D trimmed panel + wood bars, live -- not while the editor is open (core/in-editor-3d.js 'frame': the
  // 2D profile above is its live view there; the 3D frame is applied when the session ends)
  if (inEditor3dAction('frame') === 'refresh3D') {
    // a board size change holding the 3D (main/app-init.js STOCK_CHANGE_DEFERS): its build applies the frame itself
    const refresh = () => AppState.preview?.refreshFrame?.();
    if (!deferToHold('frame-3d', refresh, { supersededByBuild: true })) refresh();
  }
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
function _hitFrameHandle(ed, clientX, clientY, pointerType = 'mouse') {
  const pt = ed._getMousePoint({ clientX, clientY });
  const edge = ed._getMousePoint({ clientX: clientX + _frameHandleHitPx(ed, pointerType), clientY });
  const tol = Math.abs(edge.x - pt.x);
  let best = null, bestD = Infinity;
  for (const h of ed._frameHandles || []) {
    const d = Math.hypot(h.anchor.x - pt.x, h.anchor.y - pt.y);
    if (d < bestD) { bestD = d; best = h; }
  }
  if (best && bestD <= tol) return { handle: best, side: 0 };
  return hitTestArcGrip(ed._frameHandles, pt, tol);
}

/** F31 item 2c: the SAME nearest-within-HANDLE_HIT_PX rule _hitFrameHandle uses, over
 *  `ed._frameJoinMarkers` (editor-frame-profile.js's own draw loop stashes it there, the same way
 *  it stashes `ed._frameHandles` for the function above -- never recomputed here). */
function _hitJoinMarker(ed, clientX, clientY, pointerType = 'mouse') {
  const pt = ed._getMousePoint({ clientX, clientY });
  const edge = ed._getMousePoint({ clientX: clientX + _frameHandleHitPx(ed, pointerType), clientY });
  const tol = Math.abs(edge.x - pt.x);
  let best = null, bestD = Infinity;
  for (const jm of ed._frameJoinMarkers || []) {
    const d = Math.hypot(jm.anchor.x - pt.x, jm.anchor.y - pt.y);
    if (d < bestD) { bestD = d; best = jm; }
  }
  return best && bestD <= tol ? best : null;
}

/** F31 item 2c: tapping a joinable-joint marker toggles IT AND ITS MIRROR together (Fred:
 *  "Mirrored pairs toggle together") -- one `editFrame` call, so it is one undo step, same as
 *  every other Frame-tab control (`editFrame`'s own doc comment). */
function _toggleJoinMarker(jm) {
  const rec = getFrameRecord();
  const cur = new Set(rec.joinedMiters || []);
  const pair = [jm.id, jm.mirror].filter(Boolean);
  const nowJoined = cur.has(jm.id);
  const next = new Set(cur);
  for (const id of pair) { if (nowJoined) next.delete(id); else next.add(id); }
  editFrame({ joinedMiters: [...next] });
}

// T81 item 1: module scope (not inside _wireHandleDrag's own closure) so
// setEditorTab, below, can clear it when the Frame tab is left -- same
// "a mode/tab switch invalidates a stale hover" rule editor-ui.js's setMode
// already applies to its own snap/grid hover state.
let _frameHoverKey = null;
// Seat D 2026-10-08 (phone, real touch): the finger dragging the inset window, so the shape-handle listener (which runs
// first) never starts a handle drag with a pinch's SECOND finger -- it did, when that finger landed near a handle.
let _windowDragPointerId = null;
// F31 item 2c: the same "live while this tab is open" idle-hover state as _frameHoverKey above,
// for the joinable-joint markers (a separate id-space -- joint ids, not handle keys -- so it is
// its own variable, not folded into _frameHoverKey).
let _frameJoinHoverId = null;
function _clearFrameHover() {
  const ed = typeof window !== 'undefined' ? window.svgEditor : null;
  if (_frameHoverKey !== null) {
    _frameHoverKey = null;
    if (ed) ed._frameHandleHover = null;
    setHandleCursor(null);
  }
  if (_frameJoinHoverId !== null) {
    _frameJoinHoverId = null;
    if (ed) ed._frameJoinHover = null;
  }
}
function _setJoinHover(ed, id) {
  if (_frameJoinHoverId === id) return;
  _frameJoinHoverId = id;
  if (ed) { ed._frameJoinHover = id; if (ed._frameProfile) drawFrameProfile(ed); }
  setHandleCursor(id ? 'hover' : null);
}

/** H23 item 39 (Fred-approved guard, part 2 -- "the drag handles stop before breaking it"): does
 *  `rec`'s own drawn cut profile have a miter whose straight line hooks back into the wood?
 *  Checked the same way generateFrame's isValid checks it (frameMiters + miterStaysInsideWood),
 *  against the RAW drawn geometry -- a drag sees exactly what's on screen, and (unlike Generate's
 *  own seed derivation) never needs T10's archRise pin: that handle's own drag never reaches
 *  Fusion any differently from what it draws. An inner-profile defect (a crossed/degenerate
 *  offset) is a different, pre-existing failure this rule doesn't own -- ignored here so the
 *  drag-stop never fights it. */
export function _frameRecordBreaksNoHookRule(rec) {
  const board = { widthIn: P.widthIn, heightIn: P.heightIn };
  const outer = frameCutProfile(FRAME_DEFS, rec, board);
  // H23 item 63 (Fred-approved guard): the drag also stops before any outline arc becomes an
  // undercut (>= a half-circle) -- Fusion refuses to build one.
  if (outlineHasUndercut(outer.primitives)) return true;
  // ...and before the outline itself breaks (self-intersection etc.) -- Generate already rejects
  // outer.defects; item 64's matrix found T12 cornerRadiusTop:max reachable by drag with one.
  if (outer.defects.length > 0) return true;
  const inner = frameInnerProfile(FRAME_DEFS, rec, board);
  if (inner && inner.defects.length > 0) return false;
  const miters = frameMiters(outer.primitives, inner.primitives);
  // H23 item 63 (Fred-approved guard, 2026-10-03: "guard the handles"): ...and before two corner
  // cuts cross or collide -- T13 neckWidth:min made the top bar shorter than its own two miters.
  const t = frameParam(FRAME_DEFS, rec, 'frame_thickness');
  if (mitersCollide(miters, t)) return true;
  return !miterStaysInsideWood(outer.primitives, miters, t);
}
const _mergeFrameRecord = (rec, patch) => ({
  ...rec,
  ...(patch.seeds ? { seeds: { ...(rec.seeds || {}), ...patch.seeds } } : {}),
  ...(patch.params ? { params: { ...(rec.params || {}), ...patch.params } } : {}),
});
const _lerpPatch = (prevRec, patch, f) => {
  const out = {};
  for (const group of ['seeds', 'params']) {
    if (!patch[group]) continue;
    out[group] = {};
    for (const k of Object.keys(patch[group])) {
      const a = prevRec[group]?.[k] ?? patch[group][k];
      out[group][k] = a + (patch[group][k] - a) * f;
    }
  }
  return out;
};
/** H23 item 39: the patch a drag WOULD write, clamped so it never crosses into a hooked-tip
 *  outline -- binary-searches the drag's own fraction (not a snap-back to the drag's start) so
 *  the handle visually STOPS right at the limit, the same feel the frame-opening range clamp
 *  already gives every other handle (frame-handles.js's own within()). Only does the extra work
 *  when the full patch actually breaks the rule -- the common case (no hook risk at all) costs
 *  nothing beyond the one check every drag tick already needs. One declared rule, every template:
 *  no per-preset code here. */
function _clampDragPatchToNoHookRule(prevRec, patch) {
  const breaks = _frameRecordBreaksNoHookRule;
  if (!breaks(_mergeFrameRecord(prevRec, patch))) return patch;
  // A shape that already breaks a rule (an old saved record, a rule added later) must not freeze the
  // handle: the binary search below would return 0 every tick. Let the drag move it.
  if (breaks(prevRec)) return patch;
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (breaks(_mergeFrameRecord(prevRec, _lerpPatch(prevRec, patch, mid)))) hi = mid; else lo = mid;
  }
  return _lerpPatch(prevRec, patch, lo);
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
  const inFrameTab = () => getEditorTab() === 'frame';
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
    if (_windowDragPointerId != null && e.pointerId !== _windowDragPointerId) return; // a pinch over a window drag: _wireWindowDrag ends it
    if (dragKey && e.pointerId !== dragPointerId) {
      e._frameDragEnded = true; // the window listener after this one must not start a drag with this finger either
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
    if (!ed || !ed._frameProfile) return;
    // F31 item 2c: a joinable-joint marker is a TAP (toggle, one undo step via editFrame), never a
    // drag -- checked first so it never falls through to the drag-handle hit-test below.
    const joinHit = _hitJoinMarker(ed, e.clientX, e.clientY, e.pointerType);
    if (joinHit) {
      _toggleJoinMarker(joinHit);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!(ed._frameHandles || []).length) return;
    const hit = _hitFrameHandle(ed, e.clientX, e.clientY, e.pointerType);
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
    // F13: a tweak is one undoable step -- audit (batch 3): pushed at RELEASE, and only if the frame changed (a tap
    // or a pinch-abort used to leave a do-nothing Frame Undo step)
    if (surface.setPointerCapture && e.pointerId != null) { try { surface.setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ } }
    e.preventDefault();
    e.stopPropagation(); // the editor never sees a handle drag
  }, true);
  surface.addEventListener('pointermove', (e) => {
    const ed = editor();
    if (!dragKey) {
      // T81 item 1: idle hover -- only while the Frame tab's own handles are live.
      const inFrame = inFrameTab() && ed && ed._frameProfile;
      // F31 item 2c: checked first, same priority order as the pointerdown hit-test above -- a
      // hovered join marker shows ITS OWN hover look, not a handle's.
      const joinHover = inFrame ? _hitJoinMarker(ed, e.clientX, e.clientY, e.pointerType)?.id ?? null : null;
      _setJoinHover(ed, joinHover);
      setHover(ed, !joinHover && inFrame ? (_hitFrameHandle(ed, e.clientX, e.clientY, e.pointerType)?.handle.key ?? null) : null);
      return;
    }
    if (e.pointerId !== dragPointerId) return; // another finger (a pinch): never drags the handle
    dragLastPt = { x: e.clientX, y: e.clientY };
    const h = (ed?._frameHandles || []).find((q) => q.key === dragKey);
    if (!h) return;
    const prevRec = getFrameRecord();
    setFrameRecord(_clampDragPatchToNoHookRule(prevRec, handleDragPatch(prevRec, h, ed._getMousePoint(e), ed._frameProfile.region, dragCtx)));
    drawFrameProfile(ed);
    e.preventDefault();
    e.stopPropagation();
  }, true);
  const end = (e) => {
    if (!dragKey || e.pointerId !== dragPointerId) return;
    if (dragStartRecord && JSON.stringify(dragStartRecord) !== JSON.stringify(getFrameRecord())) {
      _frameHistory.push(_clone(dragStartRecord));
      _syncUndo();
    }
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

// T82 item 4 (advisor review on 24e2d07): typed Position/Size margin over insetWindowGeometry's own
// strict '>' floor -- landing EXACTLY on 2*frame_thickness would still read back as "no window" (bars <= 0).
const INSET_WINDOW_MIN_MARGIN = 0.1;

/** The current displayed value for one Position/Size field (either field group, INSET_WINDOW_FIELD_GROUPS),
 *  read from the record -- used to snap a field back when its typed value didn't parse, the same "reject and
 *  restore" every other numeric field in this app effectively gets from syncFramePanel's own activeElement
 *  guard, but explicit here since a 'change' event can still fire while the field itself is the activeElement
 *  (Enter without a blur). T82 item 5: the record is already centre-based (cx/cy/w/h), so this is a direct
 *  read, no corner math -- rounded for display (advisor review), same as syncFramePanel's own read-back. */
function _insetWindowFieldValue(id, r) {
  for (const g of INSET_WINDOW_FIELD_GROUPS) {
    if (id === g.posX) return _round3(r.cx);
    if (id === g.posY) return _round3(r.cy);
    if (id === g.sizeW) return _round3(r.w);
    if (id === g.sizeH) return _round3(r.h);
  }
  return undefined;
}

/** Clamp a CANDIDATE insetWindow rect (T82 item 5: `{cx, cy, w, h}`) to one that still fits the board and
 *  still clears its own frame_thickness by INSET_WINDOW_MIN_MARGIN -- size first (so an undersized request
 *  grows symmetrically, the centre held), then position (the centre pulled in just enough to keep the whole
 *  rect on-board, size unchanged). */
function _clampInsetWindowRect(r) {
  const widthIn = P.widthIn, heightIn = P.heightIn;
  const ft = frameParam(FRAME_DEFS, getFrameRecord(), 'frame_thickness') || 0;
  const minSize = 2 * ft + INSET_WINDOW_MIN_MARGIN;
  const w = Math.min(Math.max(r.w, minSize), widthIn);
  const h = Math.min(Math.max(r.h, minSize), heightIn);
  const cx = Math.min(Math.max(r.cx, -(widthIn - w) / 2), (widthIn - w) / 2);
  const cy = Math.min(Math.max(r.cy, -(heightIn - h) / 2), (heightIn - h) / 2);
  return { cx, cy, w, h };
}

/** One Position/Size stepper's own 'change' handler: parse, reject non-finite input outright (restore the
 *  field, write nothing), else apply `build` (the field's own patch shape) to the current rect and clamp
 *  the result before writing. `build(r, value)` returns a CANDIDATE rect (same 4 keys), not yet clamped. */
function _applyInsetWindowStepper(input, build) {
  const r = getFrameRecord().insetWindow;
  const value = parseFloat(input.value);
  if (!Number.isFinite(value)) { input.value = _insetWindowFieldValue(input.id, r); return; }
  editFrame({ insetWindow: { ...r, ..._clampInsetWindowRect(build(r, value)) } });
}

/** T82 item 5: the window's own board-local OUTER rect (x1/y1/x2/y2, origin top-left, y down -- the frame
 *  every drag/hit-test below works in) at a given centre-based record value, via the ONE conversion
 *  (core/inset-window.js `insetWindowOuterRect`). */
const _winRect = (r) => insetWindowOuterRect(r, P.widthIn, P.heightIn);

/**
 * T82 item 2/5 (INSET-WINDOW-DESIGN.md §6): drag the inset window's own body (move) or a corner (resize), in
 * the Frame tab, on the SAME shield surface `_wireHandleDrag` uses. A separate listener (not a branch inside
 * `_wireHandleDrag`'s own closure) so a shape-handle drag's own tightly-tuned pinch-abort/capture logic is
 * never touched; `ed._frameHandleDrag` (public on the editor) is the one shared flag that keeps the two from
 * both grabbing the same press. A corner drag resizes SYMMETRICALLY about the centre (T82 item 5, Fred: "use
 * the centre of frame... and make the window a centre point rect too") -- the centre (cx, cy) never moves
 * during a resize, only w/h, by twice the dragged corner's own distance from it. Deliberately NOT clamped
 * (design note §3): a drag can push the window past the frame's own opening or the board edge (Fred: "then
 * it's my responsibility to not let it intersect") -- TYPED entry is clamped instead (see
 * _clampInsetWindowRect above), a different failure mode: a single keystroke isn't bounded by the cursor's
 * own continuous motion the way a drag is.
 */
function _wireWindowDrag() {
  const shield = $('editorFrameShield');
  if (!shield || !shield.parentElement) return;
  const surface = shield.parentElement;
  const editor = () => (typeof window !== 'undefined' ? window.svgEditor : null);
  const CORNER_PX = 20;
  let mode = null; // null | 'body' | 'x1y1' | 'x2y1' | 'x1y2' | 'x2y2'
  let dragPointerId = null, dragStartPt = null, dragStartRect = null, dragStartRecord = null;
  let dragLastPt = null; // the dragging finger's last client point, handed to the editor if a pinch takes over
  let hoverKey = null; // the SAME hover/press bookkeeping _wireHandleDrag uses for its own handles
  const corners = (r) => ({ x1y1: { x: r.x1, y: r.y1 }, x2y1: { x: r.x2, y: r.y1 }, x1y2: { x: r.x1, y: r.y2 }, x2y2: { x: r.x2, y: r.y2 } });
  // Seat D 2026-10-08 (phone, real touch): a finger's corner reach is the pointer's own -- the shape handles'
  // _frameHandleHitPx (touch ~25 px); a fixed 20 px missed a finger 22 px off. A mouse keeps CORNER_PX.
  const hit = (ed, clientX, clientY, pointerType = 'mouse') => {
    const rec = getFrameRecord();
    if (!rec.insetWindow?.enabled) return null;
    const pt = ed._getMousePoint({ clientX, clientY });
    const edge = ed._getMousePoint({ clientX: clientX + Math.max(CORNER_PX, _frameHandleHitPx(ed, pointerType)), clientY });
    const tol = Math.abs(edge.x - pt.x) || 0.1;
    const r = _winRect(rec.insetWindow);
    for (const [k, c] of Object.entries(corners(r))) if (Math.hypot(c.x - pt.x, c.y - pt.y) <= tol) return { mode: k, r };
    if (pt.x > r.x1 && pt.x < r.x2 && pt.y > r.y1 && pt.y < r.y2) return { mode: 'body', r };
    return null;
  };
  // Idle hover: only a CORNER grab lights a visible handle (editor-frame-profile.js's own corner markers,
  // one per `corners()` key above) -- the body has no handle mark to light, same as a plain move-drag
  // elsewhere in this app never highlights anything.
  const setHover = (ed, key) => {
    if (hoverKey === key) return;
    hoverKey = key;
    if (ed) { ed._windowHandleHover = key; if (ed._frameProfile) drawFrameProfile(ed); }
  };
  surface.addEventListener('pointerdown', (e) => {
    if (getEditorTab() !== 'frame') return;
    if (e._frameDragEnded) return; // this finger just turned a shape-handle drag into a pinch
    const ed = editor();
    if (mode && e.pointerId !== dragPointerId) {
      // Seat D 2026-10-08 (phone, real touch): a second finger during a window drag = a pinch -- the same rule as the
      // shape handles (Fred: "Zooming shouldn't move geometry inadvertently"). MEASURED before: the window stayed
      // moved (and kept following the first finger) with an undo step. Put the frame back, end the drag, and let this
      // press through to the editor with the first finger registered, so it zooms.
      setFrameRecord(dragStartRecord);
      const wasCorner = mode !== 'body';
      mode = null;
      if (ed) {
        if (wasCorner) ed._windowHandleDrag = null;
        if (ed._activePointers && dragLastPt) ed._activePointers.set(dragPointerId, dragLastPt);
        if (ed._frameProfile) drawFrameProfile(ed);
      }
      dragPointerId = null;
      _windowDragPointerId = null;
      syncFramePanel();
      return;
    }
    if (!ed || ed._frameHandleDrag) return; // a shape-handle drag already owns this press
    const h = hit(ed, e.clientX, e.clientY, e.pointerType);
    if (!h) return;
    mode = h.mode;
    dragPointerId = e.pointerId;
    _windowDragPointerId = e.pointerId;
    dragStartPt = ed._getMousePoint(e);
    dragStartRect = { ...getFrameRecord().insetWindow }; // {cx, cy, w, h} at drag start
    dragStartRecord = JSON.parse(JSON.stringify(getFrameRecord()));
    dragLastPt = { x: e.clientX, y: e.clientY };
    if (mode !== 'body') { ed._windowHandleDrag = mode; if (ed._frameProfile) drawFrameProfile(ed); }
    if (surface.setPointerCapture && e.pointerId != null) { try { surface.setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ } }
    e.preventDefault();
    e.stopPropagation();
  }, true);
  surface.addEventListener('pointermove', (e) => {
    const ed = editor();
    if (!mode) {
      const h = getEditorTab() === 'frame' && ed && ed._frameProfile ? hit(ed, e.clientX, e.clientY, e.pointerType) : null;
      setHover(ed, h && h.mode !== 'body' ? h.mode : null);
      return;
    }
    if (e.pointerId !== dragPointerId) return;
    dragLastPt = { x: e.clientX, y: e.clientY };
    const pt = ed._getMousePoint(e);
    const dx = pt.x - dragStartPt.x, dy = pt.y - dragStartPt.y;
    let next;
    if (mode === 'body') {
      // Board-local x translates straight onto cx; board-local y is Y-DOWN while cy is Y-UP, so it flips sign.
      next = { ...dragStartRect, cx: dragStartRect.cx + dx, cy: dragStartRect.cy - dy };
    } else {
      // T82 item 5: a corner drag resizes SYMMETRICALLY about the centre -- cx/cy stay exactly as they were
      // at drag start; only w/h change, derived from the dragged corner's own new distance from that (fixed)
      // centre, doubled (the OPPOSITE edge moves the same amount inward/outward to keep the centre put).
      const r0 = _winRect(dragStartRect);
      const cxBoard = (r0.x1 + r0.x2) / 2, cyBoard = (r0.y1 + r0.y2) / 2;
      const corner0 = corners(r0)[mode];
      const newCornerX = corner0.x + dx, newCornerY = corner0.y + dy;
      next = { ...dragStartRect, w: 2 * Math.abs(newCornerX - cxBoard), h: 2 * Math.abs(newCornerY - cyBoard) };
    }
    setFrameRecord({ insetWindow: { ...next, enabled: true } });
    if (ed._frameProfile) drawFrameProfile(ed);
    e.preventDefault();
    e.stopPropagation();
  }, true);
  const end = (e) => {
    if (!mode || e.pointerId !== dragPointerId) return;
    if (dragStartRecord && JSON.stringify(dragStartRecord) !== JSON.stringify(getFrameRecord())) {
      _frameHistory.push(_clone(dragStartRecord));
      _syncUndo();
    }
    const wasCorner = mode !== 'body';
    mode = null; dragPointerId = null; _windowDragPointerId = null;
    const ed = editor();
    if (wasCorner && ed) { ed._windowHandleDrag = null; if (ed._frameProfile) drawFrameProfile(ed); }
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
  setFrameClearHandler(() => editFrameNow({ templateId: null, params: {} })); // NOW: the Clear records what it left
  // F7: the 3D preview asks with the grid size it is actually drawing.
  AppState.preview?.setFrameProvider?.((W, H) => frameSolidSpec(FRAME_DEFS, getFrameRecord(), { widthIn: W, heightIn: H }));
  const tplSel = $('frameTemplate');
  const woodSel = $('frameAppearance');
  if (!tplSel || !woodSel) return;

  for (const sel of [tplSel, $('editorFrameTemplate')].filter(Boolean)) {
    sel.appendChild(_option(NO_FRAME_CHOICE.value, NO_FRAME_CHOICE.label));
    // F29 item 1: a hidden template (its own shape isn't ready yet) is never OFFERED for a new pick; a saved
    // record already on one still loads and draws fine (findFrameTemplate searches the full list) -- its own
    // option is added back in just for that record by _syncTemplateSelect below, never left there otherwise.
    for (const t of FRAME_DEFS.templates || []) if (!t.hidden) sel.appendChild(_option(t.id, frameLabel(t)));
  }
  for (const sel of [woodSel].filter(Boolean)) {
    for (const w of FRAME_DEFS.appearance?.options || []) sel.appendChild(_option(w, w.replace(/^3D /, '')));
  }
  // advisor turn 203 (Fred's rule): the template list is a long VISUAL list -> an icon dropdown, icons drawn
  // by the frame engine from each template's own outline (editor/frame-template-icon.js), the name as tooltip.
  for (const sel of [tplSel, $('editorFrameTemplate')].filter(Boolean)) {
    mountIconSelect(sel, { iconFor: (v) => (v === NO_FRAME_CHOICE.value ? boardOutlineIconSvg() : templateIconSvg(FRAME_DEFS, v)), label: 'Frame template' });
  }
  $('editorFrameTemplate')?.addEventListener('change', (e) => editFrame({ templateId: e.target.value || null, params: {} }));
  $('editorFrameGenerate')?.addEventListener('click', () => generateFrame());
  $('btnDeleteFrame')?.addEventListener('click', () => withLoadingStageShownFirst('frame', () => deleteFrame())); // F26 item 2 (b)
  $('editorFrameUndo')?.addEventListener('click', () => withLoadingStageShownFirst('frame', () => undoFrame()));
  // Ctrl/Cmd+Z in the Frame tab undoes the FRAME (the artwork's undo is locked there, F8)
  if (!_undoKeyWired) { // once per page (initFramePanel may run again, e.g. in tests)
    _undoKeyWired = true;
    window.addEventListener('keydown', (e) => {
      if (getEditorTab() !== 'frame' || !(e.ctrlKey || e.metaKey) || e.shiftKey || (e.key !== 'z' && e.key !== 'Z')) return;
      e.preventDefault();
      withLoadingStageShownFirst('frame', () => undoFrame());
    });
  }
  _syncUndo();
  for (const f of FRAME_PARAM_FIELDS) {
    $(f.id)?.addEventListener('change', (e) => editFrame({ params: { ...getFrameRecord().params, [f.param]: parseFloat(e.target.value) } }));
  }
  $('editorTabFrame')?.addEventListener('click', () => setEditorTab('frame'));
  $('editorTabArtwork')?.addEventListener('click', () => setEditorTab('artwork'));
  // Two doors, one room: "Edit frame shape" opens the editor on the Frame tab,
  // "Open SVG Editor" (the same button) on the Artwork tab.
  $('btnStampEdit')?.addEventListener('click', () => { setEditorTab(_openEditorOn || 'artwork'); _openEditorOn = null; });

  tplSel.addEventListener('change', () => editFrame({ templateId: tplSel.value || null, params: {} }));
  woodSel.addEventListener('change', () => editFrame({ appearance: woodSel.value }));
  $('frameBottomZ')?.addEventListener('change', (e) => editFrame({ frameBottomZ: parseFloat(e.target.value) }));
  $('framePanelLip')?.addEventListener('change', (e) => editFrame({ panelLip: parseFloat(e.target.value) }));
  // T82 item 2/5: off by default; the FIRST time it is turned on with no rect yet (w===0 && h===0, a
  // never-placed window), seed a reasonable starting rect (centred, roughly a third of the current board) so
  // there is something to see and drag immediately -- an implementation choice, not a design constraint
  // (design note §6). Turning it off keeps the record's own rect (so re-enabling restores the last placement).
  // Wired once per field group (INSET_WINDOW_FIELD_GROUPS: the sidebar's own fields, and T82 item 5's new
  // #editorFramePanel copy, T82 item 4's own "a second view" pattern) -- both toggles and both Position/Size
  // quartets write the SAME insetWindow record, so either view always reflects the other (syncFramePanel).
  // Position/Size steppers write cx/cy/w/h directly (the record IS centre-based, no corner math needed the
  // way the old {x1,y1,x2,y2} shape required). A DRAG stays deliberately unclamped (INSET-WINDOW-DESIGN.md
  // §3/§6, Fred: "then it's my responsibility to not let it intersect") -- but typed entry is a different
  // failure mode: a blank/garbage field would write NaN straight into the record (nothing downstream expects
  // that), and unlike a drag, which is bounded by the cursor's own continuous motion, a single keystroke can
  // jump the rect anywhere. So typed Position/Size IS clamped (advisor review on 24e2d07, carried over
  // unchanged in meaning for T82 item 5): non-finite input is ignored outright (the field snaps back to the
  // record's own current value), a valid number is clamped to stay on the board and to clear its own
  // frame_thickness with a small margin (insetWindowGeometry's own floor is a strict '>', so landing exactly
  // on 2*frame_thickness would still read back as "no window").
  for (const g of INSET_WINDOW_FIELD_GROUPS) {
    $(g.toggle)?.addEventListener('change', (e) => {
      const cur = getFrameRecord().insetWindow;
      const enabled = e.target.checked;
      const needsSeed = enabled && cur.w === 0 && cur.h === 0;
      const seed = needsSeed ? { cx: 0, cy: 0, w: P.widthIn / 3, h: P.heightIn / 3 } : cur;
      editFrame({ insetWindow: { ...seed, enabled } });
    });
    $(g.posX)?.addEventListener('change', (e) => _applyInsetWindowStepper(e.target, (r, v) => ({ ...r, cx: v })));
    $(g.posY)?.addEventListener('change', (e) => _applyInsetWindowStepper(e.target, (r, v) => ({ ...r, cy: v })));
    $(g.sizeW)?.addEventListener('change', (e) => _applyInsetWindowStepper(e.target, (r, v) => ({ ...r, w: v })));
    $(g.sizeH)?.addEventListener('change', (e) => _applyInsetWindowStepper(e.target, (r, v) => ({ ...r, h: v })));
  }
  // The sidebar sections' open-the-editor buttons, declared: each opens the SAME editor (btnStampEdit's own
  // path) on its own tab. Turn 207 (Fred): the BRICK section's "Brick editor" joins the Frame section's.
  for (const { id, tab } of OPEN_EDITOR_BUTTONS) $(id)?.addEventListener('click', () => openEditorOn(tab));
  _wireHandleDrag();
  _wireWindowDrag();
  // The fit warning (and the editor's profile) depend on the board size. Seat D 2026-10-08 (sidebar phone audit, CPU x4):
  // this sync re-meshes the 3D frame (refreshFrame -> applyFrameToPanel, 265-272 ms) -- run in the change handler it froze
  // a board width / height change ~300 ms with no card; the 'frame' stage is on screen first now.
  for (const id of ['widthIn', 'heightIn']) $(id)?.addEventListener('change', () => withLoadingStageShownFirst('frame', () => syncFramePanel()));
  syncFramePanel();
}

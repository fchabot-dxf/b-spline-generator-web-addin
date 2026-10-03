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
import { P } from '../core/state.js';
import { setFusionStatus } from '../core/fusion-bridge.js';
import { setFrameProfileProvider, setFrameClearHandler, drawFrameProfile, frameFit, frameSolidSpec, setEditorFocus } from '../editor/editor-frame-profile.js';
import { AppState } from './app-state.js';
import { handleDragPatch, frameSeedGeometry, generateFrameSeeds, generateValidFrameSeeds } from '../editor/frame-handles.js';
import { paramsFromShapeModel } from '../editor/editor-shape-lattice-generator.js';
import { nextSeed } from '../editor/editor-lattice-pattern.js';
import { frameCutProfile, frameInnerProfile, smallestConvexArcRadius, frameMiters, miterStaysInsideWood } from '../editor/editor-frame-profile.js';
import { setHandleCursor, paramHandleCursorAxis } from '../editor/editor-transform-handles.js';
import { hitTestArcGrip } from '../editor/editor-shape-lattice-interaction.js';
import { syncDrawerForMode } from '../editor/editor-drawer.js';
import { inputProfileFor } from '../editor/editor-input.js';
import { FRAME_HANDLE_RADIUS } from '../editor/editor-frame-profile.js';
import { insetWindowGeometry, insetWindowOuterRect } from '../core/inset-window.js';

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
  setFrameRecord(prev);
  syncFramePanel();
  _syncUndo();
  return true;
}
export const frameHistoryDepth = () => _frameHistory.length;

/** Audit (batch 3): THE way a Frame-tab control edits the frame -- one undo step, the write, the panel sync.
 *  Thickness / Trim offset / Wood / Bottom Z / Panel lip used to write with no step (a Frame Undo then reverted
 *  them together with the previous handle drag, or couldn't undo them at all). */
export function editFrame(patch) {
  pushFrameHistory();
  setFrameRecord(patch);
  syncFramePanel();
}
function _syncUndo() { if ($('editorFrameUndo')) $('editorFrameUndo').disabled = _frameHistory.length === 0; }

/** A primitive's own length (line: chord; arc: this generator's own circular arcs, rx === ry). Same formula
 *  tests/frame-template-*.test.js's own `primLength` already uses for the "no wing risk" check (Template 7's
 *  own finding: a bar segment shorter than frame_thickness causes a "wing" artifact). */
const _primLength = (p) => (p.type === 'L' ? Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y) : Math.abs(p.rx * p.dTheta));

/** F13 [Generate]: a new seeded random frame shape, written as the handles' seeds. */
export function generateFrame(seed = nextSeed()) {
  const rec = getFrameRecord();
  const tpl = findFrameTemplate(FRAME_DEFS, rec.templateId);
  if (!tpl) return null;
  const region = frameCutProfile(FRAME_DEFS, rec, { widthIn: P.widthIn, heightIn: P.heightIn }).region;
  const t = frameParam(FRAME_DEFS, rec, 'frame_thickness');
  // Generate must never produce a broken frame (Fred): checked against the real inner profile, not just the
  // bare outline every seed's own ranges already guarantee (frame-handles.js generateValidFrameSeeds). H23
  // item 21: ALSO checked against every OUTER piece staying at least frame_thickness long (Template 7's own
  // "no wing" finding, generalized) -- a template whose handle table doesn't expose every param that shapes a
  // piece's own length can draw a bare outline with 0 defects whose own horn piece is still too short for
  // Fusion's real inward offset -- MEASURED live: addOffset2 fails on topology, 2 of 4 bars never get built.
  // T10's own archRise needs one more correction here: MEASURED live (a default build and a bad-seed build
  // produced BIT-IDENTICAL top_edge geometry), archRise is never actually seeded to Fusion for the arch
  // itself -- p02_12_arch_rebuild.py's own formula always builds it at the template's own FITTED default,
  // regardless of what's drawn/dragged. Validating against the DRAWN archRise checks the wrong (app-preview-
  // only) geometry for the horn piece specifically, so the outer profile used here is built with archRise
  // pinned to that same fitted default -- what Fusion will really build -- not whatever this draw's own
  // archRise happens to be. Same "retry against the real check" declared pattern as the inner-profile rule
  // above (frame-handles.js's own comment on generateValidFrameSeeds), not a hand-derived range.
  const realSeedsFor = tpl.shapeModel?.features?.archRise
    ? (s) => ({ ...s, archRise: paramsFromShapeModel(tpl.silhouettePreset, tpl.shapeModel, region).archRise })
    : (s) => s;
  // H23 item 23: ALSO checked against every outer arc staying under a half-turn, matching Fusion's own build-
  // time gate (fb_engine/diagnostics.py's assert_no_reflex_arcs, >= 180 deg is always a wrong-branch defect,
  // never intended -- H23 item 15) exactly. A template whose handle table doesn't re-fit every radius to the
  // waist it just generated (T10 seeds only waistCenterY/waistReach/archRise; waistRadius/cornerRadius stay at
  // the shape model's own fixed default, unlike T1/T3/T4/T5's own full handle set, which always re-derives
  // waistRadius from its OWN generated waistReach and so can never hit this via Generate) can draw a waistReach
  // deep enough, against those FIXED radii, that hourglassConstruction's own waistMajor condition (Rs+Rw < d,
  // the shared tangency algebra -- see its own F8 comment) trips: MEASURED live, T10 6x9, Rs+Rw=1.328 < d=1.562,
  // the resulting waist arc sweeps 200.3 deg, and Fusion's hard gate crashes the Shape Outline build before the
  // frame-enclosure sketch -- 0 bars. A major arc is NOT always wrong (F8's own exception is real, and T1 can
  // legitimately need one at some board sizes from its own fitted/default shape) -- only Fusion's build-time
  // gate makes it fatal, so Generate retries around it here rather than the exception being removed.
  const seeds = generateValidFrameSeeds(tpl, region, seed, t, (s) => {
    const inner = frameInnerProfile(FRAME_DEFS, { ...rec, seeds: s }, { widthIn: P.widthIn, heightIn: P.heightIn });
    if (inner && inner.defects.length > 0) return false;
    const outer = frameCutProfile(FRAME_DEFS, { ...rec, seeds: realSeedsFor(s) }, { widthIn: P.widthIn, heightIn: P.heightIn });
    if (!outer.primitives.every((p) => _primLength(p) >= t)) return false;
    if (!outer.primitives.every((p) => p.type !== 'A' || Math.abs(p.dTheta) < Math.PI)) return false;
    // H23 item 39 (Fred-approved guard -- his own correction: "a hooked tip is SHORT GRAIN, fibres
    // across a thin tip snap -- size the margin so a tip is never thin, not just 'miter inside the
    // wood'"): every miter's own straight line (its outer corner to its matching inner corner) must
    // keep real clearance from the rest of the outer boundary along its whole length, not merely
    // never cross it outright. One declared rule for every template (not a T7 patch): item 38 found
    // that an exactly-correct miter line can still re-approach the outline it started from -- an
    // angle-dependent property of a line meeting an arc at a cusp-like corner (T7's own eave),
    // present even when the arc's radius exceeds frame_thickness, so NOT the same thing as item 28's
    // radius-vs-thickness rule. Reuses the app's own existing miter geometry (frameMiters) rather
    // than re-deriving corner points here. MEASURED (H23 item 39 sweep, all 13 templates): every
    // template's own default clears this with real margin; T7's eave is the one structurally tight
    // case (its own default margin is the tightest of any template, 0.0604t at 7x9, still well clear
    // of the 0.04t floor) -- see editor-frame-profile.js's own MIN_MITER_MARGIN_T_FRAC comment and
    // WORK-LOG for the full numbers, including T7's own measured low per-draw pass rate.
    return miterStaysInsideWood(outer.primitives, frameMiters(outer.primitives, inner.primitives), t);
  });
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
}

let _editorTab = 'artwork';
let _openEditorOn = null;

/** Switch the editor between its Frame and Artwork modes. */
/** A frame template's name as shown: numbered (Fred: "Number the other frames too") -- "Template 1 - Hourglass"
 *  -> "1. Hourglass"; a name without the "Template N - " prefix is shown as is. */
export function frameLabel(tpl) {
  const name = String((tpl && tpl.name) || '');
  const m = name.match(/^Template\s*(\d+)\s*[-–]\s*(.+)$/i);
  return m ? `${m[1]}. ${m[2]}` : name;
}

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
  // T82 item 4 (advisor probes 2026-10-02): a convex arc radius <= frame_thickness makes Fusion's
  // parametric offset refuse the enclosure (falls back to a non-parametric loop, inner corner goes
  // sharp) -- read directly from the app's own already-solved outline/inner profile, no new formula.
  const twarn = $('editorFrameThicknessWarning');
  if (twarn) {
    const ft = tpl ? frameParam(FRAME_DEFS, rec, 'frame_thickness') : null;
    const prof = tpl ? frameCutProfile(FRAME_DEFS, rec, { widthIn: P.widthIn, heightIn: P.heightIn }) : null;
    const inner = tpl && prof?.fit.ok ? frameInnerProfile(FRAME_DEFS, rec, { widthIn: P.widthIn, heightIn: P.heightIn }) : null;
    const minR = prof && inner ? smallestConvexArcRadius(prof.primitives, inner.primitives) : Infinity;
    const tooThick = Number.isFinite(ft) && ft >= minR;
    twarn.style.display = tooThick ? '' : 'none';
    twarn.textContent = tooThick
      ? `Frame thickness (${ft.toFixed(3)} in) is at or past the tightest curve's own radius (${minR.toFixed(3)} in) -- Fusion will not build a true inner edge here.`
      : '';
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
  if ($('frameSummary')) $('frameSummary').textContent = tpl ? `— ${frameLabel(tpl)}` : '— none';

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

/** H23 item 39 (Fred-approved guard, part 2 -- "the drag handles stop before breaking it"): does
 *  `rec`'s own drawn cut profile have a miter whose straight line hooks back into the wood?
 *  Checked the same way generateFrame's isValid checks it (frameMiters + miterStaysInsideWood),
 *  against the RAW drawn geometry -- a drag sees exactly what's on screen, and (unlike Generate's
 *  own seed derivation) never needs T10's archRise pin: that handle's own drag never reaches
 *  Fusion any differently from what it draws. An inner-profile defect (a crossed/degenerate
 *  offset) is a different, pre-existing failure this rule doesn't own -- ignored here so the
 *  drag-stop never fights it. */
function _frameRecordBreaksNoHookRule(rec) {
  const board = { widthIn: P.widthIn, heightIn: P.heightIn };
  const inner = frameInnerProfile(FRAME_DEFS, rec, board);
  if (inner && inner.defects.length > 0) return false;
  const outer = frameCutProfile(FRAME_DEFS, rec, board);
  const t = frameParam(FRAME_DEFS, rec, 'frame_thickness');
  return !miterStaysInsideWood(outer.primitives, frameMiters(outer.primitives, inner.primitives), t);
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
  if (!_frameRecordBreaksNoHookRule(_mergeFrameRecord(prevRec, patch))) return patch;
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (_frameRecordBreaksNoHookRule(_mergeFrameRecord(prevRec, _lerpPatch(prevRec, patch, mid)))) hi = mid; else lo = mid;
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
      setHover(ed, inFrameTab() && ed && ed._frameProfile ? (_hitFrameHandle(ed, e.clientX, e.clientY, e.pointerType)?.handle.key ?? null) : null);
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
  let hoverKey = null; // the SAME hover/press bookkeeping _wireHandleDrag uses for its own handles
  const corners = (r) => ({ x1y1: { x: r.x1, y: r.y1 }, x2y1: { x: r.x2, y: r.y1 }, x1y2: { x: r.x1, y: r.y2 }, x2y2: { x: r.x2, y: r.y2 } });
  const hit = (ed, clientX, clientY) => {
    const rec = getFrameRecord();
    if (!rec.insetWindow?.enabled) return null;
    const pt = ed._getMousePoint({ clientX, clientY });
    const edge = ed._getMousePoint({ clientX: clientX + CORNER_PX, clientY });
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
    if (_editorTab !== 'frame') return;
    const ed = editor();
    if (!ed || ed._frameHandleDrag) return; // a shape-handle drag already owns this press
    const h = hit(ed, e.clientX, e.clientY);
    if (!h) return;
    mode = h.mode;
    dragPointerId = e.pointerId;
    dragStartPt = ed._getMousePoint(e);
    dragStartRect = { ...getFrameRecord().insetWindow }; // {cx, cy, w, h} at drag start
    dragStartRecord = JSON.parse(JSON.stringify(getFrameRecord()));
    if (mode !== 'body') { ed._windowHandleDrag = mode; if (ed._frameProfile) drawFrameProfile(ed); }
    if (surface.setPointerCapture && e.pointerId != null) { try { surface.setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ } }
    e.preventDefault();
    e.stopPropagation();
  }, true);
  surface.addEventListener('pointermove', (e) => {
    const ed = editor();
    if (!mode) {
      const h = _editorTab === 'frame' && ed && ed._frameProfile ? hit(ed, e.clientX, e.clientY) : null;
      setHover(ed, h && h.mode !== 'body' ? h.mode : null);
      return;
    }
    if (e.pointerId !== dragPointerId) return;
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
    mode = null; dragPointerId = null;
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
  setFrameClearHandler(() => editFrame({ templateId: null, params: {} }));
  // F7: the 3D preview asks with the grid size it is actually drawing.
  AppState.preview?.setFrameProvider?.((W, H) => frameSolidSpec(FRAME_DEFS, getFrameRecord(), { widthIn: W, heightIn: H }));
  const tplSel = $('frameTemplate');
  const woodSel = $('frameAppearance');
  if (!tplSel || !woodSel) return;

  for (const sel of [tplSel, $('editorFrameTemplate')].filter(Boolean)) {
    sel.appendChild(_option('', 'None'));
    // F29 item 1: a hidden template (its own shape isn't ready yet) is never OFFERED for a new pick; a saved
    // record already on one still loads and draws fine (findFrameTemplate searches the full list) -- its own
    // option is added back in just for that record by _syncTemplateSelect below, never left there otherwise.
    for (const t of FRAME_DEFS.templates || []) if (!t.hidden) sel.appendChild(_option(t.id, frameLabel(t)));
  }
  for (const sel of [woodSel].filter(Boolean)) {
    for (const w of FRAME_DEFS.appearance?.options || []) sel.appendChild(_option(w, w.replace(/^3D /, '')));
  }
  $('editorFrameTemplate')?.addEventListener('change', (e) => editFrame({ templateId: e.target.value || null, params: {} }));
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
  $('btnEditFrameShape')?.addEventListener('click', () => { _openEditorOn = 'frame'; $('btnStampEdit')?.click(); });
  _wireHandleDrag();
  _wireWindowDrag();
  // The fit warning (and the editor's profile) depend on the board size.
  for (const id of ['widthIn', 'heightIn']) $(id)?.addEventListener('change', () => syncFramePanel());
  syncFramePanel();
}

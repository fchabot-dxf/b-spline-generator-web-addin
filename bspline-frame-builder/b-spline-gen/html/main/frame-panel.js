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
import { frameCutProfile, frameInnerProfile, smallestConvexArcRadius } from '../editor/editor-frame-profile.js';
import { setHandleCursor, paramHandleCursorAxis } from '../editor/editor-transform-handles.js';
import { hitTestArcGrip } from '../editor/editor-shape-lattice-interaction.js';
import { syncDrawerForMode } from '../editor/editor-drawer.js';
import { inputProfileFor } from '../editor/editor-input.js';
import { FRAME_HANDLE_RADIUS } from '../editor/editor-frame-profile.js';
import { insetWindowGeometry } from '../core/inset-window.js';

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
    return outer.primitives.every((p) => p.type !== 'A' || Math.abs(p.dTheta) < Math.PI);
  });
  pushFrameHistory();
  setFrameRecord({ seeds, genSeed: seed });
  syncFramePanel();
  return getFrameRecord();
}

const $ = (id) => document.getElementById(id);

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
  // F11 option B: seeded handles go as the template's own seed geometry
  if (Object.keys(rec.seeds || {}).length) {
    const prof = frameCutProfile(FRAME_DEFS, rec, { widthIn: P.widthIn, heightIn: P.heightIn });
    payload.seedGeometry = frameSeedGeometry(findFrameTemplate(FRAME_DEFS, rec.templateId), prof, P.widthIn, P.heightIn);
  }
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
    if (document.activeElement !== el) el.value = tpl ? frameParam(FRAME_DEFS, rec, f.param) : '';
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
  if ($('frameInsetWindowToggle')) $('frameInsetWindowToggle').checked = !!rec.insetWindow?.enabled; // T82 item 2
  // Position/Size steppers: the same insetWindow rect the Frame tab's own corner handles drag, read back
  // as Position (the x1/y1 corner) + Size (width/height) rather than raw x1/y1/x2/y2 -- typing Position
  // moves the window (both corners shift together), typing Size resizes it from that same corner, matching
  // how a drag on the body vs. a corner behaves (_wireWindowDrag, below).
  if ($('frameInsetWindowFields')) $('frameInsetWindowFields').style.display = rec.insetWindow?.enabled ? '' : 'none';
  if (rec.insetWindow) {
    const w = rec.insetWindow;
    if ($('frameWindowPosX') && document.activeElement !== $('frameWindowPosX')) $('frameWindowPosX').value = w.x1;
    if ($('frameWindowPosY') && document.activeElement !== $('frameWindowPosY')) $('frameWindowPosY').value = w.y1;
    if ($('frameWindowSizeW') && document.activeElement !== $('frameWindowSizeW')) $('frameWindowSizeW').value = w.x2 - w.x1;
    if ($('frameWindowSizeH') && document.activeElement !== $('frameWindowSizeH')) $('frameWindowSizeH').value = w.y2 - w.y1;
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
    setFrameRecord(handleDragPatch(getFrameRecord(), h, ed._getMousePoint(e), ed._frameProfile.region, dragCtx));
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

/** The current displayed value for one Position/Size field, read from the record -- used to snap a field
 *  back when its typed value didn't parse, the same "reject and restore" every other numeric field in this
 *  app effectively gets from syncFramePanel's own activeElement guard, but explicit here since a 'change'
 *  event can still fire while the field itself is the activeElement (Enter without a blur). */
function _insetWindowFieldValue(id, r) {
  if (id === 'frameWindowPosX') return r.x1;
  if (id === 'frameWindowPosY') return r.y1;
  if (id === 'frameWindowSizeW') return r.x2 - r.x1;
  if (id === 'frameWindowSizeH') return r.y2 - r.y1;
  return undefined;
}

/** Clamp a CANDIDATE insetWindow rect to one that still fits the board and still clears its own
 *  frame_thickness by INSET_WINDOW_MIN_MARGIN -- size first (so an undersized request grows from its own
 *  x1/y1 anchor, matching how Size itself is applied), then position (so the whole rect lands on-board). */
function _clampInsetWindowRect(r) {
  const widthIn = P.widthIn, heightIn = P.heightIn;
  const ft = frameParam(FRAME_DEFS, getFrameRecord(), 'frame_thickness') || 0;
  const minSize = 2 * ft + INSET_WINDOW_MIN_MARGIN;
  const w = Math.min(Math.max(r.x2 - r.x1, minSize), widthIn);
  const h = Math.min(Math.max(r.y2 - r.y1, minSize), heightIn);
  const x1 = Math.min(Math.max(r.x1, 0), widthIn - w);
  const y1 = Math.min(Math.max(r.y1, 0), heightIn - h);
  return { x1, y1, x2: x1 + w, y2: y1 + h };
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

/**
 * T82 item 2 (INSET-WINDOW-DESIGN.md §6): drag the inset window's own body (move) or a corner (resize), in the
 * Frame tab, on the SAME shield surface `_wireHandleDrag` uses. A separate listener (not a branch inside
 * `_wireHandleDrag`'s own closure) so a shape-handle drag's own tightly-tuned pinch-abort/capture logic is
 * never touched; `ed._frameHandleDrag` (public on the editor) is the one shared flag that keeps the two from
 * both grabbing the same press. Deliberately NOT clamped (design note §3): a drag can push the window past the
 * frame's own opening or the board edge (Fred: "then it's my responsibility to not let it intersect") --
 * TYPED entry is clamped instead (see _clampInsetWindowRect above), a different failure mode: a single
 * keystroke isn't bounded by the cursor's own continuous motion the way a drag is.
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
    const r = rec.insetWindow;
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
    dragStartRect = { ...h.r };
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
    const r = { ...dragStartRect };
    if (mode === 'body') { r.x1 += dx; r.x2 += dx; r.y1 += dy; r.y2 += dy; }
    else { if (mode.startsWith('x1')) r.x1 += dx; else r.x2 += dx;
           if (mode.includes('y1')) r.y1 += dy; else r.y2 += dy; }
    setFrameRecord({ insetWindow: { ...r, enabled: true } });
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
  // T82 item 2: off by default; the FIRST time it is turned on with no rect yet (x1===x2, a never-placed
  // window), seed a reasonable starting rect (roughly centred, roughly a third of the current board) so there
  // is something to see and drag immediately -- an implementation choice, not a design constraint (design
  // note §6). Turning it off keeps the record's own rect (so re-enabling restores the last placement).
  $('frameInsetWindowToggle')?.addEventListener('change', (e) => {
    const cur = getFrameRecord().insetWindow;
    const enabled = e.target.checked;
    const needsSeed = enabled && cur.x1 === cur.x2 && cur.y1 === cur.y2;
    const seed = needsSeed ? { x1: P.widthIn / 3, y1: P.heightIn / 3, x2: 2 * P.widthIn / 3, y2: 2 * P.heightIn / 3 } : cur;
    editFrame({ insetWindow: { ...seed, enabled } });
  });
  // Position/Size steppers (same rect _wireWindowDrag's own corner/body drag writes) -- Position moves the
  // window (both x1/x2, or y1/y2, shift together, keeping size fixed); Size resizes it from the x1/y1
  // corner (matching a corner drag's own "the opposite corner stays put" feel). A DRAG stays deliberately
  // unclamped (INSET-WINDOW-DESIGN.md §3/§6, Fred: "then it's my responsibility to not let it intersect")
  // -- but typed entry is a different failure mode: a blank/garbage field would write NaN straight into
  // the record (nothing downstream expects that), and unlike a drag, which is bounded by the cursor's own
  // continuous motion, a single keystroke can jump the rect anywhere. So typed Position/Size IS clamped
  // (advisor review on 24e2d07): non-finite input is ignored outright (the field snaps back to the
  // record's own current value), a valid number is clamped to stay on the board and to clear its own
  // frame_thickness with a small margin (insetWindowGeometry's own floor is a strict '>', so landing
  // exactly on 2*frame_thickness would still read back as "no window").
  $('frameWindowPosX')?.addEventListener('change', (e) => _applyInsetWindowStepper(e.target, (r, v) => ({ ...r, x1: v, x2: v + (r.x2 - r.x1) })));
  $('frameWindowPosY')?.addEventListener('change', (e) => _applyInsetWindowStepper(e.target, (r, v) => ({ ...r, y1: v, y2: v + (r.y2 - r.y1) })));
  $('frameWindowSizeW')?.addEventListener('change', (e) => _applyInsetWindowStepper(e.target, (r, v) => ({ ...r, x2: r.x1 + v })));
  $('frameWindowSizeH')?.addEventListener('change', (e) => _applyInsetWindowStepper(e.target, (r, v) => ({ ...r, y2: r.y1 + v })));
  $('btnEditFrameShape')?.addEventListener('click', () => { _openEditorOn = 'frame'; $('btnStampEdit')?.click(); });
  _wireHandleDrag();
  _wireWindowDrag();
  // The fit warning (and the editor's profile) depend on the board size.
  for (const id of ['widthIn', 'heightIn']) $(id)?.addEventListener('change', () => syncFramePanel());
  syncFramePanel();
}

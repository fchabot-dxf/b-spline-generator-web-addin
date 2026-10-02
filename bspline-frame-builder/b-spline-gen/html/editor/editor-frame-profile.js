/**
 * editor-frame-profile.js — FB-APP S2 (F6), design §3.0 headline: with a
 * frame chosen, the editor's board IS the frame's cut profile (what the
 * frame's SURROUND trim leaves); outside it is shaded as cut away. Artwork is
 * never touched: the profile is drawn in the editor's BACKGROUND layer, which
 * sits under the grid and the artwork and is never exported.
 *
 * One outline source: the generated frame definition (the same Python the
 * Fusion build runs, via data/frame-defs.js) supplies the template's app
 * preset + declared shape params + boundingboxoffset; the SAME silhouette
 * engine the Shape Lattice uses solves it (no second copy of the math), and
 * the F5 outline guard must pass before anything is drawn.
 */
import { generateSilhouette, outlineDefects, primitivesToPathD, primitiveToPathD, paramsFromShapeModel } from './editor-shape-lattice-generator.js';
import { sampleOutline, pointInPolygon } from '../core/preview/frame-mesh.js';
import { offsetOutlineInward } from './outline-offset.js';
import { insetWindowGeometry } from '../core/inset-window.js';
import { shapeParamOverrides, frameHandles, clampToFrameRanges, FRAME_CLAMPED_PRESETS } from './frame-handles.js';
import { frameColorFor } from '../core/color-utils.js';
import { handleKindVisual, drawParamHandle, drawSegmentHighlight } from './editor-transform-handles.js';
import { controlledSegments } from './editor-shape-lattice-interaction.js';

export const FRAME_PROFILE_GROUP_ID = 'frame-profile';
/** The darkened "outside the frame" (board minus the cut profile): its own group, NOT inside the frame
 *  profile group, so the focus rule's fade (setEditorFocus: the frame at INACTIVE_LAYER_OPACITY in the
 *  Artwork tab) never lightens it -- Fred (phone, Artwork tab): "when a frame exists make the outside of
 *  the frame darker". Drawn just before the profile group, so it still sits under the frame lines. */
export const FRAME_CUTAWAY_GROUP_ID = 'frame-cutaway-layer';
export const FRAME_GRID_CLIP_ID = 'frame-grid-clip';

/** F8 (Fred): every frame line (outline, inner edge, miters) in ONE colour. */
export const FRAME_OUTLINE_COLOR = '#5d4037';
/** F8 (Fred): the symmetric focus rule: whichever of frame / artwork is NOT
 *  being edited is drawn at this opacity, the edited one at full. */
export const INACTIVE_LAYER_OPACITY = 0.4;
/** F9: the frame shape handles' drawn radius (board inches). */
export const FRAME_HANDLE_RADIUS = 0.09;

/**
 * The editor's two modes (design §3.1). 'frame': the frame is edited, the
 * artwork is a faded, LOCKED background (editor._artworkLocked: no selection,
 * no shortcut reaches it; drawn from the same layer, never modified).
 * 'artwork': the artwork is edited, the frame profile is the faded background.
 * Display only: opacity lives on the layer / group, never on the drawing.
 */
export function setEditorFocus(editor, tab) {
  if (!editor) return;
  const frame = tab === 'frame';
  editor._editorTab = frame ? 'frame' : 'artwork';
  editor._artworkLocked = frame;
  if (frame && typeof editor._deselect === 'function') editor._deselect();
  if (editor._sketchLayer) editor._sketchLayer.attr('opacity', frame ? INACTIVE_LAYER_OPACITY : null);
  const g = editor._bgLayer?.findOne ? editor._bgLayer.findOne('#' + FRAME_PROFILE_GROUP_ID) : null;
  if (g) g.attr('opacity', frame ? null : INACTIVE_LAYER_OPACITY);
}

/** The declared fit rule (frame-defs `fit`, frame_definition.FRAME_FIT in
 *  Python): 2*frame_thickness < min(W, H) - 2*boundingboxoffset. */
export function frameFit(widthIn, heightIn, frameThickness, bboxOffset) {
  const safe = Math.min(widthIn, heightIn) - 2 * bboxOffset;
  const need = 2 * frameThickness;
  return { ok: need < safe, safeZoneIn: safe, requiredIn: need };
}

/** The template's shape params for this region: the fitted model (F8), with
 *  the record's handle values on top (F9: seeds / bound params). */
const _shapeParams = (tpl, region, record) => ({
  ...paramsFromShapeModel(tpl.silhouettePreset, tpl.shapeModel, region),
  ...shapeParamOverrides(tpl, record, region),
});

const _param = (tpl, record, name) => {
  if (record?.params && name in record.params) return record.params[name];
  return tpl.params.find((p) => p.name === name)?.default;
};

/**
 * Pure: frame definition + record + board size (inches) -> the cut profile,
 * or null when there is no frame. Board coordinates are the editor's own
 * (origin top-left, y down, inches).
 */
export function frameCutProfile(defs, record, { widthIn, heightIn }) {
  if (!record || !record.templateId) return null;
  const tpl = (defs.templates || []).find((t) => t.id === record.templateId);
  if (!tpl) return null;
  const bbo = _param(tpl, record, 'boundingboxoffset') ?? 0;
  const ft = _param(tpl, record, 'frame_thickness') ?? 0;
  const region = { x: bbo, y: bbo, w: widthIn - 2 * bbo, h: heightIn - 2 * bbo };
  const fit = frameFit(widthIn, heightIn, ft, bbo);
  let shapeParams = _shapeParams(tpl, region, record);
  // T6 TAB TOP: a preset whose drawn frame obeys the thickness rule (frame-handles.js FRAME_CLAMPED_PRESETS);
  // every other template is drawn exactly as before.
  if (fit.ok && FRAME_CLAMPED_PRESETS.includes(tpl.silhouettePreset)) shapeParams = clampToFrameRanges(tpl, region, shapeParams, ft);
  const sil = generateSilhouette(region, { preset: tpl.silhouettePreset, params: shapeParams });
  // T10 ARCHED HOURGLASS: the first template with a genuine (non-tangent) corner between a LINE and an ARC --
  // every corner a template declares via `regions.miters` is an EXPECTED real angle, so outlineDefects' own
  // universal "an arc-involving joint must be tangent" guard (built to catch an ACCIDENTAL break in a tangent
  // CHAIN, like the shoulder/waist/hip arcs, which never involves a declared corner) is filtered here at exactly
  // those declared corners -- the SAME "a declared corner excuses its own notTangent" rule tests/contour-from-
  // frame.test.js already applies to a from-frame contour's own corner list. A no-op for every other template:
  // their own corners are always line-line, already exempt inside outlineDefects itself.
  const n = sil.primitives.length;
  const primOf = (bareId) => tpl.seedMap?.find((e) => e.id === bareId)?.prim;
  const cornerIndices = new Set((tpl.regions.miters || []).map(([src]) => {
    const p = primOf(src.replace(/^proj_/, '').replace(/:S$/, ''));
    return p == null ? null : (p - 1 + n) % n;
  }).filter((i) => i != null));
  const defects = outlineDefects(sil.primitives).filter((d) => !(d.kind === 'notTangent' && cornerIndices.has(d.index)));
  return {
    // F27 item 2 arc pull: `shapeParams` = the params the outline was generated FROM (the arc grips re-solve over them)
    templateId: tpl.id, name: tpl.name, region, primitives: sil.primitives, params: sil.params, shapeParams,
    pathD: primitivesToPathD(sil.primitives), polygon: sampleOutline(sil.primitives),
    defects, fit,
  };
}

/**
 * FB-APP S3 (F7), exact since F8: the frame's inner edge is the TRUE inward
 * offset of the cut profile by frame_thickness (editor/outline-offset.js):
 * lines shifted along their normal, arcs concentric at r -/+ t, re-joined at
 * the joints, i.e. the same operation Fusion's Offset performs. Same primitive
 * count/order as the outline (a collapsed piece stays as a zero-length
 * placeholder), so outline and inner edge pair by index. The guard runs on the
 * real pieces; a merged corner is legitimately not tangent. No inner edge
 * when the frame does not fit (the declared fit rule): the offset is then
 * undefined (Fusion's own flips outside the board, e.g. T1 5.51x1.97).
 */
export function frameInnerProfile(defs, record, board) {
  const prof = frameCutProfile(defs, record, board);
  if (!prof || !prof.fit.ok) return null;
  const tpl = defs.templates.find((t) => t.id === record.templateId);
  const primitives = offsetOutlineInward(prof.primitives, _param(tpl, record, 'frame_thickness') ?? 0);
  const real = primitives.filter((p) => !p.collapsed);
  return { primitives, defects: outlineDefects(real, { requireTangency: false }) };
}

/**
 * T82 item 4 (advisor probes 2026-10-02): the smallest CONVEX arc radius in the outline, in inches, or
 * `Infinity` if the outline has no convex arc at all (e.g. Template 6's all-line Tab Top). "Convex" is
 * read off the app's own already-solved offset (outline-offset.js's own `r - t` for a convex arc, `r + t`
 * for concave -- see that module's own header comment), not re-derived here: a NON-collapsed inner arc
 * whose radius shrank from the outer one was offset by `r - t`, i.e. convex; a COLLAPSED inner piece is,
 * by that same module's own documented rule, always a convex arc whose radius was <= the offset distance
 * -- so it counts too, at its own TRUE (un-offset) outer radius, not the collapsed placeholder's.
 * `outerPrimitives`/`innerPrimitives` pair by index (frameCutProfile's `.primitives` / frameInnerProfile's
 * `.primitives`, offset at whatever `frame_thickness` `innerPrimitives` was itself computed with).
 */
export function smallestConvexArcRadius(outerPrimitives, innerPrimitives) {
  let min = Infinity;
  if (!outerPrimitives || !innerPrimitives || innerPrimitives.length !== outerPrimitives.length) return min;
  for (let i = 0; i < outerPrimitives.length; i++) {
    const outer = outerPrimitives[i];
    if (outer.type !== 'A') continue;
    const inner = innerPrimitives[i];
    const convex = inner.collapsed || (inner.type === 'A' && inner.rx < outer.rx);
    if (convex) min = Math.min(min, outer.rx);
  }
  return min;
}

/** Everything the 3D preview needs (core/preview/frame-mesh.js), or null
 *  when there is no frame or the outline fails the guard. */
/** F22: the panel's trim outline = the frame outline offset OUTWARD by the record's panel lip (the F8 true offset,
 *  negative distance; a corner arc that collapses merges into a corner), or null when the lip is 0 (the panel is
 *  trimmed on the outline itself, exactly as before). */
export function panelTrimPrimitives(prof, record) {
  const lip = Number(record && record.panelLip) || 0;
  if (!prof || !(lip > 0)) return null;
  return offsetOutlineInward(prof.primitives, -lip).filter((p) => !p.collapsed);
}

export function frameSolidSpec(defs, record, board) {
  const prof = frameCutProfile(defs, record, board);
  if (!prof || prof.defects.length) return null;
  const inner = prof.fit.ok ? frameInnerProfile(defs, record, board) : null;
  const innerOk = inner && !inner.defects.length && inner.primitives.length === prof.primitives.length;
  const tpl = (defs.templates || []).find((t) => t.id === prof.templateId);
  const ft = _param(tpl, record, 'frame_thickness') ?? 0;
  return {
    outline: sampleOutline(prof.primitives),
    inner: innerOk ? sampleOutline(inner.primitives) : null,
    outerPrimitives: prof.primitives,
    innerPrimitives: innerOk ? inner.primitives : null,
    panelPrimitives: panelTrimPrimitives(prof, record), // F22: null = trimmed on the outline
    insetWindow: insetWindowGeometry(record, ft, record.panelLip), // T82 item 2, null when off/invalid
    frameBottomZ: record.frameBottomZ,
    // H8 (Fred: "make frame colour a bit different than board, tiny bit"):
    // the frame's own declared colour, not the board's raw wood colour —
    // the SAME frameColorFor() the 2D band below calls, so both surfaces
    // read the identical declared table (color-utils.js's own FRAME_COLORS).
    color: defs.appearance?.previewColors?.[record.appearance]
      ? frameColorFor(record.appearance, defs.appearance.previewColors[record.appearance])
      : null,
  };
}

/** The travel direction at the start (`atEnd` false) or end (`atEnd` true) of a primitive -- a line's own fixed
 *  direction, or an arc's tangent there (outline-offset.js's own `_tangent`, re-derived here: a pure geometry
 *  helper, no reason to import across that module's own boundary for one small function). */
function _travelDir(p, atEnd) {
  if (p.type === 'L') { const dx = p.p1.x - p.p0.x, dy = p.p1.y - p.p0.y, l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l }; }
  const th = atEnd ? p.theta1 + p.dTheta : p.theta1, s = p.dTheta > 0 ? 1 : -1;
  return { x: -Math.sin(th) * s, y: Math.cos(th) * s };
}
const _primStart = (p) => (p.type === 'L' ? { ...p.p0 } : { x: p.cx + p.rx * Math.cos(p.theta1), y: p.cy + p.ry * Math.sin(p.theta1) });

/**
 * F8 (Fred: "see the frame thickness and miter lines in the editor"): the
 * frame's miters join each OUTER corner of the cut profile to the matching
 * INNER corner. Corners are the joints where two pieces meet at a genuine
 * angle (every bounding-box corner, straight-to-straight or -- Template 10's
 * own arch -- straight-to-ARC: its own tangent direction there decides it,
 * not just "both lines"); a smooth tangent continuation (the shoulder/waist/
 * hip arc chain) is not a corner. Outline and inner edge share the same
 * primitive topology, so the same index pairs them.
 */
export function frameMiters(outerPrims, innerPrims) {
  if (!innerPrims || innerPrims.length !== outerPrims.length) return [];
  const n = outerPrims.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = outerPrims[(i - 1 + n) % n], b = outerPrims[i];
    const ta = _travelDir(a, true), tb = _travelDir(b, false);
    if (ta.x * tb.x + ta.y * tb.y > 0.999) continue; // tangent: not a corner
    out.push({ outer: _primStart(b), inner: _primStart(innerPrims[i]) });
  }
  return out;
}

let _provider = null;
/** `fn() -> { defs, record }`, registered by the app (main/frame-panel.js),
 *  so this editor module never imports app state directly. */
export function setFrameProfileProvider(fn) { _provider = fn; }

let _clearHandler = null;
/** H20 item 3: `fn()` resets the frame record to "None" (with its own
 *  pushFrameHistory() undo step) and re-syncs the Frame panel — same
 *  provider pattern as setFrameProfileProvider, registered by
 *  main/frame-panel.js, so Clear (editor/tools/action-tools.js) can reset
 *  whichever tab is active without this module importing app state. */
export function setFrameClearHandler(fn) { _clearHandler = fn; }
export function clearFrame() { if (_clearHandler) _clearHandler(); }

/** F21: the frame as the contour-from-frame consumers need it: `{ defs, record, board }`, or null. */
export function frameContext(editor) {
  const spec = _provider ? _provider() : null;
  return spec && editor ? { ...spec, board: { widthIn: editor._mW, heightIn: editor._mH } } : null;
}

/** F21: called after every frame (re)draw (a template / handle / Trim offset / thickness change all redraw),
 *  so something linked to the frame (the Shape Lattice's offset-from-frame contour) can follow it. */
const _drawnHooks = [];
export function onFrameProfileDrawn(fn) { if (!_drawnHooks.includes(fn)) _drawnHooks.push(fn); }

/**
 * (Re)draw the cut profile into `editor._bgLayer`. Called at the end of
 * sync3DBackground (which clears that layer) and whenever the frame record
 * changes. A profile that fails the outline guard is NOT drawn.
 */
export function drawFrameProfile(editor) {
  const out = _drawFrameProfile(editor);
  if (editor && editor._bgLayer) for (const fn of _drawnHooks) fn(editor);
  return out;
}

function _drawFrameProfile(editor) {
  if (!editor || !editor._bgLayer) return null;
  for (const id of [FRAME_PROFILE_GROUP_ID, FRAME_CUTAWAY_GROUP_ID]) {
    const old = editor._bgLayer.findOne ? editor._bgLayer.findOne('#' + id) : null;
    if (old) old.remove();
  }
  const spec = _provider ? _provider() : null;
  const prof = spec ? frameCutProfile(spec.defs, spec.record, { widthIn: editor._mW, heightIn: editor._mH }) : null;
  editor._frameProfile = prof && !prof.defects.length ? prof : null;
  _clipGrid(editor, editor._frameProfile);
  if (!prof || prof.defects.length) return prof;
  const W = editor._mW, H = editor._mH;
  // Everything outside the profile is cut away: board rect minus the outline (even-odd) -- in its own
  // group, full strength in BOTH tabs (FRAME_CUTAWAY_GROUP_ID).
  const cut = editor._bgLayer.group().id(FRAME_CUTAWAY_GROUP_ID).attr('pointer-events', 'none');
  cut.path(`M0 0 H${W} V${H} H0 Z ${prof.pathD}`)
    .fill({ color: '#1f2933', opacity: 0.6 }).attr('fill-rule', 'evenodd').addClass('frame-cutaway');
  const g = editor._bgLayer.group().id(FRAME_PROFILE_GROUP_ID).attr('pointer-events', 'none');
  if (editor._editorTab !== 'frame') g.attr('opacity', INACTIVE_LAYER_OPACITY); // the focus rule (setEditorFocus)
  // The frame itself: the band between the outline and its inner edge (the
  // frame thickness), tinted in the chosen wood, plus the inner edge and the
  // 4 miter lines. Same inner loop the 3D bars use (frameInnerProfile).
  const inner = prof.fit.ok ? frameInnerProfile(spec.defs, spec.record, { widthIn: W, heightIn: H }) : null;
  if (inner && !inner.defects.length && inner.primitives.length === prof.primitives.length) {
    const innerD = primitivesToPathD(inner.primitives);
    // H8: frameColorFor() again — see frameSolidSpec's own identical call.
    const wood = frameColorFor(spec.record.appearance, spec.defs.appearance?.previewColors?.[spec.record.appearance] || '#d9c9a3');
    g.path(`${prof.pathD} ${innerD}`).fill({ color: wood, opacity: 0.45 }).attr('fill-rule', 'evenodd').addClass('frame-band');
    g.path(innerD).fill('none').stroke({ color: FRAME_OUTLINE_COLOR, width: 0.025 }).addClass('frame-inner-edge');
    for (const m of frameMiters(prof.primitives, inner.primitives)) {
      g.path(`M${m.outer.x} ${m.outer.y} L${m.inner.x} ${m.inner.y}`).fill('none')
        .stroke({ color: FRAME_OUTLINE_COLOR, width: 0.025 }).addClass('frame-miter');
    }
  }
  const lipPrims = panelTrimPrimitives(prof, spec.record); // F22: the panel lip, a subtle band outside the outline
  if (lipPrims) {
    g.path(`${primitivesToPathD(lipPrims)} ${prof.pathD}`).fill({ color: FRAME_OUTLINE_COLOR, opacity: 0.25 })
      .attr('fill-rule', 'evenodd').addClass('frame-panel-lip');
  }
  g.path(prof.pathD).fill('none').stroke({ color: FRAME_OUTLINE_COLOR, width: 0.04 }).addClass('frame-cut-profile');
  // T82 item 2: the inset window, drawn the same way the main frame's own band/cutaway already are -- outer
  // rect (band colour between outer and inner), inner edge, a dark cutaway for the hole itself. Shown on
  // both tabs (same as the main frame's own cutaway) since it affects the carved panel either way.
  const ftTpl = (spec.defs.templates || []).find((t) => t.id === prof.templateId);
  const ft = _param(ftTpl, spec.record, 'frame_thickness') ?? 0;
  const win = insetWindowGeometry(spec.record, ft, spec.record.panelLip);
  if (win) {
    const rectD = (r) => `M${r.x1} ${r.y1} H${r.x2} V${r.y2} H${r.x1} Z`;
    const wood = frameColorFor(spec.record.appearance, spec.defs.appearance?.previewColors?.[spec.record.appearance] || '#d9c9a3');
    g.path(`${rectD(win.outer)} ${rectD(win.inner)}`).fill({ color: wood, opacity: 0.45 })
      .attr('fill-rule', 'evenodd').addClass('inset-window-band');
    g.path(rectD(win.inner)).fill('none').stroke({ color: FRAME_OUTLINE_COLOR, width: 0.025 }).addClass('inset-window-inner-edge');
    cut.path(rectD(win.hole)).fill({ color: '#1f2933', opacity: 0.6 }).addClass('inset-window-cutaway');
    g.path(rectD(win.outer)).fill('none').stroke({ color: FRAME_OUTLINE_COLOR, width: 0.04 }).addClass('inset-window-outer-edge');
    // Fred: no visible marker at the window's own 4 drag corners (main/frame-panel.js's own
    // _wireWindowDrag already hit-tests them, it just never drew anything). Frame tab only, same gate
    // the shape handles use below -- the SAME declared HANDLE_KINDS look ('position': the app's white/
    // blue square) every other draggable handle in this app already uses, not a new convention.
    if (editor._editorTab === 'frame') {
      const o = win.outer;
      const winCorners = { x1y1: { x: o.x1, y: o.y1 }, x2y1: { x: o.x2, y: o.y1 }, x1y2: { x: o.x1, y: o.y2 }, x2y2: { x: o.x2, y: o.y2 } };
      for (const [key, anchor] of Object.entries(winCorners)) {
        const active = editor._windowHandleHover === key || editor._windowHandleDrag === key;
        const vis = handleKindVisual('position', FRAME_HANDLE_RADIUS, FRAME_OUTLINE_COLOR, active);
        drawParamHandle(g, vis, anchor.x, anchor.y, 0.03).addClass('inset-window-handle').attr('data-key', key);
      }
    }
  }
  // F9: the shape handles, in the Frame tab only (dragged through its shield, main/frame-panel.js).
  editor._frameHandles = [];
  if (editor._editorTab === 'frame') {
    const tpl = (spec.defs.templates || []).find((t) => t.id === prof.templateId);
    editor._frameHandles = frameHandles(tpl, prof, _param(tpl, spec.record, 'frame_thickness') ?? 0);
    // T81 item 1 look, now in the Frame tab too (Fred: "How about highlighting the geometry it control"):
    // the hovered/held handle's own outline segment and its mirror, under the handles.
    const activeKey = editor._frameHandleDrag || editor._frameHandleHover;
    if (activeKey && tpl) {
      for (const i of controlledSegments(tpl.silhouettePreset, activeKey, prof.primitives.length)) {
        const d = primitiveToPathD(prof.primitives[i]); // OPEN, no closing Z (a chord would show)
        if (d) drawSegmentHighlight(g, d, FRAME_HANDLE_RADIUS * 1.2).addClass('frame-handle-highlight');
      }
    }
    for (const h of editor._frameHandles) {
      // T81 item 1: the SAME declared hover/press look Shape Lattice's own
      // param handles use (editor-transform-handles.js) -- frame-panel.js
      // sets _frameHandleHover/_frameHandleDrag from its own pointer wiring.
      // F27 item 2: drawn by its declared KIND (radius = accent dot ON its arc,
      // position = the app's white/blue square; the cursor shows the drag
      // direction), the ONE kind table the Shape Lattice reads too. F27 item 2
      // arc pull: a radius param's grip is its whole arc, both sides
      // (frame-panel.js hit-tests it); the dot marks it, and hovering either
      // arc lights both through the highlight above (the arc's only other cue).
      const active = editor._frameHandleHover === h.key || editor._frameHandleDrag === h.key;
      const vis = handleKindVisual(h.handleKind, FRAME_HANDLE_RADIUS, FRAME_OUTLINE_COLOR, active);
      drawParamHandle(g, vis, h.anchor.x, h.anchor.y, 0.03)
        .addClass('frame-handle').attr('data-key', h.key).attr('data-kind', h.handleKind || 'position');
    }
  }
  return prof;
}

/** F7 (AMEND 1): the grid follows the outline, i.e. it is clipped to the
 *  cut profile (the cut-away has no grid). Removed again with no frame. */
function _clipGrid(editor, prof) {
  const layer = editor._gridLayer, draw = editor._draw;
  if (!layer || !draw || typeof layer.clipWith !== 'function') return;
  const old = draw.findOne ? draw.findOne('#' + FRAME_GRID_CLIP_ID) : null;
  if (old) old.remove();
  if (typeof layer.unclip === 'function') layer.unclip();
  if (!prof) return;
  const clip = draw.clip().id(FRAME_GRID_CLIP_ID);
  clip.path(prof.pathD);
  layer.clipWith(clip);
}

/** F7 (AMEND 1): snapping follows the outline. A snapped point that lands in
 *  the cut-away (no grid there) falls back to the raw point; inside the
 *  outline snapping is unchanged. */
export function frameSnapGate(editor, snapped, raw) {
  const prof = editor && editor._frameProfile;
  if (!prof || !snapped || snapped === raw) return snapped;
  return pointInPolygon(snapped.x, snapped.y, prof.polygon) ? snapped : raw;
}

/** F7 (AMEND 1): fit-to-view frames the outline, not the stock rectangle. */
export function frameFitRegion(editor) {
  return (editor && editor._frameProfile && editor._frameProfile.region) || null;
}

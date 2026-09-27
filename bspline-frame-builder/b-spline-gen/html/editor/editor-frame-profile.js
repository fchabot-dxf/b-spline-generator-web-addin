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
import { generateSilhouette, outlineDefects, primitivesToPathD, paramsFromShapeModel } from './editor-shape-lattice-generator.js';
import { sampleOutline, pointInPolygon } from '../core/preview/frame-mesh.js';
import { offsetOutlineInward } from './outline-offset.js';
import { shapeParamOverrides, frameHandles } from './frame-handles.js';
import { frameColorFor } from '../core/color-utils.js';

export const FRAME_PROFILE_GROUP_ID = 'frame-profile';
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
  const sil = generateSilhouette(region, { preset: tpl.silhouettePreset, params: _shapeParams(tpl, region, record) });
  const defects = outlineDefects(sil.primitives);
  return {
    templateId: tpl.id, name: tpl.name, region, primitives: sil.primitives, params: sil.params,
    pathD: primitivesToPathD(sil.primitives), polygon: sampleOutline(sil.primitives),
    defects, fit: frameFit(widthIn, heightIn, ft, bbo),
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
  return {
    outline: sampleOutline(prof.primitives),
    inner: innerOk ? sampleOutline(inner.primitives) : null,
    outerPrimitives: prof.primitives,
    innerPrimitives: innerOk ? inner.primitives : null,
    panelPrimitives: panelTrimPrimitives(prof, record), // F22: null = trimmed on the outline
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

/**
 * F8 (Fred: "see the frame thickness and miter lines in the editor"): the
 * frame's miters join each OUTER corner of the cut profile to the matching
 * INNER corner. Corners are the joints where two straight pieces meet at an
 * angle (the bounding-box corners); outline and inner edge share the same
 * primitive topology, so the same index pairs them.
 */
export function frameMiters(outerPrims, innerPrims) {
  if (!innerPrims || innerPrims.length !== outerPrims.length) return [];
  const n = outerPrims.length, out = [];
  const dir = (p) => { const dx = p.p1.x - p.p0.x, dy = p.p1.y - p.p0.y, l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
  for (let i = 0; i < n; i++) {
    const a = outerPrims[(i - 1 + n) % n], b = outerPrims[i];
    if (a.type !== 'L' || b.type !== 'L') continue;
    const [ax, ay] = dir(a), [bx, by] = dir(b);
    if (Math.abs(ax * bx + ay * by) > 0.999) continue; // collinear: not a corner
    out.push({ outer: { ...b.p0 }, inner: { ...innerPrims[i].p0 } });
  }
  return out;
}

let _provider = null;
/** `fn() -> { defs, record }`, registered by the app (main/frame-panel.js),
 *  so this editor module never imports app state directly. */
export function setFrameProfileProvider(fn) { _provider = fn; }

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
  const old = editor._bgLayer.findOne ? editor._bgLayer.findOne('#' + FRAME_PROFILE_GROUP_ID) : null;
  if (old) old.remove();
  const spec = _provider ? _provider() : null;
  const prof = spec ? frameCutProfile(spec.defs, spec.record, { widthIn: editor._mW, heightIn: editor._mH }) : null;
  editor._frameProfile = prof && !prof.defects.length ? prof : null;
  _clipGrid(editor, editor._frameProfile);
  if (!prof || prof.defects.length) return prof;
  const W = editor._mW, H = editor._mH;
  const g = editor._bgLayer.group().id(FRAME_PROFILE_GROUP_ID).attr('pointer-events', 'none');
  if (editor._editorTab !== 'frame') g.attr('opacity', INACTIVE_LAYER_OPACITY); // the focus rule (setEditorFocus)
  // Everything outside the profile is cut away: board rect minus the outline (even-odd).
  g.path(`M0 0 H${W} V${H} H0 Z ${prof.pathD}`)
    .fill({ color: '#1f2933', opacity: 0.6 }).attr('fill-rule', 'evenodd').addClass('frame-cutaway');
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
  // F9: the shape handles, in the Frame tab only (dragged through its shield, main/frame-panel.js).
  editor._frameHandles = [];
  if (editor._editorTab === 'frame') {
    const tpl = (spec.defs.templates || []).find((t) => t.id === prof.templateId);
    editor._frameHandles = frameHandles(tpl, prof, _param(tpl, spec.record, 'frame_thickness') ?? 0);
    for (const h of editor._frameHandles) {
      g.circle(FRAME_HANDLE_RADIUS * 2).center(h.anchor.x, h.anchor.y).fill('#ffffff')
        .stroke({ color: FRAME_OUTLINE_COLOR, width: 0.03 }).addClass('frame-handle').attr('data-key', h.key);
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

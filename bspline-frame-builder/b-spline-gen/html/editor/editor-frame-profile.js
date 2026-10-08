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
import { handleKindVisual, handleHoverVisual, drawParamHandle, drawSegmentHighlight, HANDLE_HOVER_FILL } from './editor-transform-handles.js';
import { controlledSegments } from './editor-shape-lattice-interaction.js';
import { distToPrimitive, footOnPrimitive } from './editor-primitives.js';

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
 * T10 ARCHED HOURGLASS / T84 item 6: the ONE declared source of "which outlineDefects joint index
 * is a real declared miter corner, not an accidental break in a tangent chain" -- every consumer of
 * a template's own silhouette (frameCutProfile below, frameContourSilhouette in contour-from-
 * frame.js) must exempt `notTangent` at exactly these indices, or a template whose own corners are
 * genuinely non-tangent (a line meeting an arc, T10; an all-miter outline with NO tangent chain at
 * all, T16/T17) gets flagged as invalid everywhere a tangent chain was merely assumed.
 *
 * `n` = the outline's own primitive count. `outlineDefects`' own `notTangent` index `i` is the
 * joint between primitive i and primitive i+1 (that function's own definition): a corner declared
 * via its outer piece's `:S` is that piece's own START, i.e. the joint BEFORE it (index p-1); a
 * `:E` corner is its own END, i.e. the joint AFTER it (index p itself) -- T84 item 3 (Arched
 * Funnel/Tulip): a CCW-swapped arc (fusion360-quirks skill, "A SketchArc ALWAYS runs counter-
 * clockwise") can make a corner's own outer id end in `:E` rather than `:S`; the only honest name
 * for the corner is whichever end is actually there.
 */
export function declaredMiterJointIndices(tpl, n) {
  const primOf = (bareId) => tpl.seedMap?.find((e) => e.id === bareId)?.prim;
  return new Set((tpl.regions.miters || []).map(([src]) => {
    const isEnd = /:E$/.test(src);
    const p = primOf(src.replace(/^proj_/, '').replace(/:[SE]$/, ''));
    return p == null ? null : (isEnd ? p : p - 1 + n) % n;
  }).filter((i) => i != null));
}

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
  // those declared corners. T84 item 6: `frameContourSilhouette` (contour-from-frame.js) needs the exact same
  // exemption for the SAME reason -- declaredMiterJointIndices below is the one declared source both now call,
  // so they can never drift apart again the way they already had (contour-from-frame.js's own corner list was
  // collapse-only, which a template with no tangent chain at all -- T16/T17 -- never triggers). A no-op for
  // every pre-T10 template: their own corners are always line-line, already exempt inside outlineDefects itself.
  const n = sil.primitives.length;
  const cornerIndices = declaredMiterJointIndices(tpl, n);
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
    insetWindow: insetWindowGeometry(record, ft, record.panelLip, board.widthIn, board.heightIn), // T82 item 2/5, null when off/invalid
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
    const aIdx = (i - 1 + n) % n, a = outerPrims[aIdx], b = outerPrims[i];
    const ta = _travelDir(a, true), tb = _travelDir(b, false);
    if (ta.x * tb.x + ta.y * tb.y > 0.999) continue; // tangent: not a corner
    out.push({ outer: _primStart(b), inner: _primStart(innerPrims[i]), aIdx, bIdx: i });
  }
  return out;
}

/**
 * F31 item 2c (Fred: "on the Flask the side can sometimes be one piece, I'd want a manual
 * toggle"): `tpl`'s own declared joinable joints (template_data.py `regions.joinable`, T14/T15/
 * T16/T17), each as `{id, mirror, anchor, joined}` -- `anchor` is the SAME outer corner point
 * `frameMiters()` itself computes for that joint, so a marker always sits exactly on the drawn
 * corner, never a second independently-computed point that could drift from it.
 *
 * The joint's own `bars` pair (its two bar names) locates WHICH of frameMiters()'s own corners is
 * theirs: a corner's `bIdx` is the travel-order index of whichever bar STARTS there (frameMiters'
 * own `b = outerPrims[i]`), i.e. whichever of the two joined bars' own curves sits at the HIGHER
 * `regions.outline` position (bars are travel-adjacent, so the later one always starts exactly
 * where the earlier one ends). MEASURED, not assumed: `j.miterSource`'s own bare outline id was
 * tried here first and gave the WRONG corner for T14's pinchR (it encodes which Fusion :S/:E
 * endpoint the physical point lands on -- the CCW-arc-swap convention from p02_02_loop.py's own
 * docstring -- a completely different, unrelated numbering from frameMiters()'s own JS-side
 * travel-order `bIdx`; the two conventions do not correspond). Caught by the mirror-symmetry test
 * in tests/frame-join-markers.test.js, not assumed correct from code review alone.
 *
 * None of this session's own declared joinable joints sit at the outline's own wrap boundary
 * (between the last and first bar) -- `Math.max` of the two bars' own outline indices would pick
 * the wrong one there (frameMiters' own `aIdx = (i-1+n)%n` wraps, `Math.max` does not); flagged
 * here rather than handled, since no current declaration needs it.
 *
 * `joined` reads straight off `joinedIds` (the record's own `joinedMiters`) -- pure, no DOM; the
 * Frame-tab-only gate and the actual tap-to-toggle live in the two callers (this file's own draw
 * loop, main/frame-panel.js's own hit-test), the same split frameHandles()/`_hitFrameHandle`
 * already uses.
 */
export function frameJoinMarkers(tpl, outerPrims, innerPrims, joinedIds) {
  const joinable = tpl?.regions?.joinable || [];
  if (!joinable.length || !innerPrims || innerPrims.length !== outerPrims.length) return [];
  const miters = frameMiters(outerPrims, innerPrims);
  const outline = tpl.regions.outline || [];
  const barCurves = new Map((tpl.regions.bars || []).map((b) => [b.name, b.curves || []]));
  const joined = new Set(joinedIds || []);
  const out = [];
  for (const j of joinable) {
    const idxs = (j.bars || []).map((name) => {
      const curves = barCurves.get(name) || [];
      return Math.max(-1, ...curves.map((c) => outline.indexOf(c)));
    });
    if (idxs.some((i) => i < 0)) continue; // a declared bar name this template no longer has
    const bIdx = Math.max(...idxs);
    const m = miters.find((q) => q.bIdx === bIdx);
    if (!m) continue; // the corner isn't currently a real miter (e.g. a degenerate/collapsed corner
    // at an extreme handle value) -- no marker there
    out.push({ id: j.id, mirror: j.mirror, anchor: m.outer, joined: joined.has(j.id) });
  }
  return out;
}

const _primEnd = (p) => (p.type === 'L' ? { ...p.p1 } : { x: p.cx + p.rx * Math.cos(p.theta1 + p.dTheta), y: p.cy + p.ry * Math.sin(p.theta1 + p.dTheta) });

/**
 * F31 item 2c (the advisor's own ruling, 2026-10-03): the straight stock width a JOINED piece
 * needs to be cut in one, in inches -- "the width of the narrowest straight rectangle that
 * contains the merged piece's outline (outer + inner edge), measured perpendicular to the piece's
 * long axis (the chord from one end miter to the other)". `joinId` is one of `tpl`'s own declared
 * `regions.joinable` ids; `null` when it isn't found or the inner profile isn't usable (same
 * "nothing to measure" contract frameJoinMarkers' own callers already expect).
 *
 * The merged piece's own primitives are `outerPrims`/`innerPrims` sliced from the LOWER to the
 * HIGHER of its two bars' own outline indices (travel-adjacent, same derivation frameJoinMarkers
 * uses and for the same reason: a declared `miterSource`'s bare id is the WRONG convention here,
 * see that function's own doc comment) -- the chord runs from the first piece's own outer START to
 * the last piece's own outer END, and every outer+inner point (densely sampled, not just the
 * primitives' own endpoints, since an arc's own bulge can extend past them) is projected onto the
 * chord's own PERPENDICULAR axis; the width is that projection's own (max - min).
 */
export function blankWidthIn(tpl, outerPrims, innerPrims, joinId) {
  const j = (tpl?.regions?.joinable || []).find((q) => q.id === joinId);
  if (!j || !innerPrims || innerPrims.length !== outerPrims.length) return null;
  const outline = tpl.regions.outline || [];
  const barCurves = new Map((tpl.regions.bars || []).map((b) => [b.name, b.curves || []]));
  const idxs = [];
  for (const name of j.bars || []) for (const c of barCurves.get(name) || []) idxs.push(outline.indexOf(c));
  if (!idxs.length || idxs.some((i) => i < 0)) return null;
  const lo = Math.min(...idxs), hi = Math.max(...idxs);
  const outerSlice = outerPrims.slice(lo, hi + 1);
  const innerSlice = innerPrims.slice(lo, hi + 1);
  if (!outerSlice.length) return null;

  const p0 = _primStart(outerSlice[0]);
  const p1 = _primEnd(outerSlice[outerSlice.length - 1]);
  const dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.hypot(dx, dy) || 1;
  const nx = dy / len, ny = -dx / len; // the chord's own perpendicular unit vector

  const pts = [...sampleOutline(outerSlice, 24), _primEnd(outerSlice[outerSlice.length - 1]),
    ...sampleOutline(innerSlice, 24), _primEnd(innerSlice[innerSlice.length - 1])];
  let projMin = Infinity, projMax = -Infinity;
  for (const p of pts) {
    const proj = (p.x - p0.x) * nx + (p.y - p0.y) * ny;
    if (proj < projMin) projMin = proj;
    if (proj > projMax) projMax = proj;
  }
  return projMax - projMin;
}

/** The advisor's own display rule: `blankWidthIn`'s result, rounded to the nearest 1/16 in and
 *  formatted the way a woodworker reads a tape measure ("1 1/16 in", "3/4 in", "2 in" -- never a
 *  decimal, never an unreduced fraction). `null`/non-finite input -> `null` (the caller decides
 *  whether to show anything at all). */
export function formatBlankWidthIn(widthIn) {
  if (!Number.isFinite(widthIn)) return null;
  const sixteenths = Math.round(widthIn * 16);
  const whole = Math.floor(sixteenths / 16);
  const rem = sixteenths % 16;
  if (rem === 0) return `${whole} in`;
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(rem, 16);
  const frac = `${rem / g}/${16 / g}`;
  return whole > 0 ? `${whole} ${frac} in` : `${frac} in`;
}

// H23 item 39 (Fred's own correction mid-task: "a hooked tip is SHORT GRAIN -- fibres across a
// thin tip, it snaps. Size the margin so a tip is never thin, not just 'miter inside the wood'"):
// a miter's own corner legitimately touches its 2 bordering primitives EXACTLY at the vertex (the
// shared endpoint) -- MEASURED (H23 item 39 sweep, all 13 templates): excluding by the MITER's own
// t-fraction near the vertex is the WRONG exclusion, because distance-to-the-adjacent-primitive
// grows roughly linearly with t purely from the corner's own angle (every ordinary corner reads as
// "thin" a hair off its own vertex) -- every template false-failed at every tested margin. The
// right exclusion is keyed to the PRIMITIVE's own arc-length from ITS endpoint: a sample's nearest
// point (footOnPrimitive) on one of the corner's own 2 bordering primitives is EXPECTED to sit near
// that primitive's own end only when it's actually near it; item 38's own finding (T7's eave) is a
// miter re-approaching a FARTHER-OUT part of its own bordering arc, which this does not exclude.
// Both the exclusion radius and the margin floor are declared as a FRACTION of frame_thickness
// `t` (not a fixed inch value) -- the inner-corner offset, and so the miter's own length, scales
// with `t`, and so must the "near the vertex, that's expected" zone and the "that's too thin" zone
// scale with it too, or either one misfires at a frame_thickness far from whatever it was tuned
// against. MEASURED (item 39 sweep, all 13 templates, t=0.75): 0.2 clears every healthy corner's
// own expected near-vertex region with room to spare; see WORK-LOG for the per-template numbers.
export const MITER_CORNER_EXCLUDE_T_FRAC = 0.2;
const MITER_MARGIN_SAMPLES = 40;

// The margin floor itself, also a fraction of `t`. MEASURED (H23 item 39 sweep, all 13 templates,
// 1000 raw Generate draws each x 3 board sizes): every template's own DEFAULT passes with real
// room to spare (T7's own tightest default -- its eave, the corner item 38 already found fragile
// -- sits at 0.054-0.071 of t depending on frame_thickness; every other template's default clears
// 0.14+). 0.04 sits safely under even T7's own tightest default while still rejecting a literal
// re-crossing (0) and near-zero grazes. At this floor, raw (ungated) Generate draws pass ~98-100%
// of the time for every template except T7 (T7: 38.6% at 6x9, ~4% at 7x9/9x12 -- its eave stays
// close to this edge for almost any seed, not just a rare unlucky one; see WORK-LOG for the full
// numbers and GENERATE_MAX_ATTEMPTS' own retry-budget measurement in frame-handles.js).
export const MIN_MITER_MARGIN_T_FRAC = 0.04;

/**
 * The clearance from miter `m` (frameMiters' own `{outer, inner, aIdx, bIdx}`) to the REST of the
 * outer boundary `outerPrims`, sampled along the miter's own length -- the minimum distance from
 * any sampled point to any outer primitive, excluding (for the corner's own 2 bordering
 * primitives only) any sample whose nearest point on that primitive is itself within
 * `cornerExcludeIn` of the shared vertex (see MITER_CORNER_EXCLUDE_T_FRAC above). A literal
 * re-crossing reads as 0 (included for free, not a separate test); a near-graze reads as a small
 * positive number -- the short-grain sliver Fred's correction is about, which a pure crossing
 * test would miss. `cornerExcludeIn` is an absolute distance (the caller derives it from the
 * record's own frame_thickness: `t * MITER_CORNER_EXCLUDE_T_FRAC`) so this stays unit-agnostic,
 * same convention as every other piece of this file that takes `t` pre-resolved (frameFit etc).
 */
export function miterTipMargin(outerPrims, m, cornerExcludeIn, samples = MITER_MARGIN_SAMPLES) {
  const { outer: s0, inner: s1 } = m;
  let best = Infinity;
  for (let i = 0; i <= samples; i++) {
    const f = i / samples;
    const pt = { x: s0.x + (s1.x - s0.x) * f, y: s0.y + (s1.y - s0.y) * f };
    outerPrims.forEach((p, idx) => {
      if (idx === m.aIdx || idx === m.bIdx) {
        const foot = footOnPrimitive(pt, p);
        if (Math.hypot(foot.x - m.outer.x, foot.y - m.outer.y) < cornerExcludeIn) return;
      }
      best = Math.min(best, distToPrimitive(pt, p));
    });
  }
  return best;
}

/**
 * H23 item 39 (Fred-approved guard, "hooked tips are bad for wood grain" -- one declared rule for
 * every template, not a T7 patch): every miter's own straight line (outer corner -> inner corner)
 * must keep at least `minMargin` of clearance from the rest of the outer boundary along its whole
 * length (miterTipMargin), not merely never cross it outright. `miters` is
 * `frameMiters(outerPrims, innerPrims)`'s own output -- reuses the app's existing corner geometry
 * rather than re-deriving it. `t` = the record's own resolved frame_thickness (both the margin
 * floor and the corner's own exclusion radius are fractions of it -- see above).
 */
export function miterStaysInsideWood(outerPrims, miters, t, minMarginTFrac = MIN_MITER_MARGIN_T_FRAC) {
  const cornerExcludeIn = t * MITER_CORNER_EXCLUDE_T_FRAC;
  return miters.every((m) => miterTipMargin(outerPrims, m, cornerExcludeIn) >= t * minMarginTFrac);
}

/**
 * H23 item 63 (Fred-approved guard, 2026-10-03: "stop before undercut"): an outline arc sweeping a
 * half-circle or more is an undercut (a keyhole notch). Fusion's own build refuses it (p02_11's
 * REFLEX ARC check) -- MEASURED: the 22 REFLEX cases of item 61's matrix were the app's OWN outline
 * sweeping 183-291 deg at a handle's range end, not a solver branch flip. One declared rule, read by
 * both Generate and the drag-stop.
 */
export function outlineHasUndercut(outerPrims) {
  return outerPrims.some((p) => p.type === 'A' && Math.abs(p.dTheta) >= Math.PI);
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

/** F35 item 56: the frame as flat vector parts for the SVG download -- the SAME profile, inner edge, wood colour and
 *  miters the canvas draws (_drawFrameProfile below), at full strength: { outlineD, innerD, wood, miters: [d], stroke }.
 *  null with no frame (template None) or a profile with defects. */
export function frameVectorParts(editor) {
  const spec = _provider ? _provider() : null;
  if (!spec || !editor) return null;
  const board = { widthIn: editor._mW, heightIn: editor._mH };
  const prof = frameCutProfile(spec.defs, spec.record, board);
  if (!prof || prof.defects.length) return null;
  const inner = prof.fit.ok ? frameInnerProfile(spec.defs, spec.record, board) : null;
  const ok = !!inner && !inner.defects.length && inner.primitives.length === prof.primitives.length;
  const wood = frameColorFor(spec.record.appearance, spec.defs.appearance?.previewColors?.[spec.record.appearance] || '#d9c9a3');
  return {
    outlineD: prof.pathD, innerD: ok ? primitivesToPathD(inner.primitives) : null, wood, stroke: FRAME_OUTLINE_COLOR,
    miters: ok ? frameMiters(prof.primitives, inner.primitives).map((m) => `M${m.outer.x} ${m.outer.y} L${m.inner.x} ${m.inner.y}`) : [],
  };
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
  const win = insetWindowGeometry(spec.record, ft, spec.record.panelLip, W, H);
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
  editor._frameJoinMarkers = []; // F31 item 2c: reset here (not just inside the Frame-tab branch
  // below), same reason _frameHandles is -- an Artwork-tab redraw must never leave a STALE marker
  // list from the last time the Frame tab was open (MEASURED: it did, before this line existed).
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
    // F31 item 2c (Fred: "the side can sometimes be one piece, I'd want a manual toggle"): one
    // round marker per declared joinable joint, tap (not drag) to toggle -- the Frame tab's own
    // existing round handle look (handleHoverVisual, same radius/hover-grow as a 'radius' param
    // handle), filled when JOINED, hollow (white fill, accent stroke) when SPLIT. Hit-tested by
    // main/frame-panel.js's own pointerdown wiring, same split frameHandles()/_hitFrameHandle uses.
    editor._frameJoinMarkers = inner && !inner.defects.length && inner.primitives.length === prof.primitives.length
      ? frameJoinMarkers(tpl, prof.primitives, inner.primitives, spec.record.joinedMiters)
      : [];
    for (const jm of editor._frameJoinMarkers) {
      const active = editor._frameJoinHover === jm.id;
      const idleFill = jm.joined ? HANDLE_HOVER_FILL : '#ffffff';
      const vis = handleHoverVisual(FRAME_HANDLE_RADIUS, idleFill, HANDLE_HOVER_FILL, active);
      g.circle(vis.radius * 2).center(jm.anchor.x, jm.anchor.y).fill(vis.fill).stroke({ color: vis.stroke, width: 0.03 })
        .addClass('frame-join-marker').attr('data-join-id', jm.id).attr('data-joined', String(jm.joined));
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

/** Two miters' inner corners closer than this fraction of frame_thickness leave an inner edge
 *  Fusion's offset drops (T13 neckWidth:min: 0.028 in), so the miters collide in the build. */
export const MIN_MITER_GAP_T_FRAC = 0.25;

/**
 * H23 item 63 (Fred-approved guard, 2026-10-03: "guard the handles"): do any two miters (each outer
 * corner -> its inner corner, frameMiters' own output) cross, or end closer than
 * MIN_MITER_GAP_T_FRAC x t on the inner edge? A bar shorter than its own two miters (T13
 * neckWidth:min) does this, and Fusion then builds a stray sliver between them.
 */
export function mitersCollide(miters, t) {
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (let i = 0; i < miters.length; i++) {
    for (let j = i + 1; j < miters.length; j++) {
      const p = miters[i].outer, q = miters[i].inner, r = miters[j].outer, s = miters[j].inner;
      // The gap rule is for the two miters at the ENDS OF ONE BAR (consecutive around the loop). Two
      // miters facing each other across the opening (a narrow waist) may sit close -- that's the
      // opening, not a collision (Fred's screenshot, T16: the waist handle froze).
      const sameBar = j === i + 1 || (i === 0 && j === miters.length - 1);
      if (sameBar && Math.hypot(q.x - s.x, q.y - s.y) < MIN_MITER_GAP_T_FRAC * t) return true;
      const d1 = cross(p, q, r), d2 = cross(p, q, s), d3 = cross(r, s, p), d4 = cross(r, s, q);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    }
  }
  return false;
}

/** A primitive's own length (line: chord; arc: this generator's own circular arcs, rx === ry). Same formula
 *  tests/frame-template-*.test.js's own `primLength` already uses for the "no wing risk" check (Template 7's
 *  own finding: a bar segment shorter than frame_thickness causes a "wing" artifact). */
const primLength = (p) => (p.type === 'L' ? Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y) : Math.abs(p.rx * p.dTheta));

/** [Generate]'s checks, in the order they run (frameGenerateFailure names the first that fails). */
export const FRAME_GENERATE_CHECKS = Object.freeze(['innerDefects', 'outerDefects', 'pieceLength', 'undercut', 'mitersCollide', 'miterMargin']);

/**
 * [Generate]'s validity rule (frame-panel.js generateFrame): a drawn seed set is kept only if this passes -- the ONE
 * declaration of it (2026-10-08: tests hand-copied parts of it and drifted -- 37 of 1,500 seeds picked different
 * shapes). `tpl` / `region` / `t` are the caller's (frameCutProfile's region, frame_thickness). Returns isValid(seeds).
 */
export function frameGenerateIsValid(defs, rec, board, tpl, region, t) {
  const failure = frameGenerateFailure(defs, rec, board, tpl, region, t);
  return (s) => failure(s) === null;
}

/**
 * The same rule, saying WHICH check (FRAME_GENERATE_CHECKS) a seed set fails first, or null -- so a test can ask
 * "is the miter margin the only thing in the way" from one evaluation (tests/frame-no-hooked-miters.test.js).
 * The history of each check, as it stood in generateFrame:
 */
export function frameGenerateFailure(defs, rec, board, tpl, region, t) {
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
  return (s) => {
    const inner = frameInnerProfile(defs, { ...rec, seeds: s }, board);
    if (inner && inner.defects.length > 0) return 'innerDefects';
    const outer = frameCutProfile(defs, { ...rec, seeds: realSeedsFor(s) }, board);
    // H23 item 59 (Arched + taper): a high archRise combined with a large taper can shift the shoulder's own
    // tangent point far enough around the waist circle that hourglassConstruction's own waistMajor shortcut
    // (closed-form, correct only for the untapered angular relationship) no longer matches the ACTUAL arc
    // Fusion would need to stay tangent at the shoulder/waist and waist/hip joints -- MEASURED live: a drawn
    // seed with this exact combination produced a real notTangent defect (dot product 0.9983, a ~3.3 deg
    // mismatch) that neither the piece-length nor reflex-arc check below ever looks at. `outer.defects` is the
    // SAME check `frameCutProfile` already computes (outlineDefects, tangency included by default) -- Generate
    // rejects and redraws here, the same declared pattern items 21/23/39 already established for their own
    // measured defect classes, rather than hand-deriving a narrower range for this one combination.
    if (outer.defects.length > 0) return 'outerDefects';
    if (!outer.primitives.every((p) => primLength(p) >= t)) return 'pieceLength';
    if (outlineHasUndercut(outer.primitives)) return 'undercut';
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
    const miters = frameMiters(outer.primitives, inner.primitives);
    if (mitersCollide(miters, t)) return 'mitersCollide';
    return miterStaysInsideWood(outer.primitives, miters, t) ? null : 'miterMargin';
  };
}

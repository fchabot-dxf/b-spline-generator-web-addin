/**
 * editor-cut-tool.js — SE16 ✂ CUT tool (CUT-TOOL-DESIGN.md; Fred's rulings Q1-Q6 + "width is never per segment").
 *
 *   hover a line   -> a marker shows where the cut lands, snapped by the normal H1 GRID / GEOMETRY toggles (Q5)
 *   tap            -> the line splits there into two segments sharing ONE point
 *   tap a joint    -> Join: the two segments become one line again; lattice overrides cleared (Q4)
 *   Alt            -> exact (the pointer projected onto the line)
 *
 * Lines: a lattice rail/tie or a plain <line>. A cut segment is an ordinary line with every attribute of the
 * original (kind, generator ownership, layer, stroke). Nothing records the cut; lattice membership is derived
 * (editor-lattice-chains.js). Width is always the general stroke width (no per-segment width).
 *
 * F27 (Fred: "the scissors tool doesn't cut contour, it should"): a lattice CONTOUR (a rect Lattice border or
 * Shape Lattice contour, preset or Offset-from-frame) is ALSO cuttable now, on the SAME model -- it is N
 * per-segment `<path>` elements instead of `<line>`s (T73/SE14b: one L or A primitive each, sharing
 * `BOUNDARY_REF_ATTR`, ordered by `CONTOUR_SEG_INDEX_ATTR`), and a CLOSED loop, so a cut ALWAYS lands between
 * two existing segments rather than possibly at a true outer end. The primitive split/merge math lives in
 * editor-contour-cut.js (pure, no DOM); this file adds the DOM/attribute bookkeeping a contour cut/join needs
 * that a rail line never does: renumbering every LATER segment's own index, and shifting
 * `pattern.contour.segmentColors[]` (keyed by that SAME index) to match.
 *
 * `cutAt(editor, piece, point)` and `join(editor, joint)` are plain commands (seat A's H6 context menu registers
 * them); the tool's mode handler below is one caller of them.
 */
import { LATTICE_ATTR } from './editor-lattice.js';
import { worldPoint } from './editor-coords.js';
import { getDynamicTolerance } from './editor-hit.js';
import { geometrySnapTargets, GEOMETRY_SNAP_TOL_PX } from './editor-snap-resolver.js';
import { GRID_DEFAULTS } from './editor-grid.js';
import { chainOf, JOINT_TOL, MIN_PIECE_CELLS } from './editor-lattice-chains.js';
import { clearColorOverride, applyColorOverride, pieceKindOf, OVERRIDE_COLOR_ATTR } from './editor-piece-override.js';
import {
  getLayerPattern, PATTERN_DEFAULTS, BOUNDARY_REF_ATTR, CONTOUR_SEG_INDEX_ATTR, _findBoundaryElements,
  resolvePatternLayer, clearContourSegmentColor, latticeColorPool,
} from './editor-lattice-pattern.js';
import { primitiveToPathD } from './editor-shape-lattice-generator.js';
import { pickColorDiffering, VECTOR_COLORS } from './editor-color.js';
import {
  primitiveFromContourD, contourPrimitiveEnds, nearestOnContourPrimitive, splitContourPrimitive, mergeContourPrimitives,
  CONTOUR_JOINT_EPS,
} from './editor-contour-cut.js';
import { isOnVisibleLayer } from './layers.js';
import { haptic } from '../core/haptics.js';

/** The shortest piece a cut may leave: one lattice cell for a lattice rail/tie (the stretch minimum), a hair for a
 *  plain line. */
export const CUT_MIN_PLAIN_IN = 1e-3;
const CUT_MARKER_ID = 'cut-marker';

/** A contour segment: one of the N `<path>` pieces a generated boundary draws (T73/SE14b), never transformed
 *  (regenerateSilhouette writes its `d` directly in world/model coordinates on every param change) -- so unlike
 *  a lattice line, no `worldPoint` bake is needed here. */
const isContourPath = (el) => !!(el && el.node && el.type === 'path' && el.node.hasAttribute(BOUNDARY_REF_ATTR));
/** Every element the cut tool's own hover/tap may target: a line (rail/tie/plain) or a contour path segment. */
const isCuttable = (el) => isLine(el) || isContourPath(el);
const contourPrim = (el) => primitiveFromContourD(el.attr('d'));

/** F27 FINAL RULING (Fred, "All contour: colour only" — see editor-contour-cut.js's own header for the full
 *  chain): what a cut on `el` actually IS, declared once rather than left implicit in the isContourPath branch
 *  below. 'structural': a genuinely separate, independently-draggable piece pinned back together only by an
 *  explicit Fusion Coincident (a rail/tie, or a plain non-lattice line, unchanged by F27). 'colour': the SAME
 *  underlying shape, split into two selectable/colourable curves at the SAME point it was always drawn through
 *  -- never a new draggable piece, never a lattice-chain member (the contour is never wired into
 *  editor-lattice-chains.js's own joint-slide/stretch drag, on purpose: it has no independent position to
 *  drag). Every reader (the min-piece floor below, a future UI affordance) decides by this table, never by
 *  re-deriving "is this a contour" locally. */
export const CUT_KIND = { rail: 'structural', tie: 'structural', line: 'structural', contour: 'colour' };
export function cutKindOf(el) { return isContourPath(el) ? CUT_KIND.contour : CUT_KIND[latticeKind(el)] || CUT_KIND.line; }

const ends = (el) => {
  if (isContourPath(el)) {
    const prim = contourPrim(el);
    return prim ? contourPrimitiveEnds(prim) : [{ x: NaN, y: NaN }, { x: NaN, y: NaN }];
  }
  const n = (k) => parseFloat(el.node.getAttribute(k));
  return [worldPoint(el, { x: n('x1'), y: n('y1') }), worldPoint(el, { x: n('x2'), y: n('y2') })];
};
const isLine = (el) => !!(el && el.node && el.type === 'line');
const latticeKind = (el) => { const k = el && el.node && el.node.getAttribute(LATTICE_ATTR); return k === 'rail' || k === 'tie' ? k : null; };

/** The point of segment a-b nearest `p`, and its parameter t in [0, 1]. */
export function projectOnSegment(a, b, p) {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return { x: a.x + t * dx, y: a.y + t * dy, t };
}

/** Where a cut at pointer `pt` lands on `el`: the H1 toggles, restricted to points ON the line (Q5).
 *  GEOMETRY on: H1's geometry targets lying on the line (tie contacts, crossings, nodes, other segments' ends);
 *  else GRID on: the line's crossings with the grid lines; else (or Alt): the projection itself. */
export function snapOnLine(editor, el, pt, alt = false) {
  const [a, b] = ends(el);
  const proj = projectOnSegment(a, b, pt);
  if (alt) return proj;
  const grid = editor._grid || GRID_DEFAULTS;
  const tol = getDynamicTolerance(editor, GEOMETRY_SNAP_TOL_PX, 'slopPx');
  const nearest = (cands) => {
    let best = null, bestD = tol;
    for (const c of cands) {
      const q = projectOnSegment(a, b, c);
      if (Math.hypot(q.x - c.x, q.y - c.y) > 1e-5 || q.t <= 1e-9 || q.t >= 1 - 1e-9) continue; // on the line, inside it
      const d = Math.hypot(q.x - proj.x, q.y - proj.y);
      if (d <= bestD) { bestD = d; best = { x: q.x, y: q.y, t: q.t }; }
    }
    return best;
  };
  if (grid.geometrySnap) {
    const hit = nearest(geometrySnapTargets(editor, el));
    if (hit) return hit;
  }
  if (grid.gridSnap) {
    const s = grid.spacing || GRID_DEFAULTS.spacing, cands = [];
    const dx = b.x - a.x, dy = b.y - a.y;
    if (Math.abs(dx) > 1e-12) for (let k = Math.ceil(Math.min(a.x, b.x) / s); k * s <= Math.max(a.x, b.x); k++) cands.push({ x: k * s, y: a.y + dy * ((k * s - a.x) / dx) });
    if (Math.abs(dy) > 1e-12) for (let k = Math.ceil(Math.min(a.y, b.y) / s); k * s <= Math.max(a.y, b.y); k++) cands.push({ x: a.x + dx * ((k * s - a.y) / dy), y: k * s });
    const hit = nearest(cands);
    if (hit) return hit;
  }
  return proj;
}

/** F27: the SAME H1 toggles as snapOnLine (Q5), for a contour segment (an L or A primitive) -- GEOMETRY
 *  candidates tested via nearestOnContourPrimitive (works for either type) instead of the line-only
 *  projectOnSegment; GRID candidates are the primitive's own crossings with the grid lines (a line: the SAME
 *  formula snapOnLine uses; an arc: the closed-form circle/grid-line intersection -- this generator's own
 *  contour arcs are always circular, rx===ry, the established invariant editor-contour-cut.js's own header
 *  also relies on). */
export function snapOnContourPiece(editor, el, pt, alt = false) {
  const prim = contourPrim(el);
  if (!prim) return { x: pt.x, y: pt.y, t: 0 };
  const proj = nearestOnContourPrimitive(prim, pt);
  if (alt) return proj;
  const grid = editor._grid || GRID_DEFAULTS;
  const tol = getDynamicTolerance(editor, GEOMETRY_SNAP_TOL_PX, 'slopPx');
  const nearest = (cands) => {
    let best = null, bestD = tol;
    for (const c of cands) {
      const q = nearestOnContourPrimitive(prim, c);
      if (q.d > 1e-5) continue; // on the primitive itself
      const d = Math.hypot(q.x - proj.x, q.y - proj.y);
      if (d <= bestD) { bestD = d; best = q; }
    }
    return best;
  };
  if (grid.geometrySnap) {
    const hit = nearest(geometrySnapTargets(editor, el));
    if (hit) return hit;
  }
  if (grid.gridSnap) {
    const s = grid.spacing || GRID_DEFAULTS.spacing;
    const cands = [];
    if (prim.type === 'L') {
      const [a, b] = contourPrimitiveEnds(prim);
      const dx = b.x - a.x, dy = b.y - a.y;
      if (Math.abs(dx) > 1e-12) for (let k = Math.ceil(Math.min(a.x, b.x) / s); k * s <= Math.max(a.x, b.x); k++) cands.push({ x: k * s, y: a.y + dy * ((k * s - a.x) / dx) });
      if (Math.abs(dy) > 1e-12) for (let k = Math.ceil(Math.min(a.y, b.y) / s); k * s <= Math.max(a.y, b.y); k++) cands.push({ x: a.x + dx * ((k * s - a.y) / dy), y: k * s });
    } else {
      const r = prim.rx; // rx===ry always (this generator's own invariant)
      for (let k = Math.ceil((prim.cx - r) / s); k * s <= prim.cx + r; k++) {
        const disc = r * r - (k * s - prim.cx) ** 2;
        if (disc < 0) continue;
        const dy = Math.sqrt(disc);
        cands.push({ x: k * s, y: prim.cy + dy }, { x: k * s, y: prim.cy - dy });
      }
      for (let k = Math.ceil((prim.cy - r) / s); k * s <= prim.cy + r; k++) {
        const disc = r * r - (k * s - prim.cy) ** 2;
        if (disc < 0) continue;
        const dx = Math.sqrt(disc);
        cands.push({ x: prim.cx + dx, y: k * s }, { x: prim.cx - dx, y: k * s });
      }
    }
    const hit = nearest(cands);
    if (hit) return hit;
  }
  return proj;
}

function _minPiece(editor, el) {
  if (!latticeKind(el)) return CUT_MIN_PLAIN_IN;
  return MIN_PIECE_CELLS * ((getLayerPattern(editor) || PATTERN_DEFAULTS).spacing || PATTERN_DEFAULTS.spacing);
}

function _commit(editor) {
  if (typeof editor.pushState === 'function') editor.pushState();
  if (typeof editor._notifyChange === 'function') editor._notifyChange('commit');
  else if (editor._onChange) editor._onChange();
  haptic('cutJoin'); // H13: cutAt/join both route through here, only on genuine success
}

/** F27 item 1 ADD: the CURRENT colour of whatever OTHER cuttable piece's own end sits at `point` (within its
 *  own kind's touching tolerance), excluding `exclude` -- the "far neighbour" a freshly cut piece's own
 *  immediate recolour (below) must also differ from, alongside its own new cut sibling. Kind-agnostic (a
 *  rail's far neighbour may be a tie end or another rail segment; a contour segment's far neighbour is
 *  whatever the CALLER already resolved by sibling order, not this geometric scan -- see _cutContourAt).
 *  Null for a true free end (nothing there). */
function _touchingColorAt(editor, point, exclude) {
  for (const el of editor._sketchLayer.children().toArray()) {
    if (exclude.includes(el) || !isCuttable(el)) continue;
    const tol = isContourPath(el) ? CONTOUR_JOINT_EPS : JOINT_TOL;
    if (ends(el).some((p) => Math.hypot(p.x - point.x, p.y - point.y) < tol)) return el.attr('stroke');
  }
  return null;
}

/** F27 item 1 ADD (Fred: "when cutting with scissors, I'd like the colour of one segment to change right away,
 *  since it's always for that reason I do; it also helps to know where I cut"): recolours `second` -- the
 *  piece on the FAR side of the cut from the original segment's own start, declared consistently here (both
 *  cutAt and _cutContourAt always hand this [first, second] in that same drawn order, never `first`, never
 *  both) -- to a colour differing from BOTH `first` (its own brand-new cut sibling) and `farNeighbourColor`
 *  (whatever ALREADY touches its own far end; null for a true free end, so only the first constraint applies).
 *  Called BEFORE `_commit`, so it lands in the SAME undo step as the cut itself (Q1-style "one undo step"),
 *  never a second one. `rng` is test-injectable (defaults to Math.random), the SAME `pickColorDiffering`
 *  (editor-color.js) the T81 item 3 randomize-colours button also draws from, over the SAME pool (T81 item 8:
 *  the lattice's own Rails/Ties/Nodes colours, `latticeColorPool`). Contour: writes BOTH the live DOM stroke and
 *  `pattern.contour.segmentColors[]` (the field regenerateSilhouette's own per-segment repaint reads on every
 *  call, same as a manual per-segment pick already does) -- never a second colour store. Rail/tie: the normal
 *  override mechanism (editor-piece-override.js). A plain (non-lattice) line: a direct stroke write, same as
 *  Direct-edit's own `setColor` uses for a shape with no "layer default" to preserve behind it. */
function _recolorSecondAfterCut(editor, first, second, farNeighbourColor, rng) {
  // T81 item 8: the pool is the lattice's own Rails/Ties/Nodes colours; a plain line on a layer with no
  // lattice pattern has none of its own, so it keeps the app's general palette.
  const layer = resolvePatternLayer(editor, second.attr('data-layer'));
  const pool = layer && layer.pattern ? latticeColorPool(layer.pattern) : VECTOR_COLORS.flat();
  const hex = pickColorDiffering(pool, [first.attr('stroke'), farNeighbourColor], rng);
  if (isContourPath(second)) {
    const i = _contourIndex(second);
    const colors = layer && layer.pattern && layer.pattern.contour && layer.pattern.contour.segmentColors;
    if (Array.isArray(colors)) colors[i] = hex;
    second.stroke({ color: hex });
    return;
  }
  const kind = pieceKindOf(second);
  if (kind) applyColorOverride(second, kind, hex);
  else second.stroke({ color: hex });
}

/**
 * CUT: split line `piece` at `point` (already on it; snapOnLine gives one). Both new ends are written from the SAME
 * numbers. The new segment is a clone (every attribute: kind, ownership, layer, stroke, colour override), inserted
 * right after the original. One undo step. Returns [first, second], or null when a piece would be shorter than the
 * minimum (a lattice piece: one cell).
 */
export function cutAt(editor, piece, point, rng = Math.random) {
  if (isContourPath(piece)) return _cutContourAt(editor, piece, point, rng);
  if (!isLine(piece)) return null;
  const [a, b] = ends(piece);
  const min = _minPiece(editor, piece);
  if (Math.hypot(point.x - a.x, point.y - a.y) < min - 1e-9 || Math.hypot(point.x - b.x, point.y - b.y) < min - 1e-9) return null;
  if (piece.attr('transform')) piece.attr({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, transform: null }); // bake, like a lattice move
  const second = piece.clone();
  second.insertAfter(piece);
  if (second.node.hasAttribute('id')) second.node.removeAttribute('id');
  piece.attr({ x2: point.x, y2: point.y });
  second.attr({ x1: point.x, y1: point.y });
  const farColor = _touchingColorAt(editor, b, [piece, second]);
  _recolorSecondAfterCut(editor, piece, second, farColor, rng);
  _commit(editor);
  return [piece, second];
}

// ─── F27: the SAME cut/join model, for a CONTOUR segment (a <path>, not a <line>) ─────────────────────────────

/** Every sibling of contour segment `el` (same BOUNDARY_REF_ATTR), in CONTOUR_SEG_INDEX_ATTR order -- the SAME
 *  lookup regenerateSilhouette's own reader, `_findBoundaryElements`, already uses; never a second ordering. */
const _contourSiblings = (editor, el) => _findBoundaryElements(editor, el.node.getAttribute(BOUNDARY_REF_ATTR));
const _contourIndex = (el) => { const raw = el.node.getAttribute(CONTOUR_SEG_INDEX_ATTR); return raw == null ? -1 : Number(raw); };

/**
 * F27 CUT (contour): split segment `piece`'s own primitive at `point` (already on it; snapOnContourPiece gives
 * one) into two, sharing that exact point. Every LATER sibling's own CONTOUR_SEG_INDEX_ATTR shifts up by one to
 * make room, and `pattern.contour.segmentColors[]` (the SAME index) grows the same way -- a DUPLICATE of the
 * cut segment's own entry inserted right after it, so a stored override (if any) survives on BOTH new pieces,
 * matching the DOM clone's own live `stroke` colour (rails' "every attribute" convention, here for a path).
 * One undo step. Returns [first, second], or null when the point sits too close to either end (the SAME plain-
 * line floor, `CUT_MIN_PLAIN_IN` -- a contour has no lattice-cell concept of its own).
 */
function _cutContourAt(editor, piece, point, rng = Math.random) {
  const prim = contourPrim(piece);
  if (!prim) return null;
  const [a, b] = contourPrimitiveEnds(prim);
  if (Math.hypot(point.x - a.x, point.y - a.y) < CUT_MIN_PLAIN_IN - 1e-9 || Math.hypot(point.x - b.x, point.y - b.y) < CUT_MIN_PLAIN_IN - 1e-9) return null;
  const [first, second] = splitContourPrimitive(prim, point);
  if (!first || !second) return null;
  // F27 item 1 ADD: the array-ORDER "next" sibling (not a numeric index -- about to shift below), captured
  // BEFORE the renumbering loop; its own colour is the far neighbour the new second piece must also differ
  // from. n===1 (a degenerate single-segment contour) has no real "next" -- guarded, not assumed away.
  const siblingsBefore = _contourSiblings(editor, piece);
  const nextSibling = siblingsBefore[(siblingsBefore.indexOf(piece) + 1) % siblingsBefore.length];
  const farColor = nextSibling !== piece ? nextSibling.attr('stroke') : null;
  const i = _contourIndex(piece);
  for (const s of siblingsBefore) {
    const si = _contourIndex(s);
    if (si > i) s.attr(CONTOUR_SEG_INDEX_ATTR, si + 1);
  }
  const secondEl = piece.clone();
  secondEl.insertAfter(piece);
  if (secondEl.node.hasAttribute('id')) secondEl.node.removeAttribute('id');
  piece.attr('d', primitiveToPathD(first));
  secondEl.attr('d', primitiveToPathD(second));
  secondEl.attr(CONTOUR_SEG_INDEX_ATTR, i + 1);
  const layer = resolvePatternLayer(editor, piece.attr('data-layer'));
  const colors = layer && layer.pattern && layer.pattern.contour && layer.pattern.contour.segmentColors;
  if (Array.isArray(colors)) colors.splice(i + 1, 0, colors[i]);
  _recolorSecondAfterCut(editor, piece, secondEl, farColor, rng);
  _commit(editor);
  return [piece, secondEl];
}

/**
 * F27 JOIN (contour): the two segments merge back into `mergeContourPrimitives`' own result, in whichever
 * drawn order they actually touch (p:end==q:start, or the reverse) -- the LOWER-index one keeps its place and
 * spans both, the higher-index one is removed and every sibling AFTER it shifts its own index down by one.
 * Q4 (Fred's ruling, same as a rail Join): the merged segment's own colour override is cleared entirely (never
 * either side's) -- `segmentColors[]` shrinks by the removed index (the shift, matching the DOM renumber),
 * then `clearContourSegmentColor` deletes whatever the SURVIVING index still held (own index untouched by that
 * shift, since it is always the lower of the two) and repaints the contour's own default. One undo step.
 */
function _joinContour(editor, p, q) {
  const primP = contourPrim(p), primQ = contourPrim(q);
  if (!primP || !primQ) return null;
  const [, pEnd] = contourPrimitiveEnds(primP), [qStart] = contourPrimitiveEnds(primQ);
  const forward = Math.hypot(pEnd.x - qStart.x, pEnd.y - qStart.y) < JOINT_TOL;
  const merged = forward ? mergeContourPrimitives(primP, primQ) : mergeContourPrimitives(primQ, primP);
  if (!merged) return null;
  const [keepEl, dropEl] = forward ? [p, q] : [q, p];
  const dropIndex = _contourIndex(dropEl);
  const siblings = _contourSiblings(editor, p);
  keepEl.attr('d', primitiveToPathD(merged));
  dropEl.remove();
  for (const s of siblings) {
    if (s === dropEl) continue;
    const si = _contourIndex(s);
    if (si > dropIndex) s.attr(CONTOUR_SEG_INDEX_ATTR, si - 1);
  }
  const layer = resolvePatternLayer(editor, keepEl.attr('data-layer'));
  const colors = layer && layer.pattern && layer.pattern.contour && layer.pattern.contour.segmentColors;
  if (Array.isArray(colors)) colors.splice(dropIndex, 1);
  const defaultColors = { ...PATTERN_DEFAULTS.colors, ...((getLayerPattern(editor) || {}).colors || {}) };
  clearContourSegmentColor(editor, keepEl, defaultColors.contour);
  _commit(editor);
  return keepEl;
}

/** The two segments meeting end-to-end at `point` (a joint), or null. Lattice pieces: the two segments of one
 *  chain touching there. Plain lines: two same-layer non-lattice lines with an end there, collinear. F27
 *  contour: two ADJACENT segments (consecutive CONTOUR_SEG_INDEX_ATTR, wraparound) of the SAME boundary whose
 *  primitives actually merge (mergeContourPrimitives) -- an ORDINARY shape corner (say a horn meeting a
 *  shoulder arc) is also two adjacent segments touching there, but refuses to merge (different curve), so it
 *  never becomes a false Join target; only a genuine earlier CUT's own two halves do. */
export function jointAt(editor, point, tol = JOINT_TOL) {
  const pieces = editor._sketchLayer.children().toArray().filter(isCuttable);
  // F27: a contour piece's own endpoint went through primitiveToPathD's `_fmt` rounding (3 decimals) on write,
  // so its "same point" floor is that grain, not JOINT_TOL (1e-6, exact for a rail/tie/plain line's own
  // unrounded numeric attrs) — MEASURED: a cut's own new joint failed the 1e-6 touching test by ~5e-4.
  const touching = pieces.filter((el) => {
    const t = isContourPath(el) ? Math.max(tol, CONTOUR_JOINT_EPS) : tol;
    return ends(el).some((p) => Math.hypot(p.x - point.x, p.y - point.y) < t);
  });
  for (let i = 0; i < touching.length; i++) {
    for (let j = i + 1; j < touching.length; j++) {
      const [p, q] = [touching[i], touching[j]];
      if (isContourPath(p) && isContourPath(q)) {
        if (p.node.getAttribute(BOUNDARY_REF_ATTR) !== q.node.getAttribute(BOUNDARY_REF_ATTR)) continue;
        const n = _contourSiblings(editor, p).length;
        const ip = _contourIndex(p), iq = _contourIndex(q);
        if ((ip + 1) % n !== iq && (iq + 1) % n !== ip) continue;
        const primP = contourPrim(p), primQ = contourPrim(q);
        const merged = (ip + 1) % n === iq ? mergeContourPrimitives(primP, primQ) : mergeContourPrimitives(primQ, primP);
        if (merged) return [p, q];
        continue;
      }
      if (isContourPath(p) || isContourPath(q)) continue; // a rail/tie end merely touching the contour is an attachment, not a cut joint
      const kp = latticeKind(p), kq = latticeKind(q);
      if (kp !== kq) continue;
      if (kp) {
        const chain = chainOf(editor, p);
        if (chain && chain.segments.some((s) => s.el === q)) return [p, q];
        continue;
      }
      if (p.node.getAttribute('data-layer') !== q.node.getAttribute('data-layer')) continue;
      const [a, b] = ends(p), [c, d] = ends(q);
      const cross = (u, v, w) => (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x);
      if (Math.abs(cross(a, b, c)) < 1e-9 && Math.abs(cross(a, b, d)) < 1e-9) return [p, q];
    }
  }
  return null;
}

/**
 * JOIN: the two segments of `joint` (jointAt's pair, or a point) become ONE line again: the first keeps its place
 * and spans both, the second is removed. A lattice piece's colour override is cleared (Q4: back to the lattice
 * default; width is always the general stroke width). One undo step. Returns the joined line, or null.
 */
export function join(editor, joint) {
  const pair = Array.isArray(joint) ? joint : jointAt(editor, joint);
  if (!pair) return null;
  const [p, q] = pair;
  if (isContourPath(p) && isContourPath(q)) return _joinContour(editor, p, q);
  const [a, b] = ends(p), [c, d] = ends(q);
  const shared = [a, b].find((x) => [c, d].some((y) => Math.hypot(x.x - y.x, x.y - y.y) < JOINT_TOL));
  if (!shared) return null;
  const farP = shared === a ? b : a;
  const farQ = Math.hypot(c.x - shared.x, c.y - shared.y) < JOINT_TOL ? d : c;
  p.attr({ x1: farP.x, y1: farP.y, x2: farQ.x, y2: farQ.y, transform: null });
  q.remove();
  const kind = pieceKindOf(p);
  if (kind && p.node.hasAttribute(OVERRIDE_COLOR_ATTR)) {
    const colors = { ...PATTERN_DEFAULTS.colors, ...((getLayerPattern(editor) || {}).colors || {}) };
    clearColorOverride(p, kind, colors[kind]);
  }
  _commit(editor);
  return p;
}

// ─── the tool (mode 'cut') ────────────────────────────────────────────────────────────────────────────────────

/** The nearest cuttable piece under `pt` (visible layers) — a line (rail/tie/plain) or, F27, a contour path
 *  segment. A lattice node sitting on a rail (a tie contact, the very place a cut often goes) must not hide the
 *  rail from the tool. */
function _lineUnder(editor, pt) {
  const tol = getDynamicTolerance(editor, 10, 'slopPx');
  // a line the point is INSIDE of beats one that merely ends there (a tie ending on a rail: tapping that contact cuts
  // the rail); among equals the topmost (last drawn) wins, the one the user sees. "At an end" = within a click's own
  // jitter (clickThresholdPx), NOT the whole hit slop: on touch the slop spans more than a cell at phone zoom, and a
  // tap ON a tie one cell from its rail must cut the tie (F19; the touch point is already the precise marker, SE7m)
  const endR = getDynamicTolerance(editor, 3, 'clickThresholdPx');
  let best = null, bestScore = Infinity;
  for (const el of editor._sketchLayer.children().toArray()) {
    if (!isCuttable(el) || !isOnVisibleLayer(editor, el)) continue;
    let a, b, q;
    if (isContourPath(el)) {
      const prim = contourPrim(el);
      if (!prim) continue;
      [a, b] = contourPrimitiveEnds(prim);
      q = nearestOnContourPrimitive(prim, pt);
    } else {
      [a, b] = ends(el);
      q = projectOnSegment(a, b, pt);
    }
    const d = Math.hypot(q.x - pt.x, q.y - pt.y);
    if (d > tol) continue;
    const atEnd = Math.min(Math.hypot(pt.x - a.x, pt.y - a.y), Math.hypot(pt.x - b.x, pt.y - b.y)) <= endR;
    const score = d + (atEnd ? tol : 0);
    if (score <= bestScore) { bestScore = score; best = el; }
  }
  return best;
}

/** What a tap at `pt` would do: { action:'join', joint } on a joint, { action:'cut', el, at } on a piece, or
 *  null. F27: `el` may be a contour path segment, snapped through snapOnContourPiece (arc-aware) instead of
 *  the line-only snapOnLine. */
export function cutIntent(editor, pt, alt = false) {
  const el = _lineUnder(editor, pt);
  if (!el) return null;
  const at = isContourPath(el) ? snapOnContourPiece(editor, el, pt, alt) : snapOnLine(editor, el, pt, alt);
  const tol = getDynamicTolerance(editor, 10, 'slopPx');
  for (const end of [...ends(el)]) {
    if (Math.hypot(end.x - at.x, end.y - at.y) <= tol) {
      const joint = jointAt(editor, end);
      if (joint) return { action: 'join', joint, at: end };
    }
  }
  return { action: 'cut', el, at };
}

export function clearCutMarker(editor) {
  const layer = editor._handleLayer;
  const m = layer && layer.findOne ? layer.findOne('#' + CUT_MARKER_ID) : null;
  if (m) m.remove();
}

function _drawCutMarker(editor, intent) {
  clearCutMarker(editor);
  if (!intent || !editor._handleLayer) return;
  const r = getDynamicTolerance(editor, 9, 'slopPx');
  const g = editor._handleLayer.group().id(CUT_MARKER_ID).attr('pointer-events', 'none');
  const color = intent.action === 'join' ? '#1e88e5' : '#ff6f00';
  g.circle(2 * r).center(intent.at.x, intent.at.y).fill('none').stroke({ color, width: r / 3 });
  if (intent.action === 'join') g.rect(r, r).center(intent.at.x, intent.at.y).fill('#fff').stroke({ color, width: r / 4 }).rotate(45);
}

export const cutHandler = {
  hover(editor, pt) { _drawCutMarker(editor, cutIntent(editor, pt)); }, // the snapped landing point (Alt: exact, on the tap)
  start(editor, pt, e) {
    const intent = cutIntent(editor, pt, !!(e && e.altKey));
    clearCutMarker(editor);
    if (!intent) return;
    if (intent.action === 'join') join(editor, intent.joint);
    else cutAt(editor, intent.el, intent.at);
  },
};

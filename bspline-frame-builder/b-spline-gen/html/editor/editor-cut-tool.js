/**
 * editor-cut-tool.js — SE16 ✂ CUT tool (CUT-TOOL-DESIGN.md; Fred's rulings Q1-Q6 + "width is never per segment").
 *
 *   hover a line   -> a marker shows where the cut lands, snapped by the normal H1 GRID / GEOMETRY toggles (Q5)
 *   tap            -> the line splits there into two segments sharing ONE point
 *   tap a joint    -> Join: the two segments become one line again; lattice overrides cleared (Q4)
 *   Alt            -> exact (the pointer projected onto the line)
 *
 * Lines only: a lattice rail/tie or a plain <line>. A cut segment is an ordinary line with every attribute of the
 * original (kind, generator ownership, layer, stroke). Nothing records the cut; lattice membership is derived
 * (editor-lattice-chains.js). Width is always the general stroke width (no per-segment width).
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
import { clearColorOverride, pieceKindOf, OVERRIDE_COLOR_ATTR } from './editor-piece-override.js';
import { getLayerPattern, PATTERN_DEFAULTS } from './editor-lattice-pattern.js';
import { isOnVisibleLayer } from './layers.js';

/** The shortest piece a cut may leave: one lattice cell for a lattice rail/tie (the stretch minimum), a hair for a
 *  plain line. */
export const CUT_MIN_PLAIN_IN = 1e-3;
const CUT_MARKER_ID = 'cut-marker';

const ends = (el) => {
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

function _minPiece(editor, el) {
  if (!latticeKind(el)) return CUT_MIN_PLAIN_IN;
  return MIN_PIECE_CELLS * ((getLayerPattern(editor) || PATTERN_DEFAULTS).spacing || PATTERN_DEFAULTS.spacing);
}

function _commit(editor) {
  if (typeof editor.pushState === 'function') editor.pushState();
  if (typeof editor._notifyChange === 'function') editor._notifyChange('commit');
  else if (editor._onChange) editor._onChange();
}

/**
 * CUT: split line `piece` at `point` (already on it; snapOnLine gives one). Both new ends are written from the SAME
 * numbers. The new segment is a clone (every attribute: kind, ownership, layer, stroke, colour override), inserted
 * right after the original. One undo step. Returns [first, second], or null when a piece would be shorter than the
 * minimum (a lattice piece: one cell).
 */
export function cutAt(editor, piece, point) {
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
  _commit(editor);
  return [piece, second];
}

/** The two lines meeting end-to-end, collinear, at `point` (a joint), or null. Lattice pieces: the two segments of
 *  one chain touching there. Plain lines: two same-layer non-lattice lines with an end there, collinear. */
export function jointAt(editor, point, tol = JOINT_TOL) {
  const lines = editor._sketchLayer.children().toArray().filter(isLine);
  const touching = lines.filter((el) => ends(el).some((p) => Math.hypot(p.x - point.x, p.y - point.y) < tol));
  for (let i = 0; i < touching.length; i++) {
    for (let j = i + 1; j < touching.length; j++) {
      const [p, q] = [touching[i], touching[j]];
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

/** The nearest LINE under `pt` (visible layers). Lines only: a lattice node sitting on a rail (a tie contact, the
 *  very place a cut often goes) must not hide the rail from the tool. */
function _lineUnder(editor, pt) {
  const tol = getDynamicTolerance(editor, 10, 'slopPx');
  // a line the point is INSIDE of beats one that merely ends there (a tie ending on a rail: tapping that contact cuts
  // the rail); among equals the topmost (last drawn) wins, the one the user sees
  let best = null, bestScore = Infinity;
  for (const el of editor._sketchLayer.children().toArray()) {
    if (!isLine(el) || !isOnVisibleLayer(editor, el)) continue;
    const [a, b] = ends(el);
    const q = projectOnSegment(a, b, pt);
    const d = Math.hypot(q.x - pt.x, q.y - pt.y);
    if (d > tol) continue;
    const atEnd = Math.min(Math.hypot(pt.x - a.x, pt.y - a.y), Math.hypot(pt.x - b.x, pt.y - b.y)) <= tol;
    const score = d + (atEnd ? tol : 0);
    if (score <= bestScore) { bestScore = score; best = el; }
  }
  return best;
}

/** What a tap at `pt` would do: { action:'join', joint } on a joint, { action:'cut', el, at } on a line, or null. */
export function cutIntent(editor, pt, alt = false) {
  const el = _lineUnder(editor, pt);
  if (!el) return null;
  const at = snapOnLine(editor, el, pt, alt);
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

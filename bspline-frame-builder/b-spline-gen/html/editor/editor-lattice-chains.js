/**
 * editor-lattice-chains.js — SE16 (✂ CUT tool, CUT-TOOL-DESIGN.md §3/§6): lattice membership by DERIVATION.
 *
 * A cut rail is simply several rail lines; nothing records that they were one. At drag start (and at Send,
 * editor-sketch-manifest.js latticeFromDrawn) the pieces are grouped again from their geometry:
 *   same kind (rail | tie) AND collinear (same row / column) AND touching end-to-end (within JOINT_TOL)
 *   -> one CHAIN. A gap = separate chains. Colour is not an input: it can never split a rail.
 * A chain then drags exactly like the uncut piece (Fred: "in lattice move together"):
 *   - body grab of any segment -> the whole chain moves (attached ties derived against its full extent);
 *   - a TRUE outer end -> stretches (unchanged);
 *   - a JOINT (two segments' touching ends) -> slides ALONG the axis, both ends together (Fred Q3), so no gap
 *     can ever open.
 * Pure helpers first; the drag helpers (withChain / writeChainRow / writeChainTranslate / updateJointSlide) are
 * called from editor-interaction.js's lattice-move path through small hooks.
 */
import { LATTICE_ATTR, orient, toLatticeFractional, fromLattice } from './editor-lattice.js';
import { worldPoint } from './editor-coords.js';
import { getElementLayer } from './layers.js';

/** The one "same point" tolerance (model inches), SE7i's own attachment epsilon (editor-interaction.js
 *  _sameWorldPoint, editor-lattice.js sameRow). Both joint ends are written from one number, and lattice moves
 *  re-snap to lattice coordinates, so joints never drift apart. */
export const JOINT_TOL = 1e-6;

/** The shortest segment a cut lattice line may have, in lattice cells: what a cut may leave, how far a joint slide
 *  may go, and how close a pushed joint stays ahead of a rail (F19). */
export const MIN_PIECE_CELLS = 1;

const same = (p, q, tol = JOINT_TOL) => Math.abs(p.x - q.x) < tol && Math.abs(p.y - q.y) < tol;

/** `pieces` = [{ el, kind, a:{x,y}, b:{x,y} }] (world) -> [{ kind, axis:'x'|'y'|null, segments:[piece…] }], each
 *  chain's segments ordered along its axis; a diagonal piece is its own chain. Pure. */
export function latticeChains(pieces, tol = JOINT_TOL) {
  const lines = new Map();
  const chains = [];
  for (const p of pieces) {
    const axis = Math.abs(p.a.y - p.b.y) < tol ? 'x' : (Math.abs(p.a.x - p.b.x) < tol ? 'y' : null);
    if (!axis) { chains.push({ kind: p.kind, axis: null, segments: [p] }); continue; }
    const fixed = axis === 'x' ? p.a.y : p.a.x;
    const key = `${p.kind}|${axis}|${Math.round(fixed / tol)}`;
    if (!lines.has(key)) lines.set(key, { kind: p.kind, axis, pieces: [] });
    lines.get(key).pieces.push(p);
  }
  for (const { kind, axis, pieces: row } of lines.values()) {
    const lo = (p) => Math.min(p.a[axis], p.b[axis]);
    const hi = (p) => Math.max(p.a[axis], p.b[axis]);
    row.sort((p, q) => lo(p) - lo(q));
    let cur = null;
    for (const p of row) {
      if (cur && Math.abs(lo(p) - hi(cur.segments[cur.segments.length - 1])) < tol) cur.segments.push(p);
      else { cur = { kind, axis, segments: [p] }; chains.push(cur); }
    }
  }
  return chains;
}

/** Split segment a-b at point p (on it): [[a, p], [p, b]], both halves sharing the SAME p. Pure. */
export function splitLine(a, b, p) {
  return [[{ ...a }, { x: p.x, y: p.y }], [{ x: p.x, y: p.y }, { ...b }]];
}

/** Every live lattice line (rail/tie) of `kind` on `layerId`, with its world endpoints. */
export function linesOnLayer(editor, layerId, kind) {
  if (!editor || !editor._sketchLayer) return [];
  const out = [];
  for (const ch of editor._sketchLayer.children().toArray()) {
    if (!ch || !ch.node || ch.type !== 'line') continue;
    if (ch.node.getAttribute(LATTICE_ATTR) !== kind || getElementLayer(ch) !== layerId) continue;
    const n = (k) => parseFloat(ch.node.getAttribute(k));
    const a = worldPoint(ch, { x: n('x1'), y: n('y1') }), b = worldPoint(ch, { x: n('x2'), y: n('y2') });
    if ([a.x, a.y, b.x, b.y].some(Number.isNaN)) continue;
    out.push({ el: ch, kind, a, b });
  }
  return out;
}

/** The chain `el` (a lattice rail/tie line) belongs to, or null. */
export function chainOf(editor, el) {
  const kind = el && el.node && el.node.getAttribute(LATTICE_ATTR);
  if (kind !== 'rail' && kind !== 'tie') return null;
  return latticeChains(linesOnLayer(editor, getElementLayer(el), kind)).find((c) => c.segments.some((s) => s.el === el)) || null;
}

// ─── chain-aware lattice drags (hooks from editor-interaction.js) ────────────────────────────────────────────────

const canonOf = (seg, spacing, orientation) => ({
  a: orient(toLatticeFractional(seg.a, spacing), orientation), b: orient(toLatticeFractional(seg.b, spacing), orientation),
});

/** Every lattice node (any layer of the editor) sitting exactly at one of `points` (world). */
function nodesAt(editor, points) {
  const out = [];
  for (const ch of editor._sketchLayer.children().toArray()) {
    if (!ch || !ch.node || ch.node.getAttribute(LATTICE_ATTR) !== 'node') continue;
    const c = worldPoint(ch, { x: parseFloat(ch.node.getAttribute('cx')), y: parseFloat(ch.node.getAttribute('cy')) });
    if (points.some((p) => same(p, c))) out.push({ el: ch, world: c });
  }
  return out;
}

/**
 * `move` = what _beginLatticeMove built for a rail/tie grab. When the grabbed piece is one segment of a chain of
 * 2+, returns the chain-aware move (same shape, plus `chain` / `excludeSet`, and mode 'joint' for a joint grab);
 * otherwise `move` unchanged. A rail body move also gets `tiePush` (F19, below), cut or not.
 */
export function withChain(editor, move) {
  const out = _chainMove(editor, move);
  return out && out.kind === 'rail' && out.mode === 'move' ? withTiePush(editor, out) : out;
}

function _chainMove(editor, move) {
  if (!move || (move.kind !== 'rail' && move.kind !== 'tie')) return move;
  const chain = chainOf(editor, move.el);
  if (!chain || chain.segments.length < 2) return move;
  const { spacing, orientation } = move;
  const segs = chain.segments.map((s) => ({ el: s.el, a: s.a, b: s.b, canon: canonOf(s, spacing, orientation) }));
  const out = { ...move, chain: segs, excludeSet: new Set(segs.map((s) => s.el)) };
  const axis = move.kind === 'rail' ? 'i' : 'j'; // the piece's own running axis, canonical
  if (move.mode === 'stretch') {
    const grabbed = segs.find((s) => s.el === move.el);
    const endWorld = move.end === 'a' ? grabbed.a : grabbed.b;
    const other = segs.find((s) => s.el !== move.el && (same(s.a, endWorld) || same(s.b, endWorld)));
    if (!other) return out; // a TRUE outer end: stretch it, exactly as before
    return { ...out, mode: 'joint', axis, joint: [
      { el: grabbed.el, end: move.end, canon: grabbed.canon },
      { el: other.el, end: same(other.a, endWorld) ? 'a' : 'b', canon: other.canon },
    ] };
  }
  if (move.kind === 'rail') { // body move: the WHOLE rail's extent decides which ties/nodes ride along
    const is = segs.flatMap((s) => [s.canon.a.i, s.canon.b.i]);
    const j = segs[0].canon.a.j;
    return { ...out, railCanon: { a: { i: Math.min(...is), j }, b: { i: Math.max(...is), j } } };
  }
  // tie body move: every node on any segment's ends rides along
  const nodes = nodesAt(editor, segs.flatMap((s) => [s.a, s.b]))
    .map((n) => ({ el: n.el, point: orient(toLatticeFractional(n.world, spacing), orientation) }));
  return { ...out, nodes };
}

/** A chain rail move: every segment takes the new row, keeping its own extent. */
export function writeChainRow(move, newRow) {
  const { spacing, orientation } = move;
  for (const s of move.chain) {
    const a = fromLattice(orient({ i: s.canon.a.i, j: newRow }, orientation), spacing);
    const b = fromLattice(orient({ i: s.canon.b.i, j: newRow }, orientation), spacing);
    s.el.attr({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
}

/** A chain tie move: every segment (and its nodes) translated by the same canonical delta. */
export function writeChainTranslate(move, di, dj) {
  const { spacing, orientation } = move;
  const at = (p) => fromLattice(orient({ i: p.i + di, j: p.j + dj }, orientation), spacing);
  for (const s of move.chain) {
    const a = at(s.canon.a), b = at(s.canon.b);
    s.el.attr({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
  for (const n of move.nodes || []) { const p = at(n.point); n.el.center(p.x, p.y); }
}

/**
 * A joint slide: the two touching ends move TOGETHER along the chain's axis to `target` (canonical), clamped so
 * each of the two segments keeps at least one lattice cell (their far ends are fixed).
 */
export function updateJointSlide(move, target) {
  const { spacing, orientation, axis } = move;
  const far = move.joint.map((s) => s.canon[s.end === 'a' ? 'b' : 'a'][axis]);
  const lo = Math.min(...far) + MIN_PIECE_CELLS, hi = Math.max(...far) - MIN_PIECE_CELLS;
  const v = lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, target));
  for (const s of move.joint) {
    const p = { ...s.canon[s.end], [axis]: v };
    const w = fromLattice(orient(p, orientation), spacing);
    if (s.end === 'a') s.el.attr({ x1: w.x, y1: w.y }); else s.el.attr({ x2: w.x, y2: w.y });
  }
  return v;
}

// ─── F19: a rail dragged across a cut tie's joint PUSHES the joint along (Fred, option b) ───────────────────────

/**
 * For a rail body move: every attached tie END (moveRailAlongAxis's own attachment rule: on the rail's row, within
 * its extent) whose tie is CUT gets a push record: the attached segment's other end is the NEAREST joint; the
 * segment beyond it ends at `far` (the tie's far end, or its next joint). Canonical j throughout (a tie runs along j).
 */
export function withTiePush(editor, move) {
  const railJ = move.railCanon.a.j;
  const iMin = Math.min(move.railCanon.a.i, move.railCanon.b.i), iMax = Math.max(move.railCanon.a.i, move.railCanon.b.i);
  const { spacing, orientation } = move;
  const tiePush = [];
  for (const t of move.ties || []) {
    for (const end of ['a', 'b']) {
      const p = t[end];
      if (Math.abs(p.j - railJ) >= JOINT_TOL || p.i < iMin || p.i > iMax) continue;
      const chain = chainOf(editor, t.el);
      if (!chain) continue;
      const other = end === 'a' ? 'b' : 'a';
      const joint = t[other];
      const next = chain.segments.filter((s) => s.el !== t.el).map((s) => ({ el: s.el, canon: canonOf(s, spacing, orientation) }))
        .find((s) => Math.abs(s.canon.a.j - joint.j) < JOINT_TOL || Math.abs(s.canon.b.j - joint.j) < JOINT_TOL);
      if (!next) continue; // the attached end IS the joint: nothing lies between the rail and it
      const nextEnd = Math.abs(next.canon.a.j - joint.j) < JOINT_TOL ? 'a' : 'b';
      tiePush.push({
        i: joint.i, from: p.j, joint: joint.j, far: next.canon[nextEnd === 'a' ? 'b' : 'a'].j, d: Math.sign(joint.j - p.j),
        ends: [{ el: t.el, end: other }, { el: next.el, end: nextEnd }],
      });
    }
  }
  return tiePush.length ? { ...move, tiePush } : move;
}

/**
 * Per frame of a rail move to row `targetJ`: each pushed joint stays MIN_PIECE_CELLS ahead of the rail (never behind
 * its original place, so moving back lets it return), and the drag is never blocked, except the one clamp: the
 * segment beyond a joint never drops below MIN_PIECE_CELLS either. Writes the joint ends; returns the (clamped) row.
 */
export function pushTieJoints(move, targetJ) {
  let j = targetJ;
  for (const p of move.tiePush || []) {
    const cap = Math.max(p.d * p.from, p.d * p.far - 2 * MIN_PIECE_CELLS); // the rail's furthest row toward `far`
    if (p.d * j > cap) j = p.d * cap;
  }
  const { spacing, orientation } = move;
  for (const p of move.tiePush || []) {
    const v = p.d > 0 ? Math.max(p.joint, j + MIN_PIECE_CELLS) : Math.min(p.joint, j - MIN_PIECE_CELLS);
    const w = fromLattice(orient({ i: p.i, j: v }, orientation), spacing);
    for (const s of p.ends) {
      if (s.end === 'a') s.el.attr({ x1: w.x, y1: w.y }); else s.el.attr({ x2: w.x, y2: w.y });
    }
  }
  return j;
}

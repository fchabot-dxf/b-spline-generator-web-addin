/**
 * editor-lattice-pattern.js — SE7b slice 1: the declared Lattice PATTERN,
 * turned into plain lattice-coordinate data. Pure — no svg.js, no DOM, no
 * `editor` object — same split as editor-lattice.js's own pure/DOM
 * division (that file's header comment, editor-lattice.js:8-13) and
 * editor-grid.js's snapToGrid/mergeGridPrefs vs. applyGrid. Reuses
 * editor-lattice.js's lattice math and core/terrain.js's seeded RNG
 * (lcgPoints) rather than re-deriving either — see
 * SE7B-PATTERN-GENERATOR-DESIGN.md for the full design and rationale.
 *
 * `computePattern`'s output stays in LATTICE coordinates throughout
 * (segments AND nodePoints) — a deliberate refinement over the design
 * doc's own sketch, which showed `segments[].a/b` ambiguously. Keeping
 * one coordinate system end to end means this module never needs
 * `spacing` for its own output shape (only to resolve `extent`, done by
 * the caller — see below), and the DOM-touching slice-2 layer is the one
 * place that calls `fromLattice` before handing points to
 * emitSegment/emitNode (which take model-space points).
 */
import { toLattice, fromLattice, constrain, latticeCrossings } from './editor-lattice.js';
import { lcgPoints } from '../core/terrain.js';

export { toLattice, fromLattice, constrain, latticeCrossings };

export const PATTERN_DEFAULTS = {
  spacing: 0.25,
  rails: { every: 2, offset: 0 },
  ties: { density: 0.4, spanMin: 1, spanMax: 3, columns: null, anchor: 'rails' },
  nodes: { ends: true, crossings: true },
  seed: 42,
};

/** Row j is a rail row when (j - offset) is a multiple of every. every<=0
 *  is a degenerate PATTERN (a UI stepper shouldn't produce it, but this
 *  is the defensive floor) — "no rails" rather than a modulo-by-zero or,
 *  worse, silently reinterpreting it as "every row". */
function _isRailRow(j, every, offset) {
  if (every <= 0) return false;
  return (((j - offset) % every) + every) % every === 0;
}

function _railRows(jMin, jMax, every, offset) {
  const rows = [];
  for (let j = jMin; j <= jMax; j++) if (_isRailRow(j, every, offset)) rows.push(j);
  return rows;
}

/** Per-column independent seed derivation — mirrors core/terrain.js's own
 *  XOR-derived sub-seeds (noiseFine/noiseWarp/noiseCoarse,
 *  terrain.js:37-39; lcgPoints(seed ^ 0xdeadbeef, ...), terrain.js:192),
 *  not a new randomness convention. Independent per column so adding a
 *  column at one end never perturbs another column's decision — a
 *  stronger reproducibility property than one shared draw stream would
 *  give (a Set<"i,j,kind"> occupied check, or a widened extent, then
 *  can't retroactively change an already-placed tie two columns over). */
function _columnSeed(seed, i) {
  return ((seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0);
}

/**
 * One column's tie span, or null (no tie this column). `railRows` is the
 * full row list from `_railRows` — only consulted when `anchor==='rails'`.
 * `forced` (ties.columns explicitly listing this column) skips the
 * density gate but still draws span/position from the seed, so hand-
 * picking WHICH columns get a tie doesn't also mean hand-picking exactly
 * where each one sits.
 */
function _tieSpanForColumn(i, seed, ties, railRows, jMin, jMax, forced) {
  const draws = lcgPoints(_columnSeed(seed, i), 2);
  const [gate, pick] = draws;
  if (!forced && gate.u >= ties.density) return null;

  const spanMin = Math.max(1, ties.spanMin || 1);
  const spanMax = Math.max(spanMin, ties.spanMax || spanMin);

  if (ties.anchor === 'free') {
    const span = spanMin + Math.floor(gate.v * (spanMax - spanMin + 1));
    const clampedSpan = Math.min(span, spanMax, jMax - jMin);
    if (clampedSpan < 0) return null;
    const maxStart = jMax - clampedSpan;
    if (maxStart < jMin) return null;
    const jStart = jMin + Math.floor(pick.u * (maxStart - jMin + 1));
    return { jStart, jEnd: jStart + clampedSpan };
  }

  // anchor === 'rails' (default): start AND end land exactly on rail
  // rows, spanning spanMin..spanMax lattice rows between them — "ties
  // bridge between rails" per the photo (ROADMAP:517), not float mid-span.
  if (railRows.length < 2) return null; // nothing to bridge between
  const startIdx = Math.min(railRows.length - 2, Math.floor(pick.v * (railRows.length - 1)));
  const jStart = railRows[startIdx];
  const candidates = [];
  for (let k = startIdx + 1; k < railRows.length; k++) {
    const d = railRows[k] - jStart;
    if (d >= spanMin && d <= spanMax) candidates.push(railRows[k]);
  }
  if (candidates.length === 0) return null; // spacing/span combo can't bridge any rail pair here
  const jEnd = candidates[Math.min(candidates.length - 1, Math.floor(pick.u * candidates.length))];
  return { jStart, jEnd };
}

function _occupiedHas(occupied, i, j, kind) {
  return !!(occupied && occupied.has(`${i},${j},${kind}`));
}

/**
 * PATTERN -> { segments: [{kind:'rail'|'tie', a:{i,j}, b:{i,j}}],
 *              nodePoints: [{i,j}] } — all in LATTICE coordinates.
 *
 * @param {object} PATTERN     see PATTERN_DEFAULTS / SE7B-PATTERN-
 *                              GENERATOR-DESIGN.md §1 for the full shape.
 * @param {object} opts
 * @param {{iMin,jMin,iMax,jMax}} opts.extent  ALREADY-resolved lattice
 *   bounds (the design doc's `{mode:'board'}`/`{mode:'rect'}` -> concrete
 *   numbers resolution happens in the DOM-touching caller, which is the
 *   one place with access to `editor._mW`/`_mH` — this function never
 *   reaches for the editor object).
 * @param {Set<string>} [opts.occupied]  "i,j,kind" keys to skip emitting
 *   at — SE5/SA-LAYER-1-style occupied-cell check for the detach-overlap
 *   rough edge (SE7B design §2). Slice 1 scope: accept it and skip by it;
 *   BUILDING the set from live DOM is slice 2/3's job. Identity point per
 *   kind: rail -> its start {iMin,j}; tie -> its start {i,jStart}; node
 *   -> the node's own {i,j} — a slice-1 convention, open to refinement
 *   once slice 2/3 writes the real occupied-set builder.
 */
export function computePattern(PATTERN, opts = {}) {
  const P = { ...PATTERN_DEFAULTS, ...PATTERN };
  const rails = { ...PATTERN_DEFAULTS.rails, ...(PATTERN.rails || {}) };
  const ties = { ...PATTERN_DEFAULTS.ties, ...(PATTERN.ties || {}) };
  const nodes = { ...PATTERN_DEFAULTS.nodes, ...(PATTERN.nodes || {}) };
  const seed = P.seed;
  const extent = opts.extent;
  if (!extent) throw new Error('computePattern: opts.extent is required (resolved lattice bounds)');
  const { iMin, jMin, iMax, jMax } = extent;
  const occupied = opts.occupied || null;

  const segments = [];
  const nodeKeySet = new Set(); // dedupe nodePoints by "i,j"
  const nodePoints = [];
  const addNode = (i, j) => {
    const key = `${i},${j}`;
    if (nodeKeySet.has(key)) return;
    nodeKeySet.add(key);
    nodePoints.push({ i, j });
  };

  // Rails — every row where (j - offset) % every === 0, full extent width.
  const railRows = _railRows(jMin, jMax, rails.every, rails.offset);
  for (const j of railRows) {
    if (_occupiedHas(occupied, iMin, j, 'rail')) continue;
    segments.push({ kind: 'rail', a: { i: iMin, j }, b: { i: iMax, j } });
  }

  // Ties — one per column (hand-picked list, or density-gated across the
  // full extent width).
  const columns = Array.isArray(ties.columns) && ties.columns.length
    ? ties.columns
    : Array.from({ length: iMax - iMin + 1 }, (_, k) => iMin + k);
  const forcedSet = Array.isArray(ties.columns) ? new Set(ties.columns) : null;

  for (const i of columns) {
    const forced = forcedSet ? forcedSet.has(i) : false;
    const span = _tieSpanForColumn(i, seed, ties, railRows, jMin, jMax, forced);
    if (!span) continue;
    if (_occupiedHas(occupied, i, span.jStart, 'tie')) continue;
    segments.push({ kind: 'tie', a: { i, j: span.jStart }, b: { i, j: span.jEnd } });

    if (nodes.ends) {
      if (!_occupiedHas(occupied, i, span.jStart, 'node')) addNode(i, span.jStart);
      if (!_occupiedHas(occupied, i, span.jEnd, 'node')) addNode(i, span.jEnd);
    }
  }

  // Crossings — reuse latticeCrossings (editor-lattice.js) rail-by-rail
  // against every tie, exactly the primitive SE7a's interactive tool
  // already uses; no new crossing math.
  if (nodes.crossings) {
    const railSegs = segments.filter(s => s.kind === 'rail');
    const tieSegs = segments.filter(s => s.kind === 'tie');
    for (const rail of railSegs) {
      const pts = latticeCrossings(rail, tieSegs);
      for (const p of pts) {
        // latticeCrossings includes seg's OWN two endpoints alongside the
        // real crossings (editor-lattice.js:72, "plus seg's own two
        // endpoints") — here `seg` is the RAIL, so its endpoints are the
        // extent's left/right boundary columns, which are NOT tie-end
        // nodes and must be excluded, or every rail would grow a spurious
        // node at each edge of the board regardless of whether any tie is
        // actually there.
        if (p.i === rail.a.i && p.j === rail.a.j) continue;
        if (p.i === rail.b.i && p.j === rail.b.j) continue;
        if (!_occupiedHas(occupied, p.i, p.j, 'node')) addNode(p.i, p.j);
      }
    }
  }

  return { segments, nodePoints };
}

/**
 * editor-lattice-pattern.js — SE7b: the declared Lattice PATTERN, turned
 * into geometry. Same pure/DOM split editor-lattice.js itself uses in one
 * file (that file's header, editor-lattice.js:8-13: pure lattice math
 * first, "the emit helpers below that line DO touch the DOM/svg.js — same
 * leaf-module shape as editor-grid.js's applyGrid") — `computePattern`
 * (slice 1) is pure, `generatePattern` (slice 2, below the divider) is
 * the DOM-touching sibling. Reuses editor-lattice.js's lattice math and
 * emit helpers, and core/terrain.js's seeded RNG (lcgPoints), rather than
 * re-deriving any of them — see SE7B-PATTERN-GENERATOR-DESIGN.md for the
 * full design and rationale.
 *
 * `computePattern`'s output stays in LATTICE coordinates throughout
 * (segments AND nodePoints) — a deliberate refinement over the design
 * doc's own sketch, which showed `segments[].a/b` ambiguously. Keeping
 * one coordinate system end to end means slice 1 never needs `spacing`
 * for its own output shape (only to resolve `extent`, done by the
 * caller); `generatePattern` below is the one place that calls
 * `fromLattice` before handing points to `emitSegment`/`emitNode` (which
 * take model-space points).
 */
import {
  toLattice, fromLattice, constrain, latticeCrossings,
  LATTICE_ATTR, emitSegment, emitNode, nearestRailRow, orient, LATTICE_STYLE,
} from './editor-lattice.js';
import { worldPoint } from './editor-coords.js';
import { getActiveLayer } from './layers.js';
import { lcgPoints } from '../core/terrain.js';

export { toLattice, fromLattice, constrain, latticeCrossings };

/** data-lattice-gen="<PATTERN.id>" marks an element as OWNED by a
 *  Generate/Regenerate run — a sibling attribute to editor-lattice.js's
 *  own LATTICE_ATTR (data-lattice="rail"|"tie"|"node"), not a new
 *  element shape. See SE7B design §2 for the ownership/detach rules. */
export const OWNERSHIP_ATTR = 'data-lattice-gen';

/** Strip OWNERSHIP_ATTR from each given element that carries it. Pure DOM
 *  mutation only — no undo/pushState/_notifyChange; callers decide when
 *  to commit (editor-interaction.js's handleEnd, for the one-per-drag
 *  hook that must land in the SAME undo step as the move; detachAllOwned
 *  below, for the bulk panel action). Declared once so both call sites
 *  share the exact same detach mechanics rather than two copies of the
 *  same 3-line loop. Returns how many were actually detached. */
export function detachOwnership(elements) {
    let count = 0;
    for (const el of (elements || [])) {
        try {
            if (el && el.attr(OWNERSHIP_ATTR) != null) {
                el.attr(OWNERSHIP_ATTR, null);
                count++;
            }
        } catch (_) { /* defensive: a bad element must not abort the rest of the batch */ }
    }
    return count;
}

export const PATTERN_DEFAULTS = {
  spacing: 0.25,
  // SE7h (Fred: "invert rails and ties so rails are vertical"): default
  // 'horizontal' — an existing saved pattern from before this field
  // existed has no `orientation` key at all, and `computePattern`'s own
  // `{ ...PATTERN_DEFAULTS, ...PATTERN }` merge reads that as
  // 'horizontal' (today's only behavior), so no migration is needed.
  orientation: 'horizontal',
  // SE7c: inset the 'board' extent by this many LATTICE CELLS on every
  // side, so a generated rail/tie/node never sits exactly on the board
  // edge (a live browser test found the first rail at y=0 and nodes at
  // x=0, cut in half by the edge). Only 'board' mode is inset — a 'rect'
  // extent is an explicit caller-given rectangle and is used as given.
  margin: 1,
  rails: { every: 2, offset: 0 },
  // T30 (Fred: "don't limit it to rails, but do snap to them"): default
  // anchor flips 'rails' -> 'free' + railSnapRows (a free end within this
  // many rows of a rail moves onto it; 0 = off). 'rails' strict mode
  // stays available (ties.anchor='rails' in the UI/a saved pattern) and
  // is untouched by railSnapRows — see _tieSpanForColumn's own comment.
  // T30 AMEND (Fred): this is now the ONE railSnapRows value — the
  // hand-drawn Lattice tool's live tie-drag snap (editor-interaction.js)
  // reads THIS same PATTERN.ties.railSnapRows too, not a second default
  // of its own, so the Pattern panel's field drives both surfaces.
  ties: { density: 0.4, spanMin: 1, spanMax: 3, columns: null, anchor: 'free', railSnapRows: 1 },
  // SE7h ADD-ON 2 (Fred: "add a check box for nodes at rail end"):
  // default false — the crossings loop below deliberately SKIPS rail
  // endpoints (see its own comment), so a rail with no crossing tie ends
  // bare unless this flag adds one there explicitly. false keeps every
  // existing saved pattern (no `railEnds` key) reading identically to
  // today via the `{ ...PATTERN_DEFAULTS, ...PATTERN }` merge.
  nodes: { ends: true, crossings: true, railEnds: false },
  // SE7g AMEND (Fred): per-kind colors — SE9's rule (stroke === fill,
  // per element) applies here too, so a generated piece's own color is
  // fully described by one hex per kind. Persisted with the rest of
  // PATTERN (editor-io.js's data-lattice-pattern is a whole-object
  // JSON.stringify, no field whitelist, so this needs no changes there).
  colors: { rails: '#c62828', ties: '#f9c80e', nodes: '#1a237e' },
  // SE7i: absolute INCH values (not factors) — "0.05" steppers" per the
  // dispatch, so a user nudges a real physical width, not a proportion of
  // spacing. Defaults are LATTICE_STYLE's own proportions × this file's
  // default spacing (0.25), computed once here rather than re-derived from
  // the CURRENT spacing on every read: changing Spacing later must not
  // silently re-widen an already-tuned Widths value (same "declared once,
  // independently editable" shape PATTERN.colors already has). `nodeRadius`
  // matches emitNode's own internal `r` (a radius, not a diameter) — the
  // panel's "Node size" stepper edits this same value directly.
  widths: {
    rails: LATTICE_STYLE.rail.widthFactor * 0.25,       // 0.07
    ties: LATTICE_STYLE.tie.widthFactor * 0.25,          // 0.055
    nodeRadius: LATTICE_STYLE.node.radiusFactor * 0.25,  // 0.075
  },
  seed: 42,
};

/** SE7g (Fred: "the generate button needs to automatically use a new
 *  seed"): the ONE seed-rolling function, used by Generate/Regenerate
 *  before every run. Replaces the old standalone Reroll button, which
 *  only ever wrote a fresh value into the Seed field without itself
 *  generating — this is that same draw (a uniform pick over the same
 *  range), just called from the one place that now needs it. */
export function nextSeed() {
  return Math.floor(Math.random() * 1_000_000);
}

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

/** T30: given a FREE-anchor span {jStart, jEnd} (jEnd >= jStart), snap
 *  each end independently to its nearest rail row within `railSnapRows`
 *  — but only keep a snap that leaves the resulting span inside
 *  [spanMin, spanMax] ("spans still spanMin..spanMax, measured after
 *  snapping" per the dispatch). Prefers snapping BOTH ends when that
 *  stays in range; else tries snapping just jStart, then just jEnd;
 *  else leaves both ends exactly where the free draw put them. Pure —
 *  no seed/DOM — so every combination is directly testable. */
function _applyRailSnap(jStart, jEnd, railRows, railSnapRows, spanMin, spanMax) {
  if (!railSnapRows || railSnapRows <= 0) return { jStart, jEnd };
  const snappedStart = nearestRailRow(jStart, railRows, railSnapRows);
  const snappedEnd = nearestRailRow(jEnd, railRows, railSnapRows);
  const inRange = (a, b) => {
    const span = Math.abs(b - a);
    return span >= spanMin && span <= spanMax;
  };
  if (snappedStart != null && snappedEnd != null && inRange(snappedStart, snappedEnd)) {
    return { jStart: snappedStart, jEnd: snappedEnd };
  }
  if (snappedStart != null && inRange(snappedStart, jEnd)) {
    return { jStart: snappedStart, jEnd };
  }
  if (snappedEnd != null && inRange(jStart, snappedEnd)) {
    return { jStart, jEnd: snappedEnd };
  }
  return { jStart, jEnd };
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
    const jEnd = jStart + clampedSpan;
    // T30: snap toward nearby rails — never changes the drawn span outside
    // [spanMin, spanMax]; see _applyRailSnap's own doc comment.
    const railSnapRows = ties.railSnapRows ?? PATTERN_DEFAULTS.ties.railSnapRows;
    return _applyRailSnap(jStart, jEnd, railRows, railSnapRows, spanMin, spanMax);
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
  // SE7h: everything from here to the `return` below runs in the ONE
  // canonical (horizontal) frame this algorithm was always written in —
  // rails constant-j, ties constant-i. `orientation === 'vertical'`
  // conjugates the whole computation through orient() (editor-lattice.js):
  // the extent's corners and the occupied set are transposed IN here,
  // then every output point is transposed back OUT at the return. Since
  // orient() swaps i/j and is its own inverse, this is exactly "rotate
  // the problem 90°, solve it exactly as today, rotate the answer back" —
  // no second copy of the rail-row/tie-span/crossing math exists for
  // 'vertical'. 'horizontal' is the identity, so every existing caller
  // that never sets PATTERN.orientation is byte-for-byte unaffected.
  const orientation = P.orientation;
  const rawExtent = opts.extent;
  if (!rawExtent) throw new Error('computePattern: opts.extent is required (resolved lattice bounds)');
  const extentMin = orient({ i: rawExtent.iMin, j: rawExtent.jMin }, orientation);
  const extentMax = orient({ i: rawExtent.iMax, j: rawExtent.jMax }, orientation);
  const iMin = extentMin.i, jMin = extentMin.j, iMax = extentMax.i, jMax = extentMax.j;
  // "i,j,kind" occupied keys are always built from REAL (un-oriented)
  // lattice coordinates (_collectOccupied, below) — re-key them into the
  // SAME canonical frame the rest of this function reads i/j in, once,
  // rather than orienting on every _occupiedHas() call.
  const occupied = orientation === 'vertical' && opts.occupied
    ? new Set(Array.from(opts.occupied, (key) => {
        const [ki, kj, kind] = key.split(',');
        return `${kj},${ki},${kind}`;
      }))
    : (opts.occupied || null);

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

  // SE7h ADD-ON 2 (Fred: nodes "at rail ends"): its own step, deliberately
  // separate from the crossings loop below — that loop explicitly SKIPS a
  // rail's own two endpoints (a tie-end/crossing convention, see its own
  // comment), so a bare rail end only ever gets a node here, gated by this
  // flag alone. Canonical frame like everything else in this function;
  // orient() at the `return` transposes these back out same as any other
  // nodePoint.
  if (nodes.railEnds) {
    for (const j of railRows) {
      if (!_occupiedHas(occupied, iMin, j, 'node')) addNode(iMin, j);
      if (!_occupiedHas(occupied, iMax, j, 'node')) addNode(iMax, j);
    }
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

  // Transpose back OUT of the canonical frame into real board coordinates
  // (a no-op when orientation is 'horizontal' — orient() is the identity
  // then, so this whole map costs nothing observable in today's default).
  return {
    segments: segments.map((s) => ({
      kind: s.kind,
      a: orient(s.a, orientation),
      b: orient(s.b, orientation),
    })),
    nodePoints: nodePoints.map((p) => orient(p, orientation)),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// DOM-touching — generatePattern and its helpers (slice 2). Everything
// above this line is pure; everything below touches editor/svg.js.
// ─────────────────────────────────────────────────────────────────────────

/** Resolve PATTERN.extent -> concrete lattice bounds. 'board' (the only
 *  mode slice 2 needs) derives from editor._mW/_mH — the same board-
 *  inches units toLattice/fromLattice already assume (their own doc
 *  comments) — inset by PATTERN.margin lattice cells on every side (SE7c)
 *  so nothing generated sits exactly on the board edge. 'rect' (declared
 *  in the shape for a future "pattern only in this region", design doc
 *  §1) is honored directly, UN-inset — its stored bounds are an explicit
 *  caller-given rectangle, not the board edge, so margin doesn't apply;
 *  supporting it costs nothing extra, so both modes are handled rather
 *  than only the one this slice strictly needs. */
function _resolveExtent(editor, PATTERN) {
  const spacing = PATTERN.spacing || PATTERN_DEFAULTS.spacing;
  const extentSpec = PATTERN.extent || { mode: 'board' };
  if (extentSpec.mode === 'rect') {
    const { iMin, jMin, iMax, jMax } = extentSpec;
    return { iMin, jMin, iMax, jMax };
  }
  const margin = PATTERN.margin ?? PATTERN_DEFAULTS.margin;
  const topLeft = toLattice({ x: 0, y: 0 }, spacing);
  const bottomRight = toLattice({ x: editor._mW, y: editor._mH }, spacing);
  return {
    iMin: topLeft.i + margin, jMin: topLeft.j + margin,
    iMax: bottomRight.i - margin, jMax: bottomRight.j - margin,
  };
}

/** A DETACHED lattice element's identity point(s), in lattice coords, at
 *  their WORLD position (worldPoint bakes any transform= a Select-mode
 *  drag wrote — "moved elements count where they ARE", per the dispatch).
 *  Nodes are a <circle>: one point, its centre. Rails/ties are a <line>:
 *  BOTH endpoints — a detached segment could have been dragged/rotated so
 *  either end is now the one a future column/row's generated start would
 *  land on; occupying both is the conservative (more coverage, not less)
 *  choice, a disclosed widening of computePattern's own "start point
 *  only" convention for freshly-generated elements (that convention is
 *  about which cell a NEW segment is keyed by; this is about which
 *  cells an EXISTING, possibly-reoriented one should block). */
function _elementIdentityLatticePoints(el, kind, spacing) {
  if (kind === 'node') {
    const cx = parseFloat(el.attr('cx')), cy = parseFloat(el.attr('cy'));
    if (Number.isNaN(cx) || Number.isNaN(cy)) return [];
    return [toLattice(worldPoint(el, { x: cx, y: cy }), spacing)];
  }
  const pts = [];
  const x1 = parseFloat(el.attr('x1')), y1 = parseFloat(el.attr('y1'));
  const x2 = parseFloat(el.attr('x2')), y2 = parseFloat(el.attr('y2'));
  if (!Number.isNaN(x1) && !Number.isNaN(y1)) pts.push(toLattice(worldPoint(el, { x: x1, y: y1 }), spacing));
  if (!Number.isNaN(x2) && !Number.isNaN(y2)) pts.push(toLattice(worldPoint(el, { x: x2, y: y2 }), spacing));
  return pts;
}

/** SE7i: every DETACHED lattice element ON THE TARGET LAYER (carries
 *  LATTICE_ATTR, lacks OWNERSHIP_ATTR) becomes one or more "i,j,kind"
 *  occupied keys — computePattern skips generating fresh content there
 *  (design doc §2's detach-overlap mitigation). Scoped to `layerId` now
 *  that a pattern lives on ONE layer (SE7i, "I don't mind if all lattice
 *  geometry is in one layer"): a DIFFERENT layer's own lattice content is
 *  a physically separate pass and never blocks this one. Elements still
 *  OWNED (about to be removed and regenerated in the same call) are
 *  excluded here, not because they aren't real, but because they won't
 *  exist by the time the fresh pattern is emitted. */
function _collectOccupied(editor, layerId, spacing) {
  const occupied = new Set();
  if (!editor._sketchLayer) return occupied;
  editor._sketchLayer.children().toArray().forEach((ch) => {
    if (!ch || !ch.node) return;
    if (ch.node.getAttribute('data-layer') !== layerId) return;
    const kind = ch.node.getAttribute(LATTICE_ATTR);
    if (!kind) return;
    if (ch.node.hasAttribute(OWNERSHIP_ATTR)) return;
    for (const pt of _elementIdentityLatticePoints(ch, kind, spacing)) {
      occupied.add(`${pt.i},${pt.j},${kind}`);
    }
  });
  return occupied;
}

/**
 * SE7i (Fred: "I don't mind if all lattice geometry is in one layer" +
 * "regenerate should clear and use the same layer, I'll create a new one
 * if I want"): Generate/Regenerate write rails, ties and nodes into the
 * CURRENT ACTIVE layer — never creating a layer of its own. A second,
 * independent lattice is the user's own choice: make a new layer,
 * activate it, Generate. First clears EVERY element the active layer
 * already carries an OWNERSHIP_ATTR for (including pieces moved by hand
 * since — SE7i retires the old "detach on move" rule), then emits the
 * fresh computation there. Hand-drawn content in that layer (no
 * OWNERSHIP_ATTR) is untouched. One undo step total: every internal step
 * below is undo-silent by construction; pushState() fires exactly once,
 * at the end.
 *
 * @param {object} editor  a live VectorEditor instance (`editor._sketchLayer`,
 *   `editor._layers`, `editor._activeLayer`, `editor._mW`/`_mH`,
 *   `editor.pushState`, `editor._notifyChange` all required).
 * @param {object} PATTERN  see PATTERN_DEFAULTS. `PATTERN.id` is read AND
 *   written (mutated in place) — first Generate on a layer assigns it if
 *   absent; used only for the Generate/Regenerate button label now
 *   (ownership itself is layer-based, not id-based — see below).
 * @returns {{segments, nodePoints}} the same shape computePattern returns,
 *   for callers that want to inspect what was just drawn (e.g. a test).
 */
export function generatePattern(editor, PATTERN) {
  if (!editor || !editor._sketchLayer) return null;
  if (!PATTERN.id) PATTERN.id = `lattice-${Date.now().toString(36)}`;

  const targetLayer = getActiveLayer(editor);

  // SE7g AMEND: emitSegment/emitNode (editor-lattice.js) paint from
  // editor._color — the general drawing-tool color, shared with the
  // hand-drawn Lattice tool — so each kind's own PATTERN.colors value is
  // applied by swapping editor._color in for that kind's emission loop
  // below, then restored here. Keeps emitSegment/emitNode themselves
  // untouched (still exactly what the hand-drawn tool needs).
  const previousColor = editor._color;
  const colors = { ...PATTERN_DEFAULTS.colors, ...(PATTERN.colors || {}) };
  PATTERN.colors = colors;
  // SE7i: per-kind physical sizes (inches) — generator-only, exactly the
  // same scope as colors above (the hand-drawn tool keeps its own
  // LATTICE_STYLE-derived sizing, emitSegment/emitNode's own default).
  const widths = { ...PATTERN_DEFAULTS.widths, ...(PATTERN.widths || {}) };
  PATTERN.widths = widths;

  const spacing = PATTERN.spacing || PATTERN_DEFAULTS.spacing;
  const extent = _resolveExtent(editor, PATTERN);
  const occupied = _collectOccupied(editor, targetLayer, spacing);

  // Remove every element the ACTIVE LAYER already owns — the "replace",
  // not "diff", half of one-way generation, now scoped by layer rather
  // than by matching PATTERN.id (SE7i: "clears every generated piece in
  // that layer... including pieces moved by hand since" — ownership is
  // "has OWNERSHIP_ATTR at all", not "has THIS id", since a layer only
  // ever holds one pattern's generated content at a time).
  editor._sketchLayer.children().toArray().forEach((ch) => {
    if (ch && ch.node && ch.node.getAttribute('data-layer') === targetLayer && ch.node.hasAttribute(OWNERSHIP_ATTR)) {
      ch.remove();
    }
  });

  const { segments, nodePoints } = computePattern(PATTERN, { extent, occupied });

  const tagOwned = (el) => { if (el) el.attr(OWNERSHIP_ATTR, PATTERN.id); return el; };

  editor._color = colors.rails;
  for (const seg of segments) {
    if (seg.kind !== 'rail') continue;
    tagOwned(emitSegment(editor, 'rail', fromLattice(seg.a, spacing), fromLattice(seg.b, spacing), widths.rails));
  }
  editor._color = colors.ties;
  for (const seg of segments) {
    if (seg.kind !== 'tie') continue;
    tagOwned(emitSegment(editor, 'tie', fromLattice(seg.a, spacing), fromLattice(seg.b, spacing), widths.ties));
  }
  editor._color = colors.nodes;
  for (const p of nodePoints) {
    // emitNode dedupes against an existing node at the same lattice cell
    // (findNodeAt, editor-lattice.js:99) — a belt-and-suspenders no-op if
    // occupied-detection already steered clear of it; returns null if so,
    // which tagOwned's own null-check handles.
    tagOwned(emitNode(editor, fromLattice(p, spacing), widths.nodeRadius));
  }
  editor._color = previousColor;

  if (typeof editor.pushState === 'function') editor.pushState();
  if (typeof editor._notifyChange === 'function') editor._notifyChange('commit');

  return { segments, nodePoints };
}

/** PATTERN.colors' kind names ('rails'/'ties'/'nodes') to LATTICE_ATTR's
 *  own singular values ('rail'/'tie'/'node') — the one place the two
 *  naming conventions meet, so a caller of recolorOwnedKind (below) uses
 *  the same kind names the rest of the Colors panel does. */
const COLOR_KIND_TO_LATTICE_ATTR = { rails: 'rail', ties: 'tie', nodes: 'node' };

/** SE7i: every OWNED element (has OWNERSHIP_ATTR) sitting on `layerId` —
 *  the shared filter `recolorOwnedKind`/`rewidthOwnedKind`/`detachAllOwned`
 *  all apply, now that ownership is layer-scoped rather than id-matched
 *  (a layer only ever holds one pattern's generated content at a time). */
function _ownedOnLayer(editor, layerId, latticeKind) {
  if (!editor || !editor._sketchLayer || !layerId) return [];
  return editor._sketchLayer.children().toArray().filter(
    (ch) => ch && ch.node
      && ch.node.getAttribute('data-layer') === layerId
      && ch.node.hasAttribute(OWNERSHIP_ATTR)
      && (!latticeKind || ch.node.getAttribute(LATTICE_ATTR) === latticeKind)
  );
}

/**
 * SE7g AMEND (SE7i: layer-scoped, not id-matched): recolor every element
 * the given LAYER owns of ONE kind, IN PLACE — no reseed, no
 * regeneration, just a stroke/fill rewrite (SE9's rule: stroke === fill
 * for a node's fill-only shape, stroke-only for rail/tie lines). A
 * detached (hand-edited) piece — which lost OWNERSHIP_ATTR the moment it
 * was touched — is automatically excluded and keeps its own color,
 * exactly the "detached pieces keep their own color" rule, for free from
 * the ownership mechanism that already existed for a different reason.
 * One undo step, skipped entirely (no pushState) when there was nothing
 * owned of that kind to recolor.
 *
 * @returns {number} how many elements were recolored (0 = nothing owned
 *   of this kind yet, e.g. the color was changed before the first
 *   Generate — the caller still keeps the new color in PATTERN.colors
 *   for the NEXT Generate to use).
 */
export function recolorOwnedKind(editor, layerId, kind, color) {
  const latticeKind = COLOR_KIND_TO_LATTICE_ATTR[kind];
  if (!latticeKind) return 0;
  const owned = _ownedOnLayer(editor, layerId, latticeKind);
  for (const ch of owned) {
    if (latticeKind === 'node') {
      ch.fill(color);
    } else {
      ch.stroke({ color });
    }
  }
  if (owned.length > 0) {
    if (typeof editor.pushState === 'function') editor.pushState();
    if (typeof editor._notifyChange === 'function') editor._notifyChange('commit');
  }
  return owned.length;
}

/**
 * SE7i (Section 2, "Widths"): the size-editing mirror of recolorOwnedKind
 * above — re-widths every element the given LAYER owns of ONE kind, IN
 * PLACE, no reseed. Rails/ties: `stroke-width` (inches, same unit
 * PATTERN.widths.rails/ties already stores). Nodes: `r` (the circle's own
 * radius attribute) — PATTERN.widths.nodeRadius is already a radius, so
 * no ×2/÷2 conversion here; only emitNode's OWN construction call needs
 * `r*2` (svg.js's circle() takes a diameter), a detail that stays local
 * to that one call site. One undo step, skipped when nothing was owned.
 *
 * @returns {number} how many elements were re-widthed.
 */
export function rewidthOwnedKind(editor, layerId, kind, value) {
  const latticeKind = COLOR_KIND_TO_LATTICE_ATTR[kind];
  if (!latticeKind) return 0;
  const owned = _ownedOnLayer(editor, layerId, latticeKind);
  for (const ch of owned) {
    if (latticeKind === 'node') {
      ch.attr('r', value);
    } else {
      ch.attr('stroke-width', value);
    }
  }
  if (owned.length > 0) {
    if (typeof editor.pushState === 'function') editor.pushState();
    if (typeof editor._notifyChange === 'function') editor._notifyChange('commit');
  }
  return owned.length;
}

/**
 * "Detach all" (panel action): strips OWNERSHIP_ATTR from every element
 * the given LAYER currently owns, WITHOUT moving or deleting anything —
 * the bulk, gesture-free counterpart to the per-drag detach a user might
 * otherwise want, for someone who wants to keep the generated content as
 * a starting point and stop Regenerate from ever touching it again,
 * without individually nudging every element. One undo step, same shape
 * as generatePattern's own single pushState()/_notifyChange('commit') at
 * the end of a batch of otherwise-silent mutations.
 *
 * @returns {number} how many elements were detached (0 if none were
 *   owned — callers can use this to skip the undo push entirely when
 *   there was nothing to do).
 */
export function detachAllOwned(editor, layerId) {
  const owned = _ownedOnLayer(editor, layerId, null);
  const count = detachOwnership(owned);
  if (count > 0) {
    if (typeof editor.pushState === 'function') editor.pushState();
    if (typeof editor._notifyChange === 'function') editor._notifyChange('commit');
  }
  return count;
}

/** SE7i: the ACTIVE layer's own Pattern settings — the one per-layer
 *  source of truth (retires the old file-level editor._latticePattern,
 *  which put every layer's Generate behind one shared seed/orientation/
 *  ...  regardless of which layer was active). Returns null when the
 *  active layer doesn't exist yet, or hasn't been given settings (a fresh
 *  layer starts with no `.pattern` at all — PATTERN_DEFAULTS fills the
 *  gap at every read site, same "missing = defaults" convention this file
 *  already uses for a legacy saved PATTERN missing a newer field). */
export function getLayerPattern(editor) {
  const layers = Array.isArray(editor._layers) ? editor._layers : [];
  const layer = layers.find((l) => l.id === getActiveLayer(editor));
  return (layer && layer.pattern) || null;
}

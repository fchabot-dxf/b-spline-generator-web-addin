/**
 * editor-stripe-tool.js — F27 item 3, the STRIPE tool (Fred, with a black/white stripe image: "if I wanted a line
 * to become alternating segments of colour, can we make a dedicated tool for that?"; picked: size by COUNT or
 * LENGTH, 2 or 3 colours).
 *
 *   tap a line   -> it splits into equal stripes cycling through Colours A, B (, C) from its start
 *   tap again    -> re-stripes it with the CURRENT settings (its stripe cuts are replaced, not added to)
 *
 * Targets: exactly what the ✂ scissors cut (editor-cut-tool.js `isCuttable`): a lattice rail/tie, a plain
 * `<line>`, or a lattice CONTOUR segment (a line or an arc). A plain non-contour `<path>` is not cuttable by the
 * scissors either, so it is not stripeable (no second cut system for it).
 *
 * BUILT ON F27 item 1's machinery, not a copy (the checklist: "a stripe = N cuts + the per-piece colour write"):
 *   - each cut is `cutAtNoCommit` (the ONE cut implementation `cutAt` itself calls), so the SAME per-target cut
 *     kind applies (`CUT_KIND`): a rail/tie/plain line gets STRUCTURAL cuts (separate pieces joined by an explicit
 *     Coincident in Fusion, one lattice chain by derivation); a contour segment gets a COLOUR cut (the geometry
 *     splits, the structure is unchanged; each stripe its own Slot/ArcCenterSlot in Fusion, an arc's stripes
 *     sharing one centre -- editor-sketch-manifest.js's existing "send as drawn" path, no new Fusion code);
 *   - each stripe's colour goes through `writePieceColor` (the SAME per-target store the scissors' recolour
 *     writes: the UI5 override on a rail/tie, `pattern.contour.segmentColors[i]` on the contour, the stroke on a
 *     plain line);
 *   - a re-stripe first merges the striped run back into one piece with `joinNoCommit` (the ONE join), then
 *     stripes it again;
 *   - all of it lands as ONE undo step through `commitCutEdit` (the scissors' own commit).
 *
 * Fred's rulings (F27 item 3, relayed by the coordinator, overriding the checklist text):
 *   - "I don't really care if colours don't end the same as start." -> NO "both end stripes are colour A" rule
 *     and no count snapping for colour reasons: exactly the Count set, cycling A B (C) A B (C)... from the line's
 *     start, wherever the last stripe lands.
 *   - "The only distance it should use is the stroke width." -> the shortest stripe is the stroke width of the
 *     line being striped (`minPieceLength`, editor-cut-tool.js); Count is capped / Length floored to it. The
 *     scissors' one-lattice-cell minimum does NOT apply to stripes (a rail's stripes may be shorter than a cell).
 *
 * Count / Length ("same interplay as the Rails spacing/count fields: set one, the other follows"): a stripe's
 * size is always relative to the line it lands on, so the panel keeps which field was set last (`drive`):
 *   drive 'count'  -> N = Count (capped so no stripe is shorter than the stroke width); Length follows = L / N;
 *   drive 'length' -> N = round(L / Length) (ties round up; Length floored to the stroke width; at least 1, and
 *                     capped like Count); Count follows = N. The stripes are always EQUAL: L / N each, so a
 *                     Length that does not divide the line is the NEAREST equal split, not a short last stripe.
 * The follower field shows its value for the line under the pointer (and, after a tap, the line just striped).
 *
 * Membership: every stripe of one run carries `STRIPE_ATTR` (one id per run), copied by the scissors' clone like
 * every other attribute. A re-stripe takes the CONTIGUOUS run of pieces with that id containing the tapped piece
 * (a stripe the user later deleted leaves two runs, each re-striped on its own).
 */
import { isTouchPress, touchConfirmStart, touchConfirmUpdate, touchConfirmFinish } from './editor-touch-confirm.js';
import {
  isCuttable, isContourPath, pieceEnds, cutAtNoCommit, joinNoCommit, writePieceColor, commitCutEdit,
  cuttableUnder, minPieceLength, CUT_MIN_PLAIN_IN, drawTargetHighlight,
} from './editor-cut-tool.js';
import { primitiveFromContourD, contourPrimitiveEnds, mergeContourPrimitives, CONTOUR_D_DIGITS } from './editor-contour-cut.js';
import { JOINT_TOL } from './editor-lattice-chains.js';
import {
  BOUNDARY_REF_ATTR, _findBoundaryElements, resolvePatternLayer, latticeColorPool,
} from './editor-lattice-pattern.js';
import { VECTOR_COLORS } from './editor-color.js';
import { getDynamicTolerance } from './editor-hit.js';

/** One id per striped run (see the header). */
export const STRIPE_ATTR = 'data-stripe';
/** A contour stripe run also carries the `d` of the segment it was striped from, so a re-stripe restores that
 *  exact segment instead of re-deriving it from N rounded pieces (a line needs none: its numeric ends are exact). */
export const STRIPE_SRC_ATTR = 'data-stripe-src';
/** A contour stripe's d-string precision (see `primitiveToPathD`'s own F27 item 3 note: at the default 3 decimals
 *  a short sub-arc's re-derived centre drifts, so an arc's stripes would stop sharing one centre). */
export const STRIPE_D_DIGITS = CONTOUR_D_DIGITS; // audit batch 2: the ONE contour-piece precision (scissors too)
const STRIPE_MARKER_ID = 'stripe-marker';

/** The panel's settings (per editor session, `editor._stripe`). `colors[i]` null = "the default for the line's
 *  own layer" (below); a pick fixes it. `three` = Colour C on (off by default, the checklist). */
export const STRIPE_DEFAULTS = Object.freeze({ drive: 'count', count: 5, length: 1, three: false, colors: Object.freeze([null, null, null]) });

/** A plain line on a layer with no lattice pattern has no Rails/Ties/Nodes colours to default to: black, white,
 *  then grey (Fred's black/white stripe image; VECTOR_COLORS' own Neutral row, never a hand-typed hex). */
const NEUTRAL = VECTOR_COLORS[VECTOR_COLORS.length - 1];
export const STRIPE_FALLBACK_COLORS = Object.freeze([NEUTRAL[3], NEUTRAL[0], NEUTRAL[1]]);

/** The editor's live stripe settings, created on first use. */
export function stripeSettings(editor) {
  if (!editor._stripe) editor._stripe = { ...STRIPE_DEFAULTS, colors: [...STRIPE_DEFAULTS.colors] };
  return editor._stripe;
}

// ─── pure math ────────────────────────────────────────────────────────────────────────────────────────────────

/** The most stripes a line of length `lineLen` takes with no stripe shorter than `minLen` (the stroke width). */
export function maxStripeCount(lineLen, minLen) {
  if (!(lineLen > 0)) return 1;
  return Math.max(1, Math.floor(lineLen / Math.max(minLen, 1e-12) + 1e-9));
}

/** How many stripes `settings` gives a line of length `lineLen` (see the header's Count / Length rules). */
export function stripeCountFor(settings, lineLen, minLen) {
  const max = maxStripeCount(lineLen, minLen);
  const raw = settings.drive === 'length'
    ? Math.round(lineLen / Math.max(Number(settings.length) || minLen, minLen))
    : Math.round(Number(settings.count) || 1);
  return Math.min(max, Math.max(1, raw));
}

/** The colour of each of `n` stripes: `palette` cycled from the start (A B A B... / A B C A B C...). */
export function stripeColorCycle(n, palette) {
  return Array.from({ length: n }, (_, i) => palette[i % palette.length]);
}

/** Colours A/B/C by default: the lattice's own Rails/Ties/Nodes colours (`latticeColorPool`, the shared pool the
 *  scissors' recolour and the randomize button draw from, deduped), topped up from STRIPE_FALLBACK_COLORS when it
 *  has fewer than 3 distinct ones; with no pattern at all, STRIPE_FALLBACK_COLORS itself. */
export function defaultStripeColors(pattern) {
  const out = pattern ? latticeColorPool(pattern) : [];
  for (const c of STRIPE_FALLBACK_COLORS) if (out.length < 3 && !out.includes(c)) out.push(c);
  return out.slice(0, 3);
}

/** The 2 or 3 colours a stripe run cycles through: each picked colour, else that slot's default. */
export function stripePalette(settings, pattern) {
  const defaults = defaultStripeColors(pattern);
  const k = settings.three ? 3 : 2;
  return Array.from({ length: k }, (_, i) => (settings.colors && settings.colors[i]) || defaults[i]);
}

/** A piece's geometry as a primitive: a line (rail/tie/plain, world coords) -> {type:'L', p0, p1}; a contour
 *  segment -> its own L/A primitive (editor-contour-cut.js). */
export function pieceGeometry(el) {
  if (isContourPath(el)) return primitiveFromContourD(el.attr('d'));
  const [p0, p1] = pieceEnds(el);
  return { type: 'L', p0, p1 };
}

export function primitiveLength(prim) {
  if (!prim) return 0;
  if (prim.type === 'L') return Math.hypot(prim.p1.x - prim.p0.x, prim.p1.y - prim.p0.y);
  return Math.abs(prim.rx * prim.dTheta); // this generator's arcs are circular (rx===ry)
}

/** The point a fraction `f` (0..1) of the way along `prim`, by length (an arc: by angle, the same thing). */
export function primitivePointAt(prim, f) {
  if (prim.type === 'L') return { x: prim.p0.x + (prim.p1.x - prim.p0.x) * f, y: prim.p0.y + (prim.p1.y - prim.p0.y) * f };
  return contourPrimitiveEnds({ ...prim, dTheta: prim.dTheta * f })[1];
}

/** The N-1 cut points splitting `prim` into `n` equal stripes, start to end. */
export function stripeCutPoints(prim, n) {
  return Array.from({ length: Math.max(0, n - 1) }, (_, i) => primitivePointAt(prim, (i + 1) / n));
}

// ─── the run a tap acts on ────────────────────────────────────────────────────────────────────────────────────

/** The contiguous run of stripe pieces containing `el`, ordered start -> end ([el] when it is not striped). A
 *  contour: the siblings with the same stripe id at consecutive `CONTOUR_SEG_INDEX_ATTR`s. A line: same-layer
 *  lines with the same stripe id touching end to end, walked out from `el` both ways. */
export function stripeRun(editor, el) {
  const id = el.node.getAttribute(STRIPE_ATTR);
  if (!id) return [el];
  if (isContourPath(el)) {
    const sibs = _findBoundaryElements(editor, el.node.getAttribute(BOUNDARY_REF_ATTR));
    const k = sibs.indexOf(el);
    const same = (s) => s && s.node.getAttribute(STRIPE_ATTR) === id;
    let lo = k, hi = k;
    while (lo > 0 && same(sibs[lo - 1])) lo--;
    while (hi < sibs.length - 1 && same(sibs[hi + 1])) hi++;
    return sibs.slice(lo, hi + 1);
  }
  const layer = el.node.getAttribute('data-layer');
  const group = editor._sketchLayer.children().toArray().filter((q) => q !== el && isCuttable(q) && !isContourPath(q)
    && q.node.getAttribute(STRIPE_ATTR) === id && q.node.getAttribute('data-layer') === layer);
  const touch = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < JOINT_TOL;
  const used = new Set([el]);
  const run = [el];
  const walk = (from, add) => {
    for (;;) {
      const nx = group.find((q) => !used.has(q) && pieceEnds(q).some((p) => touch(p, from)));
      if (!nx) return;
      used.add(nx); add(nx);
      const [a, b] = pieceEnds(nx);
      from = touch(a, from) ? b : a;
    }
  };
  const [head, tail] = pieceEnds(el);
  walk(tail, (q) => run.push(q));
  walk(head, (q) => run.unshift(q));
  return run;
}

/** The geometry the run would have once merged back into one piece (for the hover preview; the tap merges the
 *  DOM for real with `joinNoCommit`). */
function _runGeometry(run) {
  if (run.length === 1) return pieceGeometry(run[0]);
  if (isContourPath(run[0])) {
    const src = run[0].node.getAttribute(STRIPE_SRC_ATTR);
    if (src) return primitiveFromContourD(src);
    return run.slice(1).reduce((acc, el) => acc && mergeContourPrimitives(acc, pieceGeometry(el)), pieceGeometry(run[0]));
  }
  const touch = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < JOINT_TOL;
  const [a0, b0] = pieceEnds(run[0]), second = pieceEnds(run[1]);
  const p0 = second.some((p) => touch(p, b0)) ? a0 : b0;
  const [aN, bN] = pieceEnds(run[run.length - 1]), prev = pieceEnds(run[run.length - 2]);
  const p1 = prev.some((p) => touch(p, aN)) ? bN : aN;
  return { type: 'L', p0, p1 };
}

/** What a tap on `el` would produce with `settings`: the run, its geometry and length, the stroke-width floor,
 *  the stripe count and each stripe's length. */
export function stripePlan(editor, el, settings = stripeSettings(editor)) {
  const run = stripeRun(editor, el);
  const prim = _runGeometry(run);
  if (!prim) return null;
  const length = primitiveLength(prim);
  const minLength = minPieceLength(el);
  const count = stripeCountFor(settings, length, minLength);
  return { run, prim, length, minLength, count, stripeLength: length / count };
}

// ─── the command ─────────────────────────────────────────────────────────────────────────────────────────────

let _stripeSeq = 0;
const _newStripeId = () => `s${Date.now().toString(36)}${(_stripeSeq++).toString(36)}`;

/**
 * STRIPE `el` (a cuttable piece) with `settings`: merge its striped run back into one piece (a re-stripe), cut it
 * into N equal stripes, paint them A B (C)... from the start, tag them with one stripe id. ONE undo step. Returns
 * the stripes in order, or null when `el` is not stripeable.
 */
export function stripeAt(editor, el, settings = stripeSettings(editor), opts = {}) {
  if (!isCuttable(el)) return null;
  const run = stripeRun(editor, el);
  const contour = isContourPath(el);
  const src = contour ? (el.node.getAttribute(STRIPE_SRC_ATTR) || el.attr('d')) : null;
  // a contour run merges straight back to its recorded segment (`merged`); a line run through the ordinary join
  const joinOpts = contour && run.length > 1 ? { merged: _runGeometry(run), digits: STRIPE_D_DIGITS } : {};
  let piece = run[0];
  for (const q of run.slice(1)) {
    const joined = joinNoCommit(editor, [piece, q], joinOpts);
    if (!joined) break; // not mergeable (should not happen for a stripe run): stripe what did merge
    piece = joined;
  }
  if (contour && run.length > 1 && piece.node.getAttribute(STRIPE_SRC_ATTR)) piece.attr('d', src); // the exact original
  const prim = pieceGeometry(piece);
  if (!prim) return null;
  const n = stripeCountFor(settings, primitiveLength(prim), minPieceLength(piece));
  const stripes = [piece];
  for (const p of stripeCutPoints(prim, n)) {
    // the stroke-width floor is already guaranteed by n; the cut keeps only a no-zero-length guard
    const pair = cutAtNoCommit(editor, stripes[stripes.length - 1], p, { recolor: false, min: CUT_MIN_PLAIN_IN / 10, digits: STRIPE_D_DIGITS });
    if (!pair) break;
    stripes[stripes.length - 1] = pair[0];
    stripes.push(pair[1]);
  }
  const layer = resolvePatternLayer(editor, el.attr('data-layer'));
  const colors = stripeColorCycle(stripes.length, stripePalette(settings, layer && layer.pattern));
  const id = el.node.getAttribute(STRIPE_ATTR) || opts.id || _newStripeId();
  stripes.forEach((s, i) => {
    writePieceColor(editor, s, colors[i]);
    s.attr(STRIPE_ATTR, id);
    if (contour) s.attr(STRIPE_SRC_ATTR, src);
  });
  commitCutEdit(editor);
  return stripes;
}

// ─── the tool (mode 'stripe') ─────────────────────────────────────────────────────────────────────────────────

function _announce(editor, plan) {
  if (typeof document === 'undefined' || typeof CustomEvent === 'undefined') return;
  document.dispatchEvent(new CustomEvent('editorStripeTarget', { detail: { editor, plan } }));
}

export function clearStripeMarker(editor) {
  const layer = editor._handleLayer;
  const m = layer && layer.findOne ? layer.findOne('#' + STRIPE_MARKER_ID) : null;
  if (m) m.remove();
}

/** The hover preview: a tick at every stripe boundary the tap would cut, on the run the tap would act on. */
function _drawStripeMarker(editor, plan) {
  clearStripeMarker(editor);
  if (!plan || !editor._handleLayer) return;
  const r = getDynamicTolerance(editor, 5, 'markPx'); // audit tidy-up: a mark size, not the hit reach
  const g = editor._handleLayer.group().id(STRIPE_MARKER_ID).attr('pointer-events', 'none');
  drawTargetHighlight(editor, g, plan.run); // the run the tap would stripe, lit (Fred: "highlight feedback")
  for (const p of stripeCutPoints(plan.prim, plan.count)) g.circle(2 * r).center(p.x, p.y).fill('#fff').stroke({ color: '#ff6f00', width: r / 2 });
}

/** Touch (Fred: "Stripe tool, I don't understand how to confirm the action on mobile"; the scissors were
 *  "very hard to use on mobile"): press anywhere and drag to aim (hover preview), release to show a green
 *  check / red X, tap the check to act -- editor-touch-confirm.js. Mouse and pen keep the instant click. */
/** The stripe tool as a touch-confirm tool: the preview is the stripe marker on the aimed line. */
const STRIPE_TOUCH_TOOL = {
  name: 'stripe',
  preview(editor, pt) { const el = cuttableUnder(editor, pt); _drawStripeMarker(editor, el ? stripePlan(editor, el) : null); return !!el; },
  clearPreview(editor) { clearStripeMarker(editor); },
  act(editor, pt) { _stripeAtPoint(editor, pt); },
};

export const stripeHandler = {
  hover(editor, pt) {
    const el = cuttableUnder(editor, pt);
    const plan = el ? stripePlan(editor, el) : null;
    _drawStripeMarker(editor, plan);
    if (plan && editor._stripeHoverEl !== el) _announce(editor, plan);
    editor._stripeHoverEl = el;
  },
  start(editor, pt, e) {
    if (isTouchPress(editor, e)) {
      touchConfirmStart(editor, STRIPE_TOUCH_TOOL, pt, e && typeof editor._getMousePoint === 'function' ? editor._getMousePoint(e) : pt);
      return;
    }
    _stripeAtPoint(editor, pt);
  },
  update(editor, pt) { touchConfirmUpdate(editor, STRIPE_TOUCH_TOOL, pt); },
  finish(editor) { touchConfirmFinish(editor, STRIPE_TOUCH_TOOL); },
};

function _stripeAtPoint(editor, pt) {
  const el = cuttableUnder(editor, pt);
  clearStripeMarker(editor);
  if (!el) return;
  const plan = stripePlan(editor, el);
  const stripes = stripeAt(editor, el);
  if (stripes) _announce(editor, plan);
}

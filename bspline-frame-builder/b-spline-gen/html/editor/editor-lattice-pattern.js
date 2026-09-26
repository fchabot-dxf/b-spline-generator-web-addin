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
  toLattice, fromLattice, latticeCrossings,
  LATTICE_ATTR, emitSegment, emitNode, nearestRailRow, orient, LATTICE_STYLE, MIN_PIECE_LENGTH_IN,
} from './editor-lattice.js';
import { worldPoint } from './editor-coords.js';
import { getActiveLayer } from './layers.js';
import { lcgPoints } from '../core/terrain.js';
// T48 (SE13 Slice 2): the pure boundary-cutting engine (T47) — computePattern's
// 'boundary' extent branch calls insideSpans directly (no re-derivation of
// L/A/C crossing math here); primitivesBBox is _resolveExtent's own
// boundary-bbox pre-filter, same reuse discipline as everything else in
// this file's own header comment. collinearSpans is T49's own "fix first"
// (an edge-collinear scan line's own span, unioned in unless Border is on).
// shapeToInnerBoundaryPrimitives (T51) is generatePattern's own live-wiring
// need: generatePattern's own 'boundary' branch calls it on the linked
// element (see BOUNDARY_REF_ATTR below) — the ONE place in this codebase
// that actually does the async DOM lookup _resolveExtent's own doc comment
// defers to "Slice 3's own live-wiring caller".
import {
  insideSpans, primitivesBBox, collinearSpans, shapeToInnerBoundaryPrimitives, shapeToPrimitives,
  insetGeneratedPresetPathDToPrimitives,
} from './editor-lattice-boundary.js';
// T73 (SE14b): the per-primitive <-> combined-d conversions the contour's
// OWN N-segment rendering (properties-shape-lattice.js) and this file's
// own multi-element boundary resolution (_resolveBoundaryPrimitives,
// below) both need — a LEAF module (no import of this file, or anything
// that imports it), so no circular-dependency risk pulling it in here.
import { joinSegmentPathsIntoClosedD } from './editor-shape-lattice-generator.js';

// SE7k: `constrain` (direction-guessing) was removed from editor-lattice.js
// — this file never called it (only re-exported it), and nothing imports
// it from HERE either (checked: every consumer of this module pulls its
// own specific names, none of them this re-export list) — swept along
// with its sole real caller in editor-interaction.js.
export { toLattice, fromLattice, latticeCrossings };

/** data-lattice-gen="<PATTERN.id>" marks an element as OWNED by a
 *  Generate/Regenerate run — a sibling attribute to editor-lattice.js's
 *  own LATTICE_ATTR (data-lattice="rail"|"tie"|"node"), not a new
 *  element shape. See SE7B design §2 for the ownership/detach rules. */
export const OWNERSHIP_ATTR = 'data-lattice-gen';

/** T49 (SE13 §1): the boundary-shape LINK — "linked by id, not copied;
 *  editing it refills with the same seed" needs a stable per-element
 *  identity, which nothing in this editor carried before this (`data-layer`
 *  is layer MEMBERSHIP, not identity). Stamped once, on first pick, onto
 *  the chosen element (`stampBoundaryRef` below); `PATTERN.boundary.shapeId`
 *  stores the same value. Picking a different shape later stamps a NEW id
 *  onto the new element and updates `shapeId` — the OLD element's own tag
 *  is left in place, inert (nothing reads an orphaned one), matching this
 *  codebase's own "don't retroactively clean up unrelated content"
 *  convention (design doc §1). */
export const BOUNDARY_REF_ATTR = 'data-boundary-ref';

/** T72 (AMEND 2, Fred's phone screenshot: 3 param-handle dots floating
 *  over an EMPTY board before any shape exists): `PATTERN.shape.source`
 *  is ALREADY `'generated'` on a layer that has never touched the Shape
 *  Lattice tool at all — `PATTERN_DEFAULTS.shape.source` is `'generated'`
 *  by default (this file's own `shape:` block below), and `currentShape`
 *  (properties-shape-lattice.js) lazily materializes `p.shape` from that
 *  SAME default the first time anything reads it — so "source is
 *  generated" alone can never distinguish "the tool actually ran Generate
 *  once" from "nothing has touched this field yet". `buildSketchManifest`
 *  (editor-sketch-manifest.js) already solved exactly this ambiguity for
 *  its own `hasShape` gate, with the SAME extra check: `extent.mode ===
 *  'boundary'` is set ONLY by `regenerateSilhouette` after a real
 *  Generate/Regenerate has actually linked a silhouette. Declared once,
 *  here, so both callers read the identical signal rather than
 *  maintaining two copies of the same two-part condition. */
export function hasGeneratedSilhouette(pattern) {
  return !!(pattern.shape && pattern.shape.source === 'generated' && pattern.extent && pattern.extent.mode === 'boundary');
}

/** T73 AMEND 3 (Fred: "I need rails to coincide to contour"): true exactly
 *  when a Shape Lattice's rail/tie ends must reach the contour's own RAW
 *  centerline (zero inset), rather than stopping short by the contour's
 *  own half-stroke-width — i.e. a generated silhouette whose contour is
 *  actually shown (SE14c's checkbox). "When the contour checkbox is OFF,
 *  keep today's behaviour" (the amend's own words) is exactly `false`
 *  here, unconditionally, regardless of any Border-feature width setting
 *  (Border is a separate, optional decorative clone — irrelevant to where
 *  rails/ties end). Declared once; both `_resolveBoundaryPrimitives`
 *  below (the app's own drawing) and `shapeHalfInset` (editor-sketch-
 *  manifest.js, the SAME clip boundary for the manifest) import this, so
 *  neither can drift from the other. */
export function usesContourCenterline(pattern) {
  if (!hasGeneratedSilhouette(pattern)) return false;
  return ({ ...PATTERN_DEFAULTS.contour, ...(pattern.contour || {}) }).show !== false;
}

/** T73 (SE14b): the per-segment element's own index within its contour —
 *  a new, second attribute alongside BOUNDARY_REF_ATTR (which N sibling
 *  elements now all share the SAME value of) so `_findBoundaryElements`
 *  below can return them in the CORRECT connectivity order (DOM child
 *  order is not guaranteed to match — a color-picker's own `.clone()`
 *  path, or a future re-ordering, could disturb it) and so a color-write
 *  can map "this clicked element" back to "this `shape.segments[i]`". */
export const CONTOUR_SEG_INDEX_ATTR = 'data-contour-seg';

/** T49/T73: find every live element a PATTERN.boundary.shapeId links to,
 *  on ANY visible layer (a boundary shape need not live on the SAME layer
 *  the Lattice pattern itself generates into — same "anyVisibleLayer"
 *  relaxation Select/Node mode's own hit-test already uses), returned in
 *  `CONTOUR_SEG_INDEX_ATTR` order. Returns `[]` if the id is unset or
 *  every element was deleted — the caller's own "declined gracefully"
 *  fallback (same shape `insideSpans` itself uses for a degenerate
 *  boundary) covers that, not an exception here.
 *
 *  T58 (SE14 Slice 3): exported (same underscore-kept convention as
 *  `stampBoundaryRef`/`_resolveExtent` below) — the Shape Lattice tool's
 *  own Generate needs to find its ALREADY-linked silhouette element(s) (to
 *  update their `d` in place, keeping the same link) before calling
 *  `generatePattern`, the same lookup this file already had exactly one
 *  internal caller for.
 *
 *  T73: was `_findBoundaryElement` (singular, returned the FIRST match
 *  and stopped) — a HAND-PICKED boundary (Box Lattice, or Shape Lattice's
 *  own "Pick shape…") is still always exactly one arbitrary element, so
 *  this plural form degrades to a length-1 array for that case with no
 *  separate code path needed; a GENERATED Shape Lattice silhouette is now
 *  N per-segment elements sharing one `shapeId`, which the old singular
 *  form would have silently truncated to "just the first segment" for
 *  every caller (fill-clip resolution, the contour-color swatch, the
 *  hand-edit-detection compare) — not a hypothetical, the actual reason
 *  this changed. Elements missing `CONTOUR_SEG_INDEX_ATTR` (a hand-picked
 *  shape never has it) sort last, in original order, which is a no-op
 *  for the length-1 case. */
export function _findBoundaryElements(editor, shapeId) {
  if (!editor || !editor._sketchLayer || !shapeId) return [];
  const children = editor._sketchLayer.children().toArray();
  const matches = children.filter((ch) => ch && ch.node && ch.node.getAttribute(BOUNDARY_REF_ATTR) === shapeId);
  const segIndex = (ch) => {
    const raw = ch.node.getAttribute(CONTOUR_SEG_INDEX_ATTR);
    return raw == null ? Infinity : Number(raw);
  };
  return matches.sort((a, b) => segIndex(a) - segIndex(b));
}

/**
 * T50: the effective stroke width a boundary shape actually renders with —
 * shared by the Border piece's own emission (below) AND
 * `_resolveBoundaryPrimitives`'s own inward-offset amount (T51), so the
 * two always agree (if Border's own visible width changes, the fill's
 * cut point moves with it, never independently). Advisor's own rule,
 * verbatim: the Border piece's OWN width when Border is on (it's the
 * thing actually drawn, so it's authoritative); else the LIVE boundary
 * element's own current `stroke-width`, IF it's visibly stroked (`stroke`
 * set and not `'none'`, width > 0); else 0 (an unstroked/fill-only
 * boundary has no stroke to cut inside of).
 *
 * T72 (AMEND 3, Fred: "boundary width auto doesnt seem to apply"): Border
 * width 'auto' (`border.width == null`) used to fall back to the LIVE
 * boundary element's own `stroke-width` unconditionally — correct for a
 * HAND-PICKED boundary (T49's own original ruling: inherit whatever that
 * shape is actually drawn with), but wrong for the Shape Lattice tool's
 * OWN generated silhouette, whose drawn stroke is ALWAYS a fixed, thin
 * hairline (SILHOUETTE_STROKE_WIDTH — regenerateSilhouette's own T68
 * AMEND1 rule, unrelated to Border), never a meaningful "auto" value —
 * the visible symptom was a hairline-thin Border on a preset whose
 * lattice/Fusion-slot stroke is 0.25in. For a generated silhouette
 * specifically, 'auto' now means the SAME `widths.rails` the manifest's
 * own `stroke_width` parameter and every rail/tie already use — and,
 * since `widths` is read fresh on every call (no cached value), it
 * follows live when the lattice stroke width changes, same as the
 * dispatch's own explicit ask.
 */
function _effectiveBorderWidth(boundaryEl, pattern, boundary, widths) {
  if (boundary.border && boundary.border.enabled) {
    if (boundary.border.width != null) return boundary.border.width;
    if (hasGeneratedSilhouette(pattern)) return widths.rails;
    return parseFloat(boundaryEl.attr('stroke-width')) || widths.rails;
  }
  const strokeAttr = boundaryEl.attr('stroke');
  const sw = parseFloat(boundaryEl.attr('stroke-width'));
  if (strokeAttr && strokeAttr !== 'none' && sw > 0) return sw;
  return 0;
}

/** T49: stamp (or reuse) a stable id on a freshly-PICKED boundary element
 *  — idempotent (re-picking the SAME element keeps its existing id rather
 *  than minting a second one, so a stale `PATTERN.boundary.shapeId` from
 *  before a re-pick can't orphan the link by accident). Same id shape
 *  `PATTERN.id` itself already uses (design doc §1). */
export function stampBoundaryRef(el) {
  if (!el) return null;
  let id = el.attr(BOUNDARY_REF_ATTR);
  if (!id) {
    id = `b-${Date.now().toString(36)}`;
    el.attr(BOUNDARY_REF_ATTR, id);
  }
  return id;
}

/** T49: a SE13 Slice 1 primitive list, in a boundary element's own LOCAL
 *  frame (shapeToPrimitives' own contract), baked into WORLD/model-space
 *  inches — `worldPoint` (editor-coords.js) already bakes a live element's
 *  transform for a single point (used elsewhere in this file for a
 *  detached lattice piece's own identity points); this applies the same
 *  bake to every primitive's own point-like field. CIRCLE/A radii and A's
 *  own `phi` are scaled/rotated by the transform's effective UNIFORM
 *  scale/rotation (measured once, from how the origin and the local
 *  +x-axis unit point both move under the SAME `worldPoint` bake) — exact
 *  for the common case (translate + uniform scale + rotation, everything
 *  a Select-mode drag on a rect/circle/ellipse/polygon/path produces
 *  today), a disclosed simplification for a non-uniform-scale transform
 *  (WORK-LOG-lane-b.md, T49). */
function _bakeWorldTransform(el, primitives) {
  const origin = worldPoint(el, { x: 0, y: 0 });
  const xTip = worldPoint(el, { x: 1, y: 0 });
  const scale = Math.hypot(xTip.x - origin.x, xTip.y - origin.y) || 1;
  const rot = Math.atan2(xTip.y - origin.y, xTip.x - origin.x);
  const wp = (p) => worldPoint(el, p);
  return primitives.map((prim) => {
    switch (prim.type) {
      case 'L': return { type: 'L', p0: wp(prim.p0), p1: wp(prim.p1) };
      case 'C': return { type: 'C', p0: wp(prim.p0), p1: wp(prim.p1), p2: wp(prim.p2), p3: wp(prim.p3) };
      case 'CIRCLE': {
        const c = wp({ x: prim.cx, y: prim.cy });
        return { type: 'CIRCLE', cx: c.x, cy: c.y, r: prim.r * scale };
      }
      case 'A': {
        const c = wp({ x: prim.cx, y: prim.cy });
        return {
          type: 'A', cx: c.x, cy: c.y, rx: prim.rx * scale, ry: prim.ry * scale,
          phi: prim.phi + rot, theta1: prim.theta1, dTheta: prim.dTheta,
        };
      }
      default: return prim;
    }
  });
}

/**
 * T49/T51: PATTERN.boundary.shapeId -> resolved WORLD-space primitive
 * list, or `[]` if unlinked/deleted (declined gracefully, same convention
 * as everywhere else in this design). The ONE place `shapeToPrimitives`/
 * `shapeToInnerBoundaryPrimitives` (async) is actually called against a
 * LIVE element — see this file's own import comment for why that's
 * deliberately not inside `_resolveExtent` itself.
 *
 * T51 (advisor review of T50): cuts against the shape's own TRUE
 * inward-offset boundary now (`shapeToInnerBoundaryPrimitives`), not the
 * raw shape — T50's own per-crossing scan-direction shrink is gone
 * entirely (it only happened to be exact at a circle's own center row;
 * elsewhere it left rails sitting INSIDE the visible stroke band — see
 * WORK-LOG-lane-b.md, T51). The inset happens HERE, in the element's own
 * LOCAL frame, using its own LOCAL `stroke-width` — same units SVG's own
 * default (non-`vector-effect`) stroke rendering already scales with the
 * element's transform, so `_bakeWorldTransform` below correctly scales
 * the inset amount right along with the rest of the shape's own geometry
 * for a scaled boundary element, not just its raw path coordinates.
 */
async function _resolveBoundaryPrimitives(editor, PATTERN, boundary, widths) {
  const shapeId = PATTERN.boundary && PATTERN.boundary.shapeId;
  const boundaryEls = _findBoundaryElements(editor, shapeId);
  if (!boundaryEls.length) return { boundaryEl: null, boundaryEls, primitives: [] };
  const boundaryEl = boundaryEls[0]; // representative: width/transform (T73: identical across every segment of the SAME generated contour, by construction — never individually transformed)
  const edge = boundary.edge || PATTERN_DEFAULTS.boundary.edge;
  // T73 AMEND 3: a Shape Lattice with its contour shown clips rails/ties
  // to the contour's own RAW centerline (zero inset), same as an explicit
  // edge:'centerline' choice — see usesContourCenterline's own doc comment.
  const halfWidth = (edge === 'centerline' || usesContourCenterline(PATTERN))
    ? 0
    : _effectiveBorderWidth(boundaryEl, PATTERN, boundary, widths) / 2;
  // T73 (SE14b): a GENERATED contour is now N per-segment elements
  // sharing one shapeId — shapeToInnerBoundaryPrimitives's own per-TYPE
  // dispatch (rect/circle/ellipse/polygon/path/text) has no "N paths"
  // case, and never needs one: a hand-picked boundary (Box Lattice, or
  // Shape Lattice's own "Pick shape…") is still always exactly one
  // element of whatever type the user drew, so that path is UNCHANGED
  // below. For N>1, join each segment's own `d` into ONE combined closed
  // `d` first (the SAME primitive-list-to-`d` relationship
  // `primitivesToPathD`/`primitiveToPathD` already declare, just run
  // backwards) — from there it's the IDENTICAL `d`-string-in/primitives-
  // out inset call a single-path boundary already used.
  let localPrimitives;
  if (boundaryEls.length > 1) {
    // insetGeneratedPresetPathDToPrimitives's own halfWidth<=0 case
    // already degrades to the raw, un-inset primitives (its own inner
    // insetPathDToPrimitives call does that first) — the SAME 'centerline'
    // edge-mode behavior the single-element branch below gets from
    // shapeToInnerBoundaryPrimitives, so this one call covers both.
    const combinedD = joinSegmentPathsIntoClosedD(boundaryEls.map((el) => el.attr('d') || ''));
    localPrimitives = insetGeneratedPresetPathDToPrimitives(combinedD, halfWidth);
  } else {
    localPrimitives = await shapeToInnerBoundaryPrimitives(boundaryEl, halfWidth);
    // T72 (bug: the default Bottle preset generated 0 rails/ties after T71's
    // own contour-size inset): a collapsed inner-offset boundary (self-
    // intersection — see insetPathDToPrimitives's own T72 doc comment,
    // editor-lattice-boundary.js) silently zeroed the ENTIRE lattice fill.
    // Falling back to the raw, un-inset boundary is only safe for a
    // GENERATED preset's own silhouette (a numerical curve-fitting artifact,
    // never a feature the user actually drew thin on purpose) — a
    // HAND-PICKED boundary shape keeps declining to `[]` on collapse
    // unchanged (editor-lattice-boundary.test.js's own "thin arm... the
    // WHOLE shape declines" case documents why: using the raw edge there
    // would put rails ON TOP of a stroke the user genuinely drew that thin).
    if (!localPrimitives.length && halfWidth > 0 && PATTERN.shape && PATTERN.shape.source === 'generated') {
      localPrimitives = await shapeToPrimitives(boundaryEl);
    }
  }
  return { boundaryEl, boundaryEls, primitives: _bakeWorldTransform(boundaryEl, localPrimitives) };
}

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
  // T56 (Fred: "your usual lattice is much denser than what I need... I
  // want 6-7 rails and 8-10 ties"): `mode:'count'` is the new default —
  // a seeded pick within `count`, evenly distributed across the extent's
  // own rows (see `_railRowsByCount`) — declared alongside `every`/
  // `offset` rather than replacing them, so `mode:'every'` (the ORIGINAL
  // behavior) stays a real, supported alternative, not a removed one.
  // `computePattern`'s own merge (below) is careful NOT to let an
  // EXISTING saved pattern's `rails` object (written before `mode`
  // existed, so it never got serialized) silently inherit this new
  // 'count' default — see that merge's own comment.
  rails: { mode: 'count', count: [6, 7], every: 2, offset: 0 },
  // T30 (Fred: "don't limit it to rails, but do snap to them"): default
  // anchor flips 'rails' -> 'free' + railSnapRows (a free end within this
  // many rows of a rail moves onto it; 0 = off). 'rails' strict mode
  // stays available (ties.anchor='rails' in the UI/a saved pattern) and
  // is untouched by railSnapRows — see _tieSpanForColumn's own comment.
  // T30 AMEND (Fred): this is now the ONE railSnapRows value — the
  // hand-drawn Lattice tool's live tie-drag snap (editor-interaction.js)
  // reads THIS same PATTERN.ties.railSnapRows too, not a second default
  // of its own, so the Pattern panel's field drives both surfaces.
  // T56: `mode:'count'` is the new default (same "declare both modes,
  // don't remove the old one" shape as `rails` above) — `density`/
  // `anchor` are still read, but only when `mode:'density'`.
  // T56 AMEND (Fred, having viewed the advisor's own rendered options and
  // picked "B" — 7 rails, 13 SHORT-stub ties — as fine): count-mode's own
  // tie SPAN is `span.mode`. `'cells'` — the ORIGINAL spanMin/spanMax
  // grid-cell stub behavior (still `_applyRailSnap`'d toward a nearby
  // rail, same as today), just with COUNT-based column selection (a
  // seeded count of DISTINCT columns) standing in for the old per-column
  // density gate — was the default here through T56/T66. `'rails'` (every
  // tie bridges exactly `span.rails` adjacent rail rows, ends always ON a
  // rail — my own FIRST guess at the default, before Fred actually viewed
  // the rendered options) was kept as a real, declared alternative, never
  // dropped.
  // T67 AMEND #4 (Fred, live: "ties needs to be coincident to their
  // rails" — a floating tie-stub mid-span has no rail to actually be
  // Coincident TO, which is what T64's own tie-on-rail wiring was always
  // meant to declare): `span.mode:'rails'` is now the DEFAULT — every
  // tie bridges exactly ONE pair of adjacent rails, both ends ALWAYS ON a
  // rail, so the manifest's own tie-on-rail Coincident (already-existing
  // machinery, not new) fires for BOTH ends of EVERY tie, not just the
  // ones that happen to land on a rail by chance. `'cells'` stays a real,
  // declared alternative (not deleted) for whoever wants a floating stub
  // on purpose. `maxRailGaps:1` (rails-mode only) means no gap-size
  // variety unless raised.
  // T67 AMEND 3+4 (Fred: "i dont want it to be always rail to rail, in
  // the addin we can allow to have one end free" -> refined to "one
  // setting: number of one ended ties; I'll usually want 1 or 2"):
  // `ties.oneEnded` (default 1) — exactly this many of the seeded `count`
  // ties (rails-mode span still the mechanism) start on a rail and end
  // FREE (a short stub that deliberately does NOT reach the next rail),
  // clamped to however many ties actually exist; every OTHER tie still
  // bridges rail-to-rail exactly as amend #4 above describes. NEVER a
  // tie with BOTH ends free — the free end is always the SECOND one,
  // anchored at a real rail row on its own start. A saved pattern with
  // no `oneEnded` key reads this same default (1), same "declare the new
  // field, don't silently change old behavior for a key that's absent"
  // convention this file already uses throughout.
  // T57 (advisor, from viewing T56's own render: ties clustered in one
  // half of the board): `spread:'stratified'` (default) — one tie per
  // equal-width column zone, wrapping past the declared minimum count
  // (see `_chooseTieColumns`'s own doc comment); `'random'` (T56's own
  // original per-column-scored selection) is kept as a real alternative.
  ties: {
    mode: 'count', count: [8, 13], spread: 'stratified', span: { mode: 'rails', rails: 1 }, maxRailGaps: 1,
    oneEnded: 1,
    density: 0.4, spanMin: 1, spanMax: 3, columns: null, anchor: 'free', railSnapRows: 1,
  },
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
  // T72 (AMEND 2, Fred: "I want the contour to be colored too"): `contour`
  // joins the SAME declared table — a distinct hue (green), never black,
  // so a freshly-Generated contour never looks like an unstyled default
  // stroke. Shape-Lattice-only (a plain box Lattice layer has no contour
  // to color); SE14b's own later per-segment color overrides this per
  // segment once built, same "whole-kind default, per-piece override"
  // shape rails/ties/nodes already establish.
  colors: { rails: '#c62828', ties: '#f9c80e', nodes: '#1a237e', contour: '#2e7d32' },
  // SE7i: absolute INCH values (not factors) — "0.05" steppers" per the
  // dispatch, so a user nudges a real physical width, not a proportion of
  // spacing. Defaults are LATTICE_STYLE's own proportions × this file's
  // default spacing (0.25), computed once here rather than re-derived from
  // the CURRENT spacing on every read: changing Spacing later must not
  // silently re-widen an already-tuned Widths value (same "declared once,
  // independently editable" shape PATTERN.colors already has). `nodeRadius`
  // matches emitNode's own internal `r` (a radius, not a diameter) — the
  // panel's "Node size" stepper edits this same value directly.
  // T58 ADD-ON (Fred: "I normally want ties and rails to be the same
  // width"): `linkRailsTies` (default true, a NEW layer's own starting
  // point) ties widths.ties to widths.rails in the panel's own UI (one
  // combined stepper) — `ties` itself is still a REAL, independent field
  // (computePattern/emitSegment read `widths.ties` directly, unaware this
  // link exists at all; the link is a properties-*.js-level UI/write
  // convenience, not a new fill-engine concept). A brand-new layer's own
  // ties DEFAULT now equals rails' own default, not its own previous
  // 0.055 (LATTICE_STYLE.tie.widthFactor*0.25) — Fred's own explicit
  // ruling ("rails = ties = the current rails default"), a disclosed
  // default-VALUE change, not just an added field.
  // T71 (Fred: "Stroke width default to .25"): rails/ties default raised
  // from 0.07 (LATTICE_STYLE.rail.widthFactor*0.25) to a plain 0.25in —
  // covers rails, ties, AND (since T69) the Shape Lattice contour's own
  // slot width, all via this ONE seed value. A saved pattern with its own
  // already-set width is unaffected (defaults only seed a NEW/unset
  // pattern's own widths.rails/.ties).
  widths: {
    rails: 0.25,
    ties: 0.25,
    nodeRadius: LATTICE_STYLE.node.radiusFactor * 0.25,  // 0.075
    linkRailsTies: true,
  },
  seed: 42,
  // T48 (SE13 §1): the `extent.mode === 'boundary'` settings, declared now
  // (this slot costs nothing until a consumer reads it — "declare over
  // hand-roll") even though only `computePattern`'s own span-clipping
  // (this slot's `shapeId`/`endRule`/`joints`/`border` are NOT read yet)
  // exists so far. `runs: null` is a DELIBERATE, explicit scope cut for
  // this slice (advisor ruling on SE13 open question 1, T48 dispatch):
  // the color-run/parts sub-cut and its per-piece stored rolls are NOT
  // built — a boundary-filled row/column emits one uniformly-colored
  // segment per inside span, i.e. today's Board-mode look, just shaped to
  // the boundary. Additive later: turning `runs` into the full §1 object
  // (`{stepLen,omitPct,loosePct,palette}`) is new code, not a breaking
  // change to this shape.
  boundary: {
    shapeId: null,
    endRule: 'inset',
    // T50 (advisor finding, from T49's own 04-ending-*.png screenshots): a
    // visibly-stroked boundary shape's fill was cut at the raw path
    // CENTERLINE, so rails ran halfway into the stroke itself (visible
    // through a translucent stroke). 'inner-stroke' (default) cuts the
    // fill at the stroke's own INNER edge instead — what a person actually
    // reads as "inside" a stroked shape. 'centerline' keeps the pre-T50
    // behavior (ignore stroke width entirely) for a caller that wants it.
    edge: 'inner-stroke',
    runs: null,
    joints: { freq: 1, shape: 'circle', size: null },
    border: { enabled: false, width: null, color: null },
  },
  // T58 (SE14 Slice 3): the Shape Lattice tool's own generated-silhouette
  // state (SE14-SHAPE-LATTICE-DESIGN.md §2) — declared here alongside
  // every other per-layer pattern field, not a parallel structure, even
  // though `computePattern`/`generatePattern` never read it themselves
  // (it's consumed only by properties-shape-lattice.js, which resolves it
  // into `PATTERN.boundary.shapeId` + `PATTERN.extent.mode:'boundary'`
  // BEFORE calling the SAME fill engine every other tool shares — "two
  // tools sharing one engine", design doc §1). `params`/`segments` are
  // OVERRIDES onto `editor-shape-lattice-generator.js`'s own PRESETS
  // table — `{}`/`null` means "use that preset's own defaults + gentle
  // seeded jitter", matching `generateSilhouette`'s own documented
  // contract exactly (not re-described here).
  shape: {
    source: 'generated', // 'generated' | 'picked' — design doc §6
    preset: 'hourglass',
    seed: 42,
    params: {},
    segments: null,
  },
  // T72 (SE14c, Fred: "I'd want a checkbox for the actual contour, I still
  // want rails and ties to be contoured but sometimes don't want the
  // contour profile"): OFF still computes the contour and still clips/
  // fits rails+ties to it exactly as ON does (regenerateSilhouette/
  // buildSketchManifest both keep resolving the boundary unconditionally)
  // — only the contour's own drawn segments/manifest entities disappear.
  // A saved pattern with no `contour` key at all (every pattern before
  // this turn) reads `show` as true via the SAME `{ ...PATTERN_DEFAULTS,
  // ...PATTERN }` merge every other field already relies on.
  //
  // T73 (SE14b): `segmentColors[i]` is the per-DRAWN-SEGMENT color
  // override, indexed by PRIMITIVE index — the SAME index `generateSilhouette`'s
  // own `primitives[i]` and the manifest's own `seg{i}` ids already use
  // (NOT `shape.segments[i]`'s topology index: `_segmentToPrimitives`
  // expands a single 'kink' style-segment into 2 primitives, so the two
  // arrays can diverge in length). `regenerateSilhouette` carries this
  // array forward across a regenerate that keeps the SAME primitive count,
  // and resets it (`[]`) when the count changes — a changed count means
  // index i no longer names the same drawn edge.
  contour: { show: true, segmentColors: [] },
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

// Large, fixed salts for the "meta" seeded draws below (how MANY rails/
// ties) — offset far past any realistic column or row index so they can
// never collide with a real `_columnSeed(seed, i)` call for an actual
// column/row. Each is combined with `seed` (the only varying operand)
// via a SINGLE `_columnSeed` application — safe, verified directly (see
// _TIES_GEOMETRY_SALT's own comment for the failure mode this avoids).
const _RAILS_COUNT_SALT = 900001;
const _TIES_COUNT_SALT = 900002;
// A column's own tie-GEOMETRY draw (gap size + start position) must NOT
// share a seed with its SELECTION-score draw (`_tieSlotsByCount`'s own
// doc comment) — self-caught bug, found by measuring, not assumed: my
// first attempt combined them as `_columnSeed(seed, col +
// _TIES_GEOMETRY_SALT)` with a large additive salt (matching the OTHER
// two salts above) — but there `col` is the ONLY varying operand and
// it's tiny (a handful of columns) next to a million-scale salt, so
// `Math.imul(col+salt+1, const)` barely moves at all across columns,
// and XORing a small `seed` into THAT nearly-constant, already-large
// product left `draws[0].u` on the SAME side of 0.5 in 650/650 samples
// (measured directly) — silently collapsing `maxRailGaps>1` to always
// picking the SAME gap size. Fixed by NESTING instead of adding:
// `_columnSeed(_columnSeed(seed, col), _TIES_GEOMETRY_SALT)` re-mixes
// the column's own ALREADY-WELL-SPREAD seed through a second
// independent salt, rather than letting one huge constant dominate a
// tiny one — re-measured after the fix: 359/650 (a real, working spread,
// not the exact 50/50 a larger sample would show, but nowhere near the
// original's total collapse).
const _TIES_GEOMETRY_SALT = 777;
// T57 (advisor, from viewing T56's own render: "seed 42: all 8 ties in
// the LEFT half"): `_chooseTieColumns`' own 'stratified' branch salts
// each tie's own position-within-zone draw by that tie's GLOBAL index
// (0..count-1, unique even across a wrapped zone), a distinct salt from
// both the (retired-by-default, still used in 'random' spread mode)
// selection score and the geometry draw above.
const _TIES_SPREAD_SALT = 555;

/** T56 (Fred: "I want 6-7 rails"): `rails.mode:'count'` — a seeded pick
 *  within `[countMin,countMax]` (clamped to however many rows the extent
 *  actually has, "place what fits"), then that many rows EVENLY spread
 *  across `[jMin,jMax]` (rounded to integer rows) — the COUNT is seeded,
 *  WHICH rows get chosen is not (rails are a regular structural grid,
 *  not organic placement the way ties are). A single rail (the degenerate
 *  countMin<=1 case) lands at the extent's own vertical center. */
function _railRowsByCount(jMin, jMax, countRange, seed) {
  const totalRows = jMax - jMin + 1;
  const [countMin, countMax] = countRange;
  const draw = lcgPoints(_fmix32(_columnSeed(seed, _RAILS_COUNT_SALT)), 1)[0].u;
  const count = Math.min(totalRows, Math.max(0, countMin + Math.floor(draw * (countMax - countMin + 1))));
  if (count <= 0) return [];
  if (count === 1) return [Math.round((jMin + jMax) / 2)];
  const rows = [];
  const seen = new Set();
  for (let k = 0; k < count; k++) {
    let row = Math.round(jMin + (k / (count - 1)) * (jMax - jMin));
    while (seen.has(row) && row < jMax) row++; // rounding collision: nudge toward the far end first
    while (seen.has(row) && row > jMin) row--; // still colliding (extent too small): nudge the other way
    seen.add(row);
    rows.push(row);
  }
  return rows.sort((a, b) => a - b);
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

/** T57 (advisor, from viewing T56's own render — measured, not assumed):
 *  a genuine, more fundamental finding than T56's own "large-additive-
 *  salt dominates a tiny one" bug. `lcgPoints`'s own LCG (`s =
 *  imul(seed,1664525)+1013904223`) is LINEAR in a SMALL seed — for two
 *  small seeds (say 1 and 2), `s` differs by only `imul(1,1664525)`, a
 *  tiny fraction of the full 32-bit range, so the FIRST draw stays
 *  close for EVERY small seed regardless of how `_columnSeed` salts it.
 *  Measured directly: `lcgPoints(seed,1).u` for seed in {1,2,7,42,100}
 *  all landed in [0.236,0.275], while seed=999999 landed at 0.788 —
 *  confirms the weakness is in the RAW LCG's own response to a SMALL
 *  seed, not specific to any one salt scheme built on top of it.
 *
 *  Found via `_chooseTieColumns`'s own 'stratified' branch (its
 *  within-zone position draw visibly collapsed for this session's own
 *  typical small seeds, e.g. 1/2/7/42 all picking the identical
 *  column) — but the SAME weakness turned out to already be present in
 *  T56's own (already-merged) `_RAILS_COUNT_SALT`/`_TIES_COUNT_SALT`
 *  draws too: measured directly, seeds 1-30 against `_TIES_COUNT_SALT`
 *  all landed in [0.011,0.023] (a run of CONSECUTIVE small seeds
 *  clustering near the SAME value, not independently spread) — T56's
 *  own "50 seeds: count always in [6,7]" test happened to still pass
 *  only because that range has just 2 possible values and the full 50-
 *  seed sweep crossed the 0.5 threshold often enough by chance, not
 *  because the draws were genuinely well-distributed for NEARBY seeds
 *  (this session's own actual usage pattern — 1,2,3,7,42... — is
 *  exactly the adjacency this bug bites hardest). Applied here too,
 *  fixing a real, disclosed gap in already-shipped code, not just the
 *  new T57 mechanism that happened to surface it.
 *
 *  NOT applied to `_columnSeed` itself, which is used pervasively
 *  throughout this file by code well outside T56/T57's own scope;
 *  fixing it at each of these 3 specific call sites rather than
 *  changing a shared primitive's own behavior for callers that were
 *  never reported broken (and are validated by their own, separately-
 *  passing tests already). Murmur3's own `fmix32` finalizer — takes ANY
 *  32-bit input, including an already-small or poorly-diffused one, and
 *  avalanches it — same finalizer T54 already used for the shape-
 *  lattice generator's own seed hash, a DIFFERENT bug in a DIFFERENT
 *  file, same fix shape. */
function _fmix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
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

/**
 * T57 (advisor, from viewing T56's own render: seed 42 clustered all 8
 * ties in the left half of a 7x9 board) — WHICH `count` columns get a
 * tie, declared as `ties.spread: 'stratified' | 'random'`.
 *
 * 'random' (T56's own original mechanism, kept as a real alternative):
 * every candidate column gets its own independent seeded score, the
 * `count` lowest are kept — genuinely random per column, but with no
 * guarantee about how those `count` picks distribute across the WIDTH
 * (T56's own `count` draws are independent of each other, so a run of
 * low scores can cluster anywhere, including all on one side — exactly
 * what the advisor's own screenshot showed).
 *
 * 'stratified' (new default): divide `columns` into `zones` EQUAL-WIDTH
 * groups (`zones = ties.count[0]`, the declared range's own MINIMUM —
 * the one zone count that's ALWAYS <= the actual seeded `count`, since
 * `count` is drawn from `[countMin,countMax]`) and place `count` ties
 * across them as EVENLY as possible: `base = floor(count/zones)` ties
 * in every zone, plus one more ("the extra") in `count - base*zones`
 * of the zones. Self-caught bug (measured, not assumed): a naive
 * `zone = k % zones` always assigns the extras to the LOWEST-indexed
 * zones first (0, 1, 2, ...) — a fixed, seed-INDEPENDENT bias toward
 * one side of the board on every run once `count` exceeds `zones`
 * (which is MOST runs, since `zones` is only the range's own floor) —
 * not a fix for "all ties in the left half" at all, just a subtler
 * version of the same bug. Fixed: WHICH zones get the extra tie is its
 * own independent seeded score per zone (same score-and-sort shape
 * `spread:'random'` above already uses, one level up — at the zone
 * level instead of the column level).
 *
 * Within a zone, the tie's own column is a seeded pick keyed by ITS OWN
 * GLOBAL INDEX `k` (0..count-1, unique even for a second, wrapped
 * occurrence in the same zone) — NOT by column identity (there isn't
 * one yet, that's what's being chosen) and NOT by zone index alone
 * (which would make every tie in the same zone pick the identical
 * position). A defensive de-dup (linear probe forward, wrapping through
 * the FULL column list) guards the rare case where two draws in a
 * narrow zone would otherwise land on the same column — global
 * distinctness (T56's own "no two ties share a column") is preserved
 * either way.
 */
function _chooseTieColumns(columns, count, countMin, spread, seed) {
  if (spread === 'random') {
    const scored = columns.map((col) => ({ col, score: lcgPoints(_columnSeed(seed, col), 1)[0].u }));
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, count).map((s) => s.col).sort((a, b) => a - b);
  }

  // `zones` is FIXED at the declared range's own minimum, NOT at this
  // particular run's own (possibly larger) `count` — using `count`
  // itself here would make `k % zones` always equal `k` (since k<count
  // always), so wrapping could never trigger at all.
  const zones = Math.max(1, Math.min(countMin, columns.length));

  // Self-caught bug (measured, not assumed — see WORK-LOG): a plain
  // `zone = k % zones` always fills zone 0 first, then zone 1, etc. —
  // for `count` ANYWHERE above `zones` (which is MOST of the time,
  // given `zones` is the declared range's own MINIMUM), the wrap-around
  // "extra" ties always land in the LOWEST-indexed zones, a fixed,
  // seed-INDEPENDENT bias toward one side of the board every single
  // run — not a real fix for the "all ties in the left half" bug this
  // whole mechanism exists to solve, just a subtler version of it.
  // Fixed: distribute `count` ties across `zones` as evenly as possible
  // (`base` each, `extra` zones get one more) and pick WHICH zones get
  // that extra tie via their own independent seeded score — the same
  // score-and-sort selection `spread:'random'` above already uses, at
  // the ZONE level instead of the column level.
  const base = Math.floor(count / zones);
  const extra = count - base * zones;
  const zoneScored = Array.from({ length: zones }, (_, z) => ({
    z, score: lcgPoints(_fmix32(_columnSeed(seed, _TIES_SPREAD_SALT + 10000 + z)), 1)[0].u,
  }));
  zoneScored.sort((a, b) => a.score - b.score);
  const bonusZones = new Set(zoneScored.slice(0, extra).map((s) => s.z));
  const zoneOfTie = [];
  for (let z = 0; z < zones; z++) {
    const n = base + (bonusZones.has(z) ? 1 : 0);
    for (let i = 0; i < n; i++) zoneOfTie.push(z);
  }

  const used = new Set();
  const chosen = [];
  for (let k = 0; k < count; k++) {
    const zone = zoneOfTie[k];
    const zoneLo = Math.floor((zone / zones) * columns.length);
    const zoneHi = Math.min(columns.length, Math.floor(((zone + 1) / zones) * columns.length)) - 1;
    const draw = lcgPoints(_fmix32(_columnSeed(seed, _TIES_SPREAD_SALT + k)), 1)[0].u;
    let idx = zoneLo + Math.floor(draw * Math.max(1, zoneHi - zoneLo + 1));
    idx = Math.min(idx, columns.length - 1);
    let guard = 0;
    while (used.has(columns[idx]) && guard < columns.length) {
      idx = (idx + 1) % columns.length;
      guard++;
    }
    used.add(columns[idx]);
    chosen.push(columns[idx]);
  }
  return chosen.sort((a, b) => a - b);
}

/**
 * T56 (Fred: "I want... 8-10 ties"), AMENDED after Fred viewed the
 * advisor's own rendered options and picked "B" (7 rails, 13 SHORT-stub
 * ties) as fine: `ties.mode:'count'` — a seeded pick within
 * `[countMin,countMax]` (clamped to however many candidate columns
 * actually exist, "place what fits"), each landing on its OWN DISTINCT
 * column (never two ties sharing a column, so "spread across distinct
 * columns" holds by construction, no separate anti-clustering pass
 * needed). What each chosen column's own tie actually LOOKS like is
 * `ties.span.mode`:
 *   'rails' (DEFAULT since T67 AMEND #4, Fred: "ties needs to be
 *     coincident to their rails"): every tie bridges `ties.span.rails`
 *     rail-to-rail gaps exactly (1 = the very next rail, ends always
 *     land ON a rail row; `maxRailGaps` optionally widens this per-tie,
 *     seeded, for variety) — no floating mid-span stub with nothing to
 *     be Coincident to.
 *   'cells' (the DEFAULT through T56/T66, per Fred's own pick at the
 *     time): a short stub, `spanMin`..`spanMax` GRID CELLS,
 *     `_applyRailSnap`'d toward a nearby rail — the EXACT pre-T56 span
 *     mechanic (`_tieSpanForColumn`'s own 'free' anchor branch), just
 *     with COUNT-based column selection standing in for the old
 *     per-column density gate — kept as a real, declared alternative,
 *     not deleted, for whoever wants a floating stub on purpose.
 *
 * Column SELECTION (`ties.spread`, T57): the T56-era scheme (score every
 * candidate column independently, keep the `count` lowest — a real,
 * declared `'random'` alternative, still in `_chooseTieColumns` below)
 * looked "spread" per-column but wasn't spread across the WIDTH — the
 * advisor caught it directly in T56's own render (`t56-density.png`,
 * "seed 42: all 8 ties in the LEFT half"). `'stratified'` (the new
 * default) divides the column range into `zones` (= `ties.count[0]`,
 * this preset's own declared minimum — the one value guaranteed to fit
 * with exactly one tie per zone and no wrap) and assigns tie `k`
 * (0..count-1) to zone `k % zones` — WRAPPING (a second tie per zone)
 * only when `count` actually exceeds `zones`, which happens whenever the
 * seeded count lands above the range's own minimum. See
 * `_chooseTieColumns`'s own doc comment for the full derivation.
 */
function _tieSlotsByCount(railRows, columns, ties, jMin, jMax, seed, tieSpanIntact) {
  if (columns.length === 0) return [];
  const spanMode = ties.span?.mode || 'cells';
  if (spanMode === 'rails' && railRows.length < 2) return []; // nothing to bridge between
  const [countMin, countMax] = ties.count;
  const countDraw = lcgPoints(_fmix32(_columnSeed(seed, _TIES_COUNT_SALT)), 1)[0].u;
  const count = Math.min(
    columns.length,
    Math.max(0, countMin + Math.floor(countDraw * (countMax - countMin + 1)))
  );
  if (count <= 0) return [];

  const chosen = _chooseTieColumns(columns, count, countMin, ties.spread || 'stratified', seed);

  const slots = [];

  if (spanMode === 'rails') {
    const numGaps = railRows.length - 1;
    const minGaps = Math.max(1, Math.min(numGaps, ties.span?.rails || 1));
    const maxGaps = Math.max(minGaps, Math.min(numGaps, ties.maxRailGaps || minGaps));
    // T67 AMEND #4 (render+view caught this LIVE, before it ever got
    // named in the dispatch text): `railRows` is the RAW row list — true
    // rail-to-rail bridging in board/rect mode, but in BOUNDARY mode
    // (Shape Lattice) the tie's own column can dip outside the silhouette
    // somewhere between the two rows even when both rows themselves have
    // a rail (a pinched/non-convex shape, e.g. an hourglass waist) — a
    // row being IN this list does not mean the FULL bridge at this
    // column survives boundary clipping intact. `tieSpanIntact` (board/
    // rect: always true, so every path below is a pure no-op and the
    // ORIGINAL seeded draw is always used byte-identically) checks the
    // WHOLE candidate span, not just its two ends; when the original
    // draw fails it, a deterministic scan over the SAME candidate space
    // (by gap size, closest to the drawn one first, then start index
    // ascending) finds the first genuinely-intact bridge — "place what
    // fits" (an already-accepted, already-tested outcome elsewhere in
    // this exact function) rather than a floating/shortened stub, if
    // none exist at all.
    const intact = tieSpanIntact || (() => true);

    // T67 AMEND 3+4 (Fred: "i dont want it to be always rail to rail...
    // one setting: number of one ended ties"): WHICH of `chosen` are
    // one-ended is its OWN independent seeded score-and-sort (same
    // "score every candidate, keep the N lowest" shape `_chooseTieColumns`
    // above already uses for "which zones get the extra tie") — the
    // LOWEST-scored `oneEnded` columns (clamped to how many ties actually
    // exist) become one-ended; every other column bridges rail-to-rail
    // exactly as before this amendment.
    const oneEndedCount = Math.max(0, Math.min(chosen.length, ties.oneEnded ?? 1));
    const oneEndedScored = chosen.map((col) => ({ col, score: lcgPoints(_fmix32(_columnSeed(seed, _TIES_SPREAD_SALT + 20000 + col)), 1)[0].u }));
    oneEndedScored.sort((a, b) => a.score - b.score);
    const oneEndedSet = new Set(oneEndedScored.slice(0, oneEndedCount).map((s) => s.col));

    const spanMin = Math.max(1, ties.spanMin || 1);
    const spanMax = Math.max(spanMin, ties.spanMax || spanMin);

    for (const col of chosen) {
      if (oneEndedSet.has(col)) {
        // One end ON a rail (jStart, a real row), the other end a FREE
        // stub that deliberately does NOT reach the neighbouring rail —
        // tries the seeded direction/row first, falls back to any row/
        // direction with enough room, and finally (no room anywhere for
        // ANY stub, a tight-rail edge case) falls through to the
        // ordinary rail-to-rail path below rather than skip the tie
        // outright ("place what fits" already covers dropping it later
        // if even THAT doesn't survive boundary clipping).
        const draws = lcgPoints(_columnSeed(_columnSeed(seed, col), _TIES_GEOMETRY_SALT + 30000), 3);
        const rowOrder = [...railRows.keys()].sort((a, b) => Math.abs(a - Math.floor(draws[0].u * railRows.length)) - Math.abs(b - Math.floor(draws[0].u * railRows.length)));
        let stubPlaced = false;
        for (const rIdx of rowOrder) {
          const jStart = railRows[rIdx];
          const roomUp = rIdx + 1 < railRows.length ? railRows[rIdx + 1] - jStart - 1 : Infinity;
          const roomDown = rIdx > 0 ? jStart - railRows[rIdx - 1] - 1 : Infinity;
          const goUpFirst = draws[1].u < 0.5;
          for (const [room, dir] of goUpFirst ? [[roomUp, 1], [roomDown, -1]] : [[roomDown, -1], [roomUp, 1]]) {
            if (room < spanMin) continue;
            const maxSpan = Math.min(spanMax, room);
            const span = spanMin + Math.floor(draws[2].u * (maxSpan - spanMin + 1));
            const jEnd = jStart + dir * span;
            slots.push({ i: col, jStart, jEnd, anchored: true, oneEndedFree: true });
            stubPlaced = true;
            break;
          }
          if (stubPlaced) break;
        }
        if (stubPlaced) continue;
        // no room anywhere for a stub at this column — fall through to
        // the ordinary rail-to-rail draw below instead of dropping it.
      }
      const draws = lcgPoints(_columnSeed(_columnSeed(seed, col), _TIES_GEOMETRY_SALT), 2);
      const gapSize = minGaps + Math.floor(draws[0].u * (maxGaps - minGaps + 1));
      const maxStartIdx = numGaps - gapSize;
      const startIdx = Math.floor(draws[1].u * (maxStartIdx + 1));
      if (intact(col, railRows[startIdx], railRows[startIdx + gapSize])) {
        slots.push({ i: col, jStart: railRows[startIdx], jEnd: railRows[startIdx + gapSize], anchored: true });
        continue;
      }
      let placed = false;
      const gapOrder = [gapSize, ...Array.from({ length: maxGaps - minGaps + 1 }, (_, k) => minGaps + k).filter((g) => g !== gapSize)];
      for (const g of gapOrder) {
        const maxStart = numGaps - g;
        if (maxStart < 0) continue;
        for (let s = 0; s <= maxStart; s++) {
          const jStart = railRows[s], jEnd = railRows[s + g];
          if (!intact(col, jStart, jEnd)) continue;
          slots.push({ i: col, jStart, jEnd, anchored: true });
          placed = true;
          break;
        }
        if (placed) break;
      }
    }
    return slots;
  }

  // 'cells' (default): the EXACT pre-T56 free-anchor span draw
  // (`_tieSpanForColumn`'s own 'free' branch), reused here rather than
  // re-derived — same formula, same `_applyRailSnap` call, just fed by
  // this function's own (nested) geometry seed instead of the density
  // gate's own `gate`/`pick` pair.
  const spanMin = Math.max(1, ties.spanMin || 1);
  const spanMax = Math.max(spanMin, ties.spanMax || spanMin);
  const railSnapRows = ties.railSnapRows ?? PATTERN_DEFAULTS.ties.railSnapRows;
  for (const col of chosen) {
    const draws = lcgPoints(_columnSeed(_columnSeed(seed, col), _TIES_GEOMETRY_SALT), 2);
    const span = spanMin + Math.floor(draws[0].u * (spanMax - spanMin + 1));
    const clampedSpan = Math.min(span, spanMax, jMax - jMin);
    if (clampedSpan < 0) continue;
    const maxStart = jMax - clampedSpan;
    if (maxStart < jMin) continue; // doesn't fit in this extent at all — skip this column
    const jStart = jMin + Math.floor(draws[1].u * (maxStart - jMin + 1));
    const jEnd = jStart + clampedSpan;
    const snapped = _applyRailSnap(jStart, jEnd, railRows, railSnapRows, spanMin, spanMax);
    slots.push({ i: col, jStart: snapped.jStart, jEnd: snapped.jEnd });
  }
  return slots;
}

function _occupiedHas(occupied, i, j, kind) {
  return !!(occupied && occupied.has(`${i},${j},${kind}`));
}

/**
 * T48 (SE13 Slice 2): intersect [lo,hi] against a sorted, non-overlapping
 * `spans` list (insideSpans' own output shape), returning every non-empty
 * overlap as its own {a,b,aIsCrossing,bIsCrossing} piece — 0, 1, or many.
 * Board/rect mode never calls this (its "span" is already the whole
 * extent); boundary mode uses it for BOTH rails (clip the full row width
 * to the boundary) and ties (clip the drawn random span to the boundary)
 * — one function, not two, since "shorten this range to what's actually
 * inside" is the same operation either way (Ground-truth #2's own
 * "multiple inside-sub-spans per row/column" restructuring).
 *
 * T49 (SE13 Slice 3): `aIsCrossing`/`bIsCrossing` — did this end come from
 * the boundary's OWN span (`sLo`/`sHi`, a real `insideSpans` crossing),
 * not merely left at the caller's own [lo,hi] window limit — is exactly
 * the signal §5's ending-rule dispatch needs — a RAIL's [lo,hi] is the
 * bbox pre-filter (ALWAYS both ends ARE real crossings, a rail crossing a
 * boundary shape — see the T50 fix below for why); a TIE's [lo,hi] is its
 * own already-drawn random span (an end stays a plain "free" end, today's
 * Board-mode behavior, exactly when the boundary never touched it).
 *
 * T50 (self-caught while testing the stroke-width fix, a genuine
 * pre-existing gap, not introduced by T50 itself): the ORIGINAL check
 * used a strict `sLo > lo` — wrong at the row/column where the boundary's
 * own crossing reaches exactly as far as the bbox pre-filter itself
 * (unavoidable at a circle/ellipse's own WIDEST row, since the bbox IS
 * derived from that same widest extent) — that row's own `aIsCrossing`
 * came back `false`, silently skipping the ending rule AND the new
 * edge-shrink there. Fixed by testing `sLo`/`sHi` against `lo`/`hi`
 * directly with a symmetric epsilon (`sLo > lo - eps` / `sHi < hi + eps`)
 * — exact equality now correctly reads as "yes, a crossing" for rails
 * (where `sLo` can never be less than `lo` for a REAL, `_resolveExtent`-
 * derived bbox — only a hand-built test extent could construct that), and
 * still correctly reads "free end" for a tie whose own drawn span sits
 * genuinely, non-trivially inside the boundary (nowhere near this
 * epsilon). Caught by a DOM-level `generatePattern` test going through
 * the REAL `_resolveExtent` (a tight, un-padded bbox) — the earlier pure
 * `computePattern` tests never hit it because they all used a hand-built
 * extent PADDED beyond the boundary's own natural bbox, which masked
 * exactly this coincidence. See WORK-LOG-lane-b.md, T50.
 */
function _clipToSpans(lo, hi, spans) {
  const out = [];
  for (const [sLo, sHi] of spans) {
    const a = Math.max(lo, sLo), b = Math.min(hi, sHi);
    if (b - a > 1e-9) {
      out.push({ a, b, aIsCrossing: sLo > lo - 1e-9, bIsCrossing: sHi < hi + 1e-9 });
    }
  }
  return out;
}

/** T49: union two sorted-or-unsorted [lo,hi] span lists into one sorted,
 *  non-overlapping list — merges `insideSpans`' own output with
 *  `collinearSpans`' own "kept edge" spans (the "fix first" item), so a
 *  row/column that's both genuinely crossed AND collinear with an edge
 *  elsewhere on the same line gets one clean combined span list rather
 *  than two independently-clipped ones downstream. */
function _unionSpans(a, b) {
  const all = [...a, ...b].sort((x, y) => x[0] - y[0]);
  if (!all.length) return [];
  const out = [all[0].slice()];
  for (let i = 1; i < all.length; i++) {
    const last = out[out.length - 1];
    if (all[i][0] <= last[1] + 1e-9) last[1] = Math.max(last[1], all[i][1]);
    else out.push(all[i].slice());
  }
  return out;
}

/**
 * T49 (SE13 §5): the ending-rule dispatch for ONE clipped piece's own two
 * ends — only an end that `_clipToSpans` marked as a real boundary
 * crossing is touched at all; a plain "free" tie end (today's Board-mode
 * behavior) is left exactly as `_clipToSpans` already computed it.
 * `on-boundary` needs no branch (the crossing point computed by `insideSpans`
 * IS the final endpoint already — §5's own "zero extra geometry" case).
 * `inset` pulls the endpoint back by `halfWidth` along the run's own axis
 * — a plain subtraction, not a clip/boolean op, per §5's own bar.
 * `joint` leaves the geometry at `on-boundary` and instead flags a NODE
 * for the caller to emit there (reuses the existing node machinery
 * verbatim, per the design doc's own "no new node code" claim).
 * `loose` picks the nearest GRID-integer stop strictly inside the span as
 * the new endpoint instead of the true crossing (§4's own "purely a
 * choice of which stop to cut at"); when the span is shorter than one
 * grid cell (no stop exists between the two ends), it degrades to
 * `inset` for that end — the one named case §5's own text calls out.
 * A degenerate result (both ends pulled past each other) collapses to a
 * single point at the span's own midpoint rather than inverting.
 */
function _applyEndRule(a, b, aIsCrossing, bIsCrossing, endRule, halfWidth) {
  let na = a, nb = b, aJoint = false, bJoint = false;
  if (aIsCrossing) {
    if (endRule === 'inset') na = a + halfWidth;
    else if (endRule === 'joint') aJoint = true;
    else if (endRule === 'loose') {
      const stop = Math.ceil(a + 1e-9);
      na = stop < b - 1e-9 ? stop : a + halfWidth; // no stop fits -> degrade to inset
    }
    // 'on-boundary': na stays exactly `a`.
  }
  if (bIsCrossing) {
    if (endRule === 'inset') nb = b - halfWidth;
    else if (endRule === 'joint') bJoint = true;
    else if (endRule === 'loose') {
      const stop = Math.floor(b - 1e-9);
      nb = stop > a + 1e-9 ? stop : b - halfWidth; // no stop fits -> degrade to inset
    }
  }
  if (na >= nb) { const mid = (a + b) / 2; na = mid; nb = mid; }
  return { a: na, b: nb, aJoint, bJoint };
}

/**
 * T48: the REAL (un-oriented) scan line for a CANONICAL row `j` — a rail
 * in the canonical (horizontal) frame. Built via `orient()` rather than a
 * hand-written horizontal/vertical branch so 'vertical' orientation (SE7h:
 * "rails become vertical") is correct for free: two canonical points
 * {i:0,j} and {i:1,j}, mapped to real space by the SAME `orient()` every
 * other lattice quantity in this function already goes through, give the
 * scan line's point + unit direction directly — no primitive ever needs
 * reflecting, only the QUERY direction changes with orientation. Boundary
 * primitives themselves stay in one fixed, real, un-oriented frame
 * throughout (see `_resolveExtent`'s 'boundary' branch below).
 */
function _rowScanLine(j, orientation) {
  const p0 = orient({ i: 0, j }, orientation);
  const p1 = orient({ i: 1, j }, orientation);
  return { point: { x: p0.i, y: p0.j }, dir: { x: p1.i - p0.i, y: p1.j - p0.j } };
}

/** T48: same as `_rowScanLine`, for a CANONICAL column `i` (a tie). */
function _colScanLine(i, orientation) {
  const p0 = orient({ i, j: 0 }, orientation);
  const p1 = orient({ i, j: 1 }, orientation);
  return { point: { x: p0.i, y: p0.j }, dir: { x: p1.i - p0.i, y: p1.j - p0.j } };
}

/**
 * PATTERN -> { segments: [{kind:'rail'|'tie', a:{i,j}, b:{i,j}}],
 *              nodePoints: [{i,j}] } — all in LATTICE coordinates.
 *
 * @param {object} PATTERN     see PATTERN_DEFAULTS / SE7B-PATTERN-
 *                              GENERATOR-DESIGN.md §1 for the full shape.
 * @param {object} opts
 * @param {{iMin,jMin,iMax,jMax,mode?,primitives?}} opts.extent  ALREADY-
 *   resolved lattice bounds (the design doc's `{mode:'board'}`/
 *   `{mode:'rect'}` -> concrete numbers resolution happens in the DOM-
 *   touching caller, which is the one place with access to
 *   `editor._mW`/`_mH` — this function never reaches for the editor
 *   object). T48 (SE13 Slice 2): `mode:'boundary'` (plus `primitives`, the
 *   boundary shape's own SE13 Slice 1 primitive list, already scaled into
 *   this SAME lattice-unit space and left UN-oriented — see
 *   `_resolveExtent`'s 'boundary' branch below) restricts each rail row /
 *   tie column to the primitives' own `insideSpans` instead of the full
 *   `iMin..iMax`/`jMin..jMax` width — iMin/jMin/iMax/jMax still gate WHICH
 *   rows/columns are considered at all (the bbox pre-filter, §4).
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
  // T56: an EXISTING saved pattern's `rails`/`ties` object, written
  // before `mode` existed, never got that key serialized — reading it
  // back today must NOT let it silently inherit the NEW 'count' default
  // (Fred's own explicit requirement: "an existing layer's saved pattern
  // keeps its own values, no silent re-density"). So `mode` gets its OWN
  // fallback to the OLD implicit behavior ('every'/'density') whenever
  // the caller supplied a real `rails`/`ties` object that itself lacks
  // it — the plain `{...DEFAULTS, ...(PATTERN.x||{})}` merge every OTHER
  // field here already uses is fine for them (T30/SE7h's own established
  // "missing key reads as its old default" pattern) because THEIR old
  // default already matches the new one; `mode`'s does not, so it alone
  // needs the explicit branch. No `PATTERN.rails`/`.ties` at all (a
  // brand-new layer, or a synthetic/test PATTERN) gets the plain new
  // default, `mode:'count'` included — there is no "old value" to
  // preserve there.
  const rails = PATTERN.rails
    ? { ...PATTERN_DEFAULTS.rails, ...PATTERN.rails, mode: PATTERN.rails.mode || 'every' }
    : { ...PATTERN_DEFAULTS.rails };
  const ties = PATTERN.ties
    ? { ...PATTERN_DEFAULTS.ties, ...PATTERN.ties, mode: PATTERN.ties.mode || 'density' }
    : { ...PATTERN_DEFAULTS.ties };
  const nodes = { ...PATTERN_DEFAULTS.nodes, ...(PATTERN.nodes || {}) };
  // T49 (SE13 Slice 3): `widths` merged HERE now too (previously only in
  // generatePattern, the DOM-touching sibling) — the `inset` ending rule's
  // own pull-back-by-halfWidth math is PURE (a subtraction along an
  // already-known direction, §5), so it belongs in computePattern, not
  // duplicated/deferred to the emit step.
  const widths = { ...PATTERN_DEFAULTS.widths, ...(PATTERN.widths || {}) };
  const boundary = { ...PATTERN_DEFAULTS.boundary, ...(PATTERN.boundary || {}) };
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
  // T48: boundary mode's own primitives are ALREADY in real, un-oriented,
  // lattice-unit space (`_resolveExtent`'s 'boundary' branch) — they are
  // never transposed; only the QUERY (the scan line for a given canonical
  // row/column) changes with orientation, via _rowScanLine/_colScanLine.
  const isBoundary = rawExtent.mode === 'boundary';
  const boundaryPrimitives = rawExtent.primitives || [];
  // T49: Border-piece gating for the "fix first" collinear-edge span (an
  // edge-collinear rail/tie is DROPPED when Border draws that same edge
  // itself — no double stroke) — and the ending-rule/halfWidth inputs
  // every boundary-crossing end now needs. `halfWidth` is in the SAME
  // lattice-unit space as everything else here (inches / spacing).
  const borderEnabled = isBoundary && !!(boundary.border && boundary.border.enabled);
  // T73 AMEND 3: a Shape Lattice with its contour shown forces 'on-
  // boundary' regardless of the pattern's own stored endRule -- the rail/
  // tie's own centerline must reach the contour's centerline EXACTLY (no
  // pull-back), so its stroke deliberately overlaps the contour's own
  // stroke ("the slot caps then overlap the contour slot," Fred's own
  // words) rather than stopping half a stroke-width short of it.
  const endRule = (isBoundary && usesContourCenterline(PATTERN))
    ? 'on-boundary'
    : (boundary.endRule || PATTERN_DEFAULTS.boundary.endRule);
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

  // Rails — every row where (j - offset) % every === 0. Board/rect mode:
  // one segment, the full extent width (unchanged). T48 (SE13 Slice 2)
  // boundary mode: the row's own insideSpans against the boundary
  // primitives, clipped to iMin..iMax defensively — 0, 1, or several
  // segments per row (Ground-truth #2's own "multiple inside-sub-spans"),
  // instead of always exactly one. `runs`/`parts`/stored rolls (§4) are
  // explicitly OUT of this slice's scope (T48 dispatch) — each span here
  // IS the emitted segment, uncut, i.e. today's Board-mode "one part per
  // run" default (`runs.stepLen: null`) applied uniformly. Endpoints use
  // the RAW boundary-crossing point directly — §5's `on-boundary` ending
  // rule, the only one this slice implements (the other three are
  // Slice 3's own emission-time dispatch).
  // T56: `mode:'count'` (default) picks rail rows via `_railRowsByCount`
  // (a seeded count, evenly spread) instead of the fixed `every`/`offset`
  // stride — 'every' stays available as an explicit alternative mode.
  const railRows = rails.mode === 'every'
    ? _railRows(jMin, jMax, rails.every, rails.offset)
    : _railRowsByCount(jMin, jMax, rails.count, seed);
  const halfRail = widths.rails / 2 / P.spacing;
  for (const j of railRows) {
    let pieces;
    if (isBoundary) {
      const rowScan = _rowScanLine(j, orientation);
      const inside = insideSpans(rowScan, boundaryPrimitives);
      // T49 "fix first": union in the collinear-edge span UNLESS Border
      // will draw that same edge itself (then insideSpans alone is right
      // — the edge-collinear rail is dropped, no double stroke).
      const combined = borderEnabled ? inside : _unionSpans(inside, collinearSpans(rowScan, boundaryPrimitives));
      pieces = _clipToSpans(iMin, iMax, combined);
    } else {
      pieces = [{ a: iMin, b: iMax, aIsCrossing: false, bIsCrossing: false }];
    }
    for (const piece of pieces) {
      // T51: `piece.a`/`piece.b` are ALREADY the boundary's own true
      // inner-stroke crossing (the primitives THEMSELVES are the inset
      // shape now, not the raw one) — the ending rule applies directly,
      // no separate per-crossing shrink step (T50's own dead end, deleted).
      const { a, b, aJoint, bJoint } = _applyEndRule(piece.a, piece.b, piece.aIsCrossing, piece.bIsCrossing, endRule, halfRail);
      if (_occupiedHas(occupied, a, j, 'rail')) continue;
      segments.push({ kind: 'rail', a: { i: a, j }, b: { i: b, j } });
      if (aJoint && !_occupiedHas(occupied, a, j, 'node')) addNode(a, j);
      if (bJoint && !_occupiedHas(occupied, b, j, 'node')) addNode(b, j);
    }
  }

  // SE7h ADD-ON 2 (Fred: nodes "at rail ends"): its own step, deliberately
  // separate from the crossings loop below — that loop explicitly SKIPS a
  // rail's own two endpoints (a tie-end/crossing convention, see its own
  // comment), so a bare rail end only ever gets a node here, gated by this
  // flag alone. Canonical frame like everything else in this function;
  // orient() at the `return` transposes these back out same as any other
  // nodePoint. Board/rect mode: unchanged, one node pair per RAIL ROW
  // (matches today's behavior exactly, including for a row whose rail was
  // itself skipped by `occupied` — iterating `railRows`, not the emitted
  // segments, preserves that). T48 boundary mode: a node pair per EMITTED
  // rail SEGMENT instead (a row may have 0, 1, or several), since "the
  // extent's own iMin/iMax" isn't a meaningful single pair of endpoints
  // any more — this is the natural generalization, not a behavior change,
  // and reduces to the board/rect case exactly when there's one full-width
  // segment per row.
  if (nodes.railEnds) {
    if (isBoundary) {
      for (const seg of segments) {
        if (seg.kind !== 'rail') continue;
        if (!_occupiedHas(occupied, seg.a.i, seg.a.j, 'node')) addNode(seg.a.i, seg.a.j);
        if (!_occupiedHas(occupied, seg.b.i, seg.b.j, 'node')) addNode(seg.b.i, seg.b.j);
      }
    } else {
      for (const j of railRows) {
        if (!_occupiedHas(occupied, iMin, j, 'node')) addNode(iMin, j);
        if (!_occupiedHas(occupied, iMax, j, 'node')) addNode(iMax, j);
      }
    }
  }

  // Ties — one per column (hand-picked list, or density-gated/count-based
  // across the full extent width).
  const columns = Array.isArray(ties.columns) && ties.columns.length
    ? ties.columns
    : Array.from({ length: iMax - iMin + 1 }, (_, k) => iMin + k);
  const forcedSet = Array.isArray(ties.columns) ? new Set(ties.columns) : null;

  // T67 AMEND #4 (render+view of a REAL hourglass caught this — a
  // pinched/non-convex shape can have BOTH rail-row endpoints genuinely
  // covered while the column dips OUTSIDE the boundary somewhere in
  // BETWEEN them, e.g. crossing the waist): checking only "is there a
  // rail at each end" was NOT enough — the tie-emission loop below (its
  // own `isBoundary` branch, a few lines down) ALSO independently clips
  // each tie along its own column, which can SHORTEN it past one of
  // those "covered" endpoints without a per-endpoint check ever seeing
  // it. `tieSpanIntact` replicates that EXACT clipping computation and
  // only accepts a candidate span if it comes back UNSHORTENED (a real
  // rail-to-rail bridge, not a boundary-cut stub) — always `true` in
  // board/rect mode, so `_tieSlotsByCount`'s own 'rails' branch behaves
  // byte-identically to before this amendment there.
  const tieSpanIntact = (i, jStart, jEnd) => {
    if (!isBoundary) return true;
    const lo = Math.min(jStart, jEnd), hi = Math.max(jStart, jEnd);
    const colScan = _colScanLine(i, orientation);
    const inside = insideSpans(colScan, boundaryPrimitives);
    const combined = borderEnabled ? inside : _unionSpans(inside, collinearSpans(colScan, boundaryPrimitives));
    const pieces = _clipToSpans(lo, hi, combined);
    return pieces.length === 1 && pieces[0].a === lo && pieces[0].b === hi;
  };

  // T56: WHICH columns get a tie is a GLOBAL decision in count-mode (it
  // has to see every candidate at once to pick `count` of them), unlike
  // density-mode's own independent per-column gate — so the slot list is
  // computed up front here, then fed through the SAME emission loop below
  // either way (only how `tieSlots` gets built differs by mode).
  let tieSlots;
  if (ties.mode === 'count') {
    tieSlots = _tieSlotsByCount(railRows, columns, ties, jMin, jMax, seed, tieSpanIntact);
    // T67 AMEND #4 — belt-and-suspenders final check: `tieSpanIntact`
    // verifies the COLUMN stays inside the boundary via `insideSpans`'
    // own vertical (col) scan; a rail ROW's own visible extent comes
    // from a SEPARATE horizontal (row) scan, independently end-rule-
    // pulled-back. For almost every case these agree, but a genuinely
    // pinched/asymmetric boundary can disagree at its own extreme edge
    // (measured directly, not assumed: seed 42's own default hourglass,
    // column 0 — the board's own leftmost candidate column — passed the
    // col-scan check while row 12's own ACTUAL emitted rail only reaches
    // x=1.05, never x=0 at all). Ground truth for "does a tie's own end
    // land on a rail" is the rail's own REAL, ALREADY-EMITTED segment —
    // checked here directly (rails always emit before ties, above) —
    // rather than trusting two independently-computed insideness tests
    // to necessarily agree. An anchored slot that fails this is dropped
    // ("place what fits", not a floating stub).
    if (isBoundary) {
      const railSpansByRow = new Map();
      for (const seg of segments) {
        if (seg.kind !== 'rail') continue;
        if (!railSpansByRow.has(seg.a.j)) railSpansByRow.set(seg.a.j, []);
        railSpansByRow.get(seg.a.j).push([Math.min(seg.a.i, seg.b.i), Math.max(seg.a.i, seg.b.i)]);
      }
      const onRealRail = (j, i) => (railSpansByRow.get(j) || []).some(([lo, hi]) => i >= lo - 1e-9 && i <= hi + 1e-9);
      // T67 AMEND 3+4: a one-ended slot only needs its OWN rail end
      // (jStart) validated — jEnd is a deliberate free stub, never
      // expected to be on a rail at all.
      tieSlots = tieSlots.filter((slot) => !slot.anchored
        || (slot.oneEndedFree ? onRealRail(slot.jStart, slot.i) : (onRealRail(slot.jStart, slot.i) && onRealRail(slot.jEnd, slot.i))));
    }
  } else {
    tieSlots = [];
    for (const i of columns) {
      const forced = forcedSet ? forcedSet.has(i) : false;
      const span = _tieSpanForColumn(i, seed, ties, railRows, jMin, jMax, forced);
      if (span) tieSlots.push({ i, jStart: span.jStart, jEnd: span.jEnd });
    }
  }

  const halfTie = widths.ties / 2 / P.spacing;
  for (const { i, jStart, jEnd, anchored, oneEndedFree } of tieSlots) {
    // T48: the tie's own density/span/anchor (or T56 count) draw (above)
    // is UNCHANGED here — boundary mode doesn't touch WHETHER or how far
    // a tie is drawn, only clips the result to what's actually inside the
    // shape, same "shorten, don't re-decide" split as the rails loop
    // above. Board/rect mode: `pieces` is exactly one un-clipped piece,
    // so this reduces to today's single segment/end-node pair byte-for-byte.
    //
    // T67 AMEND #4 (render+view caught this too, a SECOND layer of the
    // same bug): an `anchored` slot (rails-mode, `tieSpanIntact` already
    // PROVED the full [jStart,jEnd] run survives boundary-clipping
    // UNCHANGED) still hit the SAME clip-then-`_applyEndRule` path below
    // — `_clipToSpans` reports `aIsCrossing`/`bIsCrossing` true whenever
    // an end happens to COINCIDE with the boundary's own crossing point
    // (which a rail-row end often does, near the board edge), and the
    // "on-boundary" ending rule then pulls that end back by `halfTie` —
    // correct for a FREE end genuinely meeting the boundary, wrong for
    // an end that's supposed to land EXACTLY on a rail: the tie stopped
    // `halfTie` short of the rail it was declared to bridge to. A pure
    // rail-to-rail anchored slot skips this whole branch — both its own
    // ends are already exactly right by construction, nothing left to
    // clip or pull back.
    //
    // T67 AMEND 3+4: a ONE-ENDED slot (`oneEndedFree`) is only HALF
    // anchored — `jStart` is a real rail row (never pull it back), but
    // `jEnd` is a genuinely free stub whose own span was chosen to clear
    // the NEXT rail, not the boundary — it can still legitimately run
    // outside the boundary (a Shape Lattice silhouette) and needs the
    // SAME clip+end-rule treatment any ordinary free end gets. Runs the
    // normal boundary path, then forces OFF whichever resulting piece
    // end lands exactly on `jStart` (the known rail row) so `_applyEndRule`
    // never pulls that one back, leaving the free end's own crossing
    // status untouched either way.
    let pieces;
    if (anchored && !oneEndedFree) {
      pieces = [{ a: jStart, b: jEnd, aIsCrossing: false, bIsCrossing: false }];
    } else if (isBoundary) {
      const colScan = _colScanLine(i, orientation);
      const inside = insideSpans(colScan, boundaryPrimitives);
      const combined = borderEnabled ? inside : _unionSpans(inside, collinearSpans(colScan, boundaryPrimitives));
      pieces = _clipToSpans(Math.min(jStart, jEnd), Math.max(jStart, jEnd), combined);
      if (oneEndedFree) {
        pieces = pieces.map((p) => ({
          ...p,
          aIsCrossing: Math.abs(p.a - jStart) < 1e-9 ? false : p.aIsCrossing,
          bIsCrossing: Math.abs(p.b - jStart) < 1e-9 ? false : p.bIsCrossing,
        }));
      }
    } else {
      // T67 AMEND 3+4 self-caught bug: a DOWNWARD one-ended stub
      // (`jEnd = jStart - span`, so `jEnd < jStart`) hit
      // `_applyEndRule`'s own degenerate-collapse guard (`if (na >= nb)
      // ...` — na/nb start equal to a/b here since aIsCrossing/
      // bIsCrossing are both false, so an already-descending a>b pair
      // trips it immediately), COLLAPSING both ends to their shared
      // midpoint — a real, reproduced failure (50-seed board-mode test,
      // multiple seeds), not a hypothetical. `a`/`b` are genuinely
      // interchangeable labels for "this piece's two points" everywhere
      // downstream (`segments.push` below doesn't care which is which),
      // so ordering them ascending here is free and matches every OTHER
      // candidate-building path in this function (rail-to-rail bridging,
      // and the boundary-mode branch above via its own Math.min/max).
      pieces = [{ a: Math.min(jStart, jEnd), b: Math.max(jStart, jEnd), aIsCrossing: false, bIsCrossing: false }];
    }
    for (const piece of pieces) {
      // T51: same as the rails loop above — no separate shrink step.
      const { a, b, aJoint, bJoint } = _applyEndRule(piece.a, piece.b, piece.aIsCrossing, piece.bIsCrossing, endRule, halfTie);
      if (_occupiedHas(occupied, i, a, 'tie')) continue;
      segments.push({ kind: 'tie', a: { i, j: a }, b: { i, j: b } });

      if (nodes.ends) {
        if (!_occupiedHas(occupied, i, a, 'node')) addNode(i, a);
        if (!_occupiedHas(occupied, i, b, 'node')) addNode(i, b);
      }
      if (aJoint && !_occupiedHas(occupied, i, a, 'node')) addNode(i, a);
      if (bJoint && !_occupiedHas(occupied, i, b, 'node')) addNode(i, b);
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
 *  than only the one this slice strictly needs.
 *  SE7k AMEND 1: exported (despite the underscore — same convention as
 *  this file's own nextSeed/_perfLog-style exceptions) so a Rail click-
 *  spawn (editor-interaction.js) can size itself to "the SAME extent
 *  Generate uses" without a second, divergent copy of this margin math.
 *
 *  T48 (SE13 Slice 2) 'boundary' branch: takes an OPTIONAL 3rd arg,
 *  `boundaryPrimitives` — the boundary shape's own SE13 Slice 1 primitive
 *  list, in WORLD/model-space inches (the SAME frame `worldPoint` bakes a
 *  live element's transform into elsewhere in this file) — T51: ALREADY
 *  the shape's own true inward-offset boundary when it's visibly
 *  stroked, not the raw edge (`_resolveBoundaryPrimitives`'s own job).
 *  Finding the live `data-boundary-ref` element and calling
 *  `shapeToPrimitives`/`shapeToInnerBoundaryPrimitives` on it is
 *  deliberately NOT done here: both are async (the `text` case awaits a
 *  font fetch) while every other `_resolveExtent` caller today is
 *  synchronous — rather than making every existing board/rect caller
 *  `await` for a code path they never use, the async DOM lookup is left
 *  to Slice 3's own live-wiring caller, which resolves
 *  `boundaryPrimitives` once (baking the element's own transform) and
 *  passes the result in here. This function's own job, staying
 *  synchronous, is just the lattice-unit SCALE (divide every primitive
 *  coordinate by `spacing`, exact for a uniform scale — rx/ry/phi/theta
 *  all stay geometrically correct, not approximated) plus the bbox
 *  pre-filter (`primitivesBBox`, SE13 Slice 1/T48) rounded OUT to whole
 *  lattice cells so a boundary that doesn't land exactly on a grid line
 *  still gets every row/column it actually touches considered. An empty/
 *  degenerate primitive list (deleted boundary element, self-intersecting
 *  shape, or a fully-collapsed inner offset — T51) resolves to an
 *  inverted, empty extent — `computePattern`'s own row loop
 *  (`jMin > jMax`) then naturally emits nothing, same "declined
 *  gracefully" shape §2 already establishes for `insideSpans` itself. */
export function _resolveExtent(editor, PATTERN, boundaryPrimitives) {
  const spacing = PATTERN.spacing || PATTERN_DEFAULTS.spacing;
  const extentSpec = PATTERN.extent || { mode: 'board' };
  if (extentSpec.mode === 'rect') {
    const { iMin, jMin, iMax, jMax } = extentSpec;
    return { iMin, jMin, iMax, jMax };
  }
  if (extentSpec.mode === 'boundary') {
    const primitives = (boundaryPrimitives || []).map((p) => _scalePrimitiveToLattice(p, spacing));
    const bbox = primitivesBBox(primitives);
    if (!bbox) return { iMin: 0, jMin: 0, iMax: -1, jMax: -1, mode: 'boundary', primitives: [] };
    return {
      iMin: Math.floor(bbox.xMin), jMin: Math.floor(bbox.yMin),
      iMax: Math.ceil(bbox.xMax), jMax: Math.ceil(bbox.yMax),
      mode: 'boundary', primitives,
    };
  }
  const margin = PATTERN.margin ?? PATTERN_DEFAULTS.margin;
  const topLeft = toLattice({ x: 0, y: 0 }, spacing);
  const bottomRight = toLattice({ x: editor._mW, y: editor._mH }, spacing);
  return {
    iMin: topLeft.i + margin, jMin: topLeft.j + margin,
    iMax: bottomRight.i - margin, jMax: bottomRight.j - margin,
  };
}

/** T48: one SE13 Slice 1 primitive, WORLD-space inches -> lattice-UNIT
 *  space (divide every coordinate by `spacing`) — a uniform scalar scale,
 *  so an ellipse/arc's rx/ry scale together and its phi/theta stay exact
 *  (angles are scale-invariant), not an approximation. Mirrors `toLattice`
 *  itself (`{x,y} -> {i,j}` is the same division, just not rounded to an
 *  integer here — `insideSpans` needs the CONTINUOUS position). */
function _scalePrimitiveToLattice(prim, spacing) {
  const pt = (p) => ({ x: p.x / spacing, y: p.y / spacing });
  switch (prim.type) {
    case 'L': return { type: 'L', p0: pt(prim.p0), p1: pt(prim.p1) };
    case 'C': return { type: 'C', p0: pt(prim.p0), p1: pt(prim.p1), p2: pt(prim.p2), p3: pt(prim.p3) };
    case 'CIRCLE': return { type: 'CIRCLE', cx: prim.cx / spacing, cy: prim.cy / spacing, r: prim.r / spacing };
    case 'A': return {
      type: 'A', cx: prim.cx / spacing, cy: prim.cy / spacing,
      rx: prim.rx / spacing, ry: prim.ry / spacing, phi: prim.phi, theta1: prim.theta1, dTheta: prim.dTheta,
    };
    default: return prim;
  }
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
 *
 * T49 (SE13 Slice 3): now ASYNC. `PATTERN.extent.mode === 'boundary'`
 * needs `shapeToPrimitives` (SE13 Slice 1), which is itself async (the
 * `text` boundary kind awaits a font fetch) — rather than a second,
 * sync-only code path, every caller now awaits this one. Board/rect mode
 * still resolves synchronously internally (no real await point is hit),
 * so the observable timing for every EXISTING caller is unchanged; only
 * boundary mode's own callers (the Boundary panel, the commit-refill
 * hook below) need to actually care that this returns a Promise now.
 */
// T59: moved up from just below generatePattern (originally declared only
// for refreshBoundaryPatterns' own re-entrancy) — generatePattern itself
// now ALSO sets this flag around its own commit (see its own end, below),
// so a caller that invokes generatePattern DIRECTLY on a boundary-mode
// pattern (every "Generate" button; T59's own new handle-drag `finish`)
// doesn't trigger a REDUNDANT extra refill-and-pushState of itself via
// the commit hook. Needed before generatePattern can reference it.
let _boundaryRefillInProgress = false;

export async function generatePattern(editor, PATTERN) {
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
  const boundary = { ...PATTERN_DEFAULTS.boundary, ...(PATTERN.boundary || {}) };

  const spacing = PATTERN.spacing || PATTERN_DEFAULTS.spacing;
  const isBoundary = PATTERN.extent && PATTERN.extent.mode === 'boundary';
  let boundaryEl = null;
  let boundaryEls = [];
  let extent;
  if (isBoundary) {
    // T51: the resolved primitives are ALREADY the shape's own true
    // inward-offset boundary (or the raw shape, when unstroked/
    // centerline) — _resolveBoundaryPrimitives does the inset itself now,
    // reusing the SAME boundary/widths the Border piece reads below.
    const resolved = await _resolveBoundaryPrimitives(editor, PATTERN, boundary, widths);
    boundaryEl = resolved.boundaryEl;
    boundaryEls = resolved.boundaryEls;
    extent = _resolveExtent(editor, PATTERN, resolved.primitives);
  } else {
    extent = _resolveExtent(editor, PATTERN);
  }
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
  // T72 (AMEND 5's own sweep, a real parity bug): skip a genuinely
  // zero-length piece rather than drawing a degenerate point element —
  // manifestFromLattice's own MIN_PIECE_LENGTH_IN filter (editor-
  // lattice.js) already excludes these from the manifest; without the
  // identical filter here, the app used to draw a `data-lattice="rail"`/
  // `"tie"` element the manifest never declared, an app/manifest COUNT
  // mismatch measured live at an extreme waistReach.
  const pieceLength = (p1, p2) => Math.hypot(p2.x - p1.x, p2.y - p1.y);

  editor._color = colors.rails;
  for (const seg of segments) {
    if (seg.kind !== 'rail') continue;
    const p1 = fromLattice(seg.a, spacing), p2 = fromLattice(seg.b, spacing);
    if (pieceLength(p1, p2) < MIN_PIECE_LENGTH_IN) continue;
    tagOwned(emitSegment(editor, 'rail', p1, p2, widths.rails));
  }
  editor._color = colors.ties;
  for (const seg of segments) {
    if (seg.kind !== 'tie') continue;
    const p1 = fromLattice(seg.a, spacing), p2 = fromLattice(seg.b, spacing);
    if (pieceLength(p1, p2) < MIN_PIECE_LENGTH_IN) continue;
    tagOwned(emitSegment(editor, 'tie', p1, p2, widths.ties));
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

  // T49 (SE13 §7, "the Border piece"): "the SAME d/shape geometry, just
  // re-stroked" — clone the LINKED boundary element itself rather than
  // re-deriving its geometry from the primitive list, so it decodes
  // through the SAME OUTLINE_KINDS export path the source element already
  // does (§8's own "zero new export code" claim, not just argued). Fred's
  // own ruling (T49 dispatch, "Border defaults to the boundary shape's
  // own stroke"): a null width/color inherits the LIVE boundary element's
  // own current stroke-width/stroke, not a Lattice color.
  // T73 (SE14b): a GENERATED contour is N per-segment elements now —
  // cloning just `boundaryEl` (the first one) would draw a Border tracing
  // only ONE segment. Build ONE fresh path from the segments' own combined,
  // RAW (never inset — the Border traces the contour's own visible edge,
  // not the fill-clip's inward-shrunk one) `d` instead of cloning when
  // there's more than one; the single-element (hand-picked boundary) case
  // is UNCHANGED, still a real `.clone()`.
  if (isBoundary && boundary.border && boundary.border.enabled && boundaryEl) {
    const borderColor = boundary.border.color || boundaryEl.attr('stroke') || '#000000';
    const borderWidth = _effectiveBorderWidth(boundaryEl, PATTERN, boundary, widths);
    const clone = boundaryEls.length > 1
      ? editor._sketchLayer.path(joinSegmentPathsIntoClosedD(boundaryEls.map((el) => el.attr('d') || '')))
      : boundaryEl.clone();
    clone.attr(BOUNDARY_REF_ATTR, null); // the clone is a COPY, not the link itself
    clone.attr('data-layer', targetLayer);
    clone.attr(LATTICE_ATTR, 'border');
    clone.fill('none');
    clone.stroke({ color: borderColor, width: borderWidth });
    clone.attr(OWNERSHIP_ATTR, PATTERN.id);
    if (boundaryEls.length <= 1) editor._sketchLayer.add(clone); // .path() above already lives in the layer; .clone() doesn't yet
  }

  if (typeof editor.pushState === 'function') editor.pushState();
  // T59 (a genuine, measured, PRE-EXISTING bug — confirmed live via CDP,
  // not assumed: 2 undo-stack entries per Generate press on a boundary-
  // mode layer, ever since T49 introduced boundary mode): this call's OWN
  // `_notifyChange('commit')` (editor.js) synchronously calls
  // `refreshBoundaryPatterns`, which — since `_boundaryRefillInProgress`
  // was never set by a DIRECT caller of generatePattern, only by
  // `refreshBoundaryPatterns` itself — sees the guard clear and re-runs
  // this SAME generatePattern a second time, which pushes a SECOND undo
  // step for one user gesture. Setting the guard around this call's own
  // commit (whenever this run is itself boundary-mode, the only case
  // refreshBoundaryPatterns would otherwise act on) suppresses that
  // redundant self-triggered refill — restored, not just cleared
  // afterward, in case a future caller ever invokes generatePattern from
  // INSIDE an already-in-progress refill.
  const wasRefilling = _boundaryRefillInProgress;
  if (isBoundary) _boundaryRefillInProgress = true;
  if (typeof editor._notifyChange === 'function') editor._notifyChange('commit');
  _boundaryRefillInProgress = wasRefilling;

  return { segments, nodePoints };
}

/**
 * T49 (SE13 §9, "commit-only link refresh"): re-run Generate for the
 * ACTIVE layer's own pattern whenever ANYTHING commits, but only when
 * that layer is actually in `extent.mode === 'boundary'` with a linked
 * shape — every other commit (the overwhelming majority) is a same-tick
 * no-op check, not a real regenerate. Reuses the SAME hook
 * `refreshOutlinePreview`/`refreshDrape` already fire from (`editor.js`'s
 * `_notifyChange('commit')`), per the design doc's own §9 instruction,
 * rather than a second, divergent "watch for boundary-shape edits" hook.
 *
 * Deliberately regenerates on EVERY commit while boundary mode is active,
 * not just a commit that touched the linked shape specifically — finding
 * "did THIS commit touch the linked element" would need its own tracking;
 * regenerating unconditionally is simpler, always correct (Generate is
 * idempotent for an unchanged boundary/seed), and "commit-only" already
 * rules out the truly expensive case (recomputing on every drag FRAME) —
 * see WORK-LOG-lane-b.md, T49, for the full disclosed tradeoff.
 *
 * Fire-and-forget: `editor.js`'s `_notifyChange` is synchronous and this
 * needs `generatePattern`'s own async boundary-resolution, so the refill
 * itself completes on a later microtask, not before `_notifyChange`
 * returns — an inherent consequence of `shapeToPrimitives`' own async
 * contract (the `text` boundary kind awaits a font fetch), not something
 * this function can avoid.
 */
export function refreshBoundaryPatterns(editor) {
  if (_boundaryRefillInProgress) return;
  if (!editor) return;
  const pattern = getLayerPattern(editor);
  if (!pattern || !pattern.extent || pattern.extent.mode !== 'boundary') return;
  if (!pattern.boundary || !pattern.boundary.shapeId) return;
  _boundaryRefillInProgress = true;
  generatePattern(editor, pattern)
    .catch((err) => console.warn('[editor-lattice-pattern] boundary refill failed:', err))
    .finally(() => { _boundaryRefillInProgress = false; });
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
 *
 * T72 (AMEND 2): `kind === 'contour'` is a genuinely different shape, not
 * a 4th `COLOR_KIND_TO_LATTICE_ATTR` entry — the contour is N linked
 * per-segment elements, found by `PATTERN.boundary.shapeId` (the exact
 * lookup `regenerateSilhouette` itself uses), never a `data-lattice`/
 * OWNERSHIP_ATTR-marked piece the rails/ties/nodes filter can see.
 *
 * T73 (SE14b): this is the CONTOUR'S OWN DEFAULT colour swatch — it
 * recolors every segment that does NOT carry its own explicit per-segment
 * override (`PATTERN.contour.segmentColors[i]`, keyed by PRIMITIVE index —
 * NOT `shape.segments[i]`'s topology index, see that field's own doc
 * comment in PATTERN_DEFAULTS — set via the normal select tool + toolbar
 * color picker, see `editor.setColor`'s own new contour-aware branch),
 * exactly like a rail/tie's own DEFAULT color never overwrites a
 * hand-detached piece's own color above. A segment WITH an override is
 * still counted as "owned" (still real, still Generate-managed) for the
 * @returns below, just left alone here.
 */
export function recolorOwnedKind(editor, layerId, kind, color) {
  if (kind === 'contour') {
    const layer = Array.isArray(editor?._layers) ? editor._layers.find((l) => l.id === layerId) : null;
    const shapeId = layer?.pattern?.boundary?.shapeId;
    const segmentColors = layer?.pattern?.contour?.segmentColors;
    const segEls = shapeId ? _findBoundaryElements(editor, shapeId) : [];
    if (!segEls.length) return 0;
    for (let i = 0; i < segEls.length; i++) {
      const override = Array.isArray(segmentColors) ? segmentColors[i] : null;
      if (!override) segEls[i].stroke({ color });
    }
    if (typeof editor.pushState === 'function') editor.pushState();
    if (typeof editor._notifyChange === 'function') editor._notifyChange('commit');
    return segEls.length;
  }
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
 * T58 ADD-ON (Fred: "I normally want ties and rails to be the same
 * width" — `widths.linkRailsTies`): the multi-kind sibling of
 * `rewidthOwnedKind` above — applies several kinds' width changes in ONE
 * pass, then pushes ONE undo step total, not one per kind. Calling
 * `rewidthOwnedKind` twice (once for 'rails', once for 'ties') would
 * satisfy "re-width both" but NOT "one undo step" — its own single
 * `pushState()` fires per call, so two calls would be two undo steps. A
 * genuinely reusable batch shape (declared once, not a one-off loop
 * inlined at the single caller this ships with), matching
 * `generatePattern`'s own "every internal step is undo-silent by
 * construction; pushState() fires exactly once" convention.
 *
 * @param {Array<[kind:string, value:number]>} kindValuePairs
 * @returns {number} total elements re-widthed, across all kinds.
 */
export function rewidthOwnedKinds(editor, layerId, kindValuePairs) {
  let total = 0;
  for (const [kind, value] of kindValuePairs) {
    const latticeKind = COLOR_KIND_TO_LATTICE_ATTR[kind];
    if (!latticeKind) continue;
    const owned = _ownedOnLayer(editor, layerId, latticeKind);
    for (const ch of owned) {
      if (latticeKind === 'node') ch.attr('r', value);
      else ch.attr('stroke-width', value);
    }
    total += owned.length;
  }
  if (total > 0) {
    if (typeof editor.pushState === 'function') editor.pushState();
    if (typeof editor._notifyChange === 'function') editor._notifyChange('commit');
  }
  return total;
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

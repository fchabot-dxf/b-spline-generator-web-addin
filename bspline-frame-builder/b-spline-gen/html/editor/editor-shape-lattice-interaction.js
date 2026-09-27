/**
 * editor-shape-lattice-interaction.js — T59 (SE14's own deferred "Slice 3
 * editing model"): the PURE math behind the two on-canvas interactions
 * dispatched this turn — axis-locked parametric handles, and tapping a
 * silhouette segment. No DOM, no editor object — same "pure function"
 * contract every other editor-shape-lattice-*.js module already sets
 * (editor-shape-lattice-generator.js's own header comment). The DOM-
 * touching half (rendering the handles, wiring pointer events, the
 * floating segment-style bar) lives in editor-interaction.js and
 * properties-shape-lattice.js, which both import from here.
 *
 * ## Handle design (a genuine, disclosed deviation from the dispatch's
 * own literal wording)
 *
 * The dispatch's own example list called `cornerRadius` a "diagonal"
 * handle ("corner radius — along the corner diagonal"). Measured against
 * the ACTUAL closed-form solver (`_solveHourglass`,
 * editor-shape-lattice-generator.js): the shoulder arc's own CENTER sits
 * at `(skelX, shoulderY)`, and — because `shoulderY = waistCenterYAbs -
 * notchHalfSpan` expands to `waistCenterYAbs - cornerRadiusAbs -
 * radiusWaist`, and `radiusWaist = skelX - waistX = (hw-cornerRadiusAbs)
 * - waistX`, the `cornerRadiusAbs` terms CANCEL — `shoulderY` does NOT
 * depend on `cornerRadius` at all. Anchoring the handle at the arc's own
 * CENTER (not its 45° on-curve point, which WOULD move diagonally) makes
 * the handle's own drag axis purely HORIZONTAL — simpler, and an EXACT
 * derived fact, not an approximation of "diagonal." Every handle below
 * ends up axis-aligned (horizontal or vertical) for the same reason; none
 * are declared diagonal.
 *
 * Mirroring is NOT a separate mechanic here (unlike per-segment style,
 * which genuinely needs one): both presets' own solvers build the LEFT
 * side as an exact mirror of the right (`M()` vs `P()`) from the SAME
 * global params, so a param handle (right side only, by convention) that
 * edits `shape.params[key]` already updates both sides for free — "the
 * mirrored side follows" falls out of the existing generator, it isn't
 * built here.
 */
import { PRESETS, feasibleParamRanges, hourglassConstruction, bottleConstruction, SHAPE_PARAM_KEYS } from './editor-shape-lattice-generator.js';

/** SE14 §3 Q5 ruling default, duplicated from properties-shape-lattice.
 *  js's own `_boardRegion` (small, pure, state-free — same "duplicate
 *  rather than cross-import a few lines" convention `_fmix32` already
 *  established elsewhere in this codebase). */
export function boardRegion(editor) {
  return { x: 0, y: 0, w: editor._mW || 4, h: editor._mH || 4 };
}

/**
 * `resolvedParams` (generateSilhouette's own new `params` return field) +
 * `region` -> an array of handle descriptors, right side only:
 * `{ key, label, anchor:{x,y}, axis:'x'|'y', valueFromWorld(pt) }`.
 * `valueFromWorld` reads ONLY the one coordinate its own axis cares
 * about, already clamped to the SAME range `_jitteredParam` itself
 * clamps to (editor-shape-lattice-generator.js) — a handle can never
 * drag a param into a range the generator would have silently re-clamped
 * anyway, so what's on screen always matches what gets written.
 */
export function computeParamHandles(preset, region, resolvedParams, keys = SHAPE_PARAM_KEYS[preset]) {
  const hw = region.w / 2, hh = region.h / 2, cx0 = region.x + hw, cy0 = region.y + hh;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // SIL-RESOLVE (F5): a handle clamps to the generator's own DECLARED
  // feasible range (conditional on the other resolved params), never a
  // hand-copied bound (the old cornerRadius bound 0.95 - waistReach was the
  // one that let the waist radius go negative).
  const R = feasibleParamRanges(preset, region, resolvedParams);
  const within = (key, v) => clamp(v, R[key].min, R[key].max);
  // F12: the handles a consumer asks for (`keys`), in this catalogue's order:
  // the Shape Lattice panel's SHAPE_PARAM_KEYS by default; a frame asks for its
  // own binding table's keys (frames never get the new params).
  const pick = (catalogue) => catalogue.filter((h) => keys.includes(h.key));

  // H13: each handle carries its own feasible range alongside
  // valueFromWorld (already clamped INTO it) so a DOM-touching consumer
  // (editor-interaction.js, frame-handles.js) can tell whether a given
  // drag actually hit that clamp -- `value === range.min/max` -- and fire
  // its own haptic('limit') there. Deliberately not done here: this
  // module's own header comment declares it "PURE math... no DOM", and
  // haptic() reaches navigator/document/localStorage.
  const withRange = (handles) => handles.map((h) => ({ ...h, range: R[h.key] }));

  if (preset === 'bottle') {
    const b = bottleConstruction(region, resolvedParams); // the generator's own construction
    return withRange(pick([
      {
        key: 'neckWidth', label: 'Neck width', axis: 'x',
        anchor: { x: cx0 + b.neckHalfW, y: cy0 + (-hh + b.neckCenterY) / 2 }, // midway down the top horn — off the neckLength handle, which sits AT the horn corner
        valueFromWorld: (pt) => within('neckWidth', (pt.x - cx0) / hw),
      },
      {
        // T74 AMEND 3 (Fred: "it needs to fill the box same as hourglass"):
        // the 'bodyWidth' handle (dragged the bottom-right corner along
        // the outer edge) is RETIRED along with the param itself — the
        // body always spans the full half-width now, nothing left to drag.
        key: 'skeletonX', label: 'S-curve tightness', axis: 'x',
        anchor: { x: cx0 + b.skelX, y: cy0 + b.neckCenterY }, // the neck arc's own CENTER — pure horizontal move, same reasoning as hourglass's cornerRadius
        valueFromWorld: (pt) => within('skeletonX', (pt.x - cx0) / hw),
      },
      {
        key: 'neckLength', label: 'Shoulder height', axis: 'y',
        anchor: { x: cx0 + b.neckHalfW, y: cy0 + b.neckCenterY }, // the neck horn corner itself
        valueFromWorld: (pt) => within('neckLength', (pt.y - region.y) / region.h),
      },
      {
        // F12: the body shoulder radius: its arc's own CENTRE sits at hw - rB
        key: 'bodyRadius', label: 'Body shoulder radius', axis: 'x',
        anchor: { x: cx0 + b.bodyCx, y: cy0 + b.hipCenterY },
        valueFromWorld: (pt) => within('bodyRadius', (cx0 + hw - pt.x) / hw),
      },
    ]));
  }

  // hourglass (default).
  const g = hourglassConstruction(region, resolvedParams); // the generator's own construction, not a copy
  return withRange(pick([
    {
      key: 'waistReach', label: 'Waist reach', axis: 'x',
      anchor: { x: cx0 + g.waistX, y: cy0 + g.waistCenterY }, // the waist arc's own deepest point (the pinch)
      valueFromWorld: (pt) => within('waistReach', 1 - (pt.x - cx0) / hw),
    },
    {
      // F12: the top corner alone (its arc centre at hw - Rt, a pure horizontal move); F20: Fred's "Shoulder"
      key: 'cornerRadiusTop', label: 'Shoulder', axis: 'x',
      anchor: { x: cx0 + g.shoulderCx, y: cy0 + g.shoulderY },
      valueFromWorld: (pt) => within('cornerRadiusTop', (cx0 + hw - pt.x) / hw),
    },
    {
      key: 'cornerRadiusBottom', label: 'Hip', axis: 'x',
      anchor: { x: cx0 + g.hipCx, y: cy0 + g.hipY },
      valueFromWorld: (pt) => within('cornerRadiusBottom', (cx0 + hw - pt.x) / hw),
    },
    {
      key: 'waistCenterY', label: 'Waist position', axis: 'y',
      anchor: { x: cx0, y: cy0 + g.waistCenterY }, // on the centerline (off the waistReach handle, which sits at the waistX apex)
      valueFromWorld: (pt) => within('waistCenterY', (pt.y - cy0) / hh),
    },
    {
      // F12: the waist radius, independent of the corners: its arc's CENTRE,
      // at the pinch + Rw on the pinch's own line (the pinch depth is fixed)
      key: 'waistRadius', label: 'Waist radius', axis: 'x',
      anchor: { x: cx0 + g.waistCx, y: cy0 + g.waistCenterY },
      valueFromWorld: (pt) => within('waistRadius', (pt.x - (cx0 + g.waistX)) / hw),
    },
  ]));
}

/** An `A` primitive's own point at parameter `t` (0=start, 1=end) —
 *  duplicated from editor-shape-lattice-generator.js's own private
 *  `_arcPointAt` (same "small pure helper, duplicated per module"
 *  convention `_fmix32` already established) rather than exporting a
 *  third private helper across an unrelated module boundary. */
function _arcPointAt(prim, t) {
  const theta = prim.theta1 + prim.dTheta * t;
  const cosPhi = Math.cos(prim.phi), sinPhi = Math.sin(prim.phi);
  const ex = prim.rx * Math.cos(theta), ey = prim.ry * Math.sin(theta);
  return { x: prim.cx + ex * cosPhi - ey * sinPhi, y: prim.cy + ex * sinPhi + ey * cosPhi };
}

/** Point-to-line-segment distance (`L` primitive) — the standard clamped
 *  projection onto the segment. */
function _distToLine(pt, p0, p1) {
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((pt.x - p0.x) * dx + (pt.y - p0.y) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(pt.x - (p0.x + t * dx), pt.y - (p0.y + t * dy));
}

/** Point-to-arc distance (`A` primitive) — this generator's own arcs are
 *  always CIRCULAR (`rx===ry`, T55's own bulge-derived construction) and
 *  never rotated (`phi` is always 0, `primitivesToPathD`'s own doc
 *  comment) — a plain "distance from the circle, clamped to the arc's
 *  own angular span" is therefore exact, not an ellipse approximation.
 *  Outside the span, the nearest ENDPOINT distance (via `_arcPointAt`)
 *  applies, matching how a person actually perceives "near this curved
 *  segment" past its own ends. */
function _distToArc(pt, prim) {
  const distFromCenter = Math.hypot(pt.x - prim.cx, pt.y - prim.cy);
  let rel = Math.atan2(pt.y - prim.cy, pt.x - prim.cx) - prim.theta1;
  const TAU = Math.PI * 2;
  rel -= TAU * Math.floor((rel + Math.PI) / TAU); // normalize to (-PI, PI]
  const onArc = prim.dTheta >= 0 ? (rel >= 0 && rel <= prim.dTheta) : (rel <= 0 && rel >= prim.dTheta);
  if (onArc) return Math.abs(distFromCenter - prim.rx);
  const p0 = _arcPointAt(prim, 0), p1 = _arcPointAt(prim, 1);
  return Math.min(Math.hypot(pt.x - p0.x, pt.y - p0.y), Math.hypot(pt.x - p1.x, pt.y - p1.y));
}

/** `segments[i]` -> which PRIMITIVE indices it contributed —
 *  `_segmentToPrimitives` (editor-shape-lattice-generator.js) emits TWO
 *  `L`s for a `kink` (the apex construction) and exactly ONE otherwise
 *  (a straight `L`, or a single `A`) — the only place a primitive index
 *  and a segment index genuinely diverge. Declared once so the tap-
 *  hit-test below and any future caller share the SAME mapping rather
 *  than each re-deriving "is this a kink" from style strings. */
export function primitiveSegmentMap(segments) {
  const map = [];
  segments.forEach((seg, i) => {
    const count = seg && seg.style === 'kink' ? 2 : 1;
    for (let k = 0; k < count; k++) map.push(i);
  });
  return map;
}

/**
 * Tap-a-segment hit-test: `primitives` + `segments` (generateSilhouette's
 * own return, `segments.length === keypoints.length`) + a WORLD point +
 * a tolerance (model units, caller converts from screen px the same way
 * `getDynamicTolerance` does elsewhere in this codebase) -> the closest
 * segment's own index, or `null` if nothing is within tolerance.
 */
export function hitTestSegment(primitives, segments, pt, tolerance) {
  const map = primitiveSegmentMap(segments);
  let bestIndex = null, bestDist = Infinity;
  primitives.forEach((prim, i) => {
    const d = prim.type === 'L' ? _distToLine(pt, prim.p0, prim.p1) : _distToArc(pt, prim);
    if (d < bestDist) { bestDist = d; bestIndex = map[i]; }
  });
  return bestDist <= tolerance ? bestIndex : null;
}

/** SE14 §4's own "mirrored pairs" rule, duplicated from properties-
 *  shape-lattice.js (a genuinely shared small pure function — declared
 *  here too rather than importing across the DOM/pure boundary, same
 *  "duplicate a small pure helper" convention as `_arcPointAt` above).
 *  See that file's own doc comment for the derivation. */
export function mirrorSegmentIndex(i, n) {
  if (i === n / 2 - 1 || i === n - 1) return i;
  return n - 2 - i;
}

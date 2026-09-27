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
 * F27 item 2 (Fred: "handle for position should be a different color or
 * shape than handle for radii"): every handle also declares its KIND
 * (`handleKind`: 'position' | 'radius', drawn from the ONE kind table in
 * editor-transform-handles.js), and the two radius params whose handle sat at
 * an arc CENTRE with no arc of its own to grab (hourglass `waistRadius`,
 * bottle `bodyRadius`) now sit ON their arc (axis 'arc'): the drag re-solves
 * the radius whose arc passes under the pointer (radiusThroughPoint).
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
 * `{ key, label, anchor:{x,y}, axis:'x'|'y'|'arc', handleKind:'position'|'radius', valueFromWorld(pt) }`
 * (F27 item 2: 'arc' = an on-arc radius handle, which reads both coordinates).
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
  // F27 item 2: an ON-ARC radius handle (axis 'arc'): the drag re-solves the
  // radius whose arc passes under the pointer (radiusThroughPoint), inside the
  // SAME declared feasible range as every other handle.
  const throughPoint = (key, circleAt) => (pt) => within(key, radiusThroughPoint(circleAt, R[key], resolvedParams[key], pt));

  if (preset === 'bottle') {
    const b = bottleConstruction(region, resolvedParams); // the generator's own construction
    return withRange(pick([
      {
        key: 'neckWidth', label: 'Neck width', axis: 'x', handleKind: 'position',
        anchor: { x: cx0 + b.neckHalfW, y: cy0 + (-hh + b.neckCenterY) / 2 }, // midway down the top horn — off the neckLength handle, which sits AT the horn corner
        valueFromWorld: (pt) => within('neckWidth', (pt.x - cx0) / hw),
      },
      {
        // T74 AMEND 3 (Fred: "it needs to fill the box same as hourglass"):
        // the 'bodyWidth' handle (dragged the bottom-right corner along
        // the outer edge) is RETIRED along with the param itself — the
        // body always spans the full half-width now, nothing left to drag.
        // F27 item 2: a RADIUS handle -- with the neck width held, it sets the
        // neck arc's own radius (skeletonX - neckWidth), whatever its label says.
        key: 'skeletonX', label: 'S-curve tightness', axis: 'x', handleKind: 'radius',
        anchor: { x: cx0 + b.skelX, y: cy0 + b.neckCenterY }, // the neck arc's own CENTER — pure horizontal move, same reasoning as hourglass's cornerRadius
        valueFromWorld: (pt) => within('skeletonX', (pt.x - cx0) / hw),
      },
      {
        key: 'neckLength', label: 'Shoulder height', axis: 'y', handleKind: 'position',
        anchor: { x: cx0 + b.neckHalfW, y: cy0 + b.neckCenterY }, // the neck horn corner itself
        valueFromWorld: (pt) => within('neckLength', (pt.y - region.y) / region.h),
      },
      {
        // F12: the body shoulder radius. F27 item 2 (Fred: "handle for position
        // should be a different color or shape than handle for radii", a radius
        // handle ON its arc): no longer at the arc's CENTRE (hw - rB) but ON the
        // body arc, midway between its neck junction and its tangent point on the
        // side (the bisector of the two directions from its centre). The body's
        // centre and its tangency with the neck both move with rB, so the drag is
        // the numeric radiusThroughPoint over the generator's own construction.
        key: 'bodyRadius', label: 'Body shoulder radius', axis: 'arc', handleKind: 'radius',
        anchor: _onArc({ x: cx0 + b.bodyCx, y: cy0 + b.hipCenterY }, b.radiusBody, { x: 1 - b.bux, y: -b.buy }),
        valueFromWorld: throughPoint('bodyRadius', (v) => {
          const c = bottleConstruction(region, { ...resolvedParams, bodyRadius: v });
          return { cx: cx0 + c.bodyCx, cy: cy0 + c.hipCenterY, r: c.radiusBody };
        }),
      },
    ]));
  }

  // hourglass (default).
  const g = hourglassConstruction(region, resolvedParams); // the generator's own construction, not a copy
  return withRange(pick([
    {
      key: 'waistReach', label: 'Waist reach', axis: 'x', handleKind: 'position',
      anchor: { x: cx0 + g.waistX, y: cy0 + g.waistCenterY }, // the waist arc's own deepest point (the pinch)
      valueFromWorld: (pt) => within('waistReach', 1 - (pt.x - cx0) / hw),
    },
    {
      // F12: the top corner alone (its arc centre at hw - Rt, a pure horizontal move); F20: Fred's "Shoulder"
      key: 'cornerRadiusTop', label: 'Shoulder', axis: 'x', handleKind: 'radius',
      anchor: { x: cx0 + g.shoulderCx, y: cy0 + g.shoulderY },
      valueFromWorld: (pt) => within('cornerRadiusTop', (cx0 + hw - pt.x) / hw),
    },
    {
      key: 'cornerRadiusBottom', label: 'Hip', axis: 'x', handleKind: 'radius',
      anchor: { x: cx0 + g.hipCx, y: cy0 + g.hipY },
      valueFromWorld: (pt) => within('cornerRadiusBottom', (cx0 + hw - pt.x) / hw),
    },
    {
      key: 'waistCenterY', label: 'Waist position', axis: 'y', handleKind: 'position',
      anchor: { x: cx0, y: cy0 + g.waistCenterY }, // on the centerline (off the waistReach handle, which sits at the waistX apex)
      valueFromWorld: (pt) => within('waistCenterY', (pt.y - cy0) / hh),
    },
    {
      // F12: the waist radius, independent of the corners. F27 item 2 (Fred,
      // Frame tab, Hourglass: the waist's arc radius "can never be set
      // anywhere, it needs a handle"): the handle sits ON the waist arc, no
      // longer at its CENTRE (off the board for a flat waist). Not at the apex:
      // the apex IS the pinch, where the waistReach (position) handle already
      // sits, so it sits on the upper part of the arc, WAIST_RADIUS_HANDLE_AT of
      // the angle (about the waist centre) from the pinch to the shoulder
      // junction. The pinch is fixed while the radius changes (every waist
      // circle passes through it, centred on its horizontal line), so the drag
      // is the circle through the pinch AND the pointer: pulled outward (along
      // the normal, toward the board edge) the waist tightens, pushed inward it
      // flattens.
      key: 'waistRadius', label: 'Waist radius', axis: 'arc', handleKind: 'radius',
      anchor: _onArc({ x: cx0 + g.waistCx, y: cy0 + g.waistCenterY }, g.radiusWaist,
        _angleFraction({ x: -1, y: 0 }, { x: -g.ux, y: -g.uy }, WAIST_RADIUS_HANDLE_AT)),
      valueFromWorld: throughPoint('waistRadius', (v) => ({ cx: cx0 + g.waistX + v * hw, cy: cy0 + g.waistCenterY, r: v * hw })),
    },
  ]));
}

/** F27 item 2: the point at radius `r` from `c` in direction `dir` (need not be unit). */
function _onArc(c, r, dir) {
  const l = Math.hypot(dir.x, dir.y);
  const u = l > 1e-12 ? { x: dir.x / l, y: dir.y / l } : { x: 0, y: -1 };
  return { x: c.x + r * u.x, y: c.y + r * u.y };
}

/**
 * F27 item 2: where the waist radius handle sits on its arc, as a fraction of
 * the angle from the pinch (0) to the shoulder junction (1). A design choice,
 * MEASURED in the first headless drag: at the midpoint (0.5) an 0.18 in drag
 * already threw the 7x9 waist radius to its limit (0.68 -> 8.4 in). Moving
 * the arc point at angle phi from the pinch by 1 along the normal changes the
 * radius by 1 / (1 - cos phi) (every waist circle passes through the fixed
 * pinch): 7.5x at 30 degrees, 2x at 60 -- so the handle sits well past the
 * middle, still clear of the junction.
 */
export const WAIST_RADIUS_HANDLE_AT = 0.75;

/** F27 item 2: the direction a fraction `f` (by angle) of the way from unit
 *  vector `a` to unit vector `b`, the sweep measured clockwise on screen
 *  (y-down) from `a` in (0, 2pi): the waist's upper part turns from the pinch
 *  (-1, 0) up toward -y, and a MAJOR waist (a span past a half-turn) still
 *  lands on the arc. */
function _angleFraction(a, b, f) {
  const base = Math.atan2(a.y, a.x);
  let d = Math.atan2(b.y, b.x) - base;
  while (d <= 0) d += 2 * Math.PI;
  while (d > 2 * Math.PI) d -= 2 * Math.PI;
  return { x: Math.cos(base + d * f), y: Math.sin(base + d * f) };
}

/**
 * F27 item 2: the radius (a param value, in `range`) whose circle passes
 * through `pt` -- the drag rule of an ON-ARC radius handle ("dragging along
 * the normal changes the radius"): the arc follows the pointer. `circleAt(v)`
 * is the generator's own construction for that value, `{cx, cy, r}`. Solved
 * numerically (sampled sign changes of |pt - centre| - r, then bisection), so
 * it needs no per-arc algebra; of several roots the one nearest `current`
 * wins (a drag never jumps to a far solution). No root inside the range =
 * the pointer is past the true geometric limit: the nearer end of the range
 * (a manual drag reaches the limit, it does not stop short of it).
 */
export function radiusThroughPoint(circleAt, range, current, pt, samples = 64) {
  const s = (v) => { const c = circleAt(v); return Math.hypot(pt.x - c.cx, pt.y - c.cy) - c.r; };
  const lo = range.min;
  const hi = Number.isFinite(range.max) ? range.max : Math.max(lo, Number(current) || 0) * 4 + 1;
  if (!(hi > lo)) return lo;
  const cur = Number.isFinite(current) ? Math.max(lo, Math.min(hi, current)) : (lo + hi) / 2;
  // The family's own ORIENTATION at the current value: whether a growing value
  // sweeps the current arc outward (s falls) or inward (s rises) near the
  // pointer, taken at the current arc's point nearest the pointer. A root
  // crossing the SAME way is on the current branch; one crossing the other way
  // is a different sheet of the family (MEASURED, T2 body arc: its small
  // radii fold back, so "nearest root" alone jumped branches mid-drag).
  const c0 = circleAt(cur), l0 = Math.hypot(pt.x - c0.cx, pt.y - c0.cy) || 1;
  const P0 = { x: c0.cx + c0.r * (pt.x - c0.cx) / l0, y: c0.cy + c0.r * (pt.y - c0.cy) / l0 };
  const sP = (v) => { const c = circleAt(v); return Math.hypot(P0.x - c.cx, P0.y - c.cy) - c.r; };
  const dv = (hi - lo) * 1e-4;
  const orient = Math.sign(sP(Math.min(hi, cur + dv)) - sP(Math.max(lo, cur - dv)));
  let best = null, bestAny = null;
  const offer = (v, dir) => {
    if (bestAny === null || Math.abs(v - cur) < Math.abs(bestAny - cur)) bestAny = v;
    if ((dir === 0 || dir === orient) && (best === null || Math.abs(v - cur) < Math.abs(best - cur))) best = v;
  };
  let v0 = lo, s0 = s(lo);
  for (let i = 1; i <= samples; i++) {
    const v1 = lo + (hi - lo) * i / samples, s1 = s(v1);
    if (s0 === 0) offer(v0, 0);
    else if (s0 * s1 < 0) {
      let a = v0, b = v1, sa = s0;
      for (let k = 0; k < 60; k++) {
        const m = (a + b) / 2, sm = s(m);
        if (sm === 0) { a = b = m; break; }
        if (sa * sm < 0) b = m; else { a = m; sa = sm; }
      }
      offer((a + b) / 2, Math.sign(s1 - s0));
    }
    v0 = v1; s0 = s1;
  }
  if (s0 === 0) offer(v0, 0);
  if (best !== null) return best;
  if (bestAny !== null) return bestAny;
  return Math.abs(s(lo)) <= Math.abs(s(hi)) ? lo : hi;
}

/**
 * T81 item 1 (Fred screenshot: "add visual feedback to these handles on
 * hover" -- the segment a handle controls should highlight too, "so you
 * see WHAT it moves before dragging"): which contour SEGMENT INDEX each
 * handle key's own drag actually reshapes, right side only (a handle's own
 * side, matching `computeParamHandles`' "right side only" convention).
 *
 * Declared once as a plain lookup, not inferred from the handle's anchor
 * point geometrically (an anchor sits at an arc's own CENTER for several
 * handles -- see this file's own header comment -- which is NOT on that
 * arc's curve, so a nearest-point-to-anchor search could easily pick the
 * WRONG nearby segment). Instead this is read directly off
 * `_solveHourglass`/`_solveBottle`'s (editor-shape-lattice-generator.js)
 * own FIXED keypoint/segment order -- unconditional on any param value, by
 * construction (each solver's own `fresh` array comment: "keypoints[0] ===
 * rTop, starts at the first real edge out of rTop"):
 *   hourglass: 0 horn, 1 SHOULDER, 2 WAIST, 3 HIP, 4 horn, 5 bottom edge,
 *              6 horn, 7 hip(L), 8 waist(L), 9 shoulder(L), 10 horn, 11 top edge.
 *   bottle:    0 horn, 1 NECK/WAIST, 2 HIP/BODY, 3 horn, 4 bottom edge,
 *              5 horn, 6 hip/body(L), 7 neck/waist(L), 8 horn, 9 top edge.
 * `waistCenterY` repositions the pinch itself (shoulderY/hipY are BOTH
 * derived from it -- this file's own header comment) but has no single
 * curve of its own; the waist arc is the one it most directly sets, so it
 * maps there rather than being left unhighlighted. If a generator solver's
 * own segment order ever changes, this table must change with it -- there
 * is no automatic check tying the two together.
 */
export const HANDLE_SEGMENT_INDEX = {
  hourglass: { cornerRadiusTop: 1, waistReach: 2, cornerRadiusBottom: 3, waistCenterY: 2, waistRadius: 2 },
  bottle: { neckWidth: 1, skeletonX: 1, neckLength: 1, bodyRadius: 2 },
};

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

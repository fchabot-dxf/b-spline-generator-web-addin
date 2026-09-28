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
 * ## Handle design
 *
 * POSITION handles are axis-locked (horizontal or vertical, never diagonal):
 * each reads ONE coordinate of the pointer. (The dispatch's own example list
 * called `cornerRadius` a "diagonal" handle; measured against the closed-form
 * solver, the corner arcs' drag was an exact horizontal centre move -- and
 * since F27 item 2's arc pull a radius is no longer an axis handle at all.)
 *
 * F27 item 2 (Fred: "handle for position should be a different color or
 * shape than handle for radii"): every handle also declares its KIND
 * (`handleKind`: 'position' | 'radius', drawn from the ONE kind table in
 * editor-transform-handles.js).
 *
 * F27 item 2 ARC PULL (Fred: "the more I look at it the more I'm thinking it's
 * more intuitive to pull the arc than the arc center"; then "Well I still want
 * a handle on the curve itself"): a RADIUS param's handle is the ARC ITSELF
 * (axis 'arc'): a press on either side's arc (the segment HANDLE_SEGMENT_INDEX
 * names and its mirror, both carried as `arcs`) grabs it, and the drag
 * re-solves the value whose arc passes under the pointer (radiusThroughPoint
 * over the generator's own silhouette for that value). The blue radius dot
 * still shows WHERE, sitting ON the right arc (`anchor`, the angular
 * midpoint): dragging it is dragging the arc at that point. The hourglass
 * WAIST is a CAD circle instead (Fred agreed): (Fred: "Then the position for
 * waist reach can be the arc center") its waistReach POSITION square moved off
 * the pinch to the waist arc's CENTRE and slides the whole waist sideways, its
 * radius held (waistReachFromCentre); and its arc -- dot on the pinch -- is the
 * rim, following the pointer about that fixed centre.
 *
 * Mirroring is NOT a separate mechanic here (unlike per-segment style,
 * which genuinely needs one): both presets' own solvers build the LEFT
 * side as an exact mirror of the right (`M()` vs `P()`) from the SAME
 * global params, so a param handle (right side only, by convention) that
 * edits `shape.params[key]` already updates both sides for free — "the
 * mirrored side follows" falls out of the existing generator, it isn't
 * built here. (The arc pull's LEFT arc grip mirrors the pointer onto the
 * right arc and solves there.)
 */
import { feasibleParamRanges, hourglassConstruction, bottleConstruction, generateSilhouette, SHAPE_PARAM_KEYS } from './editor-shape-lattice-generator.js';

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
 * `{ key, label, anchor:{x,y}, axis:'x'|'y'|'arc', handleKind:'position'|'radius',
 *    valueFromWorld(pt, ctx), patchFromWorld(pt, ctx), range, value }`.
 * A position handle's `valueFromWorld` reads ONLY the one coordinate its own
 * axis cares about; an arc grip ('arc', F27 item 2 arc pull) also carries
 * `segment`/`mirrorSegment`/`arcs` (right, left) and reads both coordinates,
 * `ctx.side` (1 = the mirrored left arc) saying which arc was grabbed.
 * `ctx.grab` = `{value}`, the param's value when the drag began (waistReach's
 * parked mapping reads it). Every value comes back already clamped to the SAME
 * range `_jitteredParam` itself clamps to (editor-shape-lattice-generator.js)
 * — a handle can never drag a param into a range the generator would have
 * silently re-clamped anyway, so what's on screen always matches what gets
 * written.
 *
 * `patchFromWorld` (F27 item 2 arc pull) is what a drag WRITES: `{[key]: value}`
 * for every handle but the hourglass waist pair, whose drags keep the waist
 * CENTRE put or move it rigidly and so write BOTH waistReach and waistRadius
 * (see there). Consumers write the patch, never just `valueFromWorld`.
 *
 * `opts` (F27 item 2 arc pull): the arcs a grip holds are the DRAWN ones. The
 * Shape Lattice draws its contour inset by half its stroke
 * (generateContourSilhouette) and may carry user-styled segments:
 * `opts.shape` = the consumer's own raw shape `{params, segments, seed}` (the
 * dragged value lands in THOSE params, so the solve re-generates exactly what
 * the write will produce), `opts.strokeHalfWidth` = its inset. A frame passes
 * its own params and no inset, and `opts.rangesFor(params)` = its own ranges
 * (frameParamRanges: the silhouette's, narrowed by the frame opening rule) —
 * the ONE range source every clamp here reads, so a coupled waist drag can stop
 * at whichever limit binds first.
 */
export function computeParamHandles(preset, region, resolvedParams, keys = SHAPE_PARAM_KEYS[preset], opts = {}) {
  const hw = region.w / 2, hh = region.h / 2, cx0 = region.x + hw, cy0 = region.y + hh;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const sh = opts.strokeHalfWidth || 0;
  // SIL-RESOLVE (F5): a handle clamps to the generator's own DECLARED
  // feasible range (conditional on the other resolved params), never a
  // hand-copied bound (the old cornerRadius bound 0.95 - waistReach was the
  // one that let the waist radius go negative).
  const rangesFor = opts.rangesFor || ((params) => feasibleParamRanges(preset, region, params, sh));
  const R = rangesFor(resolvedParams);
  const within = (key, v) => clamp(v, R[key].min, R[key].max);
  // F12: the handles a consumer asks for (`keys`), in this catalogue's order:
  // the Shape Lattice panel's SHAPE_PARAM_KEYS by default; a frame asks for its
  // own binding table's keys (frames never get the new params).
  const pick = (catalogue) => catalogue.filter((h) => h && keys.includes(h.key));

  // H13: each handle carries its own feasible range alongside
  // valueFromWorld (already clamped INTO it) so a DOM-touching consumer
  // (editor-interaction.js, frame-handles.js) can tell whether a given
  // drag actually hit that clamp -- `value === range.min/max` -- and fire
  // its own haptic('limit') there. Deliberately not done here: this
  // module's own header comment declares it "PURE math... no DOM", and
  // haptic() reaches navigator/document/localStorage. (F27 item 2 arc pull:
  // and its current `value`, which a consumer records as the drag's grab.)
  const withRange = (handles) => handles.map((h) => ({
    patchFromWorld: (pt, c) => ({ [h.key]: h.valueFromWorld(pt, c) }),
    ...h, range: R[h.key], value: resolvedParams[h.key],
  }));
  // F27 item 2 arc pull: the radius params' arc grips, over the DRAWN silhouette.
  const base = { preset, params: resolvedParams, ...(opts.shape || {}) };
  const sil = generateSilhouette(region, base, sh);
  const ctx = { preset, region, base, sh, sil, R, within };
  const arc = (key, label) => (keys.includes(key) ? _arcGrip(key, label, resolvedParams[key], ctx) : null);

  if (preset === 'bottle') {
    const b = bottleConstruction(region, resolvedParams); // the generator's own construction
    return withRange(pick([
      {
        key: 'neckWidth', label: 'Neck width', axis: 'x', handleKind: 'position',
        anchor: { x: cx0 + b.neckHalfW, y: cy0 + (-hh + b.neckCenterY) / 2 }, // midway down the top horn — off the neckLength handle, which sits AT the horn corner
        valueFromWorld: (pt) => within('neckWidth', (pt.x - cx0) / hw),
      },
      // T74 AMEND 3 (Fred: "it needs to fill the box same as hourglass"): the
      // 'bodyWidth' handle is RETIRED along with the param itself. F27 item 2: a
      // RADIUS param -- with the neck width held, skeletonX sets the neck arc's
      // own radius (skeletonX - neckWidth), whatever its label says. Arc pull:
      // grabbed on the neck arc; its dot at the angular midpoint (every neck
      // circle passes through the neck horn point, the arc's START, well clear
      // of the midpoint).
      arc('skeletonX', 'S-curve tightness'),
      {
        key: 'neckLength', label: 'Shoulder height', axis: 'y', handleKind: 'position',
        anchor: { x: cx0 + b.neckHalfW, y: cy0 + b.neckCenterY }, // the neck horn corner itself
        valueFromWorld: (pt) => within('neckLength', (pt.y - region.y) / region.h),
      },
      // F12: the body shoulder radius. Arc pull: grabbed on the body arc (tangent
      // to the side and to the neck arc: no point common to its family), its dot
      // at the angular midpoint.
      arc('bodyRadius', 'Body shoulder radius'),
    ]));
  }

  // hourglass (default).
  const g = hourglassConstruction(region, resolvedParams); // the generator's own construction, not a copy
  const edge = cx0 + hw; // the region's outer edge (the frame's outer edge in the Frame tab)
  const centre = { x: cx0 + g.waistCx, y: cy0 + g.waistCenterY }; // the waist arc's own centre
  // F27 item 2 arc pull, the WAIST as a CAD circle (Fred): a centre point (the
  // waistReach square) and a point on the rim (the waistRadius arc). Both drags
  // write BOTH params: waistReach = (hw + Rw - (centre - cx0)) / hw ties the
  // centre to the pinch depth. `waistOk` is the ONE feasibility test for such a
  // pair (the waist radius range depends on the depth), so either drag stops at
  // whichever limit binds first and the centre never drifts.
  const waistOk = (reach, rw) => reach >= R.waistReach.min && reach <= R.waistReach.max
    && (() => { const r = rangesFor({ ...resolvedParams, waistReach: reach }).waistRadius; return rw >= r.min && rw <= r.max; })();
  const reachFor = (rwFrac, centreX) => 1 + rwFrac - (centreX - cx0) / hw;
  return withRange(pick([
    {
      // F27 item 2 arc pull (Fred: "Then the position for waist reach can be the
      // arc center"): the square sits at the waist arc's CENTRE, on the pinch's
      // own line, and slides the whole waist arc sideways with its radius HELD --
      // so the patch pins waistRadius too (a Shape Lattice pattern that leaves it
      // to its derived default d - Rs would otherwise keep the centre on the
      // shoulder column, unable to move at all). A flat waist's centre past the
      // outer edge PARKS the square on that edge (waistReachFromCentre: no jump).
      key: 'waistReach', label: 'Waist reach', axis: 'x', handleKind: 'position',
      anchor: { x: Math.min(centre.x, edge), y: centre.y },
      ..._patchHandle('waistReach', (pt, c = {}) => {
        const rw = resolvedParams.waistRadius;
        const want = waistReachFromCentre({ cx0, hw, edge, radiusWaist: g.radiusWaist }, pt.x,
          c.grab ? c.grab.value : resolvedParams.waistReach);
        const reach = _furthest(resolvedParams.waistReach, want, (v) => waistOk(v, rw));
        return { waistReach: reach, waistRadius: rw };
      }),
    },
    // F12: the top corner alone; F20: Fred's "Shoulder". Arc pull: grabbed on the
    // shoulder arc, its dot at the angular midpoint (tangent to the side and to
    // the waist: no point common to its family). Same for the Hip.
    arc('cornerRadiusTop', 'Shoulder'),
    arc('cornerRadiusBottom', 'Hip'),
    {
      key: 'waistCenterY', label: 'Waist position', axis: 'y', handleKind: 'position',
      anchor: { x: cx0, y: centre.y }, // on the centerline (off the waistReach square, at the waist centre)
      valueFromWorld: (pt) => within('waistCenterY', (pt.y - cy0) / hh),
    },
    // F12: the waist radius, independent of the corners. F27 item 2 arc pull, the
    // waist as a CAD circle (Fred): the WHOLE waist arc is its rim -- grabbed
    // anywhere (either side), the rim follows the pointer about a FIXED centre:
    // Rw = |pointer - centre| (less the stroke inset: a concave drawn arc is Rw
    // + inset), and the depth changes with it so the centre stays put. One rule
    // for the whole arc, the dot included; its dot sits ON THE PINCH (the rim
    // point facing the centre square, on its horizontal line: a horizontal drag
    // of it just moves the pinch).
    keys.includes('waistRadius') && (() => {
      const grip = _segmentArcs('waistRadius', ctx);
      if (!grip) return null;
      const r0 = grip.arcs[0].rx;
      return {
        key: 'waistRadius', label: 'Waist radius', axis: 'arc', handleKind: 'radius', ...grip,
        anchor: { x: centre.x - r0, y: centre.y },
        ..._patchHandle('waistRadius', (pt, c = {}) => {
          const q = c.side === 1 ? { x: 2 * cx0 - pt.x, y: pt.y } : pt;
          const want = (Math.hypot(q.x - centre.x, q.y - centre.y) - sh) / hw;
          const rw = _furthest(resolvedParams.waistRadius, want, (v) => waistOk(reachFor(v, centre.x), v));
          return { waistRadius: rw, waistReach: reachFor(rw, centre.x) };
        }),
      };
    })(),
  ]));
}

/** A handle whose drag writes a multi-key patch: its `valueFromWorld` is its own key's share. */
function _patchHandle(key, patchFromWorld) {
  return { patchFromWorld, valueFromWorld: (pt, c) => patchFromWorld(pt, c)[key] };
}

/** F27 item 2 arc pull: the value on the way from `from` (feasible: the current
 *  one) to `to` that goes furthest while `ok` holds -- `to` itself when it is
 *  feasible, else the limit found by bisection. A current value that is itself
 *  infeasible (never expected) is returned unchanged: the drag does nothing. */
function _furthest(from, to, ok) {
  if (ok(to)) return to;
  if (!ok(from)) return from;
  let a = from, b = to;
  for (let i = 0; i < 50; i++) { const m = (a + b) / 2; if (ok(m)) a = m; else b = m; }
  return a;
}

/**
 * F27 item 2 arc pull (Fred: "Then the position for waist reach can be the arc
 * center"): the waistReach whose waist arc CENTRE sits at pointer x `px`, the
 * waist radius held -- centre = pinch + Rw and pinch = hw - depth, so
 * depth = hw + Rw - (centre - cx0). `geo` = {cx0, hw, edge, radiusWaist}.
 *
 * A FLAT waist's centre can lie far past the outer edge (Rw up to ~8 in at
 * 7x9); its square is PARKED on the edge. Grabbing it there must not jump the
 * waist, so the mapping is decided by the value at the GRAB (`grabValue`,
 * constant for the whole drag, so the mapping never drifts while the drag
 * re-reads the shape each tick):
 *   - not parked at the grab: the centre follows the pointer exactly;
 *   - parked (the grabbed centre E past the edge): a pointer at or past the
 *     edge keeps the grabbed value; inward, the centre blends linearly from
 *     "E past the pointer" at the edge to "under the pointer" at the centre
 *     line, centre = x + E (x - cx0) / (edge - cx0): continuous and monotone,
 *     so the waist starts moving in without a jump and the square catches up
 *     with the pointer on the way.
 */
export function waistReachFromCentre(geo, px, grabValue) {
  const { cx0, hw, edge, radiusWaist: rw } = geo;
  const excess = cx0 + hw - hw * grabValue + rw - edge; // the grabbed centre's distance past the edge
  let centre = px;
  if (excess > 0 && px > cx0) centre = px >= edge ? edge + excess : px + excess * (px - cx0) / (edge - cx0);
  return 1 + (rw - (centre - cx0)) / hw;
}

/** F27 item 2 arc pull: the arcs a radius param drives -- its segment and that
 *  segment's mirror, as drawn -- or null when that segment is not a solver-owned
 *  arc right now (a user styled it straight/kink/its own curve: the param no
 *  longer drives it). `primIndex` = the right arc's primitive index. */
function _segmentArcs(key, c) {
  const segment = HANDLE_SEGMENT_INDEX[c.preset][key];
  const mirrorSegment = mirrorSegmentIndex(segment, c.sil.segments.length);
  const map = primitiveSegmentMap(c.sil.segments);
  const primIndex = (i) => {
    const k = map.indexOf(i);
    return k >= 0 && map[k + 1] !== i && c.sil.primitives[k].type === 'A' && !c.sil.segments[i].user ? k : -1;
  };
  const kR = primIndex(segment), kL = primIndex(mirrorSegment);
  if (kR < 0 || kL < 0) return null;
  return { segment, mirrorSegment, arcs: [c.sil.primitives[kR], c.sil.primitives[kL]], primIndex: kR };
}

/** F27 item 2 arc pull: one radius param's arc grip (every arc but the
 *  hourglass waist, which is a CAD circle, see computeParamHandles): its arcs,
 *  the dot at the right arc's angular midpoint, and the on-arc drag -- the value
 *  whose arc (the generator's own silhouette with this one param set to it)
 *  passes under the pointer. */
function _arcGrip(key, label, current, c) {
  const grip = _segmentArcs(key, c);
  if (!grip) return null;
  const circleAt = (v) => {
    const p = generateSilhouette(c.region, { ...c.base, params: { ...c.base.params, [key]: v } }, c.sh).primitives[grip.primIndex];
    return p && p.type === 'A' ? { cx: p.cx, cy: p.cy, r: p.rx } : { cx: NaN, cy: NaN, r: NaN };
  };
  const axisX = c.region.x + c.region.w / 2; // the centre line the two sides mirror across
  return {
    key, label, axis: 'arc', handleKind: 'radius', ...grip,
    anchor: _arcPointAt(grip.arcs[0], 0.5),
    // ctx.side: 0 = the right arc (and its dot), 1 = the mirrored left arc, whose
    // pointer is mirrored across the centre line onto the right arc first.
    valueFromWorld: (pt, ctx = {}) => {
      const q = ctx.side === 1 ? { x: 2 * axisX - pt.x, y: pt.y } : pt;
      return c.within(key, radiusThroughPoint(circleAt, c.R[key], current, q));
    },
  };
}

/**
 * F27 item 2 (restored from 5feacb0 for the arc pull): the value (in `range`)
 * whose circle passes through `pt` -- the arc follows the pointer. `circleAt(v)`
 * is the generator's own construction for that value, `{cx, cy, r}`. Solved
 * numerically (sampled sign changes of |pt - centre| - r, then bisection), so
 * it needs no per-arc algebra; of several roots the one on the CURRENT branch
 * nearest `current` wins (a drag never jumps to a far solution). No root inside
 * the range = the pointer is past the true geometric limit: the nearer end of
 * the range (a manual drag reaches the limit, it does not stop short of it).
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
 * F27 item 2 arc pull: which arc grip (a radius handle, axis 'arc') a point is
 * on, either side: `{ handle, side }` (side 0 = the right arc, 1 = its mirror)
 * for the nearest arc within `tolerance` (model units), else null. Callers test
 * their handle marks (squares, dots) FIRST, so a position square in reach wins.
 */
export function hitTestArcGrip(handles, pt, tolerance) {
  let best = null, bestD = Infinity;
  for (const h of handles || []) {
    if (h.axis !== 'arc' || !h.arcs) continue;
    h.arcs.forEach((a, side) => {
      const d = _distToArc(pt, a);
      if (d < bestD) { bestD = d; best = { handle: h, side }; }
    });
  }
  return best && bestD <= tolerance ? best : null;
}

/**
 * T81 item 1 (Fred screenshot: "add visual feedback to these handles on
 * hover" -- the segment a handle controls should highlight too, "so you
 * see WHAT it moves before dragging"): which contour SEGMENT INDEX each
 * handle key's own drag actually reshapes, right side only (a handle's own
 * side, matching `computeParamHandles`' "right side only" convention).
 *
 * F27 item 2 arc pull: for a RADIUS param this is also the arc its grip
 * holds (with its mirror) -- the arc a press grabs and the drag reshapes.
 *
 * Declared once as a plain lookup, not inferred from the handle's anchor
 * point geometrically (the waistReach square sits at the waist arc's own
 * CENTER -- see this file's own header comment -- which is NOT on that
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
  const { index, dist } = nearestSegment(primitives, segments, pt);
  return dist <= tolerance ? index : null;
}

/** The contour segment nearest `pt` and its centreline distance, `{ index, dist }`
 *  (index null for no primitives) -- hitTestSegment's own search, exposed so a
 *  caller can weigh the contour against a nearby rail/tie/node by distance. */
export function nearestSegment(primitives, segments, pt) {
  const map = primitiveSegmentMap(segments);
  let index = null, dist = Infinity;
  primitives.forEach((prim, i) => {
    const d = prim.type === 'L' ? _distToLine(pt, prim.p0, prim.p1) : _distToArc(pt, prim);
    if (d < dist) { dist = d; index = map[i]; }
  });
  return { index, dist };
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

/** The contour segments a handle's drag reshapes, for its hover highlight
 *  (T81 item 1; Fred: "How about highlighting the geometry it control"): its
 *  HANDLE_SEGMENT_INDEX segment AND that segment's mirror (the param drives
 *  both sides), deduped for a self-mirrored one. `n` = segment count. */
export function controlledSegments(preset, key, n) {
  const i = HANDLE_SEGMENT_INDEX[preset]?.[key];
  if (i == null || !(n > 0)) return [];
  const m = mirrorSegmentIndex(i, n);
  return m === i ? [i] : [i, m];
}

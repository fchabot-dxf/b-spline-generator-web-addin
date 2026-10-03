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
import {
  feasibleParamRanges, hourglassConstruction, bottleConstruction, generateSilhouette, SHAPE_PARAM_KEYS,
  TOP_DIP_SEGMENT_COUNT, topDipMirrorIndex, tabTopConstruction, iShapeConstruction, taperAngleForTopCornerX,
  diamondTopHourglassConstruction, diamondTopHourglassPinchConstruction, archedFunnelConstruction,
} from './editor-shape-lattice-generator.js';
import { arcPointAtFraction, distToSegment, distToArc } from './editor-primitives.js'; // audit tidy-up: the one copy

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
  // T4 OFFSET HOURGLASS: a left pinch of its own (only a frame template sets it): the left arcs are no longer the
  // mirror of the right ones, so a grip grabbed on the LEFT arc solves on that arc itself.
  const asym = preset === 'hourglass' && (resolvedParams.waistCenterYLeft != null || resolvedParams.waistReachLeft != null);
  const ctx = { preset, region, base, sh, sil, R, within, asym };
  const arc = (key, label) => (keys.includes(key) ? _arcGrip(key, label, resolvedParams[key], ctx) : null);

  if (preset === 'tabTop') {
    // T6 TAB TOP (a frame-only preset): two POSITION squares. Tab width: on the right tab side, halfway up it; a
    // horizontal drag moves both tab sides (mirrored) in or out. Tab height: on the right shoulder, halfway
    // along it; a vertical drag moves both shoulders (the tab top stays on the top edge). Right side only.
    const g = tabTopConstruction(region, resolvedParams);
    const top = cy0 - hh;
    return withRange(pick([
      {
        key: 'tabWidth', label: 'Tab width', axis: 'x', handleKind: 'position',
        anchor: { x: cx0 + g.halfWidth, y: top + g.height / 2 },
        valueFromWorld: (pt) => within('tabWidth', (pt.x - cx0) / hw),
      },
      {
        key: 'tabHeight', label: 'Tab height', axis: 'y', handleKind: 'position',
        anchor: { x: cx0 + (g.halfWidth + hw) / 2, y: top + g.height },
        valueFromWorld: (pt) => within('tabHeight', (pt.y - top) / hh),
      },
    ]));
  }

  if (preset === 'iShape') {
    // T9 I SHAPE (a frame-only preset, Template 6's tab doubled top AND bottom): two POSITION squares, right side
    // only. Stem width: on the stem's right side, halfway up its upper half (the top-right shoulder's own
    // height); a horizontal drag moves both stem sides (mirrored left/right). Flange height: on the top-right
    // shoulder, halfway along it; a vertical drag moves all 4 shoulders together (the top/bottom edges stay on
    // the board's own top/bottom lines, the 4-fold symmetry p02_05_symmetry builds in).
    const g = iShapeConstruction(region, resolvedParams);
    const top = cy0 - hh;
    return withRange(pick([
      {
        key: 'stemWidth', label: 'Stem width', axis: 'x', handleKind: 'position',
        anchor: { x: cx0 + g.halfWidth, y: cy0 + g.topShoulderY / 2 },
        valueFromWorld: (pt) => within('stemWidth', (pt.x - cx0) / hw),
      },
      {
        key: 'flangeHeight', label: 'Flange height', axis: 'y', handleKind: 'position',
        anchor: { x: cx0 + (g.halfWidth + hw) / 2, y: cy0 + g.topShoulderY },
        valueFromWorld: (pt) => within('flangeHeight', (pt.y - top) / hh),
      },
    ]));
  }

  if (preset === 'diamondTopHourglass') {
    // T7 DIAMOND-TOP HOURGLASS (a frame-only preset): three POSITION squares, right side only (the generator
    // mirrors for free, this module's own header comment). FIRST CUT anchor placement, not yet visually verified
    // (see LIVE_CHECK.md): gableNeckWidth sits AT the neck point itself (a horizontal drag moves it, mirrored,
    // in/out); neckHeight sits halfway between the eave and the neck (off the gableNeckWidth square so the two
    // don't sit on top of each other) and drags vertically; bodyFlareHeight sits AT the body point (always
    // x = hw, so a vertical drag is its only real motion).
    const g = diamondTopHourglassConstruction(region, resolvedParams);
    return withRange(pick([
      {
        key: 'gableNeckWidth', label: 'Neck width', axis: 'x', handleKind: 'position',
        anchor: { x: cx0 + g.N.x, y: cy0 + g.N.y },
        valueFromWorld: (pt) => within('gableNeckWidth', (pt.x - cx0) / hw),
      },
      {
        key: 'neckHeight', label: 'Neck height', axis: 'y', handleKind: 'position',
        anchor: { x: cx0 + (g.E.x + g.N.x) / 2, y: cy0 + g.N.y },
        valueFromWorld: (pt) => within('neckHeight', (pt.y - (cy0 + g.E.y)) / g.rest),
      },
      {
        key: 'bodyFlareHeight', label: 'Body flare height', axis: 'y', handleKind: 'position',
        anchor: { x: cx0 + g.B.x, y: cy0 + g.B.y },
        valueFromWorld: (pt) => within('bodyFlareHeight', (pt.y - (cy0 + g.E.y)) / g.rest),
      },
    ]));
  }

  if (preset === 'archedFunnel' || preset === 'tulip') {
    // T84 item 3 (both frame-only presets, the same construction -- archedFunnelConstruction):
    // topWidth/archRiseFrac share the chord-end point topR (its OWN x moves with topWidth, its
    // OWN y moves with archRiseFrac -- same "handle sits where the dragged value actually lives"
    // logic as T10's own archRise); waistWidthFrac/waistHeightFrac share waistR the same way.
    // bulgeFrac/upperCurveFrac anchor at their own arc's VIA point instead (T1's own waistReach
    // precedent for "neither chord end moves with this param, only the arc's own shape between
    // them does" -- but VIA, not the arc's own CENTRE: centre is NOT a monotonic function of the
    // sagitta, archedFunnelConstruction's own sagittaGeom doc comment), inverting a drag via a
    // single dot product against the chord's own fixed normal/midpoint. Right side only (the
    // generator mirrors for free, this module's own header comment); nudged off their own shared
    // point's twin so the two squares don't sit exactly on top of each other (T7's own convention).
    const g = archedFunnelConstruction(region, resolvedParams);
    // The dot product recovers the sagitta in INCHES ((via-mid).n = sag exactly, by construction);
    // bulgeFrac/upperCurveFrac are each a FRACTION of hw, same basis as every other handle here.
    const sagValue = (key, geom) => (pt) => within(key, ((pt.x - geom.mx) * geom.nx + (pt.y - geom.my) * geom.ny) / hw);
    return withRange(pick([
      {
        key: 'topWidth', label: 'Top width', axis: 'x', handleKind: 'position',
        anchor: { x: cx0 + g.topR.x, y: cy0 + g.topR.y },
        valueFromWorld: (pt) => within('topWidth', (pt.x - cx0) / hw),
      },
      {
        key: 'archRiseFrac', label: 'Arch rise', axis: 'y', handleKind: 'position',
        anchor: { x: cx0 + g.topR.x * 0.6, y: cy0 + g.topR.y },
        valueFromWorld: (pt) => within('archRiseFrac', (pt.y - (cy0 - hh)) / hw),
      },
      {
        key: 'waistWidthFrac', label: 'Waist width', axis: 'x', handleKind: 'position',
        anchor: { x: cx0 + g.waistR.x, y: cy0 + g.waistR.y },
        valueFromWorld: (pt) => within('waistWidthFrac', (pt.x - cx0) / hw),
      },
      {
        key: 'waistHeightFrac', label: 'Waist height', axis: 'y', handleKind: 'position',
        anchor: { x: cx0 + g.waistR.x * 0.6, y: cy0 + g.waistR.y },
        valueFromWorld: (pt) => within('waistHeightFrac', (pt.y - (cy0 - hh)) / (2 * hh)),
      },
      {
        // 'x' (not 'arc', F27 item 2's OWN arc-pull mechanism -- it carries segment/mirrorSegment/
        // arcs fields this handle doesn't set, a different dedicated path, editor-interaction.js's
        // own axis==='arc' filter): a plain position square, just reading a PROJECTED coordinate
        // (sagValue's own dot product against the chord's fixed normal) instead of a raw x/y.
        key: 'bulgeFrac', label: 'Lower bulge', axis: 'x', handleKind: 'position',
        anchor: { x: cx0 + g.lowerGeom.via.x, y: cy0 + g.lowerGeom.via.y },
        valueFromWorld: sagValue('bulgeFrac', { mx: cx0 + g.lowerGeom.mx, my: cy0 + g.lowerGeom.my, nx: g.lowerGeom.nx, ny: g.lowerGeom.ny }),
      },
      keys.includes('upperCurveFrac') && {
        key: 'upperCurveFrac', label: 'Upper side curve', axis: 'x', handleKind: 'position',
        anchor: { x: cx0 + g.upperGeom.via.x, y: cy0 + g.upperGeom.via.y },
        valueFromWorld: sagValue('upperCurveFrac', { mx: cx0 + g.upperGeom.mx, my: cy0 + g.upperGeom.my, nx: g.upperGeom.nx, ny: g.upperGeom.ny }),
      },
    ]));
  }

  if (preset === 'dippedLeftWave') {
    // T8 DIPPED TOP + LEFT-ONLY WAVE (a frame-only preset): the SAME construction `_solveDippedLeftWave` itself
    // builds from these params (editor-shape-lattice-generator.js), read here instead of re-derived, so the
    // handles always sit exactly on the drawn geometry. The wave gets the same two position squares T4's own
    // left pinch does (`waveReach`'s anchor mirrored via `waistReachFromCentre`, `edge` fixed at the RIGHT edge:
    // that helper's own convention, since the caller mirrors the pointer INTO right-side terms); the dip
    // (Template 5's own construction, extended for `topDipPosition`) gets three: width, position and depth, all
    // offset by the dip's own shifted centre (`dipCx`) rather than the board's.
    const g = hourglassConstruction(region, {
      waistReach: resolvedParams.waveReach, waistCenterY: resolvedParams.waveHeight,
      cornerRadius: resolvedParams.waveCornerRadius, waistRadius: resolvedParams.waveRadius,
      waistCenterYLeft: resolvedParams.waveHeight, waistReachLeft: resolvedParams.waveReach,
      topDipWidth: resolvedParams.topDipWidth, topDipDepth: resolvedParams.topDipDepth, topDipPosition: resolvedParams.topDipPosition,
    });
    const gl = g.left, dip = g.topDip;
    const centreL = { x: cx0 - gl.waistCx, y: cy0 + gl.waistCenterY };
    const dipCx = cx0 + (dip ? dip.position : 0);
    return withRange(pick([
      {
        key: 'waveHeight', label: 'Left wave height', axis: 'y', handleKind: 'position',
        anchor: { x: cx0 - (hw - gl.depth) / 2, y: centreL.y },
        valueFromWorld: (pt) => within('waveHeight', (pt.y - cy0) / hh),
      },
      {
        key: 'waveReach', label: 'Left wave reach', axis: 'x', handleKind: 'position',
        anchor: { x: Math.max(centreL.x, cx0 - hw), y: centreL.y },
        valueFromWorld: (pt, c = {}) => {
          const want = waistReachFromCentre({ cx0, hw, edge: cx0 + hw, radiusWaist: gl.radiusWaist }, 2 * cx0 - pt.x,
            c.grab ? c.grab.value : resolvedParams.waveReach);
          return within('waveReach', want);
        },
      },
      {
        key: 'topDipWidth', label: 'Top dip width', axis: 'x', handleKind: 'position',
        anchor: { x: dipCx + (dip ? dip.halfWidth : hw * (resolvedParams.topDipWidth ?? 0)), y: cy0 - hh },
        valueFromWorld: (pt) => within('topDipWidth', (pt.x - dipCx) / hw),
      },
      {
        key: 'topDipPosition', label: 'Top dip position', axis: 'x', handleKind: 'position',
        anchor: { x: dipCx, y: cy0 - hh },
        valueFromWorld: (pt) => within('topDipPosition', (pt.x - cx0) / hw),
      },
      {
        key: 'topDipDepth', label: 'Top dip depth', axis: 'y', handleKind: 'position',
        anchor: { x: dipCx, y: cy0 - hh + (dip ? dip.depth : 0) },
        valueFromWorld: (pt) => within('topDipDepth', (pt.y - (cy0 - hh)) / hh),
      },
    ]));
  }

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
      keys.includes('taperAngle') && (() => {
        // F30 item 3 (Template 13): the same "Taper angle" handle as the hourglass's own, on the neck's top
        // corner instead of the shoulder's -- concave (convexSign -1), see that entry's own doc comment.
        const b0 = bottleConstruction(region, { ...resolvedParams, taperAngle: 0 });
        const circle = { cx: b0.skelX, cy: b0.neckCenterY, r: b0.radiusNeck };
        const pinch = { cx: b0.bodyCx, cy: b0.hipCenterY, r: b0.radiusBody };
        return {
          key: 'taperAngle', label: 'Taper angle', axis: 'x', handleKind: 'position',
          anchor: { x: cx0 + b.neckTopX, y: cy0 + (-hh + b.neckCenterY) / 2 },
          valueFromWorld: (pt) => within('taperAngle', taperAngleForTopCornerX(circle, pinch, -1, pt.x - cx0, hw, hh)),
        };
      })(),
    ]));
  }

  if (preset === 'diamondTopHourglassPinch') {
    // T11 HOURGLASS ROOF (a frame-only preset): Template 1's own 5 hourglass-side handles -- the SAME arc-pull /
    // waist-as-CAD-circle mechanics the hourglass (default) branch below gives Template 1 -- computed from
    // `diamondTopHourglassPinchConstruction` instead of `hourglassConstruction` directly: this preset's side sits
    // in a VIRTUAL sub-region (the room below the roof's own eave, shorter than the full half-height), not the
    // full region `hourglassConstruction` assumes (see that wrapper's own doc comment). No topInset/left-pinch/
    // dip/arch handles here: T11 has none of those keys (`pick()` would drop them anyway, but building their
    // handle objects would reference fields this construction's own return never sets).
    const g = diamondTopHourglassPinchConstruction(region, resolvedParams);
    const edge = cx0 + hw;
    const centre = { x: cx0 + g.waistCx, y: cy0 + g.waistCenterY };
    const shift = g.a / 2, hhR = hh - shift; // the side's own virtual half-height (below the roof's eave)
    const waistOk = (reach, rw) => reach >= R.waistReach.min && reach <= R.waistReach.max
      && (() => { const r = rangesFor({ ...resolvedParams, waistReach: reach }).waistRadius; return rw >= r.min && rw <= r.max; })();
    const reachFor = (rwFrac, centreX) => 1 + rwFrac - (centreX - cx0) / hw;
    return withRange(pick([
      {
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
      arc('cornerRadiusTop', 'Shoulder'),
      arc('cornerRadiusBottom', 'Hip'),
      {
        key: 'waistCenterY', label: 'Waist position', axis: 'y', handleKind: 'position',
        anchor: { x: cx0, y: centre.y },
        // The side's own VIRTUAL half-height (hhR), not the full region's hh: `diamondTopHourglassPinchConstruction`'s
        // own `waistCenterY` field is `hhR * frac + shift` (the roof's own eave eats into the side's own room).
        valueFromWorld: (pt) => within('waistCenterY', (pt.y - cy0 - shift) / hhR),
      },
      keys.includes('waistRadius') && (() => {
        const grip = _segmentArcs('waistRadius', ctx);
        if (!grip) return null;
        const r0 = grip.arcs[0].rx;
        return {
          key: 'waistRadius', label: 'Waist radius', axis: 'arc', handleKind: 'radius', ...grip,
          anchor: { x: centre.x - r0, y: centre.y },
          ..._patchHandle('waistRadius', (pt, c = {}) => {
            const want = (Math.hypot(pt.x - centre.x, pt.y - centre.y) - sh) / hw;
            const rw = _furthest(resolvedParams.waistRadius, want, (v) => waistOk(reachFor(v, centre.x), v));
            return { waistRadius: rw, waistReach: reachFor(rw, centre.x) };
          }),
        };
      })(),
    ]));
  }

  // hourglass (default).
  const g = hourglassConstruction(region, resolvedParams); // the generator's own construction, not a copy
  const edge = cx0 + hw; // the region's outer edge (the frame's outer edge in the Frame tab)
  const centre = { x: cx0 + g.waistCx, y: cy0 + g.waistCenterY }; // the waist arc's own centre
  // T4 OFFSET HOURGLASS: the left pinch's own construction and centre (world); the right one's when not set.
  const gl = g.left || g;
  const centreL = { x: cx0 - gl.waistCx, y: cy0 + gl.waistCenterY };
  // F27 item 2 arc pull, the WAIST as a CAD circle (Fred): a centre point (the
  // waistReach square) and a point on the rim (the waistRadius arc). Both drags
  // write BOTH params: waistReach = (hw + Rw - (centre - cx0)) / hw ties the
  // centre to the pinch depth. `waistOk` is the ONE feasibility test for such a
  // pair (the waist radius range depends on the depth), so either drag stops at
  // whichever limit binds first and the centre never drifts.
  const waistOk = (reach, rw) => reach >= R.waistReach.min && reach <= R.waistReach.max
    && (() => { const r = rangesFor({ ...resolvedParams, waistReach: reach }).waistRadius; return rw >= r.min && rw <= r.max; })();
  const reachFor = (rwFrac, centreX) => 1 + rwFrac - (centreX - cx0) / hw;
  // T4: a waist radius drag keeps BOTH centres put, so it also writes the left depth; `leftOk` = that left
  // pinch (height and depth, held) still inside its own ranges for the new radius and right depth.
  const reachForLeft = (rwFrac) => 1 + rwFrac - (cx0 - centreL.x) / hw;
  const leftOk = (reach, rw) => {
    if (!asym) return true;
    const r = rangesFor({ ...resolvedParams, waistReach: reach, waistRadius: rw, waistReachLeft: reachForLeft(rw) });
    const y = resolvedParams.waistCenterYLeft, dl = reachForLeft(rw);
    return y >= r.waistCenterYLeft.min && y <= r.waistCenterYLeft.max && dl >= r.waistReachLeft.min && dl <= r.waistReachLeft.max;
  };
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
          // T4: the left arc (side 1) is its own circle about the left centre; otherwise mirrored onto the right.
          const q = c.side === 1 && !asym ? { x: 2 * cx0 - pt.x, y: pt.y } : pt;
          const about = c.side === 1 && asym ? centreL : centre;
          const want = (Math.hypot(q.x - about.x, q.y - about.y) - sh) / hw;
          const rw = _furthest(resolvedParams.waistRadius, want, (v) => waistOk(reachFor(v, centre.x), v) && leftOk(reachFor(v, centre.x), v));
          return { waistRadius: rw, waistReach: reachFor(rw, centre.x), ...(asym ? { waistReachLeft: reachForLeft(rw) } : {}) };
        }),
      };
    })(),
    {
      // T3 TAPERED HOURGLASS (Fred: "the top narrower than the base"): the top width, a POSITION square midway
      // down the right top horn; a horizontal drag moves both top horns (mirrored) in or out. Value = how far
      // in from the outer edge, (edge - x) / hw, clamped to [0, waist) by the generator's own range. Only a
      // template whose binding table declares it (Template 3) asks for it; the Shape Lattice never does.
      key: 'topInset', label: 'Top width', axis: 'x', handleKind: 'position',
      anchor: { x: edge - g.topInset, y: cy0 + (-hh + g.shoulderY) / 2 },
      valueFromWorld: (pt) => within('topInset', (edge - pt.x) / hw),
    },
    {
      // T4 OFFSET HOURGLASS (the Hourglass with each waist pinch at its own height): the LEFT pinch's height, a
      // POSITION square midway between the centre line and the left pinch, at its centre height (clear of the
      // right pinch's square, which sits ON the centre line). The right pinch keeps `waistCenterY`'s square.
      key: 'waistCenterYLeft', label: 'Left waist position', axis: 'y', handleKind: 'position',
      anchor: { x: cx0 - (hw - gl.depth) / 2, y: centreL.y },
      valueFromWorld: (pt) => within('waistCenterYLeft', (pt.y - cy0) / hh),
    },
    {
      // T4: the LEFT pinch's depth, the waistReach square mirrored: at the left waist arc's centre (parked on the
      // left edge when a flat waist puts it past it), sliding the left waist sideways, its radius (shared) held.
      key: 'waistReachLeft', label: 'Left waist reach', axis: 'x', handleKind: 'position',
      anchor: { x: Math.max(centreL.x, cx0 - hw), y: centreL.y },
      valueFromWorld: (pt, c = {}) => {
        const want = waistReachFromCentre({ cx0, hw, edge, radiusWaist: gl.radiusWaist }, 2 * cx0 - pt.x,
          c.grab ? c.grab.value : resolvedParams.waistReachLeft);
        return within('waistReachLeft', want);
      },
    },
    {
      // T5 HOURGLASS DIPPED TOP: the top dip's depth, a POSITION square at the dip's lowest point (on the centre
      // line); a vertical drag deepens or flattens the dip, its width held. Value = depth below the top / hh.
      key: 'topDipDepth', label: 'Top dip depth', axis: 'y', handleKind: 'position',
      anchor: { x: cx0, y: cy0 - hh + (g.topDip ? g.topDip.depth : 0) },
      valueFromWorld: (pt) => within('topDipDepth', (pt.y - (cy0 - hh)) / hh),
    },
    {
      // T5: the top dip's width, a POSITION square where the right straight stub ends (the dip starts); a
      // horizontal drag moves both stub ends (mirrored) in or out, the depth held. Value = (x - centre) / hw.
      key: 'topDipWidth', label: 'Top dip width', axis: 'x', handleKind: 'position',
      anchor: { x: cx0 + (g.topDip ? g.topDip.halfWidth : hw * (resolvedParams.topDipWidth ?? 0)), y: cy0 - hh },
      valueFromWorld: (pt) => within('topDipWidth', (pt.x - cx0) / hw),
    },
    {
      // T10 ARCHED HOURGLASS: the arch's rise, a POSITION square where the right horn meets it (the chord end,
      // `rise` below the top edge -- the apex itself never moves, it always touches the top edge, so a handle
      // anchored there couldn't show a drag at all). A vertical drag deepens or flattens the dome, eating into
      // (or giving back) the horn's own length; the chord's own half width is fixed (the horn's own x).
      key: 'archRise', label: 'Arch rise', axis: 'y', handleKind: 'position',
      anchor: { x: cx0 + g.topX, y: cy0 - hh + (g.arch ? g.arch.rise : 0) },
      valueFromWorld: (pt) => within('archRise', (pt.y - (cy0 - hh)) / hh),
    },
    keys.includes('taperAngle') && (() => {
      // F30 item 3 (Template 12/13, advisor-confirmed design): a POSITION square at the top corner -- where the
      // (possibly slanted) horn meets the flat top edge -- a horizontal drag narrows (in) or widens (out) it,
      // taperAngleForTopCornerX's own bisection inverting the SAME `_taperedCorner` construction the generator
      // itself resolves with (its only closed form; see that export's own doc comment). The UNTAPERED shoulder
      // circle (taperAngle: 0) is what the inverse needs -- the CURRENT one may already be inset (Branch B).
      const g0 = hourglassConstruction(region, { ...resolvedParams, taperAngle: 0 });
      const circle = { cx: g0.shoulderCx, cy: g0.shoulderY, r: g0.cornerRadiusTop };
      const pinch = { cx: g0.waistCx, cy: g0.waistCenterY, r: g0.radiusWaist };
      // H23 item 59 (Arched + taper): same hh -> hh - archRise target-line substitution as
      // hourglassConstruction's own topTaper / _hourglassRange's own taperAngle branch -- g0.arch is 0/absent
      // for every template but T10, so this is a no-op everywhere else.
      const hhTarget = hh - (g0.arch ? g0.arch.rise : 0);
      return {
        key: 'taperAngle', label: 'Taper angle', axis: 'x', handleKind: 'position',
        anchor: { x: cx0 + g.topX, y: cy0 + (-hh + g.shoulderY) / 2 },
        valueFromWorld: (pt) => within('taperAngle', taperAngleForTopCornerX(circle, pinch, +1, pt.x - cx0, hw, hhTarget)),
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
  // T5 HOURGLASS DIPPED TOP: a dipped outline carries its own mirror table (16 segments, the top is not one edge)
  const mirrorSegment = c.sil.mirror ? c.sil.mirror[segment] : mirrorSegmentIndex(segment, c.sil.segments.length);
  const map = primitiveSegmentMap(c.sil.segments);
  const primIndex = (i) => {
    const k = map.indexOf(i);
    return k >= 0 && map[k + 1] !== i && c.sil.primitives[k].type === 'A' && !c.sil.segments[i].user ? k : -1;
  };
  const kR = primIndex(segment), kL = primIndex(mirrorSegment);
  if (kR < 0 || kL < 0) return null;
  return { segment, mirrorSegment, arcs: [c.sil.primitives[kR], c.sil.primitives[kL]], primIndex: kR, primIndexL: kL };
}

/** F27 item 2 arc pull: one radius param's arc grip (every arc but the
 *  hourglass waist, which is a CAD circle, see computeParamHandles): its arcs,
 *  the dot at the right arc's angular midpoint, and the on-arc drag -- the value
 *  whose arc (the generator's own silhouette with this one param set to it)
 *  passes under the pointer. */
function _arcGrip(key, label, current, c) {
  const grip = _segmentArcs(key, c);
  if (!grip) return null;
  const circleAt = (v, k = grip.primIndex) => {
    const p = generateSilhouette(c.region, { ...c.base, params: { ...c.base.params, [key]: v } }, c.sh).primitives[k];
    return p && p.type === 'A' ? { cx: p.cx, cy: p.cy, r: p.rx } : { cx: NaN, cy: NaN, r: NaN };
  };
  const axisX = c.region.x + c.region.w / 2; // the centre line the two sides mirror across
  return {
    key, label, axis: 'arc', handleKind: 'radius', ...grip,
    anchor: arcPointAtFraction(grip.arcs[0], 0.5),
    // ctx.side: 0 = the right arc (and its dot), 1 = the mirrored left arc, whose
    // pointer is mirrored across the centre line onto the right arc first.
    valueFromWorld: (pt, ctx = {}) => {
      // T4 OFFSET HOURGLASS (`c.asym`): the left arc is not the right one's mirror; solve on the left arc itself.
      if (ctx.side === 1 && c.asym) return c.within(key, radiusThroughPoint((v) => circleAt(v, grip.primIndexL), c.R[key], current, pt));
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
      const d = distToArc(pt, a);
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
 *   (T3 `topInset`, the top width, maps to 0: the right top horn it slides. T4's left pinch keys map to 8,
 *   the LEFT waist, and highlight only it: LEFT_ONLY_KEYS.)
 *   T5 dipped top (16 segments: 0..10 as above, 11 stub(L), 12 top shoulder(L), 13 DIP, 14 TOP SHOULDER,
 *   15 stub): `topDipDepth` maps to 13 (the dip), `topDipWidth` to 14 (the right top shoulder, mirror 12).
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
  hourglass: { cornerRadiusTop: 1, waistReach: 2, cornerRadiusBottom: 3, waistCenterY: 2, waistRadius: 2, topInset: 0,
    waistCenterYLeft: 8, waistReachLeft: 8, topDipDepth: 13, topDipWidth: 14,
    // T10 ARCHED HOURGLASS: no splice (unlike T5's own dip), segment 11 is still the top piece, just an arc
    // instead of a line -- its own mirror is itself (mirrorSegmentIndex(11, 12) === 11, T1's own flat top too).
    archRise: 11,
    // F30 item 3 (Template 12): the horn itself (0), same convention as topInset's own entry above -- the piece
    // whose own direction the drag actually changes (the top edge, 11, also narrows/widens but isn't re-shaped).
    taperAngle: 0 },
  bottle: { neckWidth: 1, skeletonX: 1, neckLength: 1, bodyRadius: 2,
    // F30 item 3 (Template 13): same convention as the hourglass's own entry above.
    taperAngle: 0 },
  // T6 TAB TOP (8 pieces: 0 tab side R, 1 shoulder R, 2 side R, 3 base, 4 side L, 5 shoulder L, 6 tab side L,
  // 7 tab top): the width moves the tab sides, the height the shoulders (each with its mirror, mirrorSegmentIndex).
  tabTop: { tabWidth: 0, tabHeight: 1 },
  // T8 DIPPED TOP + LEFT-ONLY WAVE (12 pieces, editor-shape-lattice-generator.js's own `_solveDippedLeftWave` doc
  // comment: 0 side_R, 1 bottom, 2 horn(BL), 3 hip, 4 wave, 5 shoulder, 6 horn(TL), 7 stub(L), 8 top shoulder(L),
  // 9 dip, 10 top shoulder(R), 11 stub(R)): the wave's own height/reach map to its one arc (4, DIPPED_LEFT_WAVE_
  // SEGMENT_PAIRS below: no mirror -- nothing on the plain right side to pair with); the dip's depth/position map
  // to the dip arc alone (9); the dip's width moves BOTH top shoulders (8 and 10, DIPPED_LEFT_WAVE_SEGMENT_PAIRS).
  dippedLeftWave: { waveHeight: 4, waveReach: 4, topDipDepth: 9, topDipPosition: 9, topDipWidth: 8 },
  // T9 I SHAPE (12 pieces, editor-shape-lattice-generator.js's own `_solveIShape` doc comment: 0 top, 1 flange
  // side TR, 2 shoulder TR, 3 stem side R, 4 shoulder BR, 5 flange side BR, 6 bottom, 7 flange side BL,
  // 8 shoulder BL, 9 stem side L, 10 shoulder TL, 11 flange side TL): the stem width maps to its own side (3,
  // I_SHAPE_SEGMENT_PAIRS below: the plain L/R mirror, 9); the flange height maps to one shoulder (2), but moves
  // all 4 (I_SHAPE_SEGMENT_PAIRS: the 4-fold left/right AND top/bottom symmetry, not a plain mirror).
  iShape: { stemWidth: 3, flangeHeight: 2 },
  // T7 DIAMOND-TOP HOURGLASS (9 pieces, editor-shape-lattice-generator.js's own `_solveDiamondTopHourglass` doc
  // comment: 0 roof_R, 1 arc_neck_R, 2 arc_body_R, 3 side_R, 4 bottom_edge, 5 side_L, 6 arc_body_L, 7 arc_neck_L,
  // 8 roof_L): gableNeckWidth/neckHeight both map to the neck arc (1, mirrors via the solver's own declared
  // `mirror` table to 7); bodyFlareHeight maps to the body arc (2, mirrors to 6).
  diamondTopHourglass: { gableNeckWidth: 1, neckHeight: 1, bodyFlareHeight: 2 },
  // T11 HOURGLASS ROOF (13 pieces, editor-shape-lattice-generator.js's own `_solveDiamondTopHourglassPinch` doc
  // comment: 0 roof_R, 1 eave_straight_R, 2 arc_shoulder_R, 3 arc_waist_R, 4 arc_hip_R, 5 side_straight_R,
  // 6 bottom_edge, 7 side_straight_L, 8 arc_hip_L, 9 arc_waist_L, 10 arc_shoulder_L, 11 eave_straight_L,
  // 12 roof_L): the same Template 1 convention (cornerRadiusTop/waistReach/cornerRadiusBottom/waistCenterY/
  // waistRadius map to the shoulder/waist/hip arcs), each index shifted by the roof's own 2 extra pieces (roof_R,
  // eave_straight_R) ahead of them.
  diamondTopHourglassPinch: { cornerRadiusTop: 2, waistReach: 3, cornerRadiusBottom: 4, waistCenterY: 3, waistRadius: 3 },
  // T84 item 3, Templates 16/17 (6 pieces, editor-shape-lattice-generator.js's own `_solveArchedTimer`
  // doc comment: 0 upper_R, 1 lower_R, 2 base, 3 lower_L, 4 upper_L, 5 arch): topWidth/archRiseFrac
  // both move the arch's own chord (5); waistWidthFrac/waistHeightFrac/bulgeFrac all touch waistR,
  // shared between upper_R and lower_R -- grouped with the lower bulge (1), the arc each of them
  // most directly shapes; upperCurveFrac (tulip only) maps to its own arc, upper_R (0). The generic
  // mirror formula (mirrorSegmentIndex) gives the CORRECT pairing here (confirmed, not assumed:
  // mirrorSegmentIndex(i,6) for i=0..5 is exactly [4,3,2,1,0,5], matching the solver's own declared
  // `mirror` table bit for bit) -- unlike T7/T11 above, no declared SEGMENT_PAIRS table is needed.
  archedFunnel: { topWidth: 5, archRiseFrac: 5, waistWidthFrac: 1, waistHeightFrac: 1, bulgeFrac: 1 },
  tulip: { topWidth: 5, archRiseFrac: 5, waistWidthFrac: 1, waistHeightFrac: 1, bulgeFrac: 1, upperCurveFrac: 0 },
};

/** T8 DIPPED TOP + LEFT-ONLY WAVE: `controlledSegments`' own declared pairing (the shape has no bilateral
 *  symmetry at all, so neither `mirrorSegmentIndex` nor `topDipMirrorIndex` apply -- every key not listed here
 *  controls its own HANDLE_SEGMENT_INDEX segment alone, exactly like a LEFT_ONLY_KEYS entry; `topDipWidth` is the
 *  one exception (it moves both top shoulder arcs, declared explicitly rather than derived from a mirror formula
 *  that would be wrong for this outline). */
const DIPPED_LEFT_WAVE_SEGMENT_PAIRS = { topDipWidth: [8, 10] };

/** T9 I SHAPE: `controlledSegments`' own declared pairing (4-fold symmetry -- left/right AND top/bottom -- not the
 *  plain single-axis mirror `mirrorSegmentIndex` assumes): the stem sides are a plain L/R pair; the flange height
 *  moves all 4 shoulders together (p02_05_symmetry's own 4-fold tie). */
const I_SHAPE_SEGMENT_PAIRS = { stemWidth: [3, 9], flangeHeight: [2, 4, 8, 10] };

/** T7 DIAMOND-TOP HOURGLASS: `controlledSegments`' own declared pairing -- the generic `mirrorSegmentIndex(i,9)`
 *  assumes a different starting point/direction than this outline's own clockwise-from-the-peak convention
 *  (editor-shape-lattice-generator.js's own `_solveDiamondTopHourglass` doc comment: 0 roof_R .. 8 roof_L) and
 *  gives the WRONG pairing (MEASURED: mirrorSegmentIndex(1,9) = 6, the body arc, not 7, the actual mirrored neck
 *  arc) -- the solver's own declared `mirror` table (`8 - i`) is the real one, restated here since
 *  `controlledSegments` only sees a bare segment index, not the solved silhouette's own `mirror` array.
 *  gableNeckWidth/neckHeight both move the neck arc (1) and its mirror (7); bodyFlareHeight moves the body arc
 *  (2) and its mirror (6). */
const DIAMOND_TOP_HOURGLASS_SEGMENT_PAIRS = { gableNeckWidth: [1, 7], neckHeight: [1, 7], bodyFlareHeight: [2, 6] };

/** T11 HOURGLASS ROOF: `controlledSegments`' own declared pairing -- the generic `mirrorSegmentIndex(i,13)`
 *  assumes an EVEN segment count with two self-paired points (`i===n/2-1` and `i===n-1`); T11's outline has an
 *  ODD count (13) with only ONE self-paired piece (bottom_edge, 6) and its own first/last pieces (roof_R 0,
 *  roof_L 12) mirroring EACH OTHER, not self-pairing -- the generic formula gets both wrong (MEASURED:
 *  mirrorSegmentIndex(6,13) = 5, not 6; mirrorSegmentIndex(12,13) = 12, not 0). The solver's own declared
 *  `mirror` table (`12 - i`, `_solveDiamondTopHourglassPinch`) is the real one, restated here since
 *  `controlledSegments` only sees a bare segment index, not the solved silhouette's own `mirror` array -- same
 *  reason Template 7's own pairing table exists, just a different (odd-count) topology. */
const DIAMOND_TOP_HOURGLASS_PINCH_SEGMENT_PAIRS = {
  cornerRadiusTop: [2, 10], waistReach: [3, 9], cornerRadiusBottom: [4, 8], waistCenterY: [3, 9], waistRadius: [3, 9],
};

// Arc point / segment and arc distance: editor-primitives.js (audit tidy-up -- the one copy of each).

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
    const d = prim.type === 'L' ? distToSegment(pt, prim.p0, prim.p1) : distToArc(pt, prim);
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
const LEFT_ONLY_KEYS = new Set(['waistCenterYLeft', 'waistReachLeft']); // T4: they move the left pinch alone
export function controlledSegments(preset, key, n) {
  const i = HANDLE_SEGMENT_INDEX[preset]?.[key];
  if (i == null || !(n > 0)) return [];
  if (LEFT_ONLY_KEYS.has(key)) return [i];
  // T8 DIPPED TOP + LEFT-ONLY WAVE: no bilateral symmetry, so a declared pairing table stands in for the mirror
  // formulas below (see DIPPED_LEFT_WAVE_SEGMENT_PAIRS's own doc comment).
  if (preset === 'dippedLeftWave') return DIPPED_LEFT_WAVE_SEGMENT_PAIRS[key] || [i];
  // T9 I SHAPE: a declared pairing too (4-fold symmetry, not the plain mirror formula below).
  if (preset === 'iShape') return I_SHAPE_SEGMENT_PAIRS[key] || [i];
  // T7 DIAMOND-TOP HOURGLASS: a declared pairing too -- the generic mirror formula below gives the wrong index
  // for this outline's own starting point (see DIAMOND_TOP_HOURGLASS_SEGMENT_PAIRS' own doc comment).
  if (preset === 'diamondTopHourglass') return DIAMOND_TOP_HOURGLASS_SEGMENT_PAIRS[key] || [i];
  // T11 HOURGLASS ROOF: a declared pairing too -- the generic mirror formula below assumes an even segment count
  // (see DIAMOND_TOP_HOURGLASS_PINCH_SEGMENT_PAIRS' own doc comment for why T11's odd-count outline needs it).
  if (preset === 'diamondTopHourglassPinch') return DIAMOND_TOP_HOURGLASS_PINCH_SEGMENT_PAIRS[key] || [i];
  // T5 HOURGLASS DIPPED TOP: the 16-segment dipped outline mirrors by its own table (topDipMirrorIndex)
  const m = preset === 'hourglass' && n === TOP_DIP_SEGMENT_COUNT ? topDipMirrorIndex(i) : mirrorSegmentIndex(i, n);
  return m === i ? [i] : [i, m];
}

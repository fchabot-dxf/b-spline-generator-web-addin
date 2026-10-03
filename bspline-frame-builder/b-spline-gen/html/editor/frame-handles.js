/**
 * frame-handles.js — FB-APP F9: the frame shape HANDLES of the editor's Frame
 * tab, read from the ONE binding table (template_data.py FRAME_HANDLES ->
 * frame-defs `handles`). Pure: no DOM, no app state.
 *
 * A handle drags one of the silhouette engine's shape params (a fraction of
 * its `basis`: the safe zone's half width, half height or full height). Where
 * the dragged value lives is the handle's declared binding:
 *   'seeded'          -> record.seeds[key] (the fraction); [Send frame] seeds it
 *                        into the sketch as a plain value, no user parameter;
 *   { param: name }   -> record.params[name] (inches = fraction x basis), an
 *                        EXISTING template param, once goldens prove the match.
 * The handles themselves are the Shape Lattice's own (computeParamHandles:
 * axis-locked, clamped to the generator's feasible ranges), not a copy.
 */
import { computeParamHandles } from './editor-shape-lattice-interaction.js';
import {
  PARAM_ORDER, feasibleParamRanges, generateSilhouette, paramsFromShapeModel, seededUnit,
  MIN_ARC_RADIUS_IN, topDipDepthForRadius, HORN_MIN_OF_HALF_HEIGHT, TOP_DIP_MIN_WIDTH, hourglassConstruction,
} from './editor-shape-lattice-generator.js';

/** F13 (FRAME-GEN): a generated value is drawn from this band of its feasible
 *  range (a design choice, not a guard: every value in the range is valid; the
 *  band keeps a generated frame off the extremes). */
export const FRAME_GEN_BAND = [0.1, 0.9];
const FRAME_GEN_SALT = 700;

/**
 * F13: the FRAME's own feasibility, on top of the silhouette's. The frame's
 * inner edge is the outline offset inward by the frame thickness t
 * (outline-offset.js), so at the pinch (the hourglass waist, the bottle neck)
 * the opening across the centreline must stay at least this wide, or the two
 * inner edges cross and the opening closes (MEASURED: a generated T1 waist of
 * 0.78 left a 1.44 in pinch for a 2 x 0.75 in frame). A declared minimum.
 */
export const FRAME_MIN_OPENING_IN = 0.25;
const _templateThickness = (tpl) => tpl.params.find((p) => p.name === 'frame_thickness')?.default ?? 0;
const _narrow = (r, lo, hi) => {
  const a = Math.max(r.min, lo), b = Math.min(r.max, hi);
  return a <= b ? { min: a, max: b } : { min: b, max: b }; // no room: validity (the frame rule) wins
};

/**
 * T5 HOURGLASS DIPPED TOP: the sides' outline (Template 1's pieces 0..4 and 6..10, the left ones mirrored onto
 * the right) as points, board coordinates (y down), from the generator's own solve of `resolved` without the dip.
 * `sideX(y1)` = the sides' smallest x over every point at or above y1, the room the top dip has across down to
 * that depth; `yInside(x)` = the highest side point closer in than x (Infinity: none).
 */
function _sideRoom(region, resolved) {
  const flat = { ...resolved, topDipWidth: undefined, topDipDepth: undefined };
  const sil = generateSilhouette(region, { preset: 'hourglass', params: flat });
  const cx0 = region.x + region.w / 2, pts = [];
  sil.primitives.forEach((p, i) => {
    if (i === 5 || i > 10) return; // the bottom and top edges
    const mirror = i > 5;
    const add = (q) => pts.push({ x: mirror ? 2 * cx0 - q.x : q.x, y: q.y });
    if (p.type === 'L') { add(p.p0); add(p.p1); return; }
    for (let k = 0; k <= 48; k++) {
      const th = p.theta1 + (p.dTheta * k) / 48;
      add({ x: p.cx + p.rx * Math.cos(th), y: p.cy + p.rx * Math.sin(th) });
    }
  });
  return {
    sideX: (y1) => pts.reduce((m, q) => (q.y <= y1 && q.x < m ? q.x : m), Infinity),
    yInside: (x) => pts.reduce((m, q) => (q.x < x && q.y < m ? q.y : m), Infinity),
  };
}

/**
 * T8 DIPPED TOP + LEFT-ONLY WAVE: `_sideRoom`'s own computation (see its doc comment), fed this preset's own wave
 * params translated to the hourglass preset's key names (waveReach -> waistReach, waveHeight -> waistCenterY,
 * waveCornerRadius -> cornerRadius, waveRadius -> waistRadius) so BOTH of `_sideRoom`'s own mirrored "sides" are
 * copies of the SAME wave -- since T8 has only the one (left) side, `sideX`/`yInside` (both computed in
 * `_sideRoom`'s own "mirrored onto the right" convention) already read exactly as the wave's own room.
 */
function _sideRoomDippedLeftWave(region, resolved) {
  return _sideRoom(region, {
    waistReach: resolved.waveReach, waistCenterY: resolved.waveHeight,
    cornerRadius: resolved.waveCornerRadius, waistRadius: resolved.waveRadius,
  });
}

/** The silhouette's feasible ranges narrowed by the frame opening rule (frame thickness `t`, inches). */
export function frameParamRanges(tpl, region, resolved, t = _templateThickness(tpl)) {
  const R = feasibleParamRanges(tpl.silhouettePreset, region, resolved);
  const hw = region.w / 2, half = FRAME_MIN_OPENING_IN / 2;
  if (tpl.silhouettePreset === 'bottle') R.neckWidth = _narrow(R.neckWidth, (t + half) / hw, Infinity);
  else if (tpl.silhouettePreset === 'tabTop') {
    // T6 TAB TOP (Fred: no bar thinner than the frame thickness, no tab side shorter than ~2 x the thickness).
    // Every piece is a bar t wide, so "thinner than t" = a bar shorter than t along the outline:
    //   tab width a (half): the tab top's inner edge 2a - 2t >= max(t, the minimum opening), and each shoulder
    //     bar (hw - a long, a parallelogram) >= t;
    //   tab height h: each tab side >= 2t, and the body's opening below the shoulders (2hh - h - 2t) >= t.
    const hh = region.h / 2;
    R.tabWidth = _narrow(R.tabWidth, (t + Math.max(half, t / 2)) / hw, (hw - t) / hw);
    R.tabHeight = _narrow(R.tabHeight, (2 * t) / hh, (2 * hh - 3 * t) / hh);
  } else if (tpl.silhouettePreset === 'iShape') {
    // T9 I SHAPE (Fred: no bar thinner than the frame thickness, no flange side shorter than ~2 x the thickness --
    // Template 6's own tab rule, applied at all 4 notches). Every piece is a bar t wide, so "thinner than t" = a
    // bar shorter than t along the outline:
    //   stem half width a: the stem's inner edge 2a - 2t >= max(t, the minimum opening), and each shoulder bar
    //     (hw - a long, a parallelogram) >= t -- Template 6's own tabWidth formula, same topology;
    //   flange height h: each flange side >= 2t PLUS a small margin, and the stem's own opening between the two
    //     shoulders (2hh - 2h - 2t) >= t (one more thickness than the bare minimum).
    // MEASURED: unlike Template 6's own tab side (one CONVEX end at the tab top, one REFLEX end at the inside
    // corner -- the reflex end's own inward offset EXTENDS it, cancelling the convex end's own shortening, so its
    // inner length stays close to its outer one even clamped exactly to the 2t floor), a flange side here has TWO
    // convex ends (the true outer corner and the notch's own outer corner), so its inner length is its outer one
    // MINUS 2t exactly -- clamping to a floor of bare 2t left it EXACTLY zero at 12x6 (a `degenerateLine`, not a
    // self-intersection, but still a bar whose inner edge pinches to a point). The small 0.05 in margin below
    // keeps that inner length a real, strictly positive remnant instead of landing exactly on the boundary.
    const hh = region.h / 2;
    R.stemWidth = _narrow(R.stemWidth, (t + Math.max(half, t / 2)) / hw, (hw - t) / hw);
    R.flangeHeight = _narrow(R.flangeHeight, (2 * t + 0.05) / hh, (2 * hh - 3 * t) / (2 * hh));
  } else if (tpl.silhouettePreset === 'diamondTopHourglass') {
    // T7 DIAMOND-TOP HOURGLASS: the opening rule at the neck (the silhouette's own narrowest point, by
    // construction) -- its inner edge (offset in by t on each side) must clear the minimum opening across the
    // centreline. FIRST CUT (not yet visually/live verified, see LIVE_CHECK.md): narrows `gableNeckWidth`'s own
    // floor so `2 * (gableNeckWidth * hw) - 2t >= FRAME_MIN_OPENING_IN`, the same shape the hourglass waist/T6
    // tab rules already use for "the inner edges cross if the pinch is too tight".
    R.gableNeckWidth = _narrow(R.gableNeckWidth, (t + half) / hw, Infinity);
  } else if (tpl.silhouettePreset === 'archedFunnel' || tpl.silhouettePreset === 'tulip') {
    // T84 item 3: unlike every branch above, `_archedTimerRange`'s own bounds (editor-shape-
    // lattice-generator.js) are ALREADY thickness-aware -- they were MEASURED directly against
    // the real production validity pipeline (outlineDefects/offsetOutlineInward/frameMiters/
    // miterStaysInsideWood) at frame_thickness=0.75in (SKETCH_3_PARAMETERS' own default), the
    // same `t` every other branch here narrows TOWARD, not a thickness-UNAWARE geometric-only
    // margin the way T10's own archRise range is (hourglassConstruction's own shape-only check,
    // narrowed here separately using the real `t`). No further narrowing is applied here; this
    // branch exists only so `_narrow(R.waistReach, ...)` below (the generic `else` fallback,
    // keyed by Template 1's own param names, which this template's own keys never match) does
    // not crash on `R.waistReach` being undefined. FIRST CUT: a frame_thickness far from the
    // default (SKETCH_3_PARAMETERS allows 0.25-1.5) is not re-validated against these bounds --
    // flagged, not fixed here, same honest scope every brand-new preset's own range function
    // above declares for itself.
  } else if (tpl.silhouettePreset === 'dippedLeftWave') {
    // T8: the wave's own opening rule (Template 1's waistReach rule, same formula: this preset's only pinch).
    R.waveReach = _narrow(R.waveReach, -Infinity, 1 - (t + half) / hw);
    // The dip's own opening rule: its inner edge must stay clear of BOTH the plain right side (a fixed vertical
    // line, its own inner edge always exactly `t` in from hw, so height never matters there) and the wave (the
    // SAME curved-side check T5's own dip uses, `_sideRoom`, fed the wave's own params). `pos` shifts the dip's
    // own reach on each side unevenly (the right stub reaches `a + pos` from centre, the left one `a - pos`), so
    // each side's own room is checked against its OWN reach, not a single shared `a`.
    if (R.topDipWidth && Number.isFinite(resolved.topDipWidth)) {
      const hh = region.h / 2, cx0 = region.x + hw, top = region.y;
      const { sideX, yInside } = _sideRoomDippedLeftWave(region, resolved);
      const pos = hw * (resolved.topDipPosition ?? 0);
      // width ceiling: both a+pos (right, vs the fixed hw - t) and a-pos (left, vs the wave's own room) must fit;
      // read at the smallest depth (as T5's own comment: never emptying the depth range). A sufficiently extreme
      // wave (independent of the dip, T8's own combination T5 never had to face) can leave NO room at all for
      // the opening rule's own margin -- floored at the dip's own geometric minimum (TOP_DIP_MIN_WIDTH) rather
      // than collapsing negative: the dip's own existence outranks the opening-rule's safety margin here.
      const rightMax = hw - t - half - pos;
      const leftMax = sideX(top + HORN_MIN_OF_HALF_HEIGHT * hh + 2 * t) - t - half + pos - cx0;
      R.topDipWidth = _narrow(R.topDipWidth, -Infinity, Math.max(TOP_DIP_MIN_WIDTH, Math.min(rightMax, leftMax) / hw));
      const a = hw * resolved.topDipWidth;
      // depth ceiling: the plain right side never narrows with depth (a fixed vertical line); only the wave does.
      // Floored the same way as the width, for the same reason.
      const needLeft = cx0 - (a - pos) - t - half;
      const dRoomLeft = yInside(2 * cx0 - needLeft) - top - 2 * t; // yInside's own "mirrored onto the right" input
      R.topDipDepth = _narrow(R.topDipDepth, -Infinity,
        Math.max(HORN_MIN_OF_HALF_HEIGHT, Math.min(dRoomLeft, topDipDepthForRadius(a, t + MIN_ARC_RADIUS_IN)) / hh));
    }
  } else {
    R.waistReach = _narrow(R.waistReach, -Infinity, 1 - (t + half) / hw); // the pinch: hw - depth - t >= half
    // T4 OFFSET HOURGLASS: the left pinch obeys the same rule on its own side.
    if (R.waistReachLeft) R.waistReachLeft = _narrow(R.waistReachLeft, -Infinity, 1 - (t + half) / hw);
    // T10 ARCHED HOURGLASS (H23 item 21): archRise eats into the horn's own length (hourglassConstruction's
    // "eating into the horn, never adding height above it" rule) -- its shape-only range (_hourglassRange)
    // only keeps the horn above HORN_MIN_OF_HALF_HEIGHT * hh, a tiny geometric-validity margin, not aware of
    // the frame's own wall thickness t. MEASURED (a real [Generate] draw, live Fusion send): a horn can stay
    // comfortably "valid" by that margin (0.41 in) while still shorter than t (0.75 in) -- Fusion's own
    // inward offset at that corner has nowhere to go, `addOffset2` fails on topology, and the frame_top/
    // frame_right bars never get built. Narrow the ceiling so the horn keeps at least t remaining, same
    // "opening rule" shape every other pinch/corner check above already uses.
    if (R.archRise) {
      const hh = region.h / 2;
      const g = hourglassConstruction(region, { ...resolved, archRise: undefined });
      const hornLen = Math.min(hh + g.shoulderY, g.left ? hh + g.left.shoulderY : Infinity);
      R.archRise = _narrow(R.archRise, -Infinity, Math.max(hornLen - t, HORN_MIN_OF_HALF_HEIGHT * hh) / hh);
    }
    // T5 HOURGLASS DIPPED TOP (only a frame whose outline has the dip: its resolved params carry it). The dip's
    // inner edge (the dip offset down by t) lies within |x| <= a, from t to D + t below the top; the sides' inner
    // edge is t in from the sides. So the opening rule on the dip: at every height the dip's inner edge can
    // reach (the sides' outline down to D + 2t below the top) the sides stay at least a + t + half out
    // (`_sideRoom`), which also keeps each straight stub's inner edge (the inner corner at hw - t to the dip's
    // start) at least half the opening long, the square corner and its miter clean. The width reads it at the
    // smallest depth (so the depth range is never empty), the depth at the resolved width. And the top
    // shoulders' inner offset (radius r - t) keeps MIN_ARC_RADIUS_IN, so it never collapses.
    if (R.topDipWidth && Number.isFinite(resolved.topDipWidth)) {
      const hh = region.h / 2, cx0 = region.x + hw, top = region.y, { sideX, yInside } = _sideRoom(region, resolved);
      R.topDipWidth = _narrow(R.topDipWidth, -Infinity,
        (Math.min(cx0 + hw - t - half, sideX(top + HORN_MIN_OF_HALF_HEIGHT * hh + 2 * t) - t - half) - cx0) / hw);
      const a = hw * resolved.topDipWidth, need = cx0 + a + t + half;
      // the highest side point closer in than `need` stops the dip's inner edge 2t above it
      const dRoom = yInside(need) - top - 2 * t;
      R.topDipDepth = _narrow(R.topDipDepth, -Infinity, Math.min(dRoom, topDipDepthForRadius(a, t + MIN_ARC_RADIUS_IN)) / hh);
    }
  }
  return R;
}

const BASIS = { hw: (r) => r.w / 2, hh: (r) => r.h / 2, h: (r) => r.h };

/**
 * T6 TAB TOP (T9 I SHAPE the same way): presets whose DRAWN frame (not only a drag) obeys the frame rule
 * (frameParamRanges): their shape params are clamped into it before the outline is solved (editor-frame-
 * profile.js frameCutProfile), so a model value or a saved seed that breaks the thickness rule (e.g. the 12x6
 * provisional tab, 1.375 in for a 0.75 in frame) is drawn, seeded and sent at the nearest valid size. Only a
 * frame that fits the board: the rule is undefined when the frame does not (FRAME_FIT). The hourglass / bottle /
 * dippedLeftWave frames are not clamped (as before).
 */
export const FRAME_CLAMPED_PRESETS = Object.freeze(['tabTop', 'iShape']);
export function clampToFrameRanges(tpl, region, params, t = _templateThickness(tpl)) {
  const preset = tpl.silhouettePreset;
  if (!FRAME_CLAMPED_PRESETS.includes(preset)) return params;
  const out = { ...params };
  for (const key of PARAM_ORDER[preset]) {
    const resolved = generateSilhouette(region, { preset, params: out }).params;
    const r = frameParamRanges(tpl, region, resolved, t)[key];
    out[key] = Math.max(r.min, Math.min(r.max, resolved[key]));
  }
  return out;
}

/** The template's declared handles (the binding table). */
export const frameHandleTable = (tpl) => (tpl && tpl.handles) || [];

/** The shape-param values the record sets through its handles (seeds + bound params). */
export function shapeParamOverrides(tpl, record, region) {
  const out = {};
  for (const h of frameHandleTable(tpl)) {
    if (h.binding === 'seeded') {
      const v = record?.seeds?.[h.key];
      if (Number.isFinite(v)) out[h.key] = v;
    } else if (h.binding && h.binding.param) {
      const v = record?.params?.[h.binding.param];
      if (Number.isFinite(v)) out[h.key] = v / BASIS[h.basis](region);
    }
  }
  return out;
}

/** The on-canvas handles for a drawn cut profile (its region + resolved params),
 *  only those the table declares, each with its binding. */
export function frameHandles(tpl, prof, t = _templateThickness(tpl)) {
  const table = new Map(frameHandleTable(tpl).map((h) => [h.key, h]));
  // F13: a drag honours the frame opening too -- F27 item 2 arc pull: handed IN as the catalogue's one range
  // source (a coupled waist drag checks each candidate pair against it), not clamped on afterwards. And the arc
  // grips re-solve over the frame's OWN params (prof.shapeParams: the fitted model + the record's seeds),
  // exactly what the seeds they write will produce.
  const opts = { rangesFor: (params) => frameParamRanges(tpl, prof.region, params, t) };
  if (prof.shapeParams) opts.shape = { params: prof.shapeParams };
  return computeParamHandles(tpl.silhouettePreset, prof.region, prof.params, [...table.keys()], opts)
    .map((h) => ({ ...h, label: table.get(h.key).label, binding: table.get(h.key).binding, basis: table.get(h.key).basis,
      table })); // F27 item 2 arc pull: a waist drag also writes its partner key, through the partner's binding
}

/**
 * F11, option B (Fred: "simply seed it in position"): the seeded outline as the
 * template's OWN seed geometry (frame-defs `seedMap`, template_data.py
 * FRAME_SEED_MAP), in Fusion sketch coordinates (inches, centred, y up), for
 * fb_engine/seed_geometry.py to move those seeds. `prof` is the drawn cut
 * profile (frameCutProfile) on a `W` x `H` board.
 */
export const PIN_AXIS_NUDGE_IN = 0.01; // a pin's inner end sits this far off the Y axis (the phases' own anti-auto-coincidence nudge)
export function frameSeedGeometry(tpl, prof, W, H) {
  const F = (p) => [p.x - W / 2, H / 2 - p.y];
  const at = (a, t) => ({ x: a.cx + a.rx * Math.cos(a.theta1 + a.dTheta * t), y: a.cy + a.rx * Math.sin(a.theta1 + a.dTheta * t) });
  const out = {};
  for (const e of (tpl && tpl.seedMap) || []) {
    const p = prof.primitives[e.prim];
    if (e.kind === 'line') {
      const pts = [F(p.p0), F(p.p1)];
      out[e.id] = { points: e.reverse ? pts.reverse() : pts };
    } else if (e.kind === 'arc') {
      // H23 item 63 (d): at an extreme handle value the silhouette generator can legitimately
      // collapse this SAME primitive slot into a near-zero-length LINE instead of a true arc
      // (MEASURED: template_10 archRise=0 flattens its own arch; an extreme taper can shrink
      // template_12's own shoulder arc's sweep to ~0) -- `at()` then reads `cx`/`rx`/`theta1` off
      // a line primitive (`p0`/`p1` only), producing NaN, sent to Fusion as a literal null point.
      // Seed a well-formed (if degenerate) 3-point arc through the line's own two endpoints
      // instead, its arithmetic midpoint standing in for the bulge point -- the declared
      // BuildSequence step is still 'Arc3Point' either way, so the shape sent must still be one.
      let [s, m, t] = p.type === 'A'
        ? [F(at(p, 0)), F(at(p, 0.5)), F(at(p, 1))]
        : [F(p.p0), [(F(p.p0)[0] + F(p.p1)[0]) / 2, (F(p.p0)[1] + F(p.p1)[1]) / 2], F(p.p1)];
      // T5 HOURGLASS DIPPED TOP: an arc whose centre is on the Y axis (the top dip) is seeded `nudgeX` in off it
      // (the pins' own anti-auto-coincidence nudge); its phase puts the centre on the axis explicitly.
      // H23 item 48 (MEASURED live): the nudge must move ONLY the mid (bulge) point, matching the Python
      // literal seed's own convention (p02_03_loop.py nudges just its arc's middle Points entry) -- nudging
      // the two END points too (the previous code here) breaks the exact mirror-symmetry the dip's shared
      // endpoints need against the shoulder arcs' own sent ends, which the Y-axis-centering constraint then
      // resolves by moving the WHOLE tangent chain by ~0.1-0.3 in instead of the intended ~0.01 in -- the
      // "preview != build" gap item 46's own sweep first found. Confirmed: un-nudging the ends made the live
      // build land back on the literal/golden position to the ten-thousandth of an inch.
      if (e.nudgeX) m = [m[0] + e.nudgeX, m[1]];
      out[e.id] = { points: e.reverse ? [t, m, s] : [s, m, t] };
    } else if (e.kind === 'pin') {
      // H23 item 63 (d): same degenerate-primitive case as the 'arc' branch above -- a pin
      // anchors to an arc's own centre (`p.cx`/`p.cy`), which a collapsed-to-a-line primitive
      // doesn't have; its own two endpoints' midpoint is where that centre would sit anyway once
      // the arc's sweep has shrunk this close to zero.
      const c = p.type === 'A' ? F({ x: p.cx, y: p.cy }) : [(F(p.p0)[0] + F(p.p1)[0]) / 2, (F(p.p0)[1] + F(p.p1)[1]) / 2];
      const inner = [Math.sign(c[0]) * PIN_AXIS_NUDGE_IN, c[1]];
      out[e.id] = { points: e.outer === 'S' ? [c, inner] : [inner, c] };
    } else if (e.kind === 'radius') {
      out[e.id] = { radius: p.rx };
    }
  }
  return out;
}

/**
 * F13 (FRAME-GEN, Fred: "a generate button that regenerates every time we
 * press, and allow to tweak the result with handles"): a seeded random frame
 * shape as the template's SEEDED handle values (record.seeds). Each value is
 * drawn inside its declared feasible range (F5, with F12's closed-notch and
 * keyhole bounds, and the frame opening rule for thickness `t`), in
 * PARAM_ORDER, each range conditional on the values drawn before it, so a
 * generated frame (outline AND inner edge) can never loop or invert. The same
 * `seed` gives the same shape. `region` = the frame's cut-profile region.
 *
 * H23 item 40 (Fred: simple shapes, no short grain): a handle's own declared
 * `generateRange` (template_data.py's FRAME_HANDLES, e.g. T7's own
 * gableNeckWidth/neckHeight/bodyFlareHeight) narrows the floor/ceiling of
 * [Generate]'s OWN draw -- intersected with the computed feasible range, so
 * it can only ever narrow, never widen past what's actually feasible. Drag
 * handles (frameHandles below) read the full feasible range directly and are
 * NOT affected -- this only changes what Generate is willing to draw.
 */
export function generateFrameSeeds(tpl, region, seed, t = _templateThickness(tpl)) {
  const preset = tpl.silhouettePreset;
  const table = frameHandleTable(tpl);
  const seeded = new Set(table.filter((h) => h.binding === 'seeded').map((h) => h.key));
  const params = { ...paramsFromShapeModel(preset, tpl.shapeModel, region) };
  const seeds = {};
  PARAM_ORDER[preset].forEach((key, i) => {
    if (!seeded.has(key)) return;
    const resolved = generateSilhouette(region, { preset, params }).params;
    let r = frameParamRanges(tpl, region, resolved, t)[key];
    const gen = table.find((h) => h.key === key)?.generateRange;
    if (gen) r = { min: Math.max(r.min, gen.min ?? r.min), max: Math.min(r.max, gen.max ?? r.max) };
    const u = FRAME_GEN_BAND[0] + (FRAME_GEN_BAND[1] - FRAME_GEN_BAND[0]) * seededUnit(seed, FRAME_GEN_SALT + i);
    params[key] = seeds[key] = r.min + (r.max - r.min) * u;
  });
  return seeds;
}

// T10 ARCHED HOURGLASS (Fred: "Generate must never produce a broken frame"): a template whose handle table
// doesn't expose every param that shapes the frame's own INNER edge (T10 seeds only 3 of the shared hourglass
// preset's params; the shoulder/hip/waist radii stay at the shape model's own fixed default rather than being
// redrawn to fit the generated waist, unlike T1/T3/T4/T5's own full handle set) can still draw a (reach,
// position) pair whose BARE outline is a valid simple shape -- everything generateFrameSeeds' own ranges already
// guarantee -- yet whose frame-thickness-offset INNER edge collapses a fixed corner into a reversed, self-
// crossing arc (MEASURED: T10 7x9, ~3/50 seeds). Declared as a retry, not a hand-derived inequality on top of
// the existing range math: redraw with a salted seed (the external seed always retries the same way, so
// [Generate] stays reproducible) until the caller's own real validity check (the actual inner profile's
// defects, computed from production code) passes, or give up after a bounded number of attempts and return the
// last draw rather than loop forever (this should be rare enough it is never reached in practice).
const GENERATE_RETRY_SALT = 104729; // a prime, decorrelated from FRAME_GEN_SALT's own small offsets
// H23 item 23: T10's own NEW reflex-arc check (frame-panel.js's generateFrame) needs more attempts than the
// inner-defects check alone did -- MEASURED (5000-seed sweeps, portrait sizes): worst case needed 51 attempts
// (7x9), 35 (6x9), 28 (9x12); 20 left 7-17/1000 still bad, 40 still left 1/1000 bad at 7x9. 80 gives 0/5000 at
// every portrait size with real margin above the observed worst case, confirmed stable from 1000 to 5000 seeds.
// H23 item 39: the new no-hooked-tip margin check (frame-panel.js's generateFrame) is far tighter for ONE
// template -- T7's own eave corner is structurally close to this floor for almost any seed (MEASURED:
// raw per-draw pass rate 38.6% at 6x9, only ~4.1%/4.3% at 7x9/9x12 -- every other template passes
// ~98-100% raw, so 80 was never the binding case before). MEASURED worst-case attempts-to-first-pass
// over 2000 external seeds, T7 (the binding template): 17 (6x9), 273 (7x9), 250 (9x12); 0/2000 ever
// exceeded that. 500 gives real margin above the observed worst case (273) and costs nothing -- even a
// fully-exhausted 500-attempt budget (every attempt rejected, the pathological case) measures under 7ms.
const GENERATE_MAX_ATTEMPTS = 500;
export function generateValidFrameSeeds(tpl, region, seed, t, isValid) {
  let seeds = generateFrameSeeds(tpl, region, seed, t);
  for (let attempt = 1; attempt < GENERATE_MAX_ATTEMPTS && !isValid(seeds); attempt++) {
    seeds = generateFrameSeeds(tpl, region, seed + attempt * GENERATE_RETRY_SALT, t);
  }
  return seeds;
}

/** The record patch a drag of `handle` to board point `pt` writes (per its binding). `ctx` (F27 item 2 arc
 *  pull): the drag's `{side, grab}` -- which arc was grabbed (1 = the mirrored left one) and the value at the
 *  grab. The handle's own `patchFromWorld` says which shape params one drag sets: its own key, or for the
 *  hourglass waist (a CAD circle) BOTH waistReach and waistRadius, each written through ITS binding in the
 *  table (a key the table does not declare is not written: the shape keeps its fitted value). */
export function handleDragPatch(record, handle, pt, region, ctx = {}) {
  const patch = handle.patchFromWorld ? handle.patchFromWorld(pt, ctx) : { [handle.key]: handle.valueFromWorld(pt, ctx) };
  const table = handle.table || new Map();
  const seeds = { ...(record.seeds || {}) }, params = { ...(record.params || {}) };
  let seeded = false, bound = false;
  for (const [key, v] of Object.entries(patch)) {
    const b = key === handle.key ? handle : table.get(key);
    if (!b) continue;
    if (b.binding === 'seeded') { seeds[key] = v; seeded = true; } else if (b.binding && b.binding.param) {
      params[b.binding.param] = v * BASIS[b.basis](region);
      bound = true;
    }
  }
  return { ...(seeded ? { seeds } : {}), ...(bound ? { params } : {}) };
}

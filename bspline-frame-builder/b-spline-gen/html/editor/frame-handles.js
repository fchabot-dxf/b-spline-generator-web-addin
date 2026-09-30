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
  MIN_ARC_RADIUS_IN, topDipDepthForRadius, HORN_MIN_OF_HALF_HEIGHT,
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
  } else {
    R.waistReach = _narrow(R.waistReach, -Infinity, 1 - (t + half) / hw); // the pinch: hw - depth - t >= half
    // T4 OFFSET HOURGLASS: the left pinch obeys the same rule on its own side.
    if (R.waistReachLeft) R.waistReachLeft = _narrow(R.waistReachLeft, -Infinity, 1 - (t + half) / hw);
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
 * T6 TAB TOP: presets whose DRAWN frame (not only a drag) obeys the frame rule (frameParamRanges): their shape
 * params are clamped into it before the outline is solved (editor-frame-profile.js frameCutProfile), so a model
 * value or a saved seed that breaks the thickness rule (e.g. the 12x6 provisional tab, 1.375 in for a 0.75 in
 * frame) is drawn, seeded and sent at the nearest valid size. Only a frame that fits the board: the rule is
 * undefined when the frame does not (FRAME_FIT). The hourglass / bottle frames are not clamped (as before).
 */
export const FRAME_CLAMPED_PRESETS = Object.freeze(['tabTop']);
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
      let [s, m, t] = [F(at(p, 0)), F(at(p, 0.5)), F(at(p, 1))];
      // T5 HOURGLASS DIPPED TOP: an arc whose centre is on the Y axis (the top dip) is seeded `nudgeX` in off it
      // (the pins' own anti-auto-coincidence nudge); its phase puts the centre on the axis explicitly.
      if (e.nudgeX) [s, m, t] = [s, m, t].map(([x, y]) => [x + e.nudgeX, y]);
      out[e.id] = { points: e.reverse ? [t, m, s] : [s, m, t] };
    } else if (e.kind === 'pin') {
      const c = F({ x: p.cx, y: p.cy });
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
 */
export function generateFrameSeeds(tpl, region, seed, t = _templateThickness(tpl)) {
  const preset = tpl.silhouettePreset;
  const seeded = new Set(frameHandleTable(tpl).filter((h) => h.binding === 'seeded').map((h) => h.key));
  const params = { ...paramsFromShapeModel(preset, tpl.shapeModel, region) };
  const seeds = {};
  PARAM_ORDER[preset].forEach((key, i) => {
    if (!seeded.has(key)) return;
    const resolved = generateSilhouette(region, { preset, params }).params;
    const r = frameParamRanges(tpl, region, resolved, t)[key];
    const u = FRAME_GEN_BAND[0] + (FRAME_GEN_BAND[1] - FRAME_GEN_BAND[0]) * seededUnit(seed, FRAME_GEN_SALT + i);
    params[key] = seeds[key] = r.min + (r.max - r.min) * u;
  });
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

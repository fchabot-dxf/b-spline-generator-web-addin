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

/** The silhouette's feasible ranges narrowed by the frame opening rule (frame thickness `t`, inches). */
export function frameParamRanges(tpl, region, resolved, t = _templateThickness(tpl)) {
  const R = feasibleParamRanges(tpl.silhouettePreset, region, resolved);
  const hw = region.w / 2, half = FRAME_MIN_OPENING_IN / 2;
  if (tpl.silhouettePreset === 'bottle') R.neckWidth = _narrow(R.neckWidth, (t + half) / hw, Infinity);
  else R.waistReach = _narrow(R.waistReach, -Infinity, 1 - (t + half) / hw); // the pinch: hw - depth - t >= half
  return R;
}

const BASIS = { hw: (r) => r.w / 2, hh: (r) => r.h / 2, h: (r) => r.h };

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
  const R = frameParamRanges(tpl, prof.region, prof.params, t); // F13: a drag honours the frame opening too
  return computeParamHandles(tpl.silhouettePreset, prof.region, prof.params, [...table.keys()])
    .map((h) => ({ ...h, label: table.get(h.key).label, binding: table.get(h.key).binding, basis: table.get(h.key).basis,
      valueFromWorld: (pt) => Math.max(R[h.key].min, Math.min(R[h.key].max, h.valueFromWorld(pt))) }));
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
      const [s, m, t] = [F(at(p, 0)), F(at(p, 0.5)), F(at(p, 1))];
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

/** The record patch a drag of `handle` to board point `pt` writes (per its binding). */
export function handleDragPatch(record, handle, pt, region) {
  const v = handle.valueFromWorld(pt);
  if (handle.binding === 'seeded') return { seeds: { ...(record.seeds || {}), [handle.key]: v } };
  return { params: { ...(record.params || {}), [handle.binding.param]: v * BASIS[handle.basis](region) } };
}

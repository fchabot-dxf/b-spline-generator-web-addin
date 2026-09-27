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
export function frameHandles(tpl, prof) {
  const table = new Map(frameHandleTable(tpl).map((h) => [h.key, h]));
  return computeParamHandles(tpl.silhouettePreset, prof.region, prof.params, [...table.keys()])
    .map((h) => ({ ...h, label: table.get(h.key).label, binding: table.get(h.key).binding, basis: table.get(h.key).basis }));
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

/** The record patch a drag of `handle` to board point `pt` writes (per its binding). */
export function handleDragPatch(record, handle, pt, region) {
  const v = handle.valueFromWorld(pt);
  if (handle.binding === 'seeded') return { seeds: { ...(record.seeds || {}), [handle.key]: v } };
  return { params: { ...(record.params || {}), [handle.binding.param]: v * BASIS[handle.basis](region) } };
}

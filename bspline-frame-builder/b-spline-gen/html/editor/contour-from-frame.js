/**
 * contour-from-frame.js — F21 CONTOUR-FROM-FRAME (Fred: "add a way in art to match the frame outline
 * concentrically" -> "a toggle for 'offset from frame'" on the Shape Lattice contour).
 *
 * `pattern.contour.fromFrame = { on, distance, distanceRef }` (PATTERN_DEFAULTS: off, 0.25 in, 'outer').
 * ON: the contour is the frame's OUTER edge (its cut profile, `distance = 0`) offset by `distance` --
 * positive = inward, negative = outward -- measured to the contour's OUTSIDE edge (T74: a contour's declared
 * size is its outside edge), so its centerline sits half the contour stroke further in. One call to the F8
 * true offset (outline-offset.js, the same function the frame's inner edge uses AND the panel lip's own
 * outward trim, F22, already proved handles a negative amount), never a copy.
 *
 * F26 (Fred, screenshot: "offset from frame at 0 is clamped to the inside of frame rather than outside, and
 * doesn't accept negative value"): the reference point moved from the frame's INNER edge (the cut profile
 * offset inward by `frame_thickness`, so `distance=0` used to sit `frame_thickness` inward of the outline)
 * to the OUTER edge directly. `distanceRef: 'outer'` is the declared marker a saved pattern carries once it
 * is in this (current) scheme -- `main/app-init.js`'s `contour-from-frame-outer-edge` migration converts an
 * older saved `distance` (absent the marker) by `+= frame_thickness`, once, so an existing contour's actual
 * drawn position does not move on load.
 *
 * A convex corner arc smaller than the offset collapses: its neighbours meet in a sharp corner (Fusion's own
 * "merged regime"; the frame's inner edge does the same). Fred: "merge in corner not a problem, just less
 * segments". So collapsed pieces are DROPPED and the joints where they were are declared `corners` (sharp
 * on purpose); every other joint stays tangent.
 *
 * `contourSilhouette` is THE chokepoint every contour consumer reads (the drawn contour, its detach check,
 * the Fusion manifest and its fill clip), so they can never disagree.
 */
import { generateContourSilhouette, generateSilhouette, outlineDefects } from './editor-shape-lattice-generator.js';
import { frameCutProfile } from './editor-frame-profile.js';
import { offsetOutlineInward } from './outline-offset.js';
import { sampleOutline, pointInPolygon } from '../core/preview/frame-mesh.js';
import { distToPrimitive } from './editor-primitives.js';

/** Points along a loop (lines: 8 each, arcs: 24 each). */
function _samples(prims) {
  const out = [];
  for (const p of prims) {
    if (p.type === 'L') for (let k = 0; k <= 8; k++) out.push({ x: p.p0.x + ((p.p1.x - p.p0.x) * k) / 8, y: p.p0.y + ((p.p1.y - p.p0.y) * k) / 8 });
    else for (let k = 0; k <= 24; k++) { const th = p.theta1 + (p.dTheta * k) / 24; out.push({ x: p.cx + p.rx * Math.cos(th), y: p.cy + p.rx * Math.sin(th) }); }
  }
  return out;
}
/** Exact distance from a point to a line/arc loop. */
function _distToLoop(q, prims) {
  let best = Infinity;
  for (const p of prims) best = Math.min(best, distToPrimitive(q, p)); // audit tidy-up: the shared helper
  return best;
}

export const CONTOUR_FROM_FRAME_DEFAULTS = Object.freeze({ on: false, distance: 0, distanceRef: 'outer' }); // Fred: default distance 0 (on the frame's outer edge)

/** The effective `{ on, distance }` of a pattern (absent = off: old patterns keep their preset contour).
 *  F26: negative `distance` (outward) is accepted; only a genuinely non-finite value falls back. */
export function contourFromFrameOf(pattern) {
  const ff = { ...CONTOUR_FROM_FRAME_DEFAULTS, ...((pattern && pattern.contour && pattern.contour.fromFrame) || {}) };
  const distance = Number(ff.distance);
  return { on: !!ff.on, distance: Number.isFinite(distance) ? distance : CONTOUR_FROM_FRAME_DEFAULTS.distance };
}

/** True when a frame is chosen (the toggle's precondition). `frame` = `{ defs, record, board }`. */
export function hasFrame(frame) {
  return !!(frame && frame.defs && frame.record && frame.record.templateId);
}

/**
 * The frame-offset contour, silhouette-shaped (`primitives`, `segments` 1:1 with them, `corners`, `region` =
 * its OUTSIDE bounding box, `params` {} = no preset parameters), or `{ error }` when there is no frame, the
 * frame does not fit, or the offset leaves no valid loop. `frame` = `{ defs, record, board: {widthIn, heightIn} }`.
 */
export function frameContourSilhouette(frame, distance, strokeWidth) {
  if (!hasFrame(frame)) return { error: 'noFrame' };
  const prof = frameCutProfile(frame.defs, frame.record, frame.board);
  if (!prof || prof.defects.length || !prof.fit.ok) return { error: 'frameInvalid' };
  const tpl = frame.defs.templates.find((t) => t.id === frame.record.templateId);
  const tp = tpl.params.find((q) => q.name === 'frame_thickness');
  const t = frame.record.params && Number.isFinite(frame.record.params.frame_thickness) ? frame.record.params.frame_thickness : tp.default;
  // F26: the contour's OUTSIDE edge, offset from the frame's OWN OUTER edge (the cut profile itself) --
  // distance alone, no longer `t + distance` (that offset the reference to the INNER edge instead).
  const out = distance;
  // the CENTRELINE offset actually applied: `out` + stroke/2, UNCHANGED from before F26 (a plain addition
  // on offsetOutlineInward's own continuous +inward/-outward scale is correct regardless of `out`'s own
  // sign -- e.g. out=-0.25, stroke=0.1: applied=-0.20, i.e. the centerline sits 0.20 outward, INSIDE the
  // 0.25-outward outside edge by the same half-stroke as ever; VERIFIED with this exact case, not assumed
  // from the formula alone. offsetOutlineInward's own sign convention: + = inward; F22's panel lip already
  // proved a negative amount offsets outward, not a new capability here).
  const applied = out + (strokeWidth || 0) / 2;
  const all = offsetOutlineInward(prof.primitives, applied);
  const keep = all.map((p) => !p.collapsed);
  const primitives = all.filter((_, i) => keep[i]);
  if (primitives.length < 3) return { error: 'tooSmall' };
  // a joint next to a dropped piece is a merged corner (kept index i = the joint between kept i and i+1)
  const kept = all.map((_, i) => i).filter((i) => keep[i]);
  const corners = [];
  kept.forEach((orig, k) => {
    const next = kept[(k + 1) % kept.length];
    if ((next - orig + all.length) % all.length !== 1) corners.push(k);
  });
  const defects = outlineDefects(primitives).filter((d) => !(d.kind === 'notTangent' && corners.includes(d.index)));
  if (defects.length) return { error: 'invalid', defects };
  // an offset only exists while the loop stays on its OWN side of the frame outline (inside for a positive
  // offset, outside for a negative one -- F26) at (at least) the offset distance; past that the offset
  // joints fly off (MEASURED pre-F26: T1 7x9 at 2 in "fits" a 12 in wide loop that passes the loop guard),
  // so this is the definition of the offset checked directly: every centerline point on the correct side of
  // the frame outline and >= |applied offset| from it. `applied` near zero (on the outline itself) skips
  // the side check -- "inside or outside" of a loop that IS the loop isn't a meaningful question, and
  // floating-point sampling would make it flaky either way.
  const outline = sampleOutline(prof.primitives);
  const need = Math.abs(applied) - 1e-3;
  const onCorrectSide = (q) => (Math.abs(applied) < 1e-9 ? true
    : applied > 0 ? pointInPolygon(q.x, q.y, outline) : !pointInPolygon(q.x, q.y, outline));
  if (!_samples(primitives).every((q) => onCorrectSide(q) && _distToLoop(q, prof.primitives) >= need)) {
    return { error: 'tooSmall' };
  }
  const segments = primitives.map((p) => (p.type === 'A'
    ? { style: 'curve', bulge: 0, dir: 'out', cornerRadius: 0 } : { style: 'straight', bulge: 0, dir: 'out', cornerRadius: 0 }));
  const sil = generateSilhouette(prof.region, { preset: tpl.silhouettePreset, params: prof.params });
  // T5 HOURGLASS DIPPED TOP: a dipped frame outline carries its own mirror table (16 segments); carried over to
  // the kept pieces (a dropped piece's partner mirrors itself), so the Fusion manifest pairs the right entities.
  // Absent (every other frame): no `mirror`, the manifest's plain mirrorSegmentIndex rule, exactly as before.
  const at = new Map(kept.map((orig, k) => [orig, k]));
  const mirror = Array.isArray(sil.mirror) ? kept.map((orig, k) => at.get(sil.mirror[orig]) ?? k) : null;
  // the OUTSIDE bounding box (the manifest's contour_width / contour_height): the centerline's extent + half stroke
  const pts = primitives.flatMap((p) => (p.type === 'L' ? [p.p0, p.p1]
    : Array.from({ length: 33 }, (_, k) => ({ x: p.cx + p.rx * Math.cos(p.theta1 + (p.dTheta * k) / 32), y: p.cy + p.rx * Math.sin(p.theta1 + (p.dTheta * k) / 32) }))));
  const h = (strokeWidth || 0) / 2;
  const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
  const region = { x: Math.min(...xs) - h, y: Math.min(...ys) - h, w: Math.max(...xs) - Math.min(...xs) + 2 * h, h: Math.max(...ys) - Math.min(...ys) + 2 * h };
  return { preset: 'frame', fromFrame: true, primitives, segments, corners, region, params: {}, cx: sil.cx,
    hasUserSegments: false, thickness: t, distance, ...(mirror ? { mirror } : {}) };
}

/**
 * THE contour a Shape Lattice pattern draws. Off (or no frame to follow): the preset silhouette in `region`
 * (generateContourSilhouette, unchanged). On: the frame-offset contour; if that is not available (no frame,
 * or no valid loop at this distance) the preset is used and `fromFrameError` says why, so the panel can say so.
 */
export function contourSilhouette(pattern, region, strokeWidth, frame) {
  const ff = contourFromFrameOf(pattern);
  if (ff.on) {
    const res = frameContourSilhouette(frame, ff.distance, strokeWidth);
    if (!res.error) return res;
    return { ...generateContourSilhouette(region, pattern.shape, strokeWidth), region, corners: [], fromFrameError: res.error };
  }
  return { ...generateContourSilhouette(region, pattern.shape, strokeWidth), region, corners: [] };
}

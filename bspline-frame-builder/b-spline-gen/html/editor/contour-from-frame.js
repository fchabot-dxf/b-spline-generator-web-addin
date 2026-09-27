/**
 * contour-from-frame.js — F21 CONTOUR-FROM-FRAME (Fred: "add a way in art to match the frame outline
 * concentrically" -> "a toggle for 'offset from frame'" on the Shape Lattice contour).
 *
 * `pattern.contour.fromFrame = { on, distance }` (PATTERN_DEFAULTS: off, 0.25 in). ON: the contour is the
 * frame's INNER edge offset inward by `distance`, i.e. the frame's cut profile offset by
 * frame_thickness + distance, measured to the contour's OUTSIDE edge (T74: a contour's declared size is its
 * outside edge), so its centerline sits half the contour stroke further in. One call to the F8 true offset
 * (outline-offset.js, the same function the frame's inner edge uses), never a copy.
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
  for (const p of prims) {
    if (p.type === 'L') {
      const dx = p.p1.x - p.p0.x, dy = p.p1.y - p.p0.y, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, ((q.x - p.p0.x) * dx + (q.y - p.p0.y) * dy) / L2)) : 0;
      best = Math.min(best, Math.hypot(p.p0.x + t * dx - q.x, p.p0.y + t * dy - q.y));
      continue;
    }
    let rel = Math.atan2(q.y - p.cy, q.x - p.cx) - p.theta1;
    rel -= 2 * Math.PI * Math.floor((rel + Math.PI) / (2 * Math.PI));
    const on = p.dTheta >= 0 ? rel >= 0 && rel <= p.dTheta : rel <= 0 && rel >= p.dTheta;
    if (on) best = Math.min(best, Math.abs(Math.hypot(q.x - p.cx, q.y - p.cy) - p.rx));
    else for (const th of [p.theta1, p.theta1 + p.dTheta]) best = Math.min(best, Math.hypot(p.cx + p.rx * Math.cos(th) - q.x, p.cy + p.rx * Math.sin(th) - q.y));
  }
  return best;
}

export const CONTOUR_FROM_FRAME_DEFAULTS = Object.freeze({ on: false, distance: 0.25 });

/** The effective `{ on, distance }` of a pattern (absent = off: old patterns keep their preset contour). */
export function contourFromFrameOf(pattern) {
  const ff = { ...CONTOUR_FROM_FRAME_DEFAULTS, ...((pattern && pattern.contour && pattern.contour.fromFrame) || {}) };
  const distance = Number(ff.distance);
  return { on: !!ff.on, distance: Number.isFinite(distance) && distance >= 0 ? distance : CONTOUR_FROM_FRAME_DEFAULTS.distance };
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
  const out = t + distance; // the contour's OUTSIDE edge
  const all = offsetOutlineInward(prof.primitives, out + (strokeWidth || 0) / 2);
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
  // an offset only exists while the loop stays INSIDE the frame at (at least) the offset distance; past that the
  // offset joints fly off (MEASURED: T1 7x9 at 2 in "fits" a 12 in wide loop that passes the loop guard), so this
  // is the definition of the offset checked directly: every centerline point inside the frame outline and
  // >= thickness + distance + stroke/2 from it
  const outline = sampleOutline(prof.primitives);
  const need = out + (strokeWidth || 0) / 2 - 1e-3;
  if (!_samples(primitives).every((q) => pointInPolygon(q.x, q.y, outline) && _distToLoop(q, prof.primitives) >= need)) {
    return { error: 'tooSmall' };
  }
  const segments = primitives.map((p) => (p.type === 'A'
    ? { style: 'curve', bulge: 0, dir: 'out', cornerRadius: 0 } : { style: 'straight', bulge: 0, dir: 'out', cornerRadius: 0 }));
  const sil = generateSilhouette(prof.region, { preset: tpl.silhouettePreset, params: prof.params });
  // the OUTSIDE bounding box (the manifest's contour_width / contour_height): the centerline's extent + half stroke
  const pts = primitives.flatMap((p) => (p.type === 'L' ? [p.p0, p.p1]
    : Array.from({ length: 33 }, (_, k) => ({ x: p.cx + p.rx * Math.cos(p.theta1 + (p.dTheta * k) / 32), y: p.cy + p.rx * Math.sin(p.theta1 + (p.dTheta * k) / 32) }))));
  const h = (strokeWidth || 0) / 2;
  const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
  const region = { x: Math.min(...xs) - h, y: Math.min(...ys) - h, w: Math.max(...xs) - Math.min(...xs) + 2 * h, h: Math.max(...ys) - Math.min(...ys) + 2 * h };
  return { preset: 'frame', fromFrame: true, primitives, segments, corners, region, params: {}, cx: sil.cx,
    hasUserSegments: false, thickness: t, distance };
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

/**
 * core/bricks/geometry.js — PORTABLE (see rng.js). Small, pure polygon/path helpers. No brick-
 * domain knowledge -- these work on plain {x,y} points and polygons (arrays of {x,y}), reused by
 * every layout + the frame placer.
 */

/** Standard ray-casting point-in-polygon (works for convex AND concave simple polygons -- board
 *  outlines in this app include concave shapes, e.g. an hourglass waist). */
export function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y, xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Plain average of a polygon's own corner points -- good enough for the near-rectangular cells
 *  every layout here produces (never a true area-weighted centroid, not needed at this shape). */
export function polygonCentroid(polygon) {
  let sx = 0, sy = 0;
  for (const p of polygon) { sx += p.x; sy += p.y; }
  return { x: sx / polygon.length, y: sy / polygon.length };
}

/** A rectangle (centre, half-length along `dir`, half-height along the perpendicular) as a
 *  4-point polygon, winding consistently (used by every layout for one unrotated/rotated cell). */
export function rectPolygon(cx, cy, halfLen, halfHt, dirX = 1, dirY = 0) {
  const nx = -dirY, ny = dirX; // perpendicular (unit, since dir is unit)
  return [
    { x: cx - dirX * halfLen - nx * halfHt, y: cy - dirY * halfLen - ny * halfHt },
    { x: cx + dirX * halfLen - nx * halfHt, y: cy + dirY * halfLen - ny * halfHt },
    { x: cx + dirX * halfLen + nx * halfHt, y: cy + dirY * halfLen + ny * halfHt },
    { x: cx - dirX * halfLen + nx * halfHt, y: cy - dirY * halfLen + ny * halfHt },
  ];
}

/** Cumulative arc length at each point of an open or closed polyline path. `pathLength(path)[i]`
 *  is the distance travelled from path[0] to path[i]. */
export function cumulativeLengths(path) {
  const out = [0];
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x, dy = path[i].y - path[i - 1].y;
    out.push(out[i - 1] + Math.hypot(dx, dy));
  }
  return out;
}

/** The point + unit tangent at arc-length `s` along `path` (cum = cumulativeLengths(path), passed
 *  in so callers walking the path in a loop don't recompute it every step). Clamps to the path's
 *  own ends. `closed`: when true, `s` wraps modulo the path's own total length (a frame contour is
 *  a closed loop). */
export function pointAtArcLength(path, cum, s, closed) {
  const total = cum[cum.length - 1];
  let t = closed ? ((s % total) + total) % total : Math.max(0, Math.min(total, s));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < t) i++;
  const segLen = cum[i] - cum[i - 1];
  const f = segLen > 1e-9 ? (t - cum[i - 1]) / segLen : 0;
  const a = path[i - 1], b = path[i];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: a.x + dx * f, y: a.y + dy * f, tx: dx / len, ty: dy / len };
}

/**
 * Offset a (closed) path inward by `width`, a true MITRED vertex offset -- each vertex moves
 * along the BISECTOR of its two incident edges' own normals, by whatever distance along that
 * bisector makes each edge's own perpendicular offset equal exactly `width` (not a simple
 * neighbour-averaged-normal offset, which under-shoots at a sharp corner: e.g. at a square's 90deg
 * corner the two edge normals are 90deg apart, so a naive average-direction offset of `width`
 * only moves each edge by width*cos(45deg) =~ 0.71*width, not the full width -- MEASURED via a
 * failing contour-bands.js band-width test before this fix existed). No self-intersection repair for a
 * concave corner tighter than the band width (the mitre distance is floored, see `cos` clamp
 * below, rather than blowing up toward a near-reflex corner) -- a documented P1 limitation, not a
 * silent one. `inwardSign`: the path's own winding determines which side is "inward" -- pass +1
 * or -1 to match (callers derive it once from the board/frame outline's own known winding, via
 * `signedArea`).
 */
export function offsetPathInward(path, width, inwardSign = 1) {
  const n = path.length;
  return path.map((p, i) => {
    const prev = path[(i - 1 + n) % n], next = path[(i + 1) % n];
    const t1x = p.x - prev.x, t1y = p.y - prev.y, len1 = Math.hypot(t1x, t1y) || 1;
    const n1x = -t1y / len1, n1y = t1x / len1;
    const t2x = next.x - p.x, t2y = next.y - p.y, len2 = Math.hypot(t2x, t2y) || 1;
    const n2x = -t2y / len2, n2y = t2x / len2;
    let bx = n1x + n2x, by = n1y + n2y;
    const blen = Math.hypot(bx, by);
    if (blen < 1e-9) { bx = n1x; by = n1y; } else { bx /= blen; by /= blen; }
    const cos = Math.max(0.2, bx * n1x + by * n1y); // floored so a near-reflex corner doesn't blow up
    const dist = width / cos;
    return { x: p.x + bx * dist * inwardSign, y: p.y + by * dist * inwardSign };
  });
}

/** Signed area of a closed polygon (shoelace) -- positive = counter-clockwise in a standard
 *  Y-up frame (or clockwise in Y-down); used only to pick offsetPathInward's own inward sign
 *  consistently, not for any absolute winding claim. */
export function signedArea(path) {
  let a = 0;
  for (let i = 0, j = path.length - 1; i < path.length; j = i++) a += (path[j].x + path[i].x) * (path[j].y - path[i].y);
  return a / 2;
}

/** Which `offsetPathInward` sign (+1 or -1) actually moves points TOWARD the polygon's own
 *  centroid -- determined empirically (a tiny trial offset both ways), not from a winding-
 *  direction assumption, so this works regardless of how the caller's own path was wound. */
export function inwardSignFor(path) {
  const c = polygonCentroid(path);
  const dist = (pts) => pts.reduce((s, p) => s + Math.hypot(p.x - c.x, p.y - c.y), 0);
  const plus = offsetPathInward(path, 0.01, 1);
  const minus = offsetPathInward(path, 0.01, -1);
  return dist(plus) < dist(minus) ? 1 : -1;
}

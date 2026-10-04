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

/** Clip `poly` to the half-plane of `line` ({point, dirX, dirY} -- a point ON the line plus its
 *  own direction vector) containing `keepRef` (a point known to belong on the side that must
 *  survive) -- a plain single-line Sutherland-Hodgman clip. PROMOTED here from along-path.js
 *  (H23 item 73a's own mitre-clip technique) because it's genuinely shape-agnostic -- any caller
 *  that already has a dividing line (a mitre line, a Voronoi bisector, ...) and a convex-ish
 *  polygon to trim can reuse this directly rather than re-deriving it (H23 item 74: the
 *  'fieldstone' layout's own Voronoi cells are built from a CHAIN of these same clips). A
 *  half-plane clip of a simple polygon is always simple -- this is what makes every caller of it
 *  robust: clipping only ever trims, never adds a self-intersection. */
export function clipToHalfPlane(poly, line, keepRef) {
  const side = (p) => line.dirX * (p.y - line.point.y) - line.dirY * (p.x - line.point.x);
  const keepSign = Math.sign(side(keepRef)) || 1;
  const s = (p) => side(p) * keepSign;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i], next = poly[(i + 1) % poly.length];
    const curS = s(cur), nextS = s(next);
    if (curS >= -1e-9) out.push(cur);
    if ((curS >= -1e-9) !== (nextS >= -1e-9)) {
      const t = curS / (curS - nextS);
      out.push({ x: cur.x + (next.x - cur.x) * t, y: cur.y + (next.y - cur.y) * t });
    }
  }
  return out;
}

/** Standard convexity test for a simple polygon: every consecutive turn has the same cross-product
 *  sign (collinear/near-zero turns are ignored). Works regardless of winding direction. */
export function isConvex(poly) {
  const n = poly.length;
  if (n < 3) return false;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n], c = poly[(i + 2) % n];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * Clip `poly` (any simple polygon -- a brick cell, a Voronoi stone, ...) to `boardOutline`: H23
 * item 74 (de, F35 item 1 review: "Wall's own brick fill overhangs past the board's edges... Fred
 * now wants the opposite: a brick crossing the edge should be CUT, not dropped or left hanging").
 * `boardOutline` convex (every real board used so far is a plain rectangle or a mild convex
 * outline): an EXACT cut, via a per-edge half-plane clip (clipToHalfPlane, once per board edge),
 * using `boardOutline`'s OWN centroid as the "which side is interior" reference for every edge --
 * ALWAYS safely interior for a convex polygon (a uniform average of a convex shape's own vertices
 * can never fall outside it), unlike `cellRefPoint`, which MUST NOT be used for this (MEASURED: a
 * cell mostly/entirely past the board edge has its own centre outside the board too, so using IT
 * as the per-edge "keep" reference flips entire edges to keep the EXTERIOR side instead --
 * reproduced a brick left 0.635in past the board edge, completely unclipped, before this fix).
 * `boardOutline` concave: a full polygon-boolean clip is out of scope here (declared, not silent --
 * Sutherland-Hodgman's own per-edge clip is only correct against a CONVEX clip shape) -- falls back
 * to bond.js's own prior, simpler convention: keep `poly` WHOLE when `cellRefPoint` (a point known
 * to belong to `poly` itself, e.g. its own generator/grid centre) is inside `boardOutline`, drop it
 * entirely otherwise.
 */
export function clipPolygonToBoard(poly, boardOutline, cellRefPoint) {
  if (isConvex(boardOutline)) {
    const interior = polygonCentroid(boardOutline);
    let out = poly;
    const n = boardOutline.length;
    for (let i = 0; i < n && out.length >= 3; i++) {
      const a = boardOutline[i], b = boardOutline[(i + 1) % n];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      out = clipToHalfPlane(out, { point: a, dirX: dx / len, dirY: dy / len }, interior);
    }
    return out;
  }
  return pointInPolygon(cellRefPoint.x, cellRefPoint.y, boardOutline) ? poly : [];
}

/**
 * Replace each vertex of a (convex) polygon with a short circular-arc fillet of radius `radius`
 * (H23 item 74c: fieldstone's own "slightly rounded corners") -- a standard inscribed-tangent-
 * circle construction: the two tangent points sit back from the vertex along its own incident
 * edges, the arc between them bulges toward the vertex, replaced by `segments` straight chords
 * (never a true curve primitive -- this engine only ever produces polygons). Degenerates
 * gracefully: a near-straight vertex (interior angle close to 180deg, i.e. barely a corner at
 * all) or a zero-length incident edge is left UNROUNDED rather than producing a garbage arc; the
 * tangent length is also clamped to at most 45% of either incident edge's own length so a small
 * cell's own rounding can never eat past its neighbouring vertex (shrinking the EFFECTIVE radius
 * there instead of corrupting the shape) -- the same "declared floor/clamp, not a blow-up" pattern
 * `offsetPathInward`'s own `cos` floor already uses.
 */
export function roundPolygonCorners(poly, radius, segments = 4) {
  if (!(radius > 0) || poly.length < 3) return poly;
  const n = poly.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const v = poly[i], prev = poly[(i - 1 + n) % n], next = poly[(i + 1) % n];
    const u1x = prev.x - v.x, u1y = prev.y - v.y, len1 = Math.hypot(u1x, u1y);
    const u2x = next.x - v.x, u2y = next.y - v.y, len2 = Math.hypot(u2x, u2y);
    if (len1 < 1e-9 || len2 < 1e-9) { out.push(v); continue; }
    const n1x = u1x / len1, n1y = u1y / len1, n2x = u2x / len2, n2y = u2y / len2;
    const cosTheta = Math.max(-1, Math.min(1, n1x * n2x + n1y * n2y));
    const theta = Math.acos(cosTheta);
    if (theta > Math.PI - 1e-3 || theta < 1e-3) { out.push(v); continue; } // ~straight or ~zero -- no real corner
    const half = theta / 2;
    const maxTangent = 0.45 * Math.min(len1, len2);
    const tangent = Math.min(radius / Math.tan(half), maxTangent);
    const actualRadius = tangent * Math.tan(half);
    const t1 = { x: v.x + n1x * tangent, y: v.y + n1y * tangent };
    const t2 = { x: v.x + n2x * tangent, y: v.y + n2y * tangent };
    let bx = n1x + n2x, by = n1y + n2y;
    const blen = Math.hypot(bx, by);
    if (blen < 1e-9) { out.push(v); continue; } // theta ~ 180 already guarded above; defensive only
    bx /= blen; by /= blen;
    const centreDist = actualRadius / Math.sin(half);
    const cx = v.x + bx * centreDist, cy = v.y + by * centreDist;
    const a1 = Math.atan2(t1.y - cy, t1.x - cx), a2 = Math.atan2(t2.y - cy, t2.x - cx);
    let delta = a2 - a1;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI; // the short way around -- always |delta| = PI-theta < PI
    out.push(t1);
    for (let k = 1; k < segments; k++) {
      const a = a1 + delta * (k / segments);
      out.push({ x: cx + Math.cos(a) * actualRadius, y: cy + Math.sin(a) * actualRadius });
    }
    out.push(t2);
  }
  return out;
}

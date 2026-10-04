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
  // H23 item 76: a vertex sitting (near-)EXACTLY on the clip line is both kept (curS>=-1e-9) AND
  // produces a crossing point at t~=0 immediately after it -- a harmless but real near-duplicate,
  // common whenever the caller's own polygon has a corner built FROM the same line (e.g. a mitred
  // piece next to the very joint it was clipped against). Dropping it here keeps this function's own
  // "clipping a simple polygon is always simple" guarantee meaningful for every caller, not just the
  // ones whose own geometry happens to avoid landing on the boundary.
  return dedupePolygon(out);
}

/** Drop consecutive (including wrap-around) near-duplicate vertices from a polygon. */
export function dedupePolygon(poly, eps = 1e-7) {
  const out = [];
  for (const p of poly) {
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > eps) out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= eps) out.pop();
  return out;
}

/** Whether `poly` is simple (no two non-adjacent edges cross) -- O(n^2), fine at the vertex counts
 *  a single cell/stone polygon actually has (a handful to a few dozen after rounding), not meant
 *  for a full board outline. H23 item 76 cont.: `offsetPathInward`'s own mitred-vertex offset has a
 *  documented P1 limitation (see its own header) -- a real edge SHORTER than the offset width can
 *  flip past itself and produce a bowtie. That edge only gets short enough to trigger it right at a
 *  board's TRUE (now exact, concave-aware) clip boundary, so a caller that offsets a freshly-clipped
 *  polygon should check this before trusting the result rather than ship a self-intersecting shape. */
export function isSimplePolygon(poly) {
  const n = poly.length;
  if (n < 4) return true;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const segmentsCross = (p1, p2, p3, p4) => {
    const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // adjacent edges share a vertex, not a crossing
      if (segmentsCross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return false;
    }
  }
  return true;
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

/** Proper (not-near-endpoint) intersection of open segments p1-p2 and p3-p4, or null. Near-endpoint
 *  / tangential touches (t or u within 1e-9 of 0 or 1) and parallel/collinear segments are reported
 *  as "no intersection" -- a deliberate simplification (real board/brick geometry here is never
 *  adversarially tangent; a genuine tangent touch contributes ~0 area either way). */
function segmentIntersection(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
  return { t, u, x: p1.x + t * d1x, y: p1.y + t * d1y };
}

/**
 * General polygon intersection (Greiner-Hormann): `subject` clipped to `clip`, where `clip` may be
 * CONCAVE (unlike `clipToHalfPlane`, which only clips correctly against one convex half-plane at a
 * time). Works for `subject` convex or concave too -- every real caller here happens to pass a
 * convex `subject` (a brick cell, a Voronoi stone), but nothing below assumes that.
 *
 * H23 item 76 cont. (advisor review, "concave clipping for the Wall... fill to the frame's true
 * inner edge at the waist, gap ~= grout all round"): replaces an earlier triangulate-the-board-and-
 * keep-the-largest-piece approach, which MEASURED two separate failures on real template geometry
 * before this rewrite: (1) keeping only the single largest per-triangle piece silently discarded
 * OTHER real, non-overlapping coverage whenever a cell spanned more than one triangle of the SAME
 * contiguous region (common, not rare -- one real T1 waist cell split 0.0224+0.0346+0.0478 across 3
 * triangles, and only the 0.0478 survived); (2) even after merging those pieces back together by
 * cancelling shared triangulation-diagonal edges, a cell touching 3+ fan triangles at a single
 * shared apex vertex (common for fieldstone's larger, organic Voronoi cells) produced a genuinely
 * self-intersecting merged polygon, because more than one surviving edge could start at that one
 * vertex and the merge had no rule for picking the right one. Both failure modes are structural to
 * "triangulate the clip shape, clip against each piece, recombine" -- this function clips directly
 * against `clip`'s own real edges instead, which is the textbook-correct way to handle a concave
 * clip shape and has neither problem by construction.
 *
 * Standard algorithm: find every `subject`-edge / `clip`-edge crossing, splice each crossing into
 * both polygons' own vertex lists (so each list is now subject/clip's original vertices PLUS the
 * crossings, in order, with each crossing in one list linked to its twin -- the same point -- in
 * the other), tag each crossing on `subject`'s list "entry" (subject is heading INTO clip just
 * after this point) or "exit" by alternating a running inside/outside flag seeded from subject's
 * own first vertex, then trace: starting from each unvisited "entry" crossing, walk forward along
 * whichever list you're currently on, and every time the next node is itself a crossing, jump to
 * ITS twin (switching lists) before continuing forward -- this single mechanical rule is what
 * alternates you between subject's and clip's own boundary, and always closes back on the start
 * node for a well-formed simple input. Each closed walk is one loop of `subject & clip`; multiple
 * loops mean a genuinely disconnected intersection (a tight concave notch truly severing one cell
 * into two pieces) -- keep only the LARGEST, consistent with this module's existing "one polygon
 * per cell" contract (every caller -- bond.js, basketweave.js, fieldstone.js, herringbone.js --
 * already treats this function's own return as ONE polygon). No crossings at all means `subject` is
 * either entirely inside `clip` (returned as-is) or entirely outside (empty).
 */
export function polygonIntersection(subject, clip) {
  const n = subject.length, m = clip.length;
  if (n < 3 || m < 3) return [];
  const onSubject = subject.map(() => []);
  const onClip = clip.map(() => []);
  let anyHit = false;
  for (let i = 0; i < n; i++) {
    const a1 = subject[i], a2 = subject[(i + 1) % n];
    for (let j = 0; j < m; j++) {
      const b1 = clip[j], b2 = clip[(j + 1) % m];
      const hit = segmentIntersection(a1, a2, b1, b2);
      if (!hit) continue;
      anyHit = true;
      onSubject[i].push({ t: hit.t, x: hit.x, y: hit.y });
      onClip[j].push({ t: hit.u, x: hit.x, y: hit.y });
    }
  }
  if (!anyHit) {
    return pointInPolygon(subject[0].x, subject[0].y, clip) ? subject.slice() : [];
  }
  for (const list of onSubject) list.sort((p, q) => p.t - q.t);
  for (const list of onClip) list.sort((p, q) => p.t - q.t);

  const EPS = 1e-7;
  const keyOf = (p) => `${Math.round(p.x / EPS)}_${Math.round(p.y / EPS)}`;

  const nodesSubject = [];
  for (let i = 0; i < n; i++) {
    nodesSubject.push({ x: subject[i].x, y: subject[i].y, isect: false });
    for (const hit of onSubject[i]) nodesSubject.push({ x: hit.x, y: hit.y, isect: true });
  }
  const nodesClip = [];
  for (let j = 0; j < m; j++) {
    nodesClip.push({ x: clip[j].x, y: clip[j].y, isect: false });
    for (const hit of onClip[j]) nodesClip.push({ x: hit.x, y: hit.y, isect: true });
  }
  for (let i = 0; i < nodesSubject.length; i++) nodesSubject[i].next = nodesSubject[(i + 1) % nodesSubject.length];
  for (let j = 0; j < nodesClip.length; j++) nodesClip[j].next = nodesClip[(j + 1) % nodesClip.length];

  const clipByKey = new Map();
  for (const node of nodesClip) if (node.isect) {
    const k = keyOf(node);
    if (!clipByKey.has(k)) clipByKey.set(k, []);
    clipByKey.get(k).push(node);
  }
  for (const node of nodesSubject) {
    if (!node.isect) continue;
    const candidates = clipByKey.get(keyOf(node));
    const match = candidates && candidates.find((c) => !c.twin);
    if (match) { node.twin = match; match.twin = node; }
  }

  let inside = pointInPolygon(subject[0].x, subject[0].y, clip);
  for (const node of nodesSubject) {
    if (node.isect) { inside = !inside; node.entry = inside; }
  }

  const loops = [];
  const maxSteps = (nodesSubject.length + nodesClip.length) * 2 + 10;
  for (const startNode of nodesSubject) {
    if (!startNode.isect || !startNode.entry || startNode.visited) continue;
    const loop = [];
    let cur = startNode;
    let steps = 0;
    do {
      loop.push({ x: cur.x, y: cur.y });
      cur.visited = true;
      if (cur.isect && cur.twin) cur.twin.visited = true;
      let nxt = cur.next;
      cur = (nxt.isect && nxt.twin) ? nxt.twin : nxt;
      steps++;
      // the start point is reachable as EITHER `startNode` (subject's own copy) or its twin (the
      // same geometric point, reached back round via clip's list) -- the loop is closed either way;
      // checking object identity against `startNode` alone missed the twin case and walked most of
      // `clip`'s own remaining boundary before giving up (MEASURED on a real bond.js cell: a 44-vertex
      // result that was almost literally the whole board outline instead of a small clipped sliver).
    } while (cur !== startNode && cur !== startNode.twin && steps < maxSteps);
    if (loop.length >= 3) loops.push(loop);
  }
  if (!loops.length) return [];
  let best = loops[0], bestArea = Math.abs(signedArea(best));
  for (let i = 1; i < loops.length; i++) {
    const area = Math.abs(signedArea(loops[i]));
    if (area > bestArea) { best = loops[i]; bestArea = area; }
  }
  return best;
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
 *
 * H23 item 76 cont. (advisor review, "concave clipping for the Wall... fill to the frame's true
 * inner edge at the waist, gap ~= grout all round"): `boardOutline` concave (T1's own waist is the
 * declared test case) now goes through `polygonIntersection` -- an EXACT cut too, not the old
 * keep-whole-or-drop-whole fallback (which MEASURED 0.26-0.44in gaps between the Frame's own inner
 * edge and the Wall's own fill, de's own finding). See `polygonIntersection`'s own header for why
 * this is a direct polygon-vs-polygon clip rather than a triangulate-and-recombine approach.
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
  return polygonIntersection(poly, boardOutline);
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

/**
 * core/bricks/tip-fill.js — PORTABLE (see rng.js). T86 item 16f (B1, Fred's joint rule: every seam is a joint of its
 * declared width): where two bands' inner edges converge (T14's X, the necks of T16 / T11 / T18 / T19), the wall's
 * region ends in an acute TIP that no wall course fits -- the wall drops the under-size cells, the tip stays bare
 * (MEASURED: up to 8.6 joints wide, T14 7x9 1.5 in). A tip the wall leaves bare is the BAND's: its innermost row is laid
 * deeper there (contour-bands.js opts.tipZones) and split at the medial line like any neck. The band takes ONLY what the
 * wall leaves uncovered: the wall keeps every brick, and each one near the tip is a zone's blocker (grown by a joint) --
 * a first prototype dropped the wall's slivers in the zone and opened holes up to 17 joints (T10 1.25 in). Only tips at least
 * TIP_FILL_MIN_DEG wide: a narrower V would end each half in a needle (Fred: no short-grain sharp tips) -- it stays a
 * bare joint (advisor, 2026-10-07).
 */
import { polygonIntersection, signedArea, clipToHalfPlane, pointInPolygon, offsetPathInward, inwardSignFor } from './geometry.js';

/** The narrowest tip the band fills (degrees); each half then ends at >= half of it. */
export const TIP_FILL_MIN_DEG = 60;
/** A tip counts as bare when the wall covers less than this share of its zone. */
export const TIP_BARE_SHARE = 0.5;
const CHORD_IN = 0.06; // the corner angle is read over this much path each way (arcs are tessellated finely)
const MIN_ZONE_SQIN = 0.002;
const WALL_PIECE_SHARE = 0.5; // a wall piece this share of a whole brick is a course; a smaller one in a tip is a sliver

const area = (p) => (p && p.length >= 3 ? Math.abs(signedArea(p)) : 0);

/** The point `dist` along the closed path from vertex i, walking `step` (+1 / -1). */
function along(P, i, dist, step) {
  const n = P.length;
  let left = dist, k = i;
  for (let guard = 0; guard < n; guard++) {
    const j = (k + step + n) % n, seg = Math.hypot(P[j].x - P[k].x, P[j].y - P[k].y);
    if (seg >= left) { const t = left / seg; return { x: P[k].x + (P[j].x - P[k].x) * t, y: P[k].y + (P[j].y - P[k].y) * t }; }
    left -= seg; k = j;
  }
  return P[k];
}

/** The region's width across the line perpendicular to `dir` through `p` (the chord through p). */
function widthAcross(P, p, dir) {
  const nx = -dir.y, ny = dir.x, hits = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    const da = (a.x - p.x) * dir.x + (a.y - p.y) * dir.y, db = (b.x - p.x) * dir.x + (b.y - p.y) * dir.y;
    if ((da > 0) === (db > 0) || da === db) continue;
    const t = da / (da - db), x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    hits.push((x - p.x) * nx + (y - p.y) * ny);
  }
  if (hits.length < 2) return 0;
  const below = hits.filter((h) => h <= 0), above = hits.filter((h) => h >= 0);
  if (!below.length || !above.length) return 0;
  return Math.min(...above) - Math.max(...below);
}

/** A region whose lobes touch (T14 at 1.5 in: the two halves joined by a zero-width slit along the centre line) split at
 *  its repeated vertices into simple lobes; a zero-area piece (the slit itself) is dropped. */
function lobesOf(P) {
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    if (Math.hypot(P[i].x - P[j].x, P[i].y - P[j].y) > 1e-7) continue;
    const a = P.slice(i, j), b = [...P.slice(j), ...P.slice(0, i)];
    return [...lobesOf(a), ...lobesOf(b)];
  }
  return P.length >= 3 && area(P) > MIN_ZONE_SQIN ? [P] : [];
}

/**
 * The region's convex corners at least TIP_FILL_MIN_DEG wide whose zone -- from the apex to where the region is one course
 * plus a joint wide -- the wall leaves bare. Each: { apex, dir (into the region), depthIn, angleDeg, polygon }.
 * @param {{x:number,y:number}[]} region the wall's region (generateBricks interiorOutline)
 * @param {Array} wallBricks the wall as laid
 * @param {object} set the (scaled) set the wall was laid with
 */
export function bareTips(region, wallBricks, set) {
  if (!region || region.length < 3) return [];
  return lobesOf(region).flatMap((lobe) => lobeTips(lobe, wallBricks, set));
}

function lobeTips(P, wallBricks, set) {
  const n = P.length, J = set.grout.widthIn, course = set.brickHeightIn + J;
  const orient = Math.sign(signedArea(P)) || 1;
  const cand = [];
  for (let i = 0; i < n; i++) {
    const a = along(P, i, CHORD_IN, -1), c = along(P, i, CHORD_IN, 1), b = P[i];
    const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
    const l1 = Math.hypot(v1.x, v1.y), l2 = Math.hypot(v2.x, v2.y);
    if (l1 < 1e-9 || l2 < 1e-9) continue;
    const ang = (Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (l1 * l2)))) * 180) / Math.PI;
    const convex = Math.sign(v1.x * v2.y - v1.y * v2.x) === orient; // the region turns toward its inside here
    if (convex && ang < 150) cand.push({ i, ang, dir: { x: (v1.x / l1 + v2.x / l2), y: (v1.y / l1 + v2.y / l2) } });
  }
  // one apex per corner: the sharpest vertex of each run of neighbouring candidates
  const tips = [];
  for (const c of cand.sort((p, q) => p.ang - q.ang)) {
    if (tips.some((t) => Math.hypot(P[t.i].x - P[c.i].x, P[t.i].y - P[c.i].y) < 2 * CHORD_IN)) continue;
    tips.push(c);
  }
  const out = [];
  for (const t of tips) {
    if (t.ang < TIP_FILL_MIN_DEG) continue;
    const V = P[t.i], dl = Math.hypot(t.dir.x, t.dir.y);
    if (dl < 1e-9) continue;
    const dir = { x: t.dir.x / dl, y: t.dir.y / dl };
    let depthIn = 0;
    for (let h = J / 2; h < 4 * course; h += J / 4) { if (widthAcross(P, { x: V.x + dir.x * h, y: V.y + dir.y * h }, dir) >= course) { depthIn = h; break; } }
    if (!(depthIn > 0)) continue;
    // the zone reaches down to the wall itself: its first real course (pieces of at least WALL_PIECE_SHARE of a brick) across
    // the tip, less a joint -- the wall's courses sit on their own grid, so a course-width base alone left a strip
    const halfSpan = widthAcross(P, { x: V.x + dir.x * depthIn, y: V.y + dir.y * depthIn }, dir) / 2 + J;
    const nx = -dir.y, ny = dir.x, real = WALL_PIECE_SHARE * set.brickLengthIn * set.brickHeightIn;
    let front = Infinity;
    const slabSide = (k) => ({ point: { x: V.x + nx * k * halfSpan, y: V.y + ny * k * halfSpan }, dirX: dir.x, dirY: dir.y });
    for (const w of wallBricks) {
      if (area(w.polygon) < real) continue;
      // the part of the brick across the tip's span (a course's corners can lie outside it while its edge crosses it)
      const inSlab = clipToHalfPlane(clipToHalfPlane(w.polygon, slabSide(1), V), slabSide(-1), V);
      for (const p of inSlab) {
        const along = (p.x - V.x) * dir.x + (p.y - V.y) * dir.y;
        if (along > 0) front = Math.min(front, along);
      }
    }
    if (Number.isFinite(front) && front - J > depthIn && front < 4 * course) depthIn = front - J;
    // the zone: the region on the apex side of the base line, kept near the apex (a far part of the region is not it)
    const base = { point: { x: V.x + dir.x * depthIn, y: V.y + dir.y * depthIn }, dirX: -dir.y, dirY: dir.x };
    const near = clipToHalfPlane(P, base, V);
    const r = 2 * depthIn / Math.max(Math.sin((t.ang * Math.PI) / 360), 0.2);
    const box = [{ x: V.x - r, y: V.y - r }, { x: V.x + r, y: V.y - r }, { x: V.x + r, y: V.y + r }, { x: V.x - r, y: V.y + r }];
    const zone = polygonIntersection(near, box);
    const zoneArea = area(zone);
    if (zoneArea < MIN_ZONE_SQIN || !pointInPolygon(V.x + dir.x * depthIn * 0.5, V.y + dir.y * depthIn * 0.5, P)) continue;
    let covered = 0;
    for (const w of wallBricks) covered += area(polygonIntersection(w.polygon, zone));
    if (covered / zoneArea >= TIP_BARE_SHARE) continue;
    // T86 item 16f: the band takes ONLY what the wall leaves uncovered -- the wall keeps every brick, and each one near the
    // tip is a blocker grown by a joint (the extension is cut by them: band + wall = one joint)
    const blockers = wallBricks.filter((w) => w.polygon.some((p) => Math.hypot(p.x - V.x, p.y - V.y) < r + set.brickLengthIn))
      .map((w) => offsetPathInward(w.polygon, J, -inwardSignFor(w.polygon)));
    out.push({ apex: V, dir, depthIn, angleDeg: t.ang, polygon: zone, blockers });
  }
  return out;
}

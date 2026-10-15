/**
 * core/bricks/height-records.js -- PORTABLE (see rng.js). Fred 2026-10-11 (the Raised brush retired; advisor's plan approved
 * with his answers): a brick's own HEIGHT is set on selected bricks and stored as a declared record, never a brick id (ids
 * are build-order counters: every re-lay renumbers them). P.brickSettings.heights = [{ id, level, pick, points | region }]:
 *  - pick 'points' (a tap): each point picks the brick containing it -- on a size change, the brick under each point
 *    (Fred's answer 1; the accents' "Click bricks" rule, brick-accents.js);
 *  - pick 'region' (a box): the WHOLE bricks whose centroid lies in the region, on every lay (Fred's answer 2; the wall
 *    areas' rule, region.js WALL_REGION_PICK 'centroid').
 * A brick picked by several records takes the LATEST record's level (the last one set wins). `level` is in inches, + proud /
 * - recessed, added to the brick's own offset like an element's Level (editor-brick-height-mask.js).
 */
import { pointInPolygon, polygonCentroid } from './geometry.js';

export const HEIGHT_PICKS = Object.freeze(['points', 'region']);

/** The indices of `bricks` (each { polygon }) one record picks. */
export function bricksPickedBy(record, bricks) {
  if (!record) return [];
  if (record.pick === 'region') {
    const region = record.region;
    if (!Array.isArray(region) || region.length < 3) return [];
    return bricks.map((b, k) => [b, k]).filter(([b]) => { const c = polygonCentroid(b.polygon); return pointInPolygon(c.x, c.y, region); }).map(([, k]) => k);
  }
  const picked = new Set();
  for (const pt of record.points || []) {
    const k = bricks.findIndex((b) => pointInPolygon(pt.x, pt.y, b.polygon));
    if (k >= 0) picked.add(k);
  }
  return [...picked];
}

/** brick index -> level, every record applied in order (the latest one wins). */
export function heightLevelsFor(records, bricks) {
  const levels = new Map();
  for (const r of records || []) {
    const level = Number(r && r.level);
    if (!Number.isFinite(level)) continue;
    for (const k of bricksPickedBy(r, bricks)) levels.set(k, level);
  }
  return levels;
}

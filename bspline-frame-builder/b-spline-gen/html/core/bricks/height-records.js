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

/* ---- the Select UI's side (Fred 2026-10-11: "Select raises / lowers the selected bricks"): a PICK is the not-yet-applied
 * selection, in the records' own shapes ({ pick: 'points', points } | { pick: 'region', region }); Raise / Lower / Set
 * turn it into records, Reset takes it back to zero. Pure: the panel hands in the bricks of this lay. ---- */

/** The default Raise / Lower step, inches (the Accent level's own default, 1/16). */
export const HEIGHT_STEP_IN = 0.0625;
const roundLevel = (v) => Math.round(v * 10000) / 10000;

/** The indices of `bricks` the picks (an array of { pick, points | region }) hold together. */
export function pickedIndices(picks, bricks) {
  const all = new Set();
  for (const p of picks || []) for (const k of bricksPickedBy(p, bricks)) all.add(k);
  return all;
}

/** A tap at `pt`: picks the brick under it, or UNpicks it when already picked. A brick held by a box (region) pick is
 *  unpicked by turning that box into the points of its other bricks (a box cannot lose one brick otherwise). */
export function togglePick(picks, pt, bricks) {
  const k = bricks.findIndex((b) => pointInPolygon(pt.x, pt.y, b.polygon));
  if (k < 0) return picks || [];
  const out = [];
  let held = false;
  for (const p of picks || []) {
    const mine = bricksPickedBy(p, bricks);
    if (!mine.includes(k)) { out.push(p); continue; }
    held = true;
    const rest = p.pick === 'region'
      ? mine.filter((j) => j !== k).map((j) => polygonCentroid(bricks[j].polygon))
      : (p.points || []).filter((q) => !pointInPolygon(q.x, q.y, bricks[k].polygon));
    if (rest.length) out.push({ pick: 'points', points: rest });
  }
  if (!held) {
    // a tap joins the points pick already there, so one Raise writes ONE record for the bricks tapped
    const at = out.findIndex((p) => p.pick !== 'region');
    if (at >= 0) out[at] = { ...out[at], points: [...out[at].points, { x: pt.x, y: pt.y }] };
    else out.push({ pick: 'points', points: [{ x: pt.x, y: pt.y }] });
  }
  return out;
}

/** The level the picked bricks share now (the records applied), or null when they differ (mixed) / nothing is picked. */
export function sharedLevel(records, picks, bricks) {
  const idx = pickedIndices(picks, bricks);
  if (!idx.size) return null;
  const levels = heightLevelsFor(records, bricks);
  let shared;
  for (const k of idx) {
    const v = levels.get(k) || 0;
    if (shared === undefined) shared = v; else if (shared !== v) return null;
  }
  return shared;
}

/** `records` + one record per pick at `level` (the latest wins). `newId` makes the record ids. */
export function setPickedLevel(records, picks, level, newId) {
  const lv = roundLevel(level);
  return [...(records || []), ...(picks || []).map((p) => ({ id: newId(), level: lv, ...(p.pick === 'region' ? { pick: 'region', region: p.region.map((q) => ({ x: q.x, y: q.y })) } : { pick: 'points', points: p.points.map((q) => ({ x: q.x, y: q.y })) }) }))];
}

/** Raise (+) / Lower (-) the picked bricks by `step` from the level they share (mixed ones start from 0). */
export function stepPickedLevel(records, picks, step, bricks, newId) {
  const base = sharedLevel(records, picks, bricks) || 0;
  return setPickedLevel(records, picks, base + step, newId);
}

/** Reset the picked bricks to no height: a zero record over them, then every zero record no earlier record needs is dropped. */
export function resetPicked(records, picks, bricks, newId) {
  const next = setPickedLevel(records, picks, 0, newId);
  const out = [];
  next.forEach((r, i) => {
    if (r.level === 0) {
      const mine = bricksPickedBy(r, bricks);
      const earlier = next.slice(0, i).some((e) => e.level !== 0 && bricksPickedBy(e, bricks).some((k) => mine.includes(k)));
      if (!earlier) return;
    }
    out.push(r);
  });
  return out;
}

/** How many bricks of this lay carry a height (a level other than 0). */
export function heightedCount(records, bricks) {
  let n = 0;
  for (const v of heightLevelsFor(records, bricks).values()) if (v !== 0) n++;
  return n;
}

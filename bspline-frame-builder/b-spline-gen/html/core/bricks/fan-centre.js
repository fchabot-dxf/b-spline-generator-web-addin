/**
 * core/bricks/fan-centre.js — PORTABLE (see rng.js). T86 item 16e (Fred on the fan mock: "I like them all, add a
 * choice"): how a frame corner's FAN ends at its centre. A fan's slices converge on one apex, each ending in a needle
 * (Fred's short grain) with a mortar spot where they meet. The choice is declared once here (FAN_CENTRES) and read by
 * generateBricks' `fanCentre` input; the default (needle) is no call at all, so a saved board lays byte-identical.
 */
import { clipToHalfPlane, polygonDifference, polygonIntersection, offsetPathInward, inwardSignFor, signedArea, isSimplePolygon, pointInPolygon } from './geometry.js';

/** The fan centre styles, in picker order. `cut`: each slice is cut square where it first reaches MIN_TIP_WIDTH (one
 *  radius per fan, below), leaving a round mortar EYE; `stone`: the eye holds a centre stone, a joint off everything. */
export const FAN_CENTRES = Object.freeze([
  Object.freeze({ id: 'needle', label: 'Needle', title: 'Needle: the fan slices run to a point at the centre', cut: false, stone: false }),
  Object.freeze({ id: 'eye', label: 'Eye', title: 'Eye: each slice is cut square, leaving a round mortar eye', cut: true, stone: false }),
  Object.freeze({ id: 'stone', label: 'Stone', title: 'Stone: the eye holds a round centre stone', cut: true, stone: true }),
]);
export const FAN_CENTRE_DEFAULT = 'needle';
/** A cut slice's square end is at least this share of the frame's brick height wide (MIN_TIP_WIDTH). */
export const FAN_MIN_TIP_OF_HEIGHT = 1 / 3;
/** The radius is searched in steps of this (in); the stone's circle has this many sides. */
const RADIUS_STEP_IN = 0.002;
const STONE_SIDES = 48;

export const fanCentreStyle = (id) => FAN_CENTRES.find((s) => s.id === id) || FAN_CENTRES[0];

const areaOf = (p) => (p && p.length >= 3 ? Math.abs(signedArea(p)) : 0);
const centroidOf = (P) => P.reduce((m, p) => ({ x: m.x + p.x / P.length, y: m.y + p.y / P.length }), { x: 0, y: 0 });

/** The frame's fans: its slices grouped by the apex each declares (primitive-ribbon.js `fanApex`, the corner's q). */
export function fanGroups(bricks) {
  const byApex = new Map();
  bricks.forEach((b, i) => {
    if (!b.fan || !b.fanApex) return;
    const key = `${b.fanApex.x.toFixed(9)},${b.fanApex.y.toFixed(9)}`;
    if (!byApex.has(key)) byApex.set(key, { apex: b.fanApex, slices: [] });
    byApex.get(key).slices.push(i);
  });
  return [...byApex.values()];
}

/** The slice's width across its own axis at distance r from the apex. */
function widthAt(P, q, u, r) {
  const nx = -u.y, ny = u.x, base = { x: q.x + u.x * r, y: q.y + u.y * r }, hits = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    const da = (a.x - base.x) * u.x + (a.y - base.y) * u.y, db = (b.x - base.x) * u.x + (b.y - base.y) * u.y;
    if ((da > 0) === (db > 0) || da === db) continue;
    const t = da / (da - db);
    hits.push((a.x + (b.x - a.x) * t - base.x) * nx + (a.y + (b.y - a.y) * t - base.y) * ny);
  }
  return hits.length >= 2 ? Math.max(...hits) - Math.min(...hits) : 0;
}

/**
 * The frame laid with `style`'s fan centre. Each fan: its slices cut square to their own axis at ONE radius R -- where
 * the median slice first reaches MIN_TIP_WIDTH (FAN_MIN_TIP_OF_HEIGHT x the brick height); a stone (style.stone) is a
 * circle of R - one joint round the apex, cut a joint off every other piece and off the wall's region (round where it
 * meets nothing). A stone the polygon booleans cannot make cleanly is left out (the eye stays).
 * @param {Array} bricks the frame as laid
 * @param {string} styleId FAN_CENTRES id
 * @param {{ set: object, region?: Array }} opts the SCALED frame set; the wall's region (its fill outline)
 * @returns {Array} the frame (a NEW array; needle = the same array)
 */
export function applyFanCentre(bricks, styleId, opts) {
  const style = fanCentreStyle(styleId);
  if (!style.cut) return bricks;
  const { set, region } = opts;
  const J = set.grout.widthIn, minW = FAN_MIN_TIP_OF_HEIGHT * set.brickHeightIn;
  const out = bricks.map((b) => ({ ...b })), stones = [];
  const groups = fanGroups(bricks);
  for (const g of groups) {
    const axes = g.slices.map((i) => { const c = centroidOf(out[i].polygon), l = Math.hypot(c.x - g.apex.x, c.y - g.apex.y) || 1; return { x: (c.x - g.apex.x) / l, y: (c.y - g.apex.y) / l }; });
    const reach = g.slices.map((i, k) => { const P = out[i].polygon; let r = 0; const far = Math.max(...P.map((p) => Math.hypot(p.x - g.apex.x, p.y - g.apex.y))); for (; r < far; r += RADIUS_STEP_IN) if (widthAt(P, g.apex, axes[k], r) >= minW) break; return r; }).sort((a, b) => a - b);
    const R = reach[Math.floor(reach.length / 2)];
    g.slices.forEach((i, k) => {
      const u = axes[k];
      out[i].polygon = clipToHalfPlane(out[i].polygon, { point: { x: g.apex.x + u.x * R, y: g.apex.y + u.y * R }, dirX: -u.y, dirY: u.x }, { x: g.apex.x + u.x * (R + 1), y: g.apex.y + u.y * (R + 1) });
    });
    const stone = style.stone ? centreStone(g, R, axes, out, region, J) : null;
    if (stone) { const { fan, ...like } = bricks[g.slices[0]]; stones.push({ ...like, id: `frame-centre-${stones.length}`, polygon: stone, fanCentre: true }); }
  }
  return [...out.filter((b) => areaOf(b.polygon) > 1e-6), ...stones];
}

/** The centre stone: a circle of R - J round the apex, minus every piece near it and the wall's region, each grown by a
 *  joint. A cut that splits it keeps the part on the FAN's side (nearest the point half way to R along the slices' mean
 *  direction -- the largest part can be the wall's side). Kept only as one simple polygon no larger than the circle
 *  (polygon booleans can fail: geometry.js). */
function centreStone(g, R, axes, pieces, region, J) {
  const r = R - J;
  if (!(r > J)) return null;
  let stone = Array.from({ length: STONE_SIDES }, (_, k) => ({ x: g.apex.x + r * Math.cos((2 * Math.PI * k) / STONE_SIDES), y: g.apex.y + r * Math.sin((2 * Math.PI * k) / STONE_SIDES) }));
  const circle = areaOf(stone);
  const near = pieces.filter((b) => areaOf(b.polygon) > 1e-6 && b.polygon.some((p) => Math.hypot(p.x - g.apex.x, p.y - g.apex.y) < R + 2));
  const cutters = [];
  // the wall's region near the apex only (the whole outline, grown, is too much for the polygon booleans: measured T1)
  const box = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => ({ x: g.apex.x + sx * (R + 4 * J), y: g.apex.y + sx * sy * (R + 4 * J) })));
  const local = region && region.length >= 3 ? polygonIntersection(region, box) : [];
  if (areaOf(local) > 1e-6) cutters.push(offsetPathInward(local, J / 2, -inwardSignFor(local)));
  cutters.push(...near.map((b) => offsetPathInward(b.polygon, J, -inwardSignFor(b.polygon))));
  const m = axes.reduce((a, u) => ({ x: a.x + u.x, y: a.y + u.y }), { x: 0, y: 0 }), ml = Math.hypot(m.x, m.y) || 1;
  const ref = { x: g.apex.x + (m.x / ml) * (R / 2), y: g.apex.y + (m.y / ml) * (R / 2) };
  const distToRef = (P) => (pointInPolygon(ref.x, ref.y, P) ? 0 : Math.min(...P.map((p) => Math.hypot(p.x - ref.x, p.y - ref.y))));
  for (const c of cutters) {
    if (!areaOf(polygonIntersection(stone, c))) continue;
    const parts = polygonDifference(stone, c).filter((p) => areaOf(p) > 1e-6);
    if (!parts.length) return null;
    const next = parts.reduce((a, p) => (distToRef(p) < distToRef(a) ? p : a));
    if (areaOf(next) > areaOf(stone) + 1e-6) return null; // a failed boolean
    stone = next;
  }
  return stone.length >= 3 && isSimplePolygon(stone) && areaOf(stone) <= circle + 1e-6 && areaOf(stone) > 1e-4 ? stone : null;
}

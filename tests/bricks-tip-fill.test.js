/**
 * T86 item 16f (B1): the wall region's tips at least TIP_FILL_MIN_DEG wide that the wall leaves bare are the band's -- the
 * innermost row is laid deeper into what the wall leaves uncovered, a joint off every wall brick; the wall is untouched.
 * Measured on 7x9 boards, single soldier, seed 1 (bare = board > 0.75 joint from every piece, 0.01 in grid).
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { BRICK_SETS, FRAME_PRESETS, scaledSet } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { bareTips, TIP_FILL_MIN_DEG } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/tip-fill.js';
import { pointInPolygon } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';

const SET = BRICK_SETS[0], J = SET.grout.widthIn;
const BOARD = [{ x: 0, y: 0 }, { x: 7, y: 0 }, { x: 7, y: 9 }, { x: 0, y: 9 }];

function lay(tpl, L) {
  const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: 7, heightIn: 9 } }, 0, 0);
  const prims = buildRibbonPrimitives(sil.primitives), scale = L / SET.brickLengthIn;
  const r = generateBricks({ boardOutline: BOARD, set: SET, seed: 1, scale, suppression: 0, clumping: 0, frame: { primitives: prims, bands: FRAME_PRESETS.single_soldier } });
  // the frame as main lays it (no tip zones): the "before"
  const before = bricksContourBands(prims, FRAME_PRESETS.single_soldier, { set: SET, seed: 1, scale }).bricks;
  return { r, before, tips: bareTips(r.interiorOutline, r.bricks, scaledSet(SET, scale)) };
}
const segDist = (p, a, b) => {
  const ex = b.x - a.x, ey = b.y - a.y, l = ex * ex + ey * ey || 1e-12, t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l));
  return Math.hypot(a.x + t * ex - p.x, a.y + t * ey - p.y);
};
const distToPoly = (p, P) => (pointInPolygon(p.x, p.y, P) ? 0 : Math.min(...P.map((a, i) => segDist(p, a, P[(i + 1) % P.length]))));
/** two polygons' closest approach (0 when they overlap) */
const gap = (A, B) => Math.min(...A.map((p) => distToPoly(p, B)), ...B.map((p) => distToPoly(p, A)));
/** bare board inside the zone (sq in) */
function bareIn(zone, pieces) {
  const xs = zone.map((p) => p.x), ys = zone.map((p) => p.y), h = 0.01, near = pieces.filter((b) => b.polygon.some((p) => Math.hypot(p.x - xs[0], p.y - ys[0]) < 3));
  let n = 0;
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += h) for (let y = Math.min(...ys); y <= Math.max(...ys); y += h) {
    if (!pointInPolygon(x, y, zone)) continue;
    if (near.every((b) => distToPoly({ x, y }, b.polygon) > 0.75 * J)) n++;
  }
  return n * h * h;
}
/** the part of a polygon no disc of diameter `w` inside it reaches (sq in, 0.01 in grid), less what a pointed corner of
 *  at least half TIP_FILL_MIN_DEG explains (a mitre's / a tip half's declared point): a thin tongue's area */
function narrowArea(P, w) {
  const xs = P.map((p) => p.x), ys = P.map((p) => p.y), h = 0.01, pts = [];
  for (let x = Math.min(...xs) + h / 2; x < Math.max(...xs); x += h) for (let y = Math.min(...ys) + h / 2; y < Math.max(...ys); y += h) {
    if (pointInPolygon(x, y, P)) pts.push({ x, y, r: Math.min(...P.map((a, i) => segDist({ x, y }, a, P[(i + 1) % P.length]))) });
  }
  const centres = pts.filter((c) => c.r >= w / 2), n = P.length, sgn = Math.sign(P.reduce((a, p, i) => a + p.x * P[(i + 1) % n].y - P[(i + 1) % n].x * p.y, 0));
  const corners = P.map((b, i) => {
    const a = P[(i - 1 + n) % n], c = P[(i + 1) % n], v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
    const l = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
    const th = l > 1e-12 ? Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / l))) : Math.PI;
    const convex = Math.sign(v2.x * v1.y - v2.y * v1.x) === sgn;
    return convex && (th * 180) / Math.PI >= TIP_FILL_MIN_DEG / 2 ? { b, reach: w / 2 / Math.sin(th / 2) + h } : null;
  }).filter(Boolean);
  return pts.filter((p) => !centres.some((c) => Math.hypot(p.x - c.x, p.y - c.y) <= c.r)
    && !corners.some((k) => Math.hypot(p.x - k.b.x, p.y - k.b.y) <= k.reach)).length * h * h;
}
const key = (b) => JSON.stringify(b.polygon.map((p) => [+p.x.toFixed(5), +p.y.toFixed(5)]));

describe('T86 16f: the band fills the bare tips it can', () => {
  // [template, size, the filled tip's bare area today (sq in, measured on main), the most it may keep after]; T14 1.5 keeps
  // 0.022: the side whose extension would wrap the wall's sliver is not extended (advisor (c), 2026-10-07)
  const FILLED = [['template_14', 1.5, 0.068, 0.025], ['template_14', 1.25, 0.063, 0.005], ['template_18', 1.25, 0.018, 0.005], ['template_19', 1.25, 0.017, 0.005]];
  it.each(FILLED)('%s at %s in: the tip is filled, a joint off every piece, the wall untouched', (tpl, L, today, cap) => {
    const { r, before, tips } = lay(tpl, L);
    const tip = tips.find((t) => Math.abs(t.apex.x - 3.5) < 0.01);
    expect(tip).toBeTruthy();
    const all = [...r.frameBricks, ...r.bricks];
    if (process.env.MEASURE_TIPS) console.log(tpl, L, 'bare before', bareIn(tip.polygon, [...before, ...r.bricks]).toFixed(4), 'after', bareIn(tip.polygon, all).toFixed(4));
    expect(bareIn(tip.polygon, [...before, ...r.bricks])).toBeGreaterThan(today * 0.8); // the "before" is what main lays
    expect(bareIn(tip.polygon, all)).toBeLessThanOrEqual(cap);
    // every changed piece keeps (almost) a joint from every other piece, band or wall
    const old = new Set(before.map(key)), changed = r.frameBricks.filter((b) => !old.has(key(b)));
    expect(changed.length).toBeGreaterThan(0);
    // (or no closer than its own twin on main already was: a band's arc edge sits a chord's sag off the wall's polygonal outline)
    const twin = new Map(before.map((b) => [b.id, b]));
    for (const c of changed) {
      expect(twin.has(c.id)).toBe(true);
      for (const o of all) {
        if (o === c || !o.polygon.some((p) => Math.hypot(p.x - c.polygon[0].x, p.y - c.polygon[0].y) < 3)) continue;
        const g = gap(c.polygon, o.polygon);
        if (g <= 0.9 * J) expect(g).toBeGreaterThanOrEqual(gap(twin.get(c.id).polygon, o.polygon) - 0.001); // 0.001 in: the depth clip re-refines the arc edge (T19 1.25: 0.0005)
      }
    }
  });

  // advisor 2026-10-07 (the T14 1.5 in tongue round a wall sliver = Fred's short grain): an extended piece adds no part
  // narrower than a third of a brick height to what its own twin on main already had (a mitre's point is narrow too)
  it.each([['template_14', 1.5], ['template_14', 1.25], ['template_18', 1.25], ['template_19', 1.25], ['template_1', 0.75], ['template_9', 0.75]])('%s at %s in: no extended piece grows a part narrower than 1/3 brick height', (tpl, L) => {
    const { r, before } = lay(tpl, L);
    const w = (SET.brickHeightIn * L) / SET.brickLengthIn / 3, twin = new Map(before.map((b) => [b.id, b])), old = new Set(before.map(key));
    for (const c of r.frameBricks.filter((b) => !old.has(key(b)))) {
      const grown = narrowArea(c.polygon, w) - narrowArea(twin.get(c.id).polygon, w);
      if (process.env.MEASURE_TIPS) console.log('NARROW', tpl, L, c.id, grown.toFixed(4));
      expect(grown).toBeLessThanOrEqual(0.0005);
    }
  });

  it('the wall keeps every brick (no wall drops): T14 1.5 in keeps its tip sliver', () => {
    const { r, tips } = lay('template_14', 1.5);
    const tip = tips.find((t) => Math.abs(t.apex.x - 3.5) < 0.01);
    expect(r.bricks.some((b) => b.polygon.some((p) => pointInPolygon(p.x, p.y, tip.polygon)))).toBe(true);
  });

  it('a lay with no bare tip is byte-identical to the frame laid without tip zones', () => {
    const { r, before, tips } = lay('template_2', 1);
    expect(tips).toEqual([]);
    expect(r.frameBricks).toEqual(before);
  });
});

describe('T86 16f: bareTips reads only tips at least TIP_FILL_MIN_DEG wide', () => {
  const set = scaledSet(SET, 1);
  // an isosceles triangle with the apex angle `deg` at the top (0, 0) pointing up (y down = into the region), no wall
  const tri = (deg) => { const h = 3, w = h * Math.tan((deg * Math.PI) / 360); return [{ x: 0, y: 0 }, { x: w, y: h }, { x: -w, y: h }]; };
  it('declares 60 degrees', () => expect(TIP_FILL_MIN_DEG).toBe(60));
  it.each([[40, 0], [55, 0], [65, 1], [90, 1]])('a bare %s degree tip -> %s zone at the apex', (deg, n) => {
    const at = bareTips(tri(deg), [], set).filter((t) => Math.hypot(t.apex.x, t.apex.y) < 1e-6);
    expect(at.length).toBe(n);
  });
});

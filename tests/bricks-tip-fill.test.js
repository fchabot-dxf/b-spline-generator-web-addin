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
const key = (b) => JSON.stringify(b.polygon.map((p) => [+p.x.toFixed(5), +p.y.toFixed(5)]));

describe('T86 16f: the band fills the bare tips it can', () => {
  // [template, size, the filled tip's bare area today (sq in, measured on main), the most it may keep after]
  const FILLED = [['template_14', 1.5, 0.068, 0.005], ['template_14', 1.25, 0.063, 0.005], ['template_18', 1.25, 0.018, 0.005], ['template_19', 1.25, 0.017, 0.005]];
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

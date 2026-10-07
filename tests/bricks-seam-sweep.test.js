/**
 * T86 item 16d (Fred's joint rule: every seam is a real grout joint of its declared width). Swept over every template x
 * 0.75 / 1 / 1.25 / 1.5 in, 7x9, a single soldier band (76 lays):
 *  - FAN-TO-RUN SEAMS (pinned): where a corner's fan slice (contour-bands `fan: true`) faces a run's piece, the gap
 *    along the facing stretch (its median: the seam itself, not the corner's meeting point at its end) is at most
 *    FAN_SEAM_MAX_J joints. Before 16d (A) the fan was laid from the run's unmoved end: 3 joints at T18's base, 1.25 in.
 *  - EVERY OTHER GAP (capped at today's values, so none can grow): a gap point is board ground more than 0.75 J from
 *    every piece (a gap wider than 1.5 joints). Grouped by what borders its widest point: a SEAM (two pieces) or a NODE
 *    (three or more: joints meeting -- a fan's apex, an X), and fan / band / wall. Known open items: the fan's apex
 *    spots (16e), the wall-region tips (16f).
 * RUNS: the default suite sweeps a fixed representative subset (FAST_SET: T1, T14, T16, T18 at 1 and 1.5 in -- a fan corner,
 * the X, a neck, the base strips) with the same assertions, inside the gate's budget. The full 19 x 4 sweep (~12 min under
 * load) runs with SEAM_SWEEP_FULL=1:   SEAM_SWEEP_FULL=1 npx vitest run tests/bricks-seam-sweep.test.js
 * MEASURE_SEAMS=1 prints the per-class values instead of asserting them (to re-cap after a deliberate change).
 */
import { describe, it, expect, vi } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { pointInPolygon } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { BRICK_SETS, FRAME_PRESETS, scaledSet } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

vi.setConfig({ testTimeout: 300000 }); // 4 lays + a fine gap grid per template: minutes under the fleet's load

const SET = BRICK_SETS[0];
const W = 7, H = 9, GRID_IN = 0.02;
const FULL = !!process.env.SEAM_SWEEP_FULL;
/** the default run's representative subset (the full sweep: SEAM_SWEEP_FULL=1) */
const FAST_SET = { templates: ['template_1', 'template_14', 'template_16', 'template_18'], sizes: [1, 1.5] };
const SIZES = FULL ? [0.75, 1, 1.25, 1.5] : FAST_SET.sizes;
const TEMPLATES = FULL ? FRAME_DEFS.templates.map((t) => t.id).filter((k) => /^template_\d+$/.test(k)) : FAST_SET.templates;
const MEASURE = !!process.env.MEASURE_SEAMS;
/** Fred's joint rule, with the measurement's own tolerance */
const FAN_SEAM_MAX_J = 1.5;
/** today's other gaps per template (widest, in joints; total sq in), measured on 16d (A); T14 / T18 / T19 re-capped on 16f (B1: their tips filled) -- a cap, not a goal */
const CAPS = {
  template_1: {1: {'seam band': [2.6, 0.008], 'seam fan': [2.8, 0.0072], 'node wall': [1.8, 0.0012], 'seam wall': [1.8, 0.0004], 'node fan': [2.8, 0.0012]}, 0.75: {'seam band': [2.3, 0.0072], 'node fan': [2.5, 0.0008], 'seam fan': [2.7, 0.0052]}, 1.25: {'seam fan': [2.6, 0.0072], 'seam band': [2.8, 0.0072], 'node fan': [2.5, 0.0004]}, 1.5: {'seam fan': [2.9, 0.0072], 'seam band': [2.9, 0.01]}},
  template_2: {1: {'node fan': [2.8, 0.0008], 'seam fan': [2.9, 0.0048], 'seam band': [3.1, 0.0048]}, 0.75: {'seam fan': [2.9, 0.0048], 'seam band': [3, 0.0052]}, 1.25: {'seam fan': [2.5, 0.0036], 'seam band': [2.3, 0.0024], 'node fan': [2.9, 0.0008]}, 1.5: {'seam fan': [2.6, 0.0044], 'seam band': [2.6, 0.0024]}},
  template_3: {1: {'seam band': [2.3, 0.0056], 'seam fan': [2.4, 0.004], 'seam wall': [1.8, 0.002], 'node fan': [2.9, 0.0012]}, 0.75: {'seam band': [2.5, 0.0044], 'seam fan': [2.2, 0.0032], 'node fan': [1.7, 0.0004]}, 1.25: {'seam fan': [2.4, 0.004], 'seam band': [2.8, 0.0076], 'node fan': [2.8, 0.0004]}, 1.5: {'seam fan': [2.4, 0.0032], 'seam band': [3, 0.0092]}},
  template_4: {1: {'seam fan': [2.2, 0.0068], 'seam band': [2.8, 0.0072], 'node fan': [2.9, 0.0016]}, 0.75: {'node fan': [2.6, 0.0008], 'seam band': [2.5, 0.0056], 'seam fan': [2.3, 0.0048], 'seam wall': [1.7, 0.0004]}, 1.25: {'seam fan': [2.6, 0.0068], 'seam band': [2.8, 0.0092], 'node fan': [2.8, 0.0008]}, 1.5: {'seam fan': [2.9, 0.0068], 'seam band': [3.1, 0.0108]}},
  template_5: {1: {'seam fan': [3.4, 0.0188], 'node fan': [3, 0.0016], 'seam band': [2.7, 0.0124]}, 0.75: {'seam band': [2.2, 0.0048], 'seam fan': [2.6, 0.0064]}, 1.25: {'seam fan': [3.7, 0.0232], 'node fan': [3.9, 0.0016], 'seam band': [3, 0.012], 'seam wall': [1.6, 0.0008]}, 1.5: {'seam fan': [3.1, 0.0072], 'node fan': [3.1, 0.002], 'seam band': [2.3, 0.0084]}},
  template_6: {1: {}, 0.75: {}, 1.25: {}, 1.5: {'seam wall': [1.6, 0.0012], 'node wall': [1.5, 0.0004]}},
  template_7: {1: {'seam band': [1.5, 0.0004]}, 0.75: {}, 1.25: {'seam band': [1.6, 0.0004]}, 1.5: {'seam fan': [4.6, 0.024], 'node fan': [3.4, 0.002], 'seam band': [2.3, 0.0016]}},
  template_8: {1: {'seam fan': [2.6, 0.004], 'seam band': [2.2, 0.0032], 'node fan': [2.8, 0.0004]}, 0.75: {'seam fan': [2.6, 0.004], 'seam band': [2.2, 0.0028]}, 1.25: {'seam fan': [3.6, 0.0136], 'seam band': [2.7, 0.0064], 'node fan': [3, 0.0012]}, 1.5: {'seam fan': [3.8, 0.018], 'seam band': [3.2, 0.0056], 'node fan': [4, 0.0008], 'seam wall': [1.6, 0.0004]}},
  template_9: {1: {}, 0.75: {'seam wall': [1.6, 0.0016]}, 1.25: {'seam wall': [1.6, 0.0008], 'node wall': [1.7, 0.0008]}, 1.5: {'seam band': [3, 0.2864]}},
  template_10: {1: {'node band': [1.7, 0.0004], 'seam band': [2.8, 0.0096], 'seam fan': [3.1, 0.0092]}, 0.75: {'seam band': [2.3, 0.0068], 'seam fan': [2.5, 0.0076], 'node fan': [3.3, 0.0016]}, 1.25: {'node band': [1.7, 0.0004], 'seam band': [2.4, 0.006], 'seam fan': [2.7, 0.0084], 'node fan': [3, 0.0008]}, 1.5: {'seam band': [2.7, 0.0076], 'seam fan': [3, 0.008], 'node fan': [2.6, 0.0008]}},
  template_11: {1: {'seam band': [2.4, 0.0036], 'seam fan': [3.1, 0.0052], 'node fan': [3.1, 0.0008]}, 0.75: {'seam band': [2.8, 0.0048], 'seam fan': [2.8, 0.0044], 'node fan': [3.2, 0.0012]}, 1.25: {'seam fan': [1.6, 0.0004]}, 1.5: {'seam band': [3.9, 0.018], 'seam fan': [2.5, 0.0028], 'seam wall': [4.2, 0.0048]}},
  template_12: {1: {'seam band': [2.4, 0.0076], 'seam fan': [2.8, 0.0076], 'node wall': [1.8, 0.0012], 'seam wall': [1.8, 0.0004], 'node fan': [2.8, 0.0012]}, 0.75: {'seam fan': [2.6, 0.006], 'seam band': [2.9, 0.0088], 'node fan': [3, 0.0008]}, 1.25: {'seam band': [2.6, 0.0076], 'seam fan': [2.6, 0.0072], 'node fan': [2.5, 0.0004]}, 1.5: {'seam fan': [2.7, 0.0076], 'seam band': [2.9, 0.0096]}},
  template_13: {1: {'seam fan': [2.9, 0.0048], 'seam band': [3.1, 0.0048], 'node fan': [2.8, 0.0004]}, 0.75: {'seam fan': [2.9, 0.0044], 'seam band': [3, 0.006]}, 1.25: {'seam band': [2.1, 0.0012], 'seam wall': [1.8, 0.0008], 'node fan': [2.6, 0.0004], 'seam fan': [2.6, 0.0032]}, 1.5: {'seam band': [2.2, 0.0036], 'seam fan': [2.5, 0.0032], 'node fan': [2.1, 0.0004]}},
  template_14: {1: {'seam wall': [1.6, 0.0004]}, 0.75: {'seam wall': [1.6, 0.0008]}, 1.25: {}, 1.5: {'seam band': [3.9, 0.0116], 'seam wall': [4.8, 0.01], 'node wall': [4.8, 0.0008]}},
  template_15: {1: {'seam band': [1.6, 0.0008]}, 0.75: {'seam wall': [1.5, 0.0004]}, 1.25: {'node band': [2, 0.0004]}, 1.5: {'seam band': [2.2, 0.12], 'seam wall': [2.4, 0.0684], 'node wall': [2.4, 0.0008]}},
  template_16: {1: {'node wall': [1.5, 0.0008], 'seam wall': [1.5, 0.0004]}, 0.75: {'seam wall': [1.5, 0.0004]}, 1.25: {'seam wall': [3.9, 0.0048], 'node wall': [4, 0.0008], 'seam band': [3.5, 0.0096]}, 1.5: {'seam band': [6.5, 0.04], 'seam wall': [6.8, 0.0136]}},
  template_17: {1: {'seam band': [1.7, 0.0004], 'seam wall': [1.5, 0.0004]}, 0.75: {'seam band': [1.5, 0.0004], 'seam wall': [1.5, 0.0004]}, 1.25: {'seam band': [1.5, 0.0004]}, 1.5: {'seam wall': [1.5, 0.0004], 'seam band': [1.5, 0.0004]}},
  template_18: {1: {'seam band': [2.6, 0.006], 'seam fan': [2.8, 0.0028], 'node fan': [2.8, 0.0004]}, 0.75: {'seam band': [1.6, 0.0004]}, 1.25: {'seam band': [2.8, 0.0104], 'seam fan': [3.6, 0.034], 'node fan': [3.2, 0.0016]}, 1.5: {'seam fan': [2.5, 0.0072], 'seam band': [3, 0.0092], 'node fan': [1.7, 0.0004]}},
  template_19: {1: {'seam wall': [1.6, 0.0012], 'seam band': [2.1, 0.0036], 'seam fan': [2.5, 0.0032], 'node fan': [2.7, 0.0004]}, 0.75: {}, 1.25: {'seam band': [2.4, 0.0068], 'seam fan': [3.6, 0.0348], 'node fan': [3.2, 0.0016]}, 1.5: {'seam band': [2.7, 0.0064], 'seam fan': [2.7, 0.008], 'node fan': [2.9, 0.0012]}},
};

const segDist = (px, py, a, b) => {
  const ex = b.x - a.x, ey = b.y - a.y, l = ex * ex + ey * ey, u = l ? Math.max(0, Math.min(1, ((px - a.x) * ex + (py - a.y) * ey) / l)) : 0;
  return Math.hypot(a.x + u * ex - px, a.y + u * ey - py);
};
const closestOn = (x, y, P) => { let best = { d: Infinity }; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], ex = b.x - a.x, ey = b.y - a.y, l = ex * ex + ey * ey, u = l ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / l)) : 0, qx = a.x + u * ex, qy = a.y + u * ey, d = Math.hypot(qx - x, qy - y); if (d < best.d) best = { d, x: qx, y: qy }; } return best; };
const polyDist = (x, y, P) => { if (pointInPolygon(x, y, P)) return 0; let d = Infinity; for (let i = 0; i < P.length; i++) d = Math.min(d, segDist(x, y, P[i], P[(i + 1) % P.length])); return d; };
const tess = (prims) => prims.flatMap((p) => (p.type === 'arc'
  ? Array.from({ length: 48 }, (_, k) => { const t = p.theta1 + ((p.theta2 - p.theta1) * k) / 48; return { x: p.cx + p.r * Math.cos(t), y: p.cy + p.r * Math.sin(t) }; })
  : [p.p0]));
const box = (P) => { const xs = P.map((p) => p.x), ys = P.map((p) => p.y); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };

/** the widest fan-to-run seam of a lay, in joints. A fan slice and a run piece share a SEAM when they are NEIGHBOURS (no other
 *  piece in the gap at their closest points) and at least SEAM_STRETCH_IN of the run piece's outline runs along the fan
 *  within half a joint of their closest distance; the seam's width is that closest distance. A short contact (a corner's
 *  meeting point: the fan's apex spots, item 16e) is not a seam. */
const SEAM_STRETCH_IN = 0.25, SAMPLE_IN = 0.01; // a real seam runs the band's depth (>= 0.75 in); a corner contact 0.15-0.18 in (measured)
function widestFanSeam(frame, J, others) {
  const fans = frame.filter((b) => b.fan), runs = frame.filter((b) => !b.fan);
  let worst = 0;
  for (const F of fans) {
    const fb = box(F.polygon);
    for (const R of runs) {
      const rb = box(R.polygon);
      if (rb[0] > fb[2] + 4 * J || fb[0] > rb[2] + 4 * J || rb[1] > fb[3] + 4 * J || fb[1] > rb[3] + 4 * J) continue;
      const gaps = [], at = [];
      const P = R.polygon;
      for (let i = 0; i < P.length; i++) {
        const a = P[i], b = P[(i + 1) % P.length], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / SAMPLE_IN));
        for (let k = 0; k < n; k++) { const x = a.x + ((b.x - a.x) * k) / n, y = a.y + ((b.y - a.y) * k) / n; gaps.push(polyDist(x, y, F.polygon)); at.push({ x, y }); }
      }
      const dmin = Math.min(...gaps);
      if (!(dmin > 0) || dmin > 4 * J) continue;
      const p = at[gaps.indexOf(dmin)], q = closestOn(p.x, p.y, F.polygon), mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      if (others.some((o) => o !== F && o !== R && polyDist(mid.x, mid.y, o.polygon) < 0.45 * dmin)) continue; // not neighbours
      const stretch = gaps.filter((d) => d <= dmin + J / 2).length * SAMPLE_IN;
      if (stretch >= SEAM_STRETCH_IN) worst = Math.max(worst, dmin / J);
    }
  }
  return worst;
}

/** a grid of CELL_IN buckets: each item listed in every cell its box (grown by `pad`) touches */
const CELL_IN = 0.5;
function buckets(items, boxOf, pad) {
  const map = new Map();
  for (const it of items) {
    const [x0, y0, x1, y1] = boxOf(it);
    for (let gx = Math.floor((x0 - pad) / CELL_IN); gx <= Math.floor((x1 + pad) / CELL_IN); gx++) for (let gy = Math.floor((y0 - pad) / CELL_IN); gy <= Math.floor((y1 + pad) / CELL_IN); gy++) {
      const k = gx * 1000 + gy; if (!map.has(k)) map.set(k, []); map.get(k).push(it);
    }
  }
  return (x, y) => map.get(Math.floor(x / CELL_IN) * 1000 + Math.floor(y / CELL_IN)) || [];
}

/** every other gap wider than 1.5 J, grouped: { 'seam band': {maxJ, sqIn}, 'node fan': ..., ... } */
function otherGaps(contour, frame, wall, J) {
  const pieces = [...frame.map((b) => ({ p: b.polygon, kind: b.fan ? 'fan' : 'band', bx: box(b.polygon) })), ...wall.map((b) => ({ p: b.polygon, kind: 'wall', bx: box(b.polygon) }))];
  const EDGE_IN = 0.05, REACH = 2 * J + 0.05; // a gap point is at most ~4 J from a piece; the board's edge is skipped
  const near = buckets(pieces, (q) => q.bx, REACH);
  const segs = contour.map((a, i) => ({ a, b: contour[(i + 1) % contour.length] }));
  const nearSegs = buckets(segs, (sg) => [Math.min(sg.a.x, sg.b.x), Math.min(sg.a.y, sg.b.y), Math.max(sg.a.x, sg.b.x), Math.max(sg.a.y, sg.b.y)], EDGE_IN);
  const inside = (x, y) => pointInPolygon(x, y, contour) && nearSegs(x, y).every((sg) => segDist(x, y, sg.a, sg.b) > EDGE_IN);
  const out = {};
  for (let y = GRID_IN / 2; y < H; y += GRID_IN) for (let x = GRID_IN / 2; x < W; x += GRID_IN) {
    if (!inside(x, y)) continue;
    const cand = near(x, y);
    let d = cand.length ? Infinity : REACH; // no piece within reach: wider than any joint, and counted as such
    for (const q of cand) { if (x < q.bx[0] - d || x > q.bx[2] + d || y < q.bx[1] - d || y > q.bx[3] + d) continue; d = Math.min(d, polyDist(x, y, q.p)); if (d === 0) break; }
    if (!(d > 0.75 * J)) continue;
    const touching = cand.filter((q) => !(x < q.bx[0] - d * 1.1 || x > q.bx[2] + d * 1.1 || y < q.bx[1] - d * 1.1 || y > q.bx[3] + d * 1.1) && polyDist(x, y, q.p) <= d * 1.08 + 1e-3);
    const kinds = new Set(touching.map((q) => q.kind));
    const cls = `${touching.length >= 3 ? 'node' : 'seam'} ${kinds.has('fan') ? 'fan' : kinds.has('wall') ? 'wall' : 'band'}`;
    const c = (out[cls] = out[cls] || { maxJ: 0, sqIn: 0 });
    c.maxJ = Math.max(c.maxJ, (2 * d) / J); c.sqIn += GRID_IN * GRID_IN;
  }
  return out;
}

describe('T86 item 16d: seams across every template and size (single soldier, 7x9)', () => {
  it.each(TEMPLATES)('%s: fan-to-run seams <= 1.5 joints; every other gap within today\'s cap', (tpl) => {
    const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: W, heightIn: H } }, 0, 0);
    const prims = buildRibbonPrimitives(sil.primitives), contour = tess(prims);
    const measured = {};
    for (const L of SIZES) {
      const scale = L / SET.brickLengthIn, J = scaledSet(SET, scale).grout.widthIn;
      const r = generateBricks({ boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], set: SET, seed: 1, scale, suppression: 0, clumping: 0, frame: { primitives: prims, bands: FRAME_PRESETS.single_soldier } });
      const fanSeam = widestFanSeam(r.frameBricks, J, [...r.frameBricks, ...r.bricks]);
      if (!MEASURE) expect(fanSeam, `${tpl} ${L} in: widest fan-to-run seam, joints`).toBeLessThanOrEqual(FAN_SEAM_MAX_J);
      const gaps = otherGaps(contour, r.frameBricks, r.bricks, J);
      measured[L] = { fanSeam: +fanSeam.toFixed(2), ...Object.fromEntries(Object.entries(gaps).map(([k, v]) => [k, [+v.maxJ.toFixed(1), +v.sqIn.toFixed(4)]])) };
      if (MEASURE) continue;
      const cap = (CAPS[tpl] || {})[L] || {};
      for (const [cls, v] of Object.entries(gaps)) {
        const [capJ, capSq] = cap[cls] || [0, 0];
        expect(v.maxJ, `${tpl} ${L} in ${cls}: widest gap, joints (cap ${capJ})`).toBeLessThanOrEqual(capJ + 0.3);
        expect(v.sqIn, `${tpl} ${L} in ${cls}: gap area, sq in (cap ${capSq})`).toBeLessThanOrEqual(capSq * 1.1 + 0.002);
      }
    }
    if (MEASURE) console.log(`CAP ${JSON.stringify(tpl)}: ${JSON.stringify(measured)},`);
  });
});

/**
 * Seat 37's trace (2026-10-04): with White Rocks every frame band is a fieldstone ring (contour-bands.js
 * setBandPattern), and the inner rings of a three_band frame grew stones that wrapped along the ring's hole --
 * MEASURED on every visible template: self-crossing stones of 2.8-27 sq in (median 0.15-0.34), one covering
 * T1's whole wall so a wall change never reached the 3D. Fixed by fencing each ring's hole with phantom seeds
 * (fieldstone.js fencePoints). Invariant: no ring stone crosses itself, none is larger than 10x the median.
 *
 * FENCED: the 13 templates the fence fixes completely, T1 included (seat 37's case). T11 T14 T15 T16 T17 T19, the
 * necked / notched templates whose inner rings pinched (it.todo until T86 item 32): item 28's fit rule keeps the
 * stack under 1/3 of the board's narrowest gap, so those inner rings are dropped -- once item 31 read T16's waist
 * right (3.90 -> 2.47 in; at 3.90 Grey stone at 0.75 in kept two rings and the inner one met itself across the
 * waist). MEASURED (seat B, 2026-10-06): 0 bad on every template, both stone sets, every size below.
 * Every template: White rocks at the test's own 1 and 4/3 scale (1 / 1.25 in sit between them) and Grey stone (its
 * bandLayout) at scale 1; the six that pinched also Grey stone at 0.75 in -- its lower course height changes the fit
 * rule's 'course' step, which is how T16 kept two rings there (0.75 in over all 19 cost 31 s, so only where it bit).
 * No stone over another either.
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS }); // a heavy sweep: see heavy-test-timeout.js
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { FRAME_PRESETS, BRICK_SETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { polygonIntersection, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';

// simple except where two edges only TOUCH: a shared vertex, or coincident edges (a stone straddling the ring's
// zero-width slit bridge runs in and back along it -- that is not a crossing)
function weaklySimple(p) {
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const same = (u, v) => Math.hypot(u.x - v.x, u.y - v.y) < 1e-9;
  const n = p.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue;
    const a = p[i], b = p[(i + 1) % n], c = p[j], d = p[(j + 1) % n];
    if (same(a, c) || same(a, d) || same(b, c) || same(b, d)) continue;
    const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
    if (Math.max(Math.abs(d1), Math.abs(d2), Math.abs(d3), Math.abs(d4)) < 1e-12) continue;
    if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return false;
  }
  return true;
}

const ROCKS = BRICK_SETS.find((s) => s.layout === 'fieldstone'), GREY = BRICK_SETS.find((s) => s.bandLayout === 'fieldstone');
const CASES = [[ROCKS, 1], [ROCKS, 4 / 3], [GREY, 1]];
const PINCHED = ['template_11', 'template_14', 'template_15', 'template_16', 'template_17', 'template_19'];
const SMALL = [GREY, 0.75 / GREY.brickLengthIn];
// MEASURED (2026-10-05): a real large-tier stone reaches 6.1x the ring's median (fieldstone mixes size tiers,
// most stones are small); every wrap-around stone was 17x or more. 10x separates them.
const MAX_OVER_MEDIAN = 10;
const OVERLAP_TOL_SQIN = 1e-3;
const box = (p) => { const xs = p.map((q) => q.x), ys = p.map((q) => q.y); return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]; };
function overlap(bricks) {
  const bx = bricks.map((b) => box(b.polygon));
  let sum = 0;
  for (let i = 0; i < bricks.length; i++) for (let j = i + 1; j < bricks.length; j++) {
    const a = bx[i], b = bx[j];
    if (a[1] < b[0] || b[1] < a[0] || a[3] < b[2] || b[3] < a[2]) continue;
    const x = polygonIntersection(bricks[i].polygon, bricks[j].polygon);
    if (x.length >= 3) sum += Math.abs(signedArea(x));
  }
  return sum;
}

describe('rock frame rings: every stone is a stone (no wrap-around, no self-crossing, none over another)', () => {
  for (const t of FRAME_DEFS.templates.filter((tp) => !tp.hidden)) {
    it(`${t.id}, three_band, White rocks scale 1 / 4/3${PINCHED.includes(t.id) ? ', Grey stone 0.75 in' : ''}, Grey stone scale 1`, () => {
      const record = normalizeFrameRecord({ templateId: t.id });
      const sil = frameContourSilhouette({ defs: FRAME_DEFS, record, board: { widthIn: 7, heightIn: 9 } }, 0, 0);
      const prims = buildRibbonPrimitives(sil.primitives);
      const bad = [];
      for (const [set, scale] of PINCHED.includes(t.id) ? [...CASES, SMALL] : CASES) {
        const { bricks } = bricksContourBands(prims, FRAME_PRESETS.three_band, { set, seed: 1, scale });
        const areas = bricks.map((b) => Math.abs(signedArea(b.polygon)));
        const median = [...areas].sort((a, b) => a - b)[Math.floor(areas.length / 2)] || 0;
        bricks.forEach((b, i) => {
          if (!weaklySimple(b.polygon) || areas[i] > MAX_OVER_MEDIAN * median) bad.push(`set ${set.id} ${scale.toFixed(2)} ${b.id} band ${b.bandIndex}: ${areas[i].toFixed(3)} sq in, crossing ${!weaklySimple(b.polygon)}`);
        });
        const ov = overlap(bricks);
        if (ov > OVERLAP_TOL_SQIN) bad.push(`set ${set.id} ${scale.toFixed(2)}: stones overlap ${ov.toFixed(3)} sq in`);
      }
      expect(bad).toEqual([]);
    });
  }
});

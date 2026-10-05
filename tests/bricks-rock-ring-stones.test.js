/**
 * Seat 37's trace (2026-10-04): with White Rocks every frame band is a fieldstone ring (contour-bands.js
 * setBandPattern), and the inner rings of a three_band frame grew stones that wrapped along the ring's hole --
 * MEASURED on every visible template: self-crossing stones of 2.8-27 sq in (median 0.15-0.34), one covering
 * T1's whole wall so a wall change never reached the 3D. Fixed by fencing each ring's hole with phantom seeds
 * (fieldstone.js fencePoints). Invariant: no ring stone crosses itself, none is larger than 6x the median.
 *
 * FENCED (must hold): the 11 templates the fence fixes completely, T1 included (seat 37's case); all 11 FAIL on
 * main. OPEN (it.todo, measured 2026-10-05): 8 keep an oversized or crossing stone -- T11 T14 T15 T16 T17 T19,
 * the necked / notched templates whose inner rings pinch (T86 item 16(c) part 2, the advisor's B1), and T3 / T4,
 * a seed at an inner ring's outer corner whose cell still runs to the box (a per-cell local bound fixes those but
 * is a limit rule, waiting for Fred's yes).
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { FRAME_PRESETS, BRICK_SETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';

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

const ROCKS = BRICK_SETS.find((s) => s.layout === 'fieldstone');
const MAX_OVER_MEDIAN = 6;

const FENCED = ['template_1', 'template_2', 'template_5', 'template_6', 'template_7', 'template_8', 'template_9', 'template_10', 'template_12', 'template_13', 'template_18'];

describe('rock frame rings: every stone is a stone (no wrap-around, no self-crossing)', () => {
  for (const t of FRAME_DEFS.templates.filter((tp) => !tp.hidden)) {
    if (!FENCED.includes(t.id)) {
      it.todo(`${t.id}, three_band: oversized / crossing ring stones remain (16(c) part 2 pinch, or the corner-cell bound awaiting Fred)`);
      continue;
    }
    it(`${t.id}, three_band, 1 in and 4/3 scale`, () => {
      const record = normalizeFrameRecord({ templateId: t.id });
      const sil = frameContourSilhouette({ defs: FRAME_DEFS, record, board: { widthIn: 7, heightIn: 9 } }, 0, 0);
      const prims = buildRibbonPrimitives(sil.primitives);
      const bad = [];
      for (const scale of [1, 4 / 3]) {
        const { bricks } = bricksContourBands(prims, FRAME_PRESETS.three_band, { set: ROCKS, seed: 1, scale });
        const areas = bricks.map((b) => Math.abs(signedArea(b.polygon)));
        const median = [...areas].sort((a, b) => a - b)[Math.floor(areas.length / 2)] || 0;
        bricks.forEach((b, i) => {
          if (!weaklySimple(b.polygon) || areas[i] > MAX_OVER_MEDIAN * median) bad.push(`${scale.toFixed(2)} ${b.id} band ${b.bandIndex}: ${areas[i].toFixed(3)} sq in, crossing ${!weaklySimple(b.polygon)}`);
        });
      }
      expect(bad).toEqual([]);
    });
  }
});

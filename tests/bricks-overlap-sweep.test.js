/**
 * Life-size overlap sweep (seat E, after T86 item 12, 2026-10-08). The frame as laid (the fit rule on), a single soldier band,
 * every template x 7x9 / 9x12 boards x 0.75 .. 8 in bricks (the app's size range: the 3 in and Life 8 in presets reach the
 * big end):
 *  - a RUN piece never overlaps another piece (run x run, run x fan): pinned at 0 -- item 12 measured life-size line-arc /
 *    arc-arc overlaps up to 41 % of a piece, from a medial cut its own area check refused;
 *  - FAN x FAN overlaps (a corner fan's own slices crossing at big depth, T86 item 30, seat D) are CAPPED at today's per
 *    template x board x size (count, widest share of a piece, total sq in) -- item 30 may only lower them;
 *  - a band as deep as the board is wide is laid as requested (item 28: no medial line to split at) -- exempt.
 * RUNS: the default suite sweeps FAST_SET; the full sweep runs with OVERLAP_SWEEP_FULL=1. MEASURE_OVERLAPS=1 prints the
 * fan-fan values instead of asserting them (to re-cap after a deliberate change).
 */
import { describe, it, expect, vi } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { polygonIntersection, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

vi.setConfig({ testTimeout: 600000 });

const SET = BRICK_SETS[0];
const FULL = !!process.env.OVERLAP_SWEEP_FULL, MEASURE = !!process.env.MEASURE_OVERLAPS;
const BOARDS = [[7, 9], [9, 12]];
/** the default run's subset: item 12's run-run cases (T1 / T10 9x12) and item 30's fan cases (T18 / T19) at 3 / 4 in, plus
 *  (`extra`) the 8 in lays where two shared-side corners' fans stacked after 7eb3df7 -- the gate's fast run had no 8 in
 *  case, so the full sweep went red unseen (seat E, 2026-10-08). + T16 at 8 in (seat D, 2026-10-08, a replay of each past
 *  engine fix's PRE-fix source through every sweep, FULL vs FAST: before dd98654 / 6802fef the full sweep failed T16 / T17
 *  9x12 8 in -- 29 / 27 fan x fan pairs -- and this fast set passed 5/5; T16 alone catches that class) */
const FAST_SET = { templates: ['template_1', 'template_10', 'template_18', 'template_19'], sizes: [3, 4], extra: { template_1: [8], template_5: [8], template_16: [8] } };
const SIZES_ALL = [0.75, 1, 1.25, 1.5, 2, 3, 4, 8];
const sizesFor = (tpl) => (FULL ? SIZES_ALL : [...(FAST_SET.templates.includes(tpl) ? FAST_SET.sizes : []), ...(FAST_SET.extra[tpl] || [])]);
const TEMPLATES = FULL ? FRAME_DEFS.templates.map((t) => t.id).filter((k) => /^template_\d+$/.test(k)) : [...new Set([...FAST_SET.templates, ...Object.keys(FAST_SET.extra)])];
const OVERLAP_SQIN = 1e-4;
/** today's fan x fan overlaps per template -> board -> size: [pairs, widest share of the smaller piece, total sq in] -- a cap,
 *  not a goal. Re-measured on fan-stacking (seat E, 2026-10-08; MEASURE_OVERLAPS=1 re-measures): 0 at 2 - 4 in everywhere
 *  (the old T18 / T19 / T7 / T5 caps were stale); at 8 in the shared-side split (contour-bands.js splitSharedSideFans)
 *  takes T16 / T17 9x12 from 29 / 27 pairs to 0 and T1 7x9 / T5 9x12 (stacked since 7eb3df7) to 0 / 1. */
const FAN_CAPS = {
  template_5: {'9x12':{8:[1,0.05,0.219]}},
};

const area = (p) => (p && p.length >= 3 ? Math.abs(signedArea(p)) : 0);
const bbox = (P) => P.reduce((b, p) => [Math.min(b[0], p.x), Math.min(b[1], p.y), Math.max(b[2], p.x), Math.max(b[3], p.y)], [Infinity, Infinity, -Infinity, -Infinity]);

function overlaps(bricks) {
  const B = bricks.map((b) => ({ P: b.polygon, a: area(b.polygon), bb: bbox(b.polygon), fan: !!b.fan }));
  const out = { run: [], fan: { pairs: 0, share: 0, sqIn: 0 } };
  for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
    const a = B[i], b = B[j];
    if (a.bb[2] < b.bb[0] || b.bb[2] < a.bb[0] || a.bb[3] < b.bb[1] || b.bb[3] < a.bb[1]) continue;
    const ov = area(polygonIntersection(a.P, b.P));
    if (ov <= OVERLAP_SQIN) continue;
    if (a.fan && b.fan) { out.fan.pairs++; out.fan.share = Math.max(out.fan.share, ov / Math.min(a.a, b.a)); out.fan.sqIn += ov; } else out.run.push(+ov.toFixed(4));
  }
  return out;
}

describe('life-size overlap sweep: no run piece overlaps; fan slices capped at today', () => {
  it.each(TEMPLATES)('%s', (tpl) => {
    const measured = {};
    for (const [W, H] of BOARDS) {
      const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: W, heightIn: H } }, 0, 0);
      if (!sil || !sil.primitives) continue;
      const prims = buildRibbonPrimitives(sil.primitives);
      // the board's own extent (arcs sampled along their span -- a whole circle's box read T14's big arcs as a wider board)
      const pts = prims.flatMap((p) => (p.type === 'line' ? [p.p0, p.p1] : Array.from({ length: 33 }, (_, k) => { const t = p.theta1 + ((p.theta2 - p.theta1) * k) / 32; return { x: p.cx + p.r * Math.cos(t), y: p.cy + p.r * Math.sin(t) }; })));
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      const boardWidth = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      for (const L of sizesFor(tpl)) {
        const r = bricksContourBands(prims, FRAME_PRESETS.single_soldier, { set: SET, seed: 1, scale: L / SET.brickLengthIn });
        const narrowed = r.bandsReduced && (r.bandsReduced.steps || []).find((s) => s.step === 'narrow');
        const depth = narrowed ? narrowed.toIn : L;
        if (depth >= boardWidth - 1e-9) continue; // item 28: the band is the board, laid as requested
        const o = overlaps(r.bricks);
        const key = `${W}x${H}`;
        if (o.fan.pairs) (measured[key] ||= {})[L] = [o.fan.pairs, +o.fan.share.toFixed(2), +o.fan.sqIn.toFixed(3)];
        if (MEASURE) continue;
        expect(o.run, `${tpl} ${key} ${L} in: run pieces overlapping (sq in)`).toEqual([]);
        const cap = ((FAN_CAPS[tpl] || {})[key] || {})[L] || [0, 0, 0];
        expect(o.fan.pairs, `${tpl} ${key} ${L} in: fan x fan pairs (cap ${cap[0]})`).toBeLessThanOrEqual(cap[0]);
        expect(o.fan.share, `${tpl} ${key} ${L} in: widest fan overlap share (cap ${cap[1]})`).toBeLessThanOrEqual(cap[1] + 0.01);
        expect(o.fan.sqIn, `${tpl} ${key} ${L} in: fan overlap total (cap ${cap[2]})`).toBeLessThanOrEqual(cap[2] * 1.05 + 0.001);
      }
    }
    if (MEASURE && Object.keys(measured).length) console.log(`FANCAP ${JSON.stringify(tpl)}: ${JSON.stringify(measured)},`);
  });
});

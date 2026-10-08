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
/** the default run's subset: item 12's run-run cases (T1 / T10 9x12) and item 30's fan cases (T18 / T19) */
const FAST_SET = { templates: ['template_1', 'template_10', 'template_18', 'template_19'], sizes: [3, 4] };
const SIZES = FULL ? [0.75, 1, 1.25, 1.5, 2, 3, 4, 8] : FAST_SET.sizes;
const TEMPLATES = FULL ? FRAME_DEFS.templates.map((t) => t.id).filter((k) => /^template_\d+$/.test(k)) : FAST_SET.templates;
const OVERLAP_SQIN = 1e-4;
/** today's fan x fan overlaps per template -> board -> size: [pairs, widest share of the smaller piece, total sq in] (measured
 *  2026-10-08 on main e549b84, the full sweep; MEASURE_OVERLAPS=1 re-measures) -- a cap, not a goal */
const FAN_CAPS = {
  template_16: {'7x9':{8:[14,0.44,15.234]},'9x12':{8:[29,0.49,32.578]}},
  template_17: {'7x9':{8:[6,0.39,8.127]},'9x12':{8:[27,0.4,27.663]}},
  template_18: {'7x9':{3:[9,0.59,0.815],4:[4,0.78,1.309],8:[4,0.69,1.309]},'9x12':{4:[16,0.67,1.757],8:[4,0.79,2.638]}},
  template_19: {'7x9':{2:[42,0.56,2.171],3:[39,0.91,4.56],4:[36,0.77,5.773],8:[7,0.79,6.303]},'9x12':{3:[44,0.77,3.952],4:[54,0.78,8.998],8:[10,0.61,7.297]}},
  template_4: {'7x9':{3:[14,0.01,0.025],4:[15,0.03,0.379],8:[11,0.03,0.443]},'9x12':{4:[11,0,0.037],8:[7,0.02,0.428]}},
  template_5: {'9x12':{4:[25,0.82,6.58]}},
  template_7: {'7x9':{3:[38,0.69,1.165]},'9x12':{4:[43,0.82,1.568],8:[22,0.7,5.888]}},
  template_8: {'9x12':{4:[2,0.09,0.211]}},
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
      for (const L of SIZES) {
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

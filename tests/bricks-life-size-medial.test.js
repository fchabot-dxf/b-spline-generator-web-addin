/**
 * T86 item 12 (seat E, MEASURED on main after 16(c)'s yieldAtMedialLine): at large bricks the arc-involved pairs that meet
 * at the medial line (T1's facing waists, a waist against a line, two big facing arcs) were found and cut correctly, but
 * the cut was REFUSED by its own area check -- 0.0011..0.0018 sq in off on 2.4..4.1 sq in pieces, over the absolute
 * CUT_CHECK_SQIN -- so the overlap stayed (T10 9x12 at 4 in: 41 % of a piece). The check is now the larger of that and
 * CUT_CHECK_SHARE of the piece (35,201 cuts measured: sound ones within 0.31 % at p99.9, failures beyond 3 %).
 * As laid (the fit rule on); a band as deep as the board is wide is laid as requested (item 28) and is not in this list.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { polygonIntersection, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

const area = (P) => (P && P.length >= 3 ? Math.abs(signedArea(P)) : 0);
// [template, brick length in, board w, h] -- each overlapped (run against run) on main before this fix
const CASES = [['template_1', 3, 9, 12], ['template_10', 4, 9, 12], ['template_17', 4, 7, 9], ['template_14', 4, 9, 12], ['template_5', 4, 9, 12], ['template_7', 4, 9, 12]];

describe('T86 item 12: life-size bricks, no run piece overlaps another', () => {
  it.each(CASES)('%s at %s in on %sx%s', (tpl, L, W, H) => {
    const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: W, heightIn: H } }, 0, 0);
    const r = bricksContourBands(buildRibbonPrimitives(sil.primitives), FRAME_PRESETS.single_soldier, { set: BRICK_SETS[0], seed: 1, scale: L / 0.75 });
    const runs = r.bricks.filter((b) => !b.fan);
    const bad = [];
    for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) {
      const o = area(polygonIntersection(runs[i].polygon, runs[j].polygon));
      if (o > 1e-4) bad.push(`${runs[i].id}/${runs[j].id} ${o.toFixed(4)}`);
    }
    expect(bad).toEqual([]);
  });
});

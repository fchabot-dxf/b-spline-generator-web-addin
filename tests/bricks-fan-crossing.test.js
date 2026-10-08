/**
 * T86 item 30 (seat E's sweep, "fan slices crossing at big bricks"): at 2-4 in two DIFFERENT corners' fans reached past
 * each other (measured: every overlapping fan pair is two corners, never one corner's own slices).
 *  - two corners either side of one edge whose run is dead at that depth (T7 / T5 / T19 ...): primitive-ribbon now drops
 *    that edge (dropLinesInvertedAmongLive), the two corners are one joint with ONE fan;
 *  - two FACING corners across a neck (T18): contour-bands yieldAtMedialLine splits them on their medial line.
 * Real template geometry (the same frameContourSilhouette + buildRibbonPrimitives chokepoint the Brick tab uses).
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
// [template, board w, h, brick length in] -- each laid crossing fans on main (seat E's measure + seat D's sweep)
const ADJACENT = [['template_19', 7, 9, 2], ['template_19', 9, 12, 3], ['template_5', 7, 9, 2.5], ['template_7', 7, 9, 3], ['template_7', 9, 12, 4]];
const FACING = [['template_18', 7, 9, 3], ['template_18', 9, 12, 4]];

function fanOverlaps(tpl, W, H, L) {
  const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: tpl }), board: { widthIn: W, heightIn: H } }, 0, 0);
  const r = bricksContourBands(buildRibbonPrimitives(sil.primitives), FRAME_PRESETS.single_soldier, { set: BRICK_SETS[0], seed: 1, scale: L / 0.75 });
  const fans = r.bricks.filter((b) => b.fan);
  const bad = [];
  for (let i = 0; i < fans.length; i++) for (let j = i + 1; j < fans.length; j++) {
    const o = area(polygonIntersection(fans[i].polygon, fans[j].polygon));
    if (o > 1e-4) bad.push(`${fans[i].id}/${fans[j].id} ${o.toFixed(4)}`);
  }
  return { fans: fans.length, bad };
}

describe('T86 item 30: no two fan slices overlap at 2-4 in', () => {
  it.each(ADJACENT)('two corners sharing a dead edge, one fan: %s %sx%s at %s in', (tpl, W, H, L) => {
    const { fans, bad } = fanOverlaps(tpl, W, H, L);
    expect(fans).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });
  it.each(FACING)('two facing corners, split on their medial line: %s %sx%s at %s in', (tpl, W, H, L) => {
    const { fans, bad } = fanOverlaps(tpl, W, H, L);
    expect(fans).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });
});

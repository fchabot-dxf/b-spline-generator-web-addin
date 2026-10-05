/**
 * T86 item 16(c): the band's inner boundary (boundaryAtDepth) must never cross itself, on every visible template
 * at every band depth Fred uses. MEASURED on main before the fix: 50 of 76 (19 templates x 4 depths) crossed --
 * arcs sampled past their own joints (T18's neck at 0.75 in), and opposite sides of a neck/waist colliding once
 * the band is deeper than half the local gap (T14/T18/T19 from 1 in, most templates at 1.25/1.5). A boundary
 * may still TOUCH itself: where the band pinches the interior into separate lobes they are joined by a
 * zero-width bridge (one polygon for every caller), so shared vertices and coincident bridge edges are allowed.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { BRICK_SETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

const SET = BRICK_SETS.find((s) => s.layout === 'bond');
const TEMPLATES = FRAME_DEFS.templates.filter((t) => !t.hidden).map((t) => t.id);
const DEPTHS = [0.75, 1, 1.25, 1.5];

// simple except where two edges only TOUCH: a shared vertex, or coincident slit/bridge edges (zero width)
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


describe('the band inner boundary never crosses itself (T86 item 16(c))', () => {
  for (const templateId of TEMPLATES) {
    it(`${templateId} at ${DEPTHS.join(' / ')} in`, () => {
      const record = normalizeFrameRecord({ templateId });
      const sil = frameContourSilhouette({ defs: FRAME_DEFS, record, board: { widthIn: 7, heightIn: 9 } }, 0, 0);
      const prims = buildRibbonPrimitives(sil.primitives);
      const crossing = DEPTHS.filter((d) => {
        // an area band keeps its exact width (a course band snaps to whole courses)
        const inner = bricksContourBands(prims, [{ widthIn: d, pattern: 'fieldstone' }], { set: SET, seed: 1 }).innerPath;
        return inner.length >= 3 && !weaklySimple(inner);
      });
      expect(crossing, 'depths whose inner boundary crosses itself').toEqual([]);
    });
  }
});

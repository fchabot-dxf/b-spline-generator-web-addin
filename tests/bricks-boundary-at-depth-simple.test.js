/**
 * T86 item 16(c): the band's inner boundary (boundaryAtDepth) must never cross itself, on every visible template
 * at every band depth Fred uses. MEASURED on main before the fix: 50 of 76 (19 templates x 4 depths) crossed --
 * arcs sampled past their own joints (T18's neck at 0.75 in), and opposite sides of a neck/waist colliding once
 * the band is deeper than half the local gap (T14/T18/T19 from 1 in, most templates at 1.25/1.5). A boundary
 * may still TOUCH itself: where the band pinches the interior into separate lobes they are joined by a
 * zero-width bridge (one polygon for every caller), so shared vertices and coincident bridge edges are allowed.
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS }); // a heavy sweep: see heavy-test-timeout.js
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
  // item 67 (test infra): one test per template x depth (was per template, all 4 depths: up to 5.7 s in a full run,
  // timed out under the fleet's load). The silhouette is the same for every depth, so it is built once per template.
  const _prims = new Map();
  const primsFor = (templateId) => {
    if (!_prims.has(templateId)) {
      const record = normalizeFrameRecord({ templateId });
      const sil = frameContourSilhouette({ defs: FRAME_DEFS, record, board: { widthIn: 7, heightIn: 9 } }, 0, 0);
      _prims.set(templateId, buildRibbonPrimitives(sil.primitives));
    }
    return _prims.get(templateId);
  };
  it.each(TEMPLATES.flatMap((t) => DEPTHS.map((d) => [t, d])))('%s at %s in', (templateId, d) => {
    // an area band keeps its exact width (a course band snaps to whole courses)
    const inner = bricksContourBands(primsFor(templateId), [{ widthIn: d, pattern: 'fieldstone' }], { set: SET, seed: 1 }).innerPath;
    expect(inner.length >= 3 && !weaklySimple(inner), 'the inner boundary crosses itself at this depth').toBe(false);
  });
});

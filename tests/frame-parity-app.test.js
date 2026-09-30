/**
 * FB-APP S4 (F8), design §5.2: the app's cut profile vs the recorded Fusion
 * outline (tests/fixtures/frame-parity, recorded live), per template x board.
 * Distance is measured both ways (app -> Fusion and Fusion -> app), so a
 * missing or extra piece cannot hide. New goldens (e.g. extra sizes Fred
 * records) are picked up automatically by the glob.
 *
 * TOLERANCE: 0.1 in. T1's model is a least-squares fit over 3 sizes (max
 * feature residual 0.083 in, the pinch depth on the small 5.51x1.97 board);
 * T2's is exact at its 2 valid sizes (5.51x1.97 is excluded: Fusion's own body
 * arc there is not tangent to the horn). Before F8 the 12x6 T1 pinch was 0.44 in
 * off (one fixed fraction set, and a construction missing a degree of freedom).
 * MEASURED after F8 (max of both directions): T1 7x9 0.021, 12x6 0.023, 5.51x1.97
 * 0.043; T2 7x9 0.010, 12x6 0.065 (T2's features are exact there; the residual is a
 * part of Fusion's T2 solve the app construction does not reproduce at that size).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile, frameInnerProfile } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { samplePairedOutlines } from '../bspline-frame-builder/b-spline-gen/html/core/preview/frame-mesh.js';

const TOL_IN = 0.1;
const DIR = 'tests/fixtures/frame-parity/';

/** Fusion curves (centred, y-up) -> points in editor coords (top-left, y-down). */
function goldenPoints(curves, W, H, keep, step = 0.01) {
  const pts = [];
  const toE = ([x, y]) => ({ x: x + W / 2, y: H / 2 - y });
  for (const [id, c] of Object.entries(curves)) {
    if (c.construction || !keep(id)) continue;
    if (c.type === 'line') {
      const n = Math.max(1, Math.ceil(Math.hypot(c.end[0] - c.start[0], c.end[1] - c.start[1]) / step));
      for (let k = 0; k <= n; k++) pts.push(toE([c.start[0] + (c.end[0] - c.start[0]) * k / n, c.start[1] + (c.end[1] - c.start[1]) * k / n]));
    } else if (c.type === 'arc') {
      const ang = (p) => Math.atan2(p[1] - c.center[1], p[0] - c.center[0]);
      const a0 = ang(c.start), am = ang(c.mid);
      let a1 = ang(c.end);
      // pick the sweep direction that passes through the recorded midpoint
      const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const ccw = norm(am - a0) < norm(a1 - a0);
      let sweep = ccw ? norm(a1 - a0) : -norm(a0 - a1);
      const n = Math.max(2, Math.ceil(Math.abs(sweep) * c.radius / step));
      for (let k = 0; k <= n; k++) {
        const a = a0 + sweep * k / n;
        pts.push(toE([c.center[0] + c.radius * Math.cos(a), c.center[1] + c.radius * Math.sin(a)]));
      }
    }
  }
  return pts;
}

const nearest = (p, cloud) => Math.min(...cloud.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));

const CASES = readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => {
  const g = JSON.parse(readFileSync(DIR + f, 'utf-8'));
  return [f.replace('.json', ''), g];
});

/**
 * H23 item 4: Template 6's tab genuinely needs a minimum height (>= 2x the
 * frame thickness, frameParamRanges) to stay a buildable part. `frameCutProfile`
 * (no seeds -- the same "just show the default" call this test makes) clamps
 * to that minimum; the recorded Fusion golden does NOT (`phases/p02_03`'s own
 * fixed seed fractions have no such clamp) -- at 7x9 both sides naturally clear
 * the minimum so they agree, but at 12x6 the golden's tab is 1.251in raw against
 * the app's own clamped 1.5in, and 5.51x1.97's is smaller still on both sides.
 * Fusion's OWN build is healthy and correct at every size here (unlike Template
 * 3/5's real bugs elsewhere in this same H23 batch) -- this is a genuine, known
 * clamp-vs-unclamped-golden divergence, not a construction defect, so it isn't
 * routed through `fit.excluded` (that would also drop these 2 of 3 points from
 * the least-squares fit itself, undoing the real, good fit these goldens gave
 * Template 6's tabHalfWidth/tabHeight -- see LIVE-RESULTS-ranchy.md item 4).
 */
const CLAMP_DIVERGENT_OUTLINE = new Set(['template_6_12x6', 'template_6_5.51x1.97']);
const CLAMP_DIVERGENT_INNER = new Set(['template_6_12x6']); // 5.51x1.97 already skips via the fit.ok===false branch below

describe('S4 parity: app cut profile vs the recorded Fusion outline', () => {
  it.each(CASES)('%s', (name, g) => {
    const tpl = FRAME_DEFS.templates.find((t) => t.id === g.meta.template);
    const size = `${g.meta.widthIn}x${g.meta.heightIn}`;
    if (tpl.shapeModel.fit.excluded.includes(size)) return; // declared: Fusion's own outline breaks the construction here
    if (CLAMP_DIVERGENT_OUTLINE.has(name)) return;
    const W = g.meta.widthIn, H = g.meta.heightIn;
    const prof = frameCutProfile(FRAME_DEFS, normalizeFrameRecord({ templateId: tpl.id }), { widthIn: W, heightIn: H });
    expect(prof.defects).toEqual([]);
    const app = samplePairedOutlines(prof.primitives, prof.primitives, 0.02).outer;
    // projections are reference geometry, not the outline
    const fus = goldenPoints(g.sketch2_shape_outline, W, H, (id) => !id.startsWith('proj_'));
    const appToFusion = Math.max(...app.map((p) => nearest(p, fus)));
    const fusionToApp = Math.max(...fus.filter((_, i) => i % 3 === 0).map((p) => nearest(p, app)));
    expect({ size, appToFusion: +appToFusion.toFixed(3), fusionToApp: +fusionToApp.toFixed(3) })
      .toEqual({ size, appToFusion: expect.any(Number), fusionToApp: expect.any(Number) });
    expect(appToFusion).toBeLessThan(TOL_IN);
    expect(fusionToApp).toBeLessThan(TOL_IN);
  });
});

/**
 * F8 AMEND: the frame's INNER edge (the true offset, editor/outline-offset.js)
 * vs Fusion's own offset (sketch3 `inner_*` curves, after its corner resolve).
 * Same tolerance and the same exclusions as the outline. MEASURED (max of both
 * directions): T1 7x9 0.020, 12x6 0.016; T2 7x9 0.010, 12x6 0.064 in, i.e. the
 * outline's own gap carried through (the offset itself adds nothing). At T1
 * 5.51x1.97 the frame does not fit (1.5 in of frame, 1.47 in safe zone).
 */
describe('S4 parity: app inner edge vs the recorded Fusion offset', () => {
  it.each(CASES)('%s', (name, g) => {
    const tpl = FRAME_DEFS.templates.find((t) => t.id === g.meta.template);
    const size = `${g.meta.widthIn}x${g.meta.heightIn}`;
    if (tpl.shapeModel.fit.excluded.includes(size)) return;
    if (CLAMP_DIVERGENT_INNER.has(name)) return;
    const W = g.meta.widthIn, H = g.meta.heightIn;
    const inner = frameInnerProfile(FRAME_DEFS, normalizeFrameRecord({ templateId: tpl.id }), { widthIn: W, heightIn: H });
    const fus = goldenPoints(g.sketch3_frame_enclosure, W, H, (id) => id.startsWith('inner_'));
    if (!frameCutProfile(FRAME_DEFS, normalizeFrameRecord({ templateId: tpl.id }), { widthIn: W, heightIn: H }).fit.ok) {
      // the frame does not fit: no inner edge in the app; Fusion's own offset flips OUTSIDE the board
      expect(inner).toBe(null);
      expect(fus.some((p) => p.x < 0 || p.x > W)).toBe(true);
      return;
    }
    expect(inner.defects).toEqual([]);
    const app = samplePairedOutlines(inner.primitives, inner.primitives, 0.02).outer;
    const appToFusion = Math.max(...app.map((p) => nearest(p, fus)));
    const fusionToApp = Math.max(...fus.filter((_, i) => i % 3 === 0).map((p) => nearest(p, app)));
    expect(appToFusion).toBeLessThan(TOL_IN);
    expect(fusionToApp).toBeLessThan(TOL_IN);
  });
});

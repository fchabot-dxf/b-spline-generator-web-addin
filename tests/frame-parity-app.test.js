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
import { frameCutProfile } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { samplePairedOutlines } from '../bspline-frame-builder/b-spline-gen/html/core/preview/frame-mesh.js';

const TOL_IN = 0.1;
const DIR = 'tests/fixtures/frame-parity/';

/** Fusion curves (centred, y-up) -> points in editor coords (top-left, y-down). */
function goldenPoints(golden, W, H, step = 0.01) {
  const pts = [];
  const toE = ([x, y]) => ({ x: x + W / 2, y: H / 2 - y });
  for (const [id, c] of Object.entries(golden.sketch2_shape_outline)) {
    if (c.construction || id.startsWith('proj_')) continue; // projections are reference geometry, not the outline
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

describe('S4 parity: app cut profile vs the recorded Fusion outline', () => {
  it.each(CASES)('%s', (_name, g) => {
    const tpl = FRAME_DEFS.templates.find((t) => t.id === g.meta.template);
    const size = `${g.meta.widthIn}x${g.meta.heightIn}`;
    if (tpl.shapeModel.fit.excluded.includes(size)) return; // declared: Fusion's own outline breaks the construction here
    const W = g.meta.widthIn, H = g.meta.heightIn;
    const prof = frameCutProfile(FRAME_DEFS, normalizeFrameRecord({ templateId: tpl.id }), { widthIn: W, heightIn: H });
    expect(prof.defects).toEqual([]);
    const app = samplePairedOutlines(prof.primitives, prof.primitives, 0.02).outer;
    const fus = goldenPoints(g, W, H);
    const appToFusion = Math.max(...app.map((p) => nearest(p, fus)));
    const fusionToApp = Math.max(...fus.filter((_, i) => i % 3 === 0).map((p) => nearest(p, app)));
    expect({ size, appToFusion: +appToFusion.toFixed(3), fusionToApp: +fusionToApp.toFixed(3) })
      .toEqual({ size, appToFusion: expect.any(Number), fusionToApp: expect.any(Number) });
    expect(appToFusion).toBeLessThan(TOL_IN);
    expect(fusionToApp).toBeLessThan(TOL_IN);
  });
});

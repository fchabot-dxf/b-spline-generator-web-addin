/**
 * T86 item 28 (Fred: "make the app do the best result"): a band stack deeper than BAND_FIT_SHARE of the board's
 * narrowest gap is reduced in the declared order (contour-bands.js BAND_FIT_STEPS: the innermost band's extra rows,
 * an area band to one course, then the innermost band) and the engine says so (`bandsReduced`). Real template
 * geometry, the 19 shipped templates x 6x9 / 7x9 / 9x12 x four brick sizes, three_band. Measured before the rule:
 * 100 of those 456 lays (with single_soldier) had no wall at all, 164 had band-on-band overlap (2498.8 sq in in all).
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/engine.js';
import { BAND_FIT_SHARE, narrowestGap } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { polygonIntersection, signedArea } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/geometry.js';
import { BRICK_SETS, FRAME_PRESETS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { buildRibbonPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

vi.setConfig({ testTimeout: HEAVY_TEST_MS }); // a heavy sweep: see heavy-test-timeout.js

const SET = BRICK_SETS[0];
const area = (p) => (p && p.length >= 3 ? Math.abs(signedArea(p)) : 0);
/** Band-on-band overlap left after the fit, where the stack FITS: the tight-curve corner residual every band lay
 *  already has (bricks-real-template-contours.test.js bounds it per pair), not the fit -- measured caps. */
const KNOWN_BAND_OVERLAP_SQIN = { 'template_16 7x9 1': 0.2, 'template_16 9x12 1.5': 1.1 };
const OVERLAP_TOL_SQIN = 0.05;

function primsOf(templateId, W, H) {
  const sil = frameContourSilhouette({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId }), board: { widthIn: W, heightIn: H } }, 0, 0);
  return buildRibbonPrimitives(sil.primitives);
}
function lay(prims, W, H, preset, L) {
  return generateBricks({
    boardOutline: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }],
    set: SET, seed: 1, scale: L / SET.brickLengthIn, suppression: 0, clumping: 0,
    frame: { primitives: prims, bands: FRAME_PRESETS[preset] },
  });
}
function bandOverlap(frameBricks) {
  const box = (p) => { const xs = p.map((q) => q.x), ys = p.map((q) => q.y); return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]; };
  const bx = frameBricks.map((b) => box(b.polygon));
  let sum = 0;
  for (let i = 0; i < frameBricks.length; i++) for (let j = i + 1; j < frameBricks.length; j++) {
    if (frameBricks[i].bandIndex === frameBricks[j].bandIndex) continue;
    const a = bx[i], b = bx[j];
    if (a[1] < b[0] || b[1] < a[0] || a[3] < b[2] || b[3] < a[2]) continue;
    sum += area(polygonIntersection(frameBricks[i].polygon, frameBricks[j].polygon));
  }
  return sum;
}

describe('band stacks that do not fit (T86 item 28)', () => {
  it('T1 7x9 three_band at 1.25 in: reduced innermost-first, a wall, no band overlap', () => {
    const r = lay(primsOf('template_1', 7, 9), 7, 9, 'three_band', 1.25);
    expect(r.bandsReduced.steps).toEqual([{ band: 2, step: 'drop' }, { band: 1, step: 'row' }, { band: 1, step: 'drop' }]);
    expect(r.bandsReduced.kept).toBe(1);
    expect(r.bricks.length).toBeGreaterThan(0);
    expect(new Set(r.frameBricks.map((b) => b.bandIndex))).toEqual(new Set([0]));
    expect(bandOverlap(r.frameBricks)).toBeLessThan(OVERLAP_TOL_SQIN);
  });
  it('one band that cannot shrink is laid as requested, with no note (today\'s warning covers it)', () => {
    const r = lay(primsOf('template_9', 7, 9), 7, 9, 'single_soldier', 1.5);
    expect(r.bandsReduced).toBeUndefined();
    expect(r.frameBricks.length).toBeGreaterThan(0);
  });
  it('the narrowest gap is the board\'s own: a 7x9 rectangle -> 7', () => {
    expect(narrowestGap([{ x: 0, y: 0 }, { x: 7, y: 0 }, { x: 7, y: 9 }, { x: 0, y: 9 }])).toBeCloseTo(7, 9);
    expect(narrowestGap([{ x: 0, y: 0 }, { x: 0, y: 9 }, { x: 7, y: 9 }, { x: 7, y: 0 }])).toBeCloseTo(7, 9); // either winding
  });
  it('every template x board x size: a stack that fits is laid whole; a reduced one fits or keeps one band; a wall wherever it fits; no band overlap', () => {
    const bad = [];
    for (const { id } of FRAME_DEFS.templates) for (const [W, H] of [[6, 9], [7, 9], [9, 12]]) {
      const prims = primsOf(id, W, H);
      for (const L of [0.75, 1, 1.25, 1.5]) {
        const tag = `${id} ${W}x${H} ${L}`;
        const r = lay(prims, W, H, 'three_band', L);
        const n = r.bandsReduced;
        const bandsLaid = new Set(r.frameBricks.map((b) => b.bandIndex)).size;
        if (!n && bandsLaid !== FRAME_PRESETS.three_band.length) bad.push(`${tag}: no note but ${bandsLaid} bands laid`);
        if (n && !n.fits && n.kept !== 1) bad.push(`${tag}: still too deep with ${n.kept} bands`);
        if (n && Math.abs(n.limitIn - BAND_FIT_SHARE * n.gapIn) > 1e-9) bad.push(`${tag}: limit is not the declared share`);
        if ((!n || n.fits) && r.bricks.length === 0) bad.push(`${tag}: the stack fits but no wall`);
        const ov = bandOverlap(r.frameBricks);
        if (ov > (KNOWN_BAND_OVERLAP_SQIN[tag] ?? OVERLAP_TOL_SQIN)) bad.push(`${tag}: band overlap ${ov.toFixed(2)} sq in`);
      }
    }
    expect(bad).toEqual([]);
  });
});

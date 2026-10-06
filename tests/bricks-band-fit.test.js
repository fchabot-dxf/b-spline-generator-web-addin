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
  // item 28 never reduces the one band it has left; since T86 item 30 a single band too deep for a feature NARROWS to fit
  // it (T9 7x9 1.5 in: the I-beam web drops its line at the requested depth), so the note's only step is item 30's
  it('one band that cannot shrink is not reduced by the fit rule; item 30 narrows it to the web (its only step)', () => {
    const r = lay(primsOf('template_9', 7, 9), 7, 9, 'single_soldier', 1.5);
    expect(r.bandsReduced.steps.map((s) => s.step)).toEqual(['narrow']);
    expect(r.frameBricks.length).toBeGreaterThan(0);
  });
  it('the narrowest gap is the board\'s own: a 7x9 rectangle -> 7', () => {
    expect(narrowestGap([{ x: 0, y: 0 }, { x: 7, y: 0 }, { x: 7, y: 9 }, { x: 0, y: 9 }])).toBeCloseTo(7, 9);
    expect(narrowestGap([{ x: 0, y: 0 }, { x: 0, y: 9 }, { x: 7, y: 9 }, { x: 7, y: 0 }])).toBeCloseTo(7, 9); // either winding
  });
  // T86 item 31: a ray whose first hit is the neighbouring primitive is a corner's wedge (T7 read 0.007 in, T14 0.384,
  // T17 0.345 -- every three_band lay on them a "(no fit)" drop); a waist between two reflex junctions is read along
  // their bisectors (no edge normal crosses T14's hourglass waist: every side ray meets its corner first)
  it('an hourglass reads its waist, not its acute corners', () => {
    const hourglass = [{ x: 0, y: 0 }, { x: 7, y: 0 }, { x: 4.8, y: 4.5 }, { x: 7, y: 9 }, { x: 0, y: 9 }, { x: 2.2, y: 4.5 }];
    expect(narrowestGap(hourglass)).toBeCloseTo(2.6, 9);
    expect(narrowestGap([...hourglass].reverse())).toBeCloseTo(2.6, 9);
  });
  it('a board whose primitives are all neighbours (a triangle) keeps the plain first-hit reading', () => {
    expect(Number.isFinite(narrowestGap([{ x: 0, y: 0 }, { x: 7, y: 0 }, { x: 3.5, y: 9 }]))).toBe(true);
  });
  // mixed_bands at 1 in was a "(no fit)" drop to one band on T7 / T14 / T17 (T14: 106 pieces; now 144, a wall kept)
  it.each([['template_7', 2.68, 'mixed_bands'], ['template_14', 2.6, 'mixed_bands'], ['template_17', 2.24, 'mixed_bands'], ['template_16', 3.9, 'three_band']])(
    '%s 7x9: the gap the fit rule reads is the board\'s own (%s in); %s at 1 in fits', (id, gap, preset) => {
      const r = lay(primsOf(id, 7, 9), 7, 9, preset, 1);
      expect(r.bandsReduced.gapIn).toBeCloseTo(gap, 2);
      expect(r.bandsReduced.fits).toBe(true);
    });
  // item 67 (test infra): one test per template x board (was one test over all of them: 11.7 s in a full run, a
  // timeout under the fleet's load). The same cases, the same checks.
  const CASES = FRAME_DEFS.templates.flatMap(({ id }) => [[6, 9], [7, 9], [9, 12]].map(([W, H]) => [`${id} ${W}x${H}`, id, W, H]));
  it.each(CASES)('%s x every size: a stack that fits is laid whole; a reduced one fits or keeps one band; a wall wherever it fits; no band overlap', (_name, id, W, H) => {
    const bad = [];
    const prims = primsOf(id, W, H);
    for (const L of [0.75, 1, 1.25, 1.5]) {
      const tag = `${id} ${W}x${H} ${L}`;
      const r = lay(prims, W, H, 'three_band', L);
      const n = r.bandsReduced;
      const bandsLaid = new Set(r.frameBricks.map((b) => b.bandIndex)).size;
      if (!n && bandsLaid !== FRAME_PRESETS.three_band.length) bad.push(`${tag}: no note but ${bandsLaid} bands laid`);
      if (n && !n.fits && n.kept !== 1) bad.push(`${tag}: still too deep with ${n.kept} bands`);
      if (n && Math.abs(n.limitIn - BAND_FIT_SHARE * n.gapIn) > 1e-9) bad.push(`${tag}: limit is not the declared share`);
      // a band item 30 narrowed stops at the feature's own cliff: where that feature is the board's whole middle (T9 1.5 in:
      // the web's two rows meet across a joint) no wall is left, by design
      const narrowed = n && n.steps.some((s) => s.step === 'narrow');
      if ((!n || n.fits) && !narrowed && r.bricks.length === 0) bad.push(`${tag}: the stack fits but no wall`);
      const ov = bandOverlap(r.frameBricks);
      if (ov > (KNOWN_BAND_OVERLAP_SQIN[tag] ?? OVERLAP_TOL_SQIN)) bad.push(`${tag}: band overlap ${ov.toFixed(2)} sq in`);
    }
    expect(bad).toEqual([]);
  });
});

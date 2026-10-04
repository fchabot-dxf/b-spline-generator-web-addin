/**
 * T86 item 1 follow-up (advisor review, "the top band's first and last pieces are thin strips"):
 * `planCornerRun`'s own end-fraction choice must prefer FULLER end pieces over a razor-thin
 * declared fraction whenever the fuller choice's own positioning error stays within a small,
 * declared tolerance of the true best fit -- MEASURED (not assumed) directly against the raw
 * numbers from the T86 item 1 square fixture (brickHeightIn=0.2 pitch, grout.widthIn=0.034) that
 * first surfaced the thin strips.
 */
import { describe, it, expect } from 'vitest';
import { planCornerRun } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/piece-plan.js';
import { FILL_FRACTIONS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

const PITCH = 0.2, JOINT = 0.034;

describe('planCornerRun prefers fuller end pieces within tolerance (T86 item 1 follow-up)', () => {
  it('runLength=10 (the through band\'s own full run): picks WHOLE pieces at both ends, not a 1/4 sliver', () => {
    // HAND-COMPUTED (not read back from the engine): the strict err-minimum here is the (0.5,0.25)
    // combo (err=0.012), but (1,1) costs only 0.028 -- a 0.016in difference across a 10in run,
    // comfortably inside this fix's own tolerance (half the grout width, 0.017) -- so (1,1) must win.
    const { lengths } = planCornerRun(10, PITCH, JOINT, FILL_FRACTIONS);
    expect(lengths[0]).toBeCloseTo(PITCH, 6); // a whole piece, not 0.1 (the old 0.5-fraction pick)
    expect(lengths[lengths.length - 1]).toBeCloseTo(PITCH, 6); // not 0.05 (the old 0.25-fraction pick)
    expect(lengths.every((l) => l >= PITCH * 0.5 - 1e-9)).toBe(true); // nothing below the 1/2 fraction here
  });

  it('runLength=8.432 (the butt band\'s own clipped run): picks the BALANCED (1/2,1/2) split over an equal-error, equal-sum but lopsided (3/4,1/4)', () => {
    // HAND-COMPUTED: (1,1) is too far off here (err=0.042, outside tolerance of the true best 0.008),
    // so the fullest-pair tiebreaker alone lands on a 3-way tie, all summing to 1 brick's worth and
    // all at the SAME err: (3/4,1/4), (1/2,1/2), (1/4,3/4). Without a SECOND tiebreaker (maximize the
    // smaller of the two), the first of those in iteration order -- (3/4,1/4) -- would win, which
    // still has a 1/4-fraction sliver at one end; the balanced (1/2,1/2) split avoids any sliver at
    // all and must be the one actually chosen.
    const { lengths } = planCornerRun(8.432, PITCH, JOINT, FILL_FRACTIONS);
    expect(lengths[0]).toBeCloseTo(PITCH * 0.5, 6);
    expect(lengths[lengths.length - 1]).toBeCloseTo(PITCH * 0.5, 6);
  });

  it('a genuinely forced thin end (no fuller alternative within tolerance) still uses it -- the fix is NOT a blanket ban on 1/4', () => {
    // A short run where every fuller combo overshoots or lands far outside tolerance: the smallest
    // viable run (just over 2x the smallest fraction) has NO whole-piece alternative at all --
    // `planCornerRun`'s own short-run fallback (a single piece spanning the run) still applies below
    // the 2x-smallest-fraction floor, but just above it, two 1/4-fraction ends are the only pieces
    // that fit, so the result must still legitimately use them, not reach for pieces that don't fit.
    const runLength = PITCH * 0.25 * 2 + JOINT + 0.001; // barely enough for two 1/4-fraction ends, one joint, no whole pieces
    const { lengths } = planCornerRun(runLength, PITCH, JOINT, FILL_FRACTIONS);
    expect(lengths.length).toBe(2);
    expect(lengths[0]).toBeCloseTo(PITCH * 0.25, 6);
    expect(lengths[1]).toBeCloseTo(PITCH * 0.25, 6);
  });
});

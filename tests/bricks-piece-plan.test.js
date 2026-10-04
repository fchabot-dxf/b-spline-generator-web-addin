/**
 * T86 item 1 follow-up (advisor review, "the top band's first and last pieces are thin strips"),
 * and follow-up #2 (the SAME complaint resurfacing at a BLOCK/LAPPED corner once the first fix's own
 * tolerance window proved too narrow): `planCornerRun`'s own end-fraction choice must prefer FULLER
 * end pieces over a razor-thin declared fraction whenever the fuller choice's own resulting JOINT
 * WIDTH stays within a generous, declared ceiling of nominal -- MEASURED (not assumed) directly
 * against the raw numbers from the T86 item 1 square fixture (brickHeightIn=0.2 pitch,
 * grout.widthIn=0.034) that surfaced both rounds of the thin strips.
 */
import { describe, it, expect } from 'vitest';
import { planCornerRun } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/piece-plan.js';
import { FILL_FRACTIONS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

const PITCH = 0.2, JOINT = 0.034;

describe('planCornerRun prefers fuller end pieces within a joint-width ceiling (T86 item 1 follow-up)', () => {
  it('runLength=10 (the through band\'s own full run): picks WHOLE pieces at both ends, not a 1/4 sliver', () => {
    const { lengths } = planCornerRun(10, PITCH, JOINT, FILL_FRACTIONS);
    expect(lengths[0]).toBeCloseTo(PITCH, 6); // a whole piece, not 0.1/0.05 (a pre-fix fraction pick)
    expect(lengths[lengths.length - 1]).toBeCloseTo(PITCH, 6);
    expect(lengths.every((l) => l >= PITCH - 1e-9)).toBe(true); // every piece a WHOLE brick here
  });

  it('runLength=8.432 (the butt band\'s own clipped run): ALSO picks whole pieces -- follow-up #2\'s own case', () => {
    // HAND-COMPUTED: (1,1) was previously rejected (err=0.042 vs the true-best 0.008, outside the
    // first fix's own position-error tolerance of 0.017) in favour of a balanced (1/2,1/2) split.
    // follow-up #2's own joint-width lens accepts it instead: (1,1)'s own jointWidth here is 0.0352,
    // vs the error-minimum's own 0.0342 -- a 0.001in difference, comfortably inside the 3x-nominal
    // ceiling (0.102) -- so (1,1) now wins.
    const { lengths } = planCornerRun(8.432, PITCH, JOINT, FILL_FRACTIONS);
    expect(lengths[0]).toBeCloseTo(PITCH, 6);
    expect(lengths[lengths.length - 1]).toBeCloseTo(PITCH, 6);
    expect(lengths.every((l) => l >= PITCH - 1e-9)).toBe(true);
  });

  it('runLength=7.732 (T86 item 1 follow-up #2\'s own real case: a BLOCK-bounded run, both quoin corners consumed): whole pieces, not the 0.1in sliver the advisor flagged live', () => {
    // HAND-COMPUTED, reconstructed from the live engine's own output (template BLOCK square fixture,
    // bottom band with a quoin corner at each end): available run = 10 - 2*(blockSize=1.1 +
    // grout=0.034) = 7.732. Before follow-up #2, this chose a balanced (1/2,1/2) split -- two 0.1in
    // end pieces, visibly thin next to the 1.1in grey quoin block (exactly what the advisor's own
    // screenshot showed). (1,1)'s own jointWidth here is 0.0354 vs the error-minimum's own 0.0343 --
    // again a ~0.001in difference, inside the ceiling.
    const { lengths } = planCornerRun(7.732, PITCH, JOINT, FILL_FRACTIONS);
    expect(lengths[0]).toBeCloseTo(PITCH, 6);
    expect(lengths[lengths.length - 1]).toBeCloseTo(PITCH, 6);
    expect(lengths.every((l) => l >= PITCH - 1e-9)).toBe(true);
  });

  it('a genuinely forced thin end (no fuller alternative fits at all) still uses it -- the fix is NOT a blanket ban on 1/4', () => {
    // A short run where every fuller combo overshoots or lands far outside the joint-width ceiling:
    // the smallest viable run (just over 2x the smallest fraction) has NO whole-piece alternative at
    // all -- `planCornerRun`'s own short-run fallback (a single piece spanning the run) still applies
    // below the 2x-smallest-fraction floor, but just above it, two 1/4-fraction ends are the only
    // pieces that fit, so the result must still legitimately use them, not reach for pieces that
    // don't fit (confirms the fallback-to-full-pool path when nothing clears the ceiling).
    const runLength = PITCH * 0.25 * 2 + JOINT + 0.001; // barely enough for two 1/4-fraction ends, one joint, no whole pieces
    const { lengths } = planCornerRun(runLength, PITCH, JOINT, FILL_FRACTIONS);
    expect(lengths.length).toBe(2);
    expect(lengths[0]).toBeCloseTo(PITCH * 0.25, 6);
    expect(lengths[1]).toBeCloseTo(PITCH * 0.25, 6);
  });
});

describe('planCornerRun with a declared `sequence` (T86 item 2 -- band patterns as declared piece sequences)', () => {
  it('omitting sequence is byte-identical to [pitch] -- the default must reproduce today\'s exact uniform behaviour', () => {
    const withSeq = planCornerRun(10, PITCH, JOINT, FILL_FRACTIONS, [PITCH]);
    const withoutSeq = planCornerRun(10, PITCH, JOINT, FILL_FRACTIONS);
    expect(withSeq).toEqual(withoutSeq);
  });

  it('a 2-element sequence [L,H] (flemish: stretcher then header) cycles for every MIDDLE piece, end pieces still plain pitch fractions', () => {
    const L = 0.75, H = 0.2;
    const { lengths } = planCornerRun(10, L, JOINT, FILL_FRACTIONS, [L, H]);
    // HAND-COMPUTED: end pieces are `fraction * pitch` (pitch=L=0.75) regardless of the sequence;
    // middle pieces alternate L,H,L,H,... starting from sequence[0].
    expect(lengths[0]).toBeCloseTo(L, 6); // end piece: fraction 1 * pitch
    expect(lengths[lengths.length - 1]).toBeCloseTo(L, 6);
    const middle = lengths.slice(1, -1);
    expect(middle.length).toBeGreaterThan(2); // the run is long enough to show real cycling, not a degenerate case
    for (let i = 0; i < middle.length; i++) {
      expect(middle[i]).toBeCloseTo(i % 2 === 0 ? L : H, 6);
    }
  });

  it('a genuinely short run still fits whatever the sequence allows, no crash on a cycled-but-empty middle', () => {
    const L = 0.75, H = 0.2;
    const { lengths } = planCornerRun(1.6, L, JOINT, FILL_FRACTIONS, [L, H]);
    expect(lengths.length).toBeGreaterThan(0);
    expect(lengths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1.6 + 1e-6);
  });
});

describe('planCornerRun with `forcedFStart` (T86 item 2 -- running-bond row stagger)', () => {
  it('forces the START piece to exactly the given fraction, regardless of what the free search would otherwise pick', () => {
    // HAND-COMPUTED: runLength=10, pitch=0.2 -- the free search (no forcedFStart) picks (1,1), whole
    // bricks at both ends (confirmed by the very first test in this file). Forcing fStart=0.5 must
    // override that and produce EXACTLY a 0.5*0.2=0.1 first piece, with fEnd still free to optimize.
    const { lengths } = planCornerRun(10, PITCH, JOINT, FILL_FRACTIONS, undefined, 0.5);
    expect(lengths[0]).toBeCloseTo(PITCH * 0.5, 6);
  });

  it('omitting forcedFStart is byte-identical to the free search -- the default must reproduce today\'s exact behaviour', () => {
    const forced = planCornerRun(10, PITCH, JOINT, FILL_FRACTIONS, undefined, undefined);
    const free = planCornerRun(10, PITCH, JOINT, FILL_FRACTIONS);
    expect(forced).toEqual(free);
  });

  it('falls back to the free search (never crashes) when the forced fraction cannot fit any viable combo on a short run', () => {
    // A run just long enough for the free search's own smallest pair (2x the smallest fraction) but
    // too short for forcedFStart=1 (a WHOLE brick) plus any declared fEnd -- `candidates` would be
    // empty under the forced constraint alone; the function must retry freely rather than crash on
    // `pool.reduce` over an empty array.
    const runLength = PITCH * 0.25 * 2 + JOINT + 0.001;
    expect(() => planCornerRun(runLength, PITCH, JOINT, FILL_FRACTIONS, undefined, 1)).not.toThrow();
    const { lengths } = planCornerRun(runLength, PITCH, JOINT, FILL_FRACTIONS, undefined, 1);
    expect(lengths.length).toBeGreaterThan(0);
  });
});

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

// T86 item 21b, the JOINT RULE (replaces the fuller-end-fraction search these cases were written for): every joint is
// the declared width and the run's slack goes into its END closer -- so the old "whole pieces at both ends" no longer
// holds by construction; the same runs now pin the new declared contract.
function expectJointRule(lengths, jointWidth, runLength, pitch, startLen = pitch) {
  expect(jointWidth).toBe(JOINT); // never flexed
  expect(lengths.reduce((a, b) => a + b, 0) + (lengths.length - 1) * jointWidth).toBeCloseTo(runLength, 9);
  expect(lengths[0]).toBeCloseTo(startLen, 9); // a run starts with a whole brick (or its stagger fraction)
  const last = lengths[lengths.length - 1];
  expect(last).toBeGreaterThanOrEqual(0.25 * pitch - 1e-9); // the end closer takes the slack, within the declared range
  expect(last).toBeLessThanOrEqual(1.2 * pitch + 1e-9);
}

describe('planCornerRun, the joint rule (T86 item 21b): joints stay declared, the end closer takes the slack', () => {
  for (const runLength of [10, 8.432, 7.732]) { // the T86 item 1 square / butt / block runs
    it(`runLength=${runLength}: every joint ${JOINT}, a whole brick first, whole bricks between, one closer last`, () => {
      const { lengths, jointWidth } = planCornerRun(runLength, PITCH, JOINT, FILL_FRACTIONS);
      expectJointRule(lengths, jointWidth, runLength, PITCH);
      // whole bricks between; the end is one closer, or two equal ones when a single closer would pass 1.2 bricks
      const cut = lengths.findIndex((l, i) => i > 0 && Math.abs(l - PITCH) > 1e-9);
      expect(lengths.length - cut).toBeLessThanOrEqual(2);
      if (lengths.length - cut === 2) expect(lengths[cut]).toBeCloseTo(lengths[cut + 1], 9);
    });
  }

  it('a run too short for a whole brick and a closer is ONE piece (no joint, so none to flex)', () => {
    const runLength = PITCH * 0.25 * 2 + JOINT + 0.001;
    const { lengths } = planCornerRun(runLength, PITCH, JOINT, FILL_FRACTIONS);
    expect(lengths).toEqual([runLength]);
  });
});

describe('planCornerRun with a declared `sequence` (T86 item 2 -- band patterns as declared piece sequences)', () => {
  it('omitting sequence is byte-identical to [pitch] -- the default must reproduce today\'s exact uniform behaviour', () => {
    const withSeq = planCornerRun(10, PITCH, JOINT, FILL_FRACTIONS, [PITCH]);
    const withoutSeq = planCornerRun(10, PITCH, JOINT, FILL_FRACTIONS);
    expect(withSeq).toEqual(withoutSeq);
  });

  it('a 2-element sequence [L,H] (flemish: stretcher then header) cycles for every MIDDLE piece; whole start, closer end', () => {
    const L = 0.75, H = 0.2;
    const { lengths, jointWidth } = planCornerRun(10, L, JOINT, FILL_FRACTIONS, [L, H]);
    // middle pieces alternate L,H,L,H,... starting from sequence[0]; 21b joint rule: the start is a whole brick (pitch=L)
    // and the END is the closer that takes the slack (no longer a plain pitch fraction)
    expectJointRule(lengths, jointWidth, 10, L);
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

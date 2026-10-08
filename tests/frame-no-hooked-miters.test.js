/**
 * H23 item 39 (Fred-approved guard, finishing item 38: "a hooked tip is SHORT GRAIN -- fibres
 * across a thin tip, it snaps. Size the margin so a tip is never thin, not just 'miter inside the
 * wood'"): ONE declared rule for every template (not a T7 patch) -- every miter's own straight
 * line (outer corner -> inner corner) must keep real clearance from the rest of the outer
 * boundary along its whole length, matching cf3805f's own T10 reflex-rule pattern exactly:
 * (1) generateFrame's isValid rejects a seed that breaks it (frame-panel.js), (2) the attempts
 * budget is re-measured for the tighter check (frame-handles.js GENERATE_MAX_ATTEMPTS), (3) this
 * file: a pure sweep over every template's own real generateFrame() logic, mutation-tested two
 * ways (removing the check; reverting the attempts budget).
 */
import { describe, it, expect, vi } from 'vitest';
import { HEAVY_TEST_MS } from './heavy-test-timeout.js';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord, frameParam } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import {
  frameCutProfile, frameInnerProfile, frameMiters, miterTipMargin, miterStaysInsideWood,
  MITER_CORNER_EXCLUDE_T_FRAC, MIN_MITER_MARGIN_T_FRAC, frameGenerateFailure, frameGenerateIsValid,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { generateFrameSeeds, generateValidFrameSeeds } from '../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';
vi.setConfig({ testTimeout: HEAVY_TEST_MS }); // the declared heavy-test timeout: timed out at 5 s under the fleet's load (turns 261-265)

const board = (W, H) => ({ widthIn: W, heightIn: H });
const BOARDS = [[6, 9], [7, 9], [9, 12]];

// generateFrame()'s own rule, read from its ONE declaration (editor-frame-profile.js frameGenerateFailure /
// FRAME_GENERATE_CHECKS). 2026-10-08: this file used to reproduce it by hand, and the copy had drifted (no outer-
// defect / undercut / miter-collision checks). The PRE-EXISTING chain the sweep below compares against is that same
// rule minus its last check, the item-39 miter margin: a seed whose only failure is 'miterMargin' is one the pre-
// item-39 chain would have accepted. MEASURED (WORK-LOG item 39): template_8's own dippedLeftWave preset fails an
// earlier check for a majority of external seeds at 6x9, with or without the margin rule -- a pre-existing gap, not
// an item-39 regression, which is exactly what the split tells apart.

describe('miterTipMargin / miterStaysInsideWood: the geometric mechanism, isolated', () => {
  it('an ordinary 90deg box corner has ample margin (the corner\'s own 2 bordering primitives never count ' +
    'against it close to the vertex, only farther out)', () => {
    // A simple square notch: outer boundary is 4 lines, the "miter" at corner 0 runs from (2,0) inward to (1,1).
    const outerPrims = [
      { type: 'L', p0: { x: 2, y: 0 }, p1: { x: 2, y: 2 } },
      { type: 'L', p0: { x: 2, y: 2 }, p1: { x: 0, y: 2 } },
      { type: 'L', p0: { x: 0, y: 2 }, p1: { x: 0, y: 0 } },
      { type: 'L', p0: { x: 0, y: 0 }, p1: { x: 2, y: 0 } },
    ];
    const m = { outer: { x: 2, y: 0 }, inner: { x: 1, y: 1 }, aIdx: 3, bIdx: 0 };
    const t = 1;
    const margin = miterTipMargin(outerPrims, m, t * MITER_CORNER_EXCLUDE_T_FRAC);
    expect(margin).toBeGreaterThan(t * MIN_MITER_MARGIN_T_FRAC);
    expect(miterStaysInsideWood(outerPrims, [m], t)).toBe(true);
  });

  it('a deliberately hooked tip (the miter re-approaches a farther-out primitive) reads a near-zero margin, ' +
    'not merely "crosses or not" -- a graze that stops just short of literally crossing must still fail', () => {
    // The miter runs from (2,0) to (1,1) -- the line y = 2 - x. A 3rd, unrelated primitive (a wall at
    // x=1.02, straddling y=0.98 where that line actually passes) borders NEITHER end of this corner: a hook
    // grazing something it should never get near, without literally crossing it (the wall stops short of x=1).
    const outerPrims = [
      { type: 'L', p0: { x: 2, y: 0 }, p1: { x: 2, y: 2 } },
      { type: 'L', p0: { x: 2, y: 2 }, p1: { x: 0, y: 2 } },
      { type: 'L', p0: { x: 0, y: 2 }, p1: { x: 0, y: 0 } },
      { type: 'L', p0: { x: 0, y: 0 }, p1: { x: 2, y: 0 } },
      { type: 'L', p0: { x: 1.02, y: 0.8 }, p1: { x: 1.02, y: 1.1 } }, // the near-miss grazed wall
    ];
    const m = { outer: { x: 2, y: 0 }, inner: { x: 1, y: 1 }, aIdx: 3, bIdx: 0 };
    const t = 1;
    const margin = miterTipMargin(outerPrims, m, t * MITER_CORNER_EXCLUDE_T_FRAC);
    expect(margin).toBeLessThan(0.05);
    expect(miterStaysInsideWood(outerPrims, [m], t)).toBe(false);
  });

  it('a literal re-crossing reads margin 0, for free, as the hooked-tip test\'s own strict special case', () => {
    const outerPrims = [
      { type: 'L', p0: { x: 2, y: 0 }, p1: { x: 2, y: 2 } },
      { type: 'L', p0: { x: 2, y: 2 }, p1: { x: 0, y: 2 } },
      { type: 'L', p0: { x: 0, y: 2 }, p1: { x: 0, y: 0 } },
      { type: 'L', p0: { x: 0, y: 0 }, p1: { x: 2, y: 0 } },
      { type: 'L', p0: { x: 1, y: 0.5 }, p1: { x: 1.5, y: 0.5 } }, // crosses the miter outright
    ];
    const m = { outer: { x: 2, y: 0 }, inner: { x: 1, y: 1 }, aIdx: 3, bIdx: 0 };
    const t = 1;
    expect(miterTipMargin(outerPrims, m, t * MITER_CORNER_EXCLUDE_T_FRAC)).toBeCloseTo(0, 3);
    expect(miterStaysInsideWood(outerPrims, [m], t)).toBe(false);
  });
});

describe('H23 item 39: every template\'s own default passes', () => {
  it.each(FRAME_DEFS.templates.map((tpl) => tpl.id))('%s: default record, all 3 board sizes', (tplId) => {
    const tpl = FRAME_DEFS.templates.find((x) => x.id === tplId);
    for (const [W, H] of BOARDS) {
      const rec = normalizeFrameRecord({ templateId: tplId, seeds: {} });
      const b = board(W, H);
      const outer = frameCutProfile(FRAME_DEFS, rec, b);
      const inner = frameInnerProfile(FRAME_DEFS, rec, b);
      if (outer.defects.length || inner.defects.length) continue; // a pre-existing, unrelated defect -- not this rule's concern
      const t = frameParam(FRAME_DEFS, rec, 'frame_thickness');
      expect(miterStaysInsideWood(outer.primitives, frameMiters(outer.primitives, inner.primitives), t),
        `${tplId} ${W}x${H} default`).toBe(true);
    }
  });
});

describe('H23 item 39: T7\'s own eave -- the captured case item 38 found, confirmed by this rule', () => {
  it('seed 1 (external seed 1, GENERATE_RETRY_SALT=104729) at 7x9: a real Generate draw still thin ' +
    '-- H23 item 40 narrowed T7\'s own generateRange, so this raw draw is no longer a literal 0-margin ' +
    'crossing (it was, before item 40), but it is still a real reject below the floor, confirming the ' +
    'rule still catches a genuine near-miss graze, not just the old literal-crossing case', () => {
    const tpl = FRAME_DEFS.templates.find((x) => x.id === 'template_7');
    const b = board(7, 9);
    const region = frameCutProfile(FRAME_DEFS, normalizeFrameRecord({ templateId: 'template_7', seeds: {} }), b).region;
    const t = frameParam(FRAME_DEFS, normalizeFrameRecord({ templateId: 'template_7', seeds: {} }), 'frame_thickness');
    const seeds = generateFrameSeeds(tpl, region, 1, t); // RAW draw, no retry
    const rec = normalizeFrameRecord({ templateId: 'template_7', seeds });
    const outer = frameCutProfile(FRAME_DEFS, rec, b);
    const inner = frameInnerProfile(FRAME_DEFS, rec, b);
    expect(outer.defects).toEqual([]);
    expect(inner.defects).toEqual([]);
    const miters = frameMiters(outer.primitives, inner.primitives);
    const margins = miters.map((m) => miterTipMargin(outer.primitives, m, t * MITER_CORNER_EXCLUDE_T_FRAC));
    expect(Math.min(...margins)).toBeLessThan(t * MIN_MITER_MARGIN_T_FRAC);
    expect(miterStaysInsideWood(outer.primitives, miters, t)).toBe(false);
  });
});

// Load-proofing (seat D, 2026-10-07): the sweep below asked two questions per rejected seed with two retry loops --
// the real rule, then the pre-existing chain -- and both loops walk the SAME draws (generateFrameSeeds is seeded: seed +
// attempt * GENERATE_RETRY_SALT). Now the shipped loop runs once and records its draws; the pre-existing question is
// answered on that record. Both verdicts come from ONE evaluation of the declared rule (the first failing check):
// real = none fails, pre = none, or only the miter margin (the last check). Memoized per test case.
// MEASURED before: template_8 6x9 draws cost 2.2 s of generation + 0.8 s of checks per 500 (one rejected seed's loop),
// and the sweep ran that twice; 12 parallel runs of 3 heavy files timed it out (30-46 s a case) in 9 of 12.
function memoizedChecks(tpl, rec, b, region, t) {
  const failure = frameGenerateFailure(FRAME_DEFS, rec, b, tpl, region, t);
  const memo = new Map();
  const at = (s) => {
    const k = JSON.stringify(s);
    if (!memo.has(k)) memo.set(k, failure(s));
    return memo.get(k);
  };
  return {
    pre: (s) => { const f = at(s); return f === null || f === 'miterMargin'; },
    real: (s) => at(s) === null,
  };
}

describe('H23 item 39: generateFrame()\'s own real isValid logic, swept over every template', () => {
  // 50, not T10's own 500 (tests/frame-template-10.test.js): this sweep runs the retry loop TWICE per seed
  // that fails (once real, once pre-existing-only, to tell a regression apart from a pre-existing gap --
  // see the declared rule's note above), and template_8's own pre-existing gap (MEASURED: ~99.5% of raw
  // seeds at 6x9) makes every one of its seeds pay that double cost at the full attempts budget. 50 keeps
  // the whole 13-template sweep well under a minute; the dedicated item-39 measurement (WORK-LOG) already
  // swept up to 2000 seeds per template/board once, off the regression path.
  const N_SEEDS = 50;
  // A seed that STILL fails after the real (margin-included) retry loop is only an item-39 regression if the
  // SAME retry loop, using the pre-item-39 chain (no margin check), would have found a pass -- otherwise it's
  // a pre-existing gap in an earlier check (unrelated to this item: see the declared rule's note
  // above, and WORK-LOG for template_8's own measured case) and this sweep must not fail over it.
  // item 67 (test infra): one test per template x board x SEED_CHUNK seeds (was one test per template, all 3
  // boards x 50 seeds: template_8 took 47 s in a full run -- its pre-existing gap pays the double retry on every
  // seed). The same 50 seeds per template/board, the same check; each piece fits the declared heavy budget.
  const SEED_CHUNK = 10;
  // MEASURED: template_8 at 6x9 is ~1 s a seed (its pre-existing gap: nearly every seed runs the retry loop in full,
  // all 500 draws) -- its own smaller chunk. Load-proofing (seat D): one seed a case (was 2: up to 3.2 s alone after
  // the single-loop change above, 30-46 s a case at 6-8x load before it); the same 50 seeds.
  const SEED_CHUNK_FOR = { 'template_8 6x9': 1 };
  const CASES = FRAME_DEFS.templates.flatMap((tpl) => BOARDS.flatMap(([W, H]) => {
    const n = SEED_CHUNK_FOR[`${tpl.id} ${W}x${H}`] || SEED_CHUNK;
    return Array.from({ length: N_SEEDS / n }, (_, k) => [`${tpl.id} ${W}x${H} seeds ${k * n + 1}-${(k + 1) * n}`, tpl.id, W, H, k * n + 1, n]);
  }));
  it.each(CASES)('%s: each passes the real isValid whenever the pre-existing (pre-item-39) chain could have, ' +
    'using the shipped GENERATE_MAX_ATTEMPTS', (_name, tplId, W, H, first, n) => {
    const tpl = FRAME_DEFS.templates.find((x) => x.id === tplId);
    const b = board(W, H);
    const baseRec = normalizeFrameRecord({ templateId: tplId, seeds: {} });
    const region = frameCutProfile(FRAME_DEFS, baseRec, b).region;
    const t = frameParam(FRAME_DEFS, baseRec, 'frame_thickness');
    let nPreExistingGaps = 0;
    const checks = memoizedChecks(tpl, baseRec, b, region, t); // the same two verdicts, one evaluation a candidate
    for (let seed = first; seed < first + n; seed++) {
      const seen = []; // every candidate the shipped retry loop draws, in order
      const isValid = (s) => { seen.push(s); return checks.real(s); };
      const seeds = generateValidFrameSeeds(tpl, region, seed, t, isValid);
      if (isValid(seeds)) continue; // (the loop returns its last draw unchecked: this checks it, so `seen` is complete)
      // the real loop rejected every draw, so `seen` IS the sequence the pre-only loop would walk: the pre-existing
      // chain could pass iff one of them passes it (no second generation pass -- it was 2/3 of this sweep's time)
      if (!seen.some(checks.pre)) { nPreExistingGaps++; continue; } // pre-existing, out of this item's scope
      expect.fail(`${tplId} ${W}x${H} seed ${seed}: a seed the pre-existing chain could clear is still ` +
        'rejected after the real (margin-included) retry loop -- a genuine item-39 regression');
    }
    if (nPreExistingGaps) console.log(`${tplId} ${W}x${H} seeds ${first}-${first + n - 1}: ${nPreExistingGaps}/${n} ` +
      'external seeds hit a pre-existing (unrelated) gap, not an item-39 regression -- see WORK-LOG');
  }, HEAVY_TEST_MS);
});

describe('H23 item 39: mutation tests -- proving the sweep above is not vacuous', () => {
  it('MUTATION 1 (remove the margin check): T7 raw seed 2 @ 7x9 passes every check of the declared rule before ' +
    'the miter margin -- what generateFrame() accepted before this item -- yet still hooks', () => {
    const tpl = FRAME_DEFS.templates.find((x) => x.id === 'template_7');
    const b = board(7, 9);
    const baseRec = normalizeFrameRecord({ templateId: 'template_7', seeds: {} });
    const region = frameCutProfile(FRAME_DEFS, baseRec, b).region;
    const t = frameParam(FRAME_DEFS, baseRec, 'frame_thickness');
    const seeds = generateFrameSeeds(tpl, region, 2, t);
    // the declared rule's first failure for this raw draw is the margin itself: every pre-item-39 check passes
    expect(frameGenerateFailure(FRAME_DEFS, baseRec, b, tpl, region, t)(seeds), 'only the miter margin rejects it').toBe('miterMargin');
  });

  it('MUTATION 2 (an attempts budget below the measured worst case still fails for some external seeds): ' +
    'H23 item 40\'s own generateRange narrowing (template_data.py) dropped T7\'s worst-case attempts-to-' +
    'first-pass from 273 (7x9, pre-item-40) to 13 -- GENERATE_MAX_ATTEMPTS stays at 500 regardless (cheap, ' +
    'and the backstop for whatever raw pass rate the retry still needs), but the RETRY MECHANISM ITSELF ' +
    'is still load-bearing: a budget of 3 (well under the new worst case) must still fail for some seeds.', () => {
    const tpl = FRAME_DEFS.templates.find((x) => x.id === 'template_7');
    const OLD_BUDGET = 3;
    const SALT = 104729;
    const genValidWithBudget = (region, seed, t, isValid, maxAttempts) => {
      let seeds = generateFrameSeeds(tpl, region, seed, t);
      for (let attempt = 1; attempt < maxAttempts && !isValid(seeds); attempt++) {
        seeds = generateFrameSeeds(tpl, region, seed + attempt * SALT, t);
      }
      return seeds;
    };
    for (const [W, H] of [[7, 9], [9, 12]]) {
      const b = board(W, H);
      const baseRec = normalizeFrameRecord({ templateId: 'template_7', seeds: {} });
      const region = frameCutProfile(FRAME_DEFS, baseRec, b).region;
      const t = frameParam(FRAME_DEFS, baseRec, 'frame_thickness');
      const isValid = frameGenerateIsValid(FRAME_DEFS, baseRec, b, tpl, region, t);
      let sawAFailureAtOldBudget = false;
      for (let seed = 1; seed <= 400 && !sawAFailureAtOldBudget; seed++) {
        const seeds = genValidWithBudget(region, seed, t, isValid, OLD_BUDGET);
        if (!isValid(seeds)) sawAFailureAtOldBudget = true;
      }
      expect(sawAFailureAtOldBudget, `${W}x${H}: expected at least one external seed (of 400) to exceed a 3-attempt budget`).toBe(true);
    }
  }, HEAVY_TEST_MS); // item 67: the suite default (was a tighter 20 s)
});

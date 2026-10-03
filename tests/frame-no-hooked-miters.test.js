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
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord, frameParam } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import {
  frameCutProfile, frameInnerProfile, frameMiters, miterTipMargin, miterStaysInsideWood,
  MITER_CORNER_EXCLUDE_T_FRAC, MIN_MITER_MARGIN_T_FRAC,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { generateFrameSeeds, generateValidFrameSeeds } from '../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';
import { paramsFromShapeModel } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';

const board = (W, H) => ({ widthIn: W, heightIn: H });
const primLength = (p) => (p.type === 'L' ? Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y) : Math.abs(p.rx * p.dTheta));
const BOARDS = [[6, 9], [7, 9], [9, 12]];

// frame-panel.js's own generateFrame() isValid, reproduced exactly (same checks, same order) so this test
// exercises the REAL production logic rather than a reconstruction -- matches tests/frame-template-10.test.js's
// own established pattern.
function realIsValid(tpl, rec, b, region, t, s) {
  const inner = frameInnerProfile(FRAME_DEFS, { ...rec, seeds: s }, b);
  if (inner && inner.defects.length > 0) return false;
  const realSeedsFor = tpl.shapeModel?.features?.archRise
    ? (ss) => ({ ...ss, archRise: paramsFromShapeModel(tpl.silhouettePreset, tpl.shapeModel, region).archRise })
    : (ss) => ss;
  const outer = frameCutProfile(FRAME_DEFS, { ...rec, seeds: realSeedsFor(s) }, b);
  if (!outer.primitives.every((p) => primLength(p) >= t)) return false;
  if (!outer.primitives.every((p) => p.type !== 'A' || Math.abs(p.dTheta) < Math.PI)) return false;
  return miterStaysInsideWood(outer.primitives, frameMiters(outer.primitives, inner.primitives), t);
}

// The SAME chain, minus the item-39 margin check -- i.e. exactly what generateFrame()'s isValid looked like
// before this item. Used only to tell apart a genuine item-39 regression (this passes, the margin check is
// the one thing standing between it and a pass) from a PRE-EXISTING, unrelated gap in an earlier check
// (this ALSO fails, so item 39 isn't the reason the sweep below couldn't find a valid seed) -- MEASURED:
// template_8's own dippedLeftWave preset already fails the plain piece-length check for a majority of
// external seeds at 6x9, with or without the margin rule (no seed regression here; a pre-existing gap,
// same category as T7's own item-21 "no wing" fix and T10's own item-23 reflex fix, just never closed for
// T8 -- out of this item's own scope, flagged in WORK-LOG, not fixed here).
function preExistingIsValid(tpl, rec, b, region, t, s) {
  const inner = frameInnerProfile(FRAME_DEFS, { ...rec, seeds: s }, b);
  if (inner && inner.defects.length > 0) return false;
  const realSeedsFor = tpl.shapeModel?.features?.archRise
    ? (ss) => ({ ...ss, archRise: paramsFromShapeModel(tpl.silhouettePreset, tpl.shapeModel, region).archRise })
    : (ss) => ss;
  const outer = frameCutProfile(FRAME_DEFS, { ...rec, seeds: realSeedsFor(s) }, b);
  if (!outer.primitives.every((p) => primLength(p) >= t)) return false;
  return outer.primitives.every((p) => p.type !== 'A' || Math.abs(p.dTheta) < Math.PI);
}

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

describe('H23 item 39: generateFrame()\'s own real isValid logic, swept over every template', () => {
  // 50, not T10's own 500 (tests/frame-template-10.test.js): this sweep runs the retry loop TWICE per seed
  // that fails (once real, once pre-existing-only, to tell a regression apart from a pre-existing gap --
  // see preExistingIsValid's own comment), and template_8's own pre-existing gap (MEASURED: ~99.5% of raw
  // seeds at 6x9) makes every one of its seeds pay that double cost at the full attempts budget. 50 keeps
  // the whole 13-template sweep well under a minute; the dedicated item-39 measurement (WORK-LOG) already
  // swept up to 2000 seeds per template/board once, off the regression path.
  const N_SEEDS = 50;
  // A seed that STILL fails after the real (margin-included) retry loop is only an item-39 regression if the
  // SAME retry loop, using the pre-item-39 chain (no margin check), would have found a pass -- otherwise it's
  // a pre-existing gap in an earlier check (unrelated to this item: see preExistingIsValid's own comment
  // above, and WORK-LOG for template_8's own measured case) and this sweep must not fail over it.
  it.each(FRAME_DEFS.templates.map((tpl) => tpl.id))(`%s: ${N_SEEDS} seeds x 3 board sizes all pass the real ` +
    'isValid whenever the pre-existing (pre-item-39) chain could have, using the shipped GENERATE_MAX_ATTEMPTS', (tplId) => {
    const tpl = FRAME_DEFS.templates.find((x) => x.id === tplId);
    for (const [W, H] of BOARDS) {
      const b = board(W, H);
      const baseRec = normalizeFrameRecord({ templateId: tplId, seeds: {} });
      const region = frameCutProfile(FRAME_DEFS, baseRec, b).region;
      const t = frameParam(FRAME_DEFS, baseRec, 'frame_thickness');
      let nPreExistingGaps = 0;
      for (let seed = 1; seed <= N_SEEDS; seed++) {
        const isValid = (s) => realIsValid(tpl, baseRec, b, region, t, s);
        const seeds = generateValidFrameSeeds(tpl, region, seed, t, isValid);
        if (isValid(seeds)) continue;
        const preOnly = (s) => preExistingIsValid(tpl, baseRec, b, region, t, s);
        const preSeeds = generateValidFrameSeeds(tpl, region, seed, t, preOnly);
        if (!preOnly(preSeeds)) { nPreExistingGaps++; continue; } // pre-existing, out of this item's scope
        expect.fail(`${tplId} ${W}x${H} seed ${seed}: a seed the pre-existing chain could clear is still ` +
          'rejected after the real (margin-included) retry loop -- a genuine item-39 regression');
      }
      if (nPreExistingGaps) console.log(`${tplId} ${W}x${H}: ${nPreExistingGaps}/${N_SEEDS} external seeds hit a ` +
        'pre-existing (unrelated) gap, not an item-39 regression -- see WORK-LOG');
    }
  }, 90000);
});

describe('H23 item 39: mutation tests -- proving the sweep above is not vacuous', () => {
  it('MUTATION 1 (remove the margin check): T7 raw seed 2 @ 7x9 passes inner defects, piece length, and the ' +
    'reflex-arc rule -- exactly what generateFrame() looked like before this item -- yet still hooks', () => {
    const tpl = FRAME_DEFS.templates.find((x) => x.id === 'template_7');
    const b = board(7, 9);
    const baseRec = normalizeFrameRecord({ templateId: 'template_7', seeds: {} });
    const region = frameCutProfile(FRAME_DEFS, baseRec, b).region;
    const t = frameParam(FRAME_DEFS, baseRec, 'frame_thickness');
    const seeds = generateFrameSeeds(tpl, region, 2, t);
    expect(preExistingIsValid(tpl, baseRec, b, region, t, seeds), 'the old isValid accepts this raw draw').toBe(true);
    expect(realIsValid(tpl, baseRec, b, region, t, seeds), 'the real (new) isValid correctly rejects it').toBe(false);
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
      const isValid = (s) => realIsValid(tpl, baseRec, b, region, t, s);
      let sawAFailureAtOldBudget = false;
      for (let seed = 1; seed <= 400 && !sawAFailureAtOldBudget; seed++) {
        const seeds = genValidWithBudget(region, seed, t, isValid, OLD_BUDGET);
        if (!isValid(seeds)) sawAFailureAtOldBudget = true;
      }
      expect(sawAFailureAtOldBudget, `${W}x${H}: expected at least one external seed (of 400) to exceed a 3-attempt budget`).toBe(true);
    }
  }, 20000);
});

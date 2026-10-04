/**
 * core/bricks/piece-plan.js — PORTABLE (see rng.js). Small, shape-agnostic helpers shared by
 * along-path.js's own straight/gentle-curve construction AND arc-voussoir.js's own true-circle
 * construction (split out to a file of its own specifically so NEITHER has to import the OTHER --
 * along-path.js calls into arc-voussoir.js for a declared arc run, and a reverse import back here
 * would be circular).
 */
import { mulberry32, seedFor } from './rng.js';

/** One deterministic sample pick + 180deg flip for piece `id`, from `set.samples` (or a no-sample
 *  fallback if the set declares none). */
export function pickSample(set, seed, purpose, id) {
  if (!set.samples || !set.samples.length) return { sampleId: null, flip: false };
  const sampleRng = mulberry32(seedFor(seed, purpose + '-sample', id));
  const sample = set.samples[Math.floor(sampleRng() * set.samples.length)];
  const flip = mulberry32(seedFor(seed, purpose + '-flip', id))() < 0.5;
  return { sampleId: sample.id, flip };
}

/**
 * H23 item 74 (Fred via advisor): plan a single corner-bounded (or arc-segment-bounded) run's own
 * piece lengths -- as many WHOLE pieces (length = `pitch`) as fit, then exactly ONE final piece
 * sized to the best-matching declared FILL_FRACTIONS entry (never an arbitrary leftover length) --
 * "no void wider than grout, no arbitrary cut sizes." The small mismatch between that chosen
 * fraction and the run's own true remaining length is absorbed by slightly WIDENING OR NARROWING
 * every joint in THIS run (never a piece's own length) -- real masonry courses do exactly this
 * rather than cut an odd-sized brick. A run too short for even the smallest declared fraction
 * becomes a single piece spanning the whole run (still a real, correct brick, just not matching a
 * named fraction -- there is no better option shorter than the run itself).
 *
 * @param {number} runLength — arc-length of the run (straight, curved, or a true arc's own length -- never looks at shape)
 * @param {number} pitch — one WHOLE piece's own length (brickLengthIn or brickHeightIn, by orientation)
 * @param {number} nominalJoint — the set's own declared grout.widthIn
 * @param {number[]} fractions — FILL_FRACTIONS, descending
 * @returns {{lengths:number[], jointWidth:number}} lengths.length - 1 joints, each `jointWidth`
 */
export function planPieceLengths(runLength, pitch, nominalJoint, fractions) {
  const minFraction = Math.min(...fractions);
  if (runLength < pitch * minFraction - 1e-9) {
    return { lengths: [runLength], jointWidth: nominalJoint };
  }
  let wholeCount = Math.max(0, Math.floor((runLength + nominalJoint) / (pitch + nominalJoint)));
  // back off whole pieces until what's left can be covered by at least the smallest fraction
  while (wholeCount > 0 && runLength - wholeCount * (pitch + nominalJoint) < pitch * minFraction - 1e-9) wholeCount--;
  const remainder = runLength - wholeCount * (pitch + nominalJoint);
  let bestFraction = fractions[0], bestErr = Infinity;
  for (const f of fractions) {
    const err = Math.abs(remainder - f * pitch);
    if (err < bestErr) { bestErr = err; bestFraction = f; }
  }
  const lengths = [...Array(wholeCount).fill(pitch), bestFraction * pitch];
  const nJoints = wholeCount; // one joint after each whole piece; the final piece reaches the run's own true end directly
  const idealTotal = lengths.reduce((a, b) => a + b, 0) + nJoints * nominalJoint;
  const jointWidth = nJoints > 0 ? Math.max(0, nominalJoint + (runLength - idealTotal) / nJoints) : nominalJoint;
  return { lengths, jointWidth };
}

/**
 * H23 item 76 (advisor review of the wired-in fillet collapse + corner cascade): plan a run's own
 * piece lengths across its TRUE corner-to-corner reach -- `runLength` here is NOT necessarily a
 * primitive's own declared [0,totalLen] span; the CALLER (primitive-ribbon.js) measures the real
 * distance to each neighbour's own true mitre point first, which can be LONGER (a neighbour primitive
 * dropped out -- an infeasible fillet -- so this run must reach all the way to the next LIVE one) or
 * SHORTER (an ordinary declared corner simply doesn't line up with this run's own whole-pitch
 * phase) than the primitive's own nominal length.
 *
 * `planPieceLengths` above gives a fractional END piece but an unconditionally WHOLE start piece --
 * correct for a run with one open/free end, wrong for THIS codebase's every-joint-is-a-corner closed
 * contours: with no start-side correction, a run meeting a corner it doesn't naturally reach left the
 * entire mismatch for the mitre CLIP alone to absorb, two different ways depending on which direction
 * it missed by: (1) a neighbour's own dropped primitive forced ONE end piece to extend arbitrarily far
 * past its own natural size (MEASURED: up to 2.46x a nominal brick's own area, a visible oversized
 * triangle at a collapsed fillet); (2) an ordinary corner's own small, essentially RANDOM phase
 * mismatch let the clip shave an unbounded sliver off whichever piece happened to straddle the mitre
 * line (MEASURED: as small as 0.033x a nominal brick's own area, "a fractal of tiny bricks" at some
 * corners and not others, purely by chance of where each primitive's own independent whole-pitch
 * count happened to land). Both are the SAME root cause (no declared floor/ceiling on the clipped
 * remnant's own size) and the SAME fix: choose BOTH end pieces explicitly from the declared
 * `fractions` (the advisor's own approved corner set -- kingCloser/mitredThreeQuarter/mitredHalf are
 * literally fractions 1/0.75/0.5, "nothing below 1/4" is `fractions`' own smallest declared entry),
 * with whole pieces filling in between -- by CONSTRUCTION, not by hoping a generic half-plane clip
 * happens to land somewhere reasonable.
 *
 * @param {number} runLength — the TRUE corner-to-corner reach (caller-measured, see above)
 * @param {number} pitch @param {number} nominalJoint @param {number[]} fractions — same meaning as `planPieceLengths`
 * @returns {{lengths:number[], jointWidth:number}} — lengths[0] and lengths[last] are each one of
 *   `fractions`*pitch (the SAME piece when lengths.length===1); every length between is a whole pitch.
 */
export function planCornerRun(runLength, pitch, nominalJoint, fractions) {
  const minFraction = Math.min(...fractions);
  if (runLength < pitch * minFraction * 2 - 1e-9) {
    // too short for two independent end pieces (even the smallest declared fraction each) -- a
    // single piece spans the whole run, same honest fallback `planPieceLengths` uses.
    return { lengths: [runLength], jointWidth: nominalJoint };
  }
  const candidates = [];
  for (const fStart of fractions) {
    for (const fEnd of fractions) {
      const endsLen = (fStart + fEnd) * pitch;
      if (endsLen > runLength + 1e-9) continue; // even 0 whole pieces would overshoot -- not viable
      let wholeCount = Math.max(0, Math.round((runLength - endsLen - nominalJoint) / (pitch + nominalJoint)));
      // back off until the (wholeCount+1) joints between pieces don't need to go unreasonably
      // negative to absorb the mismatch -- mirrors `planPieceLengths`' own back-off loop.
      while (wholeCount > 0 && endsLen + wholeCount * pitch - pitch * 0.5 > runLength) wholeCount--;
      const nJoints = wholeCount + 1;
      const idealTotal = endsLen + wholeCount * pitch + nJoints * nominalJoint;
      const err = Math.abs(runLength - idealTotal);
      candidates.push({ fStart, fEnd, wholeCount, nJoints, idealTotal, err });
    }
  }
  // T86 item 1 follow-up (advisor review, "the top band's first and last pieces are thin strips"):
  // MEASURED the raw err-minimum alone can pick a razor-thin END FRACTION (e.g. 1/4) over a FULL
  // brick at both ends for a saving of a tiny fraction of ONE joint's own width (runLength=10,
  // pitch=0.2, nominalJoint=0.034: the strict-best combo's own err is 0.012in: both-whole-ends costs
  // only 0.028in -- a 0.016in difference across a 10in run, invisible in the joint spacing, while the
  // resulting 0.05in sliver end piece is NOT invisible). Against this file's own declared design
  // intent (FILL_FRACTIONS' own header: "mostly whole bricks, minimal small cuts"), minimizing err
  // ALONE is the wrong objective on its own -- among every combo whose own err stays within a
  // declared TOLERANCE of the true best, prefer the FULLEST end pieces (max fStart+fEnd), falling
  // back to the lower err as a tiebreaker. TOLERANCE is half the set's own nominal joint width: any
  // difference smaller than that is already below what a real joint's own natural variation absorbs
  // (MEASURED: every within-tolerance combo here still keeps its own jointWidth within ~2% of
  // nominal, nowhere near visually distinguishable). Affects every corner style sharing this
  // function (mitre included) -- the SAME objective, not a butt-only special case.
  const minErr = Math.min(...candidates.map((c) => c.err));
  const tolerance = nominalJoint * 0.5;
  const within = candidates.filter((c) => c.err <= minErr + tolerance);
  // Two tiebreakers ahead of err, both the same "avoid a thin end piece" intent: first the FULLEST
  // pair by total (preferring e.g. two whole bricks over one 3/4 + one 1/4), then -- among same-total
  // pairs, which `fStart+fEnd` alone can't distinguish -- the MOST BALANCED one (maximize the smaller
  // of the two): (0.5,0.5) over (0.75,0.25)/(0.25,0.75) even though all three sum to 1 and tie on err,
  // since the latter two still produce one 1/4-fraction sliver the balanced split avoids entirely
  // (MEASURED: this exact tie on the right band's own run, runLength=8.432 in the T86 item 1 square
  // fixture -- without this second tiebreaker the thin end survived the fix above).
  const best = within.reduce((a, b) => {
    const sumA = a.fStart + a.fEnd, sumB = b.fStart + b.fEnd;
    if (sumB !== sumA) return sumB > sumA ? b : a;
    const minA = Math.min(a.fStart, a.fEnd), minB = Math.min(b.fStart, b.fEnd);
    if (minB !== minA) return minB > minA ? b : a;
    return b.err < a.err ? b : a;
  });
  const { fStart, fEnd, wholeCount, nJoints, idealTotal } = best;
  const lengths = [fStart * pitch, ...Array(wholeCount).fill(pitch), fEnd * pitch];
  const jointWidth = Math.max(0, nominalJoint + (runLength - idealTotal) / nJoints);
  return { lengths, jointWidth };
}

/**
 * H23 item 76 (advisor review, "nothing below 1/4"... "no piece larger than a whole brick, cap the
 * piece area at 1.2x"): MERGE any piece whose own CLIPPED area falls below `floorFraction` of one
 * whole piece's own nominal area into its immediate neighbour, in place. `planCornerRun`'s own
 * declared fractions bound a piece's PLANNED (pre-clip) length, but the mitre clip itself can still
 * trim an individual piece's own FINAL area to an arbitrary sliver wherever the mitre line happens to
 * cross close to a planned boundary (MEASURED: as small as 0.03% of a nominal brick -- a near-zero-
 * area triangle) -- a property of the CLIP, not of the plan, so it can only be caught after the real
 * (clipped) area is known, not predicted in advance from `lengths` alone.
 *
 * The CEILING guard matters just as much as the merge itself: a run of several consecutive slivers
 * can still sit under `floorFraction` even combined (several genuinely tiny pieces in a row), so the
 * naive "merge forward while under floor" loop can keep pulling in neighbours and, on the merge that
 * FINALLY clears the floor, accidentally swallow an already-normal-sized piece whole -- MEASURED: a
 * merge chain that stayed under the 0.25 floor through two tiny pieces then absorbed a full ~1.0
 * piece on the third step, landing at 1.27x, over the advisor's own declared 1.2x cap. Never merging
 * past `ceilingFraction` means that rare case leaves ONE sliver below the floor rather than ever
 * building a piece above the ceiling -- the explicit, numbered cap is the harder constraint of the
 * two (an oversized piece is what item 1 was specifically about), so it wins when they conflict.
 *
 * @param {{sA:number, sB:number}[]} spans — mutated in place (`sA`/`sB` are whatever coordinate the
 *   caller's own `areaOf` understands -- linear inches for a straight run, radians for an arc).
 * @param {(sA:number, sB:number) => number} areaOf — returns a span's own TRUE (clipped) area,
 *   built exactly the way the caller will build the final piece.
 * @param {number} nominalArea — one whole piece's own nominal (unclipped) area.
 */
export function mergeSlivers(spans, areaOf, nominalArea, floorFraction = 0.25, ceilingFraction = 1.2) {
  const floor = nominalArea * floorFraction, ceiling = nominalArea * ceilingFraction;
  while (spans.length > 1 && areaOf(spans[0].sA, spans[0].sB) < floor) {
    const merged = { sA: spans[0].sA, sB: spans[1].sB };
    if (areaOf(merged.sA, merged.sB) > ceiling) break;
    spans[1].sA = merged.sA;
    spans.shift();
  }
  while (spans.length > 1 && areaOf(spans[spans.length - 1].sA, spans[spans.length - 1].sB) < floor) {
    const merged = { sA: spans[spans.length - 2].sA, sB: spans[spans.length - 1].sB };
    if (areaOf(merged.sA, merged.sB) > ceiling) break;
    spans[spans.length - 2].sB = merged.sB;
    spans.pop();
  }
}

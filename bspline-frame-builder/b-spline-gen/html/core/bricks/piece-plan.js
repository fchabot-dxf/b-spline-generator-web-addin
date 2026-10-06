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
/** T86 item 22: a RUSTIC run (library.js RUSTIC, `rustic` 0..1): whole pieces of random length in the declared range
 *  (`rand(k)` in [0, 1), seeded by the caller) for as long as at least the smallest fraction still fits after them;
 *  the rest is one end piece (two halves if it is longer than the range allows). Joints stay the nominal width. */
export function planRusticLengths(runLength, pitch, nominalJoint, fractions, rustic, spread, rand) {
  const minEnd = Math.min(...fractions) * pitch;
  if (runLength < minEnd - 1e-9) return { lengths: [runLength], jointWidth: nominalJoint };
  const lo = pitch * (1 - spread * rustic), hi = pitch * (1 + spread * rustic);
  const lengths = [];
  let used = 0;
  for (let k = 0; ; k++) {
    const l = lo + (hi - lo) * rand(k);
    if (used + l + nominalJoint + minEnd > runLength) break;
    lengths.push(l);
    used += l + nominalJoint;
  }
  const rest = runLength - used;
  if (rest <= hi) lengths.push(rest);
  else lengths.push((rest - nominalJoint) / 2, (rest - nominalJoint) / 2);
  return { lengths, jointWidth: nominalJoint };
}

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
 * @param {number[]} [sequence] — T86 item 2: the declared, CYCLED along-run lengths for the MIDDLE
 *   (whole) pieces -- `[pitch]` (the default, when omitted) reproduces today's exact uniform-pitch
 *   behaviour byte for byte. A longer array (e.g. flemish's own `[L, H]`) makes consecutive middle
 *   pieces alternate lengths; `pitch` itself keeps its EXISTING meaning throughout (the end pieces'
 *   own fraction base, and the short-run floor below) -- `sequence` only ever governs what fills the
 *   space BETWEEN the two declared end pieces.
 * @param {number} [forcedFStart] — T86 item 2: when given, restricts the START end piece to exactly
 *   this ONE declared fraction (skipping the free fStart search) -- row-to-row stagger (running
 *   bond's own half-brick offset between courses) is `forcedFStart=0.5` on alternate rows, not a new
 *   concept: 0.5 is already one of `FILL_FRACTIONS`' own declared values, so "staggered" is just
 *   "the search is narrowed to the one fraction a real half-brick offset needs," matching how
 *   `layouts/bond.js`'s own `uniformRow` forces its row stagger today (a declared offset, not a free
 *   optimisation) -- never a NEW kind of cut.
 * @returns {{lengths:number[], jointWidth:number}} — lengths[0] and lengths[last] are each one of
 *   `fractions`*pitch (the SAME piece when lengths.length===1); every length between cycles `sequence`.
 */
export function planCornerRun(runLength, pitch, nominalJoint, fractions, sequence, forcedFStart) {
  // T86 item 21b, the JOINT RULE (advisor + Fred, 2026-10-06): every joint is the declared grout width; the run's
  // length error goes into its two END pieces (closers), never into its joints. MEASURED before: the old search kept
  // the ends on FILL_FRACTIONS and flexed every joint to absorb the error (jointWidth = nominal + slack / joints) --
  // over 456 band lays, 960 straight-run joints came out exactly 0 wide (a 0-gap seam: a zero-area sliver profile in
  // Fusion, seat A's e2e), 5,066 under 0.029 in and 264 over 0.09 in (nominal 0.034).
  // Declared: the middle pieces cycle `sequence` (whole bricks); the fewest of them that keep each closer within
  // CLOSER_MAX_FRACTION of a brick; a staggered row's start keeps its declared fraction and the end closer takes all the
  // slack; a closer under MIN_CLOSER_FRACTION gives back a whole piece; a run too short for two closers is one piece.
  const seq = sequence && sequence.length ? sequence : [pitch];
  const minClose = MIN_CLOSER_FRACTION * pitch, maxClose = CLOSER_MAX_FRACTION * pitch;
  if (runLength < 2 * minClose + nominalJoint - 1e-9) return { lengths: [runLength], jointWidth: nominalJoint };
  const wholeTotal = (w) => { let t = 0; for (let k = 0; k < w; k++) t += seq[k % seq.length]; return t; };
  const closers = (w) => {
    const left = runLength - wholeTotal(w) - (w + 1) * nominalJoint; // what the two closers share
    if (forcedFStart != null) { const a = forcedFStart * pitch; return [a, left - a]; }
    return [left / 2, left / 2];
  };
  let w = 0;
  while (Math.max(...closers(w)) > maxClose && closers(w + 1).every((c) => c >= minClose)) w++;
  while (w > 0 && Math.min(...closers(w)) < minClose) w--;
  const [a, b] = closers(w);
  if (Math.min(a, b) < minClose) {
    // even no whole piece leaves a closer under the floor (a short run, or a stagger that does not fit): one piece
    // when it is no longer than a brick and a bit, else two equal closers
    if (runLength <= maxClose) return { lengths: [runLength], jointWidth: nominalJoint };
    const half = (runLength - nominalJoint) / 2;
    return { lengths: [half, half], jointWidth: nominalJoint };
  }
  const middle = [];
  for (let k = 0; k < w; k++) middle.push(seq[k % seq.length]);
  return { lengths: [a, ...middle, b], jointWidth: nominalJoint };
}
// T86 item 21b: a closer (a run's end piece, which takes the run's slack) is at least this much of a brick, at most
// CLOSER_MAX_FRACTION (the 1.2x piece ceiling mergeSlivers already declares)
export const MIN_CLOSER_FRACTION = 0.25;
export const CLOSER_MAX_FRACTION = 1.2;

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

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

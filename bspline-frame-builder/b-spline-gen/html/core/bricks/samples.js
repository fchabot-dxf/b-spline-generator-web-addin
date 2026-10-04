/**
 * core/bricks/samples.js — PORTABLE (see rng.js). Per-cell SAMPLE + flip + jitter assignment.
 * Shape-agnostic (works on any cell with an `.id`); independent per cell via rng.seedFor, so this
 * never depends on iteration order.
 *
 * Fred's own rules: "each brick a random sample" (seeded), "flipped 180 at random", "small height
 * jitter", "a few odd samples can appear at a low, declared rate" -- a set may flag some of its
 * own samples `odd:true` (library.js's own Set 1: the 4 measurably-darker red-brick crops); those
 * are drawn from their own pool at `set.oddSampleRate` (default 0, i.e. no effect for a set that
 * declares no odd samples) instead of sharing the main pool's own uniform weight.
 */
import { mulberry32, seedFor } from './rng.js';

/**
 * @param {Array} cells
 * @param {{samples: {id:string, odd?:boolean}[], heightJitterIn:number, oddSampleRate?:number}} set
 * @param {number} seed
 * @returns {Map<number, {sampleId:string, flip:boolean, heightOffset:number}>}
 */
export function assignSamples(cells, set, seed) {
  const out = new Map();
  const jitter = set.heightJitterIn ?? 0;
  const oddPool = set.samples.filter((s) => s.odd);
  const mainPool = set.samples.filter((s) => !s.odd);
  const oddRate = oddPool.length ? (set.oddSampleRate ?? 0) : 0;
  for (const cell of cells) {
    const oddRng = mulberry32(seedFor(seed, 'odd-pick', cell.id));
    const useOdd = oddRng() < oddRate;
    const pool = useOdd ? oddPool : (mainPool.length ? mainPool : set.samples);
    const sampleRng = mulberry32(seedFor(seed, 'sample', cell.id));
    const sample = pool[Math.floor(sampleRng() * pool.length)];
    const flip = mulberry32(seedFor(seed, 'flip', cell.id))() < 0.5;
    const jitterRng = mulberry32(seedFor(seed, 'jitter', cell.id));
    const heightOffset = (jitterRng() * 2 - 1) * jitter;
    out.set(cell.id, { sampleId: sample ? sample.id : null, flip, heightOffset });
  }
  return out;
}

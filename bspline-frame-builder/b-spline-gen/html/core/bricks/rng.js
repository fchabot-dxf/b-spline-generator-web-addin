/**
 * core/bricks/rng.js — PORTABLE. Zero imports (see portability.test.js): this whole `core/bricks/`
 * tree must copy-paste into another app (MathieuConnery, C:/Users/danse/APPS/MathieuConnery) with
 * no changes, so it owns its own tiny seeded RNG rather than importing this app's PerlinNoise/
 * lcgPoints (core/noise.js, editor/editor-lattice-pattern.js).
 *
 * mulberry32 — the exact algorithm MathieuConnery's own RandomizerPanel.js already uses, kept
 * byte-identical on purpose (not just "an RNG"): a seed one app recorded should reproduce the same
 * sequence in the other.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Combine a base seed with a purpose tag and an integer cell id into one 32-bit seed, so each
 * KIND of per-cell decision (piece choice, sample choice, flip, jitter, suppression score, ...)
 * gets its own independent, decorrelated-looking stream from the SAME base seed and the SAME
 * cell — never a single sequential RNG advanced call-by-call (whose output would then depend on
 * iteration order/count, not just on "which cell, which decision").
 * `purpose` is hashed from its own string so new purposes never need a manually-assigned number.
 */
export function seedFor(baseSeed, purpose, cellId) {
  let h = (baseSeed >>> 0) ^ 0x9e3779b9;
  for (let i = 0; i < purpose.length; i++) {
    h = Math.imul(h ^ purpose.charCodeAt(i), 0x85ebca6b);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (cellId | 0), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** One deterministic [0,1) value for (baseSeed, purpose, cellId) -- the common case, a single
 *  draw rather than a whole generator, for the many call sites that only need one number. */
export function hashedRandom(baseSeed, purpose, cellId) {
  return mulberry32(seedFor(baseSeed, purpose, cellId))();
}

/**
 * Shared jittered cell noise (Worley-style) for the cell-based filters
 * (T79: Hand-Carved, Faceted Stone). Promoted from Fred's approved
 * prototypes' helper (proto-filters/_cells.js) so it isn't duplicated.
 *
 * cells(x, y, salt, jitter) -> { f1, f2, id }
 *   f1 / f2: distance to the nearest / second-nearest cell point
 *   id:      0..1 value of the nearest cell (for per-cell variation)
 */
const hash = (x, y, s) => {
  const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return v - Math.floor(v);
};

export function cells(x, y, salt = 0, jitter = 0.85) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i, cy = iy + j;
      const px = cx + 0.5 + (hash(cx, cy, salt) - 0.5) * jitter;
      const py = cy + 0.5 + (hash(cx, cy, salt + 9) - 0.5) * jitter;
      const d = Math.hypot(x - px, y - py);
      if (d < f1) { f2 = f1; f1 = d; id = hash(cx, cy, salt + 3); } else if (d < f2) f2 = d;
    }
  }
  return { f1, f2, id };
}

/**
 * The seed Fred approved the cell filters at. A filter's lattice salt is
 * its approved salt plus (seed - APPROVED_SEED): seed 42 reproduces the
 * approved layout exactly, every other seed gets its own layout (the
 * prototypes used one fixed lattice for every seed -- 72-79% of Faceted
 * Stone's facets sat in the same place at seeds 42, 7 and 123).
 */
export const APPROVED_SEED = 42;
export function latticeSalt(approvedSalt, seed) {
  return approvedSalt + ((Number.isFinite(seed) ? seed : APPROVED_SEED) - APPROVED_SEED);
}

/**
 * Shared jittered cell noise (Worley-style) for the cell-based filters
 * (T79: Hand-Carved, Faceted Stone, River Stones, Pond Ripples). Promoted
 * from Fred's approved prototypes' helper (proto-filters/_cells.js) so it
 * isn't duplicated.
 *
 * cells(x, y, salt, jitter) -> { f1, f2, id, id2 }
 *   f1 / f2:  distance to the nearest / second-nearest cell point
 *   id / id2: 0..1 value of the nearest / second-nearest cell
 */
const hash = (x, y, s) => {
  const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return v - Math.floor(v);
};

export function cells(x, y, salt = 0, jitter = 0.85) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0, id2 = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i, cy = iy + j;
      const px = cx + 0.5 + (hash(cx, cy, salt) - 0.5) * jitter;
      const py = cy + 0.5 + (hash(cx, cy, salt + 9) - 0.5) * jitter;
      const d = Math.hypot(x - px, y - py);
      if (d < f1) { f2 = f1; id2 = id; f1 = d; id = hash(cx, cy, salt + 3); } else if (d < f2) { f2 = d; id2 = hash(cx, cy, salt + 3); }
    }
  }
  return { f1, f2, id, id2 };
}

/**
 * Smooth nearest-cell distance (log-sum-exp smooth-min over a 5x5 block):
 * rounded, crease-free. -> { d, id, idSmooth }
 *   id:       the nearest cell's value (as the prototype used it)
 *   idSmooth: cell values weighted by exp(-idK * distance), so it changes
 *             smoothly across a cell boundary instead of jumping (a jump
 *             there is a step in anything scaled by it). A sharper idK than
 *             k keeps it equal to the nearest cell's value except in a narrow
 *             band at the boundary.
 */
export function smoothF1(x, y, salt = 0, k = 9, jitter = 0.85, idK = k) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const dist = [], ids = [];
  let s = 0, id = 0, best = 9;
  for (let j = -2; j <= 2; j++) {
    for (let i = -2; i <= 2; i++) {
      const cx = ix + i, cy = iy + j;
      const px = cx + 0.5 + (hash(cx, cy, salt) - 0.5) * jitter;
      const py = cy + 0.5 + (hash(cx, cy, salt + 9) - 0.5) * jitter;
      const d = Math.hypot(x - px, y - py);
      const cellId = hash(cx, cy, salt + 3);
      s += Math.exp(-k * d);
      dist.push(d); ids.push(cellId);
      if (d < best) { best = d; id = cellId; }
    }
  }
  // Weights relative to the nearest cell, so a sharp idK can't underflow.
  let sId = 0, sIdW = 0;
  for (let n = 0; n < dist.length; n++) {
    const w = Math.exp(-idK * (dist[n] - best));
    sId += w * ids[n];
    sIdW += w;
  }
  return { d: -Math.log(s) / k, id, idSmooth: sId / sIdW };
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

/**
 * The width of `meshCells` cells of the board's own mesh, in the units of a
 * cell lattice whose coordinate is su * unitsPerSu (su runs 0..1 over half
 * the board width). A cell filter's thin features (seams, rims) must be at
 * least a few mesh cells wide, or the mesh only catches them where they
 * cross a vertex and draws them dotted.
 */
export function meshCellsInLattice(params, unitsPerSu, meshCells) {
  const widthIn = params.widthIn ?? 7;
  const meshIn = widthIn / Math.max(1, (params.nx ?? 141) - 1);
  return (meshCells * meshIn * unitsPerSu) / (widthIn / 2);
}

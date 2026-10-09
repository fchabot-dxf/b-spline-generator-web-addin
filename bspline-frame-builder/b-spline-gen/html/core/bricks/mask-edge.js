/**
 * core/bricks/mask-edge.js -- PORTABLE (see rng.js). Item 74n (Fred, phone: "thin bricks on the edges"): a teeth fringe
 * along the panel's cut edge. Measured (T1 1 in basketweave, 0.05 in grid): within 0.025 in INSIDE the outline only 8%
 * of the grid points stood at brick height vs 84% from 0.025 in in (the cut edge carries each brick's shoulder + a
 * joint), and the points just outside sat at the grout recess; the exact 3D trim cut the triangles the curved outline
 * crosses through that low band = teeth. Carrying only the inside edge height outward did NOT help (measured: same teeth).
 *
 * The fix, declared here: the grid points in a ring BRICK_MASK_EDGE_RING_CELLS deep inside the outline, and those
 * outside it within BRICK_MASK_EDGE_BLEED_CELLS, each name the nearest point DEEPER than the ring (`maskEdgeSource`); the
 * brick pass (core/engine/apply-stamp-layers.js) copies that point's final height across. A cut brick then reads as
 * sawn: full height to the edge. Every point deeper than the ring is unchanged (measured hash-equal, 20,663 points).
 * The inset window's opening needs none: its bricks are not cut there and its edge runs on grid lines (measured: 88% of
 * the points within 0.025 in of the hole raised, as inside; no teeth in the close-up).
 */
import { polygonPointTester } from './geometry.js';

/** How far past the outline (grid points) the bricks' edge height is carried: one covers every crossed triangle; two
 *  covers a trim loop sampled a little outside its true curve. */
export const BRICK_MASK_EDGE_BLEED_CELLS = 2;
/** How deep inside the outline (grid points) the low cut-edge band is replaced. The band is under 0.025 in wide: one
 *  point covers it on the default 0.05 in grid and every coarser one (measured at 0.05 in). On a finer grid (down to
 *  0.011 in) the band spans several points and is drawn as the rounded shoulder it is -- not measured for teeth there. */
export const BRICK_MASK_EDGE_RING_CELLS = 1;

/**
 * @param {Array<{x:number,y:number}>} outline -- the panel's trim loop, board inches (editor: origin top-left, y down)
 * @returns {Int32Array|null} per grid point (k = j * nx + i, row j at y = H * (1 - j / (nz - 1)), the height grid's own
 *   layout): the deep inside point whose height it takes, -1 for none (every deep point); null when nothing is in reach
 */
export function maskEdgeSource(outline, nx, nz, widthIn, heightIn, cells = BRICK_MASK_EDGE_BLEED_CELLS, ring = BRICK_MASK_EDGE_RING_CELLS) {
  if (!outline || outline.length < 3 || !(cells > 0) || !(nx > 1) || !(nz > 1)) return null;
  const iSpan = nx - 1, jSpan = nz - 1;
  const inside = new Uint8Array(nx * nz);
  // polygonPointTester: pointInPolygon's own answer, the outline's edges bucketed by y (MEASURED 2026-10-08, phone 4x, a
  // laid board: testing every grid point against every outline edge was 2.2 s of a 0.03 in spacing change)
  const inOutline = polygonPointTester(outline);
  for (let j = 0; j < nz; j++) {
    const y = heightIn * (1 - j / jSpan);
    for (let i = 0; i < nx; i++) inside[j * nx + i] = inOutline((i / iSpan) * widthIn, y) ? 1 : 0;
  }
  // deep = inside with no outside point within `ring` grid points (the sources); the ring inside is a target too
  const deep = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (!inside[k]) continue;
    let ok = true;
    for (let dj = -ring; dj <= ring && ok; dj++) for (let di = -ring; di <= ring && ok; di++) {
      const jj = j + dj, ii = i + di;
      if (jj >= 0 && jj < nz && ii >= 0 && ii < nx && di * di + dj * dj <= ring * ring && !inside[jj * nx + ii]) ok = false;
    }
    deep[k] = ok ? 1 : 0;
  }
  const src = new Int32Array(nx * nz).fill(-1);
  let any = false;
  const r = Math.ceil(cells + ring);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (deep[k]) continue;
      let best = -1, bestD = Infinity;
      for (let dj = -r; dj <= r; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= nz) continue;
        for (let di = -r; di <= r; di++) {
          const ii = i + di;
          if (ii < 0 || ii >= nx) continue;
          const d = di * di + dj * dj;
          if (d > (cells + ring) * (cells + ring) || d >= bestD || !deep[jj * nx + ii]) continue;
          best = jj * nx + ii; bestD = d;
        }
      }
      if (best >= 0) { src[k] = best; any = true; }
    }
  }
  return any ? src : null;
}

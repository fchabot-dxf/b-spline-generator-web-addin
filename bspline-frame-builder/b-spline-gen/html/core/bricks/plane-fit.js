/**
 * core/bricks/plane-fit.js — F35 item 16 follow-up (Fred's target look): the "Flat" brick-top mode
 * -- each brick is a rigid flat block tilted to the terrain's own AVERAGE slope under its footprint,
 * rather than bending to follow every local bump ("Organic", today's only behaviour). A plain
 * least-squares plane fit through terrain samples, pure geometry with no brick-specific knowledge.
 * F35 item 18: core/engine/apply-stamp-layers.js (flatBrickPlaneHeights) is the one caller -- it fits
 * each brick's plane at composite time over every grid point the brick covers, against the live
 * terrain (see its header for why not at mask time), and keeps grout draped.
 */

/**
 * Least-squares plane z = a*x + b*y + c through `points` ({x,y,z}[]). Standard normal-equations
 * solve (3x3, Cramer's rule), O(points) -- the caller centres x/y on the brick so the system stays
 * well conditioned at any grid resolution.
 *
 * Degenerate inputs (fewer than 3 points, or a singular system -- e.g. every sample at the exact
 * same point) fall back to a FLAT, level plane at the mean sampled height: still a valid "least
 * squares best flat approximation" in the degenerate case (a=b=0), never NaN/undefined.
 */
export function fitPlane(points) {
  let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, sn = 0, sxz = 0, syz = 0, sz = 0;
  for (const p of points) {
    sxx += p.x * p.x; sxy += p.x * p.y; sx += p.x;
    syy += p.y * p.y; sy += p.y; sn += 1;
    sxz += p.x * p.z; syz += p.y * p.z; sz += p.z;
  }
  const meanZ = sn > 0 ? sz / sn : 0;

  // | sxx sxy sx | |a|   |sxz|
  // | sxy syy sy | |b| = |syz|
  // | sx  sy  sn | |c|   |sz |
  const det =
    sxx * (syy * sn - sy * sy) -
    sxy * (sxy * sn - sy * sx) +
    sx * (sxy * sy - syy * sx);

  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) {
    return { a: 0, b: 0, c: meanZ, eval: (x, y) => meanZ };
  }

  const detA =
    sxz * (syy * sn - sy * sy) -
    sxy * (syz * sn - sy * sz) +
    sx * (syz * sy - syy * sz);
  const detB =
    sxx * (syz * sn - sz * sy) -
    sxz * (sxy * sn - sy * sx) +
    sx * (sxy * sz - syz * sx);
  const detC =
    sxx * (syy * sz - sy * syz) -
    sxy * (sxy * sz - syz * sx) +
    sxz * (sxy * sy - syy * sx);

  const a = detA / det, b = detB / det, c = detC / det;
  return { a, b, c, eval: (x, y) => a * x + b * y + c };
}

/**
 * sculpt.js — Soft-body Z-only sculpt brush for control-point height grid.
 *
 * All math functions are pure (no side effects except on the delta arrays
 * that are explicitly passed as mutable).  Undo snapshots and UI state
 * are managed in main.js; only the math lives here.
 *
 * Coordinate convention: delta[j*nx+i], x = col(i), y = row(j), z = height.
 * All physical distances in inches.  dZ > 0 = push up, dZ < 0 = push down.
 */

// ── Falloff ──────────────────────────────────────────────────────────────────

/**
 * Smooth falloff: 1 at centre (t=0), 0 at edge (t=1).
 * Uses inverse smoothstep so the dome is full at the brush centre and
 * tapers gently to zero at the radius boundary — no hard edge.
 */
function falloff(t) {
  const c = Math.max(0, Math.min(1, t));
  const s = c * c * (3 - 2 * c);   // smoothstep (0→1)
  return 1 - s;                      // inverted: 1 at centre, 0 at edge
}

// ── Brush iterator ───────────────────────────────────────────────────────────

/**
 * Iterate over every grid point that falls within the brush radius, calling
 * `callback(ni, nj, idx, distIn)` for each.
 *
 * Centralises all boundary checking, grid math, and distance filtering so
 * that applyStroke / safePreStrokeScale / safePostStrokeScale only contain
 * their own payload logic.
 *
 * @param {number} nx           grid columns
 * @param {number} nz           grid rows
 * @param {number} ci           stroke-centre column index
 * @param {number} cj           stroke-centre row index
 * @param {number} widthIn      physical grid width  (inches)
 * @param {number} heightIn     physical grid height (inches)
 * @param {number} radiusIn     falloff radius (inches)
 * @param {function(ni:number, nj:number, idx:number, distIn:number):void} callback
 */
function forEachPointInBrush(nx, nz, ci, cj, widthIn, heightIn, radiusIn, callback) {
  const dx = widthIn  / (nx - 1);
  const dy = heightIn / (nz - 1);
  const rc = Math.ceil(radiusIn / Math.min(dx, dy)) + 1;

  for (let dj = -rc; dj <= rc; dj++) {
    const nj = cj + dj;
    if (nj < 0 || nj >= nz) continue;
    for (let di = -rc; di <= rc; di++) {
      const ni = ci + di;
      if (ni < 0 || ni >= nx) continue;
      const distIn = Math.hypot(di * dx, dj * dy);
      if (distIn >= radiusIn) continue;
      callback(ni, nj, nj * nx + ni, distIn);
    }
  }
}

// ── Core stroke ──────────────────────────────────────────────────────────────

/**
 * Apply a sculpt stroke to a mutable delta array.
 *
 * @param {Float32Array} delta   [nx*nz] height deltas — modified in place
 * @param {number} nx            grid columns
 * @param {number} nz            grid rows
 * @param {number} ci            stroke-centre column index
 * @param {number} cj            stroke-centre row index
 * @param {number} widthIn       physical grid width (inches)
 * @param {number} heightIn      physical grid height (inches)
 * @param {number} dZ            signed height change at centre (inches)
 * @param {number} radiusIn      falloff radius (inches)
 */
export function applyStroke(delta, nx, nz, ci, cj, widthIn, heightIn, dZ, radiusIn) {
  forEachPointInBrush(nx, nz, ci, cj, widthIn, heightIn, radiusIn, (ni, nj, idx, distIn) => {
    delta[idx] += dZ * falloff(distIn / radiusIn);
  });
}

// ── Pre-thicken safety (bounds check) ────────────────────────────────────────

/**
 * Compute the max safe scale factor [0..1] for a pre-thicken stroke so no
 * point exceeds [0, carveZ] after the stroke is applied.
 *
 * Returns 1.0 if the full stroke fits within bounds.
 * Returns < 1.0 if some points would hit a bound; the returned factor is the
 * largest t such that t * stroke stays within bounds everywhere.
 */
export function safePreStrokeScale(heights, preDelta, carveZ,
                                   nx, nz, ci, cj, widthIn, heightIn, dZ, radiusIn) {
  let tMin = 1.0;
  forEachPointInBrush(nx, nz, ci, cj, widthIn, heightIn, radiusIn, (ni, nj, idx, distIn) => {
    const contrib = dZ * falloff(distIn / radiusIn);
    const curZ    = heights[idx] + preDelta[idx];
    if (contrib > 1e-9) {
      // Pushing up — check ceiling
      const avail = carveZ - curZ;
      if (avail < contrib) tMin = Math.min(tMin, Math.max(0, avail / contrib));
    } else if (contrib < -1e-9) {
      // Pushing down — check floor (0)
      const avail = curZ;
      if (avail < -contrib) tMin = Math.min(tMin, Math.max(0, avail / -contrib));
    }
  });
  return tMin;
}

/**
 * Audit the current pre-delta for out-of-bounds points.
 * @returns {{ count: number, maxOver: number, maxUnder: number }}
 */
export function checkPreBounds(heights, preDelta, nx, nz, carveZ) {
  let count = 0, maxOver = 0, maxUnder = 0;
  for (let k = 0, n = nx * nz; k < n; k++) {
    const z = heights[k] + preDelta[k];
    if (z > carveZ) { count++; maxOver  = Math.max(maxOver,  z - carveZ); }
    if (z < 0)      { count++; maxUnder = Math.max(maxUnder, -z);         }
  }
  return { count, maxOver, maxUnder };
}

// ── Post-thicken safety (intersection check) ─────────────────────────────────

/**
 * Compute the max safe scale factor [0..1] for a post-thicken stroke so the
 * bottom surface does not penetrate the top.
 *
 * @param {Float32Array} topZ      top surface heights [nx*nz] (incl. pre-delta)
 * @param {Float32Array} offsetPts flat [nx*nz*3] bottom control-point positions
 * @param {Float32Array} postDelta current post-thicken delta [nx*nz]
 * @param {number} nx, nz
 * @param {number} ci, cj          stroke centre
 * @param {number} widthIn, heightIn
 * @param {number} dZ              proposed delta
 * @param {number} radiusIn
 * @returns {number} scale factor [0..1]
 */
export function safePostStrokeScale(topZ, offsetPts, postDelta,
                                    nx, nz, ci, cj, widthIn, heightIn, dZ, radiusIn) {
  const MARGIN = 1e-3;   // 1-mil clearance
  let tMin = 1.0;
  forEachPointInBrush(nx, nz, ci, cj, widthIn, heightIn, radiusIn, (ni, nj, idx, distIn) => {
    const contrib = dZ * falloff(distIn / radiusIn);
    const curBot  = offsetPts[idx * 3 + 2] + postDelta[idx];
    const avail   = topZ[idx] - curBot - MARGIN;
    if (contrib > 1e-9) {
      // Moving bottom toward top
      if (avail < contrib) tMin = Math.min(tMin, Math.max(0, avail / contrib));
    }
  });
  return tMin;
}

/**
 * Count how many bottom control points currently penetrate the top surface.
 * @returns {number}
 */
export function countPostIntersections(topZ, offsetPts, postDelta, nx, nz) {
  let count = 0;
  for (let k = 0, n = nx * nz; k < n; k++) {
    if (offsetPts[k * 3 + 2] + postDelta[k] >= topZ[k] - 1e-4) count++;
  }
  return count;
}

// ── Delta utilities ───────────────────────────────────────────────────────────

/**
 * Bilinear resample a delta array to a new grid size.
 * Used when the user changes resolution (spacing).
 */
export function resampleDelta(oldDelta, oldNx, oldNz, newNx, newNz) {
  const out = new Float32Array(newNx * newNz);
  for (let j = 0; j < newNz; j++) {
    const v  = (j / Math.max(1, newNz - 1)) * (oldNz - 1);
    const j0 = Math.min(oldNz - 2, Math.floor(v));
    const j1 = j0 + 1;
    const vf = v - j0;
    for (let i = 0; i < newNx; i++) {
      const u  = (i / Math.max(1, newNx - 1)) * (oldNx - 1);
      const i0 = Math.min(oldNx - 2, Math.floor(u));
      const i1 = i0 + 1;
      const uf = u - i0;
      out[j * newNx + i] =
        (1 - uf) * (1 - vf) * oldDelta[j0 * oldNx + i0] +
        uf       * (1 - vf) * oldDelta[j0 * oldNx + i1] +
        (1 - uf) * vf       * oldDelta[j1 * oldNx + i0] +
        uf       * vf       * oldDelta[j1 * oldNx + i1];
    }
  }
  return out;
}

/** Clone a Float32Array — used for undo snapshots. */
export function cloneDelta(arr) { return new Float32Array(arr); }

/** True if every element is zero (untouched delta). */
export function isDeltaEmpty(arr) {
  for (let i = 0; i < arr.length; i++) if (arr[i] !== 0) return false;
  return true;
}

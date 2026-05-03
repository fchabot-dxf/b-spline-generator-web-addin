/**
 * thicken.js — Surface normal computation, curvature-based safe-offset map,
 *              and offset control-point generation for the Thicken feature.
 *
 * Coordinate convention: heights[j*nx+i], x = col(i), y = row(j), z = height.
 * All distances in inches.
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Clamped height accessor (edge clamping) */
function H(heights, nx, nz, i, j) {
  return heights[Math.max(0, Math.min(nz - 1, j)) * nx + Math.max(0, Math.min(nx - 1, i))];
}

/**
 * Gaussian smooth a height field with a given sigma (in grid-cell units).
 * Optimized with a pre-computed 1D kernel.
 */
function gaussianSmooth(heights, nx, nz, sigma) {
  if (sigma <= 0) return new Float32Array(heights);
  const radius = Math.ceil(sigma * 2.5);
  const inv2s2 = 1 / (2 * sigma * sigma);
  const temp = new Float32Array(heights.length);
  const out  = new Float32Array(heights.length);

  // Pre-compute Gaussian Kernel
  const weights = new Float32Array(radius * 2 + 1);
  let wSumOverall = 0;
  for (let d = -radius; d <= radius; d++) {
    const wk = Math.exp(-(d * d) * inv2s2);
    weights[d + radius] = wk;
    wSumOverall += wk;
  }

  // Pass 1: X
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
        let sum = 0, wSum = 0;
        for (let di = -radius; di <= radius; di++) {
            const ni = i + di;
            if (ni < 0 || ni >= nx) continue;
            const wk = weights[di + radius];
            sum += heights[j * nx + ni] * wk;
            wSum += wk;
        }
        temp[j * nx + i] = sum / wSum;
    }
  }
  // Pass 2: Y
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
        let sum = 0, wSum = 0;
        for (let dj = -radius; dj <= radius; dj++) {
            const nj = j + dj;
            if (nj < 0 || nj >= nz) continue;
            const wk = weights[dj + radius];
            sum += temp[nj * nx + i] * wk;
            wSum += wk;
        }
        out[j * nx + i] = sum / wSum;
    }
  }
  return out;
}

// Make gaussianSmooth available globally for main.js
window.gaussianSmooth = gaussianSmooth;

// ── Normal computation ────────────────────────────────────────────────────────

/**
 * Compute unit normals at every grid point using finite differences.
 * Returns Float32Array[nx*nz*3]: (nx,ny,nz) per point, normal points +Z side.
 */
export function computeNormals(heights, nx, nz, widthIn, heightIn) {
  const dx  = widthIn  / (nx - 1);
  const dy  = heightIn / (nz - 1);
  const out = new Float32Array(nx * nz * 3);

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const fx = (i === 0)    ? (H(heights,nx,nz,i+1,j) - H(heights,nx,nz,i,  j)) / dx
               : (i === nx-1) ? (H(heights,nx,nz,i,  j) - H(heights,nx,nz,i-1,j)) / dx
               :                (H(heights,nx,nz,i+1,j) - H(heights,nx,nz,i-1,j)) / (2*dx);

      const fy = (j === 0)    ? (H(heights,nx,nz,i,j+1) - H(heights,nx,nz,i,j  )) / dy
               : (j === nz-1) ? (H(heights,nx,nz,i,j  ) - H(heights,nx,nz,i,j-1)) / dy
               :                (H(heights,nx,nz,i,j+1) - H(heights,nx,nz,i,j-1)) / (2*dy);

      const len  = Math.sqrt(fx*fx + fy*fy + 1);
      const base = (j * nx + i) * 3;
      out[base]     = -fx / len;
      out[base + 1] = -fy / len;
      out[base + 2] =  1  / len;
    }
  }
  return out;
}

// ── Curvature / safe-offset map ───────────────────────────────────────────────

/**
 * Compute the safe offset distance at every grid point.
 */
export function computeSafeOffsetMap(heights, nx, nz, widthIn, heightIn, bottomSmoothIn = 0) {
  const dx   = widthIn  / (nx - 1);
  const dy   = heightIn / (nz - 1);
  const safe = new Float32Array(nx * nz);

  // Pre-smoothing for curvature estimation
  const sh = gaussianSmooth(heights, nx, nz, 1.5);

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const fx = (i === 0)    ? (H(sh,nx,nz,i+1,j) - H(sh,nx,nz,i,  j)) / dx
               : (i === nx-1) ? (H(sh,nx,nz,i,  j) - H(sh,nx,nz,i-1,j)) / dx
               :                (H(sh,nx,nz,i+1,j) - H(sh,nx,nz,i-1,j)) / (2*dx);

      const fy = (j === 0)    ? (H(sh,nx,nz,i,j+1) - H(sh,nx,nz,i,j  )) / dy
               : (j === nz-1) ? (H(sh,nx,nz,i,j  ) - H(sh,nx,nz,i,j-1)) / dy
               :                (H(sh,nx,nz,i,j+1) - H(sh,nx,nz,i,j-1)) / (2*dy);

      const fxx = (i === 0)    ? (H(sh,nx,nz,i+2,j) - 2*H(sh,nx,nz,i+1,j) + H(sh,nx,nz,i,  j)) / (dx*dx)
                : (i === nx-1) ? (H(sh,nx,nz,i,  j) - 2*H(sh,nx,nz,i-1,j) + H(sh,nx,nz,i-2,j)) / (dx*dx)
                :                (H(sh,nx,nz,i+1,j) - 2*H(sh,nx,nz,i,  j) + H(sh,nx,nz,i-1,j)) / (dx*dx);

      const fyy = (j === 0)    ? (H(sh,nx,nz,i,j+2) - 2*H(sh,nx,nz,i,j+1) + H(sh,nx,nz,i,j  )) / (dy*dy)
                : (j === nz-1) ? (H(sh,nx,nz,i,j  ) - 2*H(sh,nx,nz,i,j-1) + H(sh,nx,nz,i,j-2)) / (dy*dy)
                :                (H(sh,nx,nz,i,j+1) - 2*H(sh,nx,nz,i,j  ) + H(sh,nx,nz,i,j-1)) / (dy*dy);

      const i1 = Math.min(nx-1, i+1), i0 = Math.max(0, i-1);
      const j1 = Math.min(nz-1, j+1), j0 = Math.max(0, j-1);
      const fxy = (H(sh,nx,nz,i1,j1) - H(sh,nx,nz,i1,j0)
                 - H(sh,nx,nz,i0,j1) + H(sh,nx,nz,i0,j0)) / (4*dx*dy);

      const E     = 1 + fx*fx;
      const F     = fx*fy;
      const G     = 1 + fy*fy;
      const w     = Math.sqrt(1 + fx*fx + fy*fy);
      const L     = fxx / w;
      const M     = fxy / w;
      const N     = fyy / w;
      const EGmFF = E*G - F*F;

      const Hc   = (E*N - 2*F*M + G*L) / (2 * EGmFF);
      const Kc   = (L*N - M*M) / EGmFF;
      const disc = Math.max(0, Hc*Hc - Kc);
      const sq   = Math.sqrt(disc);
      const maxK = Math.max(Math.abs(Hc + sq), Math.abs(Hc - sq));

      safe[j * nx + i] = maxK > 1e-10 ? 1 / maxK : 999;
    }
  }

  if (bottomSmoothIn > 0) {
    const sigma = bottomSmoothIn / 2.0;
    const blurred = gaussianSmooth(safe, nx, nz, sigma);
    for (let k = 0; k < nx * nz; k++) {
      safe[k] = Math.min(safe[k], blurred[k]);
    }
  }

  return safe;
}

export function computeMaxSafeThickness(safeMap) {
  let min = Infinity;
  for (const v of safeMap) if (v < min) min = v;
  return Math.min(min, 999);
}

// ── Offset control points ─────────────────────────────────────────────────────

export function computeOffsetPoints(
  heights, normals, nx, nz, widthIn, heightIn,
  thickness, adaptive, safeMap, sign = -1
) {
  const W        = widthIn;
  const Ht       = heightIn;
  const pts      = new Float32Array(nx * nz * 3);
  const clampMap = new Float32Array(nx * nz);

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const idx  = j * nx + i;
      const base = idx * 3;

      const x = -W/2  + i * W  / (nx - 1);
      const y = -Ht/2 + j * Ht / (nz - 1);
      const z = heights[idx];

      const analyticalSafeT = Math.min(thickness, safeMap[idx]);
      clampMap[idx] = analyticalSafeT;

      const t = adaptive ? analyticalSafeT : thickness;

      pts[base]     = x + sign * normals[base]     * t;
      pts[base + 1] = y + sign * normals[base + 1] * t;
      pts[base + 2] = z + sign * normals[base + 2] * t;
    }
  }
  return { pts, clampMap };
}

export function buildHeatColours(clampMap, thickness) {
  const colours = new Float32Array(clampMap.length * 3);
  for (let k = 0; k < clampMap.length; k++) {
    const ratio = thickness > 0 ? Math.min(1, clampMap[k] / thickness) : 1;
    colours[k * 3]     = 1 - ratio; 
    colours[k * 3 + 1] = ratio;      
    colours[k * 3 + 2] = 0;          
  }
  return colours;
}

export function findWorstPoints(clampMap, heights, nx, nz, widthIn, heightIn,
                                 thickness, maxPoints = 20, minSpacingIn = 0.8) {
  const clamped = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const idx    = j * nx + i;
      const actual = clampMap[idx];
      if (actual < thickness - 1e-4) {
        const x = -widthIn/2  + i * widthIn  / (nx - 1);
        const y = -heightIn/2 + j * heightIn / (nz - 1);
        const z = heights[idx];
        clamped.push({ i, j, x, y, z, actual, requested: thickness });
      }
    }
  }
  clamped.sort((a, b) => a.actual - b.actual);
  const selected = [];
  for (const pt of clamped) {
    if (selected.length >= maxPoints) break;
    const tooClose = selected.some(s => {
      const dx = pt.x - s.x, dy = pt.y - s.y;
      return Math.sqrt(dx*dx + dy*dy) < minSpacingIn;
    });
    if (!tooClose) selected.push(pt);
  }
  return selected;
}

/**
 * Apply a spatial blur to the offset control points (the bottom surface).
 * Optimized with a separable 1D Gaussian kernel.
 */
export function smoothOffsetPoints(pts, nx, nz, widthIn, heightIn, radiusIn) {
  if (radiusIn <= 0 || pts.length === 0) return pts;

  const dx = widthIn  / (nx - 1);
  const dy = heightIn / (nz - 1);
  const sigma = radiusIn / 2.0;
  const cellRadius = Math.ceil(radiusIn / Math.min(dx, dy));
  if (cellRadius < 1) return pts;

  const inv2s2 = 1 / (2 * sigma * sigma);
  const temp = new Float32Array(pts.length);
  const out  = new Float32Array(pts.length);

  // Pass 1: Horizontal Blur (X)
  const xWeights = new Float32Array(cellRadius * 2 + 1);
  for (let d = -cellRadius; d <= cellRadius; d++) xWeights[d + cellRadius] = Math.exp(-(d * dx * d * dx) * inv2s2);

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
        let sumX = 0, sumY = 0, sumZ = 0, wSum = 0;
        for (let di = -cellRadius; di <= cellRadius; di++) {
            const ni = i + di;
            if (ni < 0 || ni >= nx) continue;
            const weight = xWeights[di + cellRadius];
            const baseIdx = (j * nx + ni) * 3;
            sumX += pts[baseIdx]     * weight;
            sumY += pts[baseIdx + 1] * weight;
            sumZ += pts[baseIdx + 2] * weight;
            wSum += weight;
        }
        const idx = (j * nx + i) * 3;
        temp[idx] = sumX / wSum; temp[idx+1] = sumY / wSum; temp[idx+2] = sumZ / wSum;
    }
  }

  // Pass 2: Vertical Blur (Y)
  const yWeights = new Float32Array(cellRadius * 2 + 1);
  for (let d = -cellRadius; d <= cellRadius; d++) yWeights[d + cellRadius] = Math.exp(-(d * dy * d * dy) * inv2s2);

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
        let sumX = 0, sumY = 0, sumZ = 0, wSum = 0;
        for (let dj = -cellRadius; dj <= cellRadius; dj++) {
            const nj = j + dj;
            if (nj < 0 || nj >= nz) continue;
            const weight = yWeights[dj + cellRadius];
            const baseIdx = (nj * nx + i) * 3;
            sumX += temp[baseIdx]     * weight;
            sumY += temp[baseIdx + 1] * weight;
            sumZ += temp[baseIdx + 2] * weight;
            wSum += weight;
        }
        const idx = (j * nx + i) * 3;
        out[idx] = sumX / wSum; out[idx+1] = sumY / wSum; out[idx+2] = sumZ / wSum;
    }
  }
  return out;
}

/**
 * Separable 2D Gaussian smoothing on a flat [j*nx + i] grid.
 *
 * Single canonical implementation — replaces a near-identical pair that
 * lived in thicken.js (`gaussianSmooth`) and engine/utils.js
 * (`getSmoothedHeights`). Both used the same pre-computed-kernel,
 * two-pass-separable approach with edge-clamped weight normalisation.
 *
 * sigma is in grid-cell units. radius = ceil(sigma * 2.5), which captures
 * ~99% of the Gaussian energy and keeps the 1D kernel small.
 */
export function gaussianSmooth(arr, nx, nz, sigma) {
  if (sigma <= 0) return new Float32Array(arr);

  const radius = Math.ceil(sigma * 2.5);
  const inv2s2 = 1 / (2 * sigma * sigma);
  const temp = new Float32Array(arr.length);
  const out  = new Float32Array(arr.length);

  const weights = new Float32Array(radius * 2 + 1);
  for (let d = -radius; d <= radius; d++) {
    weights[d + radius] = Math.exp(-(d * d) * inv2s2);
  }

  // Pass 1: X
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      let sum = 0, wSum = 0;
      for (let di = -radius; di <= radius; di++) {
        const ni = i + di;
        if (ni < 0 || ni >= nx) continue;
        const wk = weights[di + radius];
        sum  += arr[j * nx + ni] * wk;
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
        sum  += temp[nj * nx + i] * wk;
        wSum += wk;
      }
      out[j * nx + i] = sum / wSum;
    }
  }

  return out;
}

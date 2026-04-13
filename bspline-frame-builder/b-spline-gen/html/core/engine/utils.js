export function getSmoothedHeights(heights, nx, nz, sigma) {
  if (sigma <= 0) return new Float32Array(heights);
  const radius = Math.ceil(sigma * 2.5);
  const inv2s2 = 1 / (2 * sigma * sigma);
  const temp = new Float32Array(heights.length);
  const out = new Float32Array(heights.length);

  const weights = new Float32Array(radius * 2 + 1);
  for (let d = -radius; d <= radius; d++) weights[d + radius] = Math.exp(-(d * d) * inv2s2);

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      let sum = 0, weightSum = 0;
      for (let di = -radius; di <= radius; di++) {
        const ni = i + di;
        if (ni < 0 || ni >= nx) continue;
        const wk = weights[di + radius];
        sum += heights[j * nx + ni] * wk;
        weightSum += wk;
      }
      temp[j * nx + i] = sum / weightSum;
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      let sum = 0, weightSum = 0;
      for (let dj = -radius; dj <= radius; dj++) {
        const nj = j + dj;
        if (nj < 0 || nj >= nz) continue;
        const wk = weights[dj + radius];
        sum += temp[nj * nx + i] * wk;
        weightSum += wk;
      }
      out[j * nx + i] = sum / weightSum;
    }
  }
  return out;
}

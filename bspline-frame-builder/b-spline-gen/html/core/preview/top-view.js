/**
 * 2D top-down heightmap renderer used by the SVG editor's preview pane.
 * Renders directly to a 2D canvas — independent of the Three.js scene.
 *
 * Light direction is fixed top-left for relief shading; a small red origin
 * crosshair is drawn at the center of the canvas.
 */

import { COORD_SYSTEM } from '../coords.js';

export function renderTopView(canvasId, heights, nx, nz, shadingIntensity = 0.25) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (!heights || nx <= 0 || nz <= 0) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  const img = ctx.createImageData(w, h);

  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0, len = heights.length; i < len; i += 1) {
    const z = heights[i];
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  // Light direction (top-left lighting)
  const lx = -1, ly = 1, lz = 1;
  const mag = Math.sqrt(lx * lx + ly * ly + lz * lz);
  const nlx = lx / mag, nly = ly / mag, nlz = lz / mag;

  for (let py = 0; py < h; py++) {
    // Unified Top-is-Top: canvas py=0 is at the Back (j=nz-1),
    // canvas py=h is at the Front (j=0).
    const iy = COORD_SYSTEM.rasterYToGridRow(py, nz, h);

    for (let px = 0; px < w; px++) {
      const fx = px / w * nx;
      const ix = Math.floor(fx);
      const idx = iy * nx + ix;

      const baseCol = 255; // neutral white background

      // Relief shading from height gradient (central differences).
      let shading = 0;
      if (shadingIntensity > 0 && ix > 0 && ix < nx - 1 && iy > 0 && iy < nz - 1) {
        const dzdx = (heights[idx + 1]  - heights[idx - 1])  * 40.0;
        const dzdy = (heights[idx + nx] - heights[idx - nx]) * 40.0;

        const nx_ = -dzdx, ny_ = -dzdy, nz_ = 1.0;
        const nmag = Math.sqrt(nx_ * nx_ + ny_ * ny_ + nz_ * nz_);
        const nnx = nx_ / nmag, nny = ny_ / nmag, nnz = nz_ / nmag;
        const dot = nnx * nlx + nny * nly + nnz * nlz;
        shading = (dot - 0.5) * 150.0 * shadingIntensity;
      }

      const finalCol = Math.round(Math.max(0, Math.min(255, baseCol + shading)));
      const off = (py * w + px) * 4;
      img.data[off + 0] = finalCol;
      img.data[off + 1] = finalCol;
      img.data[off + 2] = finalCol;
      img.data[off + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);

  // Origin crosshair at canvas center, marking model origin.
  ctx.fillStyle = 'rgba(220, 30, 30, 0.9)';
  ctx.strokeStyle = 'rgba(220, 30, 30, 1)';
  ctx.lineWidth = 2;
  const cx = w / 2;
  const cy = h / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - 8, cy);
  ctx.lineTo(cx + 8, cy);
  ctx.moveTo(cx, cy - 8);
  ctx.lineTo(cx, cy + 8);
  ctx.stroke();
}

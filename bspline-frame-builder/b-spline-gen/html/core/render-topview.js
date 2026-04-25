/**
 * render-topview.js — Beauty renderer for the SVG Editor's background preview.
 * Refactored from logic in rebuild.js to improve modularity.
 */

import { P, preDelta } from './state.js';
import { generateHeightmap } from './terrain.js';

/**
 * Smoothly interpolates values from a grid.
 */
function bilinearSample(data, nx, nz, u, v) {
    const x = u * (nx - 1);
    const z = v * (nz - 1);
    const x0 = Math.floor(x), x1 = Math.min(nx - 1, x0 + 1);
    const z0 = Math.floor(z), z1 = Math.min(nz - 1, z0 + 1);
    const dx = x - x0, dy = z - z0;

    const v00 = data[z0 * nx + x0];
    const v10 = data[z0 * nx + x1];
    const v01 = data[z1 * nx + x0];
    const v11 = data[z1 * nx + x1];

    return v00 * (1 - dx) * (1 - dy) +
           v10 * dx * (1 - dy) +
           v01 * (1 - dx) * dy +
           v11 * dx * dy;
}

/**
 * Renders the terrain preview into the hidden SVG Editor background canvas.
 * @param {Float32Array} heightsLow - The current 3D mesh heights (for sculpt sampling)
 * @param {number} nxLow - Grid width
 * @param {number} nzLow - Grid depth
 */
export function updateEditorTopView(heightsLow, nxLow, nzLow) {
    const canvas = document.getElementById('svgEditorTopView');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const aspect = P.widthIn / P.heightIn;
    
    // Target resolution (Decoupled from 3D resolution)
    const target = 384; 
    const nx = target;
    const nz = Math.round(target / aspect);

    if (canvas.width !== nx || canvas.height !== nz) {
        canvas.width = nx;
        canvas.height = nz;
    }

    // 1. Generate High-Res Base Noise (without stamps)
    const { heights: heightsBase } = generateHeightmap({ ...P, nx, nz }, { mask: null });
    const heights = new Float32Array(heightsBase);

    // 2. Blend Low-Res Sculpting (Bilinear)
    if (heightsLow && nxLow > 0) {
        for (let k = 0; k < nx * nz; k++) {
            const u = (k % nx) / (nx - 1);
            const v = Math.floor(k / nx) / (nz - 1);
            
            // Add Sculpting deltas if available
            if (preDelta) {
                heights[k] += bilinearSample(preDelta, nxLow, nzLow, u, v);
            }
        }
    }

    const imgData = ctx.createImageData(nx, nz);
    const data = imgData.data;

    const lx = -1.0, ly = 1.0, lz = 0.8; 
    const lmag = Math.sqrt(lx*lx + ly*ly + lz*lz);
    const nlx = lx/lmag, nly = ly/lmag, nlz = lz/lmag;

    for (let py = 0; py < nz; py++) {
        for (let px = 0; px < nx; px++) {
            const k  = py * nx + px;
            let dot = 0.5;
            let cavity = 0; 
            
            if (px > 0 && px < nx - 1 && py > 0 && py < nz - 1) {
                // Seam-Aware Gradient (Prevents sharp lines at the mirror axis)
                let hL = heights[k - 1];
                let hR = heights[k + 1];
                let hU = heights[k - nx];
                let hD = heights[k + nx];

                const centerX = Math.floor(nx / 2);
                const symX = P.symmetry === 'x' || P.symmetry === 'radial';
                if (symX && px === centerX) hL = hR;

                const centerY = Math.floor(nz / 2);
                const symY = P.symmetry === 'y' || P.symmetry === 'radial';
                if (symY && py === centerY) hU = hD;

                const dzdx = (hR - hL) * 35.0;
                const dzdy = (hD - hU) * 35.0;
                const nx_ = -dzdx, ny_ = -dzdy, nz_ = 1.0;
                const nmag = Math.sqrt(nx_*nx_ + ny_*ny_ + nz_*nz_);
                dot = (nx_/nmag)*nlx + (ny_/nmag)*nly + (nz_/nmag)*nlz;

                const h = heights[k];
                const avg = (hL + hR + hU + hD) * 0.25;
                cavity = (h - avg) * 30.0; 
            }

            const off = k * 4;
            const shade = Math.max(0, Math.min(255, 25 + Math.max(0, dot) * 200 + cavity * 55));
            
            data[off]     = Math.min(255, shade * 0.94); 
            data[off + 1] = Math.min(255, shade * 0.96); 
            data[off + 2] = Math.min(255, shade * 1.06); 
            data[off + 3] = 255;
        }
    }

    ctx.putImageData(imgData, 0, 0);

    // Precision Reticle
    ctx.strokeStyle = 'rgba(0, 120, 212, 0.4)';
    ctx.lineWidth   = 1;
    const cx = nx / 2, cy = nz / 2;
    ctx.beginPath(); ctx.moveTo(cx - 20, cy); ctx.lineTo(cx + 20, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - 20); ctx.lineTo(cx, cy + 20); ctx.stroke();
    ctx.fillStyle = 'rgba(0, 120, 212, 0.6)';
    ctx.beginPath(); ctx.arc(cx, cy, 1.5, 0, Math.PI * 2); ctx.fill();

    if (window.svgEditor && typeof window.svgEditor.sync3DBackground === 'function') {
        window.svgEditor.sync3DBackground();
    }
}

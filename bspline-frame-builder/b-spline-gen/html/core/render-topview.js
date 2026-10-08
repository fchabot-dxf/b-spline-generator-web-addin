/**
 * render-topview.js — Beauty renderer for the SVG Editor's background preview.
 * Refactored from logic in rebuild.js to improve modularity.
 */

import { P, preDelta } from './state.js';
import { generateHeightmap } from './terrain.js';
import { COORD_SYSTEM } from './coords.js';

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
 * Pure per-pixel shading computation for the editor backdrop — no canvas/DOM
 * involved, so it's directly unit-testable (this test environment's
 * `canvas.getContext('2d')` returns null; see tests/stamp-mask-clear.test.js's
 * own note on the same gap). Returns a flat RGBA Uint8ClampedArray, nx*nz*4
 * long, ready to hand to an ImageData's own `.data`.
 *
 * H20 item 1 (Fred, screenshots: the editor backdrop showed Anatomical ribs
 * at TOP / the chest V at BOTTOM, the OPPOSITE of the real 3D TOP view,
 * ground truth): this loop used to write canvas row `py` straight from
 * heightmap row `j=py`. `top-view.js`'s own (already-correct, via
 * COORD_SYSTEM.rasterYToGridRow) renderTopView flips this ("canvas py=0 is
 * at the Back (j=nz-1)"), so this reuses that SAME central utility instead
 * of re-deriving the flip. All neighbour sampling below stays entirely in
 * heightmap-array (j) space — only the FINAL pixel write target changes —
 * so the lighting/gradient math is untouched.
 *
 * @param {Float32Array} heights - nx*nz heightmap, terrain.js's own row order
 * @param {number} nx
 * @param {number} nz
 * @param {string} symmetry - P.symmetry ('x'/'y'/'radial'/'none')
 */
export function computeTopViewPixels(heights, nx, nz, symmetry) {
    const data = new Uint8ClampedArray(nx * nz * 4);

    const lx = -1.0, ly = 1.0, lz = 0.8;
    const lmag = Math.sqrt(lx*lx + ly*ly + lz*lz);
    const nlx = lx/lmag, nly = ly/lmag, nlz = lz/lmag;

    for (let py = 0; py < nz; py++) {
        const j = COORD_SYSTEM.rasterYToGridRow(py, nz, nz);
        for (let px = 0; px < nx; px++) {
            const k  = j * nx + px;
            let dot = 0.5;
            let cavity = 0;

            if (px > 0 && px < nx - 1 && j > 0 && j < nz - 1) {
                // Seam-Aware Gradient (Prevents sharp lines at the mirror axis)
                let hL = heights[k - 1];
                let hR = heights[k + 1];
                let hU = heights[k - nx];
                let hD = heights[k + nx];

                const centerX = Math.floor(nx / 2);
                const symX = symmetry === 'x' || symmetry === 'radial';
                if (symX && px === centerX) hL = hR;

                const centerY = Math.floor(nz / 2);
                const symY = symmetry === 'y' || symmetry === 'radial';
                if (symY && j === centerY) hU = hD;

                const dzdx = (hR - hL) * 35.0;
                const dzdy = (hD - hU) * 35.0;
                const nx_ = -dzdx, ny_ = -dzdy, nz_ = 1.0;
                const nmag = Math.sqrt(nx_*nx_ + ny_*ny_ + nz_*nz_);
                dot = (nx_/nmag)*nlx + (ny_/nmag)*nly + (nz_/nmag)*nlz;

                const h = heights[k];
                const avg = (hL + hR + hU + hD) * 0.25;
                cavity = (h - avg) * 30.0;
            }

            const off = (py * nx + px) * 4;
            const shade = Math.max(0, Math.min(255, 25 + Math.max(0, dot) * 200 + cavity * 55));

            data[off]     = Math.min(255, shade * 0.94);
            data[off + 1] = Math.min(255, shade * 0.96);
            data[off + 2] = Math.min(255, shade * 1.06);
            data[off + 3] = 255;
        }
    }

    return data;
}

/**
 * Lazy top view (2026-10-08, measured: ~0.5 s of a ~1.25 s phone Generate at 4x CPU, its own 384-wide noise
 * heightmap + shading + the backdrop's PNG encode). Its only reader is the editor's backdrop (sync3DBackground), so
 * while the editor is closed a rebuild only keeps its inputs, and the backdrop renders them when it next reads the
 * canvas (editor open). Same inputs, same pixels -- only when they are drawn moves.
 */
let _pendingTopView = null;

/** The editor modal is showing (the same test core/history.js isEditorOpen makes). */
function _editorShowing() {
    const modal = document.getElementById('svgEditorModal');
    return !!modal && modal.style.display !== 'none';
}

/**
 * Renders the terrain preview into the hidden SVG Editor background canvas -- now when the editor is showing (and
 * refreshes its backdrop), else when the backdrop next reads it (flushEditorTopView).
 * @param {Float32Array} heightsLow - The current 3D mesh heights (for sculpt sampling)
 * @param {number} nxLow - Grid width
 * @param {number} nzLow - Grid depth
 */
export function updateEditorTopView(heightsLow, nxLow, nzLow) {
    if (!_editorShowing()) { _pendingTopView = [heightsLow, nxLow, nzLow]; return; }
    _pendingTopView = null;
    if (!_paintTopView(heightsLow, nxLow, nzLow)) return;
    if (window.svgEditor && typeof window.svgEditor.sync3DBackground === 'function') {
        window.svgEditor.sync3DBackground();
    }
}

/** Paint a deferred top view into its canvas, if one is waiting (the backdrop calls this before reading it). */
export function flushEditorTopView() {
    if (!_pendingTopView) return;
    const args = _pendingTopView;
    _pendingTopView = null;
    _paintTopView(...args);
}

function _paintTopView(heightsLow, nxLow, nzLow) {
    const canvas = document.getElementById('svgEditorTopView');
    if (!canvas) return false;

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
    imgData.data.set(computeTopViewPixels(heights, nx, nz, P.symmetry));

    ctx.putImageData(imgData, 0, 0);

    // Precision Reticle
    ctx.strokeStyle = 'rgba(0, 120, 212, 0.4)';
    ctx.lineWidth   = 1;
    const cx = nx / 2, cy = nz / 2;
    ctx.beginPath(); ctx.moveTo(cx - 20, cy); ctx.lineTo(cx + 20, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - 20); ctx.lineTo(cx, cy + 20); ctx.stroke();
    ctx.fillStyle = 'rgba(0, 120, 212, 0.6)';
    ctx.beginPath(); ctx.arc(cx, cy, 1.5, 0, Math.PI * 2); ctx.fill();
    return true;
}

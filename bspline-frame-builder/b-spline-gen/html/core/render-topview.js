/**
 * render-topview.js — Beauty renderer for the SVG Editor's background preview.
 * Refactored from logic in rebuild.js to improve modularity.
 */

import { P, preDelta } from './state.js';
import { generateHeightmap } from './terrain.js';
import { COORD_SYSTEM } from './coords.js';

/**
 * Add the low-res sculpt deltas to a high-res heightmap, bilinear -- the old per-pixel bilinearSample, byte-identical (same
 * u / v, same formula and order; tests/topview-sculpt-blend.test.js pins it against that loop). Seat D 2026-10-08
 * (phone, Photo blur drag, CPU x4: every tick repaints this backdrop; _paintTopView's own loop was 72 ms of each
 * ~185 ms tick): the per-pixel modulo / floor / two divisions and the live-binding read are once per column / row now.
 */
export function addSculptDeltas(heights, nx, nz, pre, nxLow, nzLow) {
    const x0s = new Int32Array(nx), x1s = new Int32Array(nx), dxs = new Float64Array(nx);
    for (let px = 0; px < nx; px++) {
        const x = (px / (nx - 1)) * (nxLow - 1);
        const x0 = Math.floor(x);
        x0s[px] = x0; x1s[px] = Math.min(nxLow - 1, x0 + 1); dxs[px] = x - x0;
    }
    for (let pz = 0; pz < nz; pz++) {
        const z = (pz / (nz - 1)) * (nzLow - 1);
        const z0 = Math.floor(z), z1 = Math.min(nzLow - 1, z0 + 1);
        const dy = z - z0, r0 = z0 * nxLow, r1 = z1 * nxLow, row = pz * nx;
        for (let px = 0; px < nx; px++) {
            const x0 = x0s[px], x1 = x1s[px], dx = dxs[px];
            heights[row + px] += pre[r0 + x0] * (1 - dx) * (1 - dy) +
                                 pre[r0 + x1] * dx * (1 - dy) +
                                 pre[r1 + x0] * (1 - dx) * dy +
                                 pre[r1 + x1] * dx * dy;
        }
    }
    return heights;
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
 * heightmap row `j=py`. COORD_SYSTEM.rasterYToGridRow (core/coords.js) holds
 * the flip ("canvas py=0 is at the Back (j=nz-1)"), so this reuses that
 * SAME central utility instead
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
let _lastTopView = null, _watchedCanvas = null; // the latest inputs (a lost canvas repaints them) / the canvas watched

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
    _lastTopView = [heightsLow, nxLow, nzLow];
    if (!_editorShowing()) { _pendingTopView = _lastTopView; return; }
    _pendingTopView = null;
    if (!_paintTopView(heightsLow, nxLow, nzLow)) return;
    _syncBackdrop();
}

/** Repaint the backdrop from the last rebuild's inputs with the CURRENT params -- for a change the editor's backdrop
 *  must show but that builds no 3D (a Photo-tab edit while the editor is open: core/in-editor-3d.js). At
 *  most once per animation frame, like the editor's own 'live' changes: a drag's steps that land while one paints
 *  are drawn once, with the latest value (the paint reads the params when it runs). */
let _refreshQueued = false;
export function refreshEditorTopView() {
    if (_refreshQueued) return;
    _refreshQueued = true;
    const run = () => { _refreshQueued = false; if (_lastTopView) updateEditorTopView(..._lastTopView); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else setTimeout(run, 0);
}

function _syncBackdrop() {
    if (window.svgEditor && typeof window.svgEditor.sync3DBackground === 'function') {
        window.svgEditor.sync3DBackground();
    }
}

/**
 * Paint a deferred top view into its canvas, if one is waiting (the backdrop calls this before reading it) -- or the
 * last one again when the canvas lost its content. MEASURED 2026-10-08 (phone width, GPU under load): Chrome dropped
 * this hidden canvas's GPU backing once in 6 runs -- the editor's backdrop read back fully transparent at the right
 * size. A lost context reads isContextLost(); a restored one is CLEARED and fires 'contextrestored' (_watchCanvas).
 */
export function flushEditorTopView() {
    if (!_pendingTopView && _lastTopView) {
        const canvas = document.getElementById('svgEditorTopView');
        if (canvas && canvas.getContext('2d').isContextLost?.()) _pendingTopView = _lastTopView;
    }
    if (!_pendingTopView) return;
    const args = _pendingTopView;
    _pendingTopView = null;
    _paintTopView(...args);
}

/** A restored canvas comes back blank: paint the last top view again (now when the editor shows it, else on read). */
function _watchCanvas(canvas) {
    if (_watchedCanvas === canvas) return;
    _watchedCanvas = canvas;
    canvas.addEventListener('contextrestored', () => {
        if (!_lastTopView) return;
        if (!_editorShowing()) { _pendingTopView = _lastTopView; return; }
        _pendingTopView = null;
        if (_paintTopView(..._lastTopView)) _syncBackdrop();
    });
}

function _paintTopView(heightsLow, nxLow, nzLow) {
    const canvas = document.getElementById('svgEditorTopView');
    if (!canvas) return false;
    _watchCanvas(canvas);

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
    if (heightsLow && nxLow > 0 && preDelta) addSculptDeltas(heights, nx, nz, preDelta, nxLow, nzLow);

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

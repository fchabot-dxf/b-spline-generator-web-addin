/**
 * skeleton-editor.js — Fullscreen 2D editor for the SEED.
 *
 * NOTE: filename is historical. This is now the SEED editor — it visualizes
 * the raw coarse-field generator (the SEED panel's pick + offsets +
 * rotation), not the full skeleton pipeline. Skeleton transforms (peak
 * shape, density, clustering, smoothing, edge fade) are deliberately NOT
 * applied here: the editor's job is to let you see the seed's character
 * in isolation.
 *
 * Two render modes (toggle in the modal sidebar):
 *   - Shaded relief    — same lighting as render-topview.js for visual
 *                         continuity with the rest of the app.
 *   - Vectors Only     — marching-squares contour lines (iso-height) on a
 *                         clean background. Topo-map feel; useful for
 *                         studying ridge/valley structure without the
 *                         model getting in the way.
 *
 * Exposes window.skeletonEditor with open() / close() (kept for back-compat).
 */
import { P } from './state.js';
import { PerlinNoise } from './noise.js';
import { SeedTypes, populateSeedDropdown } from './seed/index.js';
import { applyParam } from '../main/param-manager.js';

// Single shared instance.
let _state = {
    open: false,
    canvas: null,
    ctx: null,
    renderTimer: null,
    boundResize: null,
    vectorsOnly: false,
};

// SEED-panel param keys whose changes should trigger a canvas re-render
// while the editor is open. Skeleton-only keys (peakShape, density,
// clustering, smoothing, edge fade) are intentionally excluded — they
// don't affect the raw-seed view.
const SEED_PARAM_KEYS = [
    'seedType', 'seed', 'macroScale',
    'seedOffsetX', 'seedOffsetY', 'seedRotation',
];

// Map of inner (modal) input ID → backing P key. Each modal control is
// wired separately so it doesn't collide with the sidebar's input IDs.
const SKEL_INPUTS = [
    { id: 'skelSeedType',  key: 'seedType',     kind: 'select' },
    { id: 'skelSeed',      key: 'seed',         kind: 'number' },
    { id: 'skelMacroScale',key: 'macroScale',   kind: 'number', sliderId: 'skelMacroSlider' },
    { id: 'skelOffsetX',   key: 'seedOffsetX',  kind: 'number', sliderId: 'skelOffsetXSlider' },
    { id: 'skelOffsetY',   key: 'seedOffsetY',  kind: 'number', sliderId: 'skelOffsetYSlider' },
    { id: 'skelRotation',  key: 'seedRotation', kind: 'number', sliderId: 'skelRotationSlider' },
];

/**
 * Initialize the editor. Wire up the open button, attach slider listeners,
 * register escape key handling. Idempotent — safe to call once per app boot.
 */
export function initSkeletonEditor() {
    const openBtn = document.getElementById('btnEditSeed');
    if (openBtn) openBtn.addEventListener('click', () => open());

    const closeBtn = document.getElementById('skelEditorClose');
    if (closeBtn) closeBtn.addEventListener('click', () => close());

    // Populate the modal's seed-type dropdown from the same registry the
    // sidebar uses, so adding a new seed type reaches both places at once.
    const skelSeedType = document.getElementById('skelSeedType');
    if (skelSeedType) populateSeedDropdown(skelSeedType);

    // Wire each modal input → applyParam(realKey, value) → re-render canvas.
    for (const cfg of SKEL_INPUTS) {
        const el = document.getElementById(cfg.id);
        if (!el) continue;

        const handler = () => {
            let v;
            if (cfg.kind === 'checkbox') v = el.checked;
            else if (cfg.kind === 'select') v = el.value;
            else v = parseFloat(el.value);
            applyParam(cfg.key, v);
            scheduleRender();
        };
        el.addEventListener('input',  handler);
        el.addEventListener('change', handler);

        // Pair number input with its slider, if any.
        if (cfg.sliderId) {
            const slider = document.getElementById(cfg.sliderId);
            if (slider) {
                const sync = (src) => {
                    el.value = src.value;
                    applyParam(cfg.key, parseFloat(src.value));
                    scheduleRender();
                };
                slider.addEventListener('input', () => sync(slider));
                el.addEventListener('input',     () => { slider.value = el.value; });
            }
        }
    }

    // Vectors Only toggle — flips the canvas between shaded relief and
    // contour lines.
    const vectorsOnlyEl = document.getElementById('skelVectorsOnly');
    if (vectorsOnlyEl) {
        vectorsOnlyEl.addEventListener('change', () => {
            _state.vectorsOnly = vectorsOnlyEl.checked;
            updateViewLabel();
            scheduleRender();
        });
    }

    window.skeletonEditor = { open, close, isOpen: () => _state.open };

    // Close on Escape.
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && _state.open) close();
    });
}

function updateViewLabel() {
    const lbl = document.getElementById('skelEditorViewLabel');
    if (!lbl) return;
    lbl.textContent = _state.vectorsOnly
        ? 'Seed (contour lines)'
        : 'Seed (shaded relief)';
}

function open() {
    const modal = document.getElementById('skeletonEditorModal');
    if (!modal) return;

    // Sync modal inputs from current P values.
    for (const cfg of SKEL_INPUTS) {
        const el = document.getElementById(cfg.id);
        if (!el) continue;
        const v = P[cfg.key];
        if (cfg.kind === 'checkbox') el.checked = !!v;
        else el.value = v;
        if (cfg.sliderId) {
            const slider = document.getElementById(cfg.sliderId);
            if (slider) slider.value = v;
        }
    }

    // Sync vectors-only toggle from current state.
    const vectorsOnlyEl = document.getElementById('skelVectorsOnly');
    if (vectorsOnlyEl) vectorsOnlyEl.checked = _state.vectorsOnly;
    updateViewLabel();

    modal.style.display = 'flex';
    _state.open = true;
    _state.canvas = document.getElementById('skelEditorCanvas');
    _state.ctx = _state.canvas?.getContext('2d') || null;

    // Re-render on viewport resize so the canvas stays sharp.
    _state.boundResize = () => scheduleRender();
    window.addEventListener('resize', _state.boundResize);

    scheduleRender();
}

function close() {
    const modal = document.getElementById('skeletonEditorModal');
    if (!modal) return;
    modal.style.display = 'none';
    _state.open = false;
    if (_state.boundResize) {
        window.removeEventListener('resize', _state.boundResize);
        _state.boundResize = null;
    }
}

function scheduleRender() {
    if (_state.renderTimer) cancelAnimationFrame(_state.renderTimer);
    _state.renderTimer = requestAnimationFrame(() => {
        _state.renderTimer = null;
        render();
    });
}

/**
 * Sample the raw SEED field at every grid pixel. Returns a Float32Array
 * of length nx*nz with values in [0..1]. Skeleton transforms are NOT
 * applied — this is the seed in isolation.
 */
function sampleSeedField(nx, nz) {
    const aspect = (P.widthIn || 1) / (P.heightIn || 1);
    // Mirror terrain.js's coarse-pass coord setup. cMultiplier is 1.0 here
    // because it's a filter-specific tweak; for the raw seed view we keep
    // it neutral so different filters don't shift the seed visualization.
    const cMultiplier = 1.0;
    const cFreq = (P.macroScale || 0.65) * cMultiplier;

    const seedFn = SeedTypes[P.seedType || 'perlin'] || SeedTypes['perlin'];
    const noiseCoarse = new PerlinNoise(((P.seed | 0) ^ 0x5f3759df));
    const seedRefs = { noiseCoarse };

    const rot = (P.seedRotation || 0) * Math.PI / 180;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const offX = (P.seedOffsetX || 0) * cFreq * aspect;
    const offY = (P.seedOffsetY || 0) * cFreq;

    const field = new Float32Array(nx * nz);
    for (let py = 0; py < nz; py++) {
        for (let px = 0; px < nx; px++) {
            const u = px / (nx - 1);
            const v = py / (nz - 1);
            let cx = u * cFreq * aspect;
            let cz = v * cFreq;
            if (rot !== 0) {
                const rx = cx * cs - cz * sn;
                const rz = cx * sn + cz * cs;
                cx = rx; cz = rz;
            }
            cx += offX;
            cz += offY;
            field[py * nx + px] = seedFn(cx, cz, seedRefs);
        }
    }
    return field;
}

/**
 * Render the seed field as shaded relief. Same lighting as render-topview.js
 * for visual continuity with the main 3D preview.
 */
function renderShadedRelief(ctx, field, nx, nz) {
    const imgData = ctx.createImageData(nx, nz);
    const data = imgData.data;

    // Lighting setup (matches render-topview.js).
    const lx = -1.0, ly = 1.0, lz = 0.8;
    const lmag = Math.sqrt(lx * lx + ly * ly + lz * lz);
    const nlx = lx / lmag, nly = ly / lmag, nlz = lz / lmag;

    for (let py = 0; py < nz; py++) {
        for (let px = 0; px < nx; px++) {
            const k = py * nx + px;
            let dot = 0.5;
            let cavity = 0;

            if (px > 0 && px < nx - 1 && py > 0 && py < nz - 1) {
                const hL = field[k - 1];
                const hR = field[k + 1];
                const hU = field[k - nx];
                const hD = field[k + nx];

                const dzdx = (hR - hL) * 35.0;
                const dzdy = (hD - hU) * 35.0;
                const nx_ = -dzdx, ny_ = -dzdy, nz_ = 1.0;
                const nmag = Math.sqrt(nx_ * nx_ + ny_ * ny_ + nz_ * nz_);
                dot = (nx_ / nmag) * nlx + (ny_ / nmag) * nly + (nz_ / nmag) * nlz;

                const h = field[k];
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
}

/**
 * Render the seed field as iso-height contour lines using marching squares.
 *
 * Eight evenly-spaced levels are picked between the field's observed min
 * and max. Major levels (every other one) are drawn slightly heavier so
 * the topology reads at a glance. Background is a clean off-white so the
 * contours are the only visual signal.
 */
function renderContours(ctx, field, nx, nz) {
    // Clean background.
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, nx, nz);

    // Find min/max of the raw seed so contour levels span the actual range.
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < field.length; i++) {
        const v = field[i];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
    }
    if (mx - mn < 1e-6) return;  // flat field; nothing to draw

    const NUM_LEVELS = 8;
    const levels = [];
    for (let k = 1; k <= NUM_LEVELS; k++) {
        levels.push(mn + (mx - mn) * (k / (NUM_LEVELS + 1)));
    }

    // Marching-squares case lookup. For each cell we pick the segment(s)
    // that connect the level-crossing points on the cell's edges.
    // Corners are labeled (TL, TR, BR, BL) with bits (1, 2, 4, 8).
    for (let lvlIdx = 0; lvlIdx < levels.length; lvlIdx++) {
        const level = levels[lvlIdx];
        const isMajor = (lvlIdx % 2 === 1);
        ctx.lineWidth = isMajor ? 1.4 : 0.7;
        ctx.strokeStyle = isMajor ? 'rgba(40,55,75,0.85)' : 'rgba(70,90,115,0.55)';
        ctx.beginPath();

        for (let j = 0; j < nz - 1; j++) {
            for (let i = 0; i < nx - 1; i++) {
                const a = field[j * nx + i];           // TL
                const b = field[j * nx + i + 1];       // TR
                const c = field[(j + 1) * nx + i + 1]; // BR
                const d = field[(j + 1) * nx + i];     // BL

                const ka = a > level ? 1 : 0;
                const kb = b > level ? 1 : 0;
                const kc = c > level ? 1 : 0;
                const kd = d > level ? 1 : 0;
                const code = ka | (kb << 1) | (kc << 2) | (kd << 3);
                if (code === 0 || code === 15) continue;

                // Edge crossings — linear interpolation along each edge.
                // Returned as canvas pixel coordinates.
                const tx = i + (level - a) / (b - a);     // top edge crossing X
                const rx = j + (level - b) / (c - b);     // right edge crossing Y
                const bx = i + (level - d) / (c - d);     // bottom edge crossing X
                const lx = j + (level - a) / (d - a);     // left edge crossing Y

                const moveTo = (x, y) => ctx.moveTo(x + 0.5, y + 0.5);
                const lineTo = (x, y) => ctx.lineTo(x + 0.5, y + 0.5);

                switch (code) {
                    case 1:  moveTo(i, lx);   lineTo(tx, j);     break;
                    case 2:  moveTo(tx, j);   lineTo(i + 1, rx); break;
                    case 3:  moveTo(i, lx);   lineTo(i + 1, rx); break;
                    case 4:  moveTo(i + 1, rx); lineTo(bx, j+1); break;
                    case 5:  // saddle — draw both diagonals
                        moveTo(i, lx);     lineTo(tx, j);
                        moveTo(i + 1, rx); lineTo(bx, j + 1);
                        break;
                    case 6:  moveTo(tx, j);    lineTo(bx, j + 1); break;
                    case 7:  moveTo(i, lx);    lineTo(bx, j + 1); break;
                    case 8:  moveTo(bx, j+1);  lineTo(i, lx);     break;
                    case 9:  moveTo(bx, j+1);  lineTo(tx, j);     break;
                    case 10: // saddle — opposite of case 5
                        moveTo(tx, j);     lineTo(i + 1, rx);
                        moveTo(bx, j + 1); lineTo(i, lx);
                        break;
                    case 11: moveTo(bx, j+1);  lineTo(i + 1, rx); break;
                    case 12: moveTo(i + 1, rx); lineTo(i, lx);    break;
                    case 13: moveTo(i + 1, rx); lineTo(tx, j);    break;
                    case 14: moveTo(tx, j);     lineTo(i, lx);    break;
                }
            }
        }
        ctx.stroke();
    }
}

/**
 * Top-level render dispatch. Sizes the canvas, samples the seed field,
 * and routes to the active render mode.
 */
function render() {
    if (!_state.open) return;
    const canvas = _state.canvas;
    const ctx = _state.ctx;
    if (!canvas || !ctx) return;

    const aspect = (P.widthIn || 1) / (P.heightIn || 1);

    // Pick a target resolution that fits the canvas's display size.
    // Cap at 512 to keep cost bounded; the canvas DOM size is controlled
    // by CSS so this maps to whatever box the layout gives us.
    const cssW = canvas.clientWidth  || 384;
    const cssH = canvas.clientHeight || Math.round(384 / aspect);

    const maxDim = 512;
    let nx, nz;
    if (aspect >= 1) {
        nx = Math.min(maxDim, Math.max(64, Math.round(cssW)));
        nz = Math.round(nx / aspect);
    } else {
        nz = Math.min(maxDim, Math.max(64, Math.round(cssH)));
        nx = Math.round(nz * aspect);
    }
    if (nx < 16) nx = 16;
    if (nz < 16) nz = 16;

    if (canvas.width !== nx || canvas.height !== nz) {
        canvas.width = nx;
        canvas.height = nz;
    }

    const field = sampleSeedField(nx, nz);

    if (_state.vectorsOnly) {
        renderContours(ctx, field, nx, nz);
    } else {
        renderShadedRelief(ctx, field, nx, nz);
    }
}

// Re-export for explicit imports if main.js prefers named imports.
export { open, close };

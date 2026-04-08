/**
 * sculpt-interaction.js — High-level sculpting event handlers and interaction state.
 */

import { 
    P, lastResult, preDelta, postDelta, updateP,
    setPreDelta, setPostDelta
} from './state.js';
import { 
    applyStroke, safePostStrokeScale, countPostIntersections, isDeltaEmpty 
} from './sculpt.js';
import { takeSnapshot } from './history.js';

let _sculptStrokeDirty = false;
let _lastSculptRebuildTime = 0;

/**
 * Compute all grid positions that should receive a stroke given a primary
 * position (ci, cj) and the current terrain symmetry setting.
 */
export function mirroredPositions(ci, cj, nx, nz, symmetry) {
    const positions = [{ ci, cj }];
    if (!symmetry || symmetry === 'none') return positions;

    const mi = nx - 1 - ci;
    const mj = nz - 1 - cj;

    if (symmetry === 'x' || symmetry === 'radial') {
        if (mi !== ci) positions.push({ ci: mi, cj });
    }
    if (symmetry === 'y' || symmetry === 'radial') {
        if (mj !== cj) positions.push({ ci, cj: mj });
    }
    if (symmetry === 'radial' && mi !== ci && mj !== cj) {
        positions.push({ ci: mi, cj: mj });
    }
    return positions;
}

/**
 * Apply a physical-inch delta to a control point from the preview interaction.
 */
export function onSculptDelta(layer, ci, cj, dZ, scheduleRebuild) {
    const { nx, nz } = lastResult ?? {};
    const now = Date.now();
    if (!nx || !nz) return;

    const radiusIn = layer === 'top' ? P.sculptTopRadius : P.sculptBotRadius;
    const respectSym = layer === 'top' ? P.sculptTopRespectSymmetry : P.sculptBotRespectSymmetry;
    const delta = layer === 'top' ? preDelta : postDelta;

    if (Math.abs(dZ) < 1e-6) return;

    const sym = respectSym ? P.symmetry : 'none';
    const positions = mirroredPositions(ci, cj, nx, nz, sym);

    let scale = 1.0;
    let clamped = false;

    for (const pos of positions) {
        let s = 1.0;
        if (layer === 'top') {
            s = 1.0; // Top is unconstrained
        } else if (P.thickenEnabled && lastResult.thickenData) {
            s = safePostStrokeScale(
                lastResult.heights, lastResult.thickenData.rawOffsetPts, delta,
                nx, nz, pos.ci, pos.cj, P.widthIn, P.heightIn, dZ, radiusIn
            );
        }
        if (s < scale) scale = s;
    }
    clamped = scale < 0.9999;

    if (Math.abs(scale * dZ) < 1e-6) return;

    for (const pos of positions) {
        applyStroke(delta, nx, nz, pos.ci, pos.cj, P.widthIn, P.heightIn, dZ * scale, radiusIn);
    }

    // Ensure state module sees updated delta array after mutation (bind safety)
    if (layer === 'top') setPreDelta(delta);
    else setPostDelta(delta);

    if (clamped) {
        const textId = layer === 'top' ? 'sculptTopNoticeText' : 'sculptBotNoticeText';
        const noticeId = layer === 'top' ? 'sculptTopNotice' : 'sculptBotNotice';
        const text = document.getElementById(textId);
        const notice = document.getElementById(noticeId);
        if (text) text.textContent = `⚠ Stroke clamped — applied ${(dZ * scale).toFixed(3)}" (requested ${dZ.toFixed(3)}")`;
        if (notice) notice.style.display = 'block';
    }

    _sculptStrokeDirty = true;
    _lastSculptRebuildTime = now;
    scheduleRebuild(0);
}

/**
 * Smoothing brush logic: melts vertices towards their local average height.
 */
export function onSculptSmooth(layer, ci, cj, smoothFactor, scheduleRebuild) {
    const { nx, nz } = lastResult ?? {};
    if (!nx || !nz) return;

    const radiusIn = layer === 'top' ? P.sculptTopRadius : P.sculptBotRadius;
    const respectSym = layer === 'top' ? P.sculptTopRespectSymmetry : P.sculptBotRespectSymmetry;
    const delta = layer === 'top' ? preDelta : postDelta;
    const sym = respectSym ? P.symmetry : 'none';
    const positions = mirroredPositions(ci, cj, nx, nz, sym);

    const factor = Math.min(1.0, smoothFactor);
    const dx = P.widthIn / (nx - 1);
    const dy = P.heightIn / (nz - 1);
    const r2 = radiusIn * radiusIn;

    const absZ = new Float32Array(nx * nz);
    if (layer === 'top') {
        absZ.set(lastResult.heights);
    } else if (P.thickenEnabled && lastResult.thickenData?.offsetPts) {
        const offsetPts = lastResult.thickenData.offsetPts;
        for(let k = 0; k < nx * nz; k++) absZ[k] = offsetPts[k * 3 + 2];
    } else return;

    for (const pos of positions) {
        const startX = -P.widthIn / 2 + pos.ci * dx;
        const startY = -P.heightIn / 2 + pos.cj * dy;
        let sumZ = 0, count = 0;
        const pts = [];

        const iMin = Math.max(0, pos.ci - Math.ceil(radiusIn / dx));
        const iMax = Math.min(nx - 1, pos.ci + Math.ceil(radiusIn / dx));
        const jMin = Math.max(0, pos.cj - Math.ceil(radiusIn / dy));
        const jMax = Math.min(nz - 1, pos.cj + Math.ceil(radiusIn / dy));

        for (let j = jMin; j <= jMax; j++) {
            for (let i = iMin; i <= iMax; i++) {
                const px = -P.widthIn / 2 + i * dx, py = -P.heightIn / 2 + j * dy;
                const dist2 = (px - startX) ** 2 + (py - startY) ** 2;
                if (dist2 <= r2) {
                    const dist = Math.sqrt(dist2);
                    const w = Math.cos((dist / radiusIn) * (Math.PI / 2));
                    sumZ += absZ[j * nx + i] * w;
                    count += w;
                    pts.push({ i, j, w });
                }
            }
        }

        if (count > 0) {
            const avgZ = sumZ / count;
            for (const p of pts) {
                const idx = p.j * nx + p.i;
                let mvmnt = (avgZ - absZ[idx]) * factor * p.w;
                if (layer === 'bot') {
                    const topZ = lastResult.heights[idx];
                    if (P.thickenDir === 'down' && (absZ[idx] + mvmnt) > topZ - 0.001) mvmnt = (topZ - 0.001) - absZ[idx];
                }
                delta[idx] += mvmnt;
            }
        }
    }
    _sculptStrokeDirty = true;
    scheduleRebuild(0);
}

export function onSculptStroke(layer, ci, cj, screenDY, scheduleRebuild) {
    const strength = layer === 'top' ? P.sculptTopStrength : P.sculptBotStrength;
    const mode = layer === 'top' ? P.sculptTopMode : P.sculptBotMode;
    if (mode === 'smooth') {
        onSculptSmooth(layer, ci, cj, Math.abs(screenDY) * strength * 2.0, scheduleRebuild);
    } else {
        onSculptDelta(layer, ci, cj, -screenDY * strength, scheduleRebuild);
    }
}

export function onSculptStart(layer) {
    _sculptStrokeDirty = false;
    takeSnapshot("Sculpt " + layer);
}

export function onSculptStrokeEnd(layer, scheduleRebuild, updateGlobalButtons) {
    if (!_sculptStrokeDirty) return;
    scheduleRebuild(0);
    _sculptStrokeDirty = false;
}

export function sculptClear(layer, scheduleRebuild) {
    const delta = layer === 'top' ? preDelta : postDelta;
    if (isDeltaEmpty(delta)) return;
    takeSnapshot("Clear " + layer);
    delta.fill(0);
    scheduleRebuild(0);
}

// FIX 1: Add scheduleRebuild as a parameter so we can pass it down
export function updatePreviewSculptMode(preview, scheduleRebuild) {
    if (!preview) return;
    const activeLayer = P.activeSculptLayer;
    const hint = document.getElementById('previewHint');

    // Keep current sculpt state if no active layer is set (preserve previous mode while UI is uninitialized)
    if (!activeLayer && preview && preview._sculpt) {
        return;
    }
    
    if (hint) {
        if (activeLayer) {
            const layerName = activeLayer.toUpperCase();
            const modeName = activeLayer === 'top' ? P.sculptTopMode : P.sculptBotMode;
            hint.textContent = `${modeName === 'smooth' ? 'Smoothing' : 'Sculpting'} ${layerName} · Right-drag to orbit · Scroll to zoom`;
            hint.style.color = modeName === 'smooth' ? '#44ccff' : '#ffcc00'; 
        } else {
            hint.textContent = 'Drag to orbit · Scroll to zoom';
            hint.style.color = 'var(--muted)';
        }
    }

    const respectSym = activeLayer === 'top' ? P.sculptTopRespectSymmetry : P.sculptBotRespectSymmetry;
    
    preview.setSculptMode(activeLayer ? {
        layer: activeLayer,
        widthIn: P.widthIn,
        heightIn: P.heightIn,
        nx: lastResult?.nx ?? 1,
        nz: lastResult?.nz ?? 1,
        radiusIn: activeLayer === 'top' ? P.sculptTopRadius : P.sculptBotRadius,
        heights: lastResult?.heights,
        offsetPts: lastResult?.thickenData?.offsetPts ?? null,
        symmetry: respectSym ? P.symmetry : 'none',
        onStart: onSculptStart,
        // FIX 2: Wrap callbacks so scheduleRebuild is safely injected
        onStroke: (layer, ci, cj, dy) => onSculptStroke(layer, ci, cj, dy, scheduleRebuild),
        onStrokeEnd: (layer) => onSculptStrokeEnd(layer, scheduleRebuild),
        // FIX 3: Add missing onDelta and getDelta to power the floating Value Box!
        onDelta: (layer, ci, cj, dZ) => onSculptDelta(layer, ci, cj, dZ, scheduleRebuild),
        getDelta: (ci, cj) => {
            const delta = activeLayer === 'top' ? preDelta : postDelta;
            const nx = lastResult?.nx ?? 1;
            return delta[cj * nx + ci] || 0;
        }
    } : null);
}

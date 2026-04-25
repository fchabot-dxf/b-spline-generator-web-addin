/**
 * sculpt-interaction.js — High-level sculpting event handlers and interaction state.
 */

import {
    P, lastResult, preDelta, postDelta, updateP,
    setPreDelta, setPostDelta, setStrokeCache
} from './state.js';
import { 
    applyStroke, safePostStrokeScale, countPostIntersections, isDeltaEmpty 
} from './sculpt.js';
import { takeSnapshot } from './history.js';

import { 
    sculptDraw, sculptSmooth, sculptNoise, sculptInflate, sculptErase 
} from './sculpt/index.js';

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

export function onSculptStroke(layer, ci, cj, screenDY, scheduleRebuild) {
    const { nx, nz } = lastResult ?? {};
    if (!nx || !nz) return;

    const strength = layer === 'top' ? P.sculptTopStrength : P.sculptBotStrength;
    const radiusIn = layer === 'top' ? P.sculptTopRadius : P.sculptBotRadius;
    const mode = layer === 'top' ? P.sculptTopMode : P.sculptBotMode;
    const noiseScale = layer === 'top' ? P.sculptTopNoiseScale : P.sculptBotNoiseScale;
    const respectSym = layer === 'top' ? P.sculptTopRespectSymmetry : P.sculptBotRespectSymmetry;
    const delta = layer === 'top' ? preDelta : postDelta;
    const sym = respectSym ? P.symmetry : 'none';
    const positions = mirroredPositions(ci, cj, nx, nz, sym);

    const dZ = -screenDY * strength;
    const absZ = new Float32Array(nx * nz);
    if (layer === 'top') {
        absZ.set(lastResult.heights);
    } else if (P.thickenEnabled && lastResult.thickenData?.offsetPts) {
        const offsetPts = lastResult.thickenData.offsetPts;
        for(let k = 0; k < nx * nz; k++) absZ[k] = offsetPts[k * 3 + 2];
    }

    for (const pos of positions) {
        switch (mode) {
            case 'draw':
                sculptDraw(delta, nx, nz, pos.ci, pos.cj, P.widthIn, P.heightIn, radiusIn, dZ);
                break;
            case 'smooth':
                sculptSmooth(delta, absZ, nx, nz, pos.ci, pos.cj, P.widthIn, P.heightIn, radiusIn, Math.abs(screenDY) * strength * 2.0, layer, lastResult?.heights);
                break;
            case 'noise':
                sculptNoise(delta, nx, nz, pos.ci, pos.cj, P.widthIn, P.heightIn, radiusIn, dZ, noiseScale);
                break;
            case 'inflate':
                sculptInflate(delta, nx, nz, pos.ci, pos.cj, P.widthIn, P.heightIn, radiusIn, dZ * 1.5);
                break;
            case 'erase':
                sculptErase(delta, nx, nz, pos.ci, pos.cj, P.widthIn, P.heightIn, radiusIn, strength * 5.0);
                break;
        }
    }

    if (layer === 'top') setPreDelta(delta);
    else setPostDelta(delta);

    _sculptStrokeDirty = true;
    scheduleRebuild(0);
}

export function onSculptStart(layer) {
    _sculptStrokeDirty = false;
    takeSnapshot("Sculpt " + layer);

    // Build the stroke cache so subsequent rebuild() calls during the drag
    // can skip generateHeightmap, stamps, normals, safeMap, and thicken.
    // We snapshot heights-minus-preDelta as `baseStamped` so each stroke tick
    // becomes  newHeights = baseStamped + preDelta  — a pure vector add.
    //
    // Currently only applied to top-layer sculpting; bot-layer postDelta feeds
    // into the thicken offset computation itself, which we'd need to refactor
    // to short-circuit in the same way.
    if (layer === 'top' && lastResult?.heights && lastResult?.nx && lastResult?.nz) {
        const n = lastResult.heights.length;
        const baseStamped = new Float32Array(n);
        if (preDelta && preDelta.length === n) {
            for (let k = 0; k < n; k++) baseStamped[k] = lastResult.heights[k] - preDelta[k];
        } else {
            baseStamped.set(lastResult.heights);
        }
        setStrokeCache({
            layer,
            baseStamped,
            baseHeights: lastResult.baseHeights ? new Float32Array(lastResult.baseHeights) : null,
            thickenData: lastResult.thickenData || null,   // shared ref — reused, not copied
            nx: lastResult.nx,
            nz: lastResult.nz,
        });
    } else {
        setStrokeCache(null);
    }
}

export function onSculptStrokeEnd(layer, scheduleRebuild, updateGlobalButtons) {
    // Always tear down the stroke cache so the next rebuild does a full pass.
    setStrokeCache(null);
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

    // Defensive: if sculpt mode is being torn down, drop any stroke cache so
    // the next rebuild does a full pass even if onSculptStrokeEnd never fired
    // (e.g. user switched layers mid-drag, or a param change wiped sculpt mode).
    if (!activeLayer) setStrokeCache(null);

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

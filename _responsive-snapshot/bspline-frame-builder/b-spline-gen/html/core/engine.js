/**
 * engine.js — The core rebuild and update loop.
 */

import { 
    P, lastNx, lastNz, preDelta, postDelta, lastResult, 
    setLastResult, setPreDelta, setPostDelta, setLastGridSize,
    isFusionMode, extraThickenThinMask
} from './state.js';
import { updatePreviewSculptMode } from './sculpt-interaction.js';

import { generateHeightmap, resolveGrid } from './terrain.js';
import { 
    computeNormals, computeSafeOffsetMap, computeMaxSafeThickness, 
    computeOffsetPoints, smoothOffsetPoints, buildHeatColours,
    findWorstPoints
} from './thicken.js';
import { checkPreBounds, countPostIntersections, resampleDelta } from './sculpt.js';
import { fusLog, sendFusionMeshPreview } from './fusion-bridge.js';
import { COORD_SYSTEM } from './coords.js';


let rebuildTimer = null;
let isRebuilding = false;
let pendingRebuild = null;
let lastRebuildFn = null;

// REWIRE 1: Helper to unblock the main thread between heavy loops
const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 0));

export function getSmoothedHeights(heights, nx, nz, sigma) {
  if (sigma <= 0) return new Float32Array(heights);
  const radius = Math.ceil(sigma * 2.5);
  const inv2s2 = 1 / (2 * sigma * sigma);
  const temp = new Float32Array(heights.length);
  const out  = new Float32Array(heights.length);

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

export function scheduleRebuild(rebuildFnOrDelay, delayMs = 50) {
    clearTimeout(rebuildTimer);

    let delay;
    if (typeof rebuildFnOrDelay === 'function') {
        lastRebuildFn = rebuildFnOrDelay;
        delay = delayMs;
    } else if (typeof rebuildFnOrDelay === 'number') {
        delay = rebuildFnOrDelay;
    } else {
        delay = 50;
    }

    rebuildTimer = setTimeout(() => {
        if (typeof lastRebuildFn === 'function') {
            lastRebuildFn();
        }
    }, delay);
}

// REWIRE 2: Made rebuild async and sprinkled yields so the UI doesn't hang
export async function rebuild(preview, refreshStampMask, updatePreviewSculptMode, updateEditorTopView) {
    if (isRebuilding) {
        pendingRebuild = () => rebuild(preview, refreshStampMask, updatePreviewSculptMode, updateEditorTopView);
        return;
    }
    isRebuilding = true;

    const tStart = performance.now();
    const statusBar = document.getElementById('bottomStatusBar');
    const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);
    
    await yieldToMain(); // Yield after grid resolution

    if (preDelta === null || nx !== lastNx || nz !== lastNz) {
        if (preDelta && (nx !== lastNx || nz !== lastNz)) {
            // FIX: lastNx/lastNz start at 0 on page load (never persisted to localStorage).
            // Calling resampleDelta(delta, 0, 0, nx, nz) accesses negative Float32Array
            // indices → undefined → NaN arithmetic → every height becomes NaN → flat terrain.
            // Guard: only resample when the old dimensions are valid (> 0).
            if (lastNx > 0 && lastNz > 0) {
                setPreDelta(resampleDelta(preDelta, lastNx, lastNz, nx, nz));
                setPostDelta(resampleDelta(postDelta, lastNx, lastNz, nx, nz));
            } else {
                setPreDelta(new Float32Array(nx * nz));
                setPostDelta(new Float32Array(nx * nz));
            }
            // Multi-layer: refresh masks for all layers with SVG
            // Deprecated internal refresh: Now managed by main.js to avoid async loops.
        } else {
            setPreDelta(new Float32Array(nx * nz));
            setPostDelta(new Float32Array(nx * nz));
        }
        setLastGridSize(nx, nz);
    }
    
    let minThk = Infinity;
    let sumThk = 0;
    const edgeMargin = (P.edgeMarginIn > 0) ? Math.min(0.49, P.edgeMarginIn / Math.min(P.widthIn, P.heightIn)) : 0;

    await yieldToMain(); // Yield before noise generation

    const result = generateHeightmap({ ...P, nx, nz, edgeMargin }, { mask: null });

    await yieldToMain(); // Yield before sculpt application

    const cleanHeights = new Float32Array(result.heights);
    if (preDelta) { 
        for (let k = 0; k < nx * nz; k++) cleanHeights[k] += preDelta[k];
    }

    // Multi-layer stamp logic for applying stamps
    let stampedHeights = new Float32Array(cleanHeights);
    if (P.stampLayers && Array.isArray(P.stampLayers)) {
        P.stampLayers.forEach(layer => {
            if (layer && layer.svg && layer.mask && layer.mask.length === nx * nz) {
                // suppression is a scalar (0–1) from the UI — blend terrain toward smooth under the stamp
                const suppressStrength = (typeof layer.suppression === 'number') ? layer.suppression : 0;
                const blurRadius = layer.smoothing || 0;
                const smoothedTerrain = suppressStrength > 0
                    ? getSmoothedHeights(cleanHeights, nx, nz, blurRadius)
                    : null;
                // mask[k] is normalized 0..1; apply signed depth here so depth
                // changes never need a full re-rasterize.
                const layerDepth = layer.depth ?? P.stampDepth ?? 0;
                for (let k = 0; k < nx * nz; k++) {
                    const normVal = layer.mask[k]; // 0..1 sentinel or real value
                    if (normVal < 1e-6) continue;
                    const depthInches = normVal * layerDepth;
                    // Suppress terrain texture beneath the stamp footprint
                    if (suppressStrength > 0) {
                        stampedHeights[k] = (stampedHeights[k] * (1 - suppressStrength))
                                          + (smoothedTerrain[k] * suppressStrength);
                    }
                    stampedHeights[k] += depthInches;
                }
            }
        });
    }

    for (let k = 0; k < stampedHeights.length; k++) {
        if (isNaN(stampedHeights[k])) stampedHeights[k] = cleanHeights[k] || 0;
    }

    const heights = stampedHeights;
    setLastResult({ ...result, heights, cleanHeights, baseHeights: result.heights, nx, nz });

    await yieldToMain(); // Yield before thicken analysis

    const sign = P.thickenDir === 'up' ? 1 : -1;
    const normals = computeNormals(heights, nx, nz, P.widthIn, P.heightIn);
    
    await yieldToMain(); // Yield mid-thicken

    const safeMap = computeSafeOffsetMap(heights, nx, nz, P.widthIn, P.heightIn, 0.3);
    const maxSafe = computeMaxSafeThickness(safeMap);

    const safeStr = maxSafe.toFixed(3);
    const hasIntersect = P.thickness > maxSafe + 1e-4;

    let finalPeakZ = -Infinity;
    let finalFloorZ = Infinity;
    for (let k = 0; k < nx * nz; k++) {
        if (heights[k] > finalPeakZ) finalPeakZ = heights[k];
        if (heights[k] < finalFloorZ) finalFloorZ = heights[k];
    }

    let thickenData = null;
    let intersectPts = [], thinPts = [];

    await yieldToMain(); // Yield before offset generation

    if (P.thickenEnabled) {
        const { pts: rawOffsetPts, clampMap } = computeOffsetPoints(
            heights, normals, nx, nz, P.widthIn, P.heightIn,
            P.thickness, P.thickenMode === 'adaptive', safeMap, sign
        );

        let offsetPts = new Float32Array(rawOffsetPts); 

        for (let k = 0; k < nx * nz; k++) {
            let zAdjust = 0;
            const physicalDist = (rawOffsetPts[k * 3 + 2] - heights[k]) * sign;
            const deficit = P.thickness - physicalDist;
            if (deficit > 0) {
                const falloff = Math.max(0.001, P.extraThickenThinFalloff);
                const weight = Math.min(1.0, deficit / falloff);
                zAdjust += (P.extraThickenThin * weight) * sign;
            }
            if (extraThickenThinMask) zAdjust += extraThickenThinMask[k] * sign;
            if (postDelta) zAdjust += postDelta[k];
            offsetPts[k * 3 + 2] += zAdjust;
        }
        
        offsetPts = smoothOffsetPoints(offsetPts, nx, nz, P.widthIn, P.heightIn, 0.3);

        for (let k = 0; k < nx * nz; k++) {
            const bZ = offsetPts[k * 3 + 2];
            if (bZ > finalPeakZ) finalPeakZ = bZ;
            if (bZ < finalFloorZ) finalFloorZ = bZ;
        }

        await yieldToMain(); // Yield before coloring loop


        let meshColours = new Float32Array(nx * nz * 3);
        let botColours = new Float32Array(nx * nz * 3);
        const INTERSECT_TOLERANCE = 0.002;
        const yellowOffset = P.thickenYellowOffset;

        let selfIntersectCount = 0;
        let topBotIntersectCount = 0;
        let worstClamped = [];

        for (let k = 0; k < nx * nz; k++) {
            const i = k % nx, j = Math.floor(k / nx);
            const xT = -P.widthIn/2 + i*P.widthIn/(nx-1), yT = -P.heightIn/2 + j*P.heightIn/(nz-1), zT = heights[k];
            const xB = offsetPts[k*3+0], yB = offsetPts[k*3+1], zB = offsetPts[k*3+2];
            const physicalThickness = Math.sqrt((xB-xT)**2 + (yB-yT)**2 + (zB-zT)**2);

            minThk = Math.min(minThk, physicalThickness);
            sumThk += physicalThickness;

            let isSelfIntersect = (i < nx-1 && offsetPts[k*3] > offsetPts[(k+1)*3]) || (i > 0 && offsetPts[k*3] < offsetPts[(k-1)*3]) ||
                                (j < nz-1 && offsetPts[k*3+1] > offsetPts[(k+nx)*3+1]) || (j > 0 && offsetPts[k*3+1] < offsetPts[(k-nx)*3+1]);
            const isTopBotIntersect = (normals[k*3+2] < -0.05) || (physicalThickness <= INTERSECT_TOLERANCE);
            const isThin = !isSelfIntersect && !isTopBotIntersect && (physicalThickness < (P.thickness - yellowOffset - INTERSECT_TOLERANCE));

            const pt = { x: xB, y: yB, z: zB, actual: physicalThickness };
            if (isTopBotIntersect || isSelfIntersect) {
                intersectPts.push(pt); worstClamped.push(pt);
                if (isSelfIntersect) selfIntersectCount++; else topBotIntersectCount++;
            } else if (isThin) {
                thinPts.push(pt); worstClamped.push(pt);
            }

            // Default: green (0.1, 0.8, 0.2)
            let tr=0.1, tg=0.8, tb=0.2, br=0.1, bg=0.8, bb=0.2;
            if (isTopBotIntersect) { tr=1; tg=0.1; tb=0.1; br=1; bg=0.1; bb=0.1; }
            else if (isSelfIntersect) { br=1; bg=0.4; bb=0.7; }
            else if (isThin) { tr=0.5; tg=0.8; tb=1.0; br=0.5; bg=0.8; bb=1.0; } // light blue

            meshColours[k*3+0]=tr; meshColours[k*3+1]=tg; meshColours[k*3+2]=tb;
            botColours[k*3+0]=br; botColours[k*3+1]=bg; botColours[k*3+2]=bb;
        }

        worstClamped.sort((a,b) => a.actual - b.actual);
        const worstPts = worstClamped.slice(0, 20);

        let warnMsg = '';
        if (selfIntersectCount > 0) warnMsg += `<span style="color:#ff66b2;font-weight:600;">⚠️ Self-Intersect (Pink): ${selfIntersectCount}</span>`;
        if (topBotIntersectCount > 0) warnMsg += (warnMsg ? ' · ' : '') + `<span style="color:#ff2222;font-weight:600;">⚠️ Collision (Red): ${topBotIntersectCount}</span>`;
        if (thinPts.length > 0) warnMsg += (warnMsg ? ' · ' : '') + `<span style="color:#ffcc00;font-weight:600;">Thin: ${thinPts.length}</span>`;
        if (!warnMsg) warnMsg = '<span style="color:#208a4f;">Thickness Surface Safe</span>';
        if (statusBar) statusBar.setAttribute('data-warn-msg', warnMsg);

        thickenData = { normals, safeMap, maxSafe, hasIntersect, offsetPts, rawOffsetPts, clampMap, worstPts, thinPts, intersectPts, meshColours, botColours };
        lastResult.thickenData = thickenData;
    } else {
        lastResult.thickenData = null;
    }

    await yieldToMain(); // Yield before 3D Engine Push

    if (preDelta) {
        let nnz = 0, min = Infinity, max = -Infinity, sum = 0;
        for (let i=0; i < preDelta.length; i++) {
            const v = preDelta[i];
            if (v !== 0) nnz++;
            min = Math.min(min, v);
            max = Math.max(max, v);
            sum += v;
        }
        if (min === Infinity) min = 0;
        if (max === -Infinity) max = 0;
        const { count, maxOver, maxUnder } = checkPreBounds(result.heights, preDelta, nx, nz, P.carveZ);
        updateSculptNotice('top', count, maxOver, maxUnder);
    }
    if (postDelta && thickenData) {
        const nIntersect = countPostIntersections(heights, thickenData.offsetPts, new Float32Array(nx * nz), nx, nz);
        updateSculptNotice('bot', nIntersect, 0, 0);
    }

    if (preview) {
        preview.update(
            heights, nx, nz, P.widthIn, P.heightIn, P.carveZ,
            thickenData?.meshColours, thickenData?.worstPts ?? [], P.showLeaders, 
            thickenData?.offsetPts, P.stampRelief,
            thickenData?.thinPts ?? [], thickenData?.intersectPts ?? [], 
            P.thickenWireframe, thickenData?.botColours, P.flatShading
        );
        updatePreviewSculptMode(preview, scheduleRebuild);
    }
    
    await yieldToMain(); // Yield before Editor sync

    updateEditorTopView(heights, nx, nz);
    if (isFusionMode) sendFusionMeshPreview(preview);

    if (statusBar) {
        const warnMsg = statusBar.getAttribute('data-warn-msg') || '';
        const finalAvgThk = (P.thickenEnabled && nx > 0) ? (sumThk / (nx * nz)) : 0;
        const finalMinThk = (P.thickenEnabled && minThk !== Infinity) ? minThk : 0;
        const zMsg = `Avg THK: <b>${finalAvgThk.toFixed(3)}"</b> · Min THK: <b>${finalMinThk.toFixed(3)}"</b> · Peak Z: <b>${finalPeakZ.toFixed(3)}"</b> · Max Safe: <b>${safeStr}"</b>`;
        const isNarrow = window.innerWidth < 600;
        statusBar.innerHTML = isNarrow ? `<div>${warnMsg}</div><div style="font-size:12px;">${zMsg}</div>` : `<span>${warnMsg}</span><span style="margin-left:2em;font-size:12px;">${zMsg}</span>`;
        statusBar.style.flexDirection = isNarrow ? 'column' : 'row';
    }

    // Process queued rebuilds
    isRebuilding = false;
    if (pendingRebuild) {
        const next = pendingRebuild;
        pendingRebuild = null;
        next();
    }
}

// Duplicate updateSculptNotice removed (see below for single definition)

// Duplicate updateEditorTopView removed (see below for single definition)

/**
 * Updates small notification flags for sculpt boundaries.
 */
function updateSculptNotice(layer, count, maxOver, maxUnder) {
    const id = layer === 'top' ? 'sculptTopNotice' : 'sculptBotNotice';
    const textId = layer === 'top' ? 'sculptTopNoticeText' : 'sculptBotNoticeText';
    const notice = document.getElementById(id);
    const text = document.getElementById(textId);
    if (!notice || !text) return;
    if (count > 0) {
        text.textContent = layer === 'top' 
            ? `⚠ ${count} points out of carveZ bounds — stroke clamped`
            : `⚠ Bottom surface intersects top at ${count} points — stroke clamped`;
        notice.style.display = 'block';
    } else {
        notice.style.display = 'none';
    }
}

/**
 * Renders the current heightmap top-down to the background canvas of the SVG Editor.
 */
export function updateEditorTopView(heights, nx, nz) {
    const canvas = document.getElementById('svgEditorTopView');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Increase the top-view background resolution for a crisper SVG editor backdrop.
    const baseSize = 512;
    const deviceScale = Math.min(4, Math.max(1, Math.round(window.devicePixelRatio || 1)));
    const displaySize = baseSize * deviceScale;
    canvas.width = displaySize;
    canvas.height = displaySize;
    canvas.style.width = `${baseSize}px`;
    canvas.style.height = `${baseSize}px`;

    const imgData = ctx.createImageData(displaySize, displaySize);
    const data = imgData.data;

    // Light direction (top-left) — matches preview.js
    const lx = -1, ly = 1, lz = 1;
    const lmag = Math.sqrt(lx*lx + ly*ly + lz*lz);
    const nlx = lx/lmag, nly = ly/lmag, nlz = lz/lmag;
    const shadingIntensity = 0.85;

    for (let py = 0; py < displaySize; py++) {
        // Correct Y Flip: model j=0 (Front) is at the bottom of the canvas,
        // canvas py=0 (Top) is at the back of the model (j=nz-1).
        const iy  = COORD_SYSTEM.rasterYToGridRow(py, nz, displaySize);

        for (let px = 0; px < displaySize; px++) {
            const fx = px / displaySize * nx;
            const ix = Math.min(Math.floor(fx), nx - 1);
            const k  = iy * nx + ix;

            // Mid-gray base — no raw height gradient
            let col = 160;

            // Relief shading from surface slope
            if (ix > 0 && ix < nx - 1 && iy > 0 && iy < nz - 1) {
                const dzdx = (heights[k + 1]  - heights[k - 1])  * 40.0;
                const dzdy = (heights[k + nx] - heights[k - nx]) * 40.0;
                const nx_ = -dzdx, ny_ = -dzdy, nz_ = 1.0;
                const nmag = Math.sqrt(nx_*nx_ + ny_*ny_ + nz_*nz_);
                const dot  = (nx_/nmag)*nlx + (ny_/nmag)*nly + (nz_/nmag)*nlz;
                col = Math.round(Math.max(0, Math.min(255, col + (dot - 0.5) * 150.0 * shadingIntensity)));
            }

            const off = (py * displaySize + px) * 4;
            data[off]     = col;
            data[off + 1] = col;
            data[off + 2] = col;
            data[off + 3] = 255;
        }
    }

    ctx.putImageData(imgData, 0, 0);

    // Red cross-hair at model origin centre
    ctx.fillStyle   = 'rgba(220, 30, 30, 0.9)';
    ctx.strokeStyle = 'rgba(220, 30, 30, 1)';
    ctx.lineWidth   = 2;
    const cx = displaySize / 2, cy = displaySize / 2;
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 8, cy);
    ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy + 8);
    ctx.stroke();

    if (window.svgEditor && typeof window.svgEditor.sync3DBackground === 'function') {
        window.svgEditor.sync3DBackground();
    }
}

import {
    P, lastNx, lastNz, preDelta, postDelta, lastResult,
    setLastResult, setPreDelta, setPostDelta, setLastGridSize,
    isFusionMode, extraThickenThinMask, strokeCache
} from '../state.js';
import { updatePreviewSculptMode } from '../sculpt-interaction.js';

import { generateHeightmap, resolveGrid } from '../terrain.js';
import { 
    computeNormals, computeSafeOffsetMap, computeMaxSafeThickness, 
    computeOffsetPoints, smoothOffsetPoints
} from '../thicken.js';
import { checkPreBounds, countPostIntersections, resampleDelta } from '../sculpt.js';
import { fusLog, sendFusionMeshPreview } from '../fusion-bridge.js';
import { COORD_SYSTEM } from '../coords.js';
import { getSmoothedHeights } from './utils.js';
import { scheduleRebuild } from './scheduler.js';

import { updateEditorTopView } from '../render-topview.js';

const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 0));

export async function rebuild(preview, refreshStampMask, updatePreviewSculptMode) {
    if (rebuild.isRebuilding) {
        rebuild.pendingRebuild = () => rebuild(preview, refreshStampMask, updatePreviewSculptMode);
        return;
    }
    rebuild.isRebuilding = true;

    const tStart = performance.now();
    const statusBar = document.getElementById('bottomStatusBar');
    const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);

    await yieldToMain();

    // If the deltas already match the target grid size (e.g. just loaded from a
    // snapshot whose grid differs from the prior render's), trust them as-is.
    // Without this short-circuit, lastNx/lastNz from the prior render would
    // make the resampleDelta path read out of bounds and scramble the values.
    const preMatches  = preDelta  && preDelta.length  === nx * nz;
    const postMatches = postDelta && postDelta.length === nx * nz;
    if (preMatches && postMatches) {
        if (nx !== lastNx || nz !== lastNz) setLastGridSize(nx, nz);
    } else if (preDelta === null || nx !== lastNx || nz !== lastNz) {
        if (preDelta && (nx !== lastNx || nz !== lastNz)) {
            if (lastNx > 0 && lastNz > 0) {
                setPreDelta(resampleDelta(preDelta, lastNx, lastNz, nx, nz));
                setPostDelta(resampleDelta(postDelta, lastNx, lastNz, nx, nz));
            } else {
                setPreDelta(new Float32Array(nx * nz));
                setPostDelta(new Float32Array(nx * nz));
            }
        } else {
            setPreDelta(new Float32Array(nx * nz));
            setPostDelta(new Float32Array(nx * nz));
        }
        setLastGridSize(nx, nz);
    }

    // ── Stroke fast-path ─────────────────────────────────────────────────────
    // If a sculpt drag is active and the cached baseline matches the current
    // grid size, skip the heavy work (generateHeightmap, stamps, normals,
    // safeMap, thicken, smoothOffsetPoints, intersection loop, heat-map
    // colours, status bar, editor topview, Fusion mesh send) and just push the
    // new top-surface heights to the preview.  The full rebuild re-runs at
    // onSculptStrokeEnd, which clears strokeCache.
    if (strokeCache && strokeCache.layer === 'top' &&
        strokeCache.nx === nx && strokeCache.nz === nz &&
        strokeCache.baseStamped && strokeCache.baseStamped.length === nx * nz) {
        const heights = new Float32Array(strokeCache.baseStamped);
        if (preDelta && preDelta.length === heights.length) {
            for (let k = 0; k < heights.length; k++) heights[k] += preDelta[k];
        }
        const thickenData = strokeCache.thickenData;
        const baseHeights = strokeCache.baseHeights ?? heights;
        setLastResult({
            ...(lastResult || {}),
            heights,
            cleanHeights: heights,   // approximate during stroke; recomputed on release
            baseHeights,
            nx, nz,
            thickenData,
        });

        await yieldToMain();

        if (preview) {
            preview.update(
                heights, nx, nz, P.widthIn, P.heightIn, P.carveZ,
                thickenData?.meshColours, thickenData?.worstPts ?? [], P.showLeaders,
                thickenData?.offsetPts, P.stampRelief,
                thickenData?.thinPts ?? [], thickenData?.intersectPts ?? [],
                P.thickenWireframe, thickenData?.botColours, P.flatShading
            );
            // NOTE: deliberately skipping updatePreviewSculptMode here — it
            // would call setSculptMode → _clearSculptOverlays on every tick,
            // and the sculpt drag relies on the overlay state from mousedown.
            // The sculpt config's `heights` ref goes slightly stale for the
            // duration of the stroke, but _sculptRaycast uses _lastHitZ and
            // hover overlay rebuilds are guarded by !_sculptDrag anyway.
        }

        rebuild.isRebuilding = false;
        if (rebuild.pendingRebuild) {
            const next = rebuild.pendingRebuild;
            rebuild.pendingRebuild = null;
            next();
        }
        return;
    }

    let minThk = Infinity;
    let sumThk = 0;
    const edgeMargin = (P.edgeMarginIn > 0) ? Math.min(0.49, P.edgeMarginIn / Math.min(P.widthIn, P.heightIn)) : 0;

    await yieldToMain();

    const result = generateHeightmap({ ...P, nx, nz, edgeMargin }, { mask: null });

    await yieldToMain();

    const cleanHeights = new Float32Array(result.heights);
    if (preDelta) { 
        for (let k = 0; k < nx * nz; k++) cleanHeights[k] += preDelta[k];
    }

    let stampedHeights = new Float32Array(cleanHeights);
    if (P.stampLayers && Array.isArray(P.stampLayers)) {
        P.stampLayers.forEach((layer, layerIdx) => {
            if (layer && layer.enabled && layer.svg && layer.mask && layer.mask.length === nx * nz) {
                console.log(`[STAMP DEBUG] Applying stamp layer ${layerIdx} name=${layer.name} depth=${layer.depth} profile=${layer.profile} suppress=${layer.suppression}`);
                const suppressStrength = (typeof layer.suppression === 'number') ? layer.suppression : 0;
                const blurRadius = layer.smoothing || 0;
                const smoothedTerrain = suppressStrength > 0
                    ? getSmoothedHeights(cleanHeights, nx, nz, blurRadius)
                    : null;
                const layerDepth = layer.depth ?? P.stampDepth ?? 0;
                for (let k = 0; k < nx * nz; k++) {
                    const normVal = layer.mask[k];
                    if (normVal < 1e-6) continue;
                    const depthInches = normVal * layerDepth;
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

    await yieldToMain();

    const sign = P.thickenDir === 'up' ? 1 : -1;
    const normals = computeNormals(heights, nx, nz, P.widthIn, P.heightIn);
    
    await yieldToMain();

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

    await yieldToMain();

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

        await yieldToMain();

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

            let tr=0.1, tg=0.8, tb=0.2, br=0.1, bg=0.8, bb=0.2;
            if (isTopBotIntersect) { tr=1; tg=0.1; tb=0.1; br=1; bg=0.1; bb=0.1; }
            else if (isSelfIntersect) { br=1; bg=0.4; bb=0.7; }
            else if (isThin) { tr=0.5; tg=0.8; tb=1.0; br=0.5; bg=0.8; bb=1.0; }

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

    await yieldToMain();

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
    
    await yieldToMain();

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

    rebuild.isRebuilding = false;
    if (rebuild.pendingRebuild) {
        const next = rebuild.pendingRebuild;
        rebuild.pendingRebuild = null;
        next();
    }
}

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

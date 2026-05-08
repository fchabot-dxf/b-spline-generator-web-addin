/**
 * rebuild.js — orchestrates a full mesh rebuild.
 *
 * Phases (slow path):
 *   1. Resolve grid + reconcile sculpt-delta arrays with grid changes
 *   2. Stroke fast-path early-return when sculpting (cached thickenData)
 *   3. Generate the underlying heightmap (terrain.js) + apply preDelta
 *   4. Apply enabled stamp layers   (apply-stamp-layers.js)
 *   5. Build thicken data            (build-thicken-data.js)
 *   6. Sculpt-bounds notices         (sculpt.js)
 *   7. Push to preview               (TerrainPreview.update)
 *   8. Editor top-view + Fusion mesh preview side-effects
 *   9. Status-bar warning + thickness summary
 */

import {
    P, lastNx, lastNz, preDelta, postDelta, lastResult,
    setLastResult, setPreDelta, setPostDelta, setLastGridSize,
    isFusionMode, extraThickenThinMask, strokeCache,
} from '../state.js';

import { generateHeightmap, resolveGrid } from '../terrain.js';
import { checkPreBounds, countPostIntersections, resampleDelta } from '../sculpt.js';
import { sendFusionMeshPreview } from '../fusion-bridge.js';
import { updateEditorTopView } from '../render-topview.js';

import { applyStampLayers } from './apply-stamp-layers.js';
import { buildThickenData } from './build-thicken-data.js';
import { scheduleRebuild } from './scheduler.js';

const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 0));

export async function rebuild(preview, refreshStampMask, updatePreviewSculptMode) {
    if (rebuild.isRebuilding) {
        rebuild.pendingRebuild = () => rebuild(preview, refreshStampMask, updatePreviewSculptMode);
        return;
    }
    rebuild.isRebuilding = true;

    try {
        const statusBar = document.getElementById('bottomStatusBar');
        const { nx, nz } = resolveGrid(P.widthIn, P.heightIn, P.spacing);

        await yieldToMain();
        reconcileSculptDeltas(nx, nz);

        // ── Stroke fast-path ─────────────────────────────────────────────────
        // If a sculpt drag is active and the cached baseline matches the current
        // grid size, skip the heavy work and just push the new top heights to
        // the preview. The full rebuild re-runs at onSculptStrokeEnd, which
        // clears strokeCache.
        if (canTakeStrokeFastPath(nx, nz)) {
            handleStrokeFastPath(preview, nx, nz);
            await yieldToMain();
            return;
        }

        await yieldToMain();
        const { heights, cleanHeights, baseHeights, generated } = buildHeights(nx, nz);
        setLastResult({ ...generated, heights, cleanHeights, baseHeights, nx, nz });

        await yieldToMain();
        const thicken = buildThickenData(heights, nx, nz, P, {
            extraThickenThinMask,
            postDelta,
        });
        lastResult.thickenData = thicken.data;

        await yieldToMain();
        applySculptNotices(generated.heights, thicken, nx, nz);

        if (preview) {
            preview.update(
                heights, nx, nz, P.widthIn, P.heightIn, P.carveZ,
                thicken.data?.meshColours, thicken.data?.worstPts ?? [], P.showLeaders,
                thicken.data?.offsetPts, P.stampRelief,
                thicken.data?.thinPts ?? [], thicken.data?.intersectPts ?? [],
                P.thickenWireframe, thicken.data?.botColours, P.flatShading,
            );
            updatePreviewSculptMode(preview, scheduleRebuild);
        }

        await yieldToMain();
        updateEditorTopView(heights, nx, nz);
        if (isFusionMode) sendFusionMeshPreview(preview);

        if (statusBar) updateStatusBar(statusBar, thicken, nx, nz);
    } finally {
        rebuild.isRebuilding = false;
        if (rebuild.pendingRebuild) {
            const next = rebuild.pendingRebuild;
            rebuild.pendingRebuild = null;
            next();
        }
    }
}

// ── Phase 1: sculpt-delta reconciliation ────────────────────────────────────

/**
 * If the deltas already match the target grid size (e.g. just loaded from a
 * snapshot whose grid differs from the prior render's), trust them as-is.
 * Without this, lastNx/lastNz from the prior render would make resampleDelta
 * read out of bounds and scramble the values.
 */
function reconcileSculptDeltas(nx, nz) {
    const preMatches  = preDelta  && preDelta.length  === nx * nz;
    const postMatches = postDelta && postDelta.length === nx * nz;
    if (preMatches && postMatches) {
        if (nx !== lastNx || nz !== lastNz) setLastGridSize(nx, nz);
        return;
    }
    if (preDelta === null || nx !== lastNx || nz !== lastNz) {
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
}

// ── Phase 2: stroke fast-path ───────────────────────────────────────────────

function canTakeStrokeFastPath(nx, nz) {
    return strokeCache && strokeCache.layer === 'top' &&
           strokeCache.nx === nx && strokeCache.nz === nz &&
           strokeCache.baseStamped && strokeCache.baseStamped.length === nx * nz;
}

function handleStrokeFastPath(preview, nx, nz) {
    const heights = new Float32Array(strokeCache.baseStamped);
    if (preDelta && preDelta.length === heights.length) {
        for (let k = 0; k < heights.length; k++) heights[k] += preDelta[k];
    }
    const thickenData = strokeCache.thickenData;
    const baseHeights = strokeCache.baseHeights ?? heights;
    setLastResult({
        ...(lastResult || {}),
        heights,
        cleanHeights: heights, // approximate during stroke; recomputed on release
        baseHeights,
        nx, nz,
        thickenData,
    });

    if (!preview) return;
    preview.update(
        heights, nx, nz, P.widthIn, P.heightIn, P.carveZ,
        thickenData?.meshColours, thickenData?.worstPts ?? [], P.showLeaders,
        thickenData?.offsetPts, P.stampRelief,
        thickenData?.thinPts ?? [], thickenData?.intersectPts ?? [],
        P.thickenWireframe, thickenData?.botColours, P.flatShading,
    );
    // NOTE: deliberately skipping updatePreviewSculptMode — it would call
    // setSculptMode → _clearSculptOverlays on every tick, and the sculpt
    // drag relies on the overlay state from mousedown. The sculpt config's
    // `heights` ref goes slightly stale for the duration of the stroke, but
    // _sculptRaycast uses _lastHitZ and hover overlay rebuilds are guarded
    // by !_sculptDrag anyway.
}

// ── Phase 3+4: heights + stamp layers ───────────────────────────────────────

function buildHeights(nx, nz) {
    const edgeMargin = (P.edgeMarginIn > 0)
        ? Math.min(0.49, P.edgeMarginIn / Math.min(P.widthIn, P.heightIn))
        : 0;
    const generated = generateHeightmap({ ...P, nx, nz, edgeMargin }, { mask: null });

    const cleanHeights = new Float32Array(generated.heights);
    if (preDelta) {
        for (let k = 0; k < nx * nz; k++) cleanHeights[k] += preDelta[k];
    }

    const heights = applyStampLayers(cleanHeights, P.stampLayers, nx, nz, {
        stampDepth:            P.stampDepth,
        stampEdgeFilletRadius: P.stampEdgeFilletRadius,
    });

    return { heights, cleanHeights, baseHeights: generated.heights, generated };
}

// ── Phase 6: sculpt notices ─────────────────────────────────────────────────

function applySculptNotices(rawHeights, thicken, nx, nz) {
    if (preDelta) {
        const { count, maxOver, maxUnder } = checkPreBounds(rawHeights, preDelta, nx, nz, P.carveZ);
        updateSculptNotice('top', count, maxOver, maxUnder);
    }
    if (postDelta && thicken.data) {
        const nIntersect = countPostIntersections(
            // heights here = top surface (post-stamp), offsetPts = bottom surface
            lastResult.heights, thicken.data.offsetPts, new Float32Array(nx * nz), nx, nz,
        );
        updateSculptNotice('bot', nIntersect, 0, 0);
    }
}

function updateSculptNotice(layer, count) {
    const id     = layer === 'top' ? 'sculptTopNotice'     : 'sculptBotNotice';
    const textId = layer === 'top' ? 'sculptTopNoticeText' : 'sculptBotNoticeText';
    const notice = document.getElementById(id);
    const text   = document.getElementById(textId);
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

// ── Phase 9: status bar ─────────────────────────────────────────────────────

function updateStatusBar(statusBar, thicken, nx, nz) {
    const cellCount = nx * nz;
    const avg = (P.thickenEnabled && cellCount > 0) ? thicken.sumThk / cellCount : 0;
    const min = (P.thickenEnabled)                  ? thicken.minThk             : 0;

    const warnMsg = formatWarning(thicken);
    const zMsg = `Avg THK: <b>${avg.toFixed(3)}"</b> · Min THK: <b>${min.toFixed(3)}"</b> · Peak Z: <b>${thicken.peakZ.toFixed(3)}"</b> · Max Safe: <b>${thicken.maxSafe.toFixed(3)}"</b>`;
    const isNarrow = window.innerWidth < 600;

    statusBar.innerHTML = isNarrow
        ? `<div>${warnMsg}</div><div style="font-size:12px;">${zMsg}</div>`
        : `<span>${warnMsg}</span><span style="margin-left:2em;font-size:12px;">${zMsg}</span>`;
    statusBar.style.flexDirection = isNarrow ? 'column' : 'row';
}

function formatWarning(thicken) {
    const { self, topBot, thin } = thicken.counts;
    if (!P.thickenEnabled) return '';
    let msg = '';
    if (self   > 0) msg += `<span style="color:#ff66b2;font-weight:600;">⚠️ Self-Intersect (Pink): ${self}</span>`;
    if (topBot > 0) msg += (msg ? ' · ' : '') + `<span style="color:#ff2222;font-weight:600;">⚠️ Collision (Red): ${topBot}</span>`;
    if (thin   > 0) msg += (msg ? ' · ' : '') + `<span style="color:#ffcc00;font-weight:600;">Thin: ${thin}</span>`;
    return msg || '<span style="color:#208a4f;">Thickness Surface Safe</span>';
}

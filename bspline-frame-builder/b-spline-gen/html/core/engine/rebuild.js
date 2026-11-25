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
import { withLoadingStage } from '../loading-signal.js';

import { applyStampLayers, STAMP_PASS_KIND, PLACEMENT_PASS_KINDS } from './apply-stamp-layers.js';
import { placementOf } from '../stamp/placement.js';
import { orderPasses, editorLayerKey, STACK_BRICKS_KEY } from '../stamp/order.js';
import { stlPasses } from '../stl/layer.js';
import { heightPasses, heightRastersReady, decodeHeightLayers } from '../height/layer.js';
import { isStoredRaster } from '../height/raster.js';
import { stlStockReport, setStlStockReport } from '../stl/stock.js';
import { stockReport, stockOvershoot, setHeightStockReport } from '../stock.js';
import { updateStlGhosts, ghostSurface } from '../stl/ghost.js';
import { buildThickenData, fillFloorIn } from './build-thicken-data.js';
import { bandOutlineOf, bandOutlineDigest } from '../flatten-band-outline.js';
import { scheduleRebuild, isRebuildScheduled } from './scheduler.js';
import { isCarved } from '../../editor/layers.js';
import { isJobTimelineEnabled } from '../job-timeline-enabled.js';
import { isBackLocked, dequantizeHeights } from '../job-timeline-snapshot.js';

const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 0));

// Item 37: "the 3D is built" as an event, not a quiet window -- nothing running, queued or on the scheduler's timer.
const _idleWaiters = [];
const _rebuildIdle = () => !rebuild.isRebuilding && !rebuild.pendingRebuild && !isRebuildScheduled();
/** Resolves once no rebuild is running, queued or scheduled (at once if none is). */
export function whenRebuildIdle() {
    return _rebuildIdle() ? Promise.resolve() : new Promise((resolve) => _idleWaiters.push(resolve));
}

// Item 69 (seat E, measured: 30 sidebar controls rebuilt the 3D without changing it, 1.1-8.2 s at CPU x4): a build
// whose INPUTS equal the last completed build's is skipped. The inputs are DECLARED as everything a build reads --
// all of P (terrain.js reads P whole) minus REBUILD_INERT_KEYS, the sculpt deltas, the editor layers' tooling + mask
// objects, the grid, the preview -- so an unlisted input only costs a rebuild, never a stale 3D.
/** P keys no build reads (measured: their only readers are the sculpt interaction / the export). */
export const REBUILD_INERT_KEYS = new Set([
    'activeSculptLayer', 'sculptTopMode', 'sculptBotMode',
    'sculptTopRadius', 'sculptTopStrength', 'sculptTopNoiseScale', // Strength = the Hardness control (state.js INPUT_PAIRS)
    'sculptBotRadius', 'sculptBotStrength', 'sculptBotNoiseScale',
    'decalOpacity',
    'stlFitOnInsert', // read only by main/stl-panel.js when an STL is added
]);
const _objectIds = new WeakMap();
let _nextObjectId = 1;
const _idOf = (o) => { if (!o || typeof o !== 'object') return 0; if (!_objectIds.has(o)) _objectIds.set(o, _nextObjectId++); return _objectIds.get(o); };
function _fnv(h, str) { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h; }
function _fnvArray(h, a) { if (!a) return _fnv(h, '-'); h = _fnv(h, String(a.length)); for (let i = 0; i < a.length; i++) { h ^= Math.round(a[i] * 1e6); h = Math.imul(h, 16777619); } return h; }
/**
 * STL-RELIEF: a stored STL mesh (core/stl/mesh.js encodeMesh, ~0.6 MB of base64 per layer) is digested by its content hash
 * `h` (which covers the box, the counts and the text) and its counts, not re-stringified on every slider tick. Every other
 * value is itself.
 */
const _digestValue = (v) => ((v && typeof v === 'object' && typeof v.pos === 'string' && typeof v.idx === 'string' && v.h)
    ? { h: v.h, nv: v.nv, nt: v.nt }
    // HEIGHT-PAINTER: a stored height raster (core/height/raster.js) likewise, by its content hash and its shape
    : isStoredRaster(v) ? { h: v.h, cols: v.cols, rows: v.rows } : v);
/** HEIGHT-PAINTER: the one async input of the height patches -- their rasters decoded (core/height/raster.js); a board
 *  without a patch adds nothing to the digests. */
const _heightReadyTerm = () => (Array.isArray(P.heightLayers) && P.heightLayers.length ? `|hp:${heightRastersReady(P.heightLayers)}` : '');
/** The declared build inputs as one digest, or null when they cannot be read (then the build always runs). */
export function rebuildInputDigest(preview, nx, nz) {
    try {
        let h = 2166136261;
        // + the async input outside P: the height patches' decoded rasters (the photo's decoded image was one until the
        // photo's removal, Fred 2026-11-23)
        h = _fnv(h, `${nx}x${nz}|${_idOf(preview)}|${isFusionMode}${_heightReadyTerm()}`);
        h = _fnv(h, JSON.stringify(P, (k, v) => (REBUILD_INERT_KEYS.has(k) ? undefined : _digestValue(v))));
        h = _fnvArray(h, preDelta); h = _fnvArray(h, postDelta); h = _fnvArray(h, extraThickenThinMask);
        const layers = (typeof window !== 'undefined' && window.svgEditor && Array.isArray(window.svgEditor._layers)) ? window.svgEditor._layers : [];
        for (const l of layers) {
            h = _fnv(h, JSON.stringify(l, (k, v) => (k && (k[0] === '_' || (v && typeof v === 'object' && 'nodeType' in v)) ? undefined : v)));
            h = _fnv(h, `|${_idOf(l._mask)}|${_idOf(l._brickMask)}|${l._brickDepth}${l._brickPlacement === 'afterBack' ? '|afterBack' : ''}`); // bricks After thicken (else as before)
        }
        return (h >>> 0).toString(36);
    } catch (_) { return null; }
}
let _lastBuiltDigest = null;

// 2026-10-09 (seat A; the phone map, photo board: Adaptive display / Colour edges / thicken toggles re-ran the whole
// heightmap -- smoothing, noise, stamps -- for a change only the thicken + display steps read): the HEIGHTS stage
// (buildHeights below: terrain.js, the stamp layers and everything they import) has its own declared inputs, and a
// build whose heights inputs equal the last one's reuses copies of those heights. Byte-identical by construction.
/** P keys the heights stage never reads (tests/heights-inert-keys.test.js scans that code for every one of them). */
export const HEIGHTS_INERT_KEYS = new Set([
    'adaptiveDisplay', 'showMesh', 'flatShading', 'colourEdges', 'showLeaders', // the display
    'thickness', 'thickenEnabled', 'thickenDir', 'thickenMode', 'thickenWireframe', 'thickenYellowOffset', 'includeSurface',
    'includeUnstampedSolid', 'bottomSmoothRadius', 'extraThickenThin', 'extraThickenThinFalloff', // the thicken step
    'backMode', // ...whose settings reach the heights only through the fill floor (fillFloorIn, its own digest term below)
    'flatBaseDropIn', // Back = Flat's Base below 0: the bottom only (the fill floor never reads it)
    'decalEnabled', 'decalResolution', 'decalLayerIds',
    'sculptTopRespectSymmetry', 'sculptBotRespectSymmetry',
    'spacing', 'exportSpacing', 'sameAsDisplayResolution', 'exportOrientation', // the grid (nx, nz) is its own input
    // the stamp / brick / frame settings reach the heights only through the editor layers' masks (an input below)
    'stampSmoothingRadius', 'stampFilletPower', 'stampVBitAngle', 'stampBlur', 'stampTextureSuppression',
    'brickSettings', 'frame', 'stampLayers', 'activeLayerIdx', 'editorSvg',
]);
/** The heights stage's declared inputs as one digest (null = unreadable: the heights are rebuilt). */
export function heightsInputDigest(nx, nz) {
    try {
        let h = 2166136261;
        h = _fnv(h, `${nx}x${nz}${_heightReadyTerm()}`);
        h = _fnv(h, JSON.stringify(P, (k, v) => (REBUILD_INERT_KEYS.has(k) || HEIGHTS_INERT_KEYS.has(k) ? undefined : _digestValue(v))));
        h = _fnv(h, `|floor ${fillFloorIn(P)}`); // the fill floor (a 'fill' board: from the back's settings; else 0)
        h = _fnv(h, `|band ${bandOutlineDigest(P)}`); // the FLATTEN BAND's loop (the frame's outline): '-' while the band is off
        h = _fnvArray(h, preDelta);
        const layers = (typeof window !== 'undefined' && window.svgEditor && Array.isArray(window.svgEditor._layers)) ? window.svgEditor._layers : [];
        for (const l of layers) {
            h = _fnv(h, JSON.stringify(l, (k, v) => (k && (k[0] === '_' || (v && typeof v === 'object' && 'nodeType' in v)) ? undefined : v)));
            h = _fnv(h, `|${_idOf(l._mask)}|${_idOf(l._brickMask)}|${l._brickDepth}${l._brickPlacement === 'afterBack' ? '|afterBack' : ''}`); // bricks After thicken (else as before)
        }
        return (h >>> 0).toString(36);
    } catch (_) { return null; }
}
let _heightsCache = null; // { digest, built } -- built holds private copies; every reuse hands out fresh ones
/** Fresh copies of a buildHeights result, keeping which arrays are the same array (baseHeights IS generated.heights). */
function _copyBuilt(b) {
    const seen = new Map();
    const c = (a) => { if (!ArrayBuffer.isView(a)) return a; if (!seen.has(a)) seen.set(a, a.slice()); return seen.get(a); };
    const generated = {};
    for (const [k, v] of Object.entries(b.generated)) generated[k] = c(v);
    return { heights: c(b.heights), cleanHeights: c(b.cleanHeights), baseHeights: c(b.baseHeights), generated, backBase: c(b.backBase), stlStock: b.stlStock, heightStock: b.heightStock };
}
function buildHeightsReusing(nx, nz) {
    const digest = heightsInputDigest(nx, nz);
    if (digest !== null && _heightsCache && _heightsCache.digest === digest) return _copyBuilt(_heightsCache.built);
    _heightsCache = null;
    const built = buildHeights(nx, nz);
    if (digest !== null) _heightsCache = { digest, built: _copyBuilt(built) };
    return built;
}
/** Tests: forget the reusable heights (the next build computes them). */
export function _forgetHeights() { _heightsCache = null; }

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

        // ── Stroke fast-path ─────────────────────────────────────────────
        // If a sculpt drag is active and the cached baseline matches the
        // current grid size, skip the heavy work and just push the new top
        // heights to the preview. The full rebuild re-runs at
        // onSculptStrokeEnd, which clears strokeCache. Outside the loading
        // stage (item 41): a stroke tick is live feedback, not a wait.
        if (canTakeStrokeFastPath(nx, nz)) {
            handleStrokeFastPath(preview, nx, nz);
            await yieldToMain();
            return;
        }

        // HEIGHT-PAINTER: a height patch whose raster is not decoded yet (a loaded project) is decoded before the build
        // reads it -- a board without patches never enters here
        if (!heightRastersReady(P.heightLayers)) await withLoadingStage('heightPatch', () => decodeHeightLayers(P.heightLayers));
        const digest = rebuildInputDigest(preview, nx, nz);
        if (digest !== null && digest === _lastBuiltDigest && lastResult) {
            if (preview) updatePreviewSculptMode(preview, scheduleRebuild); // the cheap interaction sync still runs
            updateCanvasHeights(lastResult.baseHeights, lastResult.heights, lastResult.thickenData);
            return;
        }
        _lastBuiltDigest = null; // a build that throws leaves no digest: the next one runs
        await withLoadingStage('rebuild', async () => {
            await yieldToMain();
            const { heights, cleanHeights, baseHeights, generated, backBase, stlStock, heightStock } = buildHeightsReusing(nx, nz);
            setLastResult({ ...generated, heights, cleanHeights, baseHeights, nx, nz });
            setStlStockReport(stlStock); // STL-RELIEF: each STL against the stock (detection only; main/stl-panel.js shows it)
            setHeightStockReport(heightStock); // HEIGHT-PAINTER slice 5: each height patch and the whole board (main/height-panel.js)

            await yieldToMain();
            // job-timeline step 3 slice 2: Back LOCKED + the Settings switch ON -- the frozen underside, resampled
            // to THIS grid if it changed size since capture (dequantizeHeights' own nearest-neighbour). Switch off
            // reads as "no lock" everywhere else in job-timeline (core/job-timeline-enabled.js), so it does here too:
            // the live underside, unchanged.
            const backSnap = P.jobTimeline?.snapshots?.back;
            const backHeights = (isJobTimelineEnabled() && isBackLocked(P.jobTimeline) && backSnap)
                ? dequantizeHeights(backSnap, nx, nz) : null;
            const thicken = buildThickenData(heights, nx, nz, P, {
                extraThickenThinMask,
                postDelta,
                backHeights,
                backFrom: backBase, // null unless an 'afterBack' STL: the back from the heights without it
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
                    P.thickenWireframe, thicken.data?.botColours, P.flatShading, P.adaptiveDisplay,
                );
                updatePreviewSculptMode(preview, scheduleRebuild);
                // STL-RELIEF: the placement ghosts follow the surface just built (none = removes them). They sit on the
                // surface BEFORE the stamps (ghostSurface = cleanHeights), never on top of their own relief.
                updateStlGhosts(preview, P.stlLayers, ghostSurface({ heights, cleanHeights }), { nx, nz, widthIn: P.widthIn, heightIn: P.heightIn });
            }

            await yieldToMain();
            updateEditorTopView(heights, nx, nz);
            updateCanvasHeights(baseHeights, heights, thicken);
            if (isFusionMode) sendFusionMeshPreview(preview);

            if (statusBar) updateStatusBar(statusBar, thicken, nx, nz);
        }, { spacing: P.spacing });
        _lastBuiltDigest = digest;
    } finally {
        rebuild.isRebuilding = false;
        if (rebuild.pendingRebuild) {
            const next = rebuild.pendingRebuild;
            rebuild.pendingRebuild = null;
            next();
        }
        if (_rebuildIdle()) _idleWaiters.splice(0).forEach((resolve) => resolve());
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
    updateCanvasHeights(baseHeights, heights, thickenData);

    if (!preview) return;
    preview.update(
        heights, nx, nz, P.widthIn, P.heightIn, P.carveZ,
        thickenData?.meshColours, thickenData?.worstPts ?? [], P.showLeaders,
        thickenData?.offsetPts, P.stampRelief,
        thickenData?.thinPts ?? [], thickenData?.intersectPts ?? [],
        P.thickenWireframe, thickenData?.botColours, P.flatShading, P.adaptiveDisplay,
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
    const generated = generateHeightmap({ ...P, nx, nz, edgeMargin, terrainFloorIn: fillFloorIn(P), bandOutline: bandOutlineOf(P) }, { mask: null });

    const cleanHeights = new Float32Array(generated.heights);
    if (preDelta) {
        for (let k = 0; k < nx * nz; k++) cleanHeights[k] += preDelta[k];
    }

    // Step 3 unification: build the pass list from editor layers.
    const passes = _collectStampPasses(nx, nz);
    // Placement 'afterBack' ("After thicken", core/stamp/placement.js): those passes are stamped LAST, on the top only; the back
    // is thickened from the heights without them (backBase -> buildThickenData backFrom). STL and height patches first; a
    // vector layer's art and the bricks too since Fred 2026-11-23 (PLACEMENT_PASS_KINDS). None = today's one call, same
    // arguments. The late call smooths the same clean terrain (reference) and shares the art deltas, so a late layer's
    // suppression and a late Flat brick read what they would in one call.
    const late = passes.filter((p) => PLACEMENT_PASS_KINDS.includes(p.kind) && p.placement === 'afterBack');
    const early = late.length ? passes.filter((p) => !late.includes(p)) : passes;
    const defaults = {
        stampDepth:            P.stampDepth,
        stampEdgeFilletRadius: P.stampEdgeFilletRadius,
    };
    const artDelta = late.length ? new Float32Array(nx * nz) : null;
    const surfaceHeights = applyStampLayers(cleanHeights, early, nx, nz, late.length ? { ...defaults, artDelta } : defaults);
    const heights = late.length ? applyStampLayers(surfaceHeights, late, nx, nz, { ...defaults, reference: cleanHeights, artDelta }) : surfaceHeights;
    const backBase = late.length ? surfaceHeights : null;
    // STL-RELIEF (Fred 2026-11-22): per STL pass, its covered points where these FINAL heights leave the stock (the sculpt
    // check's bounds, core/stl/stock.js). Detection only: one pass over the points per STL, nothing is changed.
    const stlStock = stlStockReport(passes, heights, P.carveZ);
    // HEIGHT-PAINTER slice 5 (Fred 2026-11-23): the same check per height patch (its footprint) and over the whole board
    const heightStock = { patches: stockReport(passes, heights, P.carveZ, 'height'), board: { ...stockOvershoot(heights, null, P.carveZ), carveZ: P.carveZ } };

    return { heights, cleanHeights, baseHeights: generated.heights, generated, backBase, stlStock, heightStock };
}

/**
 * Produce a unified list of stamp passes, one per editor layer.
 *
 * SE4b: the legacy P.stampLayers content fallback is retired — the
 * editor is the only content store now.
 *
 * The returned shape matches what applyStampLayers expects:
 *   { id, enabled, svg, mask, depth, profile, suppression, smoothing,
 *     edgeFilletRadius, filletPower, name? }
 *
 * H22 item 2: `id` is the layer's own stable identity — applyStampLayers
 * joins back to window.svgEditor._layers BY ID, never by array position.
 * This list is already filtered (isCarved), so its own index never lines
 * up with the full, unfiltered _layers array once any earlier layer is
 * hidden/non-carved.
 */
// exported for tests (item 22 slice 3: the per-layer art + brick passes)
export function _collectStampPasses(nx, nz) {
    const editor = (typeof window !== 'undefined') ? window.svgEditor : null;
    const editorLayers = (editor && Array.isArray(editor._layers)) ? editor._layers : null;
    const passes = [];

    if (editorLayers) {
        editorLayers.forEach((layer) => {
            if (!layer) return;
            // T27: isCarved(layer) — mirrors stamp-mask-manager.js's own
            // gate; visible is the master, so a hidden layer never cuts
            // regardless of its own carve flag.
            if (!isCarved(layer)) return;
            const mask = layer._mask;
            // F35 item 22 slice 3: the layer's BRICKS as their own pass, after its art: their own height
            // (_brickDepth: relief + Raised/Carved), Flat profile, no fillet -- the layer's suppression/smoothing
            // (layer-level), never its art depth/profile. A distinct id, so applyStampLayers' editor-layer join
            // never lends it the art layer's tooling.
            const brickPass = layer._brickMask ? {
                id: `${layer.id}#bricks`,
                kind: STAMP_PASS_KIND.bricks, // item 44: a Flat brick fits its plane under the art passes' delta
                name: layer.name,
                enabled: true,
                svg: '1',
                mask: layer._brickMask,
                depth: layer._brickDepth,
                profile: 'flat',
                suppression: layer.suppression,
                smoothing: layer.smoothing,
                edgeFilletRadius: 0,
                filletPower: layer.filletPower,
                // Fred 2026-11-23: the bricks' Thicken placement, a brick setting like their Relief: P.brickSettings.placement,
                // read with the brick depth by main/stamp-mask-manager.js (layer._brickPlacement; absent = 'withSurface',
                // core/stamp/placement.js) -- the heights stage never reads P.brickSettings (HEIGHTS_INERT_KEYS)
                placement: placementOf(layer._brickPlacement),
            } : null;
            if (!mask) { if (brickPass) passes.push(brickPass); return; }
            // Build a stamp-pass-shape view of the editor layer. We keep
            // a non-empty svg marker so the applyStampLayers guard
            // `!layer.svg` doesn't reject the pass — the rasterizer has
            // already consumed the real svg into `mask` by this point.
            passes.push({
                id: layer.id,
                kind: STAMP_PASS_KIND.art,
                name: layer.name,
                enabled: true,
                svg: '1',
                mask,
                depth: layer.depth,
                profile: layer.profile,
                suppression: layer.suppression,
                smoothing: layer.smoothing,
                edgeFilletRadius: layer.edgeFilletRadius,
                filletPower: layer.filletPower,
                placement: placementOf(layer.placement), // Fred 2026-11-23: the layer's own Thicken (absent = 'withSurface')
            });
            if (brickPass) passes.push(brickPass);
        });
    }

    // STL-RELIEF: the STL stamps (P.stlLayers), AFTER every editor layer's art and bricks -- always on top. Only when the caller
    // gives the grid (buildHeights does); no STL layer = no pass = the passes above, untouched (tests/stl-layers-absent.test.js).
    // stlPasses runs for an absent / empty list too: it returns [] and clears the STL error map (a removed layer's error goes).
    if (nx > 1 && nz > 1) {
        passes.push(...stlPasses(P.stlLayers, { nx, nz, widthIn: P.widthIn, heightIn: P.heightIn }));
        // HEIGHT-PAINTER: the painted height patches (P.heightLayers), AFTER the STL passes. None = no pass
        // (tests/height-layers-absent.test.js); heightPasses clears its error map for an absent / empty list too.
        passes.push(...heightPasses(P.heightLayers, { nx, nz, widthIn: P.widthIn, heightIn: P.heightIn }));
    }

    // The LAYER STACK (Fred 2026-11-23, core/stamp/order.js): once the user has reordered the stack, P.layerOrder lists its
    // items and the passes follow it (each pass at its item's rank). Absent / null: no sort -- today's order, untouched.
    if (!Array.isArray(P.layerOrder)) return passes;
    const byId = new Map((editorLayers || []).filter(Boolean).map((l) => [String(l.id), l]));
    return orderPasses(passes, P.layerOrder, (p) => (p.kind === STAMP_PASS_KIND.bricks ? STACK_BRICKS_KEY
        : p.kind === STAMP_PASS_KIND.art ? (byId.has(String(p.id)) ? editorLayerKey(byId.get(String(p.id))) : `layer:${p.id}`)
        : p.id)); // an STL / height pass id IS its stack key (stl:<id>, height:<id>)
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

/** The top-left floating HUD (styles/layout-app.css .heights-hud): just the TOTAL height text; the base stays
 *  available in the element's own title tooltip, not a visible line (Fred 2026-10-16, "no panel"). One declared
 *  list -- `root` carries the tooltip, `total` is the visible span -- not two parallel id arrays. The bottom-left
 *  Surface Inspector (inspectorBaseHeight/inspectorTotalHeight) is a different, untouched readout. */
export const HEIGHTS_HUD = Object.freeze([
    Object.freeze({ root: 'canvasTotalHeights', total: 'canvasTotalHeight' }),
    Object.freeze({ root: 'editorCanvasTotalHeights', total: 'editorCanvasTotalHeight' }),
]);

/**
 * Updates the live total heights on the canvas HUD overlays:
 *   - Base Height: Model total height before vector stamping & sculpting
 *   - Total Height: Model total height including vector stamping, brick relief, and sculpting
 */
export function updateCanvasHeights(baseHeights, heights, thicken = null) {
    if (typeof document === 'undefined') return;
    if (!baseHeights || !heights) return;

    let bMin = Infinity, bMax = -Infinity;
    for (let k = 0; k < baseHeights.length; k++) {
        const z = baseHeights[k];
        if (z < bMin) bMin = z;
        if (z > bMax) bMax = z;
    }
    const baseSpan = Math.max(0, bMax - bMin);

    let tMin = Infinity, tMax = -Infinity;
    for (let k = 0; k < heights.length; k++) {
        const z = heights[k];
        if (z < tMin) tMin = z;
        if (z > tMax) tMax = z;
    }

    const offsetPts = thicken?.data?.offsetPts || thicken?.offsetPts;
    if (offsetPts && offsetPts.length > 0) {
        for (let k = 2; k < offsetPts.length; k += 3) {
            const z = offsetPts[k];
            if (z < tMin) tMin = z;
            if (z > tMax) tMax = z;
        }
    } else if (thicken?.floorZ !== undefined && thicken?.peakZ !== undefined && P.thickenEnabled) {
        if (thicken.floorZ < tMin) tMin = thicken.floorZ;
        if (thicken.peakZ > tMax) tMax = thicken.peakZ;
    }
    const totalSpan = Math.max(0, tMax - tMin);

    const baseStr = (Number.isFinite(baseSpan) ? baseSpan : 0).toFixed(3);
    const totalStr = (Number.isFinite(totalSpan) ? totalSpan : 0).toFixed(3);

    const inspectorBase = document.getElementById('inspectorBaseHeight');
    if (inspectorBase) inspectorBase.textContent = baseStr;
    const inspectorTotal = document.getElementById('inspectorTotalHeight');
    if (inspectorTotal) inspectorTotal.textContent = totalStr;

    for (const { root, total } of HEIGHTS_HUD) {
        const span = document.getElementById(total);
        if (span) span.textContent = totalStr;
        const host = document.getElementById(root);
        if (host) host.title = `Base H: ${baseStr}"`;
    }
}

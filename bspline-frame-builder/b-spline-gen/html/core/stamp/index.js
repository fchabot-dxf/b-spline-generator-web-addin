/**
 * rasterizeSvg — produces a normalized 0..1 alpha mask for one stamp
 * layer from its SVG. The mask is consumed by engine/rebuild.js where
 * it's multiplied by `layerDepth` and added on top of the base terrain.
 *
 * Pipeline:
 *   1. Sanitize the SVG (strip svg.js metadata, normalize fonts).
 *   2. Render to an offscreen canvas of size (nx, nz).
 *   3. Compute a true Euclidean SDF from the alpha channel.
 *   4. For each grid pixel: ask the active profile module for Z_p,
 *      blend in the fillet outside the boundary, normalize to 0..1.
 *
 * Profile-specific math lives in core/stamp/profiles/<id>.js — adding a
 * new profile means dropping in a file, not editing this loop.
 */
import { COORD_SYSTEM } from '../coords.js';
import { dbg } from '../debug.js';
import { computeSDF, sampleSDF, powerStep } from './sdf.js';
import {
    sanitizeSvgForRaster,
    prepareSvgForRaster,
    renderSvgNative,
    loadCanvg,
} from './render-svg.js';
import { getProfile } from './profiles/index.js';

// Reused offscreen canvas — rasterizeSvg is serialized at the call site
// (stamp-mask-manager.js' generation counter) so a single shared buffer
// is fine.
const stampCanvas = document.createElement('canvas');
const stampCtx = stampCanvas.getContext('2d', { willReadFrequently: true });

// SDF cache: keyed on (svg + blur + buffer dimensions), which is
// everything that determines the SDF. Profile / depth / fillet changes
// don't invalidate this — the per-pixel loop just re-runs with the
// cached SDF, skipping the ~30-50ms SVG render + Danielsson sweep.
// LRU bounded so multi-layer projects don't grow the cache unbounded.
const SDF_CACHE_MAX = 8;
const sdfCache = new Map();

function quickHash(str) {
    let h = 0;
    for (let i = 0, n = str.length; i < n; i++) {
        h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return h;
}

function getCachedSdf(key) {
    if (!sdfCache.has(key)) return null;
    // LRU: re-insert to mark as most-recent.
    const v = sdfCache.get(key);
    sdfCache.delete(key);
    sdfCache.set(key, v);
    return v;
}

function setCachedSdf(key, value) {
    sdfCache.set(key, value);
    while (sdfCache.size > SDF_CACHE_MAX) {
        const oldestKey = sdfCache.keys().next().value;
        sdfCache.delete(oldestKey);
    }
}

/** Empty two-channel mask, returned on rasterizer failure paths so the
 *  engine's mask consumer always sees the same shape. */
function emptyMask(nx, nz) {
    const N = nx * nz;
    return {
        body: new Float32Array(N),
        fillet: new Float32Array(N),
        isStamped: new Uint8Array(N),
        metrics: null,
    };
}

export async function rasterizeSvg(
    svgText,
    nx,
    nz,
    blurIn,
    widthIn,
    heightIn,
    stampProfile,
    stampDepth,
    stampVBitAngle,
    edgeFilletRadius = 0,
    filletPower = 2.2,
) {
    dbg('STAMP DEBUG', `Rasterizing for grid: ${nx}x${nz}. Stock: ${widthIn}x${heightIn}`);

    return new Promise(async (resolve) => {
        const processedSvg = sanitizeSvgForRaster(svgText);
        const bufferW = nx, bufferH = nz;
        stampCanvas.width = bufferW;
        stampCanvas.height = bufferH;
        const safeSvgText = prepareSvgForRaster(processedSvg, bufferW, bufferH);

        // Cache key — anything that affects the SDF must be in here.
        // Profile / depth / fillet are NOT in the key: they don't change
        // the SDF, only the per-pixel loop's output, so they reuse the
        // cache freely. This is the main slider-responsiveness win.
        const cacheKey = `${quickHash(safeSvgText)}_${blurIn}_${bufferW}x${bufferH}`;
        const cached = getCachedSdf(cacheKey);
        if (cached) {
            dbg('STAMP DEBUG', 'SDF cache hit — skipping render + SDF compute.');
            finishRaster(cached.sdf, cached.maxSdfInsidePx);
            return;
        }

        const viewBoxMatch = safeSvgText.match(/viewBox="([^"]+)"/i);
        dbg('STAMP DEBUG', 'rasterizeSvg: bufferW=', bufferW, 'bufferH=', bufferH, 'viewBox=', viewBoxMatch ? viewBoxMatch[1] : 'none');

        // --- Step 1: native browser SVG render (correct fonts, no canvg quirks) ---
        stampCtx.clearRect(0, 0, bufferW, bufferH);
        stampCtx.filter = blurIn > 0 ? `blur(${blurIn}px)` : 'none';

        let nativeOk = false;
        try {
            await renderSvgNative(stampCtx, safeSvgText, bufferW, bufferH);
            nativeOk = true;
            dbg('STAMP DEBUG', 'Native SVG render succeeded.');
        } catch (nativeErr) {
            console.warn('[SVG DEBUG] Native render failed, falling back to canvg:', nativeErr);
        }

        if (nativeOk) {
            const imageData = stampCtx.getImageData(0, 0, bufferW, bufferH);
            dbg('STAMP DEBUG', 'Rasterization complete (native). Mask generated.');
            startSdfFromImageData(imageData);
            return;
        }

        // --- Step 2: canvg v3 fallback ---
        const Canvg = await loadCanvg();
        if (Canvg) {
            stampCtx.clearRect(0, 0, bufferW, bufferH);
            try {
                const instance = await Canvg.fromString(stampCtx, safeSvgText, { ignoreAnimation: true, ignoreMouse: true });
                await instance.render();
                const imageData = stampCtx.getImageData(0, 0, bufferW, bufferH);
                dbg('STAMP DEBUG', 'Rasterization complete (canvg fallback). Mask generated.');
                startSdfFromImageData(imageData);
            } catch (err) {
                console.error('[SVG DEBUG] rasterizeSvg: canvg render also failed:', err);
                resolve(emptyMask(nx, nz));
            }
        } else {
            console.error('[SVG DEBUG] rasterizeSvg: no renderer available — stamp mask will be empty');
            resolve(emptyMask(nx, nz));
        }

        // Step that computes SDF from canvas pixels and caches it before
        // handing off to the per-pixel mask-build loop.
        function startSdfFromImageData(imageData) {
            const sdf = computeSDF(imageData.data, bufferW, bufferH);
            let maxSdfInsidePx = 0;
            for (let k = 0; k < sdf.length; k++) {
                if (sdf[k] > maxSdfInsidePx) maxSdfInsidePx = sdf[k];
            }
            setCachedSdf(cacheKey, { sdf, maxSdfInsidePx });
            finishRaster(sdf, maxSdfInsidePx);
        }

        function finishRaster(sdf, maxSdfInsidePx) {
            const inchPerPx = widthIn / bufferW;

            // Two-channel mask:
            //   body:    0..1, multiplied by layerDepth at apply time.
            //   fillet:  0..1, multiplied by min(filletRadius, |layerDepth|)
            //            at apply time. Stays stable when the depth slider
            //            moves (no fillet wobble).
            //   isStamped: sentinel byte for terrain-suppression coverage.
            const N = nx * nz;
            const bodyMask = new Float32Array(N);
            const filletMask = new Float32Array(N);
            const isStampedMask = new Uint8Array(N);

            const maxDepth = Math.abs(stampDepth);
            const angleRad = (stampVBitAngle || 90) * Math.PI / 180;
            const vSlope = 1.0 / Math.tan(angleRad / 2);

            // Resolve the active profile module (no string tests below).
            const profile = getProfile(stampProfile);

            // maxSdfInsidePx (inscribed-circle radius in pixels) is now
            // computed once when the SDF is built and cached alongside it
            // in setCachedSdf — passed in as a parameter to this fn.
            const R_eff = maxSdfInsidePx * inchPerPx;

            const requestedFillet = Math.max(0, edgeFilletRadius || 0);
            const filletRadiusIn = (R_eff > 0) ? Math.min(requestedFillet, R_eff) : requestedFillet;

            // ctx is read by profile modules. filletRadiusIn is the
            // clamped (to inscribed radius) value, which is what
            // filletPart needs to compute peak heights that match the
            // wall at +inR.
            const ctx = { distIn: 0, maxDepth, R_eff, vSlope, angleRad, filletRadiusIn };

            // Fillet sizing.
            //
            // Vertical-walled profiles (flat, ballnose) keep the
            // legacy `outR = 2R` baseline that the user confirmed
            // looks "beautiful" — wide gentle ramp, fully outside
            // the boundary.
            //
            // Sloped-walled profiles (vbit, adaptive) use a scaled
            // tangent arc with `outR = R` so the slider's visible
            // effect tracks its value. The pure geometric
            // `R · tan(wall/2)` collapses to sub-pixel sizes on
            // typical buffer resolutions, which made the fillet feel
            // binary on vbit.
            const wallAngleRad = profile.wallAngleRad
                ? profile.wallAngleRad(ctx)
                : Math.PI / 2;
            const filletOutR = filletRadiusIn * (profile.hasVerticalWall ? 2.0 : 1.0);
            const filletInR  = filletRadiusIn * Math.cos(wallAngleRad);

            // For sloped-wall profiles (vbit, adaptive) the fillet has
            // to span both sides of the boundary to actually round the
            // corner. For flat/ballnose (vertical wall) the fillet
            // stays outside-only — extending it inside would just eat
            // into the plateau pointlessly.
            const filletExtendsInside = !!profile.filletExtendsInside;
            const filletInnerExtent = filletExtendsInside ? filletInR : 0;

            const profileOutsideExtent = profile.outsideExtent(ctx);
            const sentinelOutsideReach = Math.max(0.05, profileOutsideExtent);

            for (let j = 0; j < nz; j++) {
                const fy = COORD_SYSTEM.gridRowToRasterY(j, nz, bufferH);
                if (j === 0 || j === nz - 1) {
                    dbg('STAMP DEBUG', `gridRowToRasterY: j=${j}/${nz - 1} -> fy=${fy}`);
                }

                for (let i = 0; i < nx; i++) {
                    const k = j * nx + i;
                    const fx = (i / (nx - 1)) * (bufferW - 1);
                    const distIn = sampleSDF(sdf, bufferW, bufferH, fx, fy) * inchPerPx;
                    ctx.distIn = distIn;

                    let bodyN = 0;
                    let filletN = 0;

                    // Decide which path this pixel falls into:
                    //   - Inside fillet zone: spans [-outR, +innerExtent].
                    //     Profile's filletPart determines the curve.
                    //   - Inside boundary, past fillet zone: natural Z_p
                    //     (the wall / plateau).
                    //   - Outside boundary, past fillet zone: zero.
                    const inFilletZone = filletRadiusIn > 0
                        && distIn > -filletOutR
                        && distIn < filletInnerExtent;

                    if (inFilletZone) {
                        // Profile decides its own fillet curve (powerStep
                        // S-curve, geometric tangent arc, etc.) given
                        // the zone bounds and distIn. This lets vbit use
                        // a true circular arc (slope-continuous with
                        // the wall at +inR, no ridge at the join) while
                        // flat keeps the simpler powerStep S-curve.
                        const part = profile.filletPart(ctx, distIn, filletOutR, filletInR, filletPower);
                        bodyN = part.bodyN;
                        filletN = part.filletN;
                    } else if (distIn >= 0) {
                        // Inside the boundary, past the fillet zone:
                        // pure profile, normalized by maxDepth.
                        const Z_p = profile.Zp(ctx);
                        bodyN = maxDepth > 0 ? Z_p / maxDepth : 0;
                    }
                    // (else: distIn < -outR → terrain, both channels 0)

                    bodyMask[k] = bodyN;
                    filletMask[k] = filletN;

                    // Sentinel: tag pixels covered by the stamp footprint
                    // so terrain suppression works there even when both
                    // channels round to 0.
                    isStampedMask[k] = (
                        distIn > -sentinelOutsideReach
                        || (filletRadiusIn > 0 && distIn > -filletRadiusIn * 2.0)
                    ) ? 1 : 0;
                }
            }

            // Diagnostic metrics so the UI can show users what's actually
            // happening — particularly the geometry-driven depth cap that
            // vbit/ballnose hit on narrow features (and which looks like
            // "the depth slider stopped working" past that point).
            const cappedFillet = filletRadiusIn !== requestedFillet;
            const profileBoundary = profile.boundaryDepth(ctx);

            // Walk the body mask once to find the deepest body value on
            // the grid. body[k] is normalized 0..1; multiplying by maxDepth
            // gives the actual depth the user will see at that pixel.
            // (The engine multiplies body by layerDepth at apply time — so
            // depthReachedIn is what they'd see if layerDepth = maxDepth.)
            let bodyMax = 0;
            for (let k = 0; k < N; k++) {
                if (bodyMask[k] > bodyMax) bodyMax = bodyMask[k];
            }
            const depthReachedIn = bodyMax * maxDepth;
            const depthCapped = depthReachedIn < maxDepth - 1e-6;

            const metrics = {
                profileId: profile.id,
                inscribedRadiusIn: R_eff,
                requestedFilletIn: requestedFillet,
                effectiveFilletIn: filletRadiusIn,
                filletRadiusCapped: cappedFillet,
                maxDepth,
                depthReachedIn,
                depthCapped,
                bodyAtBoundary: profileBoundary,
                filletOuterReachIn: filletOutR,
            };

            resolve({ body: bodyMask, fillet: filletMask, isStamped: isStampedMask, metrics });
        }
    });
}

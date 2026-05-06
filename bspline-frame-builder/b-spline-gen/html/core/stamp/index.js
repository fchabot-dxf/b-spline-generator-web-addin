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
    console.log(`[STAMP DEBUG] Rasterizing for grid: ${nx}x${nz}. Stock: ${widthIn}x${heightIn}`);

    return new Promise(async (resolve) => {
        const processedSvg = sanitizeSvgForRaster(svgText);
        const bufferW = nx, bufferH = nz;
        stampCanvas.width = bufferW;
        stampCanvas.height = bufferH;
        const safeSvgText = prepareSvgForRaster(processedSvg, bufferW, bufferH);

        if (window && window.console) {
            const viewBoxMatch = safeSvgText.match(/viewBox="([^"]+)"/i);
            console.log('[STAMP DEBUG] rasterizeSvg: bufferW=', bufferW, 'bufferH=', bufferH, 'viewBox=', viewBoxMatch ? viewBoxMatch[1] : 'none');
        }

        // --- Step 1: native browser SVG render (correct fonts, no canvg quirks) ---
        stampCtx.clearRect(0, 0, bufferW, bufferH);
        stampCtx.filter = blurIn > 0 ? `blur(${blurIn}px)` : 'none';

        let nativeOk = false;
        try {
            await renderSvgNative(stampCtx, safeSvgText, bufferW, bufferH);
            nativeOk = true;
            console.log('[STAMP DEBUG] Native SVG render succeeded.');
        } catch (nativeErr) {
            console.warn('[SVG DEBUG] Native render failed, falling back to canvg:', nativeErr);
        }

        if (nativeOk) {
            const imageData = stampCtx.getImageData(0, 0, bufferW, bufferH);
            console.log('[STAMP DEBUG] Rasterization complete (native). Mask generated.');
            finishRaster(imageData);
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
                console.log('[STAMP DEBUG] Rasterization complete (canvg fallback). Mask generated.');
                finishRaster(imageData);
            } catch (err) {
                console.error('[SVG DEBUG] rasterizeSvg: canvg render also failed:', err);
                resolve(emptyMask(nx, nz));
            }
        } else {
            console.error('[SVG DEBUG] rasterizeSvg: no renderer available — stamp mask will be empty');
            resolve(new Float32Array(nx * nz));
        }

        function finishRaster(imageData) {
            const sdf = computeSDF(imageData.data, bufferW, bufferH);
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

            // Inscribed-circle radius: half-thickness of widest feature.
            let maxSdfInsidePx = 0;
            for (let k = 0; k < sdf.length; k++) {
                if (sdf[k] > maxSdfInsidePx) maxSdfInsidePx = sdf[k];
            }
            const R_eff = maxSdfInsidePx * inchPerPx;

            const requestedFillet = Math.max(0, edgeFilletRadius || 0);
            const filletRadiusIn = (R_eff > 0) ? Math.min(requestedFillet, R_eff) : requestedFillet;

            const ctx = { distIn: 0, maxDepth, R_eff, vSlope, angleRad };

            const filletBias = profile.hasVerticalWall
                ? 1.0
                : Math.cos(profile.effectiveAngleRad(ctx) / 2);
            const filletOutR = filletRadiusIn * (1.0 + filletBias);

            const profileOutsideExtent = profile.outsideExtent(ctx);
            const sentinelOutsideReach = Math.max(0.05, profileOutsideExtent);

            for (let j = 0; j < nz; j++) {
                const fy = COORD_SYSTEM.gridRowToRasterY(j, nz, bufferH);
                if (window && window.console && (j === 0 || j === nz - 1)) {
                    console.log(`[STAMP DEBUG] gridRowToRasterY: j=${j}/${nz - 1} -> fy=${fy}`);
                }

                for (let i = 0; i < nx; i++) {
                    const k = j * nx + i;
                    const fx = (i / (nx - 1)) * (bufferW - 1);
                    const distIn = sampleSDF(sdf, bufferW, bufferH, fx, fy) * inchPerPx;
                    ctx.distIn = distIn;

                    let bodyN = 0;
                    let filletN = 0;

                    if (distIn >= 0) {
                        // Inside the boundary: pure profile, normalized by maxDepth.
                        const Z_p = profile.Zp(ctx);
                        bodyN = maxDepth > 0 ? Z_p / maxDepth : 0;
                    } else if (filletRadiusIn > 0 && distIn > -filletOutR) {
                        // In the fillet zone outside the boundary. Profile
                        // decides how much goes in body vs fillet channel.
                        const filletAlpha = powerStep(-filletOutR, 0, distIn, filletPower);
                        const part = profile.filletPart(ctx, filletAlpha);
                        bodyN = part.bodyN;
                        filletN = part.filletN;
                    }

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
            // happening (inscribed radius, capped fillet, max body height
            // they'll see at the current depth, etc.).
            const cappedFillet = filletRadiusIn !== requestedFillet;
            const profileBoundary = profile.boundaryDepth(ctx);   // Z_p at distIn=0+
            const metrics = {
                profileId: profile.id,
                inscribedRadiusIn: R_eff,
                requestedFilletIn: requestedFillet,
                effectiveFilletIn: filletRadiusIn,
                filletRadiusCapped: cappedFillet,
                maxDepth,
                bodyAtBoundary: profileBoundary,        // 0 for vbit/ballnose, maxDepth for flat/adaptive
                filletOuterReachIn: filletOutR,          // how far the fillet extends past boundary
            };

            resolve({ body: bodyMask, fillet: filletMask, isStamped: isStampedMask, metrics });
        }
    });
}

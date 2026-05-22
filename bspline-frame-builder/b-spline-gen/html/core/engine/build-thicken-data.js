/**
 * Thicken pipeline orchestrator.
 *
 * Takes the stamped top-surface heights and produces everything the rest
 * of the app needs to render and reason about a thickened solid:
 *
 *   normals          — per-vertex top-surface normals (always computed,
 *                      even when thicken is disabled — caller may need
 *                      them for the status bar)
 *   safeMap, maxSafe — curvature-derived safe-offset map + global min,
 *                      driving the "Max Safe Thickness" indicator
 *   hasIntersect     — true when requested thickness exceeds maxSafe
 *   peakZ, floorZ    — Z bounds of (top + bottom) surfaces, drives camera
 *   data             — thickenData payload (offsetPts, colours, problem
 *                      points, etc.) when thickenEnabled; null otherwise
 *   counts, minThk,  — aggregates the rebuild status bar reads
 *   sumThk
 *
 * Pipeline (when thicken is enabled):
 *   1. Offset CPs from analytical safe-thickness map
 *   2. Per-cell adjustments: extra-thicken-thin auto-fill, manual mask
 *      from main module, sculpt postDelta on the bottom surface
 *   3. Spatial Gaussian smoothing of the offset surface
 *   4. Per-cell intersection / thinness analysis → vertex colours +
 *      worst-point list
 */

import {
  computeNormals,
  computeSafeOffsetMap,
  computeMaxSafeThickness,
  computeOffsetPoints,
  smoothOffsetPoints,
} from '../thicken.js';

const INTERSECT_TOLERANCE = 0.002;
const OFFSET_SMOOTH_RADIUS_IN = 0.3;
const SAFE_MAP_BOTTOM_SMOOTH_IN = 0.3;
const MAX_WORST_POINTS = 20;

// Beige default = 0xd4b896 / 255, matching the flat material the top mesh
// uses when no warnings are present.
const BEIGE = [0.831, 0.722, 0.588];
const RED   = [1.0,   0.1,   0.1];   // top-bot intersection
const PINK  = [1.0,   0.4,   0.7];   // self-intersection (bottom only)
const BLUE  = [0.5,   0.8,   1.0];   // thin

export function buildThickenData(heights, nx, nz, params, opts = {}) {
  const {
    widthIn, heightIn, thickness, thickenEnabled,
    thickenMode, thickenDir, extraThickenThin,
    extraThickenThinFalloff, thickenYellowOffset,
  } = params;
  const { extraThickenThinMask = null, postDelta = null } = opts;

  const normals = computeNormals(heights, nx, nz, widthIn, heightIn);
  const safeMap = computeSafeOffsetMap(heights, nx, nz, widthIn, heightIn, SAFE_MAP_BOTTOM_SMOOTH_IN);
  const maxSafe = computeMaxSafeThickness(safeMap);
  const hasIntersect = thickness > maxSafe + 1e-4;

  let peakZ = -Infinity, floorZ = Infinity;
  for (let k = 0; k < nx * nz; k++) {
    const z = heights[k];
    if (z > peakZ)  peakZ  = z;
    if (z < floorZ) floorZ = z;
  }

  if (!thickenEnabled) {
    return {
      normals, safeMap, maxSafe, hasIntersect,
      peakZ, floorZ,
      data: null,
      counts: { self: 0, topBot: 0, thin: 0 },
      minThk: 0, sumThk: 0,
    };
  }

  const sign = thickenDir === 'up' ? 1 : -1;
  const offsetPts = buildAdjustedOffsetPts({
    heights, normals, nx, nz, widthIn, heightIn,
    thickness, thickenMode, safeMap, sign,
    extraThickenThin, extraThickenThinFalloff,
    extraThickenThinMask, postDelta,
  });

  // Update z-bounds with bottom-surface z.
  for (let k = 0; k < nx * nz; k++) {
    const bZ = offsetPts.smoothed[k * 3 + 2];
    if (bZ > peakZ)  peakZ  = bZ;
    if (bZ < floorZ) floorZ = bZ;
  }

  const analysis = analyseThickness({
    heights, offsetPts: offsetPts.smoothed, normals,
    nx, nz, widthIn, heightIn,
    thickness, yellowOffset: thickenYellowOffset,
  });

  return {
    normals, safeMap, maxSafe, hasIntersect,
    peakZ, floorZ,
    data: {
      offsetPts:    offsetPts.smoothed,
      rawOffsetPts: offsetPts.raw,
      clampMap:     offsetPts.clampMap,
      worstPts:     analysis.worstPts,
      thinPts:      analysis.thinPts,
      intersectPts: analysis.intersectPts,
      meshColours:  analysis.meshColours,
      botColours:   analysis.botColours,
    },
    counts: analysis.counts,
    minThk: analysis.minThk,
    sumThk: analysis.sumThk,
  };
}

/**
 * Compute raw offset CPs from the analytical safe map, apply per-cell
 * adjustments (auto thin-fill, manual mask, sculpt delta), then smooth.
 */
function buildAdjustedOffsetPts({
  heights, normals, nx, nz, widthIn, heightIn,
  thickness, thickenMode, safeMap, sign,
  extraThickenThin, extraThickenThinFalloff,
  extraThickenThinMask, postDelta,
}) {
  const { pts: rawOffsetPts, clampMap } = computeOffsetPoints(
    heights, normals, nx, nz, widthIn, heightIn,
    thickness, thickenMode === 'adaptive', safeMap, sign,
  );

  const adjusted = new Float32Array(rawOffsetPts);
  const falloff  = Math.max(0.001, extraThickenThinFalloff);
  for (let k = 0; k < nx * nz; k++) {
    let zAdjust = 0;
    const physicalDist = (rawOffsetPts[k * 3 + 2] - heights[k]) * sign;
    const deficit = thickness - physicalDist;
    if (deficit > 0) {
      const weight = Math.min(1.0, deficit / falloff);
      zAdjust += (extraThickenThin * weight) * sign;
    }
    if (extraThickenThinMask) zAdjust += extraThickenThinMask[k] * sign;
    if (postDelta)            zAdjust += postDelta[k];
    adjusted[k * 3 + 2] += zAdjust;
  }

  const smoothed = smoothOffsetPoints(adjusted, nx, nz, widthIn, heightIn, OFFSET_SMOOTH_RADIUS_IN);
  return { raw: rawOffsetPts, smoothed, clampMap };
}

/**
 * Per-cell intersection + thinness analysis. Builds top/bot vertex colours
 * (beige default; red/pink/blue for problem cells) and the worst-N worst-
 * clamped point list.
 */
function analyseThickness({
  heights, offsetPts, normals, nx, nz, widthIn, heightIn,
  thickness, yellowOffset,
}) {
  const meshColours = new Float32Array(nx * nz * 3);
  const botColours  = new Float32Array(nx * nz * 3);
  const intersectPts = [], thinPts = [], worstClamped = [];
  let self = 0, topBot = 0;
  let minThk = Infinity, sumThk = 0;

  for (let k = 0; k < nx * nz; k++) {
    const i = k % nx;
    const j = (k / nx) | 0;
    const xT = -widthIn  / 2 + i * widthIn  / (nx - 1);
    const yT = -heightIn / 2 + j * heightIn / (nz - 1);
    const zT = heights[k];
    const xB = offsetPts[k * 3 + 0];
    const yB = offsetPts[k * 3 + 1];
    const zB = offsetPts[k * 3 + 2];
    const physicalThickness = Math.sqrt((xB - xT) ** 2 + (yB - yT) ** 2 + (zB - zT) ** 2);

    if (physicalThickness < minThk) minThk = physicalThickness;
    sumThk += physicalThickness;

    const isSelfIntersect = (i < nx - 1 && offsetPts[k * 3]     > offsetPts[(k + 1)  * 3]) ||
                            (i > 0      && offsetPts[k * 3]     < offsetPts[(k - 1)  * 3]) ||
                            (j < nz - 1 && offsetPts[k * 3 + 1] > offsetPts[(k + nx) * 3 + 1]) ||
                            (j > 0      && offsetPts[k * 3 + 1] < offsetPts[(k - nx) * 3 + 1]);
    const isTopBotIntersect = (normals[k * 3 + 2] < -0.05) || (physicalThickness <= INTERSECT_TOLERANCE);
    const isThin = !isSelfIntersect && !isTopBotIntersect &&
                   (physicalThickness < thickness - yellowOffset - INTERSECT_TOLERANCE);

    const pt = { x: xB, y: yB, z: zB, actual: physicalThickness };
    if (isTopBotIntersect || isSelfIntersect) {
      intersectPts.push(pt); worstClamped.push(pt);
      if (isSelfIntersect) self++; else topBot++;
    } else if (isThin) {
      thinPts.push(pt); worstClamped.push(pt);
    }

    // Top + bottom colours per cell.
    const top = isTopBotIntersect ? RED   : isThin           ? BLUE  : BEIGE;
    const bot = isTopBotIntersect ? RED   : isSelfIntersect  ? PINK
              : isThin            ? BLUE  : BEIGE;
    meshColours[k * 3 + 0] = top[0]; meshColours[k * 3 + 1] = top[1]; meshColours[k * 3 + 2] = top[2];
    botColours [k * 3 + 0] = bot[0]; botColours [k * 3 + 1] = bot[1]; botColours [k * 3 + 2] = bot[2];
  }

  worstClamped.sort((a, b) => a.actual - b.actual);
  return {
    meshColours, botColours,
    worstPts: worstClamped.slice(0, MAX_WORST_POINTS),
    thinPts, intersectPts,
    counts: { self, topBot, thin: thinPts.length },
    minThk: minThk === Infinity ? 0 : minThk,
    sumThk,
  };
}

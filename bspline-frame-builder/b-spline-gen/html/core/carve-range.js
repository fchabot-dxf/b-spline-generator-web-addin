/**
 * core/carve-range.js -- the CARVE RANGE readout (HEIGHT-PAINTER slice 5, Fred 2026-11-23: "with carving we need a warning
 * about the surface thickness"). DETECTION ONLY: nothing is clamped, blocked or changed. From the REAL built heights (the
 * last build's lastResult.heights, inches, the stock running 0 = the carve floor .. carveZ = the stock top) -- not the 3D
 * view's H readout. Pure; the ONE place it renders is main/height-panel.js #heightCarveRange.
 */

/**
 * The range of `heights` against the stock 0..`carveZ`: { min, max, below, above, warn, text } -- `below` = how far the
 * deepest point carves under the floor (0 inside), `above` = how far the highest stands over the stock top (0 inside; that
 * part will be cut flat), `text` the one-line readout. null when there are no heights.
 */
export function carveRangeReport(heights, carveZ) {
  if (!heights || !heights.length) return null;
  let min = Infinity, max = -Infinity;
  for (let k = 0; k < heights.length; k++) { const v = heights[k]; if (v < min) min = v; if (v > max) max = v; }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const below = min < 0 ? -min : 0, above = max > carveZ ? max - carveZ : 0;
  const lo = below > 0 ? `Carves ${below.toFixed(2)} in below the carve floor` : `Deepest point ${min.toFixed(2)} in above the carve floor`;
  const hi = above > 0 ? `${above.toFixed(2)} in above the stock top (will be cut flat)` : `highest ${(carveZ - max).toFixed(2)} in under the stock top`;
  return { min, max, below, above, warn: below > 0 || above > 0, text: `${lo} / ${hi}` };
}

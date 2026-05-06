/**
 * Smoothing — terrain-side Gaussian blur applied DURING the engine's
 * stamp-application step. Used together with Texture Suppression to
 * blend out the underlying terrain noise inside the stamp footprint.
 * Mask-independent (engine.js consumes it directly), so changing this
 * does NOT need a re-rasterize. Unit: grid cells.
 */
export function initSmoothing(ctx) {
  const sync = ctx.bindNumberSlider('stampSmoothingRadius', 'stampSmoothingRadiusSlider', 'smoothing');
  return ctx.registerModule({
    id: 'smoothing',
    syncFromLayer: sync,
  });
}

/**
 * Blur Radius — pre-rasterize Gaussian blur applied to the SVG via
 * canvas filter before the SDF is computed. Softens the mask boundary.
 * Unit: canvas pixels.
 */
export function initBlur(ctx) {
  return ctx.registerSyncs('blur',
    ctx.bindNumberSlider('stampBlur', 'stampBlurSlider', 'blur'),
  );
}

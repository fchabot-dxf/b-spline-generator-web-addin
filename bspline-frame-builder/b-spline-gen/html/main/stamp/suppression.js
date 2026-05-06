/**
 * Texture Suppression — blend factor 0..1 between the original terrain
 * and the smoothed terrain inside the stamp footprint. 0 = keep noise,
 * 1 = replace fully with smoothed. Engine reads it directly; no
 * re-rasterize needed.
 */
export function initSuppression(ctx) {
  const sync = ctx.bindNumberSlider('stampTextureSuppression', 'stampTextureSuppressionSlider', 'suppression');
  return ctx.registerModule({
    id: 'suppression',
    syncFromLayer: sync,
  });
}
